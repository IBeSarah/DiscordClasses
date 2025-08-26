const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const mode = process.argv[2] || 'discord'; // 'discord' or 'github'

// Load previous/current JSON
const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

// Track diffs
const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};
const addedKeys = {};
const removedKeys = {};

// Determine diffs per module
for (const key of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
  const oldMod = prev[key] || {};
  const newMod = curr[key] || {};

  // Module added
  if (!prev[key]) {
    addedModules[key] = Object.keys(newMod);
    continue;
  }

  // Module removed
  if (!curr[key]) {
    removedModules[key] = Object.keys(oldMod);
    continue;
  }

  // Track added/removed keys
  for (const k of Object.keys(newMod)) if (!oldMod.hasOwnProperty(k)) {
    addedKeys[key] = addedKeys[key] || [];
    addedKeys[key].push(k);
  }

  for (const k of Object.keys(oldMod)) if (!newMod.hasOwnProperty(k)) {
    removedKeys[key] = removedKeys[key] || [];
    removedKeys[key].push(k);
  }

  // Renamed (value changed)
  for (const k of Object.keys(newMod)) {
    if (oldMod[k] && oldMod[k] !== newMod[k]) {
      renamedModules[key] = renamedModules[key] || [];
      renamedModules[key].push(k);
    }
  }

  // Moved module: optional, only if structure changes
  // Here we do not include moved unless entire module moved, handled above
}

// Format diff for GitHub
function formatDiffBlock(title, moduleId, keys, type) {
  if (!keys || keys.length === 0) return '';
  const lines = keys.map(k => {
    switch (type) {
      case 'added': return `+ "${k}": "${curr[moduleId][k]}"`;
      case 'removed': return `- "${k}": "${prev[moduleId][k]}"`;
      case 'renamed':
        return `- "${k}": "${prev[moduleId][k]}"\n+ "${k}": "${curr[moduleId][k]}"`;
      case 'moved':
        return keys.length ? keys.map(kk => {
          return `- "${kk}": "${prev[moduleId][kk]}"\n+ "${kk}": "${curr[moduleId][kk]}"`;
        }).join('\n') : '';
    }
  }).join('\n');

  return `### ${title} in module ${moduleId}\n\`\`\`diff\n${lines}\n\`\`\`\n`;
}

// Build output
let output = '';

// Added whole modules
for (const [mod, keys] of Object.entries(addedModules)) {
  output += formatDiffBlock('Added', mod, keys, 'added');
}

// Removed whole modules
for (const [mod, keys] of Object.entries(removedModules)) {
  output += formatDiffBlock('Removed', mod, keys, 'removed');
}

// Added/Removed keys
for (const [mod, keys] of Object.entries(addedKeys)) {
  output += formatDiffBlock('Added', mod, keys, 'added');
}
for (const [mod, keys] of Object.entries(removedKeys)) {
  output += formatDiffBlock('Removed', mod, keys, 'removed');
}

// Renamed keys
for (const [mod, keys] of Object.entries(renamedModules)) {
  output += formatDiffBlock('Renamed', mod, keys, 'renamed');
}

// Moved modules (if any)
for (const [mod, keys] of Object.entries(movedModules)) {
  output += formatDiffBlock('Moved', mod, keys, 'moved');
}

if (!output) output = 'No changes detected.';

// Post output
if (mode === 'discord') {
  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

  // Build a short summary for Discord (counts only)
  let summary = '**Module changes summary**\n';
  for (const mod of _.union(
    Object.keys(addedModules),
    Object.keys(removedModules),
    Object.keys(addedKeys),
    Object.keys(removedKeys),
    Object.keys(renamedModules),
    Object.keys(movedModules)
  )) {
    const added = (addedModules[mod]?.length || addedKeys[mod]?.length) || 0;
    const removed = (removedModules[mod]?.length || removedKeys[mod]?.length) || 0;
    const renamed = renamedModules[mod]?.length || 0;
    const moved = movedModules[mod]?.length || 0;
    summary += `Module ${mod}: Added: ${added}, Removed: ${removed}, Renamed: ${renamed}, Moved: ${moved}\n`;
  }

  summary += `\nView full list of changes here: ${commitUrl}`;

  // Respect 2000 char limit
  if (summary.length > 2000) summary = summary.slice(0, 1990) + '...';

  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: summary })
    .then(() => console.log('Discord post successful'))
    .catch(err => console.error('Discord post failed:', err.message));

} else {
  // GitHub full diff, split if > 65k chars
  const MAX_COMMENT_LENGTH = 65000;
  function splitText(text, maxLength) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLength));
      start += maxLength;
    }
    return chunks;
  }

  const chunks = splitText(output, MAX_COMMENT_LENGTH);
  fs.writeFileSync('full_diff.txt', output);
  console.log('GitHub diff ready in full_diff.txt');

  const { Octokit } = require("@octokit/rest");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  (async () => {
    for (let i = 0; i < chunks.length; i++) {
      const body = chunks.length > 1
        ? `**Part ${i + 1} of ${chunks.length}**\n\n${chunks[i]}`
        : chunks[i];

      await octokit.rest.repos.createCommitComment({
        owner: process.env.GITHUB_REPOSITORY.split('/')[0],
        repo: process.env.GITHUB_REPOSITORY.split('/')[1],
        commit_sha: process.env.GITHUB_SHA,
        body
      });
      console.log(`Posted GitHub comment part ${i + 1}/${chunks.length}`);
    }
  })();
}
