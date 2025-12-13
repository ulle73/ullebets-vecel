// /**
//  * Skew validator: vilka lag/stat/period/scope överpresterar sina linjer.
//  * Läser alla unibet-backtest (DB + disk) och grupperar i oddsintervall.
//  * För varje bucket listar vi lag/stat/period/scope med högst träffprocent.
//  */

// import fs from 'fs/promises';
// import path from 'path';
// import clientPromise from '../lib/mongo.js';

// // ==================== KONFIG ====================
// const BACKTESTS_DIR = process.env.BACKTESTS_DIR || "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";
// const MIN_SAMPLE = 5;      // min antal linjer per rad
// const MIN_MATCHES = 3;     // min antal unika matcher per rad

// // Oddsintervall med namn = intervallet
// const ODDS_BUCKETS = [
//   { label: '1.01-1.50', min: 1.01, max: 1.50 },
//   { label: '1.51-1.80', min: 1.51, max: 1.80 },
//   { label: '1.81-2.20', min: 1.81, max: 2.20 }, // even-ish
//   { label: '2.21-3.00', min: 2.21, max: 3.00 },
//   { label: '3.01-5.00', min: 3.01, max: 5.00 },
//   { label: '5.01-10.00', min: 5.01, max: 10.00 },
//   { label: '10.01+', min: 10.01, max: Infinity },
// ];

// // Stat och scope att inkludera (kanoniska nycklar)
// const PROPS = ['totalShotsOnGoal', 'shotsOnGoal', 'cornerKicks', 'offsides', 'fouls', 'yellowCards'];
// const SCOPES = ['home', 'away'];
// const PERIODS = ['ALL', '1ST', '2ND'];
// const SCEW_SCORE_SCALE = 75; // higher = slower saturation of score curve

// const STAT_ALIASES = new Map([
//   ['totalshotsongoal','totalShotsOnGoal'],
//   ['total_shots_on_goal','totalShotsOnGoal'],
//   ['totalshots_on_goal','totalShotsOnGoal'],
//   ['totalshots','totalShotsOnGoal'],
//   ['total_shots','totalShotsOnGoal'],
//   ['totalshotsontarget','totalShotsOnGoal'],
//   ['total_shots_on_target','totalShotsOnGoal'],
// ]);

// function normalizeStatKeyName(statKey) {
//   if (!statKey) return null;
//   const raw = String(statKey).trim();
//   const lower = raw.toLowerCase();
//   const alias = STAT_ALIASES.get(lower);
//   return alias || raw;
// }

// function parseArgs() {
//   const args = process.argv.slice(2);
//   return {
//     saveProfiles: args.includes('--save-profiles') || args.includes('-s'),
//   };
// }

// // ==================== HJÄLPARE ====================

// function getBucketLabel(odds) {
//   if (!Number.isFinite(odds) || odds <= 0) return null;
//   for (const bucket of ODDS_BUCKETS) {
//     if (odds >= bucket.min && odds <= bucket.max) return bucket.label;
//   }
//   return null;
// }

// function normalizeCondition(condition) {
//   if (!condition) return null;
//   const c = String(condition).toLowerCase();
//   if (c.includes('över') || c === 'over') return 'over';
//   if (c.includes('under')) return 'under';
//   return null;
// }

// function toScewScore(row, direction) {
//   // Map factor (magnitude) to a bounded score [-10, 10] and inject sign for direction.
//   // Arctan gives a smooth saturation so monster factors don't explode the scale.
//   const factor = row?.factor ?? 0;
//   const signed = (direction === 'under' ? -1 : 1) * factor;
//   const normalized = (2 / Math.PI) * Math.atan(signed / SCEW_SCORE_SCALE); // [-1, 1]
//   const scaled = normalized * 10; // [-10, 10]
//   if (!Number.isFinite(scaled)) return 0;
//   return Math.max(-10, Math.min(10, scaled));
// }

// // Faktor-beräkning används både för bucket-rader och overall-rader.
// function scoreRow(r) {
//   const base = (r.hitDiff ?? 0) * 0.5 + (r.roi ?? 0) * 0.3 + (r.relBias ?? 0) * 0.2;
//   // Viktar matcher högre än lines för att minska “tur i en match”
//   const matchWeight = Math.pow(Math.log1p(r.matches ?? 0), 2);
//   const lineWeight = Math.log1p(r.total ?? 0) * 0.5; // dämpa lines
//   return base * (matchWeight + lineWeight);
// }

// async function collectFiles(dir) {
//   try {
//     const entries = await fs.readdir(dir, { withFileTypes: true });
//     const files = [];
//     for (const entry of entries) {
//       const full = path.join(dir, entry.name);
//       if (entry.isDirectory()) {
//         files.push(...(await collectFiles(full)));
//       } else if (entry.name.endsWith('.json')) {
//         files.push(full);
//       }
//     }
//     return files;
//   } catch (err) {
//     console.warn(`⚠️  Could not read disk directory ${dir}: ${err.message}`);
//     return [];
//   }
// }

// async function loadBacktestsFromDisk(dir) {
//   const files = await collectFiles(dir);
//   const docs = [];
//   for (const file of files) {
//     try {
//       const txt = await fs.readFile(file, 'utf-8');
//       const parsed = JSON.parse(txt);
//       const lines = Array.isArray(parsed) ? parsed : parsed.lines || [];
//       docs.push({
//         ...parsed,
//         lines,
//         source: 'disk',
//       });
//     } catch {
//       continue;
//     }
//   }
//   return docs;
// }

// function initAgg(bucket, stat, period, scope, team) {
//   return {
//     bucket,
//     stat,
//     period,
//     scope,
//     team,
//     directions: new Map(), // over|under -> dirAgg
//   };
// }

// function getDirAgg(parent, direction) {
//   if (!parent.directions.has(direction)) {
//     parent.directions.set(direction, {
//       direction,
//       wins: 0,
//       total: 0, // lines
//       matches: new Set(),
//       sumOdds: 0,
//       sumImplied: 0,
//       sumDev: 0,
//       sumLine: 0,
//       pnl: 0, // flat stake ROI
//     });
//   }
//   return parent.directions.get(direction);
// }

// // ==================== HUVUDLOGIK ====================

// async function main() {
//   const { saveProfiles } = parseArgs();
//   console.log(`\n${'='.repeat(80)}`);
//   console.log(`📊 Skew odds-buckets: vilka lag/stat/period/scope träffar sina spel oftast`);
//   console.log(`${'='.repeat(80)}\n`);

//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || 'app');

//   // Hämta från DB
//   const dbDocs = await db.collection('unibet-backtest').find({
//     'lines.actual': { $ne: null }
//   }).toArray();
//   console.log(`🗄️  Loaded ${dbDocs.length} backtests from MongoDB`);

//   // Hämta från disk
//   const diskDocs = await loadBacktestsFromDisk(BACKTESTS_DIR);
//   console.log(`💾 Loaded ${diskDocs.length} backtests from disk (${BACKTESTS_DIR})`);

//   const allDocs = [...dbDocs, ...diskDocs];
//   console.log(`📦 Total backtests: ${allDocs.length}\n`);

