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

// Helper functions
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function formatDiffSection(title, items) {
  if (!items.length) return '';
  return `### ${title}\n${items.join('\n')}\n`;
}

// Load JSON
const prev = loadJson(prevFile);
const curr = loadJson(currFile);

// Gather all module IDs
const allModules = _.union(Object.keys(prev), Object.keys(curr));

const added = [];
const removed = [];
const moved = [];
const renamed = [];

for (const moduleId of allModules) {
  const prevModule = prev[moduleId] || {};
  const currModule = curr[moduleId] || {};

  const prevKeys = Object.keys(prevModule);
  const currKeys = Object.keys(currModule);

  // Detect renamed keys
  const prevKeyCopy = [...prevKeys];
  const currKeyCopy = [...currKeys];
  for (const oldKey of prevKeyCopy) {
    for (const newKey of currKeyCopy) {
      if (oldKey !== newKey && _.isEqual(prevModule[oldKey], currModule[newKey])) {
        renamed.push(`* ${oldKey} → ${newKey} in module \`${moduleId}\``);
        // Remove from added/removed
        prevKeys.splice(prevKeys.indexOf(oldKey), 1);
        currKeys.splice(currKeys.indexOf(newKey), 1);
        break;
      }
    }
  }

  // Added keys
  for (const key of currKeys) {
    if (!prevKeys.includes(key)) {
      added.push(`+ ${key} in module \`${moduleId}\``);
    }
  }

  // Removed keys
  for (const key of prevKeys) {
    if (!currKeys.includes(key)) {
      removed.push(`- ${key} in module \`${moduleId}\``);
    }
  }

  // Moved modules (if the set of keys changed between modules)
  if (prevModule && currModule && !_.isEqual(prevModule, currModule)) {
    moved.push(`* Module \`${moduleId}\` changed`);
  }
}

// Build final diff text
const diffText = 
  formatDiffSection('Added', added) +
  formatDiffSection('Removed', removed) +
  formatDiffSection('Renamed', renamed) +
  formatDiffSection('Moved', moved);

fs.writeFileSync('full_diff.txt', diffText);

// Truncate for Discord if > 2000 chars
const discordText = diffText.length > 1990
  ? diffText.slice(0, 1990) + '\n...'
  : diffText;

async function postToDiscord() {
  if (!discordText.trim()) return console.log('No diff to post');

  try {
    await axios.post(webhookUrl, {
      content: '```diff\n' + discordText + '\n```',
    });
    console.log('Discord diff posted');
  } catch (err) {
    console.error(err);
  }
}

postToDiscord();
