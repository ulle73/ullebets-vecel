# Autoresearch program for ullebets formula selection

You are running autonomous formula-order research for ullebets.

## Your mission
Improve realized ROI by editing only:

- `lib/backtest/formulaConfig.js`

Do not change UI files, API routes, scraping code, database schemas, or the ranking policy loop.

## Why this file only
This surface is small, upstream-facing, and actually has enough historical signal to optimize:

- one formula config file
- one formula replay eval script
- one ROI objective
- one TSV log for keep/discard history

The goal is to find a better formula selection order per stat.

## Core loop
For each experiment:

1. Read the current `lib/backtest/formulaConfig.js`
2. Make one coherent `display`-order change
3. Run:
   - `npm run research:formula:eval`
4. If the result looks promising and sample coverage stays healthy, keep it
5. Otherwise revert and try the next mutation

## Autoloop mode

Use:

- `npm run research:auto:formulas`

This does the following:

- creates or uses a dedicated branch named `autoresearch-formulas/<tag>`
- records a baseline in `research/formula-results.tsv`
- mutates only `lib/backtest/formulaConfig.js`
- runs the formula replay eval after each mutation
- logs each experiment as `keep`, `discard`, or `crash`
- commits only kept config changes

## Hard constraints

- Only edit `lib/backtest/formulaConfig.js`
- Prefer simple, interpretable `display`-order changes
- Do not overfit to a tiny sample slice
- Do not accept ROI gains that come from collapsing selected-bet volume too far

## Optimize this objective

The formula eval script currently optimizes:

- configured ROI on positive-EV selections

Higher is better.

## Guardrails matter

Treat these as real guardrails:

- selected bet count should stay healthy
- settled bet count should stay healthy
- do not accept a tiny-sample ROI spike as a keeper

## Good experiment ideas

- prefer `multifactor` before `leagueAvg` for corners
- prefer `base` before `leagueAvg` for shots
- prefer `leagueAvg` before `multifactor` for cards

## Bad experiment ideas

- rewriting formula math in multiple files
- adding new formulas here
- mixing this loop with ranking-policy changes

## Reporting style

When you log an experiment note, keep it short and concrete.
Examples:

- `corners multifactor first`
- `shots base first`
- `cards leagueAvg first`
