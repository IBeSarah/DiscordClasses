// diff_and_post_discord.js
const fs = require('fs');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_SHA = process.env.GITHUB_SHA;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL;

const previousFile = 'previous.json';
const currentFile = 'current.json';

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const prev = loadJson(previousFile);
const curr = loadJson(currentFile);

function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = []; // kept for future use if needed

  const allModules = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  for (const module of allModules) {
    const prevKeys = prev[module] ? Object.keys(prev[module]) : [];
    const currKeys = curr[module] ? Object.keys(curr[module]) : [];

    // Detect removed
    prevKeys.forEach(k => {
      if (!currKeys.includes(k)) removed.push(`${k} in Module ${module}`);
    });

    // Detect added
    currKeys.forEach(k => {
      if (!prevKeys.includes(k)) added.push(`${k} in Module ${module}`);
    });

    // Detect renamed: simple heuristic by matching values
    prevKeys.forEach(pk => {
      if (!currKeys.includes(pk) && currKeys.some(ck => prev[module][pk] === curr[module][ck])) {
        const ck = currKeys.find(ck => prev[module][pk] === curr[module][ck]);
        renamed.push(`${pk} → ${ck} in Module ${module}`);
        // Remove from added/removed since counted as rename
        added.splice(added.indexOf(`${ck} in Module ${module}`), 1);
        removed.splice(removed.indexOf(`${pk} in Module ${module}`), 1);
      }
    });
  }

  return { added, removed, renamed, moved };
}

const { added, removed, renamed, moved } = diffModules(prev, curr);

let message = '```diff\n';
if (removed.length) message += '### Removed\n' + removed.map(r => `- ${r}`).join('\n') + '\n';
if (added.length) message += '### Added\n' + added.map(a => `+ ${a}`).join('\n') + '\n';
if (renamed.length) message += '### Renamed\n' + renamed.map(r => `~ ${r}`).join('\n') + '\n';
if (moved.length) message += '### Moved\n' + moved.map(m => `> ${m}`).join('\n') + '\n';

const commitUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPO}/commit/${GITHUB_SHA}`;
const fullLine = `Full details here: ${commitUrl}`;
const maxLength = 2000 - fullLine.length - 6; // 6 for closing ```\n

// Truncate message if too long
if (message.length > maxLength) {
  message = message.slice(0, maxLength) + '\n';
}

message += fullLine + '\n```';

async function postDiscord(msg) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: msg });
    console.log('Discord message posted successfully.');
  } catch (err) {
    console.error('Failed to send Discord webhook:', err.message);
  }
}

postDiscord(message);
