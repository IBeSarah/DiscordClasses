// diff_and_post.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const MAX_DISCORD_LENGTH = 2000;
const commitUrl = process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/commit/' + process.env.GITHUB_SHA;

const prevFile = path.join(__dirname, 'previous.json');
const currFile = path.join(__dirname, 'current.json');

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function diffObjects(prev, curr, prefix = '') {
  const added = [];
  const removed = [];
  const changed = [];
  
  const prevKeys = Object.keys(prev || {});
  const currKeys = Object.keys(curr || {});
  
  for (const key of currKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (!(key in prev)) {
      added.push(fullKey);
    } else if (typeof curr[key] === 'object' && curr[key] !== null && typeof prev[key] === 'object' && prev[key] !== null) {
      const { added: a, removed: r, changed: c } = diffObjects(prev[key], curr[key], fullKey);
      added.push(...a);
      removed.push(...r);
      changed.push(...c);
    } else if (curr[key] !== prev[key]) {
      changed.push(fullKey);
    }
  }
  
  for (const key of prevKeys) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (!(key in curr)) {
      removed.push(fullKey);
    }
  }
  
  return { added, removed, changed };
}

function formatSection(title, keys) {
  if (!keys.length) return `### ${title}\n\`\`\`diff\nNone\n\`\`\`\n`;
  return `### ${title}\n\`\`\`diff\n${keys.map(k => `+ ${k}`).join('\n')}\n\`\`\`\n`;
}

(async () => {
  const prevJSON = readJSON(prevFile);
  const currJSON = readJSON(currFile);
  
  const { added, removed, changed } = diffObjects(prevJSON, currJSON);

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log('No changes detected.');
    return;
  }

  let message = '';
  message += formatSection('Added', added);
  message += formatSection('Removed', removed.map(k => `- ${k}`));
  message += formatSection('Changed', changed.map(k => `~ ${k}`));
  message += `Full file here: ${commitUrl}`;

  // Truncate if needed
  if (message.length > MAX_DISCORD_LENGTH) {
    message = message.slice(0, MAX_DISCORD_LENGTH - 3) + '...';
  }

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
    console.log('Posted diff to Discord successfully.');
  } catch (err) {
    console.error('Failed to send Discord webhook:', err.message);
    process.exit(1);
  }
})();
