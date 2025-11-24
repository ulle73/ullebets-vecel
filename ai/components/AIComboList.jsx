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
  return "";
}

function formatStatText(statKey) {
  const statNames = {
    cornerKicks: "hörnor",
    yellowCards: "gula kort",
    fouls: "fouls",
    shotsOnGoal: "skott på mål",
    totalShots: "skott",
    freeKicks: "frisparkar",
    throwIns: "inkast",
    offsides: "offsides",
    totalTackle: "tacklingar",
  };
  return statNames[statKey] || statKey;
}

function getBetDescription(line) {
  const homeTeam = line.teams?.home || "";
  const awayTeam = line.teams?.away || "";
  const direction = line.direction === "over" ? "över" : "under";
  const stat = formatStatText(line.statKey);
  const period = formatPeriodText(line.period);
  const lineValue = line.line;

  // Determine subject based on scope
  let subject = "";
  if (line.scope === "home") subject = homeTeam;
  else if (line.scope === "away") subject = awayTeam;
  else subject = `${homeTeam} vs ${awayTeam}`;

  // Construct sentence: "Barcelona över 4.5 hörnor (1:a halvlek)"
  let sentence = `${subject} ${direction} ${lineValue} ${stat}`;
  if (period) sentence += ` (${period})`;

  return sentence;
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
    <div className="space-y-8">
      {combos.map((combo, index) => {
        const matchUrlEntries = buildMatchUrlEntries(combo.lines);
        const evPercent = combo.totalEv || 0;

        // Calculate average matchup score for combo
        const matchupScores = combo.lines.map(line => {
          const lineKey = buildLineKey(line);
          return priorityMap[lineKey] || 0;
        });
        const avgMatchupScore = matchupScores.reduce((a, b) => a + b, 0) / matchupScores.length || 0;

        // Determine theme based on combo type
        let themeColor = "emerald"; // default green
        let glowShadow = "shadow-[0_0_15px_rgba(16,185,129,0.1)]";
        let borderColor = "border-emerald-500/30"; // More discrete
        let headerGradient = "bg-gradient-to-r from-emerald-900/20 to-emerald-950/40";
        let progressBarGradient = "bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-200";
        let evTextColor = "text-emerald-300";
        let buttonBorderColor = "border-emerald-400/30";
        let buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(52,211,153,0.4)]";

        const isCombo = combo.lines.length > 1;
        const isAllUnder = combo.lines.every(l => l.direction === 'under');

        if (isCombo) {
          // Blue theme for combos
          themeColor = "blue";
          glowShadow = "shadow-[0_0_15px_rgba(59,130,246,0.15)]";
          borderColor = "border-blue-500/30";
          headerGradient = "bg-gradient-to-r from-blue-900/20 to-blue-950/40";
          progressBarGradient = "bg-gradient-to-r from-blue-400 via-blue-300 to-blue-200";
          evTextColor = "text-blue-300";
          buttonBorderColor = "border-blue-400/30";
          buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(96,165,250,0.4)]";
        } else if (isAllUnder) {
          // Purple theme for under bets
          themeColor = "purple";
          glowShadow = "shadow-[0_0_15px_rgba(168,85,247,0.15)]";
          borderColor = "border-purple-500/30";
          headerGradient = "bg-gradient-to-r from-purple-900/20 to-purple-950/40";
          progressBarGradient = "bg-gradient-to-r from-purple-400 via-purple-300 to-purple-200";
          evTextColor = "text-purple-300";
          buttonBorderColor = "border-purple-400/30";
          buttonHoverGlow = "hover:shadow-[0_0_15px_rgba(192,132,252,0.4)]";
        }

        return (
          <article
            key={combo.id || `${index}-${combo.odds}`}
            className={`overflow-hidden rounded-2xl border ${borderColor} bg-[#020617] ${glowShadow} transition-all duration-300 hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]`}
          >
            {/* HEADER SECTION */}
            <div className={`${headerGradient} border-b border-white/5 p-6`}>
              {/* Top Row: Label & Count */}
              <div className="mb-2 flex justify-between text-[11px] font-bold tracking-widest text-slate-400">
                <span>COMBO {index + 1}</span>
                <span>{combo.lines.length} SPEL</span>
              </div>

              {/* Main Row: EV & Progress Bar */}
              <div className="flex items-center gap-6">
                {/* EV Percentage */}
                <div className="flex flex-col">
                  <span className={`text-6xl font-bold tracking-tighter ${evTextColor} drop-shadow-[0_0_15px_rgba(110,231,183,0.4)]`}>
                    {evPercent.toFixed(1)}%
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                    Total EV för kombon
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="relative flex-1">
                  <div className="h-4 w-full overflow-hidden rounded-full bg-slate-800/50 shadow-inner drop-shadow-[0_0_15px_rgba(110,231,183,0.2)]">
                    <div
                      className={`h-full rounded-full ${progressBarGradient} shadow-[0_0_20px_rgba(52,211,153,0.8)] `}
                      style={{ width: `${Math.min(100, avgMatchupScore)}%` }}
                    />
                  </div>
                </div>

                {/* Count Badge */}
                <div className={`flex h-8 w-14 items-center justify-center rounded-full bg-${themeColor}-500/20 text-sm font-bold text-${themeColor}-400 ring-1 ring-${themeColor}-500/30`}>
                  {combo.lines.length}/{combo.lines.length}
                </div>
              </div>
            </div>

            {/* BODY SECTION */}
            <div className="p-6">
              <ul className="space-y-6">
                {combo.lines.map((line, lineIndex) => {
                  const homeTeam = line.teams?.home || "";
                  const awayTeam = line.teams?.away || "";
                  const homeTeamId = line.teams?.homeId;
                  const awayTeamId = line.teams?.awayId;
                  const homeIcon = getTeamIconUrl(homeTeamId);
                  const awayIcon = getTeamIconUrl(awayTeamId);

                  const description = getBetDescription(line);

                  // Determine line-specific glow color
                  let oddsColor = "text-emerald-400";

                  if (isCombo) {
                    oddsColor = "text-blue-400";
                  } else if (line.direction === 'under') {
                    oddsColor = "text-purple-400";
                  }

                  return (
                    <li
                      key={`${combo.id}-${lineIndex}`}
                      className={`relative overflow-hidden rounded-xl p-5`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        {/* LEFT: Icons & Info */}
                        <div className="flex flex-col gap-3">
                          {/* Team Icons */}
                          <div className="flex items-center gap-4">
                            {homeIcon && (
                              <img src={homeIcon} alt={homeTeam} className="h-16 w-16 object-contain drop-shadow-lg" onError={(e) => { e.target.style.display = 'none'; }} />
                            )}
                            <span className="text-sm font-bold text-slate-500">vs</span>
                            {awayIcon && (
                              <img src={awayIcon} alt={awayTeam} className="h-16 w-16 object-contain drop-shadow-lg" onError={(e) => { e.target.style.display = 'none'; }} />
                            )}
                          </div>

                          {/* Description Sentence */}
                          <div>
                            <p className="text-xl font-bold text-slate-100 leading-tight">
                              {description}
                            </p>
                          </div>

                          {/* Stats Row */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-400 mt-1">
                            <span className="text-slate-300">
                              EV: <span className={oddsColor}>{line.primaryEv?.toFixed(1)}%</span>
                            </span>

                            <div className="flex items-center gap-1.5">
                              <GlobeIcon />
                              <span><span className="text-slate-300">{formatStatText(line.statKey)}</span></span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <PinIcon />
                              <span><span className="text-slate-300">{line.scope || "total"}</span></span>
                            </div>
                          </div>
                        </div>

                        {/* RIGHT: Odds & Line */}
                        <div className="flex flex-col items-end justify-center min-w-[80px]">
                          <span className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-1">
                            Odds
                          </span>
                          <span className={`text-6xl font-bold ${oddsColor} tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]`}>
                            {line.odds?.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Links Section */}
              {matchUrlEntries.length > 0 && (
                <div className="mt-2 space-y-3 pt-2">
                  {matchUrlEntries.map(({ label, urls }) => (
                    <div key={`${combo.id}-${label}`} className="space-y-2">
                      {urls.map((url, idx) => (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={`group relative block w-full overflow-hidden rounded-full border ${buttonBorderColor} bg-transparent py-3 text-center text-sm font-bold text-${themeColor}-300 transition-all hover:bg-${themeColor}-950/30 hover:text-${themeColor}-200 ${buttonHoverGlow}`}
                        >
                          <span className="relative z-10">Bet on Unibet</span>
                        </a>
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

// "use client";

// import { buildLineKey } from "@/ai/utils/matchupUtils";

// // --- Hjälpfunktioner (Behållna men uppstädade) ---
// function buildMatchUrlEntries(lines = []) {
//   const map = new Map();
//   lines.forEach((line) => {
//     const url = line?.unibetUrl;
//     if (!url) return;
//     const label = line.matchLabel || line.match || "Match";
//     if (!map.has(label)) map.set(label, new Set());
//     map.get(label).add(url);
//   });
//   return Array.from(map.entries()).map(([label, urls]) => ({
//     label,
//     urls: Array.from(urls),
//   }));
// }

// function getTeamIconUrl(teamId) {
//   if (!teamId) return null;
//   return `/images/teams/${teamId}.png`;
// }

// function formatPeriodText(period) {
//   const p = period?.toUpperCase();
//   if (p === "1ST") return "1:a Halvlek";
//   if (p === "2ND") return "2:a Halvlek";
//   return "Fulltid";
// }

// function formatStatText(statKey) {
//   const statNames = {
//     cornerKicks: "Hörnor",
//     yellowCards: "Gula Kort",
//     fouls: "Fouls",
//     shotsOnGoal: "Skott på Mål",
//     totalShots: "Skott",
//     freeKicks: "Frisparkar",
//     throwIns: "Inkast",
//     offsides: "Offsides",
//     totalTackle: "Tacklingar",
//   };
//   return statNames[statKey] || statKey;
// }

// function getBetDescription(line) {
//   const homeTeam = line.teams?.home || "";
//   const awayTeam = line.teams?.away || "";
//   const direction = line.direction === "over" ? "Över" : "Under";
//   const stat = formatStatText(line.statKey);
//   const lineValue = line.line;

//   let subject = "";
//   if (line.scope === "home") subject = homeTeam;
//   else if (line.scope === "away") subject = awayTeam;
//   else subject = "Matchen"; // Kortare än "Team A vs Team B" för renare look

//   return (
//     <span>
//       <span className="font-semibold text-white">{subject}</span>
//       <span className="text-slate-400 mx-1">får</span>
//       <span className={line.direction === "over" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
//         {direction} {lineValue}
//       </span>{" "}
//       {stat}
//     </span>
//   );
// }

// // --- Ikoner ---
// const Icons = {
//   TrendingUp: () => (
//     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
//       <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
//       <polyline points="17 6 23 6 23 12" />
//     </svg>
//   ),
//   Clock: () => (
//     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
//       <circle cx="12" cy="12" r="10" />
//       <polyline points="12 6 12 12 16 14" />
//     </svg>
//   ),
//   Target: () => (
//     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
//       <circle cx="12" cy="12" r="10" />
//       <circle cx="12" cy="12" r="6" />
//       <circle cx="12" cy="12" r="2" />
//     </svg>
//   ),
//   ExternalLink: () => (
//     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
//       <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
//       <polyline points="15 3 21 3 21 9" />
//       <line x1="10" y1="14" x2="21" y2="3" />
//     </svg>
//   )
// };

// // --- Huvudkomponent ---
// export default function AIComboList({ combos, priorityMap = {} }) {
//   if (!combos || !combos.length) {
//     return (
//       <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-dashed border-slate-800 bg-slate-950/50">
//         <div className="text-slate-600 mb-3">
//           <Icons.Target />
//         </div>
//         <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Inga spel hittades</p>
//       </div>
//     );
//   }

//   return (
//     <div className="grid grid-cols-1 gap-6 max-w-3xl mx-auto">
//       {combos.map((combo, index) => {
//         const matchUrlEntries = buildMatchUrlEntries(combo.lines);
//         const evPercent = combo.totalEv || 0;

//         // Färgtema och stil baserat på typ av spel
//         const isCombo = combo.lines.length > 1;
//         const isHighValue = evPercent > 10;

//         // Designvariabler
//         const theme = isCombo
//           ? {
//             main: "blue",
//             border: "border-blue-500/20 hover:border-blue-500/40",
//             bg: "bg-blue-500/5",
//             text: "text-blue-400",
//             gradient: "from-blue-500 to-indigo-500"
//           }
//           : {
//             main: "emerald",
//             border: "border-emerald-500/20 hover:border-emerald-500/40",
//             bg: "bg-emerald-500/5",
//             text: "text-emerald-400",
//             gradient: "from-emerald-400 to-teal-500"
//           };

//         return (
//           <div
//             key={combo.id || index}
//             className={`group relative rounded-3xl border ${theme.border} bg-slate-950 transition-all duration-300 hover:shadow-2xl hover:shadow-${theme.main}-500/10 overflow-hidden`}
//           >
//             {/* Top "Ticket" Header */}
//             <div className="relative px-6 py-4 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
//               <div className="flex items-center gap-3">
//                 <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-slate-900 border border-slate-800 text-slate-300`}>
//                   {isCombo ? "Kombination" : "Singelspel"}
//                 </div>
//                 {isHighValue && (
//                   <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 animate-pulse">
//                     <Icons.TrendingUp />
//                     HÖGT VÄRDE
//                   </div>
//                 )}
//               </div>

//               {/* AI Score/EV display */}
//               <div className="flex items-center gap-2">
//                 <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">AI Edge</span>
//                 <span className={`text-lg font-black bg-clip-text text-transparent bg-gradient-to-r ${theme.gradient}`}>
//                   +{evPercent.toFixed(1)}%
//                 </span>
//               </div>
//             </div>

//             {/* Content Body */}
//             <div className="p-0">
//               {combo.lines.map((line, idx) => {
//                 const hasSeparator = idx !== combo.lines.length - 1;
//                 const homeIcon = getTeamIconUrl(line.teams?.homeId);
//                 const awayIcon = getTeamIconUrl(line.teams?.awayId);

//                 return (
//                   <div key={idx} className="relative">
//                     <div className={`p-6 flex flex-col sm:flex-row sm:items-center gap-6 ${hasSeparator ? 'border-b border-dashed border-slate-800' : ''}`}>

//                       {/* Teams & Logos */}
//                       <div className="flex items-center gap-4 min-w-[140px]">
//                         <div className="relative flex -space-x-3">
//                           <div className="relative z-10 h-10 w-10 rounded-full bg-slate-800 p-1 ring-2 ring-slate-950 shadow-lg">
//                             {homeIcon ? <img src={homeIcon} alt="" className="h-full w-full object-contain" /> : <div className="h-full w-full rounded-full bg-slate-700" />}
//                           </div>
//                           <div className="relative z-0 h-10 w-10 rounded-full bg-slate-800 p-1 ring-2 ring-slate-950 shadow-lg opacity-80 grayscale group-hover:grayscale-0 transition-all">
//                             {awayIcon ? <img src={awayIcon} alt="" className="h-full w-full object-contain" /> : <div className="h-full w-full rounded-full bg-slate-700" />}
//                           </div>
//                         </div>
//                       </div>

//                       {/* Bet Details */}
//                       <div className="flex-1">
//                         <div className="text-lg leading-snug mb-2">
//                           {getBetDescription(line)}
//                         </div>

//                         <div className="flex flex-wrap gap-2">
//                           <Badge icon={<Icons.Clock />} text={formatPeriodText(line.period)} />
//                           <Badge icon={<Icons.Target />} text={line.scope === "home" ? "Hemmalag" : line.scope === "away" ? "Bortalag" : "Totalt"} />
//                         </div>
//                       </div>

//                       {/* Odds Box */}
//                       <div className="flex sm:flex-col items-center justify-between sm:justify-center sm:items-end gap-1 pl-0 sm:pl-4 sm:border-l sm:border-white/5">
//                         <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Odds</span>
//                         <span className="text-3xl font-bold text-white tracking-tighter font-mono">
//                           {line.odds?.toFixed(2)}
//                         </span>
//                       </div>
//                     </div>
//                   </div>
//                 );
//               })}
//             </div>

//             {/* Action Footer */}
//             <div className="bg-slate-950 px-2 pb-2">
//               {matchUrlEntries.map(({ urls }, idx) => (
//                 <a
//                   key={idx}
//                   href={urls[0]}
//                   target="_blank"
//                   rel="noreferrer"
//                   className={`
//                     flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all
//                     ${isCombo
//                       ? "bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-600/20"
//                       : "bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-600/20"
//                     }
//                   `}
//                 >
//                   <span>Rygga spelet hos Unibet</span>
//                   <Icons.ExternalLink />
//                 </a>
//               ))}
//             </div>

//             {/* Background decoration */}
//             <div className={`absolute -top-20 -right-20 w-64 h-64 bg-${theme.main}-500/10 blur-[80px] rounded-full pointer-events-none`} />
//           </div>
//         );
//       })}
//     </div>
//   );
// }

// // Small Badge Component
// function Badge({ icon, text }) {
//   return (
//     <div className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-slate-400 border border-slate-800/50">
//       {icon}
//       <span>{text}</span>
//     </div>
//   );
// }