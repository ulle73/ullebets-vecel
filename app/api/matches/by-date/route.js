import { getMatchesForDate } from "@/lib/repos/fixtures";
export const runtime = "nodejs";


export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date) return new Response("Missing date", { status: 400 });

    // const items = await getMatchesForDate(date);
    
   
    
    const items = await getMatchesForDate(date);
    
     console.log(
       Array.isArray(items),
       items[0]?.constructor?.name,
       typeof items[0]?.id
     );
     
    return Response.json({ date, items: JSON.parse(JSON.stringify(items)) });


    // return Response.json({ date, items });
  } catch (e) {
    console.error("by-date error:", e);
    return new Response("Server error", { status: 500 });
  }
}
