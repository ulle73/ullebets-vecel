## Database Collections Reference

**MongoDB Collections** (use EXACT names):

| Collection Name | Purpose | Usage |
|----------------|---------|-------|
| `match-for-date` | Match fixtures by date | Primary fixtures source |
| `teamstats` | Team statistics & match history | Data for EV calculations, score hydration |
| `teamprofiles` | Team profiles (home/away) | EV calculation input |
| `teamprofiles-legacy` | ⛔ **DO NOT USE** | Deprecated, use `teamprofiles` |
| `matchups-score` | Matchup scores | AI combo generation input |
| `matchups-league-avg` | League average matchups | AI combo generation input |
| `ai-generated-bets` | AI-generated bet combos | Output from generate-ai-user-combos |
| `unibet-backtest` | Unibet backtest results | Historical backtest data |
| `leagues-and-teams` | League & team configuration | Team aliases, league IDs |
| `job_state` | Job execution state | Tracking last run times |

> **⚠️ CRITICAL**: Collection name `leagues-and-teams` (with hyphens) is different from the data file `leagues-and-teams.json`. Always use the correct collection name in queries.

---

## Refactoring Note: Fixtures Engine Strategy

**CRITICAL RULE for `lib/engines/fixtures-engine.js`:**

✅ **Primary**: Database (`match-for-date` collection)  
✅ **Fallback**: API (`/api/matches/by-date`)  
❌ **NEVER**: Unibet listView as fixtures source

Unibet listView is **ONLY** for odds discovery, NOT for fixture data. If both DB and API fail, throw a clear error—don't improvise.
