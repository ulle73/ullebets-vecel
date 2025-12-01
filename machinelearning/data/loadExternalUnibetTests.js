import fs from "fs/promises";
import path from "path";
import { toDateStr } from "../../lib/core/date.js";

function slugifyTeam(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readLatestFile(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort(); // ISO timestamps sort lexicografiskt
  if (!files.length) return null;
  const latest = files[files.length - 1];
  const fullPath = path.join(dir, latest);
  const raw = await fs.readFile(fullPath, "utf8");
  return { raw, filename: latest };
}

function toMatchDoc(json, filename) {
  const lines = Array.isArray(json?.lines) ? json.lines : [];
  if (!lines.length) return null;
  const homeTeam = lines[0]?.homeTeam || "Home";
  const awayTeam = lines[0]?.awayTeam || "Away";
  const dateFromFile = filename ? filename.substring(0, 10) : null;
  const matchDate = toDateStr(json.matchDate || dateFromFile) || dateFromFile || "";

  return {
    _id: `${slugifyTeam(homeTeam)}-${slugifyTeam(awayTeam)}-${matchDate}-external`,
    matchDate,
    homeTeam,
    awayTeam,
    url: json.url || null,
    lines,
  };
}

export async function loadExternalUnibetTests(baseDir) {
  const matches = [];
  try {
    const folders = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of folders) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(baseDir, entry.name);
      try {
        const latest = await readLatestFile(dirPath);
        if (!latest) continue;
        const parsed = JSON.parse(latest.raw);
        const doc = toMatchDoc(parsed, latest.filename);
        if (doc) matches.push(doc);
      } catch (err) {
        console.warn(`[loadExternalUnibetTests] Skipping folder ${entry.name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[loadExternalUnibetTests] Could not read baseDir ${baseDir}: ${err.message}`);
  }
  return matches;
}
