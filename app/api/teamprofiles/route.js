import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { createCache } from "@/lib/backtest/cache";
import { isValidMatchType } from "@/lib/utils/teamprofiles";
import {
  buildTeamProfileKey,
  TEAM_PROFILE_TTL_MS,
} from "@/lib/utils/apiKeys";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "teamprofiles";
const LOG = process.env.LOG_TEAMPROFILES !== "0";
const TAG = "[api/teamprofiles]";

// Keep the CDN fresh — team profiles are regenerated often and we don't want
// to serve 24h old data. Five minutes is a reasonable compromise between RU
// usage and freshness, while still allowing a SWR window for fast repeats.
const CACHE_MAX_AGE_SECONDS = 300;
const CACHE_STALE_REVALIDATE_SECONDS = 300;

const CACHE_KEY_SYMBOL = Symbol.for("ullebets.teamprofiles.cache");
const profileCache =
  globalThis[CACHE_KEY_SYMBOL] ??
  createCache({ ttlMs: TEAM_PROFILE_TTL_MS ?? 300_000 });
globalThis[CACHE_KEY_SYMBOL] = profileCache;

const MULTISPACE_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

const log = (...args) => {
  if (LOG) console.log(TAG, ...args);
};
const warn = (...args) => console.warn(TAG, ...args);
const logError = (...args) => console.error(TAG, ...args);

function buildResponseHeaders(savedAt) {
  const headers = {
    "cache-control": `public, max-age=0, s-maxage=${CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${CACHE_STALE_REVALIDATE_SECONDS}`,
  };

  if (savedAt) {
    const savedAtDate = new Date(savedAt);
    if (!Number.isNaN(savedAtDate.getTime())) {
      headers["last-modified"] = savedAtDate.toUTCString();
    }
  }

  return headers;
}

function parsePositiveInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildIdentifier(leagueId, teamId, matchType) {
  const league = parsePositiveInt(leagueId);
  const team = parsePositiveInt(teamId);
  if (league == null || team == null || !matchType) return null;
  return `${league}:${team}:${matchType}`;
}

