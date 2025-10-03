import clientPromise from "@/lib/mongo";

export async function GET(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id"); // matchId/_id
  if (!id) return new Response("Missing ?id=", { status: 400 });

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const col = db.collection("teamstats");

  const doc = await col.findOne({ _id: id });
  if (!doc) return new Response("Not found", { status: 404 });

  const f0 = Array.isArray(doc.full) ? doc.full[0] : null;

  return new Response(JSON.stringify({
    hasFullArray: Array.isArray(doc.full),
    topLevelKeys: Object.keys(doc),
    full0Keys: f0 ? Object.keys(f0) : [],
    sampleFull0: f0,  // hjälper oss se exakta fältnamn/path
  }, null, 2), { headers: { "content-type": "application/json" }});
}