//   // Aggregat: bucket -> stat -> period -> scope -> team -> agg
//   const buckets = new Map();
//   const bestOverallMap = new Map(); // key: team|scope|direction -> best row (högst factor)
//   const bestStatMap = new Map(); // key: team|scope|stat|period|direction -> best row
//   const bucketStatMap = new Map(); // key: team|scope|stat|period|direction -> { [bucketLabel]: row }
//   const overallAggMap = new Map(); // key: team|scope|stat|period|direction -> agg över alla odds
//   const teamScopes = new Set(); // key: team|scope

//   for (const doc of allDocs) {
//     if (!Array.isArray(doc.lines)) continue;

//     for (const line of doc.lines) {
//       if (line.actual == null) continue;
//       const statKey = normalizeStatKeyName(line.statKey);
//       if (!statKey || !PROPS.includes(statKey)) continue;
//       if (!SCOPES.includes(line.scope)) continue;

//       const odds = Number(line.odds);
//       const bucketLabel = getBucketLabel(odds);
//       if (!bucketLabel) continue;

//       const condition = normalizeCondition(line.condition);
//       if (!condition) continue;

//       const deviation = line.actual - line.line;
//       if (Math.abs(deviation) < 1e-9) continue; // push, hoppa

//       const period = line.period || 'ALL';
//       let teamName = null;
//       if (line.scope === 'home') {
//         teamName = line.homeTeam || doc.homeTeam;
//       } else if (line.scope === 'away') {
//         teamName = line.awayTeam || doc.awayTeam;
//       }
//       if (!teamName) continue;

//       const isOver = condition === 'over';
//       const win = isOver ? deviation > 0 : deviation < 0;
//       const matchKey = doc.matchId || doc.eventId || doc.slug || `${doc.homeTeam}-${doc.awayTeam}-${doc.matchDate || doc.date || ''}`;

//       // Hämta/bygg agg
//       if (!buckets.has(bucketLabel)) buckets.set(bucketLabel, new Map());
//       const statMap = buckets.get(bucketLabel);
//       if (!statMap.has(statKey)) statMap.set(statKey, new Map());
//       const periodMap = statMap.get(statKey);
//       if (!periodMap.has(period)) periodMap.set(period, new Map());
//       const scopeMap = periodMap.get(period);
//       if (!scopeMap.has(line.scope)) scopeMap.set(line.scope, new Map());
//       const teamMap = scopeMap.get(line.scope);
//       if (!teamMap.has(teamName)) teamMap.set(teamName, initAgg(bucketLabel, statKey, period, line.scope, teamName));
//       const agg = teamMap.get(teamName);
//       const dirAgg = getDirAgg(agg, condition);

//       dirAgg.total += 1;
//       dirAgg.matches.add(matchKey);
//       dirAgg.sumDev += deviation;
//       dirAgg.sumLine += line.line ?? 0;
//       if (win) {
//         dirAgg.wins += 1;
//         dirAgg.pnl += (Number.isFinite(odds) ? odds - 1 : 0);
//       } else {
//         dirAgg.pnl -= 1;
//       }
//       if (Number.isFinite(odds)) {
//         dirAgg.sumOdds += odds;
//         dirAgg.sumImplied += 1 / odds;
//       }

//       // Aggregera även över alla odds (overall)
//       const overallKey = `${teamName}__${line.scope}__${statKey}__${period}__${condition}`;
//       if (!overallAggMap.has(overallKey)) {
//         overallAggMap.set(overallKey, initAgg('ALL', statKey, period, line.scope, teamName));
//       }
//       const overallAgg = overallAggMap.get(overallKey);
//       const overallDirAgg = getDirAgg(overallAgg, condition);
//       overallDirAgg.total += 1;
//       overallDirAgg.matches.add(matchKey);
//       overallDirAgg.sumDev += deviation;
//       overallDirAgg.sumLine += line.line ?? 0;
//       if (win) {
//         overallDirAgg.wins += 1;
//         overallDirAgg.pnl += (Number.isFinite(odds) ? odds - 1 : 0);
//       } else {
//         overallDirAgg.pnl -= 1;
//       }
//       if (Number.isFinite(odds)) {
//         overallDirAgg.sumOdds += odds;
//         overallDirAgg.sumImplied += 1 / odds;
//       }
//     }
//   }

//   // Bygg lista för utskrift
//   for (const bucket of ODDS_BUCKETS) {
//     const label = bucket.label;
//     const statMap = buckets.get(label);
//     if (!statMap) continue;

//     const rows = [];
//     for (const [statKey, periodMap] of statMap.entries()) {
//       for (const [period, scopeMap] of periodMap.entries()) {
//         for (const [scope, teamMap] of scopeMap.entries()) {
//           for (const [, agg] of teamMap.entries()) {
//             for (const [, dirAgg] of agg.directions.entries()) {
//               if (dirAgg.total < MIN_SAMPLE) continue;
//               if (dirAgg.matches.size < MIN_MATCHES) continue;
//               const winPct = (dirAgg.wins / dirAgg.total) * 100;
//               const avgOdds = dirAgg.sumOdds / dirAgg.total;
//               const avgImplied = dirAgg.sumImplied > 0 ? (dirAgg.sumImplied / dirAgg.total) * 100 : null;
//               const hitDiff = avgImplied != null ? winPct - avgImplied : null;
//               const roi = dirAgg.total > 0 ? (dirAgg.pnl / dirAgg.total) * 100 : null;
//               const bias = dirAgg.total > 0 ? dirAgg.sumDev / dirAgg.total : null;
//               const avgLine = dirAgg.total > 0 ? dirAgg.sumLine / dirAgg.total : null;
//               const relBias = avgLine ? (bias / avgLine) * 100 : null;
//               rows.push({
//                 team: agg.team,
//                 stat: statKey,
//                 period,
//                 scope,
//                 bucket: label,
//                 direction: dirAgg.direction,
//                 winPct,
//                 total: dirAgg.total,
//                 matches: dirAgg.matches.size,
//                 wins: dirAgg.wins,
//                 avgOdds,
//                 avgImplied,
//                 hitDiff,
//                 roi,
//                 bias,
//                 relBias,
//               });
//             }
//           }
//         }
//       }
//     }

//     if (rows.length === 0) continue;
//     rows.forEach(r => { r.factor = r.matches >= MIN_MATCHES ? scoreRow(r) : null; });

//     const overRows = rows.filter(r => r.direction === 'over').sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0) || b.winPct - a.winPct || (b.hitDiff ?? 0) - (a.hitDiff ?? 0) || b.total - a.total);
//     const underRows = rows.filter(r => r.direction === 'under').sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0) || b.winPct - a.winPct || (b.hitDiff ?? 0) - (a.hitDiff ?? 0) || b.total - a.total);

//     const widths = {
//       team: 23,
//       stat: 14,
//       per: 4,
//       scope: 5,
//       dir: 5,
//       nLines: 8,
//       nMatches: 10,
//       win: 6,
//       diff: 6,
//       roi: 6,
//       odds: 8,
//       imp: 6,
//       bias: 6,
//       relBias: 7,
//       factor: 8,
//     };

