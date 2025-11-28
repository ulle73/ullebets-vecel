# ULLEBETS REFACTORING PLAN - Engine-Driven Architecture

> **Document Status**: Draft v1  
> **Created**: 2025-11-28  
> **Purpose**: Comprehensive refactoring plan to transform the Ullebets project from a patchwork of duplicate logic into a clean, modular,engine-driven architecture

---

## Executive Summary

The Ullebets project currently suffers from extensive code duplication across multiple scripts (`run-unibet-backtests.js`, `run-unibet-closing.js`, `run-unibet-forward-backtests.js`, `generate-ai-user-combos.js`, etc). Each script implements similar logic for:

- **Key generation** (`buildBetKey`, `buildComboId`, `buildMatchSlug`) - duplicated in 4+ files
- **Match lookup & fixtures fetching** - different implementations in each script
- **Unibet event discovery** - partially shared via `findUnibetEventForMatch`
- **Odds fetching & mapping** - `mapUnibetOdds` is shared but integration differs
- **EV calculation pipeline** - `calculateEVFromData` exists but data prep differs everywhere
- **Team name normalization & aliasing** - duplicated normalization logic
- **Date/timezone handling** - multiple implementations
- **DB writes & snapshots** - each script has its own structure

**Goal**: Create a unified, engine-driven architecture where:
1. All business logic lives in reusable modules
2. Scripts become thin orchestrators that call shared engines
3. Frontend and backend use identical ID/key generation
4. No functionality is lost during refactoring

---

## Current Pain Points (Detailed Analysis)

