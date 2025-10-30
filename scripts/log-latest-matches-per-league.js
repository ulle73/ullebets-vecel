import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promises as fs } from "fs";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

if (!process.env.VERCEL) {
  dotenv.config({ path: ".env.local" });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const leaguesPath = join(__dirname, "..", "data", "leagues-and-teams.json");

function parseArgs(argv) {
  const args = argv.slice(2);
  let limit = 5;
  const selectedLeagues = new Set();
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--limit" || arg === "-n") {
      const next = args[i + 1];
      const parsed = Number.parseInt(next, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
      i += 1;
    } else if (arg === "--league" || arg === "-l") {
      const next = args[i + 1];
      if (next) {
        selectedLeagues.add(next.toLowerCase());
      }
      i += 1;
    } else if (arg.startsWith("--")) {
      continue;
    } else {
      positional.push(arg);
    }
  }

  const [leagueArg, teamArg] = positional;
  if (leagueArg) {
    selectedLeagues.add(leagueArg.toLowerCase());
  }

  return {
    limit,
    leaguesFilter: selectedLeagues.size > 0 ? selectedLeagues : null,
    teamFilter: teamArg
      ? {
          raw: teamArg,
          lower: teamArg.toLowerCase(),
          slug: normalizeSlug(teamArg),
        }
      : null,
  };
}

function matchesTeamFilter(teamEntry, filter) {
  if (!filter) {
    return true;
  }

  const possibleValues = [
    teamEntry?.teamName,
    teamEntry?.teamId,
    teamEntry?.slug,
  ]
    .filter(Boolean)
    .map((value) =>
      typeof value === "string" ? value.toLowerCase() : String(value)
    );

  if (
    possibleValues.some((value) => value === filter.lower) ||
    (filter.slug &&
      possibleValues.some((value) => normalizeSlug(value) === filter.slug)) ||
    possibleValues.some((value) => value.includes(filter.lower))
  ) {
    return true;
  }

  return false;
}

async function loadLeagueLookup() {
  const byId = new Map();
  const bySlug = new Map();

  try {
    const raw = await fs.readFile(leaguesPath, "utf8");
    const leagues = JSON.parse(raw);

    for (const [leagueName, leagueData] of Object.entries(leagues)) {
      for (const team of leagueData.teams || []) {
        const teamId =
          team?.id ?? team?.teamId ?? team?.team?.id ?? team?.optaId ?? null;
        const slug = normalizeSlug(team?.slug || team?.name);

        const entry = {
          leagueName,
          leagueId: leagueData.leagueId ?? null,
          teamName: team?.name ?? null,
          teamId: teamId != null ? String(teamId) : null,
          slug,
        };

        if (entry.teamId) {
          byId.set(entry.teamId, entry);
        }
        if (entry.slug) {
          bySlug.set(entry.slug, entry);
        }
      }
    }
  } catch (err) {
    throw new Error(
      `Kunde inte läsa leagues-and-teams.json: ${err?.message || err}`
    );
  }

  return { byId, bySlug };
}

function normalizeSlug(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

async function getDbClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI saknas i miljövariablerna.");
  }

  const client = new MongoClient(uri);
  await client.connect();
  return client;
}

function simplifyMatches(matches, role, limit) {
  if (!Array.isArray(matches)) {
    return [];
  }

  return matches
    .filter((match) => typeof match?.timestamp === "number")
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((match) => {
      const opponent =
        role === "home" ? match?.awayTeamName ?? null : match?.homeTeamName ?? null;
      const ts = match.timestamp;
      const isoDate =
        typeof ts === "number"
          ? new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ")
          : null;

      return {
        matchId: match?.matchId ?? null,
        date: match?.date ?? isoDate,
        timestamp: ts,
        opponent,
        league: match?.leagueName ?? match?.competitionName ?? null,
        savedAt: match?.savedAt ?? null,
        homeTeamName: match?.homeTeamName ?? null,
        awayTeamName: match?.awayTeamName ?? null,
      };
    });
}

function resolveLeague(meta, lookup) {
  const teamId =
    meta?.teamId ??
    meta?.team_id ??
    meta?.team?.id ??
    meta?.team?.teamId ??
    null;
  const slug = normalizeSlug(
    meta?.teamSlug ?? meta?.slug ?? meta?.team?.slug ?? meta?.teamName
  );

  return (
    (teamId != null && lookup.byId.get(String(teamId))) ||
    (slug && lookup.bySlug.get(slug)) || {
      leagueName: "Okänd liga",
      teamName: meta?.teamName ?? null,
      teamId: teamId != null ? String(teamId) : null,
      slug,
    }
  );
}

function getTeamKey(meta, leagueInfo, doc) {
  if (leagueInfo?.teamId) {
    return leagueInfo.teamId;
  }
  if (meta?.teamId != null) {
    return String(meta.teamId);
  }
  if (leagueInfo?.slug) {
    return leagueInfo.slug;
  }
  if (meta?.teamName) {
    return normalizeSlug(meta.teamName);
  }
  if (doc?._id) {
    return String(doc._id);
  }
  return `unknown-${Math.random().toString(36).slice(2, 8)}`;
}

