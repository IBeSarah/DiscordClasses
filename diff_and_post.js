const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const { Octokit } = require('@octokit/rest');

const jsonFile = process.argv[2]; 
const isBase64 = jsonFile.includes('base64');
const isCssVariables = jsonFile === 'css-variables.json';

const prev = JSON.parse(fs.readFileSync(`previous_${jsonFile}`, 'utf8'));
const curr = JSON.parse(fs.readFileSync(`current_${jsonFile}`, 'utf8'));

const addedModules = {};
const removedModules = {};
const renamedModules = {};
const movedModules = {};
const usedCurr = new Set();

// Detect moved modules based on key similarity
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
  
  for (const k of Object.keys(newMod)) {
    if (!oldMod.hasOwnProperty(k)) {
      addedModules[key] = addedModules[key] || [];
      addedModules[key].push(k);
    }
  }

  for (const k of Object.keys(oldMod)) {
    if (!newMod.hasOwnProperty(k)) {
      removedModules[key] = removedModules[key] || [];
      removedModules[key].push(k);
    }
  }

  for (const k of Object.keys(newMod)) {
    if (oldMod.hasOwnProperty(k) && oldMod[k] !== newMod[k]) {
      renamedModules[key] = renamedModules[key] || [];
      renamedModules[key].push(k);
    }
  }
}

// CSS variable change summarizer
function summarizeCssVariableChanges(prev, curr) {
  let added = 0;
  let removed = 0;
  let renamed = 0;

  const selectors = new Set([
    ...Object.keys(prev),
    ...Object.keys(curr)
  ]);

  for (const selector of selectors) {
    const oldVars = prev[selector] || {};
    const newVars = curr[selector] || {};

    for (const v of Object.keys(newVars)) {
      if (!oldVars.hasOwnProperty(v)) added++;
    }

    for (const v of Object.keys(oldVars)) {
      if (!newVars.hasOwnProperty(v)) removed++;
    }

    for (const v of Object.keys(newVars)) {
      if (oldVars.hasOwnProperty(v) && oldVars[v] !== newVars[v]) {
        renamed++;
      }
    }
  }

  return { added, removed, renamed };
}

// Format diff blocks for GitHub comment
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

let githubOutput = '';
for (const [mod, keys] of Object.entries(addedModules)) githubOutput += formatDiffBlock('Added', mod, keys, 'added');
for (const [mod, keys] of Object.entries(removedModules)) githubOutput += formatDiffBlock('Removed', mod, keys, 'removed');
for (const [mod, keys] of Object.entries(renamedModules)) githubOutput += formatDiffBlock('Renamed', mod, keys, 'renamed');
for (const [mod, info] of Object.entries(movedModules)) githubOutput += formatDiffBlock('Moved', mod, info.keys, 'moved', info.to);

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

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Summarize module changes for Discord
function summarizeModules(added, removed, renamed, moved) {
  const summaries = [];

  if (isCssVariables) {
    const { added, removed, renamed } = summarizeCssVariableChanges(prev, curr);
    if (added || removed || renamed) {
      summaries.push(`CSS Variables: ${added} added, ${removed} removed, ${renamed} renamed`);
    }
    return { summaries, remainingChanges: 0 };
  }

  const modules = new Set([
    ...Object.keys(added),
    ...Object.keys(removed),
    ...Object.keys(renamed),
    ...Object.keys(moved)
  ]);

  let count = 0;

  for (const mod of modules) {
    if (count >= 5) break;

    if (isBase64) {
      const a = added[mod]?.length || 0;
      const r = removed[mod]?.length || 0;
      const rn = renamed[mod]?.length || 0;
      summaries.push(`Base64 Module ${mod}: ${a} added, ${r} removed, ${rn} renamed`);
    } else {
      const parts = [];
      if (added[mod]?.length) parts.push(`Added: ${added[mod].length}`);
      if (removed[mod]?.length) parts.push(`Removed: ${removed[mod].length}`);
      if (renamed[mod]?.length) parts.push(`Renamed: ${renamed[mod].length}`);
      if (moved[mod]?.keys?.length) parts.push(`Moved: ${moved[mod].keys.length}`);
      if (parts.length) summaries.push(`Module ${mod}: ${parts.join(', ')}`);
    }

    count++;
  }

  const remainingChanges = Math.max(modules.size - 5, 0);
  return { summaries, remainingChanges };
}

const { summaries, remainingChanges } = summarizeModules(
  addedModules,
  removedModules,
  renamedModules,
  movedModules
);

// Determine if there are any changes
const totalChanges =
  Object.keys(addedModules).length +
  Object.keys(removedModules).length +
  Object.keys(renamedModules).length +
  Object.keys(movedModules).length;

// Only post Discord if there are real changes
if (totalChanges > 0 || (isCssVariables && summaries.length > 0)) {
  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  let discordMessage = isBase64
    ? `**Base64 Module changes summary**\n`
    : `**Module changes summary**\n`;

  discordMessage += summaries.join('\n');
  if (remainingChanges) discordMessage += `\n${remainingChanges} more changes not included`;
  discordMessage += `\nSee full list of changes here: <${commitUrl}>`;

  if (discordMessage.length > 2000) {
    discordMessage = discordMessage.slice(0, 1990) + '...';
  }

  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage })
    .then(() => console.log('Discord post successful'))
    .catch(err => console.error('Discord post failed:', err.message));
} else {
  console.log('No changes detected. Skipping Discord post.');
}

// GitHub comment
if (githubOutput || (isCssVariables && summaries.length > 0)) {
  const githubChunks = splitText(
    githubOutput || 'CSS Variables changes detected',
    MAX_COMMENT_LENGTH
  );

  (async () => {
    for (let i = 0; i < githubChunks.length; i++) {
      const body =
        githubChunks.length > 1
          ? `**Part ${i + 1} of ${githubChunks.length}**\n\n${githubChunks[i]}`
          : githubChunks[i];

      await octokit.rest.repos.createCommitComment({
        owner: process.env.GITHUB_REPOSITORY.split('/')[0],
        repo: process.env.GITHUB_REPOSITORY.split('/')[1],
        commit_sha: process.env.GITHUB_SHA,
        body
      });
    }
  })();
} else {
  console.log('No changes detected. Skipping GitHub comment.');
}