//     const header = [
//       'Team'.padEnd(widths.team),
//       'Stat'.padEnd(widths.stat),
//       'Per'.padEnd(widths.per),
//       'Scope'.padEnd(widths.scope),
//       'Dir'.padEnd(widths.dir),
//       'N lines'.padStart(widths.nLines),
//       'N matches'.padStart(widths.nMatches),
//       'Win%'.padStart(widths.win),
//       'Diff'.padStart(widths.diff),
//       'ROI%'.padStart(widths.roi),
//       'AvgOdds'.padStart(widths.odds),
//       'Imp%'.padStart(widths.imp),
//       'Bias'.padStart(widths.bias),
//       'RelBias%'.padStart(widths.relBias),
//       'Factor'.padStart(widths.factor),
//     ].join(' | ');

//     const sep = '-'.repeat(header.length);

//     function printTable(title, arr) {
//       if (!arr.length) return;
//       console.log(`\n${'='.repeat(header.length)}`);
//       console.log(`🎯 Bucket ${label} – ${title} (min ${MIN_SAMPLE} lines och ${MIN_MATCHES} matcher, sorterat på Factor)`);
//       console.log(`${'='.repeat(header.length)}`);
//       console.log(header);
//       console.log(sep);
//       for (let i = 0; i < Math.min(20, arr.length); i++) {
//         const r = arr[i];
//         const lineStr = [
//           r.team.padEnd(widths.team),
//           r.stat.padEnd(widths.stat),
//           String(r.period).padEnd(widths.per),
//           r.scope.padEnd(widths.scope),
//           r.direction.padEnd(widths.dir),
//           String(r.total).padStart(widths.nLines),
//           String(r.matches).padStart(widths.nMatches),
//           r.winPct.toFixed(1).padStart(widths.win),
//           (r.hitDiff != null ? r.hitDiff.toFixed(1) : 'n/a').padStart(widths.diff),
//           (r.roi != null ? r.roi.toFixed(1) : 'n/a').padStart(widths.roi),
//           (r.avgOdds ?? 0).toFixed(2).padStart(widths.odds),
//           (r.avgImplied ?? 0).toFixed(1).padStart(widths.imp),
//           (r.bias != null ? r.bias.toFixed(2) : 'n/a').padStart(widths.bias),
//           (r.relBias != null ? r.relBias.toFixed(1) : 'n/a').padStart(widths.relBias),
//           (r.factor != null ? r.factor.toFixed(1) : 'n/a').padStart(widths.factor),
//         ].join(' | ');
//         console.log(lineStr);

//         // Uppdatera bästa per lag/scope/direction
//         if (r.factor != null) {
//           const dirKey = `${r.team}__${r.scope}__${r.direction}`;
//           const prevDir = bestOverallMap.get(dirKey);
//           if (!prevDir || (r.factor ?? -Infinity) > (prevDir.factor ?? -Infinity)) {
//             bestOverallMap.set(dirKey, r);
//           }
//         }
//         // Uppdatera bästa per lag/scope/stat/period/direction (för senare strukturell sparning)
//         const statKey = `${r.team}__${r.scope}__${r.stat}__${r.period}__${r.direction}`;
//         const prevStat = bestStatMap.get(statKey);
//         if (!prevStat || ((r.factor ?? -Infinity) > (prevStat.factor ?? -Infinity))) {
//           bestStatMap.set(statKey, r);
//         }
//         teamScopes.add(`${r.team}__${r.scope}`);

//         // Spara per-bucket entry
//         const bucketKey = `${r.team}__${r.scope}__${r.stat}__${r.period}__${r.direction}`;
//         if (!bucketStatMap.has(bucketKey)) {
//           bucketStatMap.set(bucketKey, {});
//         }
//         bucketStatMap.get(bucketKey)[r.bucket] = r;
//       }
//     }

//     printTable('OVER', overRows);
//     printTable('UNDER', underRows);
//   }

//   // Bygg overall-rader (alla odds) för varje stat/period/scope/team/direction
//   const overallRows = new Map(); // key: team|scope|stat|period|direction -> row
//   for (const [key, agg] of overallAggMap.entries()) {
//     for (const [, dirAgg] of agg.directions.entries()) {
//       if (dirAgg.total < MIN_SAMPLE) continue;
//       if (dirAgg.matches.size < MIN_MATCHES) continue;
//       const winPct = (dirAgg.wins / dirAgg.total) * 100;
//       const avgOdds = dirAgg.sumOdds / dirAgg.total;
//       const avgImplied = dirAgg.sumImplied > 0 ? (dirAgg.sumImplied / dirAgg.total) * 100 : null;
//       const hitDiff = avgImplied != null ? winPct - avgImplied : null;
//       const relBias = dirAgg.sumLine ? (dirAgg.sumDev / dirAgg.sumLine) * 100 : null;
//       const bias = dirAgg.sumDev / dirAgg.total;
//       const roi = (dirAgg.pnl / dirAgg.total) * 100;
//       const r = {
//         bucket: 'ALL',
//         stat: agg.stat,
//         period: agg.period,
//         scope: agg.scope,
//         team: agg.team,
//         direction: dirAgg.direction,
//         total: dirAgg.total,
//         wins: dirAgg.wins,
//         matches: dirAgg.matches.size,
//         winPct,
//         hitDiff,
//         roi,
//         bias,
//         relBias,
//         avgOdds,
//         avgImplied,
//         factor: null,
//       };
//       r.factor = scoreRow(r);
//       overallRows.set(`${agg.team}__${agg.scope}__${agg.stat}__${agg.period}__${dirAgg.direction}`, r);
//       const dirKey = `${agg.team}__${agg.scope}__${dirAgg.direction}`;
//       const prevDir = bestOverallMap.get(dirKey);
//       if (!prevDir || ((r.factor ?? -Infinity) > (prevDir.factor ?? -Infinity))) {
//         bestOverallMap.set(dirKey, r);
//       }
//     }
//   }

//   if (saveProfiles && (bestOverallMap.size > 0 || bestStatMap.size > 0)) {
//     console.log('\n💾 Saving scew factors to teamprofiles...');
//     const db = client.db(process.env.MONGODB_DB || 'app');
//     const teamprofilesCol = db.collection('teamprofiles');
//     const ops = [];
//     const now = new Date();

//     // Helper to build neutral payload
//     const neutral = {
//       scewScore: 0,
//       direction: null,
//       factor: null,
//       bucket: null,
//       winPct: null,
//       hitDiff: null,
//       roi: null,
//       bias: null,
//       relBias: null,
//       nLines: 0,
//       nMatches: 0,
//       avgOdds: null,
//       avgImplied: null,
//       updatedAt: now,
//     };

//     // Prepare per team/scope stats structure
//     for (const teamScope of teamScopes) {
//       const [teamName, scope] = teamScope.split('__');
//       const docFilter = { 'meta.lagnamn': teamName, 'meta.matchType': scope };

//       const updatePayload = {};
//       const unsetPayload = { scew: "" };

//       for (const stat of PROPS) {
//         for (const period of PERIODS) {
//           const overKey = `${teamName}__${scope}__${stat}__${period}__over`;
//           const underKey = `${teamName}__${scope}__${stat}__${period}__under`;
//           const overRow = overallRows.get(overKey);
//           const underRow = overallRows.get(underKey);

//           const pickRow = (() => {
//             const overFactor = overRow?.factor ?? -Infinity;
//             const underFactor = underRow?.factor ?? -Infinity;
//             if (!Number.isFinite(overFactor) && !Number.isFinite(underFactor)) return null;
//             return overFactor >= underFactor ? { row: overRow, direction: 'over' } : { row: underRow, direction: 'under' };
//           })();

