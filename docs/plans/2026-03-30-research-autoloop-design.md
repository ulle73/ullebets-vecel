# Research Autoloop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an upstream-style autonomous research loop that experiments on `lib/backtest/rankingPolicy.js` using the repo's existing replay/eval pipeline.

**Architecture:** Keep the repo's current evaluation model intact and add a small autoloop runner around it. The runner creates a dedicated git branch, records a baseline, applies one policy mutation at a time to `rankingPolicy.js`, runs `research_eval`, logs keep/discard/crash results to `research/results.tsv`, and commits only kept policy improvements.

**Tech Stack:** Node.js ESM scripts, built-in `node:test`, git CLI, existing Mongo-backed replay scripts.

---

### Task 1: Add a testable autoloop core

**Files:**
- Create: `scripts/research_autoloop_core.js`
- Create: `scripts/research_autoloop_core.test.js`

**Step 1:** Write failing tests for eval parsing, keep/discard decision logic, and numeric policy mutation helpers.

**Step 2:** Run `node --test scripts/research_autoloop_core.test.js` and confirm failures.

**Step 3:** Implement the minimal helper functions to make the tests pass.

**Step 4:** Re-run `node --test scripts/research_autoloop_core.test.js` and confirm green.

### Task 2: Add the autoloop runner

**Files:**
- Create: `scripts/research_autoloop.js`
- Modify: `scripts/research_run.js`

**Step 1:** Implement argument parsing, branch setup, baseline eval, mutation cycling, keep/discard logic, and experiment logging.

**Step 2:** Reuse the helper module so parsing and mutation behavior are not duplicated.

**Step 3:** Ensure discard behavior restores only `lib/backtest/rankingPolicy.js` and never touches unrelated files.

### Task 3: Wire scripts and docs

**Files:**
- Modify: `package.json`
- Modify: `research/program.md`
- Modify: `research/MANUAL.md`
- Modify: `research/results.tsv`

**Step 1:** Add npm scripts for autoloop usage.

**Step 2:** Update docs to explain branch behavior, baseline logging, and ROI-focused runs.

**Step 3:** Expand the TSV header to include `status` so the log matches upstream keep/discard semantics.

### Task 4: Verify the feature

**Files:**
- Verify: `scripts/research_autoloop.js`

**Step 1:** Run `node --test scripts/research_autoloop_core.test.js`.

**Step 2:** Run a smoke test with one bounded iteration and a small replay window.

**Step 3:** Run `npm run build` to confirm the app still compiles.
