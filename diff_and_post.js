const fs = require("fs");
const _ = require("lodash");

const currentFile = "current.json";
const previousFile = "previous.json";

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

function parseJson(file) {
  const data = fs.readFileSync(file, "utf8");
  return JSON.parse(data);
}

const oldJson = parseJson(previousFile);
const newJson = parseJson(currentFile);

const added = {};
const removed = {};
const renamed = {};
const moved = {}; // if needed later for module-level moves

const modules = _.union(Object.keys(oldJson), Object.keys(newJson));

modules.forEach((mod) => {
  const oldModule = oldJson[mod] || {};
  const newModule = newJson[mod] || {};

  // Added
  const addedKeys = _.difference(Object.keys(newModule), Object.keys(oldModule));
  if (addedKeys.length) {
    added[mod] = {};
    addedKeys.forEach((k) => (added[mod][k] = newModule[k]));
  }

  // Removed
  const removedKeys = _.difference(Object.keys(oldModule), Object.keys(newModule));
  if (removedKeys.length) {
    removed[mod] = {};
    removedKeys.forEach((k) => (removed[mod][k] = oldModule[k]));
  }

  // Renamed / value changed
  Object.keys(newModule).forEach((k) => {
    if (oldModule[k] !== undefined && oldModule[k] !== newModule[k]) {
      renamed[mod] = renamed[mod] || {};
      renamed[mod][k] = { from: oldModule[k], to: newModule[k] };
    }
  });
});

// --- GitHub diff ---
let githubOutput = "";

function formatDiff(obj, type) {
  let out = "";
  Object.keys(obj).forEach((mod) => {
    const keys = obj[mod];
    if (!keys || !Object.keys(keys).length) return;

    out += `# ${type} in module ${mod}\n\`\`\`diff\n`;
    if (type === "Added") {
      Object.entries(keys).forEach(([k, v]) => {
        out += `+ "${k}": "${v}"\n`;
      });
    } else if (type === "Removed") {
      Object.entries(keys).forEach(([k, v]) => {
        out += `- "${k}": "${v}"\n`;
      });
    } else if (type === "Renamed") {
      Object.entries(keys).forEach(([k, { from, to }]) => {
        out += `- "${k}": "${from}"\n+ "${k}": "${to}"\n`;
      });
    }
    out += "```\n\n";
  });
  return out;
}

githubOutput += formatDiff(added, "Added");
githubOutput += formatDiff(removed, "Removed");
githubOutput += formatDiff(renamed, "Renamed");

fs.writeFileSync("full_diff.txt", githubOutput);

// --- Discord summary ---
let discordSummary = "";
modules.forEach((mod) => {
  const addedCount = added[mod] ? Object.keys(added[mod]).length : 0;
  const removedCount = removed[mod] ? Object.keys(removed[mod]).length : 0;
  const renamedCount = renamed[mod] ? Object.keys(renamed[mod]).length : 0;

  if (addedCount + removedCount + renamedCount > 0) {
    discordSummary += `Module ${mod}:`;
    if (addedCount) discordSummary += ` Added: ${addedCount}`;
    if (removedCount) discordSummary += ` Removed: ${removedCount}`;
    if (renamedCount) discordSummary += ` Renamed: ${renamedCount}`;
    discordSummary += "\n";
  }
});

if (discordSummary) {
  discordSummary += `\nView full list of changes here: ${commitUrl}`;
  const axios = require("axios");
  axios.post(webhookUrl, { content: discordSummary }).catch(console.error);
}
