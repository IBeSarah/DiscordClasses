const fs = require("fs");
const _ = require("lodash");
const levenshtein = require("fast-levenshtein");
const axios = require("axios");

const previousFile = "previous.json";
const currentFile = "current.json";

function parseJson(file) {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text || "{}");
}

const oldData = parseJson(previousFile);
const newData = parseJson(currentFile);

const added = {};
const removed = {};
const renamed = [];
const moved = [];

// Detect added and removed
for (const [module, keys] of Object.entries(oldData)) {
  if (!newData[module]) {
    removed[module] = keys;
    continue;
  }
  for (const [k, v] of Object.entries(keys)) {
    if (!(k in newData[module])) {
      removed[module] = removed[module] || {};
      removed[module][k] = v;
    }
  }
}

for (const [module, keys] of Object.entries(newData)) {
  if (!oldData[module]) {
    added[module] = keys;
    continue;
  }
  for (const [k, v] of Object.entries(keys)) {
    if (!(k in oldData[module])) {
      added[module] = added[module] || {};
      added[module][k] = v;
    }
  }
}

// Detect renames and moves across modules
for (const [remModule, remKeys] of Object.entries(removed)) {
  for (const [k, v] of Object.entries(remKeys)) {
    let found = false;
    for (const [addModule, addKeys] of Object.entries(added)) {
      for (const [ak, av] of Object.entries(addKeys)) {
        const dist = levenshtein.get(String(v), String(av));
        if (dist <= 3) { // similarity threshold
          renamed.push({
            fromModule: remModule,
            toModule: addModule,
            fromKey: k,
            toKey: ak,
            value: av
          });
          delete added[addModule][ak];
          delete removed[remModule][k];
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
}

// Build GitHub diff
let githubDiff = "";

function diffSection(title, data, sign) {
  for (const [mod, keys] of Object.entries(data)) {
    githubDiff += `# ${title} in module ${mod}\n\`\`\`diff\n`;
    for (const [k, v] of Object.entries(keys)) {
      githubDiff += `${sign} "${k}": "${v}"\n`;
    }
    githubDiff += "```\n";
  }
}

diffSection("Added", added, "+");
diffSection("Removed", removed, "-");

if (renamed.length) {
  for (const r of renamed) {
    githubDiff += `# Renamed from module ${r.fromModule} → ${r.toModule}\n\`\`\`diff\n`;
    githubDiff += `- "${r.fromKey}": "${r.value}"\n`;
    githubDiff += `+ "${r.toKey}": "${r.value}"\n`;
    githubDiff += "```\n";
  }
}

// Write full diff for GitHub
fs.writeFileSync("full_diff.txt", githubDiff);

// Post to Discord summary
const discordSummary = `
### Added: ${Object.values(added).flatMap(Object.keys).length} items in modules ${Object.keys(added).join(", ")}
### Removed: ${Object.values(removed).flatMap(Object.keys).length} items in modules ${Object.keys(removed).join(", ")}
### Renamed: ${renamed.length} items
### Moved: 0 items
View full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}
`;

axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordSummary })
  .catch(console.error);
