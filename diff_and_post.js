const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const { Octokit } = require('@octokit/rest');

// Load JSON
const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};
const usedCurr = new Set();

// Detect module moves
for (const oldId of Object.keys(prev)) {
  if (curr[oldId]) continue;
  let bestMatch = null;
  let bestScore = Infinity;

  for (const newId of Object.keys(curr)) {
    if (usedCurr.has(newId)) continue;
    const oldKeys = Object.keys(prev[oldId]).join(',');
    const newKeys = Object.keys(curr[newId]).join(',');
    const score = levenshtein.get(oldKeys, newKeys);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = newId;
    }
  }

  if (bestMatch) {
    const oldKeysSet = new Set(Object.keys(prev[oldId]));
    const newKeysSet = new Set(Object.keys(curr[bestMatch]));
    const intersection = [...oldKeysSet].filter(k => newKeysSet.has(k));
    const similarity = intersection.length / Math.max(oldKeysSet.size, newKeysSet.size);
    if (similarity >= 0.5) {
      movedModules[oldId] = {
        to: bestMatch,
        keys: intersection.filter(k => prev[oldId][k] !== curr[bestMatch][k])
      };
      usedCurr.add(bestMatch);
    }
  }
}

// Detect added, removed, renamed keys
for (const key of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
  const oldMod = prev[key] || {};
  const newMod = curr[key] || {};

  for (const k of Object.keys(newMod)) if (!oldMod.hasOwnProperty(k)) {
    addedModules[key] = addedModules[key] || [];
    addedModules[key].push(k);
  }

  for (const k of Object.keys(oldMod)) if (!newMod.hasOwnProperty(k)) {
    removedModules[key] = removedModules[key] || [];
    removedModules[key].push(k);
  }

  for (const k of Object.keys(newMod)) if (oldMod[k] && oldMod[k] !== newMod[k]) {
    renamedModules[key] = renamedModules[key] || [];
    renamedModules[key].push(k);
  }
}

function formatDiffBlock(title, moduleId, keys, type, toModuleId=null) {
  if (!keys || keys.length === 0) return '';
  const lines = keys.map(k => {
    switch (type) {
      case 'added': return `+ "${k}": "${curr[moduleId][k]}"`;
      case 'removed': return `- "${k}": "${prev[moduleId][k]}"`;
      case 'renamed': 
      case 'moved':
        return `- "${k}": "${prev[moduleId][k]}"\n+ "${k}": "${curr[toModuleId||moduleId][k]}"`;
    }
  }).join('\n');
  return `### ${title} in module ${moduleId}${toModuleId ? ` -> ${toModuleId}` : ''}\n\`\`\`diff\n${lines}\n\`\`\`\n`;
}

// Build GitHub diff
let githubOutput = '';
for (const [mod, keys] of Object.entries(addedModules)) githubOutput += formatDiffBlock('Added', mod, keys, 'added');
for (const [mod, keys] of Object.entries(removedModules)) githubOutput += formatDiffBlock('Removed', mod, keys, 'removed');
for (const [mod, keys] of Object.entries(renamedModules)) githubOutput += formatDiffBlock('Renamed', mod, keys, 'renamed');
for (const [mod, info] of Object.entries(movedModules)) githubOutput += formatDiffBlock('Moved', mod, info.keys, 'moved', info.to);

if (!githubOutput) githubOutput = 'No changes detected.';

// GitHub commit comment
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
const githubChunks = splitText(githubOutput, MAX_COMMENT_LENGTH);
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
(async () => {
  for (let i = 0; i < githubChunks.length; i++) {
    const body = githubChunks.length > 1 ? `**Part ${i+1} of ${githubChunks.length}**\n\n${githubChunks[i]}` : githubChunks[i];
    await octokit.rest.repos.createCommitComment({
      owner: process.env.GITHUB_REPOSITORY.split('/')[0],
      repo: process.env.GITHUB_REPOSITORY.split('/')[1],
      commit_sha: process.env.GITHUB_SHA,
      body,
    });
  }

  // Discord summary
  function summarize(mods) {
    return Object.entries(mods).map(([mod, keys]) => {
      if (typeof keys === 'object' && keys.to) return `Module ${mod}: Moved: ${keys.keys.length}`;
      return `Module ${mod}: ${keys.length}`;
    }).join(', ');
  }

  const summaryLines = [];
  if (Object.keys(addedModules).length) summaryLines.push(`Added: ${summarize(addedModules)}`);
  if (Object.keys(removedModules).length) summaryLines.push(`Removed: ${summarize(removedModules)}`);
  if (Object.keys(renamedModules).length) summaryLines.push(`Renamed: ${summarize(renamedModules)}`);
  if (Object.keys(movedModules).length) summaryLines.push(`Moved: ${summarize(movedModules)}`);

  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  let discordMessage = `**Module changes summary**\n${summaryLines.join('\n')}\n\nView full list of changes here: ${commitUrl}`;

  if (discordMessage.length > 2000) discordMessage = discordMessage.slice(0, 1997) + '...';
  await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage });
  console.log('Discord post successful');
})();
