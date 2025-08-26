// diff_and_post.js
const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

// Environment variables
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

// File paths
const prevFile = 'previous.json';
const currFile = 'current.json';

// Discord & GitHub limits
const MAX_DISCORD_LENGTH = 2000;
const MAX_GITHUB_LENGTH = 65536;

// Load JSON safely
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Generate diff arrays
function generateDiff(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  // Flatten modules
  function flatten(obj) {
    const res = {};
    for (const key in obj) {
      for (const subKey in obj[key]) {
        res[`${key}.${subKey}`] = obj[key][subKey];
      }
    }
    return res;
  }

  const prevFlat = flatten(prev);
  const currFlat = flatten(curr);

  // Added & Removed
  for (const key in currFlat) if (!prevFlat[key]) added.push(`${key}`);
  for (const key in prevFlat) if (!currFlat[key]) removed.push(`${key}`);

  // Moved & Renamed (simplified: if value matches but module changed => moved, if key changed but value similar => renamed)
  for (const keyCurr in currFlat) {
    for (const keyPrev in prevFlat) {
      if (currFlat[keyCurr] === prevFlat[keyPrev] && keyCurr !== keyPrev) moved.push(`${keyPrev} -> ${keyCurr}`);
      else if (levenshtein.get(currFlat[keyCurr], prevFlat[keyPrev]) <= 2 && keyCurr !== keyPrev) renamed.push(`${keyPrev} -> ${keyCurr}`);
    }
  }

  return { added, removed, renamed, moved };
}

// Format diff for Discord/GitHub
function formatDiff(diffObj) {
  let result = '';
  if (diffObj.removed.length) result += `### Removed\n* ${diffObj.removed.join('\n* ')}\n`;
  if (diffObj.added.length) result += `### Added\n* ${diffObj.added.join('\n* ')}\n`;
  if (diffObj.renamed.length) result += `### Renamed\n* ${diffObj.renamed.join('\n* ')}\n`;
  if (diffObj.moved.length) result += `### Moved\n* ${diffObj.moved.join('\n* ')}\n`;
  return result || 'No changes';
}

// Split text into chunks for GitHub
function splitChunks(text, maxLength) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

async function postToDiscord(content) {
  // Truncate for Discord
  let discordContent = content;
  if (discordContent.length > MAX_DISCORD_LENGTH) {
    discordContent = discordContent.slice(0, MAX_DISCORD_LENGTH - 20) + '\n... (truncated)';
  }

  try {
    await axios.post(webhookUrl, { content: "```diff\n" + discordContent + "\n```" });
    console.log('Posted to Discord');
  } catch (err) {
    console.error('Discord post failed:', err.response?.data || err.message);
  }
}

// Main
(async () => {
  const prevJson = loadJson(prevFile);
  const currJson = loadJson(currFile);

  const diffObj = generateDiff(prevJson, currJson);
  const diffText = formatDiff(diffObj) + `\nFull commit here: ${serverUrl}/${repo}/commit/${commitSha}`;

  // Discord
  await postToDiscord(diffText);

  // GitHub comments
  const chunks = splitChunks(diffText, MAX_GITHUB_LENGTH);
  const { Octokit } = require('@octokit/rest');
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  for (let i = 0; i < chunks.length; i++) {
    const body = chunks.length > 1 ? `**Part ${i + 1} of ${chunks.length}**\n\n${chunks[i]}` : chunks[i];
    await octokit.rest.repos.createCommitComment({
      owner: repo.split('/')[0],
      repo: repo.split('/')[1],
      commit_sha: commitSha,
      body,
    });
    console.log(`Posted GitHub comment part ${i + 1}/${chunks.length}`);
  }
})();