function collectMatches(docs, lookup, limit, leaguesFilter) {
  const leagues = new Map(); // leagueName → Map(teamKey → info)

  for (const doc of docs) {
    const meta = doc?._importMeta ?? {};
    const role = meta?.teamRole === "away" ? "away" : "home";
    const matches = simplifyMatches(doc?.full, role, limit);

    if (matches.length === 0) {
      continue;
    }

    const leagueInfo = resolveLeague(meta, lookup);
    const leagueName = leagueInfo.leagueName ?? "Okänd liga";

    if (
      leaguesFilter &&
      !leaguesFilter.has(leagueName.toLowerCase())
    ) {
      continue;
    }

    if (!leagues.has(leagueName)) {
      leagues.set(leagueName, new Map());
    }

    const leagueTeams = leagues.get(leagueName);
    const teamKey = getTeamKey(meta, leagueInfo, doc);
    const teamName =
      meta?.teamName ??
      leagueInfo.teamName ??
      matches[0]?.[
        role === "home" ? "homeTeamName" : "awayTeamName"
      ] ??
      "Okänt lag";

    if (!leagueTeams.has(teamKey)) {
      leagueTeams.set(teamKey, {
        teamName,
        teamId: leagueInfo.teamId ?? null,
        slug: leagueInfo.slug ?? null,
        home: [],
        away: [],
        maxTs: 0,
      });
    }

    const teamEntry = leagueTeams.get(teamKey);
    teamEntry[role] = matches;
    const peakTs = matches[0]?.timestamp ?? 0;
    teamEntry.maxTs = Math.max(teamEntry.maxTs, peakTs);
    if (!teamEntry.teamName && teamName) {
      teamEntry.teamName = teamName;
    }
  }

  return leagues;
}

function logLeagues(leagues, teamFilter) {
  if (leagues.size === 0) {
    console.log("Inga matcher att visa.");
    return;
  }

  const sortedLeagues = Array.from(leagues.entries()).sort(([a], [b]) =>
    a.localeCompare(b, "sv", { sensitivity: "base" })
  );

  let printedAnyLeague = false;

  for (const [leagueName, teamsMap] of sortedLeagues) {
    const teamsSorted = Array.from(teamsMap.values())
      .filter((team) => matchesTeamFilter(team, teamFilter))
      .sort((a, b) => (b.maxTs || 0) - (a.maxTs || 0));

    if (teamsSorted.length === 0) {
      continue;
    }

    printedAnyLeague = true;
    console.log(`\n=== ${leagueName} ===`);

    for (const team of teamsSorted) {
      console.log(
        `  ${team.teamName}${team.teamId ? ` (ID: ${team.teamId})` : ""}`
      );

      if (team.home.length > 0) {
        console.log("    Hemma:");
        team.home.forEach((match) => {
          const displayDate = match.date ?? "okänt datum";
          const opponent = match.opponent ?? "okänd motståndare";
          const matchIdLabel = match.matchId ? `, matchId: ${match.matchId}` : "";
          console.log(
            `      - ${displayDate} vs ${opponent}${matchIdLabel} (ts: ${match.timestamp})`
          );
        });
      } else {
        console.log("    Hemma: ingen data");
      }

      if (team.away.length > 0) {
        console.log("    Borta:");
        team.away.forEach((match) => {
          const displayDate = match.date ?? "okänt datum";
          const opponent = match.opponent ?? "okänd motståndare";
          const matchIdLabel = match.matchId ? `, matchId: ${match.matchId}` : "";
          console.log(
            `      - ${displayDate} vs ${opponent}${matchIdLabel} (ts: ${match.timestamp})`
          );
        });
      } else {
        console.log("    Borta: ingen data");
      }
    }
  }

  if (!printedAnyLeague) {
    if (teamFilter) {
      console.log(
        `Hittade inga lag som matchar filtret "${teamFilter.raw}".`
      );
    } else {
      console.log("Inga matcher att visa.");
    }
  }
}

async function main() {
  const { limit, leaguesFilter, teamFilter } = parseArgs(process.argv);

  let client;
  try {
    const lookup = await loadLeagueLookup();
    client = await getDbClient();

    const dbName = process.env.MONGODB_DB || "app";
    const collection = client.db(dbName).collection("teamstats");

    console.log(
      `Hämtar teamstats från databasen (senaste ${limit} matcher per hemmaborta-roll).`
    );
    const docs = await collection
      .find({}, { projection: { full: 1, _importMeta: 1 } })
      .toArray();

    console.log(`Hittade ${docs.length} dokument. Bearbetar...`);

    const leagues = collectMatches(docs, lookup, limit, leaguesFilter);
    logLeagues(leagues, teamFilter);
  } catch (err) {
    console.error(`Fel: ${err?.message || err}`);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();
