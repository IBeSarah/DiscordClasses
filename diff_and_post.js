const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const prevFile = path.resolve('previous.json');
const currFile = path.resolve('current.json');

const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
const curr = JSON.parse(fs.readFileSync(currFile, 'utf8'));

const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
const githubSha = process.env.GITHUB_SHA;
const githubRepo = process.env.GITHUB_REPOSITORY;
const githubServer = process.env.GITHUB_SERVER_URL;

// Utility to detect renames (simple Levenshtein distance)
function detectRenames(prevModule, currModule) {
  const renames = [];
  for (const keyPrev in prevModule) {
    for (const keyCurr in currModule) {
      if (prevModule[keyPrev] === currModule[keyCurr] && keyPrev !== keyCurr) {
        renames.push({ from: keyPrev, to: keyCurr, value: currModule[keyCurr] });
      }
    }
  }
  return renames;
}

// Detect Added / Removed / Renamed / Moved
const summary = {};
let fullDiffText = '';

for (const moduleId of _.union(Object.keys(prev), Object.keys(curr))) {
  const prevModule = prev[moduleId] || {};
  const currModule = curr[moduleId] || {};

  const addedKeys = _.difference(Object.keys(currModule), Object.keys(prevModule));
  const removedKeys = _.difference(Object.keys(prevModule), Object.keys(currModule));
  const renames = detectRenames(prevModule, currModule);

  // Moved detection: if module exists but keys changed positions
  const moved = prev[moduleId] && curr[moduleId] && !_.isEqual(prevModule, currModule) && addedKeys.length === 0 && removedKeys.length === 0 ? 1 : 0;

  summary[moduleId] = {
    added: addedKeys.length,
    removed: removedKeys.length,
    renamed: renames.length,
    moved
  };

  // Build full diff for GitHub
  if (addedKeys.length) {
    fullDiffText += `# Added in module ${moduleId}\n\`\`\`diff\n`;
    addedKeys.forEach(k => fullDiffText += `+ "${k}": "${currModule[k]}"\n`);
    fullDiffText += '```\n\n';
  }

  if (removedKeys.length) {
    fullDiffText += `# Removed from module ${moduleId}\n\`\`\`diff\n`;
    removedKeys.forEach(k => fullDiffText += `- "${k}": "${prevModule[k]}"\n`);
    fullDiffText += '```\n\n';
  }

  if (renames.length) {
    fullDiffText += `# Renamed in module ${moduleId}\n\`\`\`diff\n`;
    renames.forEach(r => {
      fullDiffText += `- "${r.from}": "${r.value}"\n+ "${r.to}": "${r.value}"\n`;
    });
    fullDiffText += '```\n\n';
  }

  if (moved) {
    fullDiffText += `# Moved module ${moduleId}\n\`\`\`diff\n`;
    fullDiffText += JSON.stringify(currModule, null, 2) + '\n';
    fullDiffText += '```\n\n';
  }
}

// Write full diff to file for GitHub comment step
fs.writeFileSync('full_diff.txt', fullDiffText);

// Discord summary
const discordLines = [];
for (const moduleId in summary) {
  const s = summary[moduleId];
  if (s.added || s.removed || s.renamed || s.moved) {
    discordLines.push(`Module ${moduleId}: Added: ${s.added}, Removed: ${s.removed}, Renamed: ${s.renamed}, Moved: ${s.moved}`);
  }
}
if (discordLines.length) {
  discordLines.push(`\nView full list of changes here: ${githubServer}/${githubRepo}/commit/${githubSha}`);
  axios.post(discordWebhook, { content: discordLines.join('\n') })
    .then(() => console.log('Discord summary posted'))
    .catch(err => console.error('Discord post failed:', err.message));
} else {
  console.log('No changes to post to Discord');
}
