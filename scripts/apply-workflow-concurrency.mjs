import fs from "node:fs/promises";
import path from "node:path";

const WORKFLOWS_DIR = path.join(process.cwd(), ".github", "workflows");
const CONCURRENCY_BLOCK = `concurrency:\n  group: teamstats-db-sync\n  cancel-in-progress: false`;

async function listWorkflowFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, "sv"));
}

function findTopLevelKeyIndex(source, key) {
  const re = new RegExp(`^${key}:\\s*(?:#.*)?$`, "m");
  const match = source.match(re);
  return match ? match.index : -1;
}

function findNextTopLevelKeyIndex(source, startIndex) {
  const re = /^\S[^\n]*:\s*(?:#.*)?$/gm;
  re.lastIndex = startIndex + 1;
  const match = re.exec(source);
  return match ? match.index : source.length;
}

function replaceConcurrency(source) {
  const start = findTopLevelKeyIndex(source, "concurrency");
  if (start === -1) return null;
  const end = findNextTopLevelKeyIndex(source, start);
  const before = source.slice(0, start).replace(/\s+$/, "\n\n");
  const after = source.slice(end).replace(/^\s+/, "\n\n");
  return `${before}${CONCURRENCY_BLOCK}${after}`;
}

function insertConcurrency(source) {
  const jobsIndex = findTopLevelKeyIndex(source, "jobs");
  if (jobsIndex !== -1) {
    const before = source.slice(0, jobsIndex).replace(/\s+$/, "\n\n");
    const after = source.slice(jobsIndex).replace(/^\s*/, "");
    return `${before}${CONCURRENCY_BLOCK}\n\n${after}`;
  }

  const onIndex = findTopLevelKeyIndex(source, "on");
  if (onIndex !== -1) {
    const onEnd = findNextTopLevelKeyIndex(source, onIndex);
    const before = source.slice(0, onEnd).replace(/\s+$/, "\n\n");
    const after = source.slice(onEnd).replace(/^\s+/, "\n\n");
    return `${before}${CONCURRENCY_BLOCK}${after}`;
  }

  return `${CONCURRENCY_BLOCK}\n\n${source}`;
}

function patchSource(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const replaced = replaceConcurrency(normalized);
  const patched = replaced ?? insertConcurrency(normalized);
  return patched.endsWith("\n") ? patched : `${patched}\n`;
}

const files = await listWorkflowFiles(WORKFLOWS_DIR);
if (!files.length) {
  throw new Error(`Hittade inga workflow-filer i ${WORKFLOWS_DIR}`);
}

let changed = 0;
for (const filePath of files) {
  const before = await fs.readFile(filePath, "utf8");
  const after = patchSource(before);
  if (after !== before) {
    await fs.writeFile(filePath, after, "utf8");
    changed += 1;
    console.log(`✅ Uppdaterade ${path.relative(process.cwd(), filePath)}`);
  } else {
    console.log(`⏭️ Redan korrekt ${path.relative(process.cwd(), filePath)}`);
  }
}

console.log(`Klar. Workflow-filer: ${files.length}, ändrade: ${changed}.`);
