import clientPromise from "@/lib/mongo";
import { findTeamstatsMatchSelection } from "@/lib/teamstatsLookup";

const asArray = (v) =>
  Array.isArray(v) ? v :
  (Array.isArray(v?.shots) ? v.shots : []); // om shotmap har form { shots: [...] }

export async function GET(_req, contextPromise) {
  const { params } = await contextPromise;
  const url = new URL(_req.url);
  let matchId =
    params?.id ??
    url.searchParams.get("matchId") ??
    url.searchParams.get("id") ??
    null;

  matchId = matchId != null ? String(matchId).trim() : "";

  if (!matchId) {
    console.warn("[api/match/[id]] missing matchId", {
      params,
      url: _req.url,
    });
    // Treat missing ids as not found so clients relying on 404 semantics (e.g. SWR allow404)
    // don't break the UI with hard errors.
    return new Response(
      JSON.stringify({ message: "Missing id" }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const selection = await findTeamstatsMatchSelection(db, matchId);
  if (!selection?.match) return new Response("Not found", { status: 404 });

  const f0 = selection.match;

  const incidents = Array.isArray(f0.incidents) ? f0.incidents : [];
  const shotmap = asArray(f0.shotmap);
  const odds = (f0.odds && typeof f0.odds === "object") ? f0.odds : null;
  const statistics = Array.isArray(f0.matchDetails?.statistics)
    ? f0.matchDetails.statistics
    : Array.isArray(f0.statistics)
      ? f0.statistics
      : [];

  const toScore = (value) => {
    if (value && typeof value === "object") {
      for (const key of ["current", "display", "total", "normaltime", "normalTime", "regular", "fullTime", "value"]) {
        const resolved = toScore(value[key]);
        if (resolved != null) return resolved;
      }
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const finalFromIncidents = (() => {
    for (let i = incidents.length - 1; i >= 0; i -= 1) {
      const entry = incidents[i];
      if (!entry || typeof entry !== "object") continue;
      const home =
        toScore(entry.homeScore ?? entry?.score?.home ?? entry?.scoreHome ?? entry?.result?.home);
      const away =
        toScore(entry.awayScore ?? entry?.score?.away ?? entry?.scoreAway ?? entry?.result?.away);
      if (home != null && away != null) {
        return { home, away };
      }
    }
    return null;
  })();

  const homeScore =
    toScore(f0.homeScore) ?? (finalFromIncidents ? finalFromIncidents.home : null);
  const awayScore =
    toScore(f0.awayScore) ?? (finalFromIncidents ? finalFromIncidents.away : null);

  const res = {
    matchId: f0.matchId ?? f0.id ?? matchId,
    timestamp: f0.timestamp ?? f0.startTimestamp ?? null,
    homeTeamId: f0.homeTeamId ?? null,
    homeTeamName: f0.homeTeamName ?? f0.homeTeam?.name ?? null,
    awayTeamId: f0.awayTeamId ?? null,
    awayTeamName: f0.awayTeamName ?? f0.awayTeam?.name ?? null,
    incidents,
    shotmap,
    odds,
    statistics,
    homeScore,
    awayScore,
  };

  return new Response(JSON.stringify(res), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
