"use client";

export default function BacktestPage({ match, className = "" }) {
  const message = match
    ? "Backtest-data kommer snart."
    : "Välj en match för att se backtest.";

  const containerClass = [
    "flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          Backtest
        </h2>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-gray-400">
        {message}
      </div>
    </div>
  );
}
