const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const prevFile = 'previous.json';
const currFile = 'current.json';
const fullDiffFile = 'full_diff.txt';

// Load JSON safely
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

const prev = loadJson(prevFile);
const curr = loadJson(currFile);

const summary = {};
let fullDiff = '';

// Helper to detect renames within a module
function detectRenames(prevModule, currModule) {
  const renames = [];
  for (const key in prevModule) {
    if (!currModule[key]) {
      // Try to find a value in currModule that is similar
      const prevVal = prevModule[key];
      for (const newKey in currModule) {
        if (!prevModule[newKey] && currModule[newKey] === prevVal) {
          renames.push({ from: key, to: newKey });
          break;
        }
      }
    }
  }
  return renames;
}

// Compute diff
for (const moduleId of _.union(Object.keys(prev), Object.keys(curr))) {
  const prevModule = prev[moduleId] || {};
  const currModule = curr[moduleId] || {};

  const addedKeys = _.difference(Object.keys(currModule), Object.keys(prevModule));
  const removedKeys = _.difference(Object.keys(prevModule), Object.keys(currModule));
  const renamedKeys = detectRenames(prevModule, currModule);

  if (addedKeys.length) {
    summary[moduleId] = summary[moduleId] || {};
    summary[moduleId].Added = addedKeys.length;
    fullDiff += `### Added in module ${moduleId}\n\`\`\`diff\n`;
    addedKeys.forEach(k => fullDiff += `+ "${k}": "${currModule[k]}"\n`);
    fullDiff += '```\n\n';
  }

  if (removedKeys.length) {
    summary[moduleId] = summary[moduleId] || {};
    summary[moduleId].Removed = removedKeys.length;
    fullDiff += `### Removed from module ${moduleId}\n\`\`\`diff\n`;
    removedKeys.forEach(k => fullDiff += `- "${k}": "${prevModule[k]}"\n`);
    fullDiff += '```\n\n';
  }

  if (renamedKeys.length) {
    summary[moduleId] = summary[moduleId] || {};
    summary[moduleId].Renamed = renamedKeys.length;
    fullDiff += `### Renamed in module ${moduleId}\n\`\`\`diff\n`;
    renamedKeys.forEach(r => fullDiff += `- "${r.from}" -> + "${r.to}"\n`);
    fullDiff += '```\n\n';
  }
}

// Compute moved modules (different content entirely)
const movedModules = _.differenceWith(
  Object.keys(prev),
  Object.keys(curr),
  (a, b) => _.isEqual(prev[a], curr[b])
);
movedModules.forEach(moduleId => {
  summary[moduleId] = summary[moduleId] || {};
  summary[moduleId].Moved = 1;
  fullDiff += `### Moved module ${moduleId}\n\`\`\`diff\n`;
  fullDiff += JSON.stringify(prev[moduleId], null, 2);
  fullDiff += '\n```\n\n';
});

// Save full diff for GitHub comments
fs.writeFileSync(fullDiffFile, fullDiff);

// Prepare Discord summary
let discordMsg = '';
for (const moduleId in summary) {
  discordMsg += `Module ${moduleId}: `;
  const parts = [];
  if (summary[moduleId].Added) parts.push(`Added: ${summary[moduleId].Added}`);
  if (summary[moduleId].Removed) parts.push(`Removed: ${summary[moduleId].Removed}`);
  if (summary[moduleId].Renamed) parts.push(`Renamed: ${summary[moduleId].Renamed}`);
  if (summary[moduleId].Moved) parts.push(`Moved: ${summary[moduleId].Moved}`);
  discordMsg += parts.join(', ') + '\n';
}
discordMsg += `\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

// Post to Discord
axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMsg })
  .then(() => console.log('Posted diff to Discord'))
  .catch(e => console.error('Failed to post to Discord', e));
