const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const { Octokit } = require('@octokit/rest');

const fileName = process.argv[2];
if (!fileName) throw new Error("Please provide a filename as an argument.");

const prev = JSON.parse(require('child_process').execSync(`git show HEAD^:${fileName}`).toString());
const curr = JSON.parse(require('child_process').execSync(`git show HEAD:${fileName}`).toString());

const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};
const usedCurr = new Set();

// Detect moved modules
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

// Added, Removed, Renamed keys
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

// GitHub full diff
let githubOutput = '';
for (const [mod, keys] of Object.entries(addedModules)) githubOutput += formatDiffBlock('Added', mod, keys, 'added');
for (const [mod, keys] of Object.entries(removedModules)) githubOutput += formatDiffBlock('Removed', mod, keys, 'removed');
for (const [mod, keys] of Object.entries(renamedModules)) githubOutput += formatDiffBlock('Renamed', mod, keys, 'renamed');
for (const [mod, info] of Object.entries(movedModules)) githubOutput += formatDiffBlock('Moved', mod, info.keys, 'moved', info.to);
if (!githubOutput) githubOutput = 'No changes detected.';

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

// Post full diff as GitHub commit comments
(async () => {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const githubChunks = splitText(githubOutput, MAX_COMMENT_LENGTH);
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
  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  if (fileName === 'base64entries.json') {
    const addedCount = Object.values(addedModules).reduce((acc, keys) => acc + keys.length, 0);
    const removedCount = Object.values(removedModules).reduce((acc, keys) => acc + keys.length, 0);
    const modifiedCount = Object.values(renamedModules).reduce((acc, keys) => acc + keys.length, 0) +
                          Object.values(movedModules).reduce((acc, info) => acc + info.keys.length, 0);
    const discordMessage = `### Base64 entries summary\nAdded: ${addedCount}, Removed: ${removedCount}, Modified: ${modifiedCount}\nSee full list of changes here: ${commitUrl}`;
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage });
    console.log('Discord post for base64entries.json successful');
  } else {
    const summaryLines = [];
    const allModules = { addedModules, removedModules, renamedModules, movedModules };
    for (const [title, mods] of Object.entries(allModules)) {
      if (Object.keys(mods).length === 0) continue;
      summaryLines.push(`${title.replace('Modules','')}: ${Object.keys(mods).length} modules changed`);
    }

    let topModules = Object.keys(curr).slice(0, 5);
    let extraModules = Object.keys(curr).length - 5;
    const summary = topModules.map(m => `Module ${m}`).join('\n') +
                    (extraModules > 0 ? `\n${extraModules} more modules not included` : '');

    const discordMessage = `### Module changes summary\n${summary}\nSee full list of changes here: ${commitUrl}`.slice(0, 2000);
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage });
    console.log('Discord post for discordclasses.json successful');
  }
})();
