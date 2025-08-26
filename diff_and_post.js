const fs = require("fs");

function looksLikeRename(oldVal, newVal) {
  // Simple heuristic: same prefix, only suffix/hash changes
  const prefixOld = oldVal.split("_")[0];
  const prefixNew = newVal.split("_")[0];
  return prefixOld === prefixNew;
}

function generateDiff(prev, curr) {
  let output = [];

  for (const id of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
    const oldObj = prev[id];
    const newObj = curr[id];

    if (!oldObj) {
      // Entire module added
      output.push(`### Added module ${id}`);
      output.push("```diff");
      for (const [k, v] of Object.entries(newObj)) {
        output.push(`+ "${k}": "${v}"`);
      }
      output.push("```");
    } else if (!newObj) {
      // Entire module removed
      output.push(`### Removed module ${id}`);
      output.push("```diff");
      for (const [k, v] of Object.entries(oldObj)) {
        output.push(`- "${k}": "${v}"`);
      }
      output.push("```");
    } else {
      // Compare keys inside module
      let added = [];
      let removed = [];
      let renamed = [];
      let changed = [];

      for (const key of new Set([...Object.keys(oldObj), ...Object.keys(newObj)])) {
        if (!(key in oldObj)) {
          added.push([key, newObj[key]]);
        } else if (!(key in newObj)) {
          removed.push([key, oldObj[key]]);
        } else if (oldObj[key] !== newObj[key]) {
          if (looksLikeRename(oldObj[key], newObj[key])) {
            renamed.push([key, oldObj[key], newObj[key]]);
          } else {
            changed.push([key, oldObj[key], newObj[key]]);
          }
        }
      }

      if (added.length || removed.length || renamed.length || changed.length) {
        // Entire module replaced
        if (
          Object.keys(oldObj).length === removed.length &&
          Object.keys(newObj).length === added.length
        ) {
          output.push(`### Replaced module ${id}`);
          output.push("```diff");
          for (const [k, v] of Object.entries(oldObj)) {
            output.push(`- "${k}": "${v}"`);
          }
          for (const [k, v] of Object.entries(newObj)) {
            output.push(`+ "${k}": "${v}"`);
          }
          output.push("```");
        } else {
          output.push(`### Changes in module ${id}`);
          output.push("```diff");
          for (const [k, v] of added) output.push(`+ "${k}": "${v}"`);
          for (const [k, v] of removed) output.push(`- "${k}": "${v}"`);
          for (const [k, oldVal, newVal] of renamed)
            output.push(`~ "${k}": renamed from "${oldVal}" to "${newVal}"`);
          for (const [k, oldVal, newVal] of changed) {
            output.push(`- "${k}": "${oldVal}"`);
            output.push(`+ "${k}": "${newVal}"`);
          }
          output.push("```");
        }
      }
    }
  }

  return output.join("\n");
}

// Run entrypoint
if (["summary", "github", "discord"].includes(process.argv[2])) {
  const prev = JSON.parse(fs.readFileSync("previous.json", "utf8"));
  const curr = JSON.parse(fs.readFileSync("current.json", "utf8"));

  const diffText = generateDiff(prev, curr);
  fs.writeFileSync("full_diff.txt", diffText);
  console.log("GitHub diff ready in full_diff.txt");
}
