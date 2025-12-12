// Testar hur många matcher som har incidents och shotmap i data/teamstats.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEAMSTATS_DIR = path.join(__dirname, "data", "teamstats");

const args = new Set(process.argv.slice(2));
const allowMissing = args.has("--allow-missing");
const missingLimit = Number.parseInt(
  process.env.TEAMSTATS_MISSING_LIMIT ?? "20",
  10
);

function readTeamstatFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /_(home|away)_match_stats\.json$/i.test(name))
    .sort();
}

function loadMatches(fileName) {
  const filePath = path.join(TEAMSTATS_DIR, fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data?.full) ? data.full : [];
}

function arrifyShotmap(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.shotmap)) return value.shotmap; // { shotmap: [...] }
  if (Array.isArray(value.shots)) return value.shots; // { shots: [...] }
  if (Array.isArray(value.data)) return value.data; // fallback
  return [];
}

function extractShotmap(match) {
  const candidates = [match?.shotmap, match?.matchDetails?.shotmap];
  for (const candidate of candidates) {
    const arr = arrifyShotmap(candidate);
    if (arr.length) return arr;
  }
  return [];
}

function extractIncidents(match) {
  const candidates = [match?.incidents, match?.matchDetails?.incidents];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.incidents)) return candidate.incidents;
    if (Array.isArray(candidate?.data)) return candidate.data;
  }
  return [];
}

function getMatchId(match, index) {
  if (match?.matchId !== undefined && match?.matchId !== null) {
    return String(match.matchId);
  }
  if (match?._id !== undefined && match?._id !== null) {
    return String(match._id);
  }
  return `unknown-${index}`;
}

function analyzeFile(fileName) {
  const matches = loadMatches(fileName);
  const missingIncidents = [];
  const missingShotmap = [];
  let incidents = 0;
  let shotmap = 0;

  matches.forEach((match, index) => {
    const id = getMatchId(match, index);

    const incidentEntries = extractIncidents(match);
    if (incidentEntries.length > 0) {
      incidents += 1;
    } else {
      missingIncidents.push(id);
    }

    const shotEntries = extractShotmap(match);
    if (shotEntries.length > 0) {
      shotmap += 1;
    } else {
      missingShotmap.push(id);
    }
  });

  return {
    fileName,
    total: matches.length,
    incidents,
    shotmap,
    missingIncidents,
    missingShotmap,
  };
}

function pct(part, whole) {
  if (!whole) return "0.0";
  return ((part / whole) * 100).toFixed(1);
}

function logMissing(label, items) {
  if (items.length === 0) {
    console.log(`  ${label}: inga saknade matcher 🎉`);
    return;
  }

  const sample = items.slice(0, Math.max(0, missingLimit));
  const sampleText = sample
    .map(({ file, matchId }) => `${file}:${matchId}`)
    .join(", ");
  console.log(
    `  ${label}: ${items.length} saknas (första ${sample.length} visas)`
  );
  if (sampleText) {
    console.log(`    ${sampleText}`);
  }
  if (items.length > sample.length) {
    console.log(`    ... och ${items.length - sample.length} till`);
  }
}

function main() {
  const files = readTeamstatFiles(TEAMSTATS_DIR);
  if (files.length === 0) {
    console.error("Inga teamstats-filer hittades.");
    process.exit(1);
  }

  const analyses = files.map(analyzeFile);
  const totals = analyses.reduce(
    (acc, file) => {
      acc.matches += file.total;
      acc.incidents += file.incidents;
      acc.shotmap += file.shotmap;
      file.missingIncidents.forEach((matchId) =>
        acc.missingIncidents.push({ file: file.fileName, matchId })
      );
      file.missingShotmap.forEach((matchId) =>
        acc.missingShotmap.push({ file: file.fileName, matchId })
      );
      if (file.missingIncidents.length || file.missingShotmap.length) {
        acc.filesWithMissing.push(file);
      }
      return acc;
    },
    {
      matches: 0,
      incidents: 0,
      shotmap: 0,
      missingIncidents: [],
      missingShotmap: [],
      filesWithMissing: [],
    }
  );

  console.log("\n🧪 Teamstats incidents/shotmap coverage\n");
  console.log(
    `Analyserade ${files.length} filer med totalt ${totals.matches} matcher.`
  );
  console.log(
    `  Incidents: ${totals.incidents}/${totals.matches} matcher (${pct(
      totals.incidents,
      totals.matches
    )} %)`
  );
  console.log(
    `  Shotmap:   ${totals.shotmap}/${totals.matches} matcher (${pct(
      totals.shotmap,
      totals.matches
    )} %)`
  );

  if (totals.filesWithMissing.length) {
    console.log("\nFiler med saknad data:");
    totals.filesWithMissing.forEach((file) => {
      console.log(
        `- ${file.fileName}: incidents ${file.incidents}/${file.total}, shotmap ${file.shotmap}/${file.total}`
      );
      if (file.missingIncidents.length) {
        const list = file.missingIncidents
          .slice(0, Math.max(0, missingLimit))
          .join(", ");
        console.log(
          `    saknade incidents (${file.missingIncidents.length}): ${list}`
        );
      }
      if (file.missingShotmap.length) {
        const list = file.missingShotmap
          .slice(0, Math.max(0, missingLimit))
          .join(", ");
        console.log(
          `    saknade shotmap (${file.missingShotmap.length}): ${list}`
        );
      }
    });
  } else {
    console.log("\nAlla filer har incidents och shotmap för samtliga matcher. 🎉");
  }

  console.log("\nSample på saknade:");
  logMissing("Incidents", totals.missingIncidents);
  logMissing("Shotmap", totals.missingShotmap);

  const hasMissing =
    totals.missingIncidents.length > 0 || totals.missingShotmap.length > 0;
  if (hasMissing && !allowMissing) {
    console.error(
      "\n❌ Saknade incidents/shotmap hittades. Kör med --allow-missing för att bara rapportera utan fail."
    );
    process.exit(1);
  }

  console.log("\n✅ Test klart.");
  process.exit(0);
}

main();
