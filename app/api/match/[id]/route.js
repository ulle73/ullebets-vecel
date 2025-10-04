import clientPromise from "@/lib/mongo";

const asArray = (v) =>
  Array.isArray(v) ? v :
  (Array.isArray(v?.shots) ? v.shots : []); // om shotmap har form { shots: [...] }

export async function GET(_req, context) {
  const { params } = context;
  const matchId = params?.id;
  if (!matchId) {
    return new Response("Missing id", { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  const doc = await col.findOne(
    { _id: matchId },
    { projection: { _id: 1, full: { $slice: 1 } } }
  );
  if (!doc) return new Response("Not found", { status: 404 });

  const f0 = Array.isArray(doc.full) ? doc.full[0] ?? {} : {};

  const incidents = Array.isArray(f0.incidents) ? f0.incidents : [];
  const shotmap = asArray(f0.shotmap);
  const odds = (f0.odds && typeof f0.odds === "object") ? f0.odds : null;
  const statistics = Array.isArray(f0.matchDetails?.statistics) ? f0.matchDetails.statistics : [];

  const res = {
    matchId: doc._id,
    timestamp: f0.timestamp ?? null,
    homeTeamId: f0.homeTeamId ?? null,
    homeTeamName: f0.homeTeamName ?? null,
    awayTeamId: f0.awayTeamId ?? null,
    awayTeamName: f0.awayTeamName ?? null,
    incidents,
    shotmap,
    odds,
    statistics,
  };

  return new Response(JSON.stringify(res), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
