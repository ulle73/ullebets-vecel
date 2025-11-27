"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import AISpinner from "@/ai/components/AISpinner";

export default function AIHeroInput({
  date,
  setDate,
  onGenerate,
  isBusy,
  statusLabel,
  isScrolled,
}) {
  const [localDate, setLocalDate] = useState(date ?? "");

  useEffect(() => {
    setLocalDate(date ?? "");
  }, [date]);

  const handleDateChange = (e) => {
    const next = e.target.value;
    setLocalDate(next);
    setDate?.(next);
  };

  return (
    <div
      className={clsx(
        "sticky top-6 z-40 w-full max-w-5xl transition-transform duration-500 ease-out will-change-transform",
        isScrolled ? "scale-95 translate-y-1" : "scale-100 translate-y-0"
      )}
      style={{ transformOrigin: "top center" }}
    >
      {/* Animated Border Container */}
      <div
        className={clsx(
          "relative group rounded-full transition-all duration-500",
          isScrolled ? "p-[2px]" : "p-[3px]"
        )}
      >
        {/* The Moving Gradient Glow/Border */}
        <div
          className={clsx(
            "absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500 opacity-75 blur-xl transition-all duration-1000 group-hover:opacity-100 animate-border-spin",
            isScrolled ? "opacity-50" : "opacity-90"
          )}
          style={{ backgroundSize: "200% 200%" }}
        />

        {/* Inner Content Container */}
        <div
          className={clsx(
            "relative flex items-center overflow-hidden rounded-full bg-black/90 backdrop-blur-xl transition-all duration-500",
            isScrolled ? "h-16 shadow-lg shadow-emerald-900/20" : "h-28 shadow-2xl shadow-emerald-500/30"
          )}
        >
          {/* Date Picker Section */}
          <div className="relative flex-shrink-0 h-full">
            <input
              type="date"
              value={localDate}
              onChange={handleDateChange}
              className={clsx(
                "h-full bg-transparent text-center font-mono font-bold text-slate-200 focus:outline-none [&::-webkit-calendar-picker-indicator]:invert transition-all duration-500",
                isScrolled ? "px-6 text-lg" : "px-12 text-3xl"
              )}
            />
            {/* Divider */}
            <div className="absolute right-0 top-1/2 h-1/2 w-px -translate-y-1/2 bg-white/10" />
          </div>

          {/* Generate Button Section */}
          <button
            onClick={onGenerate}
            disabled={isBusy}
            className="group/btn relative flex flex-1 h-full items-center justify-center overflow-hidden transition-all hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={clsx(
                "relative z-10 flex items-center gap-4 font-bold uppercase tracking-wider text-emerald-400 transition-all duration-500 group-hover/btn:text-emerald-300",
                isScrolled ? "text-lg" : "text-3xl"
              )}
            >
              {isBusy ? (
                <>
                  <AISpinner className={isScrolled ? "h-5 w-5" : "h-8 w-8"} />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <span>Generate Bets</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={clsx(
                      "transition-transform group-hover/btn:translate-x-1",
                      isScrolled ? "h-5 w-5" : "h-8 w-8"
                    )}
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Status Label */}
      {!isScrolled && (
        <div className="mt-8 text-center animate-in fade-in slide-in-from-top-2 duration-700 delay-200">
          <p className="text-lg font-medium text-slate-500 transition-colors duration-300 hover:text-slate-400">
            {statusLabel}
          </p>
        </div>
      )}

      <style jsx>{`
        @keyframes border-spin {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .animate-border-spin {
          animation: border-spin 3s ease infinite;
        }
      `}</style>
    </div>
  );
}
