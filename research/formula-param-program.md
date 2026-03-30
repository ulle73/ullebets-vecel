# Autoresearch program for ullebets formula parameters

You are running autonomous raw-replay research for `lib/backtest/formulaConfig.js`.

## Your mission

Improve realized ROI by editing only:

- `lib/backtest/formulaConfig.js`

Do not change UI files, API routes, scraping code, database schemas, or the display-order autoloop.

## What this loop optimizes

This loop targets parameter changes that need a replay from raw historical inputs:

- `blendWeight`
- `multifactor.leagueWeight`

It rebuilds base and multifactor projections from historical team data before scoring ROI.

## Core loop

For each experiment:

1. Read the current `lib/backtest/formulaConfig.js`
2. Make one coherent parameter change
3. Run:
   - `npm run research:formula:params:eval`
4. If ROI improves and sample coverage stays healthy, keep it
5. Otherwise revert and try the next mutation

## Autoloop mode

Use:

- `npm run research:auto:formula-params`

This does the following:

- creates or uses a dedicated branch named `autoresearch-formula-params/<tag>`
- records a baseline in `research/formula-param-results.tsv`
- mutates only `lib/backtest/formulaConfig.js`
- runs the raw replay eval after each mutation
- logs each experiment as `keep`, `discard`, or `crash`
- commits only kept config changes

## Practical runtime constraint

The raw replay surface is much more expensive than the display-order loop.

The default eval therefore uses:

- `--limit 100`

This means:

- it replays the latest 100 settled supported lines by default
- you can raise the window manually when you want a deeper run

Examples:

```bash
node scripts/formula_raw_replay_eval.js --json --limit 250
node scripts/research_formula_params_autoloop.js --limit 250 --iterations 10
```

## Supported stats in v1

- `cornerKicks`
- `totalShots`
- `yellowCards`

## Guardrails matter

Treat these as real guardrails:

- selected bet count should stay healthy
- settled bet count should stay healthy
- do not accept a tiny-sample ROI spike as a keeper

## Important limitation

`blendWeight` currently does not move the primary base EV directly, because the current base EV path uses `baseResult.prob`, not `baseResult.blended`.

That means:

- `blendWeight` changes may be real no-ops under the current display order
- if a mutation does not move replay output, discard it instead of forcing it through

## Reporting style

When you log an experiment note, keep it short and concrete.
Examples:

- `corners league weight 0.9 -> 0.7`
- `shots blend weight 0.8 -> 0.6`
- `cards league weight 0.1 -> 0.3`
