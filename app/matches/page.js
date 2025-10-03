import { headers } from "next/headers";

export default async function MatchesPage() {
  const h = headers();
  const host = h.get("host");
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  const base = `${proto}://${host}`;

  const res = await fetch(`${base}/api/matches/search`, { cache: "no-store" });
  if (!res.ok) return <main className="p-6">API error</main>;
  const data = await res.json();

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Matches</h1>
      <ul className="space-y-2">
        {data.items.map((m) => (
          <li key={m.matchId} className="border rounded p-3">
            <a className="font-medium underline" href={`/match/${m.matchId}`}>
              {m.homeTeamName} vs {m.awayTeamName}
            </a>
            <div className="text-sm text-gray-600">
              {m.homeTeamId} – {m.awayTeamId} · {m.timestamp}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
