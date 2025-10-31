

// update-opta-rank-rating-by-id.js
import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { NAME_OVERRIDES } from "./update-opta-id.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_PATHS = [
  path.join(__dirname, "../data/leagues-and-teams.json"),
];

const RANKINGS_URL = "https://dataviz.theanalyst.com/opta-power-rankings/pr-reference.json";
const norm = (s) => (s ?? "").toString().trim().toLowerCase();

async function fetchOptaArray() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
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
  const byName = new Map();
  for (const r of optaArray) {
    const id = Number(r?.optaId);
    if (Number.isFinite(id)) byId.set(id, r);
    const candidates = [r?.contestantName, r?.contestantShortName, r?.contestantClubName];
    for (const candidate of candidates) {
      const key = norm(candidate);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, r);
    }
  }

  // 2) Läs ligor från den första sökvägen
  const leagues = JSON.parse(await fs.readFile(JSON_PATHS[0], "utf-8"));

  // 3) Uppdatera endast optaRank/optaRating via optaId
  let updated = 0;
  let missing = 0;

  for (const league of Object.values(leagues)) {
    for (const team of league.teams) {
      const id = Number(team?.optaId);
      let rec = Number.isFinite(id) ? byId.get(id) : null;
      if (!rec) {
        const nameKey = norm(team?.name);
        const overrideRaw = NAME_OVERRIDES[nameKey] ?? NAME_OVERRIDES[team?.name] ?? null;
        const lookupKey = overrideRaw ? norm(overrideRaw) : nameKey;
        if (lookupKey) rec = byName.get(lookupKey) ?? null;
      }
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
