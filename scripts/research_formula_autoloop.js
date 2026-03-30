#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  applyStringArrayMutation,
  decideExperimentStatus,
  parseEvalJson,
  readStringArrayProperty,
} from "./research_autoloop_core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "lib", "backtest", "formulaConfig.js");
const configRelativePath = "lib/backtest/formulaConfig.js";
const resultsPath = path.join(rootDir, "research", "formula-results.tsv");
const resultsRelativePath = "research/formula-results.tsv";
const rankingResultsRelativePath = "research/results.tsv";

const RESULTS_HEADER = [
  "timestamp",
  "git_sha",
  "git_branch",
  "selected_bets",
  "settled_bets",
  "roi_pct",
  "expected_ev_pct",
  "actual_ev_pct",
  "win_rate_pct",
  "status",
  "note",
].join("\t");

const MUTATION_TEMPLATES = [
  {
    id: "corners_multifactor_first",
    description: "prefer multifactor before league average for corners",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["cornerKicks", "display"],
    nextValue: ["multifactor", "leagueAvg"],
  },
  {
    id: "corners_base_first",
    description: "prefer base before league average for corners",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["cornerKicks", "display"],
    nextValue: ["base", "leagueAvg"],
  },
  {
    id: "corners_multiplier_first",
    description: "prefer multiplier before league average for corners",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["cornerKicks", "display"],
    nextValue: ["multiplier", "leagueAvg"],
  },
  {
    id: "shots_base_first",
    description: "prefer base before league average for total shots",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["totalShots", "display"],
    nextValue: ["base", "leagueAvg"],
  },
  {
    id: "shots_multiplier_first",
    description: "prefer multiplier before league average for total shots",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["totalShots", "display"],
    nextValue: ["multiplier", "leagueAvg"],
  },
  {
    id: "shots_multifactor_first",
    description: "prefer multifactor before league average for total shots",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["totalShots", "display"],
    nextValue: ["multifactor", "leagueAvg"],
  },
  {
    id: "cards_league_first",
    description: "prefer league average before multifactor for yellow cards",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["yellowCards", "display"],
    nextValue: ["leagueAvg", "multifactor"],
  },
  {
    id: "cards_base_first",
    description: "prefer base before multifactor for yellow cards",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["yellowCards", "display"],
    nextValue: ["base", "multifactor"],
  },
  {
    id: "cards_multiplier_first",
    description: "prefer multiplier before multifactor for yellow cards",
    declarationName: "INLINE_CONFIG",
    propertyPath: ["yellowCards", "display"],
    nextValue: ["multiplier", "multifactor"],
  },
];

function parseArgs(argv) {
  const args = {
    tag: null,
    iterations: 9,
    forever: false,
    resume: false,
    timeoutMs: 10 * 60 * 1000,
    allowDirtyStart: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag" && argv[i + 1]) args.tag = argv[++i];
    if (arg === "--iterations" && argv[i + 1]) args.iterations = Number(argv[++i]) || args.iterations;
    if (arg === "--timeout-ms" && argv[i + 1]) args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    if (arg === "--forever") args.forever = true;
    if (arg === "--resume") args.resume = true;
    if (arg === "--allow-dirty-start") args.allowDirtyStart = true;
  }

  return args;
}

