# Formula Raw Replay Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a raw historical replay eval and parameter autoloop for `lib/backtest/formulaConfig.js` that can test `multifactor.leagueWeight` and `blendWeight` against settled ROI.

**Architecture:** The new research surface will flatten historical snapshot lines from `unibet-backtest`, join them to settled outcomes from the same documents, rebuild raw projections from `teamstats` using the existing backtest methods, and expose a JSON eval consumed by a dedicated keep/discard autoloop. The existing display-order loop stays untouched; this new loop writes to a separate TSV log and uses its own branch prefix.

**Tech Stack:** Node.js ESM scripts, MongoDB collections (`unibet-backtest`, `teamstats`), existing backtest methods in `lib/backtest`, Node test runner, Git-based keep/discard workflow.

---

### Task 1: Add replay-core tests

**Files:**
- Create: `scripts/formula_raw_replay_core.test.js`
- Create: `scripts/formula_raw_replay_core.js`

**Step 1: Write the failing test**

Add tests for:

- flattening snapshot lines and joining to settled root lines by `betKey`
- filtering raw matches strictly before a cutoff timestamp
- converting EV percent plus odds back into an implied probability
- building mutation metadata for parameter changes

**Step 2: Run test to verify it fails**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: FAIL because `scripts/formula_raw_replay_core.js` does not exist yet.

**Step 3: Write minimal implementation**

Implement minimal helpers in `scripts/formula_raw_replay_core.js`:

- `SUPPORTED_RAW_REPLAY_STATS`
- `flattenReplayCandidates()`
- `filterMatchesBeforeCutoff()`
- `evPctToProbability()`
- `readReplayMutationValue()`
- `applyReplayMutation()`

**Step 4: Run test to verify it passes**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/formula_raw_replay_core.js scripts/formula_raw_replay_core.test.js
git commit -m "test: add raw replay core coverage"
```

### Task 2: Add Poisson inversion and replay scoring tests

**Files:**
- Modify: `scripts/formula_raw_replay_core.test.js`
- Modify: `scripts/formula_raw_replay_core.js`

**Step 1: Write the failing test**

Add tests for:

- `inferPoissonLambdaFromProbability()` producing a stable lambda for simple over/under lines
- replay scoring selecting only positive-EV picks and computing ROI

**Step 2: Run test to verify it fails**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: FAIL because inversion/scoring helpers are missing.

**Step 3: Write minimal implementation**

Implement:

- `inferPoissonLambdaFromProbability()`
- `scoreReplaySelections()`
- lightweight helpers to interpret line direction and EV values

**Step 4: Run test to verify it passes**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/formula_raw_replay_core.js scripts/formula_raw_replay_core.test.js
git commit -m "feat: add replay scoring helpers"
```

### Task 3: Build the raw replay eval script

**Files:**
- Create: `scripts/formula_raw_replay_eval.js`
- Modify: `scripts/formula_raw_replay_core.js`
- Modify: `package.json`

**Step 1: Write the failing test**

Add a focused integration-style test in `scripts/formula_raw_replay_core.test.js` for one replay row that:

- rebuilds a base result from tuples
- derives a multifactor result from an inferred league lambda
- returns a JSON-shaped metrics object

**Step 2: Run test to verify it fails**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: FAIL because the replay orchestration helper is missing.

**Step 3: Write minimal implementation**

Create `scripts/formula_raw_replay_eval.js` that:

- loads replay candidates from `unibet-backtest`
- fetches raw team matches from `teamstats`
- filters matches before `snapshot.fetchedAt`
- rebuilds tuples and projections
- computes configured selections from the current `formulaConfig.js`
- prints JSON with metrics and guardrails

Add an npm script:

- `research:formula:params:eval`

**Step 4: Run test to verify it passes**

Run:

```bash
node --test scripts/formula_raw_replay_core.test.js
npm run research:formula:params:eval
```

Expected:

- test file PASS
- eval prints JSON and exits

**Step 5: Commit**

```bash
git add scripts/formula_raw_replay_core.js scripts/formula_raw_replay_core.test.js scripts/formula_raw_replay_eval.js package.json
git commit -m "feat: add raw formula replay eval"
```

### Task 4: Add the parameter autoloop

**Files:**
- Create: `scripts/research_formula_params_autoloop.js`
- Modify: `package.json`
- Create: `research/formula-param-program.md`

**Step 1: Write the failing test**

Extend `scripts/formula_raw_replay_core.test.js` with tests for:

- discrete mutation proposals for `blendWeight` and `multifactor.leagueWeight`
- avoiding duplicate proposals in one run

**Step 2: Run test to verify it fails**

Run: `node --test scripts/formula_raw_replay_core.test.js`
Expected: FAIL because proposal helpers are missing.

**Step 3: Write minimal implementation**

Create `scripts/research_formula_params_autoloop.js` that:

- creates/uses `autoresearch-formula-params/<tag>`
- baselines with `node scripts/formula_raw_replay_eval.js --json`
- mutates only `lib/backtest/formulaConfig.js`
- logs to `research/formula-param-results.tsv`
- keeps only ROI improvements that preserve guardrails
- restores config on discard/crash

Add npm script:

- `research:auto:formula-params`

**Step 4: Run test to verify it passes**

Run:

```bash
node --test scripts/formula_raw_replay_core.test.js
node scripts/research_formula_params_autoloop.js --iterations 1
```

Expected:

- unit tests PASS
- one-iteration smoke run baselines, tries one mutation, and exits cleanly

**Step 5: Commit**

```bash
git add scripts/formula_raw_replay_core.js scripts/formula_raw_replay_core.test.js scripts/research_formula_params_autoloop.js package.json research/formula-param-program.md
git commit -m "feat: add formula parameter autoloop"
```

### Task 5: Update docs and verify the full surface

**Files:**
- Modify: `research/MANUAL.md`
- Modify: `research/program.md`
- Modify: `package.json`

**Step 1: Write the failing test**

Add or update tests if the new docs/scripts introduce any missing command names in test coverage.

**Step 2: Run test to verify it fails**

Run: `npm run test:research`
Expected: FAIL only if new helpers are not yet covered or command references are stale.

**Step 3: Write minimal implementation**

Update docs so the manual flow clearly distinguishes:

- formula display-order loop
- formula parameter raw-replay loop

Ensure `test:research` includes the new test file.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test:research
npm run build
```

Expected:

- research tests PASS
- app build PASS

**Step 5: Commit**

```bash
git add research/MANUAL.md research/program.md package.json scripts/formula_raw_replay_core.test.js
git commit -m "docs: add raw replay loop instructions"
```
