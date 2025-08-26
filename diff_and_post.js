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
const fullDiffFile = 'full_diff.txt';

// Helpers
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Simple diff generator
function generateDiff(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  for (const key in curr) {
    if (!(key in prev)) added.push(`${key} added to Module \`${curr[key]}\``);
  }

  for (const key in prev) {
    if (!(key in curr)) removed.push(`${key} removed from Module \`${prev[key]}\``);
  }

  // Example placeholders for renamed/moved
  // Extend this with real logic if needed
  // For moved/renamed, you could compare values and use Levenshtein distance

  let diffText = '';
  if (added.length) diffText += `### Added\n${added.map(a => '+ ' + a).join('\n')}\n`;
  if (removed.length) diffText += `### Removed\n${removed.map(r => '- ' + r).join('\n')}\n`;
  if (renamed.length) diffText += `### Renamed\n${renamed.map(r => '* ' + r).join('\n')}\n`;
  if (moved.length) diffText += `### Moved\n${moved.map(m => '* ' + m).join('\n')}\n`;

  return diffText;
}

// Load files
const prevJson = loadJson(prevFile);
const currJson = loadJson(currFile);

// Generate diff
const fullDiff = generateDiff(prevJson, currJson);

// Write full diff for GitHub
fs.writeFileSync(fullDiffFile, fullDiff, 'utf8');

// Post to Discord (truncate to 2000 chars)
async function postToDiscord(text) {
  if (!webhookUrl || !text.trim()) return;
  const DISCORD_MAX = 2000;
  const chunks = [];
  for (let i = 0; i < text.length; i += DISCORD_MAX) {
    chunks.push(text.slice(i, i + DISCORD_MAX));
  }

  for (const chunk of chunks) {
    try {
      await axios.post(webhookUrl, { content: chunk });
    } catch (err) {
      console.error('Discord webhook error:', err.response?.data || err.message);
    }
  }
}

// Run
postToDiscord(fullDiff);
