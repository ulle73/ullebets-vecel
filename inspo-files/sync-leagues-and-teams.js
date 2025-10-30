
import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_PATH = path.join(__dirname, "leagues-and-teams.json");
// const JSON_PATH_PUBLIC = path.join(__dirname, "frontend/public/leagues-and-teams.json");
const LEAGUE_IMG_DIR = path.join(__dirname, "frontend/public/images/league");
const TEAM_IMG_DIR = path.join(__dirname, "frontend/public/images/teams");

function extFromContentType(contentType = "") {
  if (contentType.includes("image/svg")) return ".svg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/jpeg")) return ".jpg";
  return ".png";
}

async function browserFetch(page, url) {
  return page.evaluate(async (u) => {
    const res = await fetch(u);
    return res.ok ? await res.json() : null;
  }, url);
}

async function downloadImage(page, url, filepathBase) {
  const resp = await page.goto(url, { timeout: 30000 });
  if (!resp || !resp.ok()) return null;
  const ext = extFromContentType(resp.headers()["content-type"]);
  const buf = await resp.buffer();
  await fs.writeFile(`${filepathBase}${ext}`, buf);
  return ext;
}

async function main() {
  const raw = await fs.readFile(JSON_PATH, "utf8");
  const leagues = JSON.parse(raw);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Uppdatera laglistor via SofaScore API
  for (const [leagueName, league] of Object.entries(leagues)) {
    const { leagueId, seasonId } = league;
    const url = `https://api.sofascore.com/api/v1/unique-tournament/${leagueId}/season/${seasonId}/standings/total`;
    const data = await browserFetch(page, url);
    const rows = data?.standings?.[0]?.rows ?? [];
    league.teams = rows.map((r) => ({
      name: r.team.name,
      id: r.team.id,
      slug: r.team.slug,
      imageUrl: `https://img.sofascore.com/api/v1/team/${r.team.id}/image`,
    }));
    league.imageUrl = `https://img.sofascore.com/api/v1/unique-tournament/${leagueId}/image`;
  }

  await fs.mkdir(LEAGUE_IMG_DIR, { recursive: true });
  await fs.mkdir(TEAM_IMG_DIR, { recursive: true });

  // Ladda ner bilder och uppdatera paths
  for (const [leagueName, league] of Object.entries(leagues)) {
    const leagueSlug = leagueName.toLowerCase().replace(/\s+/g, "-");
    const leagueExt = await downloadImage(
      page,
      league.imageUrl,
      path.join(LEAGUE_IMG_DIR, leagueSlug)
    );
    league.imageUrl = `/images/league/${leagueSlug}${leagueExt}`;

    for (const team of league.teams) {
      const ext = await downloadImage(
        page,
        team.imageUrl,
        path.join(TEAM_IMG_DIR, `${team.id}`)
      );
      team.imageUrl = `/images/teams/${team.id}${ext}`;
    }
  }

  await browser.close();

  const payload = JSON.stringify(leagues, null, 2);
  await Promise.all([
    fs.writeFile(JSON_PATH, payload),
  ]);

  console.log("✅ leagues-and-teams.json uppdaterad i båda sökvägarna");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
