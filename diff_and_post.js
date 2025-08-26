const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_SHA = process.env.GITHUB_SHA;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL;

const commitUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}`;

// Load JSON files
const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));

// Track changes per module
const summaryModules = {};
let fullDiff = '';

for (const moduleId of new Set([...Object.keys(previous), ...Object.keys(current)])) {
  const oldModule = previous[moduleId] || {};
  const newModule = current[moduleId] || {};

  const oldKeys = Object.keys(oldModule);
  const newKeys = Object.keys(newModule);

  const added = newKeys.filter(k => !oldKeys.includes(k));
  const removed = oldKeys.filter(k => !newKeys.includes(k));

  // Renamed detection: key exists in both, value changed
  const renamed = oldKeys.filter(k => newKeys.includes(k) && oldModule[k] !== newModule[k]);

  // Record moved modules (module exists in both, keys changed)
  const moved = (added.length || removed.length || renamed.length) ? true : false;

  // Build module summary for Discord
  summaryModules[moduleId] = {
    Added: added.length,
    Removed: removed.length,
    Renamed: renamed.length,
    Moved: moved ? 1 : 0
  };

  // Build full diff for GitHub
  if (added.length || removed.length || renamed.length) {
    fullDiff += `### Added in module ${moduleId}\n\`\`\`diff\n`;
    added.forEach(k => {
      fullDiff += `+ "${k}": "${newModule[k]}"\n`;
    });
    fullDiff += '```\n';

    fullDiff += `### Removed from module ${moduleId}\n\`\`\`diff\n`;
    removed.forEach(k => {
      fullDiff += `- "${k}": "${oldModule[k]}"\n`;
    });
    fullDiff += '```\n';

    fullDiff += `### Renamed in module ${moduleId}\n\`\`\`diff\n`;
    renamed.forEach(k => {
      fullDiff += `- "${k}": "${oldModule[k]}"\n`;
      fullDiff += `+ "${k}": "${newModule[k]}"\n`;
    });
    fullDiff += '```\n';

    if (moved) {
      fullDiff += `### Moved module ${moduleId}\n`;
    }
  }
}

// Write full diff for GitHub comment
fs.writeFileSync('full_diff.txt', fullDiff);

// Build Discord summary
let discordSummary = '';
for (const [mod, counts] of Object.entries(summaryModules)) {
  const parts = [];
  if (counts.Added) parts.push(`Added: ${counts.Added}`);
  if (counts.Removed) parts.push(`Removed: ${counts.Removed}`);
  if (counts.Renamed) parts.push(`Renamed: ${counts.Renamed}`);
  if (counts.Moved) parts.push(`Moved: ${counts.Moved}`);
  if (parts.length) discordSummary += `Module ${mod}: ${parts.join(', ')}\n`;
}

if (discordSummary) {
  discordSummary += `\nView full list of changes here: ${commitUrl}`;
} else {
  discordSummary = `No changes detected in this commit.\n${commitUrl}`;
}

// Discord character limit handling
const MAX_DISCORD_LENGTH = 2000;
function splitIntoChunks(str, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxLen));
    start += maxLen;
  }
  return chunks;
}

async function postToDiscord(content) {
  const chunks = splitIntoChunks(content, MAX_DISCORD_LENGTH);
  for (let i = 0; i < chunks.length; i++) {
    try {
      await axios.post(DISCORD_WEBHOOK_URL, { content: chunks[i] });
      console.log(`Sent Discord message ${i + 1}/${chunks.length}`);
    } catch (err) {
      console.error('Discord post failed:', err.response?.status, err.response?.data || err.message);
    }
  }
}

// Execute Discord posting
postToDiscord(discordSummary);
