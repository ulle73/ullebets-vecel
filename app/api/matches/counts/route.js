import { clientPromise } from "@/lib/db";

export const runtime = "nodejs";

const CACHE_HEADER = "public, s-maxage=3600, stale-while-revalidate=3600";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (!start || !end) {
      return new Response("Missing start or end date", { status: 400 });
    }

    const client = await clientPromise;
    const col = client.db("app").collection("match-for-date");

    // Fetch documents within the date range
    // _id is the date string "YYYY-MM-DD"
    const cursor = col.find(
      {
        _id: { $gte: start, $lte: end },
      },
      {
        projection: { _id: 1, "full.matches": 1 },
      }
    );

    const docs = await cursor.toArray();
    const result = {};

    for (const doc of docs) {
      const date = doc._id;
      const matches = doc.full?.[0]?.matches;
      const count = Array.isArray(matches) ? matches.length : 0;
      result[date] = count;
    }

    return Response.json(result, {
      headers: {
        "cache-control": CACHE_HEADER,
      },
    });
  } catch (e) {
    console.error("matches/counts error:", e);
    return new Response("Server error", { status: 500 });
  }
}
