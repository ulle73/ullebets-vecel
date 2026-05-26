import fs from "node:fs/promises";
import path from "node:path";

const workflowsDir = path.join(process.cwd(), ".github", "workflows");

const files = (await fs.readdir(workflowsDir))
  .filter((name) => /\.ya?ml$/i.test(name))
  .map((name) => path.join(workflowsDir, name));

let changed = 0;
for (const file of files) {
  const before = await fs.readFile(file, "utf8");
  let after = before
    .replace(/cancel-in-progress:\s*falsepermissions:/g, "cancel-in-progress: false\n\npermissions:")
    .replace(/cancel-in-progress:\s*falsejobs:/g, "cancel-in-progress: false\n\njobs:")
    .replace(/cancel-in-progress:\s*false\s*permissions:/g, "cancel-in-progress: false\n\npermissions:")
    .replace(/cancel-in-progress:\s*false\s*jobs:/g, "cancel-in-progress: false\n\njobs:");

  if (after !== before) {
    await fs.writeFile(file, after, "utf8");
    changed += 1;
    console.log(`Fixed ${path.relative(process.cwd(), file)}`);
  }
}

console.log(`Fixed workflow files: ${changed}`);
