
"use client";

import { splitMatchLabel } from "@/lib/utils/matchups";

function normalizeMatchName(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    const candidate =
      value?.name ??
      value?.teamName ??
      value?.label ??
      value?.text ??
      value?.shortName ??
      null;
    if (candidate) {
      return String(candidate).trim();
    }
  }
  return null;
}

function resolveLeagueName(match, fallback) {
  return (
    normalizeMatchName(match?.leagueName) ||
    normalizeMatchName(match?.tournament?.name) ||
    normalizeMatchName(match?.league?.name) ||
    fallback ||
    null
  );
}

function resolveTeamNames(match, matchLabel) {
  const homeTeam =
    normalizeMatchName(match?.homeTeamName) ||
    normalizeMatchName(match?.homeTeam) ||
    normalizeMatchName(match?.home?.name);
  const awayTeam =
    normalizeMatchName(match?.awayTeamName) ||
    normalizeMatchName(match?.awayTeam) ||
    normalizeMatchName(match?.away?.name);

  if (homeTeam && awayTeam) {
    return { homeTeam, awayTeam };
  }

  if (matchLabel) {
    const parsed = splitMatchLabel(matchLabel);
    return {
      homeTeam: homeTeam || parsed.home,
      awayTeam: awayTeam || parsed.away,
    };
  }

  return {
    homeTeam: homeTeam || "Hemmalaget",
    awayTeam: awayTeam || "Bortalaget",
  };
}

export function buildAutoPayload(match) {
  if (!match) {
    throw new Error("Match information missing for auto-unibet payload.");
  }
  const payload = {
    action: "auto-unibet-odds",
    matchId: normalizeMatchName(match.matchId ?? match.id),
    eventId:
      match.eventId ??
      match.raw?.eventId ??
      match.raw?.event?.id ??
      match.event?.id ??
      null,
    homeTeam:
      normalizeMatchName(match.homeTeamName) ??
      normalizeMatchName(match.home?.name) ??
      normalizeMatchName(match.homeTeam?.name) ??
      normalizeMatchName(match.homeTeam),
    awayTeam:
      normalizeMatchName(match.awayTeamName) ??
      normalizeMatchName(match.away?.name) ??
      normalizeMatchName(match.awayTeam?.name) ??
      normalizeMatchName(match.awayTeam),
    leagueName: resolveLeagueName(match, normalizeMatchName(match.leagueName)),
    timestamp:
      match.timestamp ??
      match.startTimestamp ??
      match.raw?.startTimestamp ??
      match.raw?.event?.startTimestamp ??
      null,
    start: match.start ?? match.raw?.event?.start ?? null,
  };

  if (!payload.homeTeam || !payload.awayTeam) {
    const fallback = resolveTeamNames(match, match.matchLabel || match.raw?.label);
    payload.homeTeam = payload.homeTeam || fallback.homeTeam;
    payload.awayTeam = payload.awayTeam || fallback.awayTeam;
  }

  return payload;
}

export function buildExpectedValuePayload({
  match,
  tuple,
  direction,
  odds,
  fallbackLabel,
  scope,
  period,
}) {
  const { homeTeam, awayTeam } = resolveTeamNames(match, fallbackLabel);
  return {
    action: "expected-value",
    homeTeam,
    awayTeam,
    over: direction === "over",
    line: tuple.line,
    scope: scope ?? tuple.scope ?? "total",
    stat: tuple.statKey,
    period: period ?? tuple.period ?? "ALL",
    form: "all",
    odds,
    neutralGround: false,
    home_importance: 5,
    away_importance: 5,
  };
}

export async function postBacktest(body, options = {}) {
  const { signal } = options;
  const res = await fetch("/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = payload?.message || `${res.status}`;
    throw new Error(message);
  }
  return res.json();
}
