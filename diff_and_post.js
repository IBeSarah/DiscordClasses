const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const oldFile = 'previous.json';
const newFile = 'current.json';
const githubDiffFile = 'full_diff.txt';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Load JSON safely
function loadJSON(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

const oldData = loadJSON(oldFile);
const newData = loadJSON(newFile);

const added = {};
const removed = {};
const moved = {};
const renamed = {};

// Compare modules
for (const module in _.union(Object.keys(oldData), Object.keys(newData))) {
  const oldModule = oldData[module] || {};
  const newModule = newData[module] || {};

  // Added keys
  const addedKeys = _.difference(Object.keys(newModule), Object.keys(oldModule));
  if (addedKeys.length) added[module] = addedKeys;

  // Removed keys
  const removedKeys = _.difference(Object.keys(oldModule), Object.keys(newModule));
  if (removedKeys.length) removed[module] = removedKeys;

  // Renamed / changed keys (same value different name or vice versa)
  const commonKeys = _.intersection(Object.keys(oldModule), Object.keys(newModule));
  commonKeys.forEach(key => {
    if (oldModule[key] !== newModule[key]) {
      if (!renamed[module]) renamed[module] = [];
      renamed[module].push(key);
    }
  });

  // Detect moved modules (if module structure changed entirely)
  if (!_.isEqual(oldModule, newModule) && Object.keys(oldModule).length && Object.keys(newModule).length) {
    if (!moved[module]) moved[module] = { from: oldModule, to: newModule };
  }
}

// ---- Generate GitHub full diff ----
let githubDiff = '';

function appendDiff(title, items, symbol = '+') {
  if (!items) return;
  Object.keys(items).forEach(module => {
    githubDiff += `# ${title} in module ${module}\n`;
    githubDiff += '```diff\n';
    if (Array.isArray(items[module])) {
      items[module].forEach(key => {
        githubDiff += `${symbol} "${key}": "${(symbol === '+' ? newData[module] : oldData[module])[key]}"\n`;
      });
    } else if (items[module].from && items[module].to) {
      githubDiff += '+ ' + JSON.stringify(items[module].to, null, 2) + '\n';
      githubDiff += '- ' + JSON.stringify(items[module].from, null, 2) + '\n';
    }
    githubDiff += '```\n\n';
  });
}

appendDiff('Added', added, '+');
appendDiff('Removed', removed, '-');
appendDiff('Renamed', renamed, '~');
appendDiff('Moved', moved, '+');

fs.writeFileSync(githubDiffFile, githubDiff);

// ---- Generate Discord summary ----
let discordSummary = '';
function summaryLine(title, items) {
  if (!items || Object.keys(items).length === 0) return '';
  const modules = Object.keys(items).join(', ');
  const count = Object.values(items).reduce((sum, arr) => sum + arr.length, 0);
  return `### ${title}: ${count} item(s) in modules ${modules}\n`;
}

discordSummary += summaryLine('Added', added);
discordSummary += summaryLine('Removed', removed);
discordSummary += summaryLine('Renamed', renamed);
discordSummary += summaryLine('Moved', moved);

if (DISCORD_WEBHOOK_URL && discordSummary) {
  axios.post(DISCORD_WEBHOOK_URL, { content: discordSummary })
    .then(() => console.log('Discord summary posted'))
    .catch(e => console.error('Discord post failed:', e.message));
} else {
  console.log('No Discord summary to post or webhook missing');
}

console.log('GitHub diff written to', githubDiffFile);
