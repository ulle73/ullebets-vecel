import clientPromise from "@/lib/mongo";

export async function GET() {
  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || "app";
  const db = client.db(dbName);

  const col = db.collection("teamstats");
  const total = await col.estimatedDocumentCount();   // snabb count utan filter
  const one = await col.findOne({}, { projection: { _id: 1 } });

  // lista kollektioner (för att upptäcka fel db)
  const cols = (await db.listCollections().toArray()).map(c => c.name);

  return new Response(
    JSON.stringify({
      dbName,
      collections: cols,
      teamstatsEstimatedCount: total,
      sampleId: one?._id ?? null,
    }),
    { headers: { "content-type": "application/json" } }
  );
}
