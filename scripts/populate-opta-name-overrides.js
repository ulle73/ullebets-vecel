import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEAGUES_PATH = path.join(__dirname, "../data/leagues-and-teams.json");
const UPDATE_SCRIPT_PATH = path.join(__dirname, "./update-opta-id.js");

const NAME_OVERRIDES_REGEX = /const NAME_OVERRIDES = {[\s\S]*?};/;

const escape = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function loadNullTeams() {
  const raw = await fs.readFile(LEAGUES_PATH, "utf-8");
  const leagues = JSON.parse(raw);
  const names = new Set();

  for (const league of Object.values(leagues)) {
    for (const team of league.teams ?? []) {
      if (team.optaId == null && typeof team.name === "string" && team.name.trim()) {
        names.add(team.name.trim());
      }
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, "sv"));
}

function buildOverridesBlock(names) {
  const lines = [
    'const NAME_OVERRIDES = {',
    '  // "vårt namn i json": "exakt namn i opta-data",',
  ];

  for (const name of names) {
    const escaped = escape(name);
    lines.push(`  "${escaped}": "${escaped}",`);
  }

  lines.push("};");

  return lines.join("\n");
}

async function updateOverrides() {
  const names = await loadNullTeams();
  const source = await fs.readFile(UPDATE_SCRIPT_PATH, "utf-8");

  if (!NAME_OVERRIDES_REGEX.test(source)) {
    throw new Error("Hittade inte NAME_OVERRIDES i update-opta-id.js");
  }

  const newBlock = buildOverridesBlock(names);
  const nextSource = source.replace(NAME_OVERRIDES_REGEX, newBlock);

  await fs.writeFile(UPDATE_SCRIPT_PATH, nextSource + (nextSource.endsWith("\n") ? "" : "\n"), "utf-8");

  console.log(`Uppdaterade NAME_OVERRIDES med ${names.length} lag utan optaId.`);
}

updateOverrides().catch((err) => {
  console.error(err);
  process.exit(1);
});
