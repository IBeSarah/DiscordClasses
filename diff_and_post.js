const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const previousJson = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const currentJson = JSON.parse(fs.readFileSync('current.json', 'utf8'));

// Helpers
function findRenamesAndChanges(oldModule, newModule) {
  const renamed = [];
  const removed = {};
  const added = {};

  for (const [key, val] of Object.entries(oldModule)) {
    if (!(key in newModule)) removed[key] = val;
  }
  for (const [key, val] of Object.entries(newModule)) {
    if (!(key in oldModule)) added[key] = val;
  }

  // Detect renames (by value, simple heuristic)
  for (const [addedKey, addedVal] of Object.entries(added)) {
    for (const [removedKey, removedVal] of Object.entries(removed)) {
      if (addedVal === removedVal) {
        renamed.push({ from: removedKey, to: addedKey, module: addedVal });
        delete removed[removedKey];
        delete added[addedKey];
      }
    }
  }

  return { renamed, removed, added };
}

// Aggregate changes
const fullDiff = [];
const discordSummaryData = {};
const renamedOverall = [];

for (const [mod, newModule] of Object.entries(currentJson)) {
  const oldModule = previousJson[mod] || {};
  const { renamed, removed, added } = findRenamesAndChanges(oldModule, newModule);

  renamedOverall.push(...renamed);

  if (Object.keys(removed).length) {
    fullDiff.push(`### Removed from module ${mod}\n\`\`\`diff\n${Object.keys(removed).map(k => `- "${k}": "${removed[k]}"`).join('\n')}\n\`\`\``);
  }
  if (Object.keys(added).length) {
    fullDiff.push(`### Added in module ${mod}\n\`\`\`diff\n${Object.keys(added).map(k => `+ "${k}": "${added[k]}"`).join('\n')}\n\`\`\``);
  }
  if (renamed.length) {
    fullDiff.push(`### Renamed in module ${mod}\n\`\`\`diff\n${renamed.map(r => `- "${r.from}" => + "${r.to}"`).join('\n')}\n\`\`\``);
  }

  // Discord summary
  if (!discordSummaryData[mod]) discordSummaryData[mod] = {};
  if (Object.keys(added).length) discordSummaryData[mod].Added = Object.keys(added).length;
  if (Object.keys(removed).length) discordSummaryData[mod].Removed = Object.keys(removed).length;
  if (renamed.length) discordSummaryData[mod].Renamed = renamed.length;
}

// Save full diff for GitHub comments
fs.writeFileSync('full_diff.txt', fullDiff.join('\n\n'));

// Build Discord summary
let discordMessage = '';
for (const [mod, types] of Object.entries(discordSummaryData)) {
  const parts = [];
  if (types.Added) parts.push(`Added: ${types.Added}`);
  if (types.Removed) parts.push(`Removed: ${types.Removed}`);
  if (types.Renamed) parts.push(`Renamed: ${types.Renamed}`);
  discordMessage += `Module ${mod}: ${parts.join(", ")}\n`;
}

discordMessage += `\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

// Post to Discord
axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage })
  .catch(console.error);
