import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { DateTime } from "luxon";
import { MongoClient } from "mongodb";
import mapUnibetOdds from "../components/backtest/unibetOddsMapper.js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "app";
const RESULTS_COLLECTION = "ai-generated-bets";
const SOURCE = "ai-user";

function todaySE() {
  return DateTime.now().setZone("Europe/Stockholm").toFormat("yyyy-MM-dd");
}

function normalizeStringId(value) {
  if (value == null) return null;
  return String(value);
}

function buildLineKey(line = {}) {
  const parts = [
    normalizeStringId(line.matchId),
    line.statKey ?? "",
    line.period ?? "ALL",
    line.scope ?? "total",
    line.direction ?? "over",
  ];
  return parts.join("|");
}

function buildLineKeyFromRow(row = {}) {
  const direction = (row.condition ?? row.direction ?? "")
    .toString()
    .toLowerCase()
    .startsWith("u")
    ? "under"
    : "over";
  return buildLineKey({
    matchId: row.matchId,
    statKey: row.statKey ?? row.statLabel,
    period: row.period,
    scope: row.scope,
    direction,
  });
}

function pickPrimaryEv(result) {
  if (typeof result?.evPctUniversalOptimized === "number") return result.evPctUniversalOptimized;
  if (typeof result?.evPctMultifactor === "number") return result.evPctMultifactor;
  if (typeof result?.evPct === "number") return result.evPct;
  return null;
}

function canAddLineToCombo(currentLines = [], candidate) {
  if (!candidate) return false;
  const candidateMatch = normalizeStringId(candidate.matchId);
  const candidateStat = candidate.statKey ?? candidate.statLabel ?? "";
  const candidateScope = candidate.scope ?? "total";
  const candidatePeriod = candidate.period ?? "ALL";
  const candidateDir = (candidate.direction ?? "over").toLowerCase();

  for (const existing of currentLines) {
    const existingMatch = normalizeStringId(existing.matchId);
    const existingStat = existing.statKey ?? existing.statLabel ?? "";
    const existingScope = existing.scope ?? "total";
    const existingPeriod = existing.period ?? "ALL";
    const existingDir = (existing.direction ?? "over").toLowerCase();

    const sameCore =
      candidateMatch &&
      existingMatch &&
      candidateMatch === existingMatch &&
      existingStat === candidateStat &&
      existingScope === candidateScope &&
      existingPeriod === candidatePeriod;

    // No duplicate of same core+direction
    if (sameCore && existingDir === candidateDir) return false;
    // No opposite directions on same core
    if (sameCore && existingDir !== candidateDir) return false;
  }
  return true;
}

function settleNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function makeLineId(line) {
  if (!line) return null;
  if (line.betKey) return line.betKey;
  const parts = [line.matchId, line.statKey, line.direction, line.line];
  return parts.filter(Boolean).join(":");
}

