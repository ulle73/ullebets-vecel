import clientPromise from "@/lib/mongo";

export async function GET(_req, { params }) {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  // hämta endast första elementet i full (minimerar payload)
  const doc = await col.findOne(
    { _id: params.id },
    { projection: { _id: 1, full: { $slice: 1 } } }
  );
  if (!doc) return new Response("Not found", { status: 404 });

  const f0 = Array.isArray(doc.full) ? doc.full[0] ?? {} : {};

  const res = {
    matchId: doc._id,
    timestamp: f0.timestamp ?? null,
    homeTeamId: f0.homeTeamId ?? null,
    homeTeamName: f0.homeTeamName ?? null,
    awayTeamId: f0.awayTeamId ?? null,
    awayTeamName: f0.awayTeamName ?? null,
    incidents: f0.incidents ?? [],
    shotmap: f0.shotmap ?? [],
    odds: f0.odds ?? null,
    statistics: f0.matchDetails?.statistics ?? [],
  };

  return new Response(JSON.stringify(res), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
