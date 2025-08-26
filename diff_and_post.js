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

  // Track removed keys for detecting moves
  const removedMap = {}; // key → module it was removed from
  for (const mod of Object.keys(prev)) {
    for (const k of Object.keys(prev[mod])) {
      if (!(curr[mod] && curr[mod][k])) {
        removedMap[k] = mod;
      }
    }
  }

  for (const mod of allModules) {
    const prevKeys = prev[mod] || {};
    const currKeys = curr[mod] || {};

    const addedKeys = _.difference(Object.keys(currKeys), Object.keys(prevKeys));
    const removedKeys = _.difference(Object.keys(prevKeys), Object.keys(currKeys));
    const commonKeys = _.intersection(Object.keys(prevKeys), Object.keys(currKeys));

    // --- Added ---
    const actuallyAdded = [];
    for (const k of addedKeys) {
      if (removedMap[k]) {
        // It's a moved key
        const fromModule = removedMap[k];
        githubDiff.push(`### Moved\n"${k}" moved from module ${fromModule} → module ${mod}`);
        discordSummary.Moved[`${fromModule} → ${mod}`] = (discordSummary.Moved[`${fromModule} → ${mod}`] || 0) + 1;
      } else {
        actuallyAdded.push(k);
      }
    }

    if (actuallyAdded.length) {
      githubDiff.push(`### Added\n` + actuallyAdded.map(k => `+ "${k}": "${currKeys[k]}" added in module ${mod}`).join('\n'));
      discordSummary.Added[mod] = actuallyAdded;
    }

    // --- Removed ---
    const actuallyRemoved = removedKeys.filter(k => !addedKeys.includes(k)); // already counted as moved
    if (actuallyRemoved.length) {
      githubDiff.push(`### Removed\n` + actuallyRemoved.map(k => `- "${k}": "${prevKeys[k]}" removed from module ${mod}`).join('\n'));
      discordSummary.Removed[mod] = actuallyRemoved;
    }

    // --- Renamed ---
    for (const key of commonKeys) {
      if (!_.isEqual(prevKeys[key], currKeys[key])) {
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

  for (const type of ['Added', 'Removed', 'Renamed']) {
    const mods = Object.entries(discordSummary[type]);
    if (!mods.length) continue;

    const modsText = mods.map(([mod, items]) => `${mod}: ${Array.isArray(items) ? items.length : items} item(s)`).join(', ');
    sections.push(`### ${type}\n${modsText}`);
  }

  // Moved summary
  const movedEntries = Object.entries(discordSummary.Moved);
  if (movedEntries.length) {
    const movedText = movedEntries.map(([mods, count]) => `${mods}: ${count} item(s)`).join(', ');
    sections.push(`### Moved\n${movedText}`);
  }

  if (!sections.length) return;

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: sections.join('\n\n')
  });
}

// --- Run Discord posting ---
postDiscord().catch(console.error);
