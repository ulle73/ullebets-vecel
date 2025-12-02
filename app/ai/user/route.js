import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { dates } = await request.json();

    if (!Array.isArray(dates) || dates.length === 0) {
      return NextResponse.json({
        error: "dates array is required"
      }, { status: 400 });
    }

    if (dates.length > 5) {
      return NextResponse.json({
        error: "Maximum 5 dates allowed"
      }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const results = [];

    console.log(`[AI User] Processing ${dates.length} dates:`, dates);

    for (const date of dates) {
      console.log(`[AI User] Processing date: ${date}`);

      try {
        const response = await fetch(`${origin}/api/ai/generate-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ date }),
        });

        if (!response.ok) {
          const error = await response.json();
          console.error(`[AI User] Failed for date ${date}:`, error);
          results.push({
            date,
            success: false,
            error: error.error || `HTTP ${response.status}`
          });
          continue;
        }

        const result = await response.json();
        console.log(`[AI User] Success for date ${date}: ${result.totalBetsSaved} bets saved`);
        results.push({
          date,
          success: true,
          ...result
        });

      } catch (error) {
        console.error(`[AI User] Exception for date ${date}:`, error);
        results.push({
          date,
          success: false,
          error: error.message
        });
      }
    }

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`[AI User] Completed: ${successful.length} successful, ${failed.length} failed`);

    return NextResponse.json({
      success: true,
      message: `Processed ${dates.length} dates: ${successful.length} successful, ${failed.length} failed`,
      results,
      summary: {
        totalDates: dates.length,
        successful: successful.length,
        failed: failed.length,
        totalBetsSaved: successful.reduce((sum, r) => sum + (r.totalBetsSaved || 0), 0)
      }
    });

  } catch (error) {
    console.error("[AI User] Error:", error);
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}