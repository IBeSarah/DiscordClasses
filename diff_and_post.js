const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;
const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

function parseJsonFile(path) {
  if (!fs.existsSync(path)) return {};
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const prev = parseJsonFile('previous.json');
const curr = parseJsonFile('current.json');

const fullDiffLines = [];
const discordSummary = {};

for (const moduleId of _.union(Object.keys(prev), Object.keys(curr))) {
  const prevModule = prev[moduleId] || {};
  const currModule = curr[moduleId] || {};

  const addedKeys = _.difference(Object.keys(currModule), Object.keys(prevModule));
  const removedKeys = _.difference(Object.keys(prevModule), Object.keys(currModule));

  // Detect renamed keys (simple heuristic: same value, different key)
  const renamedKeys = [];
  for (const rKey of removedKeys.slice()) {
    for (const aKey of addedKeys.slice()) {
      if (prevModule[rKey] === currModule[aKey]) {
        renamedKeys.push([rKey, aKey]);
        removedKeys.splice(removedKeys.indexOf(rKey), 1);
        addedKeys.splice(addedKeys.indexOf(aKey), 1);
        break;
      }
    }
  }

  // Detect moved (object exists in another module)
  const movedFrom = [];
  for (const rKey of removedKeys.slice()) {
    for (const otherModuleId of Object.keys(curr)) {
      if (otherModuleId !== moduleId && curr[otherModuleId][rKey] === prevModule[rKey]) {
        movedFrom.push([rKey, otherModuleId]);
        removedKeys.splice(removedKeys.indexOf(rKey), 1);
        break;
      }
    }
  }

  // Build full diff
  if (addedKeys.length) {
    fullDiffLines.push(`### Added in module ${moduleId}`);
    addedKeys.forEach(k => fullDiffLines.push(`+ "${k}": "${currModule[k]}"`));
  }
  if (removedKeys.length) {
    fullDiffLines.push(`### Removed in module ${moduleId}`);
    removedKeys.forEach(k => fullDiffLines.push(`- "${k}": "${prevModule[k]}"`));
  }
  if (renamedKeys.length) {
    fullDiffLines.push(`### Renamed in module ${moduleId}`);
    renamedKeys.forEach(([oldK, newK]) => fullDiffLines.push(`- "${oldK}" → "${newK}"`));
  }
  if (movedFrom.length) {
    fullDiffLines.push(`### Moved from other module to ${moduleId}`);
    movedFrom.forEach(([k, fromModule]) =>
      fullDiffLines.push(`- "${k}" from module ${fromModule}`)
    );
  }

  // Prepare summary for Discord
  const counts = {
    Added: addedKeys.length,
    Removed: removedKeys.length,
    Renamed: renamedKeys.length,
    Moved: movedFrom.length
  };
  if (Object.values(counts).some(c => c > 0)) {
    discordSummary[moduleId] = counts;
  }
}

// Write full_diff.txt for GitHub comments
fs.writeFileSync('full_diff.txt', fullDiffLines.join('\n'), 'utf8');

// Build Discord message
let discordMessage = '';
for (const moduleId in discordSummary) {
  const counts = discordSummary[moduleId];
  const parts = [];
  if (counts.Added) parts.push(`Added: ${counts.Added}`);
  if (counts.Removed) parts.push(`Removed: ${counts.Removed}`);
  if (counts.Renamed) parts.push(`Renamed: ${counts.Renamed}`);
  if (counts.Moved) parts.push(`Moved: ${counts.Moved}`);
  discordMessage += `Module ${moduleId}: ${parts.join(', ')}\n`;
}

if (discordMessage) {
  discordMessage += `\nView full list of changes here: ${serverUrl}/${repo}/commit/${commitSha}`;
  axios.post(discordWebhook, { content: discordMessage })
    .then(() => console.log('Discord summary posted'))
    .catch(err => console.error('Error posting to Discord:', err));
} else {
  console.log('No changes to post to Discord');
}
