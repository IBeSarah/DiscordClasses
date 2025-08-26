const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};

// Helper to detect differences
for (const key of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
  const oldMod = prev[key] || {};
  const newMod = curr[key] || {};

  // Added module
  if (!prev[key]) {
    addedModules[key] = Object.keys(newMod);
    continue;
  }

  // Removed module
  if (!curr[key]) {
    removedModules[key] = Object.keys(oldMod);
    continue;
  }

  // Track added keys
  for (const k of Object.keys(newMod)) {
    if (!oldMod.hasOwnProperty(k)) {
      addedModules[key] = addedModules[key] || [];
      addedModules[key].push(k);
    }
  }

  // Track removed keys
  for (const k of Object.keys(oldMod)) {
    if (!newMod.hasOwnProperty(k)) {
      removedModules[key] = removedModules[key] || [];
      removedModules[key].push(k);
    }
  }

  // Track renamed keys (same key, different value)
  for (const k of Object.keys(newMod)) {
    if (oldMod[k] && oldMod[k] !== newMod[k]) {
      renamedModules[key] = renamedModules[key] || [];
      renamedModules[key].push(k);
    }
  }

  // Track moved keys (for our purposes, same as renamed)
  const changedKeys = Object.keys(newMod).filter(k => oldMod[k] && oldMod[k] !== newMod[k]);
  if (changedKeys.length) {
    movedModules[key] = changedKeys;
  }
}

// Format diff blocks
function formatDiffBlock(title, moduleId, keys, type) {
  if (!keys || !keys.length) return '';
  const lines = keys.map(k => {
    switch (type) {
      case 'added': return `+ "${k}": "${curr[moduleId][k]}"`;
      case 'removed': return `- "${k}": "${prev[moduleId][k]}"`;
      case 'renamed':
      case 'moved':
        return `- "${k}": "${prev[moduleId][k]}"\n+ "${k}": "${curr[moduleId][k]}"`;
    }
  }).join('\n');

  return `### ${title} in module ${moduleId}\n\`\`\`diff\n${lines}\n\`\`\`\n`;
}

// Build full diff
let fullDiff = '';
for (const [mod, keys] of Object.entries(addedModules)) fullDiff += formatDiffBlock('Added', mod, keys, 'added');
for (const [mod, keys] of Object.entries(removedModules)) fullDiff += formatDiffBlock('Removed', mod, keys, 'removed');
for (const [mod, keys] of Object.entries(renamedModules)) fullDiff += formatDiffBlock('Renamed', mod, keys, 'renamed');
for (const [mod, keys] of Object.entries(movedModules)) fullDiff += formatDiffBlock('Moved', mod, keys, 'moved');

if (!fullDiff) fullDiff = 'No changes detected.';

// ---- Discord Post ----
(async () => {
  try {
    const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

    // Build short overview for Discord
    const summaryLines = [];
    for (const [mod, keys] of Object.entries(addedModules)) summaryLines.push(`Module ${mod}: Added: ${keys.length}`);
    for (const [mod, keys] of Object.entries(removedModules)) summaryLines.push(`Module ${mod}: Removed: ${keys.length}`);
    for (const [mod, keys] of Object.entries(renamedModules)) summaryLines.push(`Module ${mod}: Renamed: ${keys.length}`);
    for (const [mod, keys] of Object.entries(movedModules)) summaryLines.push(`Module ${mod}: Moved: ${keys.length}`);

    let discordMessage = '**Module changes summary**\n';
    if (summaryLines.length) discordMessage += summaryLines.join('\n') + '\n';
    discordMessage += `\nView full list of changes here: ${commitUrl}`;

    // Respect 2000 char limit
    if (discordMessage.length > 2000) discordMessage = discordMessage.slice(0, 1990) + '...\nSee full list above';

    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage });
    console.log('Discord post successful');
  } catch (err) {
    console.error('Discord post failed:', err.message);
  }
})();

// ---- GitHub Post ----
const MAX_COMMENT_LENGTH = 65000;
if (fullDiff.length <= MAX_COMMENT_LENGTH) {
  fs.writeFileSync('full_diff.txt', fullDiff);
  console.log('GitHub diff ready in full_diff.txt');
} else {
  // Split into multiple files if needed
  let start = 0, part = 1;
  while (start < fullDiff.length) {
    const chunk = fullDiff.slice(start, start + MAX_COMMENT_LENGTH);
    fs.writeFileSync(`full_diff_part_${part}.txt`, chunk);
    start += MAX_COMMENT_LENGTH;
    console.log(`GitHub diff part ${part} ready in full_diff_part_${part}.txt`);
    part++;
  }
}
