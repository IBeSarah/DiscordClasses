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

const prevJson = loadJson(prevFile);
const currJson = loadJson(currFile);

// Compute diff
function computeDiff(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevKeys = Object.keys(prev);
  const currKeys = Object.keys(curr);

  // Added & modified
  currKeys.forEach(k => {
    if (!prevKeys.includes(k)) {
      added.push(`${k}: ${curr[k]}`);
    } else if (!_.isEqual(prev[k], curr[k])) {
      removed.push(`${k}: ${prev[k]}`);
      added.push(`${k}: ${curr[k]}`);
    }
  });

  // Removed keys
  prevKeys.forEach(k => {
    if (!currKeys.includes(k)) removed.push(`${k}: ${prev[k]}`);
  });

  // Renamed heuristic
  prevKeys.forEach(prevKey => {
    const prevVal = prev[prevKey];
    currKeys.forEach(currKey => {
      const currVal = curr[currKey];
      if (prevKey !== currKey && _.isEqual(prevVal, currVal)) {
        renamed.push({ from: prevKey, to: currKey });
      }
    });
  });

  return { added, removed, renamed, moved };
}

// Format diff for output
function formatDiff(diff) {
  let output = '```diff\n';

  if (diff.added.length) {
    output += '### Added\n';
    diff.added.forEach(a => output += `+ ${a}\n`);
  }

  if (diff.removed.length) {
    output += '### Removed\n';
    diff.removed.forEach(r => output += `- ${r}\n`);
  }

  if (diff.renamed.length) {
    output += '### Renamed\n';
    diff.renamed.forEach(r => output += `* ${r.from} -> ${r.to}\n`);
  }

  if (diff.moved.length) {
    output += '### Moved\n';
    diff.moved.forEach(m => output += `* ${m}\n`);
  }

  output += '```';
  return output;
}

// Split text into chunks for Discord (<=2000) or GitHub (<=65000)
function splitText(text, maxLength) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

// Generate diffs
const diff = computeDiff(prevJson, currJson);
const formattedDiff = formatDiff(diff);

// Save full diff for GitHub
fs.writeFileSync(fullDiffFile, formattedDiff, 'utf8');

// Post to Discord (truncate 2000)
if (webhookUrl) {
  const discordChunks = splitText(formattedDiff, 2000);
  discordChunks.forEach(async chunk => {
    try {
      await axios.post(webhookUrl, { content: chunk });
    } catch (err) {
      console.error('Discord post error:', err.response?.data || err.message);
    }
  });
}

console.log('Diff processing complete.');
