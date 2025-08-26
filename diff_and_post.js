const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

// Environment variables
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

// File paths
const prevFile = 'previous.json';
const currFile = 'current.json';
const fullDiffFile = 'full_diff.txt';

// Load JSON safely
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const prev = loadJson(prevFile);
const curr = loadJson(currFile);

let added = [];
let removed = [];
let moved = [];

// Compare modules
for (const moduleId of _.union(Object.keys(prev), Object.keys(curr))) {
  const prevKeys = prev[moduleId] ? Object.keys(prev[moduleId]) : [];
  const currKeys = curr[moduleId] ? Object.keys(curr[moduleId]) : [];

  // Added keys
  const newKeys = _.difference(currKeys, prevKeys);
  newKeys.forEach(k => added.push(`${k} in module ${moduleId}`));

  // Removed keys
  const removedKeys = _.difference(prevKeys, currKeys);
  removedKeys.forEach(k => removed.push(`${k} in module ${moduleId}`));

  // Moved keys
  const commonKeys = _.intersection(prevKeys, currKeys);
  commonKeys.forEach(k => {
    if (!_.isEqual(prev[moduleId][k], curr[moduleId][k])) {
      moved.push(`${k} in module ${moduleId}`);
    }
  });
}

// Generate diff sections
function makeSection(title, items) {
  if (items.length === 0) return '';
  return `### ${title}\n\`\`\`diff\n${items.map(i => {
    const sign = title === 'Added' ? '+' : title === 'Removed' ? '-' : '*';
    return `${sign} ${i}`;
  }).join('\n')}\n\`\`\`\n`;
}

const diffText = makeSection('Added', added) +
                 makeSection('Removed', removed) +
                 makeSection('Moved', moved);

fs.writeFileSync(fullDiffFile, diffText);

// Post to Discord
async function postToDiscord(text) {
  if (!webhookUrl) return;

  const MAX = 2000;
  for (let i = 0; i < text.length; i += MAX) {
    const chunk = text.slice(i, i + MAX);
    await axios.post(webhookUrl, { content: chunk });
  }
}

(async () => {
  if (!diffText.trim()) {
    console.log('No diff to post');
    return;
  }

  console.log(diffText);
  await postToDiscord(diffText);
})();