//           const scewEntry = (() => {
//             if (!pickRow?.row) return { ...neutral };
//             const { row, direction } = pickRow;
//             return {
//               scewScore: toScewScore(row, direction),
//               direction,
//               factor: row.factor ?? null,
//               bucket: row.bucket ?? null,
//               winPct: row.winPct ?? null,
//               hitDiff: row.hitDiff ?? null,
//               roi: row.roi ?? null,
//               bias: row.bias ?? null,
//               relBias: row.relBias ?? null,
//               nLines: row.total ?? 0,
//               nMatches: row.matches ?? 0,
//               avgOdds: row.avgOdds ?? null,
//               avgImplied: row.avgImplied ?? null,
//               updatedAt: now,
//             };
//           })();

//           const path = `statistics.for.${stat}.${period}.scew`;
//           updatePayload[path] = scewEntry;
//           // Per-bucket entries (för odds-bucket match)
//           const bucketOver = bucketStatMap.get(overKey) || {};
//           const bucketUnder = bucketStatMap.get(underKey) || {};
//           const mergedBuckets = { ...bucketOver, ...bucketUnder };
//           const cleanedBuckets = {};
//           for (const [blabel, brow] of Object.entries(mergedBuckets)) {
//             if (!brow) continue;
//             cleanedBuckets[blabel] = {
//               scewScore: toScewScore(brow, brow.direction),
//               direction: brow.direction,
//               factor: brow.factor ?? null,
//               bucket: brow.bucket ?? blabel,
//               winPct: brow.winPct ?? null,
//               hitDiff: brow.hitDiff ?? null,
//               roi: brow.roi ?? null,
//               bias: brow.bias ?? null,
//               relBias: brow.relBias ?? null,
//               nLines: brow.total ?? 0,
//               nMatches: brow.matches ?? 0,
//               avgOdds: brow.avgOdds ?? null,
//               avgImplied: brow.avgImplied ?? null,
//               updatedAt: now,
//             };
//           }
//           if (Object.keys(cleanedBuckets).length) {
//             updatePayload[`statistics.for.${stat}.${period}.scewBuckets`] = cleanedBuckets;
//           }
//         }
//       }
//       updatePayload['statistics.scewUpdatedAt'] = now;

//       ops.push({
//         updateOne: {
//           filter: docFilter,
//           update: {
//             $set: updatePayload,
//             $unset: unsetPayload,
//           },
//         }
//       });
//     }

//     if (ops.length) {
//       const res = await teamprofilesCol.bulkWrite(ops, { ordered: false });
//       console.log(`   ✅ Scew factors saved (matched: ${res.matchedCount}, modified: ${res.modifiedCount})`);
//     } else {
//       console.log('   ℹ️  No scew factors to save');
//     }
//   }

//   console.log('\n✅ Klar');
//   await client.close();
// }

// main().catch(err => {
//   console.error('❌ Fatal error:', err);
//   process.exit(1);
// });

/**
 * Market Bias (OVER-only)
 * -----------------------
 * Measures how often a team beats the market's OVER main line
 * (defined as the OVER line with odds closest to 2.00).
 *
 * Negative bias => UNDER bias
 * Positive bias => OVER bias
 *
 * Writes to:
 * teamprofiles.statistics.for[statKey][period].marketBias
 */

// import fs from "fs/promises";
// import path from "path";
// import clientPromise from "../lib/mongo.js";

// // ================= CONFIG =================

// const BACKTESTS_DIR =
//   process.env.BACKTESTS_DIR ||
//   "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

// const MIN_MATCHES = Number(process.env.MARKET_BIAS_MIN_MATCHES || 3);

// // only team-based
// const SCOPES = ["home", "away"];
// const PERIODS = ["ALL", "1ST", "2ND"];

// // update this list if needed (must match your unibet-backtest statKey values)
// const STATS = ["totalShots", "shotsOnGoal", "cornerKicks", "offsides"];

// // acceptable range for "near 50%" (we select main over line within this window)
// const MIN_ODDS = Number(process.env.MARKET_BIAS_MIN_ODDS || 1.8);
// const MAX_ODDS = Number(process.env.MARKET_BIAS_MAX_ODDS || 2.2);

// // ================= HELPERS =================

// function normalizeCondition(c) {
//   if (!c) return null;
//   const s = String(c).toLowerCase();
//   if (s.includes("över") || s === "over") return "over";
//   return null;
// }

// /**
//  * In your dataset actual & win are on the line object:
//  * lines[i].actual / lines[i].win
//  * Keep fallback to evDetails for safety.
//  */
// function getActual(line) {
//   const v = line?.actual ?? line?.evDetails?.actual;
//   if (v === null || v === undefined) return null;
//   const n = Number(v);
//   return Number.isFinite(n) ? n : null;
// }

// function getMatchKey(doc) {
//   return doc.matchId || doc.eventId || doc.slug;
// }

// function getTeamName(line, doc) {
//   if (line.scope === "home") return doc.homeTeam;
//   if (line.scope === "away") return doc.awayTeam;
//   return null;
// }

// // pick OVER line closest to odds = 2.00 inside odds window
// function selectMainOverLine(candidates) {
//   let best = null;
//   let bestDist = Infinity;

//   for (const c of candidates) {
//     if (!Number.isFinite(c.odds)) continue;
//     if (c.odds < MIN_ODDS || c.odds > MAX_ODDS) continue;

//     const d = Math.abs(c.odds - 2.0);
//     if (d < bestDist) {
//       bestDist = d;
//       best = c;
//     }
//   }

//   return best;
// }

// function clamp01(x) {
//   if (!Number.isFinite(x)) return 0;
//   return Math.max(0, Math.min(1, x));
// }

// // Recursively collect all JSON files in BACKTESTS_DIR
// async function collectJsonFiles(dir) {
//   const out = [];
//   try {
//     const entries = await fs.readdir(dir, { withFileTypes: true });
//     for (const e of entries) {
//       const full = path.join(dir, e.name);
//       if (e.isDirectory()) out.push(...(await collectJsonFiles(full)));
//       else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) out.push(full);
//     }
//   } catch {
//     // ignore
//   }
//   return out;
// }

// // ================= MAIN =================

// async function main() {
//   const client = await clientPromise;
//   const db = client.db(process.env.MONGODB_DB || "app");

//   // ✅ IMPORTANT: your data stores actual at lines[i].actual, so query that
//   const mongoDocs = await db
//     .collection("unibet-backtest")
//     .find({ "lines.actual": { $ne: null } })
//     .toArray();

//   const diskDocs = await loadFromDisk(BACKTESTS_DIR);

//   const allDocs = [...mongoDocs, ...diskDocs];

//   console.log(`🗄️ Loaded ${mongoDocs.length} from MongoDB`);
//   console.log(`💾 Loaded ${diskDocs.length} from disk`);
//   console.log(`📦 Total: ${allDocs.length}`);

//   // Debug counters (so you instantly see why rows might be 0)
//   const dbg = {
//     docs: allDocs.length,
//     lines: 0,
//     linesWithActual: 0,
//     linesStatOk: 0,
//     linesScopeOk: 0,
//     linesPeriodOk: 0,
//     linesOver: 0,
//     candidates: 0,
//     selectedMain: 0,
//     pushes: 0
//   };