function stripDbProfile(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function normalizeComparableName(value) {
  if (value == null) {
    return null;
  }

  return String(value)
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

function stringEquals(expected, actual) {
  const lhs = normalizeComparableName(expected);
  const rhs = normalizeComparableName(actual);

  if (lhs && rhs) {
    return lhs === rhs;
  }

  if (lhs) {
    return false;
  }

  return true;
}

function profileMatchesRequest(doc, params) {
  if (!doc) {
    return false;
  }

  const meta = doc.meta ?? {};
  const { leagueId, teamId, leagueName, teamName, matchType } = params;

  if (matchType) {
    if (typeof meta.matchType !== "string") {
      return false;
    }
    if (meta.matchType.toLowerCase() !== matchType.toLowerCase()) {
      return false;
    }
  }

  const actualTeamId = parsePositiveInt(meta.lagId ?? meta.teamId ?? doc.teamId);
  const expectedTeamId = parsePositiveInt(teamId);
  if (expectedTeamId != null) {
    if (actualTeamId == null || actualTeamId !== expectedTeamId) {
      return false;
    }
  } else if (!stringEquals(teamName, meta.lagnamn ?? meta.teamName ?? doc.teamName ?? doc.team)) {
    return false;
  }

  const actualLeagueId = parsePositiveInt(meta.ligaId ?? meta.leagueId ?? doc.leagueId);
  const expectedLeagueId = parsePositiveInt(leagueId);
  if (expectedLeagueId != null) {
    if (actualLeagueId == null || actualLeagueId !== expectedLeagueId) {
      return false;
    }
  } else if (!stringEquals(leagueName, meta.leagueName ?? meta.league ?? doc.leagueName ?? doc.league)) {
    return false;
  }

  return true;
}

function sanitizeDbResult(doc, params, stage) {
  if (!doc) {
    return null;
  }

  if (!profileMatchesRequest(doc, params)) {
    warn("db hit rejected", {
      stage,
      params,
      meta: doc?.meta ?? null,
    });
    return null;
  }

  return stripDbProfile(doc);
}

function escapeForRegex(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function buildCaseInsensitiveEquals(value) {
  if (!value) return null;
  return { $regex: `^${escapeForRegex(value)}$`, $options: "i" };
}

async function fetchProfileFromDb({ leagueId, teamId, leagueName, teamName, matchType }) {
  const client = await clientPromise;
  const collection = client.db(DB_NAME).collection(COLLECTION);

  const leagueNumeric = parsePositiveInt(leagueId);
  const teamNumeric = parsePositiveInt(teamId);
  const requestParams = { leagueId, teamId, leagueName, teamName, matchType };

  if (leagueNumeric != null && teamNumeric != null) {
    const identifier = buildIdentifier(leagueNumeric, teamNumeric, matchType);
    if (identifier) {
      log("db lookup by _id", { identifier });
      const doc = await collection.findOne({ _id: identifier });
      const sanitized = sanitizeDbResult(doc, requestParams, "_id");
      if (sanitized) {
        log("db hit", { identifier });
        return sanitized;
      }
      warn("db miss", { identifier });
    }

    log("db lookup by numeric meta", {
      leagueNumeric,
      teamNumeric,
      matchType,
    });
    const docByMeta = await collection.findOne({
      "meta.ligaId": leagueNumeric,
      "meta.lagId": teamNumeric,
      "meta.matchType": matchType,
    });
    const sanitizedByMeta = sanitizeDbResult(docByMeta, requestParams, "numeric-meta");
    if (sanitizedByMeta) {
      log("db hit by numeric meta", {
        leagueNumeric,
        teamNumeric,
        matchType,
      });
      return sanitizedByMeta;
    }
    warn("db miss by numeric meta", {
      leagueNumeric,
      teamNumeric,
      matchType,
    });
  }

  if (leagueName || teamName) {
    const leagueMatcher = leagueNumeric != null ? leagueNumeric : buildCaseInsensitiveEquals(leagueName);
    const teamMatcher = teamNumeric != null ? teamNumeric : buildCaseInsensitiveEquals(teamName);

    const query = {
      "meta.matchType": matchType,
    };

    if (leagueNumeric != null) {
      query["meta.ligaId"] = leagueNumeric;
    } else if (leagueMatcher) {
      query.leagueName = leagueMatcher;
    }

    if (teamNumeric != null) {
      query["meta.lagId"] = teamNumeric;
    } else if (teamMatcher) {
      query["meta.lagnamn"] = teamMatcher;
    }

    log("db lookup by fallback", query);
    const docByName = await collection.findOne(query);
    const sanitizedByName = sanitizeDbResult(docByName, requestParams, "fallback");
    if (sanitizedByName) {
      log("db hit by fallback", {
        leagueName,
        teamName,
        matchType,
      });
      return sanitizedByName;
    }
    warn("db miss by fallback", {
      leagueName,
      teamName,
      matchType,
    });
  }

  return null;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("leagueId");
    const teamId = url.searchParams.get("teamId");
    const leagueName = url.searchParams.get("league");
    const teamName = url.searchParams.get("team");
    const matchType = url.searchParams.get("matchType")?.toLowerCase();

    log("incoming", { leagueId, teamId, leagueName, teamName, matchType });

    if (!matchType) {
      return NextResponse.json(
        { message: "Missing matchType" },
        { status: 400 }
      );
    }

    if (!isValidMatchType(matchType)) {
      return NextResponse.json(
        { message: "Invalid matchType" },
        { status: 400 }
      );
    }

    const cacheKey = buildTeamProfileKey({
      leagueId,
      league: leagueName,
      leagueName,
      teamId,
      team: teamName,
      teamName,
      matchType,
      matchId: url.searchParams.get("matchId"),
    });

    if (cacheKey) {
      const cached = profileCache.get(cacheKey);
      if (cached) {
        return NextResponse.json(
          { profile: cached.profile },
          {
            headers: buildResponseHeaders(cached.savedAt),
          }
        );
      }
    }

    const profileFromDb = await fetchProfileFromDb({
      leagueId,
      teamId,
      leagueName,
      teamName,
      matchType,
    });

    if (profileFromDb) {
      const savedAt =
        profileFromDb?.meta?.savedAt ?? profileFromDb?.savedAt ?? null;
      const headers = buildResponseHeaders(savedAt);
      if (cacheKey) {
        profileCache.set(cacheKey, {
          profile: profileFromDb,
          savedAt,
        });
      }

      return NextResponse.json(
        { profile: profileFromDb },
        {
          headers,
        }
      );
    }

    return NextResponse.json(
      { message: "Profile not found" },
      { status: 404 }
    );
  } catch (error) {
    logError("handler error", error);
    return NextResponse.json(
      { message: "Server error" },
      { status: 500 }
    );
  }
}
