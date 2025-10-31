// seed-opta-id-exact.js
import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_PATHS = [
  path.join(__dirname, "../data/leagues-and-teams.json"),
];

const RANKINGS_URL = "https://dataviz.theanalyst.com/opta-power-rankings/pr-reference.json";

const norm = (s) => (s ?? "").toString().trim().toLowerCase();

// Manuell mapping: teamnamn i vår fil -> exakt namn i Opta-datat.
// Lägg till poster här för lag som inte matchar automatiskt.
const NAME_OVERRIDES = {
  // "vårt namn i json": "exakt namn i opta-data",
  "1. FC Heidenheim": "Heidenheim",
  "1. FC Köln": "Köln",
  "1. FC Union Berlin": "Union Berlin",
  "1. FSV Mainz 05": "Mainz 05",
  Angers: "Angers SCO",
  "AS Monaco": "Monaco",
  "Atlético Madrid": "Atlético de Madrid",
  "Auckland FC": "Auckland",
  "Bayer 04 Leverkusen": "Bayer Leverkusen",
  Bournemouth: "AFC Bournemouth",
  "Celta Vigo": "Celta de Vigo",
  "Deportivo Alavés": "Alavés",
  "FC Augsburg": "Augsburg",
  "FC Bayern München": "Bayern München",
  "FC St. Pauli": "St. Pauli",
  "Girona FC": "Girona",
  "Levante UD": "Levante UD",
  "Macarthur FC": "Macarthur FC",
  "Olympique de Marseille": "Olympique de Marseille",
  "RC Lens": "Lens",
  "RC Strasbourg": "Strasbourg",
  "Red Bull Bragantino": "Red Bull Bragantino",
  "SC Freiburg": "SC Freiburg",
  "Stade Brestois": "Brest",
  "Stade Rennais": "Rennes",
  "SV Werder Bremen": "SV Werder Bremen",
  "Sydney FC": "Sydney FC",
  "TSG Hoffenheim": "Hoffenheim",
  "VfB Stuttgart": "Stuttgart",
  "VfL Wolfsburg": "Wolfsburg",
  Wolverhampton: "Wolverhampton Wanderers",
};

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
    const candidates = [r?.contestantName, r?.contestantShortName, r?.contestantClubName];
    for (const candidate of candidates) {
      const key = norm(candidate);
      if (!key) continue;
      // Om dublett av exakt namn → låt första stå kvar (vi vill hellre nolla än chansa)
      if (!byExactName.has(key)) byExactName.set(key, r);
    }
  }

  // Läs ligor (från första pathen)
  const leaguesPathPrimary = JSON_PATHS[0];
  const leagues = JSON.parse(await fs.readFile(leaguesPathPrimary, "utf-8"));

  let matched = 0;
  for (const league of Object.values(leagues)) {
    for (const team of league.teams) {
      const key = norm(team.name);
      const overrideRaw = NAME_OVERRIDES[key] ?? NAME_OVERRIDES[team.name] ?? null;
      const overrideKey = overrideRaw ? norm(overrideRaw) : key;
      const rec = byExactName.get(overrideKey);
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

  await runUpdateRatings();
}

async function runUpdateRatings() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "./update-opta-ratings.js")], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`update-opta-ratings.js exited with code ${code}`));
    });
  });
}

export { NAME_OVERRIDES };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error("❌", err);
    process.exit(1);
  });
}
