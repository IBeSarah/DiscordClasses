const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

// Read JSON safely
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const previous = readJSON('previous.json');
const current = readJSON('current.json');

let added = [];
let removed = [];
let renamed = [];
let moved = [];

// Flatten module structure for easier comparison
function flattenModules(json) {
  let result = {};
  for (const [moduleId, entries] of Object.entries(json)) {
    for (const [key, value] of Object.entries(entries)) {
      result[`${moduleId}.${key}`] = value;
    }
  }
  return result;
}

const prevFlat = flattenModules(previous);
const currFlat = flattenModules(current);

// Detect added and removed
for (const key in currFlat) {
  if (!(key in prevFlat)) added.push(key);
}
for (const key in prevFlat) {
  if (!(key in currFlat)) removed.push(key);
}

// Detect moved/renamed
for (const key in currFlat) {
  if (key in prevFlat) {
    if (!_.isEqual(prevFlat[key], currFlat[key])) {
      // If value changed, it's a rename
      renamed.push(key);
    }
  }
}

// Construct Discord summary
function discordSummary() {
  const lines = [];
  if (added.length) lines.push(`### Added: ${added.length} items`);
  if (removed.length) lines.push(`### Removed: ${removed.length} items`);
  if (renamed.length) lines.push(`### Renamed: ${renamed.length} items`);
  if (moved.length) lines.push(`### Moved: ${moved.length} items`);
  return lines.join('\n') || 'No changes';
}

// Construct GitHub full diff
function githubDiff() {
  let diff = '';
  if (added.length) {
    diff += '### Added\n';
    for (const key of added) diff += `+ ${key}\n`;
  }
  if (removed.length) {
    diff += '### Removed\n';
    for (const key of removed) diff += `- ${key}\n`;
  }
  if (renamed.length) {
    diff += '### Renamed\n';
    for (const key of renamed) diff += `* ${key}\n`;
  }
  if (moved.length) {
    diff += '### Moved\n';
    for (const key of moved) diff += `* ${key}\n`;
  }
  return diff;
}

// Post to Discord
async function postDiscord() {
  if (!discordWebhook) return;
  try {
    await axios.post(discordWebhook, {
      content: discordSummary()
    });
  } catch (e) {
    console.error('Discord post failed:', e.message);
  }
}

// Save GitHub diff to file
fs.writeFileSync('full_diff.txt', githubDiff(), 'utf8');

// Run
(async () => {
  await postDiscord();
})();
