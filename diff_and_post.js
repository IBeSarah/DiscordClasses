const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

// Environment variables
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

// File paths
const prevFile = 'previous.json';
const currFile = 'current.json';

// Helper to load JSON safely
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Compute diff between two objects
function computeDiff(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevKeys = Object.keys(prev);
  const currKeys = Object.keys(curr);

  // Added
  currKeys.forEach(k => {
    if (!prevKeys.includes(k)) added.push(k);
  });

  // Removed
  prevKeys.forEach(k => {
    if (!currKeys.includes(k)) removed.push(k);
  });

  // Renamed / moved (simple heuristic)
  prevKeys.forEach(prevKey => {
    const prevVal = prev[prevKey];
    currKeys.forEach(currKey => {
      const currVal = curr[currKey];
      if (prevKey !== currKey && prevVal === currVal) {
        renamed.push({from: prevKey, to: currKey});
      }
    });
  });

  return { added, removed, renamed, moved };
}

// Format diff as Markdown H3 with code block
function formatDiff(diff) {
  let text = '```diff\n';
  if (diff.added.length) {
    text += '### Added\n';
    diff.added.forEach(k => {
      text += `+ ${k}\n`;
    });
  }
  if (diff.removed.length) {
    text += '### Removed\n';
    diff.removed.forEach(k => {
      text += `- ${k}\n`;
    });
  }
  if (diff.renamed.length) {
    text += '### Renamed\n';
    diff.renamed.forEach(r => {
      text += `* ${r.from} -> ${r.to}\n`;
    });
  }
  if (diff.moved.length) {
    text += '### Moved\n';
    diff.moved.forEach(m => {
      text += `* ${m}\n`;
    });
  }
  text += '```';
  return text;
}

// Load JSON files
const prevJson = loadJson(prevFile);
const currJson = loadJson(currFile);

// Compute diff
const diff = computeDiff(prevJson, currJson);
const fullDiffText = formatDiff(diff);

// Write full diff for GitHub workflow
fs.writeFileSync('full_diff.txt', fullDiffText, 'utf8');
console.log('Saved full diff to full_diff.txt');

// Post to Discord truncated at 2000 characters
async function postToDiscord(content) {
  if (!webhookUrl) return console.log('No DISCORD_WEBHOOK_URL set');

  try {
    await axios.post(webhookUrl, { content });
    console.log('Posted diff to Discord');
  } catch (err) {
    console.error('Failed to post to Discord', err);
  }
}

// Discord truncation
const discordMessage = fullDiffText.length > 2000 ? fullDiffText.slice(0, 2000) + '\n[Truncated]' : fullDiffText;

// Run
postToDiscord(discordMessage);