//   /**
//    * Per match → collect candidate OVER lines
//    * key = matchKey__team__scope__stat__period
//    */
//   const perMatch = new Map();

//   for (const doc of allDocs) {
//     if (!Array.isArray(doc.lines)) continue;

//     const matchKey = getMatchKey(doc);
//     if (!matchKey) continue;

//     dbg.lines += doc.lines.length;

//     for (const line of doc.lines) {
//       const actual = getActual(line);
//       if (actual == null) continue;
//       dbg.linesWithActual++;

//       const statKey = line.statKey;
//       if (!STATS.includes(statKey)) continue;
//       dbg.linesStatOk++;

//       const scope = line.scope;
//       if (!SCOPES.includes(scope)) continue;
//       dbg.linesScopeOk++;

//       const period = line.period || "ALL";
//       if (!PERIODS.includes(period)) continue;
//       dbg.linesPeriodOk++;

//       const condition = normalizeCondition(line.condition);
//       if (condition !== "over") continue;
//       dbg.linesOver++;

//       const odds = Number(line.odds);
//       const lineNum = Number(line.line);
//       if (!Number.isFinite(odds) || !Number.isFinite(lineNum)) continue;

//       const team = getTeamName(line, doc);
//       if (!team) continue;

//       const key = `${matchKey}__${team}__${scope}__${statKey}__${period}`;

//       if (!perMatch.has(key)) perMatch.set(key, []);
//       perMatch.get(key).push({ odds, line: lineNum, actual });
//       dbg.candidates++;
//     }
//   }

//   /**
//    * Aggregate per team
//    * key = team__scope__stat__period
//    */
//   const agg = new Map();

//   for (const [key, candidates] of perMatch.entries()) {
//     const main = selectMainOverLine(candidates);
//     if (!main) continue;

//     dbg.selectedMain++;

//     // ignore push
//     if (main.actual === main.line) {
//       dbg.pushes++;
//       continue;
//     }

//     const hit = main.actual > main.line;

//     const [, team, scope, statKey, period] = key.split("__");
//     const teamKey = `${team}__${scope}__${statKey}__${period}`;

//     if (!agg.has(teamKey)) {
//       agg.set(teamKey, {
//         team,
//         scope,
//         statKey,
//         period,
//         matches: 0,
//         hits: 0,
//         sumLine: 0,
//         sumOdds: 0
//       });
//     }

//     const a = agg.get(teamKey);
//     a.matches += 1;
//     a.sumLine += main.line;
//     a.sumOdds += main.odds;
//     if (hit) a.hits += 1;
//   }

//   const ops = [];
//   const now = new Date();

//   for (const a of agg.values()) {
//     if (a.matches < MIN_MATCHES) continue;

//     const hitRate = a.hits / a.matches; // OVER hit rate at market main over line
//     const bias = hitRate - 0.5;         // signed: +over, -under
//     const direction = bias >= 0 ? "over" : "under";
//     const absBias = Math.abs(bias);

//     // Strength thresholds (conservative)
//     // strong:      >= 0.08 (>= 58% or <= 42%) and n>=18
//     // very_strong: >= 0.12 (>= 62% or <= 38%) and n>=25
//     // super:       >= 0.16 (>= 66% or <= 34%) and n>=35
//     let strength = "neutral";
//     if (a.matches >= 35 && absBias >= 0.16) strength = "super";
//     else if (a.matches >= 25 && absBias >= 0.12) strength = "very_strong";
//     else if (a.matches >= 18 && absBias >= 0.08) strength = "strong";

//     const payload = {
//       direction,
//       strength,
//       hitRate: clamp01(hitRate),
//       bias,
//       sampleSize: a.matches,
//       avgLine: a.sumLine / a.matches,
//       avgMainOdds: a.sumOdds / a.matches,
//       method: "over_only_closest_to_2",
//       oddsWindow: [MIN_ODDS, MAX_ODDS],
//       updatedAt: now
//     };

//     const filter = {
//       "meta.lagnamn": a.team,
//       "meta.matchType": a.scope
//     };

//     const docPath = `statistics.for.${a.statKey}.${a.period}.marketBias`;

//     ops.push({
//       updateOne: {
//         filter,
//         update: { $set: { [docPath]: payload } },
//         upsert: false
//       }
//     });
//   }

//   console.log("🧪 Debug counters:", dbg);
//   console.log(`✅ Computed marketBias rows: ${ops.length}`);

//   if (!process.argv.includes("--save-profiles")) {
//     console.log("ℹ️ Dry run. Use --save-profiles to write.");
//     return;
//   }

//   if (ops.length === 0) return;

//   await bulkWriteChunked(db.collection("teamprofiles"), ops);
//   console.log("💾 Saved marketBias to teamprofiles");
// }

// // ================= UTIL =================

// async function loadFromDisk(dir) {
//   try {
//     const files = await collectJsonFiles(dir);
//     const docs = [];

//     for (const file of files) {
//       try {
//         const raw = await fs.readFile(file, "utf8");
//         const parsed = JSON.parse(raw);

//         // support either:
//         // 1) { lines: [...] }
//         // 2) [...] (treat as single doc with lines)
//         // 3) [ { lines: [...] }, ... ] (array of docs)
//         if (Array.isArray(parsed)) {
//           if (parsed.length && parsed[0] && typeof parsed[0] === "object" && Array.isArray(parsed[0].lines)) {
//             for (const d of parsed) docs.push(d);
//           } else {
//             docs.push({ lines: parsed, source: file });
//           }
//         } else if (parsed && typeof parsed === "object") {
//           if (Array.isArray(parsed.lines)) docs.push(parsed);
//         }
//       } catch {
//         // ignore broken json
//       }
//     }

//     return docs;
//   } catch {
//     return [];
//   }
// }

// async function bulkWriteChunked(col, ops, size = 250) {
//   for (let i = 0; i < ops.length; i += size) {
//     await col.bulkWrite(ops.slice(i, i + size), { ordered: false });
//   }
// }

// main().catch(err => {
//   console.error("❌ MarketBias failed:", err);
//   process.exit(1);
// });










// import fs from "fs/promises";
// import path from "path";
// import clientPromise from "../lib/mongo.js";

// // ================= CONFIG =================

// const BACKTESTS_DIR =
//   process.env.BACKTESTS_DIR ||
//   "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

// const DB_NAME = process.env.MONGODB_DB || "app";
// const BACKTEST_COLLECTION =
//   process.env.BACKTEST_COLLECTION || "unibet-backtest";
// const TEAMPROFILES_COLLECTION =
//   process.env.TEAMPROFILES_COLLECTION || "teamprofiles";

// const MIN_MATCHES = Number(process.env.MARKET_BIAS_MIN_MATCHES || 0);

// // team-based only
// const SCOPES = ["home", "away"];
// const PERIODS = ["ALL", "1ST", "2ND"];

// // must match your unibet-backtest statKey values
// const STATS = ["totalShots", "shotsOnGoal", "cornerKicks", "offsides", "fouls", "yellowCards"];

// // odds window for "near 50%"
// const MIN_ODDS =  1.7;
// const MAX_ODDS = 2.3;

