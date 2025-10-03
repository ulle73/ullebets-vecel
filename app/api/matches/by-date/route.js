import { getMatchesForDate } from "@/lib/repos/fixtures";

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date) return new Response("Missing date", { status: 400 });

    const items = await getMatchesForDate(date);
    return Response.json({ date, items });
  } catch (e) {
    console.error("by-date error:", e);
    return new Response("Server error", { status: 500 });
  }
}
