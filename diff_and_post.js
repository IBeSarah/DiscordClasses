// diff_and_post.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MAX_DISCORD_LENGTH = 2000;
const commitUrl = process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/commit/' + process.env.GITHUB_SHA;

const prevFile = path.join(__dirname, 'previous.json');
const currFile = path.join(__dirname, 'current.json');
const mainFile = path.join(__dirname, 'discordclasses.json');

// Normalize JSON by sorting keys recursively
function normalize(obj) {
  if (Array.isArray(obj)) return obj.map(normalize);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((res, key) => {
        res[key] = normalize(obj[key]);
        return res;
      }, {});
  }
  return obj;
}

function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(normalize(data), null, 2), 'utf8');
}

// Diffing function
function diffObjects(prev, curr, prefix = '') {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevKeys = Object.keys(prev || {});
  const currKeys = Object.keys(curr || {});

  for (const key of currKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (!(key in prev)) {
      added.push(fullKey);
    } else if (
      typeof curr[key] === 'object' &&
      curr[key] !== null &&
      typeof prev[key] === 'object' &&
      prev[key] !== null
    ) {
      const { added: a, removed: r, renamed: rn, moved: m } = diffObjects(prev[key], curr[key], fullKey);
      added.push(...a);
      removed.push(...r);
      renamed.push(...rn);
      moved.push(...m);
    } else if (curr[key] !== prev[key]) {
      renamed.push(fullKey);
    }
  }

  for (const key of prevKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (!(key in curr)) {
      removed.push(fullKey);
    }
  }

  return { added, removed, renamed, moved };
}

function formatDiffSection(title, keys, symbol = '+') {
  if (!keys.length) return '';
  return `### ${title}\n${keys.map(k => `${symbol} ${k}`).join('\n')}\n`;
}

(async () => {
  // Normalize the main JSON file
  const mainJSON = readJSON(mainFile);
  writeJSON(mainFile, mainJSON);

  // Read normalized previous/current
  const prevJSON = readJSON(prevFile);
  const currJSON = readJSON(currFile);

  const { added, removed, renamed, moved } = diffObjects(prevJSON, currJSON);

  if (!added.length && !removed.length && !renamed.length && !moved.length) {
    console.log('No changes detected.');
    return;
  }

  let message = '```diff\n';
  message += formatDiffSection('Removed', removed, '-');
  message += formatDiffSection('Added', added, '+');
  message += formatDiffSection('Renamed', renamed, '~');
  message += formatDiffSection('Moved', moved, '>');
  message += '```\n';
  message += `Full details here: ${commitUrl}`;

  if (message.length > MAX_DISCORD_LENGTH) {
    message = message.slice(0, MAX_DISCORD_LENGTH - 3) + '...';
  }

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
    console.log('Posted summarized diff to Discord successfully.');
  } catch (err) {
    console.error('Failed to send Discord webhook:', err.message);
    process.exit(1);
  }
})();
