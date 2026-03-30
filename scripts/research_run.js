#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { POLICY_VERSION } from "../lib/backtest/rankingPolicy.js";
import { RESEARCH_OBJECTIVE } from "../lib/backtest/rankingPolicy.js";
import { parseEvalJson } from "./research_autoloop_core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const resultsDir = path.join(rootDir, "research");
const resultsPath = path.join(resultsDir, "results.tsv");

function parseArgs(argv) {
  const args = {
    note: "",
    status: "keep",
    strategyId: RESEARCH_OBJECTIVE.strategyId,
    days: RESEARCH_OBJECTIVE.replayDays,
    limit: RESEARCH_OBJECTIVE.maxSnapshots,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--note" && argv[i + 1]) args.note = argv[++i];
    if (arg === "--status" && argv[i + 1]) args.status = argv[++i];
    if (arg === "--strategy" && argv[i + 1]) args.strategyId = argv[++i];
    if (arg === "--days" && argv[i + 1]) args.days = Number(argv[++i]) || args.days;
    if (arg === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]) || args.limit;
  }
  return args;
}

function safeExec(command) {
  try {
    return execSync(command, { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function ensureResultsFile() {
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  if (!fs.existsSync(resultsPath)) {
    const header = [
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
    fs.writeFileSync(resultsPath, `${header}\n`, "utf-8");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stdout = execSync(
    `node scripts/research_eval.js --json --strategy ${args.strategyId} --days ${args.days} --limit ${args.limit}`,
    { cwd: rootDir, encoding: "utf-8" }
  );
  const result = parseEvalJson(stdout);

  ensureResultsFile();

  const row = [
    new Date().toISOString(),
    safeExec("git rev-parse --short HEAD"),
    safeExec("git rev-parse --abbrev-ref HEAD"),
    POLICY_VERSION,
    args.strategyId,
    result.researchScore,
    result.metrics.beatClosePct,
    result.metrics.avgClv,
    result.metrics.roiPct,
    result.metrics.proofCoveragePct,
    result.metrics.pickedDates,
    result.metrics.pickedBets,
    result.guardrails.ok,
    args.status,
    (args.note || "").replace(/\t|\n/g, " "),
  ].join("\t");

  fs.appendFileSync(resultsPath, `${row}\n`, "utf-8");
  process.stdout.write(`${stdout.trim()}\n`);
}

main();
