"use client";

import { deriveScopeLabel } from "@/lib/utils/matchups";

export const DEFAULT_SCORE_THRESHOLDS = { high: 95, medium: 70 };

export function ScoreChip({ score, formatScore, thresholds }) {
  const base = "rounded px-3 py-1 text-xs font-bold";
  let tone = "bg-gray-100 text-gray-700";
  const high = thresholds?.high ?? DEFAULT_SCORE_THRESHOLDS.high;
  const medium = thresholds?.medium ?? DEFAULT_SCORE_THRESHOLDS.medium;
  if (score >= high) {
    tone = "bg-emerald-100 text-emerald-800";
  } else if (score >= medium) {
    tone = "bg-amber-100 text-amber-800";
  }
  const label = formatScore ? formatScore(score) : `${score.toFixed(1)}/100`;
  return <span className={`${base} ${tone}`}>{label}</span>;
}

export function Badge({ badge }) {
  if (!badge) return null;
  const base = "ml-2 rounded px-2 py-0.5 text-[8.25px] font-semibold";
  const tone =
    badge.tone === "perfect"
      ? "bg-yellow-200 text-yellow-900"
      : badge.tone === "almost"
        ? "bg-amber-100 text-amber-800"
        : "bg-blue-100 text-blue-800";
  return <span className={`${base} ${tone}`}>{badge.label}</span>;
}