// // ================= HELPERS =================

// function normalizeCondition(c) {
//   if (!c) return null;
//   const s = String(c).toLowerCase();
//   if (s.includes("över") || s === "over") return "over";
//   if (s.includes("under") || s === "under") return "under";
//   return null;
// }

// function getActual(line) {
//   const v = line?.actual ?? line?.evDetails?.actual;
//   if (v == null) return null;
//   const n = Number(v);
//   return Number.isFinite(n) ? n : null;
// }

// function getMatchKey(doc) {
//   return (
//     doc.matchId ||
//     doc.eventId ||
//     doc.slug ||
//     `${doc.homeTeam}-${doc.awayTeam}-${doc.matchDate}`
//   );
// }

// function getTeamName(line, doc) {
//   if (line.scope === "home") return doc.homeTeam;
//   if (line.scope === "away") return doc.awayTeam;
//   return null;
// }

// function clamp01(x) {
//   if (!Number.isFinite(x)) return 0;
//   return Math.max(0, Math.min(1, x));
// }

// function parseBoolFlag(flag) {
//   return process.argv.includes(flag);
// }

// async function collectJsonFiles(dir) {
//   const out = [];
//   try {
//     const entries = await fs.readdir(dir, { withFileTypes: true });
//     for (const e of entries) {
//       const full = path.join(dir, e.name);
//       if (e.isDirectory()) out.push(...(await collectJsonFiles(full)));
//       else if (e.isFile() && e.name.toLowerCase().endsWith(".json"))
//         out.push(full);
//     }
//   } catch {}
//   return out;
// }

// async function loadFromDisk(dir) {
//   const files = await collectJsonFiles(dir);
//   const docs = [];

//   for (const file of files) {
//     try {
//       const raw = await fs.readFile(file, "utf8");
//       const parsed = JSON.parse(raw);

//       // support:
//       // 1) { lines:[...] }
//       // 2) [...] (treat as one doc with lines)
//       // 3) [ {lines:[...]}, ... ]
//       if (Array.isArray(parsed)) {
//         if (
//           parsed.length &&
//           parsed[0] &&
//           typeof parsed[0] === "object" &&
//           Array.isArray(parsed[0].lines)
//         ) {
//           parsed.forEach((d) => docs.push(d));
//         } else {
//           docs.push({ lines: parsed, source: file });
//         }
//       } else if (
//         parsed &&
//         typeof parsed === "object" &&
//         Array.isArray(parsed.lines)
//       ) {
//         docs.push(parsed);
//       }
//     } catch {}
//   }

//   return docs;
// }

// /**
//  * Select a "main line" for ONE match/team/scope/stat/period:
//  * 1) Prefer OVER within odds window (closest to 2.0)
//  * 2) Else prefer UNDER within odds window (closest to 2.0)
//  * 3) Else fallback to closest-to-2.0 on any side (debug-friendly)
//  */
// function selectMainLine(candidates) {
//   const inWindow = (c) => c.odds >= MIN_ODDS && c.odds <= MAX_ODDS;

//   const overWin = candidates
//     .filter((c) => c.side === "over" && inWindow(c))
//     .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
//   if (overWin) return { ...overWin, pickedFrom: "over_window" };

//   const underWin = candidates
//     .filter((c) => c.side === "under" && inWindow(c))
//     .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
//   if (underWin) return { ...underWin, pickedFrom: "under_window" };

//   const any = candidates
//     .slice()
//     .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
//   if (any) return { ...any, pickedFrom: "fallback_any" };

//   return null;
// }

// async function bulkWriteChunked(col, ops, size = 250) {
//   for (let i = 0; i < ops.length; i += size) {
//     await col.bulkWrite(ops.slice(i, i + size), { ordered: false });
//   }
// }

// // ================= MAIN =================

// async function main() {
//   const save = parseBoolFlag("--save-profiles");

//   const client = await clientPromise;
//   const db = client.db(DB_NAME);

//   const mongoDocs = await db
//     .collection(BACKTEST_COLLECTION)
//     .find({ "lines.actual": { $ne: null } })
//     .toArray();

//   const diskDocs = await loadFromDisk(BACKTESTS_DIR);
//   const allDocs = [...mongoDocs, ...diskDocs];

//   console.log(`🗄️ Loaded ${mongoDocs.length} from MongoDB`);
//   console.log(`💾 Loaded ${diskDocs.length} from disk`);
//   console.log(`📦 Total: ${allDocs.length}`);

//   const dbg = {
//     docs: allDocs.length,
//     lines: 0,
//     linesWithActual: 0,
//     linesStatOk: 0,
//     linesScopeOk: 0,
//     linesPeriodOk: 0,
//     linesSideOk: 0,
//     candidates: 0,
//     selectedMain: 0,
//     pushes: 0,
//   };

//   /**
//    * Per matchKey+team+scope+stat+period => candidates
//    * key = matchKey__team__scope__stat__period
//    */
//   const perMatch = new Map();

//   for (const doc of allDocs) {
//     if (!Array.isArray(doc.lines)) continue;

//     const matchKey = getMatchKey(doc);
//     if (!matchKey) continue;

//     dbg.lines += doc.lines.length;

//     for (const line of doc.lines) {
//       const actual = getActual(line);
//       if (actual == null) continue;
//       dbg.linesWithActual++;

//       const statKey = line.statKey;
//       if (!STATS.includes(statKey)) continue;
//       dbg.linesStatOk++;

//       const scope = line.scope;
//       if (!SCOPES.includes(scope)) continue;
//       dbg.linesScopeOk++;

//       const period = line.period || "ALL";
//       if (!PERIODS.includes(period)) continue;
//       dbg.linesPeriodOk++;

//       const side = normalizeCondition(line.condition);
//       if (side !== "over" && side !== "under") continue;
//       dbg.linesSideOk++;

//       const odds = Number(line.odds);
//       const lineNum = Number(line.line);
//       if (!Number.isFinite(odds) || !Number.isFinite(lineNum)) continue;

//       const team = getTeamName(line, doc);
//       if (!team) continue;

//       const key = `${matchKey}__${team}__${scope}__${statKey}__${period}`;
//       if (!perMatch.has(key)) perMatch.set(key, []);
//       perMatch.get(key).push({ side, odds, line: lineNum, actual });
//       dbg.candidates++;
//     }
//   }

//   /**
//    * Aggregate per team+scope+stat+period:
//    * We store both over-hits and under-hits depending on which side got selected as main for the match.
//    */
//   const agg = new Map();

//   for (const [key, candidates] of perMatch.entries()) {
//     const main = selectMainLine(candidates);
//     if (!main) continue;
//     dbg.selectedMain++;

//     // ignore push
//     if (main.actual === main.line) {
//       dbg.pushes++;
//       continue;
//     }

//     // Define "hit" relative to selected side:
//     // - if main side is over: hit if actual > line
//     // - if main side is under: hit if actual < line
//     const hit =
//       main.side === "over" ? main.actual > main.line : main.actual < main.line;

//     const [, team, scope, statKey, period] = key.split("__");
//     const teamKey = `${team}__${scope}__${statKey}__${period}`;

