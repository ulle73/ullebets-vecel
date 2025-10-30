// seed-opta-id-exact.js
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

const norm = (s) => (s ?? "").toString().trim().toLowerCase();

async function fetchOptaArray() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const raw = await page.evaluate((url) => fetch(url).then((r) => r.json()), RANKINGS_URL);
  await browser.close();
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new Error("Kunde inte tolka Opta-datat som en array.");
}

async function main() {
  const ratingData = await fetchOptaArray();

  // Map: exact contestantName (norm) -> record
  const byExactName = new Map();
  for (const r of ratingData) {
    const key = norm(r?.contestantName);
    if (!key) continue;
    // Om dublett av exakt namn → låt första stå kvar (vi vill hellre nolla än chansa)
    if (!byExactName.has(key)) byExactName.set(key, r);
  }

  // Läs ligor (från första pathen)
  const leaguesPathPrimary = JSON_PATHS[0];
  const leagues = JSON.parse(await fs.readFile(leaguesPathPrimary, "utf-8"));

  let matched = 0;
  for (const league of Object.values(leagues)) {
    for (const team of league.teams) {
      const key = norm(team.name);
      const rec = byExactName.get(key);
      if (rec && Number.isFinite(+rec.optaId)) {
        team.optaId = +rec.optaId;
        matched++;
      } else {
        // Sätt explicit null om ingen EXAKT träff hittas
        team.optaId = null;
      }
    }
  }

  const payload = JSON.stringify(leagues, null, 2);
  await Promise.all(JSON_PATHS.map((p) => fs.writeFile(p, payload, "utf-8")));

  console.log(`✅ optaId seedad med EXAKT namnmatch: ${matched} träffar, övriga satta till null`);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