> **🔑 CRITICAL FINDING**: The mainpage flow (`LeagueTable.jsx` → `BacktestPage.jsx` → `/api/backtest` route's `handleAutoUnibetOdds`) **WORKS PERFECTLY** for all matches. The `/ai/user` route uses a different implementation and **fails for some matches**. All engines MUST follow the proven working pattern from `/api/backtest/route.js:150-198`.

### 1. **Key Generation Duplication**

**Files affected**:
- `scripts/run-unibet-backtests.js` (line 285)
- `scripts/run-unibet-closing.js` (line 133)
- `scripts/run-unibet-forward-backtests.js` (line 134)
- `scripts/generate-ai-user-combos.js` (line 196)

**Problem**: Each implements `buildBetKey()` slightly differently, leading to:
- ID mismatches between frontend/backend
- Combo matching failures
- Debugging nightmares

**Duplication count**: 4 identical implementations (600+ lines total)

### 2. **Match Lookup & Fixtures Fetching**

**Files affected**:
- `lib/repos/fixtures.js` - nascent, proper fallback chain
- `scripts/run-unibet-backtests.js` - `fetchFixturesByDate()` with own logic
- `scripts/generate-ai-user-combos.js` - calls API directly
- `scripts/update-teams-v2.js` - has its own event normalization

**Problem**: 
- No single source of truth for "get matches for date"
- Different fallback strategies (DB → API → listView vs API only, etc.)
- Score hydrationembedded in some, missing in others

**Duplication count**: 3+ complete implementations

### 3. **Unibet Event Discovery & Odds Fetching**

**Current state**:
- `lib/backtest/unibetAuto.js` - `findUnibetEventForMatch()` is shared ✅
- `UNIBET_EVENT_BASE_URL` defined in unibetAuto but also duplicated elsewhere
- Odds fetching (`fetchEventOdds`) duplicated in backtests vs closing vs forward
- League filtering logic (groupId matching) duplicated

**Problem**: 
- Halfway there (shared discovery) but odds fetch integration varies
- Different retry/sleep logic in each script
- Cache strategies differ

### 4. **EV Calculation Pipeline**

**Current state**:
- `lib/backtest/engine.js` - `calculateEVFromData()` ✅ and `computeExpectedValue()` exist
- Data prep (`fetchTeamProfilesBundle`, `fetchTeamMatches`) is in `lib/backtest/data.js` ✅
- BUT: Each script has its own `ensureTeamData()`, `runEvCalculation()`, `buildBetParams()`

**Problem**:
- The engine exists, but scripts don't use it uniformly
- Team data caching duplicated
- Param building duplicated (varies in defaults)

### 5. **Team Name Normalization & Aliases**

**Implementations**:
- `scripts/run-unibet-backtests.js` - `normalizeTeamName()`, `buildAliasMap()`, `canonicalizeTeamName()`
- `scripts/update-teams-v2.js` - `normalizeKey()` (same thing, different name!)
- `components/backtest/teamNameAliases.js` - shared alias list ✅
- `lib/teamNameAliases.js` - another file with similar purpose

**Problem**: Same normalization function written 3+ times with slight variations

### 6. **Date/Timezone Handling**

**Implementations**:
- `scripts/run-unibet-backtests.js` - `coerceDate()`, `formatDateInZone()`, `isSameDay()`
- `scripts/update-teams-v2.js` - `ymdUTC()`, `addDaysUTC()`, `parseYmdStrict()`
- `lib/utils/date.js` - supposedly the shared date utils but underused

**Problem**: Date logic scattered, not reused

### 7. **Odds Mapping & Tuple Building**

**Current state**:
- `components/backtest/unibetOddsMapper.js` - ✅ GOOD, shared across all scripts
- But integration (calling it, interpreting results) varies

**Not broken, but**: Different scripts apply different filtering on top of tuples

---

## Proposed Architecture

### New Directory Structure

```
lib/
├── core/                          # NEW: Core business logic engines
│   ├── keys.js                    # Unified key generation (betKey, comboId, slug)
│   ├── normalization.js           # Team/league name normalization
│   ├── date.js                    # Date/timezone utilities (enhanced)
│   └── constants.js               # Shared constants
│
├── engines/                       # NEW: High-level engines
│   ├── fixtures-engine.js         # Match lookup with fallback chain
│   ├── unibet-engine.js           # Unibet event discovery + odds fetch
│   ├── ev-engine.js               # EV calculation orchestration
│   └── combo-engine.js            # Combo building logic
│
├── repos/                         # Existing, enhance
│   ├── fixtures.js                # ✅ Keep & enhance
│   ├── teamstats.js               # ✅ Keep
│   ├── unibet.js                  # NEW: Unibet-specific data access
│   └── snapshots.js               # NEW: Snapshot read/write
│
├── backtest/                      # Existing, cleanup
│   ├── engine.js                  # ✅ Keep as is (EV core)
│   ├── data.js                    # ✅ Keep (team profiles/matches)
│   ├── unibetAuto.js              # ✅ Keep but move some to engines/
│   └── ... (other backtest utilities)
│
└── utils/                         # Existing, consolidate
    ├── date.js                    # Merge all date logic here
    ├── teamNameAliases.js         # Move normalization here
    └── ... (keep existing)
```

---

## Refactoring Phases

### **Phase 1: Core Utilities Consolidation** (Foundation)

**Goal**: Create single source of truth for basic operations

#### 1.1: Create `lib/core/keys.js`

**Functionality**:
```javascript
export function buildBetKey({ matchId, homeTeam, awayTeam, stat, scope, period, line, over, form, neutralGround })
export function buildComboId(betKeys) // sorted concatenation
export function buildMatchSlug(homeTeam, awayTeam, date)
export function buildLineKey({ matchId, statKey, period, scope, direction })
```

**Migrate from**: All 4 scripts with `buildBetKey` implementations

**Test strategy**: 
- Unit tests with examples from existing scripts
- Ensure ID format matches current production

#### 1.2: Create `lib/core/normalization.js`

**Functionality**:
```javascript
export function normalizeTeamName(name)
export function normalizeLeagueName(name)
export function slugifyName(name)
export function generateNameVariants(name)
export function generateLeagueVariants(name)
export function buildAliasMap(leaguesData, customAliases)
export function resolveTeamName(name, aliasMap)
export function canonicalizeTeamName(name, aliasMap)
```

**Migrate from**: 
- `scripts/run-unibet-backtests.js` (lines 52-199)
- `scripts/update-teams-v2.js` (`normalizeKey`, `createLookupSets`, etc.)

#### 1.3: Enhance `lib/utils/date.js`

**Functionality** (merge all date logic):
```javascript
export function coerceDate(value) // from unibet-backtests
export function formatDateInZone(date, timezone) // from unibet-backtests
export function isSameDay(dateA, dateB, timezone) // from unibet-backtests
export function ymdUTC(date) // from update-teams-v2
export function addDaysUTC(date, days) // from update-teams-v2
export function parseYmdStrict(value) // from update-teams-v2
```

**Test strategy**: Important! Date bugs are critical

---

### **Phase 2: Data Access Layer** (Repository Pattern)

**Goal**: Thin, predictable data access with consistent fallback chains

#### 2.1: Enhance `lib/repos/fixtures.js`

**Current**: Already has good fallback chain (DB → file → API)

**Add**:
- Method: `getMatchById(matchId, options)` - fetch single match
- Method: `getMatchesByIds(matchIds, options)` - batch fetch
- Better score hydration hook (currently has `hydrateScoresFromTeamstats`)
- Config for fallback order (env-driven)

#### 2.2: Create `lib/repos/unibet.js`

**Purpose**: Centralize all Unibet API calls

**Functionality**:
```javascript
export async function findUnibetEvent(matchInfo, options) // wraps unibetAuto
export async function fetchUnibetOdds(eventId, options)
export async function fetchUnibetListView(options)
export function buildListViewUrl(params)
export function buildEventOddsUrl(eventId, params)
```

**Migrate from**:
- `lib/backtest/unibetAuto.js` (keep core logic there, thin wrapper here)
- URL builders from `run-unibet-backtests.js`

#### 2.3: Create `lib/repos/snapshots.js`

**Purpose**: Consistent snapshot reading/writing across all scripts

**Functionality**:
```javascript
export async function writeSnapshot({
  collection, 
  id, 
  type, // 'backtest'|'forward'|'closing'|'ai-user'
  date, 
  lines, 
  metadata
})
export async function readSnapshots(collection, id, options)
export async function readLatestSnapshot(collection, id)
```

**Standardize snapshot schema**:
```javascript
{
  _id: string,
  date: string,
  type: 'backtest'|'forward'|'closing',
  snapshots: [
    {type, fetchedAt, lines: [{betKey, ...line}, ...]}
  ]
}
```

---

### **Phase 3: Engine Layer** (Business Logic)
  // Batch version with shared team data caching
}
```

**Migrate from**: `ensureTeamData`, `runEvCalculation`, `buildBetParams` from multiple scripts

#### 3.4: Create `lib/engines/combo-engine.js`

**Purpose**: Combo building with unified key generation

**Functionality**:
```javascript
export function buildCombos(lines, options) {
  // Existing logic from generate-ai-user-combos.js
  // But uses lib/core/keys for comboId
}