//     if (!agg.has(teamKey)) {
//       agg.set(teamKey, {
//         team,
//         scope,
//         statKey,
//         period,
//         matches: 0,
//         hits: 0,
//         sumLine: 0,
//         sumOdds: 0,
//         pickedOver: 0,
//         pickedUnder: 0,
//       });
//     }

//     const a = agg.get(teamKey);
//     a.matches += 1;
//     a.sumLine += main.line;
//     a.sumOdds += main.odds;
//     if (main.side === "over") a.pickedOver += 1;
//     if (main.side === "under") a.pickedUnder += 1;
//     if (hit) a.hits += 1;
//   }

//   const ops = [];
//   const now = new Date();

//   for (const a of agg.values()) {
//     if (a.matches < MIN_MATCHES) continue;

//     // This hitRate is "did team beat the market's ~50/50 main line"
//     // where main line can be OVER-side or UNDER-side.
//     const hitRate = a.hits / a.matches;

//     // Convert to signed bias where:
//     // + bias => OVER leaning (market underestimates overs)
//     // - bias => UNDER leaning
//     //
//     // But note: since we sometimes pick UNDER as the main line,
//     // a "hit" on an UNDER main means "team went under that line".
//     //
//     // We want consistent sign:
//     // - if main picked more often on OVER side, interpret hitRate as over-hit-rate proxy
//     // - if main picked more often on UNDER side, interpret hitRate as under-hit-rate proxy and flip sign
//     //
//     // Better: store 'selectedSideMix' and compute sign using majority side:
//     const majoritySide = a.pickedOver >= a.pickedUnder ? "over" : "under";

//     // If majority side is OVER: bias = hitRate - 0.5
//     // If majority side is UNDER: bias = 0.5 - hitRate (flip)
//     const bias = majoritySide === "over" ? hitRate - 0.5 : 0.5 - hitRate;

//     const direction = bias >= 0 ? "over" : "under";
//     const absBias = Math.abs(bias);

//     // Strength (conservative)
//     let strength = "neutral";
//     if (a.matches >= 35 && absBias >= 0.16) strength = "super";
//     else if (a.matches >= 25 && absBias >= 0.12) strength = "very_strong";
//     else if (a.matches >= 18 && absBias >= 0.08) strength = "strong";

//     const payload = {
//       direction, // final interpreted direction (over/under)
//       strength,
//       hitRate: clamp01(hitRate), // beat-main-line rate
//       bias, // signed
//       sampleSize: a.matches,
//       avgLine: a.sumLine / a.matches,
//       avgMainOdds: a.sumOdds / a.matches,
//       pickedOver: a.pickedOver,
//       pickedUnder: a.pickedUnder,
//       majoritySide,
//       method: "main_line_over_then_under_per_period",
//       oddsWindow: [MIN_ODDS, MAX_ODDS],
//       updatedAt: now,
//     };

//     const filter = {
//       "meta.lagnamn": a.team,
//       "meta.matchType": a.scope,
//     };

//     const docPath = `statistics.for.${a.statKey}.${a.period}.marketBias`;

//     ops.push({
//       updateOne: {
//         filter,
//         update: { $set: { [docPath]: payload } },
//         upsert: false,
//       },
//     });
//   }

//   console.log("🧪 Debug counters:", dbg);
//   console.log(`✅ Computed marketBias rows: ${ops.length}`);

//   if (!save) {
//     console.log("ℹ️ Dry run. Use --save-profiles to write.");
//     return;
//   }

//   if (ops.length === 0) {
//     console.log("ℹ️ Nothing to write (likely sampleSize too low).");
//     return;
//   }

//   await bulkWriteChunked(db.collection(TEAMPROFILES_COLLECTION), ops, 250);
//   console.log(
//     `💾 Saved marketBias per period to ${TEAMPROFILES_COLLECTION} (ops=${ops.length})`
//   );
// }

// main().catch((err) => {
//   console.error("❌ MarketBias failed:", err);
//   process.exit(1);
// });


import fs from "fs/promises";
import path from "path";
import clientPromise from "../lib/mongo.js";

// ================= CONFIG =================

const BACKTESTS_DIR =
  process.env.BACKTESTS_DIR ||
  "C:\\Users\\ryd\\OneDrive\\Skrivbord\\FRONTEND\\bet365\\UNIBET\\unibet-backtests";

const DB_NAME = process.env.MONGODB_DB || "app";
const BACKTEST_COLLECTION =
  process.env.BACKTEST_COLLECTION || "unibet-backtest";
const TEAMPROFILES_COLLECTION =
  process.env.TEAMPROFILES_COLLECTION || "teamprofiles";

const MIN_MATCHES = Number(process.env.MARKET_BIAS_MIN_MATCHES || 0);

// team-based only
const SCOPES = ["home", "away"];
const PERIODS = ["ALL", "1ST", "2ND"];

// must match your unibet-backtest statKey values
const STATS = [
  "totalShots",
  "shotsOnGoal",
  "cornerKicks",
  "offsides",
  "fouls",
  "yellowCards",
];

// odds window for "near 50%"
const MIN_ODDS = 1.7;
const MAX_ODDS = 2.3;

// Map backtest statKey -> teamprofiles statKey
// (you asked: totalShots should be stored under totalShotsOnGoal)
const STATKEY_SAVE_MAP = {
  totalShots: "totalShotsOnGoal",
};

// ================= HELPERS =================

function normalizeCondition(c) {
  if (!c) return null;
  const s = String(c).toLowerCase();
  if (s.includes("över") || s === "over") return "over";
  if (s.includes("under") || s === "under") return "under";
  return null;
}

function getActual(line) {
  const v = line?.actual ?? line?.evDetails?.actual;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getMatchKey(doc) {
  return (
    doc.matchId ||
    doc.eventId ||
    doc.slug ||
    `${doc.homeTeam}-${doc.awayTeam}-${doc.matchDate}`
  );
}

function getTeamName(line, doc) {
  if (line.scope === "home") return doc.homeTeam;
  if (line.scope === "away") return doc.awayTeam;
  return null;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function parseBoolFlag(flag) {
  return process.argv.includes(flag);
}

function toSavedStatKey(statKey) {
  return STATKEY_SAVE_MAP[statKey] || statKey;
}

async function collectJsonFiles(dir) {
  const out = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await collectJsonFiles(full)));
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json"))
        out.push(full);
    }
  } catch {}
  return out;
}

async function loadFromDisk(dir) {
  const files = await collectJsonFiles(dir);
  const docs = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);

      // support:
      // 1) { lines:[...] }
      // 2) [...] (treat as one doc with lines)
      // 3) [ {lines:[...]}, ... ]
      if (Array.isArray(parsed)) {
        if (
          parsed.length &&
          parsed[0] &&
          typeof parsed[0] === "object" &&
          Array.isArray(parsed[0].lines)
        ) {
          parsed.forEach((d) => docs.push(d));
        } else {
          docs.push({ lines: parsed, source: file });
        }
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.lines)
      ) {
        docs.push(parsed);
      }
    } catch {}
  }

  return docs;
}

/**
 * Select a "main line" for ONE match/team/scope/stat/period:
 * 1) Prefer OVER within odds window (closest to 2.0)
 * 2) Else prefer UNDER within odds window (closest to 2.0)
 * 3) Else fallback to closest-to-2.0 on any side (debug-friendly)
 */
