#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  decideExperimentStatus,
  parseEvalJson,
  applyNumericMutation,
  readNumericProperty,
} from "./research_autoloop_core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const policyPath = path.join(rootDir, "lib", "backtest", "rankingPolicy.js");
const policyRelativePath = "lib/backtest/rankingPolicy.js";
const resultsPath = path.join(rootDir, "research", "results.tsv");
const resultsRelativePath = "research/results.tsv";

const RESULTS_HEADER = [
  "timestamp",
  "git_sha",
  "git_branch",
  "policy_version",
  "strategy_id",
  "research_score",
  "beat_close_pct",
  "avg_clv",
  "roi_pct",
  "proof_coverage_pct",
  "picked_dates",
  "picked_bets",
  "guardrails_ok",
  "status",
  "note",
].join("\t");

const MUTATION_TEMPLATES = [
  {
    id: "balanced_edge_up",
    description: "raise balanced edge weight",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "edge"],
    delta: 0.04,
    min: 0.10,
    max: 0.60,
    decimals: 2,
  },
  {
    id: "balanced_confidence_down",
    description: "lower balanced confidence weight",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "confidence"],
    delta: -0.04,
    min: 0.08,
    max: 0.40,
    decimals: 2,
  },
  {
    id: "balanced_learning_up",
    description: "raise balanced learning weight",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "learning"],
    delta: 0.10,
    min: 0.50,
    max: 1.80,
    decimals: 2,
  },
  {
    id: "balanced_risk_down",
    description: "reduce balanced risk penalty",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "risk"],
    delta: -0.10,
    min: 0.40,
    max: 1.50,
    decimals: 2,
  },
  {
    id: "balanced_proof_up",
    description: "raise balanced proof weight",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "weights", "proof"],
    delta: 0.02,
    min: 0.01,
    max: 0.25,
    decimals: 2,
  },
  {
    id: "balanced_sample_threshold_down",
    description: "lower balanced minimum sample size",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "minSampleSize"],
    delta: -1,
    min: 3,
    max: 12,
    decimals: 0,
  },
  {
    id: "balanced_agreement_threshold_down",
    description: "lower balanced minimum agreement threshold",
    declarationName: "STRATEGY_PROFILES",
    propertyPath: ["balanced", "minAgreementPct"],
    delta: -5,
    min: 15,
    max: 80,
    decimals: 0,
  },
  {
    id: "shots_on_goal_prior_up",
    description: "raise shots-on-goal market prior",
    declarationName: "STAT_MARKET_PRIORS",
    propertyPath: ["shotsOnGoal"],
    delta: 4,
    min: 40,
    max: 100,
    decimals: 0,
  },
  {
    id: "corners_prior_up",
    description: "raise corners market prior",
    declarationName: "STAT_MARKET_PRIORS",
    propertyPath: ["cornerKicks"],
    delta: 4,
    min: 40,
    max: 100,
    decimals: 0,
  },
  {
    id: "price_center_up",
    description: "shift ideal odds center upward",
    declarationName: "SCORE_SHAPING",
    propertyPath: ["idealPriceCenter"],
    delta: 0.10,
    min: 1.50,
    max: 3.00,
    decimals: 2,
  },
  {
    id: "price_distance_weight_up",
    description: "tighten price distance penalty",
    declarationName: "SCORE_SHAPING",
    propertyPath: ["priceDistanceWeight"],
    delta: 5,
    min: 20,
    max: 90,
    decimals: 0,
  },
  {
    id: "learning_ready_bets_down",
    description: "allow learning readiness with fewer bets",
    declarationName: "PROOF_THRESHOLDS",
    propertyPath: ["learningReadyMinBets"],
    delta: -2,
    min: 6,
    max: 30,
    decimals: 0,
  },
  {
    id: "learning_confidence_threshold_down",
    description: "lower learning confidence threshold",
    declarationName: "PROOF_THRESHOLDS",
    propertyPath: ["learningMinConfidencePct"],
    delta: -3,
    min: 15,
    max: 60,
    decimals: 0,
  },
];

function parseArgs(argv) {
  const args = {
    tag: null,
    strategyId: "balanced",
    days: 90,
    limit: 600,
    iterations: 12,
    forever: false,
    resume: false,
    focus: "roi",
    timeoutMs: 10 * 60 * 1000,
    allowDirtyStart: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag" && argv[i + 1]) args.tag = argv[++i];
    if (arg === "--strategy" && argv[i + 1]) args.strategyId = argv[++i];
    if (arg === "--days" && argv[i + 1]) args.days = Number(argv[++i]) || args.days;
    if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]) || args.limit;
    if (arg === "--iterations" && argv[i + 1]) args.iterations = Number(argv[++i]) || args.iterations;
    if (arg === "--focus" && argv[i + 1]) args.focus = argv[++i];
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
  const dirty = parseDirtyStatus().filter((file) => file !== resultsRelativePath);
  if (dirty.length) {
    throw new Error(`Workspace must be clean before autoloop. Dirty files: ${dirty.join(", ")}`);
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

  throw new Error("research/results.tsv has an unexpected header; update it manually before running autoloop.");
}

