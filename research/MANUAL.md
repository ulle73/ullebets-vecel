# Manual Research Loop

This repo uses a local replay loop inspired by the upstream `karpathy/autoresearch` project, but the workflow here is simpler:

- only edit `lib/backtest/rankingPolicy.js`
- evaluate against existing MongoDB data
- log only experiments worth keeping
- use a dedicated `autoresearch/<tag>` git branch for autonomous runs

There are now two separate research surfaces:

- `rankingPolicy` loop for shortlist scoring
- `formulaConfig` loop for formula order selection

## Before you start

1. Open a terminal in the repo root.
2. Make sure `.env.local` contains `MONGODB_URI`.
3. Make sure the database already has replay data in:
   - `analysis-snapshots`
   - `closing-line-tracking`
   - `teamstats`

If there is no data in those collections, the research loop has nothing useful to score.

## Step 1: Run a baseline eval

Run:

```bash
node scripts/research_eval.js --json
```

If you want to save the output to a file instead:

```bash
node scripts/research_eval.js --json > research/latest-eval.json
```

What good looks like:

- the command prints JSON
- the process exits on its own
- the JSON includes `researchScore`, `metrics`, and `guardrails`

## Automatic loop

For the upstream-style autonomous loop, run:

```bash
npm run research:auto
```

What it does:

- creates a dedicated branch like `autoresearch/20260330-roi`
- logs a baseline row
- mutates `lib/backtest/rankingPolicy.js`
- runs eval after every mutation
- logs `keep`, `discard`, or `crash` in `research/results.tsv`
- commits only kept policy changes

Useful flags:

```bash
node scripts/research_autoloop.js --focus roi --iterations 20
node scripts/research_autoloop.js --focus roi --forever
node scripts/research_autoloop.js --focus roi --resume --tag 20260330-roi
```

## Formula eval

To evaluate the current formula selection order in `lib/backtest/formulaConfig.js`, run:

```bash
npm run research:formula:eval
```

This prints JSON with:

- `selectedBets`
- `roiPct`
- `expectedEvPct`
- `winRatePct`
- formula mix per stat

This loop optimizes the configured formula order per stat based on historical `evDetails` already stored in backtests.

## Formula autoloop

For the separate formula-config autoloop, run:

```bash
npm run research:auto:formulas
```

What it does:

- creates a dedicated branch like `autoresearch-formulas/20260330-roi`
- logs a baseline in `research/formula-results.tsv`
- mutates only `lib/backtest/formulaConfig.js`
- changes only the configured `display` order per stat
- runs `scripts/formula-ev-check.js --json` after every mutation
- logs `keep`, `discard`, or `crash`
- commits only kept formula-order changes

Useful flags:

```bash
node scripts/research_formula_autoloop.js --iterations 9
node scripts/research_formula_autoloop.js --forever
node scripts/research_formula_autoloop.js --resume --tag 20260330-roi
```

Important limitation:

- this formula loop currently optimizes `display` order, not raw `blendWeight`
- reason: historical backtest rows store finished formula outputs, but not enough raw state to truthfully replay every base-projection parameter change

## Step 2: Change only the policy

Edit only:

```bash
lib/backtest/rankingPolicy.js
```

Keep the change small and interpretable.

## Step 3: Re-run eval

Run the same eval command again:

```bash
node scripts/research_eval.js --json
```

Compare:

- `researchScore`
- `beatClosePct`
- `avgClv`
- `roiPct`
- `guardrails.ok`

Discard changes that raise the score a little but break guardrails.

## Step 4: Log only keepers

If the new policy is worth keeping, append it to the experiment log:

```bash
node scripts/research_run.js --status keep --note "raised balanced proof weight"
```

This appends a row to:

```bash
research/results.tsv
```

## Step 5: Repeat

The manual loop is:

1. eval current policy
2. make one policy change
3. eval again
4. log only if the change is believable
5. revert bad experiments and try the next one

For formula research, the loop is:

1. run `npm run research:formula:eval`
2. change only `lib/backtest/formulaConfig.js`
3. re-run the eval
4. keep only changes that improve ROI without collapsing sample size
5. log or autoloop the keepers

## Fast smoke test

If you only want to verify that the script works end-to-end, use a smaller replay window:

```bash
node scripts/research_eval.js --json --days 30 --limit 50
```