function selectMainLine(candidates) {
  const inWindow = (c) => c.odds >= MIN_ODDS && c.odds <= MAX_ODDS;

  const overWin = candidates
    .filter((c) => c.side === "over" && inWindow(c))
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
  if (overWin) return { ...overWin, pickedFrom: "over_window" };

  const underWin = candidates
    .filter((c) => c.side === "under" && inWindow(c))
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
  if (underWin) return { ...underWin, pickedFrom: "under_window" };

  const any = candidates
    .slice()
    .sort((a, b) => Math.abs(a.odds - 2.0) - Math.abs(b.odds - 2.0))[0];
  if (any) return { ...any, pickedFrom: "fallback_any" };

  return null;
}

async function bulkWriteChunked(col, ops, size = 250) {
  for (let i = 0; i < ops.length; i += size) {
    await col.bulkWrite(ops.slice(i, i + size), { ordered: false });
  }
}

// ================= MAIN =================

async function main() {
  const save = parseBoolFlag("--save-profiles");

  let client;
  try {
    client = await clientPromise;
    const db = client.db(DB_NAME);

    const mongoDocs = await db
      .collection(BACKTEST_COLLECTION)
      .find({ "lines.actual": { $ne: null } })
      .toArray();

    const diskDocs = await loadFromDisk(BACKTESTS_DIR);
    const allDocs = [...mongoDocs, ...diskDocs];

    console.log(`🗄️ Loaded ${mongoDocs.length} from MongoDB`);
    console.log(`💾 Loaded ${diskDocs.length} from disk`);
    console.log(`📦 Total: ${allDocs.length}`);

    const dbg = {
      docs: allDocs.length,
      lines: 0,
      linesWithActual: 0,
      linesStatOk: 0,
      linesScopeOk: 0,
      linesPeriodOk: 0,
      linesSideOk: 0,
      candidates: 0,
      selectedMain: 0,
      pushes: 0,
    };

    /**
     * Per matchKey+team+scope+stat+period => candidates
     * key = matchKey__team__scope__stat__period
     */
    const perMatch = new Map();

    for (const doc of allDocs) {
      if (!Array.isArray(doc.lines)) continue;

      const matchKey = getMatchKey(doc);
      if (!matchKey) continue;

      dbg.lines += doc.lines.length;

      for (const line of doc.lines) {
        const actual = getActual(line);
        if (actual == null) continue;
        dbg.linesWithActual++;

        const statKey = line.statKey;
        if (!STATS.includes(statKey)) continue;
        dbg.linesStatOk++;

        const scope = line.scope;
        if (!SCOPES.includes(scope)) continue;
        dbg.linesScopeOk++;

        const period = line.period || "ALL";
        if (!PERIODS.includes(period)) continue;
        dbg.linesPeriodOk++;

        const side = normalizeCondition(line.condition);
        if (side !== "over" && side !== "under") continue;
        dbg.linesSideOk++;

        const odds = Number(line.odds);
        const lineNum = Number(line.line);
        if (!Number.isFinite(odds) || !Number.isFinite(lineNum)) continue;

        const team = getTeamName(line, doc);
        if (!team) continue;

        const key = `${matchKey}__${team}__${scope}__${statKey}__${period}`;
        if (!perMatch.has(key)) perMatch.set(key, []);
        perMatch.get(key).push({ side, odds, line: lineNum, actual });
        dbg.candidates++;
      }
    }

    /**
     * Aggregate per team+scope+stat+period
     */
    const agg = new Map();

    for (const [key, candidates] of perMatch.entries()) {
      const main = selectMainLine(candidates);
      if (!main) continue;
      dbg.selectedMain++;

      // ignore pushes
      if (main.actual === main.line) {
        dbg.pushes++;
        continue;
      }

      const hit =
        main.side === "over"
          ? main.actual > main.line
          : main.actual < main.line;

      const [, team, scope, statKey, period] = key.split("__");
      const teamKey = `${team}__${scope}__${statKey}__${period}`;

      if (!agg.has(teamKey)) {
        agg.set(teamKey, {
          team,
          scope,
          statKey,
          period,
          matches: 0,
          hits: 0,
          sumLine: 0,
          sumOdds: 0,
          pickedOver: 0,
          pickedUnder: 0,
        });
      }

      const a = agg.get(teamKey);
      a.matches += 1;
      a.sumLine += main.line;
      a.sumOdds += main.odds;
      if (main.side === "over") a.pickedOver += 1;
      if (main.side === "under") a.pickedUnder += 1;
      if (hit) a.hits += 1;
    }

    const ops = [];
    const now = new Date();

    for (const a of agg.values()) {
      if (a.matches < MIN_MATCHES) continue;

      const hitRate = a.hits / a.matches;

      const majoritySide = a.pickedOver >= a.pickedUnder ? "over" : "under";
      const bias = majoritySide === "over" ? hitRate - 0.5 : 0.5 - hitRate;

      const direction = bias >= 0 ? "over" : "under";
      const absBias = Math.abs(bias);

      let strength = "neutral";
      if (a.matches >= 35 && absBias >= 0.16) strength = "super";
      else if (a.matches >= 25 && absBias >= 0.12) strength = "very_strong";
      else if (a.matches >= 18 && absBias >= 0.08) strength = "strong";

      const payload = {
        direction,
        strength,
        hitRate: clamp01(hitRate),
        bias,
        sampleSize: a.matches,
        avgLine: a.sumLine / a.matches,
        avgMainOdds: a.sumOdds / a.matches,
        pickedOver: a.pickedOver,
        pickedUnder: a.pickedUnder,
        majoritySide,
        method: "main_line_over_then_under_per_period",
        oddsWindow: [MIN_ODDS, MAX_ODDS],
        updatedAt: now,
      };

      const filter = {
        "meta.lagnamn": a.team,
        "meta.matchType": a.scope,
      };

      // IMPORTANT: save statKey remap (totalShots -> totalShotsOnGoal)
      const savedStatKey = toSavedStatKey(a.statKey);
      const docPath = `statistics.for.${savedStatKey}.${a.period}.marketBias`;

      ops.push({
        updateOne: {
          filter,
          update: { $set: { [docPath]: payload } },
          upsert: false,
        },
      });
    }

    console.log("🧪 Debug counters:", dbg);
    console.log(`✅ Computed marketBias rows: ${ops.length}`);

    if (!save) {
      console.log("ℹ️ Dry run. Use --save-profiles to write.");
      return;
    }

    if (ops.length === 0) {
      console.log("ℹ️ Nothing to write (likely sampleSize too low).");
      return;
    }

    await bulkWriteChunked(db.collection(TEAMPROFILES_COLLECTION), ops, 250);
    console.log(
      `💾 Saved marketBias per period to ${TEAMPROFILES_COLLECTION} (ops=${ops.length})`
    );
  } finally {
    // Always close the Mongo connection when this script finishes.
    // This is important when called from a pipeline (generate-teamprofiles -> scew).
    if (client) {
      try {
        await client.close();
        console.log("🔌 Mongo connection closed.");
      } catch (e) {
        console.warn("⚠️ Failed to close Mongo connection:", e?.message || e);
      }
    }
  }
}

main().catch((err) => {
  console.error("❌ MarketBias failed:", err);
  process.exit(1);
});
