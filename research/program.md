# Autoresearch program for ullebets ranking policy

If you want to run formula-selection research instead of ranking-policy research, use:

- `research/formula-program.md`

You are running autonomous policy research for ullebets.

## Your mission
Improve the ranking quality of shortlist selection by editing **only**:

- `lib/backtest/rankingPolicy.js`

Do not change UI files, API routes, scraping code, or database schemas unless a human explicitly asks for it.

## Why this file only
This repo is intentionally set up so the research loop can stay small and reviewable:

- one policy file to edit
- one replay/eval script to run
- one scalar score to optimize
- one TSV log to append to

The goal is not to build new features. The goal is to find a better ranking policy.

## Core loop
For each experiment:

1. Read the current `lib/backtest/rankingPolicy.js`
2. Make one coherent policy change
3. Run:
   - `npm run research:eval`
4. If the result looks promising and guardrails stay healthy, log it with:
   - `npm run research:run -- --status keep --note "short note here"`
5. Keep the change only if it improves the objective in a believable way
6. Otherwise revert and try another change

## Autoloop mode

If you want the repo to behave more like the original `karpathy/autoresearch` flow, use:

- `npm run research:auto`

This does the following:

- creates or uses a dedicated branch named `autoresearch/<tag>`
- records a baseline in `research/results.tsv`
- mutates only `lib/backtest/rankingPolicy.js`
- runs the replay eval after each mutation
- logs each experiment as `keep`, `discard`, or `crash`
- commits only kept policy changes

Default focus in `research:auto` is ROI, because this repo's user goal is to improve betting return while still avoiding guardrail regressions.

## Hard constraints
- Only edit `lib/backtest/rankingPolicy.js`
- Keep the policy simple and interpretable
- Do not overfit to one weird metric spike
- Do not accept experiments that break guardrails just because research_score improved a little
- Prefer stable, repeatable gains over flashy one-off jumps

## Optimize this objective
The eval script computes `research_score` from:

- beat close % on top picks
- average CLV on top picks
- settled ROI on top picks

Higher is better.

## Guardrails matter
Treat these as serious:

- proof coverage should not collapse
- number of picked dates should stay healthy
- number of picked bets should stay healthy
- avoid policies that make the system too narrow or too volatile

## Good experiment ideas
- adjust balanced strategy weights
- change how much proof matters
- change how much learning adjustment matters
- tweak market priors
- tweak price-shaping and edge-shaping constants
- tune safe / aggressive / corners / shots profiles

## Bad experiment ideas
- rewriting the whole system
- adding lots of new branches or complexity
- making the score depend on hidden magic constants everywhere
- optimizing for one metric while the others clearly degrade

## Keep/discard rule
Keep a change if:
- research_score improves
- guardrails remain OK
- the policy is still easy to understand

Discard a change if:
- research_score gets worse
- guardrails fail
- gains are too tiny to justify extra complexity
- the policy becomes harder to reason about without clear benefit

## Reporting style
When you log an experiment note, keep it short and concrete.
Examples:
- `raised balanced proof weight, lower price weight`
- `corners prior down, shots on target prior up`
- `more conservative learning threshold`

## Human reminder
The human should review diffs and the TSV log periodically. This is a keep/discard overnight policy-research loop, not a fully trusted self-modifying app.