export function canAddLineToCombo(currentLines, candidate) // shared rule
```

**Migrate from**: `scripts/generate-ai-user-combos.js` (lines 111-194)

---

### **Phase 4: Script Refactoring** (Thin Orchestrators)

**Goal**: Rewrite scripts to use engines, eliminate duplication

#### 4.1: Refactor `scripts/run-unibet-backtests.js`

**Before**: 940 lines, lots of duplication  
**After**: ~300 lines, clean orchestration

**New structure**:
```javascript
import { buildBetKey } from '../lib/core/keys.js'
import { getMatchesForDate } from '../lib/engines/fixtures-engine.js'
import { getUnibetOddsForMatches } from '../lib/engines/unibet-engine.js'
import { calculateEvForBets } from '../lib/engines/ev-engine.js'
import { writeSnapshot } from '../lib/repos/snapshots.js'

async function main(date) {
  // 1. Get matches for date (engine handles fallbacks)
  const matches = await getMatchesForDate(date, { source: 'db-first' })
  
  // 2. Filter by league config
  const filtered = filterByLeagues(matches, leagues)
  
  // 3. Get Unibet odds for all (engine handles discovery + fetch)
  const withOdds = await getUnibetOddsForMatches(filtered, { concurrency: 3 })
  
  // 4. Build bets from tuples
  const bets = buildBetsFromOdds(withOdds)
  
  // 5. Calculate EV (engine handles data fetching + caching)
  const results = await calculateEvForBets(bets, { parallel: true })
  
  // 6. Build lines with betKey
  const lines = results.map(r => ({ betKey: buildBetKey(...), ...r }))
  
  // 7. Write snapshot (repo handles schema)
  await writeSnapshot({ type: 'backtest', date, lines })
}
```

#### 4.2: Refactor `scripts/run-unibet-closing.js` & `run-unibet-forward-backtests.js`

**Same pattern**: Use same engines, differ only in:
- Snapshot type (`closing` vs `forward`)
- Timing logic (when to run)
- Filtering criteria

**Goal**: <50% code duplication (only orchestration differs)

#### 4.3: Refactor `scripts/generate-ai-user-combos.js`

**Before**: 744 lines  
**After**: ~400 lines (combo logic moved to engine)

**New structure**:
```javascript
import { buildComboId } from '../lib/core/keys.js'
import { buildCombos } from '../lib/engines/combo-engine.js'
import { getMatchesForDate } from '../lib/engines/fixtures-engine.js'
import { getUnibetOddsForMatches } from '../lib/engines/unibet-engine.js'
import { calculateEvForBets } from '../lib/engines/ev-engine.js'

