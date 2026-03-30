# Formula Autoloop Design

## Goal

Add a second upstream-style autoresearch loop that targets `lib/backtest/formulaConfig.js`, because this repo has materially more historical signal for formula selection than for ranking-policy replay.

## Scope

The new loop should:

- mutate only `formulaConfig.js`
- evaluate with `scripts/formula-ev-check.js`
- keep/discard based on configured ROI
- log to a separate TSV file
- commit only kept changes

## Key constraint

Historical backtest rows already contain finished formula outputs in `evDetails`, but not enough raw state to truthfully recompute every base-projection parameter. Because of that, the first version of the loop should optimize configured `display` order, not raw `blendWeight`.

## Design

1. Extend the existing generic research helpers so they can mutate string arrays, not just numeric literals.
2. Add a small `formula_research_core.js` helper that picks the configured primary formula the same way the app does.
3. Add JSON output to `formula-ev-check.js` so an autoloop can consume it.
4. Add `research_formula_autoloop.js` that mirrors the original keep/discard branch flow.
5. Keep logs separate in `research/formula-results.tsv`.

## Success criteria

- `npm run research:formula:eval` returns machine-readable JSON
- `npm run research:auto:formulas` can baseline, mutate, evaluate, restore, and commit
- the loop avoids duplicate proposals within one run
- no changes are required outside the formula research surface
