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

function isObject(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj);
}

function diffObjects(oldObj, newObj, path = "") {
  let diffs = { added: [], removed: [], renamed: [], moved: [] };

  // Removed
  for (const key of Object.keys(oldObj)) {
    if (!(key in newObj)) {
      diffs.removed.push({ key, value: oldObj[key], path });
    }
  }

  // Added
  for (const key of Object.keys(newObj)) {
    if (!(key in oldObj)) {
      diffs.added.push({ key, value: newObj[key], path });
    }
  }

  // Changed or Renamed
  for (const key of Object.keys(oldObj)) {
    if (key in newObj) {
      if (isObject(oldObj[key]) && isObject(newObj[key])) {
        const nested = diffObjects(oldObj[key], newObj[key], path + key + ".");
        for (const type in nested) diffs[type].push(...nested[type]);
      } else if (oldObj[key] !== newObj[key]) {
        diffs.renamed.push(
          `${path}"${key}": ${JSON.stringify(oldObj[key])} -> ${JSON.stringify(newObj[key])}`
        );
      }
    }
  }

  return diffs;
}

let diffs = diffObjects(oldData, newData);

// --- Detect moves ---
function detectMoves(diffs, oldObj, newObj) {
  let moved = [];

  // Sub-key moves
  let removedMap = new Map();
  for (const r of diffs.removed) {
    removedMap.set(JSON.stringify(r.value), r);
  }

  let newRemoved = [];
  let newAdded = [];

  for (const a of diffs.added) {
    const match = removedMap.get(JSON.stringify(a.value));
    if (match) {
      moved.push(
        `"${a.key}" moved from ${match.path || "(root)"} to ${a.path || "(root)"}`
      );
      removedMap.delete(JSON.stringify(a.value));
    } else {
      newAdded.push(a);
    }
  }
  newRemoved = [...removedMap.values()];

  // Whole-module moves
  let oldModules = Object.keys(oldObj);
  let newModules = Object.keys(newObj);

  for (const o of oldModules) {
    for (const n of newModules) {
      if (
        JSON.stringify(oldObj[o]) === JSON.stringify(newObj[n]) &&
        o !== n
      ) {
        moved.push(`module "${o}" moved to "${n}"`);
      }
    }
  }

  return {
    added: newAdded,
    removed: newRemoved,
    renamed: diffs.renamed,
    moved: moved
  };
}

diffs = detectMoves(diffs, oldData, newData);

// --- Format output ---
function formatDiffs(diffs) {
  let output = [];

  if (diffs.added.length) {
    output.push("### Added", "```diff",
      ...diffs.added.map(l => `+ ${l.path}"${l.key}": ${JSON.stringify(l.value)}`),
      "```"
    );
  }

  if (diffs.removed.length) {
    output.push("### Removed", "```diff",
      ...diffs.removed.map(l => `- ${l.path}"${l.key}": ${JSON.stringify(l.value)}`),
      "```"
    );
  }

  if (diffs.renamed.length) {
    output.push("### Renamed", "```diff",
      ...diffs.renamed.map(l => `~ ${l}`),
      "```"
    );
  }

  if (diffs.moved.length) {
    output.push("### Moved", "```diff",
      ...diffs.moved.map(l => `# ${l}`),
      "```"
    );
  }

  return output;
}

const finalOutput = formatDiffs(diffs);

if (finalOutput.length === 0) {
  console.log("No diff to post");
  process.exit(0);
}

console.log(finalOutput.join("\n"));
