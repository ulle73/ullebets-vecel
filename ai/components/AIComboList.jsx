"use client";

import { buildLineKey } from "@/ai/utils/matchupUtils";

function buildMatchUrlEntries(lines = []) {
  const map = new Map();
  lines.forEach((line) => {
    const url = line?.unibetUrl;
    if (!url) return;
    const label = line.matchLabel || line.match || "Match";
    if (!map.has(label)) {
      map.set(label, new Set());
    }
    map.get(label).add(url);
  });
  return Array.from(map.entries()).map(([label, urls]) => ({
    label,
    urls: Array.from(urls),
  }));
}

function getTeamIconUrl(teamId) {
  if (!teamId) return null;
  return `/images/teams/${teamId}.png`;
}

function formatPeriodText(period) {
  if (period === "1ST" || period === "1st") return "1:a halvlek";
  if (period === "2ND" || period === "2nd") return "2:a halvlek";
  return "ALL";
}

function formatStatText(statKey) {
  const statNames = {
    cornerKicks: "cornerKicks", // Keep raw for "tech" look or map if desired
    yellowCards: "yellowCards",
    fouls: "fouls",
    shotsOnGoal: "shotsOnGoal",
    totalShots: "totalShots",
    freeKicks: "freeKicks",
    throwIns: "throwIns",
    offsides: "offsides",
    totalTackle: "totalTackle",
  };
  return statNames[statKey] || statKey;
}

// Icons
const GlobeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" x2="22" y1="12" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const PinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export default function AIComboList({ combos, priorityMap = {} }) {
  if (!combos || !combos.length) {
    return (
      <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 p-4 text-center text-xs uppercase tracking-wider text-slate-400">
        Inga kombinationer hittades ännu
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {combos.map((combo, index) => {
        const matchUrlEntries = buildMatchUrlEntries(combo.lines);
        const evPercent = combo.totalEv || 0;

        // Calculate average matchup score for combo
        const matchupScores = combo.lines.map(line => {
          const lineKey = buildLineKey(line);
          return priorityMap[lineKey] || 0;
        });
        const avgMatchupScore = matchupScores.reduce((a, b) => a + b, 0) / matchupScores.length || 0;

        // Determine colors based on EV/Type (Green theme as default/high EV)
        const mainColor = "emerald"; // Could be dynamic
        const headerGradient = "bg-gradient-to-r from-emerald-900/20 to-emerald-950/40";
        const borderColor = "border-emerald-500/30";
        const glowColor = "shadow-[0_0_15px_rgba(16,185,129,0.15)]";

        return (
          <article
            key={combo.id || `${index}-${combo.odds}`}
            className={`overflow-hidden rounded-2xl border ${borderColor} bg-[#020617] ${glowColor}`}
          >
            {/* HEADER SECTION */}
            <div className={`${headerGradient} border-b border-white/5 p-5`}>
              {/* Top Row: Label & Count */}
              <div className="mb-1 flex justify-between text-[10px] font-medium tracking-widest text-slate-400">
                <span>COMBO {index + 1}</span>
                <span>{combo.lines.length} SPEL</span>
              </div>

              {/* Main Row: EV & Progress Bar */}
              <div className="flex items-center gap-4">
                {/* EV Percentage */}
                <div className="flex flex-col">
                  <span className="text-5xl font-bold tracking-tighter text-emerald-300 drop-shadow-[0_0_8px_rgba(110,231,183,0.3)]">
                    {evPercent.toFixed(1)}%
                  </span>
                  <span className="text-[10px] font-medium text-slate-500">
                    Total EV för kombon
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="relative flex-1">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800/50">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.6)]"
                      style={{ width: `${Math.min(100, avgMatchupScore)}%` }}
                    />
                  </div>
                </div>

                {/* Count Badge */}
                <div className="flex h-6 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
                  {combo.lines.length}/{combo.lines.length}
                </div>
              </div>
            </div>

            {/* BODY SECTION */}
            <div className="p-5">
              <ul className="space-y-6">
                {combo.lines.map((line, lineIndex) => {
                  const homeTeam = line.teams?.home || "";
                  const awayTeam = line.teams?.away || "";
                  const homeTeamId = line.teams?.homeId;
                  const awayTeamId = line.teams?.awayId;
                  const homeIcon = getTeamIconUrl(homeTeamId);
                  const awayIcon = getTeamIconUrl(awayTeamId);

                  const direction = line.direction === "over" ? "OVER" : "UNDER";
                  const stat = formatStatText(line.statKey);
                  const period = formatPeriodText(line.period);
                  const scope = line.scope || "total";

                  return (
                    <li key={`${combo.id}-${lineIndex}`} className="space-y-3">
                      {/* Match Header Row */}
                      <div className="flex items-center justify-between">
                        {/* Teams */}
                        <div className="flex items-center gap-3">
                          {homeIcon && (
                            <img src={homeIcon} alt={homeTeam} className="h-6 w-6 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                          )}
                          <span className="text-lg font-bold text-slate-100">{homeTeam}</span>
                          <span className="text-sm font-medium text-slate-500">vs</span>
                          <span className="text-lg font-bold text-slate-100">{awayTeam}</span>
                          {awayIcon && (
                            <img src={awayIcon} alt={awayTeam} className="h-6 w-6 object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                          )}
                        </div>

                        {/* Bet Type */}
                        <div className="text-right">
                          <span className="text-xs font-medium tracking-wider text-slate-400">
                            {direction} {line.line}
                          </span>
                        </div>
                      </div>

                      {/* Stats Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-400">
                        <span className="text-slate-300">
                          Odds: <span className="text-emerald-400">{line.odds?.toFixed(2)}x</span>
                        </span>
                        <span className="text-slate-300">
                          EV: <span className="text-emerald-400">{line.primaryEv?.toFixed(1)}%</span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          <GlobeIcon />
                          <span>Stat: <span className="text-slate-200">{stat}</span></span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <CalendarIcon />
                          <span>Period: <span className="text-slate-200">{period}</span></span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <PinIcon />
                          <span>Scope: <span className="text-slate-200">{scope}</span></span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Links Section */}
              {matchUrlEntries.length > 0 && (
                <div className="mt-6 space-y-3">
                  {matchUrlEntries.map(({ label, urls }) => (
                    <div key={`${combo.id}-${label}`} className="space-y-2">
                      {urls.map((url, idx) => (
                        <div key={idx} className="space-y-2">
                          <div className="truncate text-[10px] text-slate-600">
                            {url}
                          </div>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="block w-full rounded-full border border-emerald-500/30 bg-emerald-500/5 py-2.5 text-center text-sm font-semibold text-emerald-400 transition-all hover:bg-emerald-500/10 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                          >
                            Betting vs Unibet
                          </a>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
