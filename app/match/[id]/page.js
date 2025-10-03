import { headers } from "next/headers";

export default async function MatchPage({ params }) {
  const h = headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  const base = `${proto}://${host}`;

  const res = await fetch(`${base}/api/match/${params.id}`, { cache: "no-store" });
  if (!res.ok) {
    return <main className="p-6">Match not found or API error</main>;
  }
  const m = await res.json();

  return (
    <main className="p-6 space-y-4">
      <a className="underline text-sm" href="/matches">← Back to list</a>
      <h1 className="text-2xl font-bold">{m.homeTeamName} vs {m.awayTeamName}</h1>
      <p className="text-sm text-gray-600">ID: {m.matchId} · ts: {m.timestamp}</p>

      <section>
        <h2 className="font-semibold mb-2">Incidents ({m.incidents?.length ?? 0})</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify((m.incidents || []).slice(0, 20), null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Shotmap ({m.shotmap?.length ?? 0})</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify((m.shotmap || []).slice(0, 20), null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Odds</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify(m.odds ?? null, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Statistics</h2>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
          {JSON.stringify(m.statistics ?? [], null, 2)}
        </pre>
      </section>
    </main>
  );
}
