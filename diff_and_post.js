const fs = require('fs');
const _ = require('lodash');

const mode = process.argv[2] || 'discord'; // 'discord' or 'github'

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};

for (const key of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
  const oldMod = prev[key] || {};
  const newMod = curr[key] || {};

  // Added
  for (const k of Object.keys(newMod)) {
    if (!oldMod.hasOwnProperty(k)) {
      addedModules[key] = addedModules[key] || [];
      addedModules[key].push(k);
    }
  }

  // Removed
  for (const k of Object.keys(oldMod)) {
    if (!newMod.hasOwnProperty(k)) {
      removedModules[key] = removedModules[key] || [];
      removedModules[key].push(k);
    }
  }

  // Renamed (value changed for same key)
  for (const k of Object.keys(newMod)) {
    if (oldMod[k] && oldMod[k] !== newMod[k]) {
      renamedModules[key] = renamedModules[key] || [];
      renamedModules[key].push(k);
    }
  }

  // Moved is treated same as value changed (optional: could merge with renamed)
  // Here we only track changed keys
  const changedKeys = Object.keys(newMod).filter(k => oldMod[k] && oldMod[k] !== newMod[k]);
  if (changedKeys.length) {
    movedModules[key] = changedKeys;
  }
}

function formatDiffBlock(title, moduleId, keys, type) {
  if (!keys || keys.length === 0) return '';
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

let output = '';

// Build GitHub/Discord output
for (const [mod, keys] of Object.entries(addedModules)) {
  output += formatDiffBlock('Added', mod, keys, 'added');
}
for (const [mod, keys] of Object.entries(removedModules)) {
  output += formatDiffBlock('Removed', mod, keys, 'removed');
}
for (const [mod, keys] of Object.entries(renamedModules)) {
  output += formatDiffBlock('Renamed', mod, keys, 'renamed');
}
for (const [mod, keys] of Object.entries(movedModules)) {
  output += formatDiffBlock('Moved', mod, keys, 'moved');
}

if (!output) {
  output = 'No changes detected.';
}

// Output
if (mode === 'discord') {
  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  const summary = `**Module changes summary**\n${output}\nView full list of changes here: ${commitUrl}`;
  const axios = require('axios');
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: summary })
    .then(() => console.log('Discord post successful'))
    .catch(err => console.error('Discord post failed:', err.message));
} else {
  fs.writeFileSync('full_diff.txt', output);
  console.log('GitHub diff ready in full_diff.txt');
}
