import clientPromise from "@/lib/mongo";

export async function GET() {
  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB || "app");
  const result = await db.command({ ping: 1 });
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });
}
