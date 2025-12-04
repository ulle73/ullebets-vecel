import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORMULAS = ["base", "multiplier", "multifactor", "leagueAvg"];
const ONLY_POSITIVE = true;

const CLI_ARGS = parseArgs(process.argv.slice(2));
const minOdds = CLI_ARGS.min ? Number(CLI_ARGS.min) : null;
const maxOdds = CLI_ARGS.max ? Number(CLI_ARGS.max) : null;
const minEv = CLI_ARGS["min-ev"] ? Number(CLI_ARGS["min-ev"]) : null;
const maxEv = CLI_ARGS["max-ev"] ? Number(CLI_ARGS["max-ev"]) : null;
const statFilter = CLI_ARGS.statKey || null;

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const [key, value] = raw.split("=");
    const normalized = key.replace(/^--/, "");
    if (!value || normalized === key) {
      args[normalized] = true;
      continue;
    }
    args[normalized] = value;
  }
  if (args.range) {
    const [min, max] = args.range.split("-").map(Number);
    if (!Number.isNaN(min)) {
      args.min = min;
    }
    if (!Number.isNaN(max)) {
      args.max = max;
    }
  }
  return args;
}

const backtestsDir = path.join(__dirname, "unibet-backtests");

function clamp(value, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) return min ?? value;
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

