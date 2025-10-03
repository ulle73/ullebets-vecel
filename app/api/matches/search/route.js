import clientPromise from "@/lib/mongo";

const toIntOpt = (v) => (v === null || v === "" ? undefined : Number(v));

export async function GET(req) {
  const url = new URL(req.url);
  const homeTeamId = toIntOpt(url.searchParams.get("homeTeamId"));
  const awayTeamId = toIntOpt(url.searchParams.get("awayTeamId"));
  const incidentType = url.searchParams.get("incidentType") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

  // Filter sker fortfarande i Mongo (snabbt)
  const filter = {};
  if (homeTeamId !== undefined) filter["full.0.homeTeamId"] = homeTeamId;
  if (awayTeamId !== undefined) filter["full.0.awayTeamId"] = awayTeamId;
  if (incidentType) filter["full.0.incidents.incidentType"] = incidentType;

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  const cursor = col
    .find(filter, {
      // Viktigt: projicera första array-elementet korrekt
      projection: { _id: 1, full: { $slice: 1 } },
    })
    .sort({ "full.0.timestamp": -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const [docs, total] = await Promise.all([cursor.toArray(), col.countDocuments(filter)]);

  const items = docs.map((d) => {
    const f0 = Array.isArray(d.full) ? d.full[0] ?? {} : {};
    return {
      matchId: d._id,
      homeTeamId: f0.homeTeamId ?? null,
      homeTeamName: f0.homeTeamName ?? null,
      awayTeamId: f0.awayTeamId ?? null,
      awayTeamName: f0.awayTeamName ?? null,
      timestamp: f0.timestamp ?? null,
    };
  });

  return new Response(JSON.stringify({ page, limit, total, items }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
