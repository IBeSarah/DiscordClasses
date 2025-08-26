// diff_and_post_discord.js
const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

const MAX_DISCORD_LENGTH = 2000;

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

// Detect Added/Removed keys per module
function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const allModules = _.union(Object.keys(prev), Object.keys(curr));

  allModules.forEach((mod) => {
    const prevKeys = prev[mod] ? Object.keys(prev[mod]) : [];
    const currKeys = curr[mod] ? Object.keys(curr[mod]) : [];

    // Added keys
    currKeys.forEach(k => {
      if (!prevKeys.includes(k)) {
        added.push(`+ ${k} added to Module \`${mod}\``);
      }
    });

    // Removed keys
    prevKeys.forEach(k => {
      if (!currKeys.includes(k)) {
        removed.push(`- ${k} removed from Module \`${mod}\``);
      }
    });

    // Renamed keys (simple heuristic based on Levenshtein distance and value similarity)
    prevKeys.forEach(pk => {
      currKeys.forEach(ck => {
        if (!prevKeys.includes(ck) && !currKeys.includes(pk)) {
          const prevVal = prev[mod][pk];
          const currVal = curr[mod][ck];
          if (levenshtein.get(pk, ck) <= 3 && prevVal === currVal) {
            renamed.push(`~ ${pk} renamed to ${ck} in Module \`${mod}\``);
          }
        }
      });
    });

    // Moved keys between modules (if key exists in both modules)
    // Optional: implement if needed
  });

  return { added, removed, renamed, moved };
}

// Load JSON
const previous = loadJson(prevFile);
const current = loadJson(currFile);

const { added, removed, renamed, moved } = diffModules(previous, current);

// Build message
let message = '';
if (removed.length) message += `### Removed\n${removed.join('\n')}\n`;
if (added.length) message += `### Added\n${added.join('\n')}\n`;
if (renamed.length) message += `### Renamed\n${renamed.join('\n')}\n`;
if (moved.length) message += `### Moved\n${moved.join('\n')}\n`;

message = message.trim();

if (!message) {
  console.log('No changes to post to Discord.');
  process.exit(0);
}

// Add commit link
const commitUrl = `${serverUrl}/${repo}/commit/${commitSha}`;
const footer = `\nFull commit here: ${commitUrl}`;
let finalMessage = message + footer;

// Truncate to 2000 characters for Discord
if (finalMessage.length > MAX_DISCORD_LENGTH) {
  finalMessage = finalMessage.slice(0, MAX_DISCORD_LENGTH - 3) + '...';
}

// Send to Discord
axios.post(webhookUrl, { content: finalMessage })
  .then(() => console.log('Discord message posted successfully.'))
  .catch(err => console.error('Error posting to Discord:', err.message));
