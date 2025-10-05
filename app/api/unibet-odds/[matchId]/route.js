import { NextResponse } from "next/server";

const UNIBET_BASE_URL =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

const FRACTIONAL_SEPARATOR = "/";

const toDecimalOdds = (fractional) => {
  if (!fractional || typeof fractional !== "string") return null;
  const [numerator, denominator] = fractional
    .split(FRACTIONAL_SEPARATOR)
    .map(Number);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return (numerator / denominator + 1).toFixed(2);
};

export async function GET(_request, { params }) {
  const matchId = params?.matchId;
  if (!matchId) {
    return NextResponse.json({ error: "Missing matchId" }, { status: 400 });
  }

  const url = `${UNIBET_BASE_URL}/${encodeURIComponent(
    matchId
  )}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;

  try {
    const response = await fetch(url, { next: { revalidate: 0 } });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch odds" },
        { status: response.status }
      );
    }

    const data = await response.json();
    if (
      !data?.betOffers ||
      !Array.isArray(data.betOffers) ||
      !data?.events ||
      !data.events.length
    ) {
      return NextResponse.json({ error: "No odds available" }, { status: 404 });
    }

    const event = data.events[0] ?? {};
    const meta = {
      homeTeam: event.homeName ?? "",
      awayTeam: event.awayName ?? "",
      eventDate: event.start ?? "",
    };

    const odds = {};
    for (const offer of data.betOffers) {
      const label = offer?.criterion?.label;
      if (!label) continue;

      if (!odds[label]) {
        odds[label] = { outcomes: [] };
      }

      for (const outcome of offer?.outcomes ?? []) {
        const participant = outcome?.participant ?? "N/A";
        const line =
          typeof outcome?.line === "number"
            ? (outcome.line / 1000).toFixed(3)
            : "x";
        const decimalValue =
          typeof outcome?.odds?.decimal === "number"
            ? outcome.odds.decimal
            : null;
        const decimalOdds =
          decimalValue != null
            ? decimalValue.toFixed(2)
            : toDecimalOdds(outcome?.oddsFractional);

        odds[label].outcomes.push({
          participant,
          label: outcome?.englishLabel ?? "",
          line,
          odds: decimalOdds ?? "N/A",
        });
      }
    }

    return NextResponse.json({ meta, odds });
  } catch (error) {
    console.error("Failed to fetch Unibet odds", error);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