function buildCombos(lines = [], options = {}) {
  const {
    legs = 2,
    minOdds = 1.8,
    maxOdds = 2.2,
    maxLines = 32,
    maxCombos = 14,
    priorityMap = {},
  } = options;

  const sanitizedLegs = Math.max(1, Math.min(Number(legs) || 2, 4));
  const sanitizedMinOdds = Math.max(1, settleNumber(minOdds, 1.8));
  const sanitizedMaxOdds = Math.max(sanitizedMinOdds, settleNumber(maxOdds, sanitizedMinOdds));

  const validLines = [...lines]
    .filter((line) => line && line.odds && line.odds > 1)
    .map((line) => ({
      ...line,
      primaryEv: settleNumber(line.primaryEv, 0),
      odds: settleNumber(line.odds, 1),
      priority: priorityMap[buildLineKey(line)] ?? 0,
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if ((b.primaryEv ?? 0) !== (a.primaryEv ?? 0)) {
        return (b.primaryEv ?? 0) - (a.primaryEv ?? 0);
      }
      return (b.odds ?? 0) - (a.odds ?? 0);
    })
    .slice(0, Math.max(1, maxLines));

  if (!validLines.length) return [];

  const combos = [];
  const seen = new Set();
  const legsTarget = sanitizedLegs === 1 ? 1 : Math.min(sanitizedLegs, validLines.length);

  function recordCombo(candidateLines, totalOdds, totalEv) {
    const key = candidateLines.map((line) => makeLineId(line)).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({
      id: key,
      lines: [...candidateLines],
      odds: Number(totalOdds.toFixed(2)),
      totalEv: Number(totalEv.toFixed(2)),
    });
  }

  function walk(start, currentLines, currentOdds, currentEv) {
    if (currentLines.length === legsTarget) {
      if (currentOdds >= sanitizedMinOdds && currentOdds <= sanitizedMaxOdds) {
        recordCombo(currentLines, currentOdds, currentEv);
      }
      return;
    }

    for (let i = start; i < validLines.length; i += 1) {
      if (combos.length >= maxCombos) break;
      const candidate = validLines[i];
      const nextOdds = currentOdds * (candidate.odds || 1);
      if (nextOdds > sanitizedMaxOdds * 1.25) continue;
      if (!canAddLineToCombo(currentLines, candidate)) continue;
      currentLines.push(candidate);
      walk(i + 1, currentLines, nextOdds, currentEv + (candidate.primaryEv || 0));
      currentLines.pop();
    }
  }

  if (legsTarget === 1) {
    validLines.forEach((line) => {
      if (!canAddLineToCombo([], line)) return;
      const totalOdds = line.odds;
      if (totalOdds >= sanitizedMinOdds && totalOdds <= sanitizedMaxOdds) {
        recordCombo([line], totalOdds, line.primaryEv || 0);
      }
    });
  } else {
    walk(0, [], 1, 0);
  }

  combos.sort((a, b) => b.totalEv - a.totalEv);
  return combos.slice(0, maxCombos);
}

function buildBetKey({
  homeTeam,
  awayTeam,
  stat,
  scope,
  period,
  line,
  over,
  form,
  neutralGround,
  matchId,
}) {
  const parts = [
    normalizeStringId(matchId) ?? "",
    String(homeTeam || "").toLowerCase().trim(),
    String(awayTeam || "").toLowerCase().trim(),
    stat ?? "",
    scope ?? "total",
    period ?? "ALL",
    over ? "over" : "under",
    Number(line),
    form ?? "",
    neutralGround ? "N" : "H",
  ];
  return parts.join("|");
}
async function run() {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const dateStr = dateArg ? dateArg.replace("--date=", "") : todaySE();

  console.log(`[AI User Combos v2] START for ${dateStr}`);
  console.log(`[AI User Combos v2] BASE_URL: ${BASE_URL}`);

  const { matches, matchLookup } = await step1FetchMatches(dateStr);
  const matchups = await step2FetchMatchups(dateStr);
  await step3AutoUnibet(dateStr, { matches, matchLookup, matchups });
}

run().catch((err) => {
  console.error("[AI User Combos v2] Fatal error:", err);
  process.exit(1);
});

// Step 2: hämta matchups-score (över/under) och matchups-league-avg, logga storlekar
async function step2FetchMatchups(dateStr) {
  console.log(`[AI User Combos v2] Step2 start (matchups) for ${dateStr}`);

  // matchups-score
  const matchupsScoreRes = await fetch(
    `${BASE_URL}/api/matchups-score?date=${encodeURIComponent(dateStr)}`
  );
  if (!matchupsScoreRes.ok) {
    const text = await matchupsScoreRes.text().catch(() => "");
    throw new Error(`Failed to fetch matchups-score: ${matchupsScoreRes.status} ${text}`);
  }
  const matchupsScore = await matchupsScoreRes.json();
  const overRows = matchupsScore.topOverRows || matchupsScore.top50?.over || [];
  const underRows = matchupsScore.topUnderRows || matchupsScore.top50?.under || [];
  console.log(
    `[AI User Combos v2] matchups-score: over=${overRows.length} under=${underRows.length} uniqueMatchIds=${new Set([...overRows, ...underRows].map((r) => r.matchId)).size}`
  );

  // matchups-league-avg
  const matchupsLeagueRes = await fetch(
    `${BASE_URL}/api/matchups-league-avg?date=${encodeURIComponent(dateStr)}`
  );
  if (!matchupsLeagueRes.ok) {
    const text = await matchupsLeagueRes.text().catch(() => "");
    console.warn(
      `[AI User Combos v2] matchups-league-avg failed: ${matchupsLeagueRes.status} ${text}`
    );
  } else {
    const matchupsLeague = await matchupsLeagueRes.json();
    const overLg = matchupsLeague.top50?.over || [];
    const underLg = matchupsLeague.top50?.under || [];
    console.log(
    `[AI User Combos v2] matchups-league-avg: over=${overLg.length} under=${underLg.length} uniqueMatchIds=${new Set([...overLg, ...underLg].map((r) => r.matchId)).size}`
    );
  }

  console.log("[AI User Combos v2] Step2 done");

  return {
    overRows,
    underRows,
    scoreRaw: matchupsScore,
    leagueRaw: null, // keep for future if needed
  };
}

// Step 1 helper (kept intact)
async function step1FetchMatches(dateStr) {
  console.log(`[AI User Combos v2] Step1 start for ${dateStr}`);

  const matchesRes = await fetch(`${BASE_URL}/api/matches/by-date?date=${dateStr}`);
  if (!matchesRes.ok) {
    const text = await matchesRes.text().catch(() => "");
    throw new Error(`Failed to fetch matches: ${matchesRes.status} ${text}`);
  }
  const matchesPayload = await matchesRes.json();
  const matches = matchesPayload?.items || [];
  console.log(`[AI User Combos v2] Matches fetched: ${matches.length}`);

  const matchLookup = new Map();

  matches.forEach((m, idx) => {
    const id =
      m.matchId ??
      m.id ??
      m.raw?.matchId ??
      m.raw?.event?.id ??
      m.raw?.event?.matchId ??
      m.eventId ??
      null;
    const league =
      m.leagueName ??
      m.tournament?.name ??
      m.league?.name ??
      m.uniqueTournament?.name ??
      m.raw?.league?.name ??
      m.raw?.tournament?.name;
    const ts =
      m.matchDate ??
      m.timestamp ??
      m.startTimestamp ??
      m.time?.currentPeriodStart ??
      m.raw?.event?.start ??
      m.raw?.start;
    const home = m.homeTeamName ?? m.homeTeam?.name ?? m.raw?.homeTeamName ?? m.raw?.homeTeam?.name;
    const away = m.awayTeamName ?? m.awayTeam?.name ?? m.raw?.awayTeamName ?? m.raw?.awayTeam?.name;
    console.log(
      `[Match ${idx}] id=${id} ${home ?? "?"} vs ${away ?? "?"} league=${league} ts=${ts}`
    );

    if (id) {
      matchLookup.set(String(id), {
        ...m,
        matchId: String(id),
        homeTeamName: home,
        awayTeamName: away,
        leagueName: league,
        matchDate: ts,
      });
    }
  });

  console.log("[AI User Combos v2] Step1 done");
  return { matches, matchLookup };
}

// Step 3: auto-unibet-odds per match from matchups-score selection
async function step3AutoUnibet(dateStr, { matchLookup, matchups }) {
  console.log(`[AI User Combos v2] Step3 start (auto-unibet) for ${dateStr}`);

  const allRows = [...(matchups.overRows || []), ...(matchups.underRows || [])];
  const seen = new Set();
  const targetMatches = [];
  const allBets = [];

  for (const row of allRows) {
    const mid = row?.matchId ? String(row.matchId) : null;
    if (!mid || seen.has(mid)) continue;
    const match = matchLookup.get(mid);
    if (!match) {
      console.warn(`[AI User Combos v2] matchId ${mid} from matchups not found in fixtures`);
      continue;
    }
    seen.add(mid);
    targetMatches.push({ match, row });
  }

  console.log(
    `[AI User Combos v2] Step3 targets: ${targetMatches.length} (unique from matchups-score)`
  );

  let totalTuples = 0;
  let failures = 0;

  for (const { match, row } of targetMatches) {
    const matchId = match.matchId;
    const homeTeam = match.homeTeamName;
    const awayTeam = match.awayTeamName;
    const leagueName = match.leagueName ?? row?.league ?? row?.leagueName ?? null;
    const timestamp = match.matchDate ?? row?.matchDate ?? row?.startTime ?? null;

    console.log(
      `[AI User Combos v2] -> auto-unibet for ${homeTeam} vs ${awayTeam} (id=${matchId}, league=${leagueName}, ts=${timestamp})`
    );

    try {
      const oddsRes = await fetch(`${BASE_URL}/api/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auto-unibet-odds",
          matchId,
          homeTeam,
          awayTeam,
          leagueName,
          timestamp,
          startTime: timestamp,
        }),
      });

      if (!oddsRes.ok) {
        const text = await oddsRes.text().catch(() => "");
        failures += 1;
        console.warn(
          `[AI User Combos v2] auto-unibet FAILED ${homeTeam} vs ${awayTeam}: ${oddsRes.status} ${text}`
        );
        continue;
      }

      const oddsData = await oddsRes.json();
      const tuples = mapUnibetOdds(oddsData.odds, homeTeam, awayTeam);
      totalTuples += tuples.length;
      console.log(
        `[AI User Combos v2] auto-unibet OK ${homeTeam} vs ${awayTeam}: tuples=${tuples.length} eventUrl=${oddsData.eventUrl ?? "n/a"}`
      );

      // Build bets from tuples (over/under)
      tuples.forEach((tuple) => {
        const { statKey, scope, period, line, odds } = tuple;
        if (odds.over && odds.over > 1) {
          allBets.push({
            matchId,
            homeTeam,
            awayTeam,
            over: true,
            line,
            scope,
            stat: statKey,
            period,
            form: "all",
            odds: odds.over,
            neutralGround: false,
            home_importance: 5,
            away_importance: 5,
            leagueName,
          });
        }
        if (odds.under && odds.under > 1) {
          allBets.push({
            matchId,
            homeTeam,
            awayTeam,
            over: false,
            line,
            scope,
            stat: statKey,
            period,
            form: "all",
            odds: odds.under,
            neutralGround: false,
            home_importance: 5,
            away_importance: 5,
            leagueName,
          });
        }
      });
    } catch (err) {
      failures += 1;
      console.warn(
        `[AI User Combos v2] auto-unibet ERROR ${homeTeam} vs ${awayTeam}: ${err.message}`
      );
    }
  }

  console.log(
    `[AI User Combos v2] Step3 done: matches=${targetMatches.length}, failures=${failures}, totalTuples=${totalTuples}, bets=${allBets.length}`
  );

  await step4BatchEV(dateStr, { matchLookup, matchups, bets: allBets });
}

// Step 4: batch expected value, filter +EV, map to lines
async function step4BatchEV(dateStr, { matchLookup, matchups, bets }) {
  console.log(`[AI User Combos v2] Step4 start (batch EV) for ${dateStr}`);

  if (!bets?.length) {
    console.log("[AI User Combos v2] Step4: No bets to process, exit");
    return;
  }

  console.log(`[AI User Combos v2] Step4: sending ${bets.length} bets to batch-expected-value`);

  const res = await fetch(`${BASE_URL}/api/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "batch-expected-value", bets }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`batch-expected-value failed: ${res.status} ${text}`);
  }

  const payload = await res.json();
  const results = Array.isArray(payload) ? payload : payload.results || [];
  console.log(`[AI User Combos v2] Step4: got ${results.length} results`);

  const positive = results.filter(
    (r) =>
      (r.evPct && r.evPct > 0) ||
      (r.evPctMultifactor && r.evPctMultifactor > 0) ||
      (r.evPctUniversalOptimized && r.evPctUniversalOptimized > 0)
  );
  console.log(
    `[AI User Combos v2] Step4: +EV results ${positive.length} (primary EV > 0 across variants)`
  );

  // Build helpers for mapping and filtering
  const allRows = [...(matchups.overRows || []), ...(matchups.underRows || [])];
  const rowByMatchId = new Map();
  const insightKeySet = new Set();
  const priorityMap = {};
  allRows.forEach((row) => {
    const mid = row?.matchId ? String(row.matchId) : null;
    if (mid && !rowByMatchId.has(mid)) {
      rowByMatchId.set(mid, row);
    }
    const key = buildLineKeyFromRow(row);
    if (key) {
      insightKeySet.add(key);
      const score = Number(row.score ?? row.normalizedScore ?? row.sortKey ?? 0);
      if (Number.isFinite(score)) {
        priorityMap[key] = Math.max(priorityMap[key] ?? 0, score);
      }
    }
  });

  const lines = positive.map((r, idx) => {
    const params = r.params || {};
    const direction = params.over ? "over" : "under";
    const fallbackBet = bets[idx];
    const matchId = params.matchId ?? fallbackBet?.matchId ?? null;
    const row = matchId ? rowByMatchId.get(String(matchId)) : null;
    const match = matchId ? matchLookup.get(String(matchId)) : null;

    return {
      betKey: buildBetKey({
        homeTeam: params.home ?? fallbackBet?.homeTeam,
        awayTeam: params.away ?? fallbackBet?.awayTeam,
        stat: params.stat,
        scope: params.scope,
        period: params.period,
        line: params.line,
        over: params.over,
        form: params.form,
        neutralGround: params.neutralGround,
        matchId: matchId,
      }),
      matchId,
      matchLabel:
        (params.home && params.away && `${params.home} vs ${params.away}`) ||
        (row?.match ? row.match : null) ||
        null,
      homeTeamName: params.home ?? fallbackBet?.homeTeam ?? row?.homeTeamName ?? match?.homeTeamName,
      awayTeamName: params.away ?? fallbackBet?.awayTeam ?? row?.awayTeamName ?? match?.awayTeamName,
      leagueName:
        match?.leagueName ??
        row?.league ??
        row?.leagueName ??
        fallbackBet?.leagueName ??
        null,
      statKey: params.stat,
      scope: params.scope ?? "total",
      period: params.period ?? "ALL",
      direction,
      line: params.line,
      odds: params.odds,
      primaryEv: r.evPctUniversalOptimized ?? r.evPctMultifactor ?? r.evPct ?? null,
      evPct: r.evPct ?? null,
      evPctMultifactor: r.evPctMultifactor ?? null,
      evPctUniversalOptimized: r.evPctUniversalOptimized ?? null,
      matchupScore:
        priorityMap[
          buildLineKey({
            matchId,
            statKey: params.stat,
            period: params.period,
            scope: params.scope,
            direction,
          })
        ] ?? null,
    };
  });

  const insightLines = lines.filter((line) => insightKeySet.has(buildLineKey(line)));

  if (!insightLines.length && lines.length) {
    const sample = lines.slice(0, 5).map((l) => {
      const key = buildLineKey(l);
      return {
        key,
        inSet: insightKeySet.has(key),
        matchId: l.matchId,
        statKey: l.statKey,
        dir: l.direction,
        period: l.period,
        scope: l.scope,
        league: l.leagueName,
      };
    });
    const missingMatchId = lines.filter((l) => !l.matchId).length;
    console.warn(
      `[AI User Combos v2] Step4: insight filter yielded 0. Lines total=${lines.length}, missingMatchId=${missingMatchId}. Sample keys:`,
      sample
    );
  }

  console.log(
    "[AI User Combos v2] Step4: preview +EV insight lines (first 10):",
    insightLines.slice(0, 10).map((l) => ({
      matchId: l.matchId,
      matchLabel: l.matchLabel,
      statKey: l.statKey,
      dir: l.direction,
      line: l.line,
      odds: l.odds,
      ev: l.primaryEv,
      league: l.leagueName,
      matchupScore: l.matchupScore,
    }))
  );

  // Build combos with requested limits
  const buildOpts = (legs, maxCombos) => ({
    legs,
    minOdds: 1.01,
    maxOdds: 10,
    maxLines: 500,
    maxCombos,
    priorityMap,
  });

  const singles = buildCombos(insightLines, buildOpts(1, 100));
  const doubles = buildCombos(insightLines, buildOpts(2, 50));
  const triples = buildCombos(insightLines, buildOpts(3, 50));

  const numberedSingles = singles.map((combo, idx) => ({
    ...combo,
    legs: 1,
    comboNumber: idx + 1,
  }));
  const numberedDoubles = doubles.map((combo, idx) => ({
    ...combo,
    legs: 2,
    comboNumber: idx + 1,
  }));
  const numberedTriples = triples.map((combo, idx) => ({
    ...combo,
    legs: 3,
    comboNumber: idx + 1,
  }));

  const allCombos = [...numberedSingles, ...numberedDoubles, ...numberedTriples];

  console.log(
    `[AI User Combos v2] Step4: combos built singles=${numberedSingles.length} doubles=${numberedDoubles.length} triples=${numberedTriples.length}`
  );

  if (!allCombos.length) {
    console.log("[AI User Combos v2] Step4: No combos to save");
    return;
  }

  const docs = allCombos.map((combo) => ({
    ...combo,
    date: dateStr,
    generatedAt: new Date(),
    source: SOURCE,
    lines: combo.lines.map((l) => ({
      betKey: l.betKey ?? makeLineId(l),
      matchId: l.matchId,
      homeTeamName: l.homeTeamName,
      awayTeamName: l.awayTeamName,
      leagueName: l.leagueName,
      statKey: l.statKey,
      scope: l.scope,
      direction: l.direction,
      period: l.period,
      line: l.line,
      odds: l.odds,
      primaryEv: l.primaryEv,
      evPct: l.evPct,
      evPctMultifactor: l.evPctMultifactor,
      evPctUniversalOptimized: l.evPctUniversalOptimized,
      matchupScore: l.matchupScore,
    })),
  }));

  if (!MONGODB_URI) {
    console.log("[AI User Combos v2] No MONGODB_URI, skipping DB save. Preview first combo:", docs[0]);
    return;
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    await db.collection(RESULTS_COLLECTION).insertMany(docs);
    console.log(`[AI User Combos v2] Saved ${docs.length} combos to ${RESULTS_COLLECTION}`);
  } finally {
    await client.close();
  }

  console.log("[AI User Combos v2] Step4 done");
}
