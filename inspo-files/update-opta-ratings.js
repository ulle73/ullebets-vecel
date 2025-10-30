
// update-opta-rank-rating-by-id.js
import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_PATHS = [
  path.join(__dirname, "../data/leagues-and-teams.json"),
];

const RANKINGS_URL = "https://dataviz.theanalyst.com/opta-power-rankings/pr-reference.json";

async function fetchOptaArray() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const raw = await page.evaluate((url) => fetch(url).then((r) => r.json()), RANKINGS_URL);
  await browser.close();

  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new Error("Kunde inte tolka Opta-datat som en array.");
}

async function main() {
  // 1) Hämta Opta-listan och indexera via optaId
  const optaArray = await fetchOptaArray();
  const byId = new Map();
  for (const r of optaArray) {
    const id = Number(r?.optaId);
    if (Number.isFinite(id)) byId.set(id, r);
  }

  // 2) Läs ligor från den första sökvägen
  const leagues = JSON.parse(await fs.readFile(JSON_PATHS[0], "utf-8"));

  // 3) Uppdatera endast optaRank/optaRating via optaId
  let updated = 0;
  let missing = 0;

  for (const league of Object.values(leagues)) {
    for (const team of league.teams) {
      const id = Number(team?.optaId);
      if (!Number.isFinite(id)) {
        team.optaRank = null;
        team.optaRating = null;
        missing++;
        continue;
      }
      const rec = byId.get(id);
      if (!rec) {
        team.optaRank = null;
        team.optaRating = null;
        missing++;
        continue;
      }
      team.optaRank   = Number.isFinite(+rec.rank) ? +rec.rank : null;
      team.optaRating = Number.isFinite(+rec.currentRating) ? +rec.currentRating : null;
      updated++;
    }
  }

  // 4) Skriv till båda leagues-and-teams-filerna
  const payload = JSON.stringify(leagues, null, 2);
  await Promise.all(JSON_PATHS.map((p) => fs.writeFile(p, payload, "utf-8")));

  console.log(`✅ Uppdaterade optaRank/optaRating för ${updated} lag. Saknade/utan träff: ${missing}.`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
