const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const MAX_DISCORD_LENGTH = 2000;

const previousFile = 'previous.json';
const currentFile = 'current.json';

const previousData = JSON.parse(fs.readFileSync(previousFile, 'utf8'));
const currentData = JSON.parse(fs.readFileSync(currentFile, 'utf8'));

const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevModules = Object.keys(prev);
  const currModules = Object.keys(curr);

  const allModules = new Set([...prevModules, ...currModules]);

  allModules.forEach(moduleKey => {
    const prevModule = prev[moduleKey] || {};
    const currModule = curr[moduleKey] || {};

    const prevKeys = Object.keys(prevModule);
    const currKeys = Object.keys(currModule);

    // Detect added
    currKeys.forEach(k => {
      if (!prevKeys.includes(k)) added.push(`${k} added to Module \`${moduleKey}\``);
    });

    // Detect removed
    prevKeys.forEach(k => {
      if (!currKeys.includes(k)) removed.push(`${k} removed from Module \`${moduleKey}\``);
    });

    // Detect renamed (simple heuristic: same value moved to a different key)
    prevKeys.forEach(pk => {
      currKeys.forEach(ck => {
        if (prevModule[pk] === currModule[ck] && pk !== ck) {
          renamed.push(`${pk} renamed to ${ck} in Module \`${moduleKey}\``);
        }
      });
    });

    // Detect moved keys (same key exists in multiple modules, value changed module)
    prevKeys.forEach(pk => {
      currModules.forEach(cm => {
        if (cm !== moduleKey && curr[cm][pk] === prevModule[pk]) {
          moved.push(`${pk} moved from Module \`${moduleKey}\` to Module \`${cm}\``);
        }
      });
    });
  });

  return { added, removed, renamed, moved };
}

const { added, removed, renamed, moved } = diffModules(previousData, currentData);

let message = '```diff\n';

if (removed.length) message += '### Removed\n' + removed.map(l => `- ${l}`).join('\n') + '\n';
if (added.length) message += '### Added\n' + added.map(l => `+ ${l}`).join('\n') + '\n';
if (renamed.length) message += '### Renamed\n' + renamed.map(l => `~ ${l}`).join('\n') + '\n';
if (moved.length) message += '### Moved\n' + moved.map(l => `> ${l}`).join('\n') + '\n';

message += '```';

// Truncate for Discord
if (message.length + commitUrl.length + 12 > MAX_DISCORD_LENGTH) {
  const allowedLength = MAX_DISCORD_LENGTH - commitUrl.length - 12;
  message = message.slice(0, allowedLength) + '\n```';
}

message += `\nFull details here: ${commitUrl}`;

// Post to Discord
axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message })
  .then(() => console.log('Posted diff to Discord'))
  .catch(err => console.error('Failed to post to Discord:', err.message));
