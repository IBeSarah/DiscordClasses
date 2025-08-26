const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
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

// Helper functions
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function formatValue(value) {
  if (_.isObject(value)) return JSON.stringify(value, null, 2);
  return value;
}

// Compute diff between two JSON objects
function computeDiff(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  for (const key in curr) {
    if (!prev[key]) {
      added.push({ key, value: curr[key] });
    } else if (!_.isEqual(prev[key], curr[key])) {
      // You could add custom logic here for "moved" or "renamed"
      moved.push({ key, from: prev[key], to: curr[key] });
    }
  }

  for (const key in prev) {
    if (!curr[key]) {
      removed.push({ key, value: prev[key] });
    }
  }

  return { added, removed, renamed, moved };
}

function generateDiffText(diff) {
  let text = '';

  if (diff.added.length) {
    text += '### Added\n';
    diff.added.forEach(item => {
      text += `+ ${item.key}: ${formatValue(item.value)}\n`;
    });
  }

  if (diff.removed.length) {
    text += '\n### Removed\n';
    diff.removed.forEach(item => {
      text += `- ${item.key}: ${formatValue(item.value)}\n`;
    });
  }

  if (diff.renamed.length) {
    text += '\n### Renamed\n';
    diff.renamed.forEach(item => {
      text += `* ${item.key} renamed from ${formatValue(item.from)} to ${formatValue(item.to)}\n`;
    });
  }

  if (diff.moved.length) {
    text += '\n### Moved\n';
    diff.moved.forEach(item => {
      text += `* ${item.key} moved from ${formatValue(item.from)} to ${formatValue(item.to)}\n`;
    });
  }

  return text.trim();
}

function truncateForDiscord(text, max = 2000) {
  if (text.length <= max) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + max));
    start += max;
  }
  return chunks;
}

async function postToDiscord(text) {
  const chunks = truncateForDiscord(text);
  for (const chunk of chunks) {
    await axios.post(webhookUrl, { content: '```diff\n' + chunk + '\n```' });
  }
}

async function main() {
  const prev = loadJson(prevFile);
  const curr = loadJson(currFile);

  const diff = computeDiff(prev, curr);
  const diffText = generateDiffText(diff);

  // Write full diff for GitHub
  fs.writeFileSync(fullDiffFile, diffText, 'utf8');

  if (diffText) {
    console.log('Posting diff to Discord...');
    await postToDiscord(diffText);
    console.log('Done!');
  } else {
    console.log('No diff detected.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
