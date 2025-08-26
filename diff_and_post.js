const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const previousFile = 'previous.json';
const currentFile = 'current.json';

function parseJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const oldData = parseJson(previousFile);
const newData = parseJson(currentFile);

const added = {};
const removed = {};
const renamed = {};
const moved = {};

// Detect added, removed, renamed, and moved modules/keys
for (const moduleKey of _.union(Object.keys(oldData), Object.keys(newData))) {
  const oldModule = oldData[moduleKey] || {};
  const newModule = newData[moduleKey] || {};

  const oldKeys = Object.keys(oldModule);
  const newKeys = Object.keys(newModule);

  // Added keys
  const addedKeys = _.difference(newKeys, oldKeys);
  if (addedKeys.length) added[moduleKey] = addedKeys.map(k => ({ [k]: newModule[k] }));

  // Removed keys
  const removedKeys = _.difference(oldKeys, newKeys);
  if (removedKeys.length) removed[moduleKey] = removedKeys.map(k => ({ [k]: oldModule[k] }));

  // Renamed keys
  for (const oldKey of removedKeys) {
    let closestMatch = null;
    let minDistance = Infinity;
    for (const newKey of addedKeys) {
      const distance = levenshtein.get(oldKey, newKey);
      if (distance < minDistance && oldModule[oldKey] === newModule[newKey]) {
        minDistance = distance;
        closestMatch = newKey;
      }
    }
    if (closestMatch) {
      renamed[moduleKey] = renamed[moduleKey] || [];
      renamed[moduleKey].push({ from: oldKey, to: closestMatch });
      _.remove(added[moduleKey], a => a[closestMatch]);
      _.remove(removed[moduleKey], r => r[oldKey]);
    }
  }

  // Moved module (if module exists in both but changed content)
  if (!_.isEqual(oldModule, newModule) && !added[moduleKey] && !removed[moduleKey] && !renamed[moduleKey]) {
    moved[moduleKey] = { from: oldModule, to: newModule };
  }
}

// Generate GitHub diff text
let githubDiff = '';
const appendSection = (title, obj, sign) => {
  for (const moduleKey in obj) {
    if (!obj[moduleKey] || obj[moduleKey].length === 0) continue;
    githubDiff += `# ${title} from module ${moduleKey}\n\`\`\`diff\n`;
    if (title === 'Renamed') {
      obj[moduleKey].forEach(r => {
        githubDiff += `- "${r.from}": "${oldData[moduleKey][r.from]}"\n`;
        githubDiff += `+ "${r.to}": "${newData[moduleKey][r.to]}"\n`;
      });
    } else if (title === 'Moved') {
      githubDiff += `Module ${moduleKey} changed from:\n${JSON.stringify(obj[moduleKey].from, null, 2)}\n`;
      githubDiff += `to:\n${JSON.stringify(obj[moduleKey].to, null, 2)}\n`;
    } else {
      obj[moduleKey].forEach(kv => {
        const key = Object.keys(kv)[0];
        githubDiff += `${sign} "${key}": "${kv[key]}"\n`;
      });
    }
    githubDiff += '```\n\n';
  }
};

appendSection('Added', added, '+');
appendSection('Removed', removed, '-');
appendSection('Renamed', renamed, '');
appendSection('Moved', moved, '');

fs.writeFileSync('full_diff.txt', githubDiff, 'utf8');

// Generate Discord summary
const summarize = (obj) => {
  return Object.entries(obj)
    .map(([mod, items]) => `${mod}: ${items.length}`)
    .join(', ');
};

let discordSummary = '';
if (Object.keys(added).length) discordSummary += `Added: ${summarize(added)}\n`;
if (Object.keys(removed).length) discordSummary += `Removed: ${summarize(removed)}\n`;
if (Object.keys(renamed).length) discordSummary += `Renamed: ${summarize(renamed)}\n`;
if (Object.keys(moved).length) discordSummary += `Moved: ${summarize(moved)}\n`;

if (discordSummary) {
  discordSummary += `\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordSummary }).catch(console.error);
}
