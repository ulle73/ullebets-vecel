const UNIBET_API_BASE =
  "https://eu1.offering-api.kambicdn.com/offering/v2018/ubse/betoffer/event";

function toDecimalOdds(outcome) {
  if (outcome == null) return null;
  const direct = Number.parseFloat(outcome);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const oddsValue = Number.parseFloat(outcome?.odds);
  if (Number.isFinite(oddsValue)) {
    return oddsValue;
  }
  const decimalOdds = Number.parseFloat(outcome?.odds?.decimal);
  if (Number.isFinite(decimalOdds)) {
    return decimalOdds;
  }
  const nestedDecimal = Number.parseFloat(outcome?.decimal);
  if (Number.isFinite(nestedDecimal)) {
    return nestedDecimal;
  }
  const priceOdds = Number.parseFloat(outcome?.price);
  if (Number.isFinite(priceOdds)) {
    return priceOdds;
  }
  const fractional = outcome?.oddsFractional ?? outcome?.odds?.fractional;
  if (typeof fractional === "string" && fractional.includes("/")) {
    const [num, denom] = fractional.split("/").map((value) => Number.parseFloat(value));
    if (Number.isFinite(num) && Number.isFinite(denom) && denom !== 0) {
      return num / denom + 1;
    }
  }
  return null;
}

function toLineValue(outcome) {
  if (!outcome) return null;
  const rawLine = outcome.line ?? outcome.handicap;
  if (typeof rawLine === "number") {
    if (rawLine >= 1000 || rawLine <= -1000) {
      return rawLine / 1000;
    }
    return rawLine;
  }
  if (typeof rawLine === "string" && rawLine.trim()) {
    const parsed = Number.parseFloat(rawLine.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeOutcome(outcome) {
  if (!outcome) return null;
  const line = toLineValue(outcome);
  const decimalOdds = toDecimalOdds(outcome);
  if (decimalOdds == null) return null;
  const baseLabel = outcome.englishLabel ?? outcome.label ?? outcome.outcome ?? "";
  const normalizedLine = line != null ? Number(line.toFixed(3)) : null;
  const labelIncludesLine =
    normalizedLine != null &&
    baseLabel &&
    new RegExp(`${normalizedLine}`.replace(".", "\\.")).test(baseLabel);
  const label =
    normalizedLine != null && baseLabel && !labelIncludesLine
      ? `${baseLabel} ${normalizedLine}`
      : baseLabel;

  return {
    label: label?.trim() ?? "",
    participant: outcome.participant ?? null,
    line: normalizedLine,
    handicap: normalizedLine,
    englishLabel: outcome.englishLabel ?? null,
    oddsFractional: outcome.oddsFractional ?? outcome.odds?.fractional ?? null,
    decimal: decimalOdds,
    odds: {
      decimal: decimalOdds,
      fractional: outcome.oddsFractional ?? outcome.odds?.fractional ?? null,
    },
  };
}

function mapBetOffersToMarkets(betOffers = []) {
  return betOffers
    .map((offer) => {
      if (!offer) return null;
      const name = offer.criterion?.label ?? offer.label ?? offer.name ?? "";
      const outcomes = (offer.outcomes ?? [])
        .map((outcome) => normalizeOutcome(outcome))
        .filter(Boolean);
      if (!name || outcomes.length === 0) {
        return null;
      }
      return {
        id: offer.id ?? null,
        name,
        outcomes,
      };
    })
    .filter(Boolean);
}

export async function fetchUnibetOdds(matchId) {
  if (!matchId) {
    throw new Error("Match-id saknas.");
  }
  const trimmedId = String(matchId).trim();
  if (!/^\d+$/.test(trimmedId)) {
    throw new Error("Ogiltigt match-id.");
  }

  const url =
    `${UNIBET_API_BASE}/${trimmedId}.json` +
    "?lang=sv_SE&market=SE&client_id=2&channel_id=1&includeParticipants=true";

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { "accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Unibet API svarade med status ${response.status}`);
  }

  const data = await response.json();
  const event = data?.events?.[0] ?? {};

  return {
    meta: {
      homeTeam: event.homeName ?? "",
      awayTeam: event.awayName ?? "",
      eventDate: event.start ?? "",
    },
    odds: mapBetOffersToMarkets(data?.betOffers ?? []),
  };
}
