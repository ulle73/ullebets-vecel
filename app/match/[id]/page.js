import { getMatch } from "@/lib/repos/teamstats";

export default async function MatchPage({ params }) {
  const match = await getMatch(params.id);
  if (!match) {
    return <main className="p-6">Match not found or API error</main>;
  }

  return (
    <main className="p-6 space-y-4">
      <a className="underline text-sm" href="/matches">← Back to list</a>
      <h1 className="text-2xl font-bold">{match.homeTeamName} vs {match.awayTeamName}</h1>
      <p className="text-sm text-gray-600">ID: {match.matchId} · ts: {match.timestamp}</p>

      <section>
        <h2 className="font-semibold mb-2">Incidents ({match.incidents?.length ?? 0})</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify((match.incidents || []).slice(0, 20), null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Shotmap ({match.shotmap?.length ?? 0})</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify((match.shotmap || []).slice(0, 20), null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Odds</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify(match.odds ?? null, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Statistics</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify(match.statistics ?? [], null, 2)}
        </pre>
      </section>
    </main>
  );
}
