const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

// Load previous & current JSON
const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

let discordContent = '';
let githubContent = '';

// Example diff logic
function buildDiff(prev, curr) {
  const added = [];
  const removed = [];
  const moved = [];
  const renamed = [];

  // Iterate modules
  for (const module in curr) {
    if (!prev[module]) added.push(module);
    else {
      const prevKeys = Object.keys(prev[module]);
      const currKeys = Object.keys(curr[module]);
      const removedKeys = prevKeys.filter(k => !currKeys.includes(k));
      const addedKeys = currKeys.filter(k => !prevKeys.includes(k));
      if (removedKeys.length || addedKeys.length) moved.push(module);
    }
  }
  for (const module in prev) {
    if (!curr[module]) removed.push(module);
  }

  return { added, removed, moved, renamed };
}

// Generate Discord content (headings only)
const diff = buildDiff(prev, curr);
if (diff.added.length) discordContent += '### Added\n' + diff.added.map(a => `+ ${a}`).join('\n') + '\n';
if (diff.removed.length) discordContent += '### Removed\n' + diff.removed.map(r => `- ${r}`).join('\n') + '\n';
if (diff.renamed.length) discordContent += '### Renamed\n' + diff.renamed.map(r => `~ ${r}`).join('\n') + '\n';

// Generate GitHub content (include Moved from/to)
if (diff.moved.length) {
  githubContent += '### Moved\n';
  diff.moved.forEach(module => {
    githubContent += `${module} moved from ${JSON.stringify(prev[module] || {})} to ${JSON.stringify(curr[module] || {})}\n`;
  });
}

// Save outputs
fs.writeFileSync('discord_diff.txt', discordContent);
fs.writeFileSync('full_diff.txt', githubContent);

// Post to Discord (truncated to 2000 chars)
async function postDiscord() {
  if (!discordContent) return;
  await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordContent.slice(0, 2000) });
}

postDiscord();