export function FilterChips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${active
                ? "border-blue-500 bg-blue-500 text-white shadow"
                : "border-gray-300 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
              }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function RowAvg({ r, showHistoricalOutcome = false, highlightPct = 0 }) {
  const scopeLabel = r.scopeLabel ?? deriveScopeLabel(r.scope, r.matchLabel);
  const highlightThreshold = r.scoreThresholds?.high ?? 95;
  const borderHighlight =
    r.score >= highlightThreshold ? "border-2 border-emerald-400" : "border border-gray-200";
  const formatOutcomeNumber = (value) => {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : value.toFixed(1);
  };
  const formattedOutcomeValue = formatOutcomeNumber(r.outcomeValue);
  const showOutcome = showHistoricalOutcome && formattedOutcomeValue != null;
  const leagueBaselineValue = Number.isFinite(r.leagueBaseline) ? r.leagueBaseline : null;
  const formattedLeagueBaseline = formatOutcomeNumber(leagueBaselineValue);
  const hasComparison = showOutcome && leagueBaselineValue != null && leagueBaselineValue !== 0;
  const pctDelta = hasComparison
    ? ((r.outcomeValue - leagueBaselineValue) / leagueBaselineValue) * 100
    : null;
  const formattedPct = pctDelta != null ? `${pctDelta >= 0 ? "+" : ""}${pctDelta.toFixed(1)}%` : null;

  const condition = (r.condition ?? "").toLowerCase();
  const isOver = condition === "over";
  const isUnder = condition === "under";
  const isGreen = (isOver && pctDelta > 0) || (isUnder && pctDelta < 0);
  const isRed = (isOver && pctDelta < 0) || (isUnder && pctDelta > 0);
  const pctTone = isGreen ? "text-emerald-700" : isRed ? "text-red-700" : "text-gray-700";
  const pctBg =
    pctDelta != null && Math.abs(pctDelta) >= (Number.isFinite(highlightPct) ? highlightPct : 0)
      ? "animate-pulse"
      : "";
  const outcomeDetails = [];
  const homeDetail = formatOutcomeNumber(r.outcomeHomeValue);
  const awayDetail = formatOutcomeNumber(r.outcomeAwayValue);
  if (homeDetail != null) outcomeDetails.push(`Hem ${homeDetail}`);
  if (awayDetail != null) outcomeDetails.push(`Bort ${awayDetail}`);

  const renderBehaviour = (behaviour, prefix = null) => {
    if (!behaviour?.label) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
        {prefix ? <span className="font-bold text-slate-500">{prefix}</span> : null}
        {behaviour.emoji ?? "•"} {behaviour.label}
      </span>
    );
  };

  const renderMarketBiasBadge = (bias, labelPrefix = "MB") => {
    if (!bias) return null;
    const dir = bias.direction ?? "–";
    const tone =
      dir === "over"
        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
        : dir === "under"
        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
        : "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
    const biasText = Number.isFinite(bias.bias) ? bias.bias.toFixed(2) : null;
    const nText = Number.isFinite(bias.sampleSize) ? `n=${bias.sampleSize}` : null;
    const parts = [dir, biasText, nText].filter(Boolean).join(" · ");
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${tone}`}>
        {labelPrefix} {parts || dir}
      </span>
    );
  };

  return (
    <li
      className={`flex min-h-[100px] items-start justify-between rounded bg-white px-4 py-4 text-sm shadow-sm transition-colors ${borderHighlight}`}
    >
      <div className="min-w-0">
        <div className="flex items-center">
          <span className="truncate text-sm font-medium text-gray-900">{r.matchLabel}</span>
          <Badge badge={r.badge} />
        </div>

        <div className="mt-2 space-y-1 text-xs text-gray-600">
          <div className="font-medium text-gray-700 py-1">
            {r.statLabel} · {r.period}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded bg-blue-50 px-2 py-1 text-[8.25px] font-semibold text-blue-700">
              {scopeLabel}
            </span>
            {Number.isFinite(r.scewScore) ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
                  r.scewScore > 0
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : r.scewScore < 0
                    ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                    : "bg-gray-100 text-gray-700 ring-1 ring-gray-200"
                }`}
                title="Overall SCEW-score (alla odds)"
              >
                SCEW {(r.scewScore > 0 ? "+" : "") + r.scewScore.toFixed(1)}
              </span>
            ) : null}
            {r.marketBias
              ? r.scope === "total" && typeof r.marketBias === "object" && (r.marketBias.home || r.marketBias.away)
                ? (
                  <>
                    {renderMarketBiasBadge(r.marketBias.home, "MB H")}
                    {renderMarketBiasBadge(r.marketBias.away, "MB B")}
                  </>
                )
                : renderMarketBiasBadge(r.marketBias, "MB")
              : null}
            {r.scope === "home" ? renderBehaviour(r.homeBehaviour, "H") : null}
            {r.scope === "away" ? renderBehaviour(r.awayBehaviour, "B") : null}
            {r.scope === "total" ? (
              <>
                {renderBehaviour(r.homeBehaviour, "H")}
                {renderBehaviour(r.awayBehaviour, "B")}
              </>
            ) : null}
          </div>
          {r.leagueName ? (
            <div className="mt-2">
            <span className="rounded bg-gray-100 px-2 py-1 text-[8.25px] font-semibold text-gray-700">
              {r.leagueName}
            </span>
          </div>
        ) : null}
          {(showOutcome || formattedLeagueBaseline != null) ? (
            <div className="mt-2 text-xs text-gray-600 space-y-1">
              {showOutcome ? (
                <div>
                  <span className="font-semibold text-gray-700">Utfall:</span>
                  <span className="ml-1 text-gray-900">{formattedOutcomeValue}</span>
                  {outcomeDetails.length ? (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {outcomeDetails.join(" · ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {formattedLeagueBaseline != null ? (
                <div className="text-[11px]">
                  <span className="font-semibold text-gray-700">Liga-snitt:</span>
                  <span className="ml-1 text-gray-900">{formattedLeagueBaseline}</span>
                  {formattedPct ? (
                    <span className={`ml-2 font-semibold ${pctTone} ${pctBg}`}>
                      {formattedPct}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="ml-3 shrink-0 text-right">
        <ScoreChip score={r.score} formatScore={r.scoreFormat} thresholds={r.scoreThresholds} />
      </div>
    </li>
  );
}