async function main(date) {
  // Steps 1-2: Fetch matches + matchups (same as before)
  const { matches, matchups } = await fetchMatchesAndMatchups(date)
  
  // Step 3: Get Unibet odds (now uses engine)
  const withOdds = await getUnibetOddsForMatches(targetMatches)
  
  // Step 4: Calculate EV (now uses engine)
  const results = await calculateEvForBets(bets)
  
  // Step 5: Build combos (now uses engine)
  const combos = buildCombos(+evLines, {legs: 2, maxCombos: 50})
  
  // Step 6: Assign comboId to each
  const withIds = combos.map(c => ({ ...c, comboId: buildComboId(c.lines) }))
  
  // Step 7: Save to DB
  await saveAiGeneratedBets(withIds)
}
```

#### 4.4: Update `scripts/update-teams-v2.js`

**Goal**: Use shared normalization & key generation

**Changes**:
- Import `normalizeTeamName` from `lib/core/normalization.js`
- Import `buildMatchSlug` from `lib/core/keys.js`
- Remove local implementations

**Impact**: -200 lines of duplication

---

### **Phase 5: Frontend Integration** (Consistency)

**Goal**: Frontend uses exact same key generation as backend

#### 5.1: Update Frontend Combo Builder

**Files**:
- `ai/components/AIWorkspace.jsx` (or similar)
- Anywhere combos are built client-side

**Changes**:
- Import `buildBetKey`, `buildComboId` from `lib/core/keys.js`
- Ensure client-side generated IDs match backend exactly

#### 5.2: Update Frontend Match Display

**Consistency**:
- Use same `buildMatchSlug` for URLs
- Use same `normalizeTeamName` for team lookups

---

## Migration Strategy

### Rollout Order (Critical Path)

1. **Phase 1** (Core Utils) - 2-3 days
   - Start with `lib/core/keys.js` (HIGH PRIORITY - affects everything)
   - Then `lib/core/normalization.js`
   - Then consolidate date utils
   - **Checkpoint**: Unit tests for all core utils

2. **Phase 2** (Repos) - 2-3 days
   - Create `repos/unibet.js` and `repos/snapshots.js`
   - Enhance `repos/fixtures.js`
   - **Checkpoint**: Integration tests for repos

3. **Phase 3** (Engines) - 3-4 days
   - Build engines one by one (fixtures → unibet → ev → combo)
   - **Checkpoint**: Each engine has integration tests

4. **Phase 4** (Scripts) - 4-5 days
   - Refactor ONE script at a time
   - Test thoroughly before moving to next
   - Order: `run-unibet-backtests` → `generate-ai-user-combos` → closing/forward
   - **Checkpoint**: Each refactored script runs successfully in production

5. **Phase 5** (Frontend) - 2 days
   - Update client-side code to use shared keys
   - **Checkpoint**: E2E tests pass, IDs match

### Safety Measures

1. **No functionality loss**:
   - Keep old script versions as `*.old.js` during migration
   - Run both old & new in parallel for 1 week
   - Compare outputs

2. **Gradual rollout**:
   - Start with `run-unibet-backtests` (most duplicated)
   - Only proceed to next script when previous is stable

3. **Database compatibility**:
   - New `betKey` format must match old format exactly
   - Add migration script to verify existing DB data still works

4. **Monitoring**:
   - Log every engine call
   - Track cache hit rates
   - Alert on any ID mismatches

---

## Expected Benefits

### Quantitative:
- **-40%** total lines of code (~8,000 → ~4,800)
- **-80%** duplication (4 `buildBetKey` → 1)
- **+200%** test coverage (engines are unit-testable)
- **-50%** bug fix time (fix once, applies everywhere)

### Qualitative:
- **Maintainability**: New logic goes in engine, not copy-pasted
- **Consistency**: Frontend/backend guaranteed to use same IDs
- **Testability**: Engines can be tested in isolation
- **Debuggability**: Single source of truth for each operation
- **Onboarding**: New developers understand architecture faster

---

## Risks & Mitigation

### Risk 1: Breaking Changes
**Mitigation**: 
- Side-by-side execution (old + new scripts)
- Extensive testing before cutover

### Risk 2: Performance Regression
**Mitigation**:
- Profile engine performance
- Ensure caching is effective
- Benchmark before/after

### Risk 3: Incomplete Migration
**Mitigation**:
- Phased rollout with strict checkpoints
- Don't start Phase N+1 until Phase N is complete

### Risk 4: Loss of Nuan
