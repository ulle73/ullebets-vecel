// count-laliga-matches.mjs
import { readFile } from "fs/promises";
import { writeFile } from "fs/promises";

// Alternativ 1: Använd din sparade JSON-fil (rekommenderas för test)
async function countFromFile() {
  try {
    const data = await readFile("./atletico-madrid-events.json", "utf-8");
    const json = JSON.parse(data);
    return countLaLigaMatches(json);
  } catch (err) {
    console.error(
      "Kunde inte läsa filen. Har du sparat den som atletico-madrid-events.json?",
      err.message
    );
    return 0;
  }
}

// Alternativ 2: Hämta live från Sofascore API
async function countFromApi() {
  try {
    const response = await fetch(
      "https://www.sofascore.com/api/v1/team/2836/events/last/0"
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return countLaLigaMatches(json);
  } catch (err) {
    console.error("Kunde inte hämta från API:", err.message);
    return 0;
  }
}

// Huvudlogik: Räkna La Liga-matcher
function countLaLigaMatches(data) {
  if (!data?.events?.length) {
    console.log("Inga matcher hittades.");
    return 0;
  }

  const laligaMatches = data.events
    .filter((event) => event.tournament?.name === "LaLiga")
    .sort((a, b) => b.startTimestamp - a.startTimestamp); // ← NYTT: Sortera nyast först

  console.log(`Totalt antal matcher: ${data.events.length}`);
  console.log(`La Liga-matcher: ${laligaMatches.length}`);
  console.log("Senaste 5 La Liga-matcherna (nyast först):");

  laligaMatches.slice(0, 10).forEach((m) => {
    const home = m.homeTeam.name;
    const away = m.awayTeam.name;
    const date = new Date(m.startTimestamp * 1000).toLocaleDateString("sv-SE");
    const score =
      m.homeScore?.display !== undefined && m.awayScore?.display !== undefined
        ? `${m.homeScore.display}–${m.awayScore.display}`
        : "Ej spelad";
    console.log(`  ${date}: ${home} ${score} ${away}`);
  });

  return laligaMatches.length;
}

// Kör
(async () => {
  console.log("Räknar La Liga-matcher för Atlético Madrid (ID: 2836)\n");

  // Välj en av dessa:
  const count = await countFromFile(); // ← Använd din sparade fil
  // const count = await countFromApi(); // ← Hämta live från Sofascore

  console.log(`\nAntal La Liga-matcher: ${count}`);
})();