function parseTimestampFromFile(file) {
  const name = path.basename(file, ".json");
  const match = name.match(
    /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/
  );
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  const iso = `${date}T${hh}:${mm}:${ss}.${ms}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function computeTimeWeight(timestamp, halfLifeDays = 20) {
  if (!timestamp || !Number.isFinite(timestamp)) return 1;
  const days = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  const halfLife = halfLifeDays > 0 ? halfLifeDays : 20;
  return Math.exp((-Math.LN2 * days) / halfLife);
}

function convertEvPctToProb(evPct, odds) {
  if (!Number.isFinite(evPct) || !Number.isFinite(odds) || odds <= 0) {
    return null;
  }
  const prob = (evPct / 100 + 1) / odds;
  return clamp(prob, 0, 1);
}

function buildLeagueKey(stat, scope) {
  return `${stat}:${scope}`;
}

function computeLeagueProbability(leagueStats, stat, scope) {
  const entry = leagueStats.get(buildLeagueKey(stat, scope));
  if (entry && entry.weight > 0) {
    return entry.sum / entry.weight;
  }
  return null;
}

function computeFormulaProbability(bet, formula, leagueStats, config = {}) {
  const baseProb = bet.baseProb;
  if (!Number.isFinite(baseProb)) return 0;

  switch (formula) {
    case "multiplier": {
      const { clampMin = 0.6, clampMax = 1.4, sensitivity = 0.45 } = config;
      const delta = baseProb - 0.5;
      const rawFactor = 1 + delta * sensitivity;
      const factor = clamp(rawFactor, clampMin, clampMax);
      return clamp(baseProb * factor, 0, 1);
    }
    case "multifactor": {
      const { leagueWeight = 0.25 } = config;
      const baseWeight = 1 - leagueWeight;
      const leagueProb =
        computeLeagueProbability(leagueStats, bet.stat, bet.scope) ?? baseProb;
      const total = baseWeight + leagueWeight;
      const mixBase = baseProb * (baseWeight / total);
      const mixLeague = leagueProb * (leagueWeight / total);
      return clamp(mixBase + mixLeague, 0, 1);
    }
    case "leagueAvg": {
      const { blend = 0.5 } = config;
      const leagueProb =
        computeLeagueProbability(leagueStats, bet.stat, bet.scope) ?? baseProb;
      return clamp(leagueProb * blend + baseProb * (1 - blend), 0, 1);
    }
    case "base":
    default:
      return baseProb;
  }
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.name.endsWith(".json")) {
      files.push(full);
    }
  }
  return files;
}

// === PARAM GRID SEARCH ===
const PARAMS = {
  multiplier: {
    clampMin: { min: 0.5, max: 1.0, step: 0.1 },
    clampMax: { min: 1.0, max: 1.8, step: 0.1 },
    sensitivity: { min: 0.3, max: 0.7, step: 0.05 },
  },
  multifactor: {
    leagueWeight: { min: 0.0, max: 1.0, step: 0.1 },
  },
  leagueAvg: {
    blend: { min: 0.0, max: 1.0, step: 0.1 },
  },
};

function* generateCombinations(params) {
  const keys = Object.keys(params);
  const values = keys.map((k) => {
    const p = params[k];
    const arr = [];
    for (let v = p.min; v <= p.max + 1e-6; v += p.step) {
      arr.push(parseFloat(v.toFixed(2)));
    }
    return arr;
  });

  function* helper(index = 0, current = {}) {
    if (index === keys.length) {
      yield { ...current };
      return;
    }
    const key = keys[index];
    for (const val of values[index]) {
      yield* helper(index + 1, { ...current, [key]: val });
    }
  }
  yield* helper();
}

function buildLeagueStats(bets) {
  const leagueStats = new Map();
  for (const bet of bets) {
    const weight = computeTimeWeight(bet.timestamp); // Assume timestamp added if needed
    const leagueKey = buildLeagueKey(bet.stat, bet.scope);
    const entry = leagueStats.get(leagueKey) || { sum: 0, weight: 0 };
    entry.sum += bet.baseProb * weight;
    entry.weight += weight;
    leagueStats.set(leagueKey, entry);
  }
  return leagueStats;
}

async function runGridSearch() {
  const files = await collectFiles(backtestsDir);
  const allBets = [];
  const leagueStats = new Map();

  for (const file of files) {
    const txt = await fs.readFile(file, "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (err) {
      console.warn("Skipping invalid JSON", file);
      continue;
    }
    const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
    const timestamp = parseTimestampFromFile(file);

    for (const bet of lines) {
      if (bet.win == null) continue;
      const value = Number(bet.value);
      if (!Number.isFinite(value) || value <= 0) continue;
      const odds = Number(bet.odds);
      if (minOdds != null && odds < minOdds) continue;
      if (maxOdds != null && odds > maxOdds) continue;
      if (!Number.isFinite(odds) || odds <= 0) continue;
      if (minEv != null && value < minEv) continue;
      if (maxEv != null && value > maxEv) continue;

      const stat = bet.statKey || "unknown";
      if (statFilter && stat !== statFilter) continue;
      const scope = (bet.scope || "total").toLowerCase();
      const period = bet.period || "ALL";
      const condition = (
        bet.condition ||
        (bet.over ? "över" : "under") ||
        ""
      ).toLowerCase();

      const baseProb = convertEvPctToProb(value, odds);
      if (!Number.isFinite(baseProb)) continue;

      const weight = computeTimeWeight(timestamp);
      const leagueKey = buildLeagueKey(stat, scope);
      const entry = leagueStats.get(leagueKey) || { sum: 0, weight: 0 };
      entry.sum += baseProb * weight;
      entry.weight += weight;
      leagueStats.set(leagueKey, entry);

      allBets.push({
        stat,
        scope,
        period,
        condition,
        odds,
        win: Boolean(bet.win),
        baseProb,
        timestamp, // Added for weight if needed
      });
    }
  }

  const results = {};
  const bestByKey = Object.create(null);

  for (const formula of FORMULAS) {
    if (formula === "base" || !PARAMS[formula]) continue; // Skip base as no params

    results[formula] = [];
    const paramCombos = Array.from(generateCombinations(PARAMS[formula]));

    for (const config of paramCombos) {
      const agg = {};

      for (const bet of allBets) {
        const probability = computeFormulaProbability(
          bet,
          formula,
          leagueStats,
          config
        );
        const expectedEv = probability * bet.odds - 1;
        if (ONLY_POSITIVE && expectedEv <= 0) {
          bet[`${formula}_selected`] = false;
          continue;
        }
        bet[`${formula}_selected`] = true;

        const actualEv = bet.win ? bet.odds - 1 : -1;
        const key = `${bet.stat}||${bet.condition}||${bet.period}||${bet.scope}`;
        const formulaAgg = agg[key] || {
          stat: bet.stat,
          condition: bet.condition,
          period: bet.period,
          scope: bet.scope,
          bets: 0,
          wins: 0,
          expectedEv: 0,
          actualEv: 0,
          return: 0,
        };
        formulaAgg.bets += 1;
        formulaAgg.wins += bet.win ? 1 : 0;
        formulaAgg.expectedEv += expectedEv;
        formulaAgg.actualEv += actualEv;
        formulaAgg.return += bet.win ? bet.odds : 0;
        agg[key] = formulaAgg;
      }

      for (const [key, entry] of Object.entries(agg)) {
        const avgExpected = entry.bets
          ? (entry.expectedEv / entry.bets) * 100
          : 0;
        const avgActual = entry.bets ? entry.actualEv / entry.bets : 0;
        const roi =
          entry.bets > 0 ? ((entry.return - entry.bets) / entry.bets) * 100 : 0;

        const result = {
          bets: entry.bets,
          formula,
          config,
          stat: entry.stat,
          condition: entry.condition || "n/a",
          period: entry.period,
          scope: entry.scope,
          expectedEv: avgExpected,
          actualEv: avgActual,
          roi,
        };

        results[formula].push(result);

        const bestKey = `${formula}|${key}`;
        if (!bestByKey[bestKey] || roi > bestByKey[bestKey].roi) {
          bestByKey[bestKey] = result;
        }
      }
    }
  }

  await fs.writeFile(
    "grid_search_results.json",
    JSON.stringify(results, null, 2)
  );
  await fs.writeFile(
    "best_config_per_combo.json",
    JSON.stringify(bestByKey, null, 2)
  );

  const headline =
    "bets | formula | condition | statKey | period | scope | expected EV | actual EV | ROI | config";
  console.log("\nBest Config per Combo:");
  console.log(headline);
  console.log("-".repeat(headline.length));
  for (const [key, row] of Object.entries(bestByKey)) {
    console.log(
      `${String(row.bets).padStart(4)} | ${row.formula.padEnd(
        13
      )} | ${row.condition.padEnd(9)} | ${row.stat.padEnd(
        16
      )} | ${row.period.padEnd(6)} | ${row.scope.padEnd(6)} | ${row.expectedEv
        .toFixed(2)
        .padStart(11)} | ${row.actualEv.toFixed(2).padStart(9)} | ${row.roi
        .toFixed(2)
        .padStart(6)} | ${JSON.stringify(row.config)}`
    );
  }
}

async function main() {
  if (CLI_ARGS["grid-search"]) {
    await runGridSearch();
    return;
  }

  const files = await collectFiles(backtestsDir);
  const bets = [];
  const leagueStats = new Map();

  for (const file of files) {
    const txt = await fs.readFile(file, "utf-8");
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (err) {
      console.warn("Skipping invalid JSON", file);
      continue;
    }
    const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
    const timestamp = parseTimestampFromFile(file);

    for (const bet of lines) {
      if (bet.win == null) continue;
      const value = Number(bet.value);
      if (!Number.isFinite(value) || value <= 0) continue;
      const odds = Number(bet.odds);
      if (minOdds != null && odds < minOdds) continue;
      if (maxOdds != null && odds > maxOdds) continue;
      if (!Number.isFinite(odds) || odds <= 0) continue;
      if (minEv != null && value < minEv) continue;
      if (maxEv != null && value > maxEv) continue;

      const stat = bet.statKey || "unknown";
      if (statFilter && stat !== statFilter) continue;
      const scope = (bet.scope || "total").toLowerCase();
      const period = bet.period || "ALL";
      const condition = (
        bet.condition ||
        (bet.over ? "över" : "under") ||
        ""
      ).toLowerCase();

      const baseProb = convertEvPctToProb(value, odds);
      if (!Number.isFinite(baseProb)) continue;

      const weight = computeTimeWeight(timestamp);
      const leagueKey = buildLeagueKey(stat, scope);
      const entry = leagueStats.get(leagueKey) || { sum: 0, weight: 0 };
      entry.sum += baseProb * weight;
      entry.weight += weight;
      leagueStats.set(leagueKey, entry);

      bets.push({
        stat,
        scope,
        period,
        condition,
        odds,
        win: Boolean(bet.win),
        baseProb,
      });
    }
  }

  const aggregates = {};
  for (const formula of FORMULAS) {
    aggregates[formula] = {};
  }

  for (const bet of bets) {
    for (const formula of FORMULAS) {
      const probability = computeFormulaProbability(bet, formula, leagueStats);
      const expectedEv = probability * bet.odds - 1;
      if (ONLY_POSITIVE && expectedEv <= 0) {
        continue;
      }
      const actualEv = bet.win ? bet.odds - 1 : -1;
      const key = `${bet.stat}||${bet.condition}||${bet.period}||${bet.scope}`;
      const formulaAgg = aggregates[formula];
      if (!formulaAgg[key]) {
        formulaAgg[key] = {
          stat: bet.stat,
          condition: bet.condition,
          period: bet.period,
          scope: bet.scope,
          bets: 0,
          wins: 0,
          expectedEv: 0,
          actualEv: 0,
          return: 0,
        };
      }
      const row = formulaAgg[key];
      row.bets += 1;
      row.wins += bet.win ? 1 : 0;
      row.expectedEv += expectedEv;
      row.actualEv += actualEv;
      row.return += bet.win ? bet.odds : 0;
    }
  }

  const summarized = [];
  const totals = FORMULAS.reduce((acc, formula) => {
    acc[formula] = { bets: 0, expectedSum: 0, actualSum: 0, return: 0 };
    return acc;
  }, {});
  for (const formula of FORMULAS) {
    const entries = Object.values(aggregates[formula]);
    for (const entry of entries) {
      const avgExpected = entry.bets
        ? (entry.expectedEv / entry.bets) * 100
        : 0;
      const avgActual = entry.bets ? entry.actualEv / entry.bets : 0;
      const roi =
        entry.bets > 0 ? ((entry.return - entry.bets) / entry.bets) * 100 : 0;

      summarized.push({
        bets: entry.bets,
        formula,
        stat: entry.stat,
        condition: entry.condition || "n/a",
        period: entry.period,
        scope: entry.scope,
        expectedEv: avgExpected,
        actualEv: avgActual,
        roi,
      });
      const total = totals[formula];
      total.bets += entry.bets;
      total.expectedSum += entry.expectedEv;
      total.actualSum += entry.actualEv;
      total.return += entry.return;
    }
  }

  summarized.sort((a, b) => a.roi - b.roi);

  const headline =
    "bets | formula       | condition | statKey          | period | scope  | expected EV | actual EV | ROI";
  console.log("\nFormula ROI leaderboard (best ROI at bottom):");
  console.log(headline);
  console.log("-".repeat(headline.length));
  for (const row of summarized) {
    console.log(
      `${String(row.bets).padStart(4)} | ${row.formula.padEnd(
        13
      )} | ${row.condition.padEnd(9)} | ${row.stat.padEnd(
        16
      )} | ${row.period.padEnd(6)} | ${row.scope.padEnd(6)} | ${row.expectedEv
        .toFixed(2)
        .padStart(11)} | ${row.actualEv.toFixed(2).padStart(9)} | ${row.roi
        .toFixed(2)
        .padStart(6)}`
    );
  }

  console.log("\nTOTAL ROI per formula (all keys/periods):");
  console.log(headline);
  console.log("-".repeat(headline.length));
  for (const formula of FORMULAS) {
    const total = totals[formula];
    if (!total || total.bets === 0) continue;
    const expectedEv = total.expectedSum / total.bets;
    const actualEv = total.actualSum / total.bets;
    const roi =
      total.return > 0 ? ((total.return - total.bets) / total.bets) * 100 : 0;
    console.log(
      `${String(total.bets).padStart(4)} | ${formula.padEnd(
        13
      )} | ${"TOTAL".padEnd(9)} | ${"ALL".padEnd(16)} | ${"ALL".padEnd(
        6
      )} | ${"ALL".padEnd(6)} | ${expectedEv
        .toFixed(2)
        .padStart(11)} | ${actualEv.toFixed(2).padStart(9)} | ${roi
        .toFixed(2)
        .padStart(6)}`
    );
  }
}

main().catch((err) => {
  console.error("Failed to run EV formula test", err);
  process.exit(1);
});
