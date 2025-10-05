const KAMBI_BASE_URL = "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

function toDecimalOdds(fractional) {
  if (!fractional || typeof fractional !== "string") {
    return "N/A";
  }
  const [numerator, denominator] = fractional.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return "N/A";
  }
  const decimal = numerator / denominator + 1;
  return decimal.toFixed(2);
}

function formatLine(line) {
  if (line == null) {
    return "x";
  }
  const numeric = Number(line);
  if (!Number.isFinite(numeric)) {
    return "x";
  }
  return (numeric / 1000).toFixed(3);
}

export async function fetchUnibetOdds(matchId) {
  if (!matchId) {
    throw new Error("Missing match id");
  }

  const url = `${KAMBI_BASE_URL}/${matchId}.json?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch odds from Unibet (${response.status})`);
  }

  const data = await response.json();

  const eventInfo = {
    homeTeam: data.events?.[0]?.homeName || "",
    awayTeam: data.events?.[0]?.awayName || "",
    eventDate: data.events?.[0]?.start || "",
  };

  if (!Array.isArray(data.betOffers) || data.betOffers.length === 0) {
    return { meta: eventInfo, odds: {} };
  }

  const jsonFile = { meta: eventInfo, odds: {} };

  for (const betOffer of data.betOffers) {
    const label = betOffer?.criterion?.label;
    if (!label) continue;

    if (!jsonFile.odds[label]) {
      jsonFile.odds[label] = { outcomes: [] };
    }

    for (const outcome of betOffer?.outcomes ?? []) {
      const participant = outcome?.participant || "N/A";
      const line = formatLine(outcome?.line);
      const decimalOdds = toDecimalOdds(outcome?.oddsFractional);

      jsonFile.odds[label].outcomes.push({
        participant,
        label: outcome?.englishLabel,
        line,
        odds: decimalOdds,
      });
    }
  }

  return jsonFile;
}
