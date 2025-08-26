const fs = require("fs");

function safeRead(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const oldData = safeRead("previous.json");
const newData = safeRead("current.json");

if (!oldData || !newData) {
  console.log("No diff to post");
  process.exit(0);
}

let output = [];

function isObject(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj);
}

function diffObjects(oldObj, newObj, path = "") {
  let diffs = { added: [], removed: [], renamed: [], moved: [] };

  // Removed
  for (const key of Object.keys(oldObj)) {
    if (!(key in newObj)) {
      diffs.removed.push(`${path}"${key}": ${JSON.stringify(oldObj[key])}`);
    }
  }

  // Added
  for (const key of Object.keys(newObj)) {
    if (!(key in oldObj)) {
      diffs.added.push(`${path}"${key}": ${JSON.stringify(newObj[key])}`);
    }
  }

  // Changed or Renamed
  for (const key of Object.keys(oldObj)) {
    if (key in newObj) {
      if (isObject(oldObj[key]) && isObject(newObj[key])) {
        const nested = diffObjects(oldObj[key], newObj[key], path + key + ".");
        diffs.added.push(...nested.added);
        diffs.removed.push(...nested.removed);
        diffs.renamed.push(...nested.renamed);
        diffs.moved.push(...nested.moved);
      } else if (oldObj[key] !== newObj[key]) {
        diffs.renamed.push(
          `${path}"${key}": ${JSON.stringify(oldObj[key])} -> ${JSON.stringify(newObj[key])}`
        );
      }
    }
  }

  return diffs;
}

const diffs = diffObjects(oldData, newData);

if (
  diffs.added.length === 0 &&
  diffs.removed.length === 0 &&
  diffs.renamed.length === 0 &&
  diffs.moved.length === 0
) {
  console.log("No diff to post");
  process.exit(0);
}

if (diffs.added.length) {
  output.push("### Added", "```diff", ...diffs.added.map((l) => `+ ${l}`), "```");
}
if (diffs.removed.length) {
  output.push("### Removed", "```diff", ...diffs.removed.map((l) => `- ${l}`), "```");
}
if (diffs.renamed.length) {
  output.push("### Renamed", "```diff", ...diffs.renamed.map((l) => `~ ${l}`), "```");
}
if (diffs.moved.length) {
  output.push("### Moved", "```diff", ...diffs.moved.map((l) => `# ${l}`), "```");
}

console.log(output.join("\n"));
