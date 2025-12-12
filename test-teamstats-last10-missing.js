// Hämtar lag från collection "leages-and-teams" och räknar alla matcher i
// collection "teamstats" som saknar incidents eller shotmap (separat hemma/borta).
import { clientPromise } from "./lib/db.js";

const DB_NAME = process.env.MONGODB_DB || "app";
const TEAMS_COL = "leages-and-teams"; // stavning enligt instruktion
const TEAMSTATS_COL = "teamstats";
const LOOKBACK = Number.parseInt(process.env.TEAMSTATS_LOOKBACK ?? "10", 10);
const TOP_N = Number.parseInt(process.env.TEAMSTATS_TOP ?? "10", 10);

// ===== Helpers =====
const toKey = (v) => {
  if (v === null || v === undefined) return null;
  if (Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
};

const arrifyShotmap = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.shotmap)) return v.shotmap; // { shotmap: [...] }
  if (Array.isArray(v.shots)) return v.shots; // { shots: [...] }
  if (Array.isArray(v.data)) return v.data; // fallback
  return [];
};

const extractShotmap = (match) => {
  const candidates = [match?.shotmap, match?.matchDetails?.shotmap];
  for (const c of candidates) {
    const arr = arrifyShotmap(c);
    if (arr.length) return arr;
  }
  return [];
};

const extractIncidents = (match) => {
  const candidates = [match?.incidents, match?.matchDetails?.incidents];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (Array.isArray(c?.incidents)) return c.incidents;
    if (Array.isArray(c?.data)) return c.data;
  }
  return [];
};

const fmtList = (arr) => (arr.length ? arr.join(", ") : "inga");

const getTimestamp = (match) => {
  if (Number.isFinite(match?.timestamp)) return Number(match.timestamp);
  if (typeof match?.date === "string") {
    const t = Date.parse(match.date);
    if (Number.isFinite(t)) return t;
  }
  if (typeof match?.savedAt === "string") {
    const t = Date.parse(match.savedAt);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

const ensureTeamStats = (stats, team) => {
  if (!stats.has(team.key)) {
    stats.set(team.key, {
      id: team.key,
      name: team.name,
      leagues: new Set(team.leagues || []),
      homeMatches: [], // { matchId, ts, hasInc, hasShot }
      awayMatches: [],
    });
  }
  return stats.get(team.key);
};

async function loadTeams(db) {
  const docs = await db.collection(TEAMS_COL).find({}).toArray();
  const teams = new Map(); // key -> { key, name, leagues }

  for (const doc of docs) {
    for (const [leagueName, leagueObj] of Object.entries(doc)) {
      if (leagueName === "_id") continue;
      const teamsArr = Array.isArray(leagueObj?.teams) ? leagueObj.teams : [];
      for (const team of teamsArr) {
        const key = toKey(team?.id);
        if (!key) continue;
        const existing = teams.get(key) || {
          key,
          name: team?.name || `team-${key}`,
          leagues: new Set(),
        };
        existing.name = existing.name || team?.name || `team-${key}`;
        existing.leagues.add(leagueName);
        teams.set(key, existing);
      }
    }
  }

  return teams;
}

async function main() {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  const teams = await loadTeams(db);
  if (teams.size === 0) {
    console.error("Inga lag hittades i 'leages-and-teams'.");
    process.exit(1);
  }

  const stats = new Map(); // key -> stats
  // Förifyll så att alla lag loggas även om de inte har matcher i teamstats.
  teams.forEach((team) => {
    ensureTeamStats(stats, team);
  });

  let matchCount = 0;
  const cursor = db.collection(TEAMSTATS_COL).find(
    {},
    {
      projection: { full: 1 }, // vi behöver alla matcher i dokumentet
    }
  );

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const matches = Array.isArray(doc?.full) ? doc.full : [];
    for (const match of matches) {
      matchCount += 1;
      const matchId = match?.matchId
        ? String(match.matchId)
        : String(doc?._id ?? "unknown");
      const homeId = toKey(match?.homeTeamId);
      const awayId = toKey(match?.awayTeamId);
      const incidents = extractIncidents(match);
      const shotmap = extractShotmap(match);
      const ts = getTimestamp(match);

      if (homeId && teams.has(homeId)) {
        const team = teams.get(homeId);
        const stat = ensureTeamStats(stats, team);
        stat.homeMatches.push({
          matchId,
          ts,
          hasInc: incidents.length > 0,
          hasShot: shotmap.length > 0,
        });
      }

      if (awayId && teams.has(awayId)) {
        const team = teams.get(awayId);
        const stat = ensureTeamStats(stats, team);
        stat.awayMatches.push({
          matchId,
          ts,
          hasInc: incidents.length > 0,
          hasShot: shotmap.length > 0,
        });
      }
    }
  }

  const sorted = Array.from(stats.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "sv")
  );

  console.log(
    `Laddade ${teams.size} lag från '${TEAMS_COL}'. Processade ${matchCount} matcher från '${TEAMSTATS_COL}'.`
  );

  const summarizeSide = (matches) => {
    const ordered = [...matches].sort((a, b) => b.ts - a.ts);
    const slice = ordered.slice(0, LOOKBACK);
    const total = slice.length;
    const missingInc = slice.filter((m) => !m.hasInc).map((m) => m.matchId);
    const missingShot = slice.filter((m) => !m.hasShot).map((m) => m.matchId);
    return { total, missingInc, missingShot };
  };

  const summary = [];

  sorted.forEach((team) => {
    const home = summarizeSide(team.homeMatches);
    const away = summarizeSide(team.awayMatches);

    summary.push({
      name: team.name,
      missingInc: home.missingInc.length + away.missingInc.length,
      missingShot: home.missingShot.length + away.missingShot.length,
      totalMissing:
        home.missingInc.length +
        away.missingInc.length +
        home.missingShot.length +
        away.missingShot.length,
    });

    console.log(
      `${team.name} hemma: ${home.missingInc.length}/${home.total} saknar incidents (${fmtList(
        home.missingInc
      )}), ${home.missingShot.length}/${home.total} saknar shotmap (${fmtList(
        home.missingShot
      )})`
    );

    console.log(
      `${team.name} borta: ${away.missingInc.length}/${away.total} saknar incidents (${fmtList(
        away.missingInc
      )}), ${away.missingShot.length}/${away.total} saknar shotmap (${fmtList(
        away.missingShot
      )})`
    );
  });

  const top = summary
    .filter((s) => s.totalMissing > 0)
    .sort(
      (a, b) =>
        b.totalMissing - a.totalMissing ||
        b.missingInc - a.missingInc ||
        b.missingShot - a.missingShot ||
        a.name.localeCompare(b.name, "sv")
    )
    .slice(0, Math.max(1, TOP_N));

  if (top.length) {
    console.log(
      `\nTop ${top.length} lag med flest saknade (senaste ${LOOKBACK} matcher per sida):`
    );
    top.forEach((t, idx) => {
      console.log(
        `${idx + 1}. ${t.name}: totalt ${t.totalMissing} (incidents ${t.missingInc}, shotmap ${t.missingShot})`
      );
    });
  } else {
    console.log("\nAlla lag har incidents och shotmap i de senaste matcherna.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fel vid körning:", err);
  process.exit(1);
});
