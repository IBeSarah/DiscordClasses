const fs = require("fs");
const path = require("path");

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function diffJSON(oldData, newData) {
  let added = [];
  let removed = [];
  let renamed = [];
  let moved = [];

  // Track modules in both
  const oldKeys = Object.keys(oldData);
  const newKeys = Object.keys(newData);

  // Detect removed & renamed
  oldKeys.forEach((key) => {
    if (!newData[key]) {
      removed.push({ key, value: oldData[key] });
    }
  });

  // Detect added
  newKeys.forEach((key) => {
    if (!oldData[key]) {
      added.push({ key, value: newData[key] });
    }
  });

  // Detect renames & moves
  oldKeys.forEach((key) => {
    if (newData[key] && typeof oldData[key] === "object") {
      const oldObj = oldData[key];
      const newObj = newData[key];

      // Detect renamed keys inside same module
      Object.keys(oldObj).forEach((k) => {
        if (!newObj[k]) {
          // Was renamed or removed
          const match = Object.keys(newObj).find(
            (nk) => oldObj[k] === newObj[nk]
          );
          if (match) {
            renamed.push({ module: key, from: k, to: match });
          }
        }
      });

      // Detect moved items (present in another module)
      Object.keys(oldObj).forEach((k) => {
        const val = oldObj[k];
        if (!Object.values(newObj).includes(val)) {
          const foundModule = Object.entries(newData).find(([mod, obj]) =>
            Object.values(obj).includes(val)
          );
          if (foundModule) {
            moved.push({
              key: k,
              value: val,
              from: key,
              to: foundModule[0],
            });
          }
        }
      });
    }
  });

  return { added, removed, renamed, moved };
}

function formatDiff(diff) {
  let out = "";

  if (diff.added.length) {
    out += "### Added\n```diff\n";
    diff.added.forEach((a) => {
      out += `+ ${a.key}: ${JSON.stringify(a.value)}\n`;
    });
    out += "```\n\n";
  }

  if (diff.removed.length) {
    out += "### Removed\n```diff\n";
    diff.removed.forEach((r) => {
      out += `- ${r.key}: ${JSON.stringify(r.value)}\n`;
    });
    out += "```\n\n";
  }

  if (diff.renamed.length) {
    out += "### Renamed\n";
    diff.renamed.forEach((rn) => {
      out += `* In module ${rn.module}: "${rn.from}" → "${rn.to}"\n`;
    });
    out += "\n";
  }

  if (diff.moved.length) {
    out += "### Moved\n";
    diff.moved.forEach((m) => {
      out += `* "${m.key}" moved from module ${m.from} to module ${m.to}\n`;
    });
    out += "\n";
  }

  return out || "No changes detected.";
}

function main() {
  const oldFile = "old.json";
  const newFile = "new.json";

  if (!fs.existsSync(oldFile) || !fs.existsSync(newFile)) {
    console.error("Missing old.json or new.json for diffing");
    process.exit(1);
  }

  const oldData = loadJSON(oldFile);
  const newData = loadJSON(newFile);

  const diff = diffJSON(oldData, newData);
  const formatted = formatDiff(diff);

  fs.writeFileSync("full_diff.txt", formatted, "utf8");
  console.log("Diff written to full_diff.txt");
}

main();
