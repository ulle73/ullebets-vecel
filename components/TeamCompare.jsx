"use client";

export default function TeamCompare({ match, isLoading, error, className = "" }) {
  const renderBody = () => {
    if (error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-sm text-red-700">
          <p className="font-semibold">Could not load match details.</p>
          <p className="mt-1">{error.message || "Unknown error"}</p>
        </div>
      );
    }

    if (!match) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-sm text-gray-500">
          <p>Select a match to compare the teams.</p>
        </div>
      );
    }

    const { homeTeamName, awayTeamName, homeTeamId, awayTeamId } = match;

    return (
      <div className="grid flex-1 grid-cols-1 divide-x divide-gray-100 md:grid-cols-2">
        <section className="flex flex-col p-4">
          <header className="mb-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Home team</p>
            <h3 className="text-lg font-semibold text-gray-900">{homeTeamName ?? "—"}</h3>
            {homeTeamId ? <p className="text-xs text-gray-400">ID: {homeTeamId}</p> : null}
          </header>
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {isLoading ? "Loading stats…" : "Stats will appear here"}
          </div>
        </section>
        <section className="flex flex-col p-4">
          <header className="mb-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Away team</p>
            <h3 className="text-lg font-semibold text-gray-900">{awayTeamName ?? "—"}</h3>
            {awayTeamId ? <p className="text-xs text-gray-400">ID: {awayTeamId}</p> : null}
          </header>
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {isLoading ? "Loading stats…" : "Stats will appear here"}
          </div>
        </section>
      </div>
    );
  };

  const containerClass = [
    "flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={containerClass}>
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Team compare</h2>
      </div>
      {renderBody()}
    </div>
  );
}
