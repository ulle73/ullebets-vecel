import { getMatchesForDate } from "@/lib/repos/fixtures";

export const runtime = "nodejs";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=900";

function extractMatchId(match) {
  const candidates = [
    match?.matchId,
    match?.id,
    match?.event?.id,
    match?.event?.matchId,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date || !DATE_REGEX.test(date)) {
      return new Response("Missing or invalid date (YYYY-MM-DD)", {
        status: 400,
      });
    }

    const matches = await getMatchesForDate(date);
    const ids = [];
    const seen = new Set();

    for (const match of matches) {
      const id = extractMatchId(match);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    return Response.json(
      { date, ids },
      {
        headers: {
          "cache-control": CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error("[api/matches/ids] GET error", error);
    return new Response("Server error", { status: 500 });
  }
}