function runEval(args) {
  const stdout = runCommand(
    "node",
    [
      "scripts/research_eval.js",
      "--json",
      "--strategy",
      args.strategyId,
      "--days",
      String(args.days),
      "--limit",
      String(args.limit),
    ],
    { timeout: args.timeoutMs }
  );
  return parseEvalJson(stdout);
}

function appendResultRow({ branchName, result, status, note }) {
  ensureResultsFile();
  const row = [
    new Date().toISOString(),
    tryCommand("git", ["rev-parse", "--short", "HEAD"]) || "unknown",
    branchName,
    result?.policyVersion || "unknown",
    result?.strategyId || "unknown",
    result?.researchScore ?? 0,
    result?.metrics?.beatClosePct ?? 0,
    result?.metrics?.avgClv ?? 0,
    result?.metrics?.roiPct ?? 0,
    result?.metrics?.proofCoveragePct ?? 0,
    result?.metrics?.pickedDates ?? 0,
    result?.metrics?.pickedBets ?? 0,
    result?.guardrails?.ok ?? false,
    status,
    String(note || "").replace(/\t|\n/g, " "),
  ].join("\t");

  fs.appendFileSync(resultsPath, `${row}\n`, "utf8");
}

function clampValue(value, min, max, decimals) {
  const bounded = Math.min(Math.max(value, min), max);
  if (decimals <= 0) return Math.round(bounded);
  return Number(bounded.toFixed(decimals));
}

function buildProposal(source, iteration) {
  for (let offset = 0; offset < MUTATION_TEMPLATES.length; offset += 1) {
    const template = MUTATION_TEMPLATES[(iteration + offset) % MUTATION_TEMPLATES.length];
    const currentValue = readNumericProperty(source, template.declarationName, template.propertyPath);
    const nextValue = clampValue(currentValue + template.delta, template.min, template.max, template.decimals);
    if (Object.is(nextValue, currentValue)) continue;

    const mutation = {
      declarationName: template.declarationName,
      propertyPath: template.propertyPath,
      nextValue,
    };

    const nextSource = applyNumericMutation(source, mutation);
    if (nextSource === source) continue;

    const propertyLabel = template.propertyPath.join(".");
    const description = `${template.description} (${propertyLabel} ${currentValue} -> ${nextValue})`;
    return { id: template.id, description, nextSource };
  }

  return null;
}

function restorePolicyFile() {
  runCommand("git", ["restore", "--source", "HEAD", "--worktree", "--staged", "--", policyRelativePath], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function commitPolicyChange(message) {
  runCommand("git", ["add", "--", policyRelativePath], { stdio: ["ignore", "ignore", "pipe"] });
  runCommand("git", ["commit", "-m", message], { stdio: ["ignore", "ignore", "pipe"] });
}

function printSummary(prefix, result) {
  const line = [
    prefix,
    `score=${result?.researchScore ?? 0}`,
    `roi=${result?.metrics?.roiPct ?? 0}`,
    `beatClose=${result?.metrics?.beatClosePct ?? 0}`,
    `avgClv=${result?.metrics?.avgClv ?? 0}`,
    `guardrails=${result?.guardrails?.ok ?? false}`,
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
  const branchName = `autoresearch/${args.tag || defaultTag()}`;

  ensureCleanWorkspace(args.allowDirtyStart);
  ensureResultsFile();
  const { created } = ensureAutoloopBranch(branchName, args.resume);

  let baseline = runEval(args);
  printSummary("baseline", baseline);

  if (created || !hasBaselineLogged(branchName)) {
    appendResultRow({ branchName, result: baseline, status: "keep", note: "baseline" });
  }

  let iteration = 0;
  while (args.forever || iteration < args.iterations) {
    const currentSource = fs.readFileSync(policyPath, "utf8");
    const proposal = buildProposal(currentSource, iteration);
    if (!proposal) {
      process.stdout.write("No further policy mutations can be generated from the current source.\n");
      break;
    }

    process.stdout.write(`iteration ${iteration + 1}: ${proposal.description}\n`);
    fs.writeFileSync(policyPath, proposal.nextSource, "utf8");

    let candidate = null;
    let status = "crash";
    let note = proposal.description;

    try {
      candidate = runEval(args);
      const decision = decideExperimentStatus({
        baseline,
        candidate,
        focus: args.focus,
      });
      status = decision.status;
      note = `${proposal.description} | ${decision.reason}`;
      appendResultRow({ branchName, result: candidate, status, note });

      if (status === "keep") {
        commitPolicyChange(`research: ${proposal.id}`);
        baseline = candidate;
        printSummary("keep", candidate);
      } else {
        restorePolicyFile();
        printSummary("discard", candidate);
      }
    } catch (error) {
      restorePolicyFile();
      const crashResult = candidate || baseline;
      const crashNote = `${proposal.description} | crash: ${error?.message || "unknown error"}`;
      appendResultRow({ branchName, result: crashResult, status: "crash", note: crashNote });
      process.stdout.write(`crash: ${error?.message || "unknown error"}\n`);
    }

    iteration += 1;
  }

  process.stdout.write(`autoloop complete on ${branchName}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
