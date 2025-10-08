import { getMatchesForDate } from "@/lib/repos/fixtures";

export const runtime = "nodejs";

const MATCHES_CACHE_HEADER =
  "public, s-maxage=86400, stale-while-revalidate=86400";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date) return new Response("Missing date", { status: 400 });

    const items = await getMatchesForDate(date);

    return Response.json(
      { date, items: JSON.parse(JSON.stringify(items)) },
      {
        headers: {
          "cache-control": MATCHES_CACHE_HEADER,
        },
      }
    );
  } catch (e) {
    console.error("by-date error:", e);
    return new Response("Server error", { status: 500 });
  }
}