function defaultTag() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}-roi`;
}

function runCommand(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: rootDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

function tryCommand(command, args, options = {}) {
  try {
    return runCommand(command, args, options);
  } catch {
    return null;
  }
}

function currentBranch() {
  return runCommand("git", ["branch", "--show-current"]);
}

function branchExists(branchName) {
  return Boolean(tryCommand("git", ["show-ref", "--verify", `refs/heads/${branchName}`]));
}

function ensureAutoloopBranch(branchName, resume) {
  const active = currentBranch();
  if (active === branchName) return { branchName, created: false };

  const exists = branchExists(branchName);
  if (exists && !resume) {
    throw new Error(`Branch ${branchName} already exists. Re-run with --resume to continue it.`);
  }
  if (!exists && resume) {
    throw new Error(`Branch ${branchName} does not exist, so --resume cannot continue it.`);
  }

  if (exists) {
    runCommand("git", ["checkout", branchName], { stdio: ["ignore", "ignore", "pipe"] });
    return { branchName, created: false };
  }

  runCommand("git", ["checkout", "-b", branchName], { stdio: ["ignore", "ignore", "pipe"] });
  return { branchName, created: true };
}

function parseDirtyStatus() {
  const stdout = runCommand("git", ["status", "--porcelain"]);
  if (!stdout) return [];
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function ensureCleanWorkspace(allowDirtyStart) {
  if (allowDirtyStart) return;
  const dirty = parseDirtyStatus().filter(
    (file) => file !== resultsRelativePath && file !== rankingResultsRelativePath
  );
  if (dirty.length) {
    throw new Error(`Workspace must be clean before formula autoloop. Dirty files: ${dirty.join(", ")}`);
  }
}

function ensureResultsFile() {
  const dir = path.dirname(resultsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(resultsPath)) {
    fs.writeFileSync(resultsPath, `${RESULTS_HEADER}\n`, "utf8");
    return;
  }

  const current = fs.readFileSync(resultsPath, "utf8");
  const [firstLine = ""] = current.split(/\r?\n/);
  if (firstLine === RESULTS_HEADER) return;

  const rows = current.split(/\r?\n/).filter(Boolean);
  if (rows.length <= 1) {
    fs.writeFileSync(resultsPath, `${RESULTS_HEADER}\n`, "utf8");
    return;
  }

  throw new Error("research/formula-results.tsv has an unexpected header; update it manually before running formula autoloop.");
}

function runEval(args) {
  const stdout = runCommand(
    "node",
    ["scripts/formula-ev-check.js", "--json"],
    { timeout: args.timeoutMs }
  );
  return parseEvalJson(stdout);
}

function attachGuardrails(result, baseline = null) {
  const baselineSelected = Number(baseline?.metrics?.selectedBets ?? result?.metrics?.selectedBets ?? 0);
  const baselineSettled = Number(baseline?.metrics?.settledBets ?? result?.metrics?.settledBets ?? 0);
  const selectedBets = Number(result?.metrics?.selectedBets) || 0;
  const settledBets = Number(result?.metrics?.settledBets) || 0;

  const minSelectedFloor = Math.max(10, Math.floor(baselineSelected * 0.8));
  const minSettledFloor = Math.max(10, Math.floor(baselineSettled * 0.8));
  const guardrails = {
    minSelectedBets: selectedBets >= minSelectedFloor,
    minSettledBets: settledBets >= minSettledFloor,
  };

  return {
    ...result,
    researchScore: Number(result?.metrics?.expectedEvPct) || 0,
    metrics: {
      ...result?.metrics,
      beatClosePct: Number(result?.metrics?.expectedEvPct) || 0,
      avgClv: Number(result?.metrics?.actualEvPct) || 0,
    },
    guardrails: {
      ...guardrails,
      ok: Object.values(guardrails).every(Boolean),
    },
  };
}

function appendResultRow({ branchName, result, status, note }) {
  ensureResultsFile();
  const row = [
    new Date().toISOString(),
    tryCommand("git", ["rev-parse", "--short", "HEAD"]) || "unknown",
    branchName,
    result?.metrics?.selectedBets ?? 0,
    result?.metrics?.settledBets ?? 0,
    result?.metrics?.roiPct ?? 0,
    result?.metrics?.expectedEvPct ?? 0,
    result?.metrics?.actualEvPct ?? 0,
    result?.metrics?.winRatePct ?? 0,
    status,
    String(note || "").replace(/\t|\n/g, " "),
  ].join("\t");

  fs.appendFileSync(resultsPath, `${row}\n`, "utf8");
}

function buildProposal(source, attemptedIds = new Set()) {
  for (const template of MUTATION_TEMPLATES) {
    if (attemptedIds.has(template.id)) continue;

    const currentValue = readStringArrayProperty(
      source,
      template.declarationName,
      template.propertyPath
    );
    if (JSON.stringify(currentValue) === JSON.stringify(template.nextValue)) continue;

    const nextSource = applyStringArrayMutation(source, template);
    const propertyLabel = template.propertyPath.join(".");
    const description = `${template.description} (${propertyLabel} ${JSON.stringify(currentValue)} -> ${JSON.stringify(template.nextValue)})`;
    return { ...template, description, nextSource };
  }

  return null;
}

function restoreConfigFile() {
  runCommand("git", ["restore", "--source", "HEAD", "--worktree", "--staged", "--", configRelativePath], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitConfigChange(message) {
  runCommand("git", ["add", "--", configRelativePath], { stdio: ["ignore", "ignore", "pipe"] });
  runCommand("git", ["commit", "-m", message], { stdio: ["ignore", "ignore", "pipe"] });
}

function printSummary(prefix, result) {
  const formulaMix = Object.entries(result?.metrics?.formulaCounts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([formulaKey, count]) => `${formulaKey}:${count}`)
    .join(",");
  const line = [
    prefix,
    `selected=${result?.metrics?.selectedBets ?? 0}`,
    `settled=${result?.metrics?.settledBets ?? 0}`,
    `roi=${result?.metrics?.roiPct ?? 0}`,
    `expected=${result?.metrics?.expectedEvPct ?? 0}`,
    `actual=${result?.metrics?.actualEvPct ?? 0}`,
    `guardrails=${result?.guardrails?.ok ?? false}`,
    `mix=${formulaMix || "none"}`,
  ].join(" | ");
  process.stdout.write(`${line}\n`);
}

function hasBaselineLogged(branchName) {
  if (!fs.existsSync(resultsPath)) return false;
  const rows = fs.readFileSync(resultsPath, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  return rows.some((row) => row.split("\t")[2] === branchName);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const branchName = `autoresearch-formulas/${args.tag || defaultTag()}`;

  ensureCleanWorkspace(args.allowDirtyStart);
  ensureResultsFile();
  const { created } = ensureAutoloopBranch(branchName, args.resume);

  let baseline = attachGuardrails(runEval(args));
  printSummary("baseline", baseline);

  if (created || !hasBaselineLogged(branchName)) {
    appendResultRow({ branchName, result: baseline, status: "keep", note: "baseline" });
  }

  const attemptedIds = new Set();
  let iteration = 0;

  while (args.forever || iteration < args.iterations) {
    const currentSource = fs.readFileSync(configPath, "utf8");
    const proposal = buildProposal(currentSource, attemptedIds);
    if (!proposal) {
      process.stdout.write("No further formula-order mutations can be generated from the current source.\n");
      break;
    }

    attemptedIds.add(proposal.id);
    process.stdout.write(`iteration ${iteration + 1}: ${proposal.description}\n`);
    fs.writeFileSync(configPath, proposal.nextSource, "utf8");

    let candidate = null;

    try {
      candidate = attachGuardrails(runEval(args), baseline);
      const decision = decideExperimentStatus({
        baseline,
        candidate,
        focus: "roi",
      });
      const note = `${proposal.description} | ${decision.reason}`;
      appendResultRow({ branchName, result: candidate, status: decision.status, note });

      if (decision.status === "keep") {
        commitConfigChange(`research: ${proposal.id}`);
        baseline = candidate;
        printSummary("keep", candidate);
      } else {
        restoreConfigFile();
        printSummary("discard", candidate);
      }
    } catch (error) {
      restoreConfigFile();
      const crashResult = candidate || baseline;
      const note = `${proposal.description} | crash: ${error?.message || "unknown error"}`;
      appendResultRow({ branchName, result: crashResult, status: "crash", note });
      process.stdout.write(`crash: ${error?.message || "unknown error"}\n`);
    }

    iteration += 1;
  }

  process.stdout.write(`formula autoloop complete on ${branchName}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
