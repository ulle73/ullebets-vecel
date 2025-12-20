"use client";

import clsx from "clsx";
import { useEffect, useRef, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Build a signature for a line to match across snapshots
 */
function buildLineSignature(line = {}) {
  const parts = [
    line.matchId || line.match_id || line.eventId || line.event_id || "",
    line.statKey || line.stat || "",
    line.scope || "",
    line.period || "",
    line.direction || (line.over === true ? "over" : line.over === false ? "under" : ""),
    line.line ?? "",
  ];
  return parts.join("|");
}

/**
 * Format date/time for display
 */
function formatDateTime(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  try {
    return date.toLocaleString("sv-SE", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * Extract historical odds for a specific line from snapshots
 * @param {Array} snapshots - Array of snapshot objects
 * @param {Object} targetLine - The line to match
 * @param {string|number} startTime - Match start time (filter out snapshots after this)
 */
function extractOddsHistory(snapshots = [], targetLine = {}, startTime = null) {
  if (!Array.isArray(snapshots) || !snapshots.length) return [];

  const targetSig = buildLineSignature(targetLine);
  if (!targetSig) return [];

  const history = [];

  let startTimeMs = null;
  if (startTime) {
    const date = new Date(startTime);
    const ts = date.getTime();
    if (!isNaN(ts)) startTimeMs = ts;
  }

  // Sort snapshots by fetchedAt descending (newest first)
  const sorted = [...snapshots].sort((a, b) => {
    const aTime = new Date(a.fetchedAt || 0).getTime();
    const bTime = new Date(b.fetchedAt || 0).getTime();
    return bTime - aTime;
  });

  for (const snap of sorted) {
    // Skip snapshots fetched after match start
    if (startTimeMs) {
      const snapTime = new Date(snap.fetchedAt || 0).getTime();
      if (snapTime >= startTimeMs) continue;
    }

    const lines = Array.isArray(snap.lines) ? snap.lines : [];
    for (const line of lines) {
      const sig = buildLineSignature(line);
      if (sig !== targetSig) continue;

      const oddsVal = Number(line.odds);
      if (!Number.isFinite(oddsVal)) continue;

      history.push({
        fetchedAt: snap.fetchedAt,
        runDate: snap.runDate,
        odds: oddsVal,
        horizonDays: snap.horizonDays,
      });
      break; // Only take first match per snapshot
    }
  }

  return history;
}

const CloseIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/**
 * OddsHistoryPopup - Shows historical odds timeline for a bet line
 * Uses same styling as AIStatsPopup
 */
export default function OddsHistoryPopup({
  snapshots = [],
  line = {},
  startTime = null,
  isOpen,
  onClose,
  triggerRef,
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popupRef = useRef(null);

  const history = useMemo(
    () => extractOddsHistory(snapshots, line, startTime),
    [snapshots, line, startTime]
  );

  // Calculate position relative to trigger (same logic as AIStatsPopup)
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && triggerRef?.current) {
        const rect = triggerRef.current.getBoundingClientRect();

        // Use fixed positioning relative to viewport
        let top = rect.top - 10;
        let left = rect.left + rect.width / 2;

        // Adjust if it goes off screen
        if (left < 175) left = 175;
        if (window.innerWidth - left < 175) left = window.innerWidth - 175;

        setPosition({ top, left });
      }
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, triggerRef]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target) &&
        (!triggerRef?.current || !triggerRef.current.contains(event.target))
      ) {
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 w-[350px] -translate-x-1/2 -translate-y-full transform rounded-3xl border border-white/20 bg-slate-900/50 backdrop-blur-2xl p-6 shadow-2xl transition-all duration-200 animate-in fade-in zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="mb-5 flex items-start justify-between border-b border-white/10 pb-4">
        <div>
          <h4 className="text-xl font-bold text-white leading-tight">
            Oddshistorik
          </h4>
          <p className="text-sm text-slate-400 mt-1 uppercase tracking-wide">
            {history.length} snapshots
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/5 p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="space-y-4 text-sm max-h-[300px] overflow-y-auto">
        {history.length === 0 ? (
          <div className="text-center text-slate-500 py-4">
            Ingen oddshistorik tillgänglig
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((entry, idx) => {
              const prevOdds = idx > 0 ? history[idx - 1].odds : null;
              const improved = prevOdds !== null && entry.odds > prevOdds;
              const worsened = prevOdds !== null && entry.odds < prevOdds;

              return (
                <div
                  key={`${entry.fetchedAt}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-300 font-medium">
                      {formatDateTime(entry.fetchedAt)}
                    </span>
                    {entry.horizonDays != null && (
                      <span className="text-xs text-slate-500">
                        {entry.horizonDays}d före match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        "text-xl font-bold tabular-nums",
                        improved && "text-emerald-400",
                        worsened && "text-rose-400",
                        !improved && !worsened && "text-white"
                      )}
                    >
                      {entry.odds.toFixed(2)}
                    </span>
                    {improved && (
                      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    )}
                    {worsened && (
                      <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer summary */}
      {history.length > 1 && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Förändring</span>
            <span className="font-mono text-white">
              {history[0].odds.toFixed(2)} → {history[history.length - 1].odds.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Arrow at bottom */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-4 w-4 rotate-45 border-b border-r border-white/10 bg-[#1a1b26]"></div>
    </div>,
    document.body
  );
}
