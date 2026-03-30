# Formula Raw Replay Design

## Goal

Add a second formula research surface that replays historical snapshot lines against raw pre-match team data, so parameter changes in `lib/backtest/formulaConfig.js` can be evaluated more truthfully than the current `evDetails`-only loop.

## Why a new loop is needed

The existing formula autoloop optimizes only `display` order by reusing stored `evDetails`. That works for selection order, but it does not recompute base or multifactor projections from raw historical inputs.

The next improvement target is parameter research:

- `multifactor.leagueWeight`
- `blendWeight`

These need a replay that starts from the historical snapshot time, rebuilds projections, then measures ROI on the settled outcomes.

## Data sources

- `unibet-backtest`
  - `snapshots[].lines` provide historical pre-match line state
  - root `lines[]` provide settled `actual` and `win` values that can be joined back by `betKey`
- `teamstats`
  - provides raw match history for tuple building before the snapshot cutoff
- `lib/backtest/*`
  - provides the same projection methods the app already uses

## Replay approach

1. Read `unibet-backtest` documents.
2. Flatten eligible `snapshots[].lines` for the supported stats:
   - `cornerKicks`
   - `totalShots`
   - `yellowCards`
3. Join each snapshot line back to its settled root line by `betKey`.
4. Use `snapshot.fetchedAt` as the replay cutoff.
5. Fetch raw home and away team matches from `teamstats`, filtered strictly to matches before the cutoff timestamp.
6. Rebuild tuples and compute fresh projections:
   - base projection via `computeBaseProjection()`
   - multifactor projection via `computeMultifactorProjection()`
7. Recompute EV for the configured formulas and apply the current `display` order from `formulaConfig.js`.
8. Keep only positive-EV selections and score realized ROI on the settled outcomes.

## Important constraint

`blendWeight` currently appears to affect `baseResult.blended`, while the current base EV path uses `baseResult.prob`. That means `blendWeight` may be inert for the currently selected base formula.

The raw replay loop should still support `blendWeight` mutations, but it must make no hidden assumptions:

- if a `blendWeight` mutation does not change replay output, log it as a no-op/discard
- do not rewrite app formula behavior inside research just to make `blendWeight` look active

## Loop shape

Keep the existing `display` autoloop unchanged and add a new loop:

- `scripts/formula_raw_replay_eval.js`
- `scripts/research_formula_params_autoloop.js`
- `research/formula-param-results.tsv`
- `research/formula-param-program.md`

This loop should:

- create a dedicated branch such as `autoresearch-formula-params/<tag>`
- baseline with the raw replay eval
- mutate only `lib/backtest/formulaConfig.js`
- keep/discard based on realized ROI with guardrails on sample size
- commit only kept changes

## First mutation set

Start small and interpretable:

- `cornerKicks.multifactor.leagueWeight`
- `yellowCards.multifactor.leagueWeight`
- `cornerKicks.blendWeight`
- `totalShots.blendWeight`
- `yellowCards.blendWeight`

Use discrete steps rather than a wide random search.

## Success criteria

- raw replay eval returns JSON and exits cleanly
- snapshot lines are joined to settled outcomes without future leakage
- parameter loop can baseline, mutate, evaluate, restore, and commit
- no-op parameter changes are reported clearly
- `npm run test:research` and `npm run build` still pass
