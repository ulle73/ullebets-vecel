import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongo";
import { isValidMatchType } from "@/lib/utils/teamprofiles";

const DB_NAME = process.env.MONGODB_DB || "app";
const COLLECTION = "teamprofiles";
const LOG = process.env.LOG_TEAMPROFILES !== "0";
const TAG = "[api/teamprofiles]";

const log = (...args) => {
  if (LOG) console.log(TAG, ...args);
};
const warn = (...args) => console.warn(TAG, ...args);
const logError = (...args) => console.error(TAG, ...args);

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

  if (leagueNumeric != null && teamNumeric != null) {
    const identifier = buildIdentifier(leagueNumeric, teamNumeric, matchType);
    if (identifier) {
      log("db lookup by _id", { identifier });
      const doc = await collection.findOne({ _id: identifier });
      if (doc) {
        log("db hit", { identifier });
        return stripDbProfile(doc);
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
    if (docByMeta) {
      log("db hit by numeric meta", {
        leagueNumeric,
        teamNumeric,
        matchType,
      });
      return stripDbProfile(docByMeta);
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
    if (docByName) {
      log("db hit by fallback", {
        leagueName,
        teamName,
        matchType,
      });
      return stripDbProfile(docByName);
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

    const profileFromDb = await fetchProfileFromDb({
      leagueId,
      teamId,
      leagueName,
      teamName,
      matchType,
    });

    if (profileFromDb) {
      return NextResponse.json(
        { profile: profileFromDb },
        {
          headers: {
            "cache-control": "public, s-maxage=300, stale-while-revalidate=600",
          },
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