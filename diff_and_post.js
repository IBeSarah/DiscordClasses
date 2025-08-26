const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FULL_DIFF_FILE = 'full_diff.txt';

// --- Load JSON files ---
let previous = {};
let current = {};

try { previous = JSON.parse(fs.readFileSync('previous.json', 'utf8')); } catch {}
try { current = JSON.parse(fs.readFileSync('current.json', 'utf8')); } catch {}

if (!previous && !current) {
  console.error("Missing old.json or new.json for diffing");
  process.exit(1);
}

// --- Data structures for diffs ---
const githubDiff = [];
const discordSummary = { Added: {}, Removed: {}, Moved: {}, Renamed: {} };

// --- Helper functions ---
function diffModules(prev, curr) {
  const allModules = _.union(Object.keys(prev), Object.keys(curr));

  for (const mod of allModules) {
    const prevKeys = prev[mod] || {};
    const currKeys = curr[mod] || {};

    const addedKeys = _.difference(Object.keys(currKeys), Object.keys(prevKeys));
    const removedKeys = _.difference(Object.keys(prevKeys), Object.keys(currKeys));
    const commonKeys = _.intersection(Object.keys(prevKeys), Object.keys(currKeys));

    // --- Added ---
    if (addedKeys.length) {
      githubDiff.push(`### Added\n` + addedKeys.map(k => `+ "${k}": "${currKeys[k]}" added in module ${mod}`).join('\n'));
      discordSummary.Added[mod] = addedKeys;
    }

    // --- Removed ---
    if (removedKeys.length) {
      githubDiff.push(`### Removed\n` + removedKeys.map(k => `- "${k}": "${prevKeys[k]}" removed from module ${mod}`).join('\n'));
      discordSummary.Removed[mod] = removedKeys;
    }

    // --- Moved & Renamed ---
    for (const key of commonKeys) {
      if (!_.isEqual(prevKeys[key], currKeys[key])) {
        // Check if value changed slightly → Renamed
        if (levenshtein.get(prevKeys[key], currKeys[key]) > 0) {
          githubDiff.push(`### Renamed\n"${key}" in module ${mod}: "${prevKeys[key]}" → "${currKeys[key]}"`);
          discordSummary.Renamed[mod] = discordSummary.Renamed[mod] || [];
          discordSummary.Renamed[mod].push(key);
        }
      }
    }
  }
}

// --- Run diff ---
diffModules(previous, current);

// --- Generate GitHub full diff ---
const githubText = githubDiff.join('\n\n');
fs.writeFileSync(FULL_DIFF_FILE, githubText);

// --- Post to Discord (summary style) ---
async function postDiscord() {
  if (!DISCORD_WEBHOOK_URL) return;

  const sections = [];

  // Added / Removed / Renamed (summary by module)
  for (const type of ['Added', 'Removed', 'Renamed']) {
    const mods = Object.entries(discordSummary[type]);
    if (!mods.length) continue;

    const modsText = mods.map(([mod, items]) => `${mod}: ${items.length} item(s)`).join(', ');
    sections.push(`### ${type}\n${modsText}`);
  }

  // Moved: module → module (if you detect moves)
  // Example: if you track moves in a separate structure
  // sections.push(`### Moved\n315 → 567: 3 items`);

  if (!sections.length) return;

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: sections.join('\n\n')
  });
}

// --- Run Discord posting ---
postDiscord().catch(console.error);
