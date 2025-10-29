import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEAMSTATS_DIR = path.join(__dirname, '..', 'data', 'teamstats');

const METRICS = {
  incidents: {
    flag: '--incidents',
    key: 'incidents',
    label: 'Incidents',
  },
  shotmap: {
    flag: '--shotmap',
    key: 'shotmap',
    label: 'Shotmap',
  },
  odds: {
    flag: '--odds',
    key: 'odds',
    label: 'Odds',
  },
};

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    return Object.values(METRICS);
  }

  const selected = [];
  const knownFlags = new Set(Object.values(METRICS).map((metric) => metric.flag));

  for (const arg of args) {
    if (!knownFlags.has(arg)) {
      console.error(`Okänd flagga: ${arg}`);
      console.error(`Tillgängliga flaggor: ${Array.from(knownFlags).join(', ')}`);
      process.exit(1);
    }

    const metric = Object.values(METRICS).find((candidate) => candidate.flag === arg);
    if (metric && !selected.includes(metric)) {
      selected.push(metric);
    }
  }

  if (selected.length === 0) {
    return Object.values(METRICS);
  }

  return selected;
}

function readTeamstatsFiles(directory) {
  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /_(home|away)_match_stats\.json$/i.test(name))
      .sort();
  } catch (error) {
    console.error(`Kunde inte läsa katalogen ${directory}:`, error.message);
    return [];
  }
}

function loadMatches(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.full)) {
      return [];
    }
    return data.full;
  } catch (error) {
    console.error(`Kunde inte läsa ${filePath}:`, error.message);
    return [];
  }
}

function hasMetricData(match, key) {
  const value = match?.[key];
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

function getMatchId(match, index) {
  if (match && (match.matchId !== undefined && match.matchId !== null)) {
    return String(match.matchId);
  }
  return `unknown-${index}`;
}

function analyzeFile(fileName, metrics) {
  const filePath = path.join(TEAMSTATS_DIR, fileName);
  const matches = loadMatches(filePath);

  const results = metrics.map((metric) => {
    const missing = [];
    let presentCount = 0;

    matches.forEach((match, index) => {
      if (hasMetricData(match, metric.key)) {
        presentCount += 1;
      } else {
        missing.push(getMatchId(match, index));
      }
    });

    return {
      metric,
      presentCount,
      missing,
      total: matches.length,
    };
  });

  return { fileName, results };
}

function logResults(analysis) {
  console.log(`\n${analysis.fileName}`);
  analysis.results.forEach((result) => {
    const { metric, presentCount, total, missing } = result;
    const missingCount = missing.length;
    const label = metric.label;

    console.log(`  ${label}: ${presentCount}/${total} matcher har data`);
    if (missingCount === 0) {
      console.log('    Saknade matchId: inga');
    } else {
      console.log(`    Saknade matchId (${missingCount}): ${missing.join(', ')}`);
    }
  });
}

function main() {
  const metrics = parseArgs(process.argv);
  const files = readTeamstatsFiles(TEAMSTATS_DIR);

  if (files.length === 0) {
    console.warn('Inga teamstats-filer hittades.');
    return;
  }

  files.forEach((fileName) => {
    const analysis = analyzeFile(fileName, metrics);
    logResults(analysis);
  });
}

main();
