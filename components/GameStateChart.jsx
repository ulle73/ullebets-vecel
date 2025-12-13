"use client";

import { useMemo, useState } from "react";

export default function GameStateChart({
  rows,
  homeTeamName,
  awayTeamName,
  className = ""
}) {
  // Toggle states for Series visibility (Team level)
  const [seriesState, setSeriesState] = useState({
    home: true,
    away: true,
    league: true
  });

  // Toggle states for Type visibility (For/Against level)
  const [typeState, setTypeState] = useState({
    for: true,
    against: true
  });

  const toggleSeries = (key) => {
    setSeriesState(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleType = (key) => {
    setTypeState(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const orderedKeys = ["leading", "tied", "trailing"];
  const niceLabels = { leading: "LEDNING", tied: "LIKA", trailing: "UNDERLÄGE" };

  const data = useMemo(() => {
    return orderedKeys.map(k => {
      const row = rows.find(r => r.key === k);
      return {
        key: k,
        label: niceLabels[k],
        homeFor: row?.home?.for?.value ?? 0,
        homeAg: row?.home?.against?.value ?? 0,
        awayFor: row?.away?.for?.value ?? 0,
        awayAg: row?.away?.against?.value ?? 0,
        leagueFor: row?.league?.for ?? 0,
        leagueAg: row?.league?.against ?? 0
      };
    });
  }, [rows]);

  // Determine Y-axis range
  const maxValue = Math.max(
    ...data.flatMap(d => [d.homeFor, d.homeAg, d.awayFor, d.awayAg, d.leagueFor, d.leagueAg])
  );
  const yMax = maxValue > 0 ? maxValue * 1.2 : 0.5;

  const width = 600;
  const height = 300;
  const padding = { top: 40, right: 60, bottom: 40, left: 50 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const getX = (index) => padding.left + (index / (data.length - 1)) * graphWidth;
  const getY = (val) => padding.top + graphHeight - (val / yMax) * graphHeight;

  // Path Generators
  const createPath = (key) => {
    return data.map((d, i) =>
      `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d[key])}`
    ).join(" ");
  };

  const createArea = (key) => {
    const linePath = createPath(key);
    const bottomY = padding.top + graphHeight;
    const firstX = getX(0);
    const lastX = getX(data.length - 1);
    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  };

  // Visibility Checkers
  const showHomeFor = seriesState.home && typeState.for;
  const showHomeAg = seriesState.home && typeState.against;
  const showAwayFor = seriesState.away && typeState.for;
  const showAwayAg = seriesState.away && typeState.against;
  const showLeagueFor = seriesState.league && typeState.for;
  const showLeagueAg = seriesState.league && typeState.against;

  if (!rows || rows.length === 0) return null;

  return (
    <div className={`flex flex-col gap-4 p-6 rounded-xl bg-white/[0.02] border border-white/5 ${className}`}>

      {/* Header with Interactive Legend/Filters */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Team Shooting Adjustments
        </h3>

        {/* Legend / Filters */}
        <div className="flex items-center gap-4 text-[10px] select-none">
          {/* Home Filter */}
          <button
            onClick={() => toggleSeries('home')}
            className={`flex items-center gap-2 transition-opacity ${seriesState.home ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
            <span className="text-emerald-100 font-medium">{homeTeamName}</span>
          </button>

          {/* Away Filter */}
          <button
            onClick={() => toggleSeries('away')}
            className={`flex items-center gap-2 transition-opacity ${seriesState.away ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></span>
            <span className="text-rose-100 font-medium">{awayTeamName}</span>
          </button>

          {/* League Filter (Requested: Lighter dot, White text) */}
          <button
            onClick={() => toggleSeries('league')}
            className={`flex items-center gap-2 transition-opacity ${seriesState.league ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            <span className="w-2 h-2 rounded-full bg-slate-300 shadow-[0_0_8px_rgba(255,255,255,0.3)]"></span>
            <span className="text-white font-medium">League Avg</span>
          </button>
        </div>
      </div>

      <div className="relative w-full aspect-[2/1]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">

          <defs>
            <linearGradient id="gradHome" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="gradAway" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const y = padding.top + graphHeight * pct;
            const val = yMax * (1 - pct);
            return (
              <g key={pct}>
                <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
                  {val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* X Axis Labels (Requested: Smaller) */}
          {data.map((d, i) => (
            <text
              key={d.key}
              x={getX(i)}
              y={height - 10}
              textAnchor="middle"
              className="fill-slate-500 text-[9px] font-bold uppercase tracking-wider" // Reduced font size and dimmed color slightly
            >
              {d.label}
            </text>
          ))}

          {/* --- AREAS (Behind lines) --- */}
          {showHomeFor && <path d={createArea('homeFor')} fill="url(#gradHome)" style={{ transition: 'd 0.3s ease' }} />}
          {showAwayFor && <path d={createArea('awayFor')} fill="url(#gradAway)" style={{ transition: 'd 0.3s ease' }} />}


          {/* --- LINES --- */}

          {/* League Avg (White) */}
          {seriesState.league && (
            <>
              {/* League Against (Dashed) */}
              <path
                d={createPath('leagueAg')}
                stroke="white"
                strokeWidth="1.5"
                fill="none"
                strokeDasharray="3 3"
                opacity={showLeagueAg ? 0.3 : 0}
                style={{ transition: 'all 0.3s ease' }}
              />
              {/* League For (Solid) */}
              <path
                d={createPath('leagueFor')}
                stroke="white"
                strokeWidth="1.5"
                fill="none"
                opacity={showLeagueFor ? 0.5 : 0}
                style={{ transition: 'all 0.3s ease' }}
              />
            </>
          )}

          {/* Home (Green) */}
          {seriesState.home && (
            <>
              <path d={createPath('homeAg')} stroke="#059669" strokeWidth="2" fill="none" strokeDasharray="4 4" opacity={showHomeAg ? 0.6 : 0} style={{ transition: 'all 0.3s ease' }} />
              <path d={createPath('homeFor')} stroke="#10b981" strokeWidth="3" fill="none" strokeLinecap="round" opacity={showHomeFor ? 1 : 0} style={{ filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.3))', transition: 'all 0.3s ease' }} />
            </>
          )}

          {/* Away (Red) */}
          {seriesState.away && (
            <>
              <path d={createPath('awayAg')} stroke="#e11d48" strokeWidth="2" fill="none" strokeDasharray="4 4" opacity={showAwayAg ? 0.6 : 0} style={{ transition: 'all 0.3s ease' }} />
              <path d={createPath('awayFor')} stroke="#f43f5e" strokeWidth="3" fill="none" strokeLinecap="round" opacity={showAwayFor ? 1 : 0} style={{ filter: 'drop-shadow(0 0 4px rgba(244,63,94,0.3))', transition: 'all 0.3s ease' }} />
            </>
          )}


          {/* --- DATA POINTS --- */}
          {data.map((d, i) => (
            <g key={i}>
              {/* Home Points (Only for FOR) */}
              {showHomeFor && (
                <>
                  <circle cx={getX(i)} cy={getY(d.homeFor)} r="4" fill="#10b981" stroke="white" strokeWidth="1.5" style={{ transition: 'cy 0.3s ease' }} />
                  <text x={getX(i)} y={getY(d.homeFor) - 8} textAnchor="middle" className="fill-emerald-400 text-[10px] font-bold" style={{ transition: 'y 0.3s ease' }}>
                    {d.homeFor.toFixed(2)}
                  </text>
                </>
              )}

              {/* Away Points (Only for FOR) */}
              {showAwayFor && (
                <>
                  <circle cx={getX(i)} cy={getY(d.awayFor)} r="4" fill="#f43f5e" stroke="white" strokeWidth="1.5" style={{ transition: 'cy 0.3s ease' }} />
                  <text x={getX(i)} y={getY(d.awayFor) - 8} textAnchor="middle" className="fill-rose-400 text-[10px] font-bold" style={{ transition: 'y 0.3s ease' }}>
                    {d.awayFor.toFixed(2)}
                  </text>
                </>
              )}
            </g>
          ))}

        </svg>
      </div>

      {/* Footer Legend - Interactive - "även dom ska man kunna trycka på" */}
      <div className="flex flex-col items-center gap-1 mt-2 text-[10px] border-t border-white/5 pt-3 select-none">
        <div className="flex items-center gap-8">

          {/* Solid / FOR Button */}
          <button
            onClick={() => toggleType('for')}
            className={`flex items-center gap-2 group transition-all duration-200 ${typeState.for ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            {/* SVG Line Icon */}
            <div className="flex items-center justify-center relative bg-white/5 rounded px-2 h-4">
              <svg width="20" height="2" overflow="visible">
                <line x1="0" y1="1" x2="20" y2="1" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-white group-hover:text-emerald-400 transition-colors font-bold">
              FOR
            </span>
          </button>

          {/* Dashed / AGAINST Button */}
          <button
            onClick={() => toggleType('against')}
            className={`flex items-center gap-2 group transition-all duration-200 ${typeState.against ? 'opacity-100' : 'opacity-40 grayscale'}`}
          >
            {/* SVG Dashed Line Icon */}
            <div className="flex items-center justify-center relative bg-white/5 rounded px-2 h-4">
              <svg width="20" height="2" overflow="visible">
                <line x1="0" y1="1" x2="20" y2="1" stroke="white" strokeWidth="2" strokeDasharray="3 3" />
              </svg>
            </div>
            <span className="text-white group-hover:text-rose-400 transition-colors font-bold">
              AGAINST
            </span>
          </button>

        </div>
      </div>
    </div>
  );
}
