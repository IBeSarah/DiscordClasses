const fs = require('fs');
const axios = require('axios');
const { Octokit } = require("@octokit/rest");

// Environment variables
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repoFull = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;
const githubToken = process.env.GITHUB_TOKEN;

// File paths
const prevFile = 'previous.json';
const currFile = 'current.json';
const MAX_DISCORD_LENGTH = 2000;
const MAX_GITHUB_LENGTH = 65536;

// Helper to load JSON safely
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Diff logic
function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevModules = Object.keys(prev);
  const currModules = Object.keys(curr);
  const allModules = new Set([...prevModules, ...currModules]);

  allModules.forEach(moduleKey => {
    const prevModule = prev[moduleKey] || {};
    const currModule = curr[moduleKey] || {};

    const prevKeys = Object.keys(prevModule);
    const currKeys = Object.keys(currModule);

    // Added
    currKeys.forEach(k => {
      if (!prevKeys.includes(k)) added.push(`${k} added to Module \`${moduleKey}\``);
    });

    // Removed
    prevKeys.forEach(k => {
      if (!currKeys.includes(k)) removed.push(`${k} removed from Module \`${moduleKey}\``);
    });

    // Renamed
    prevKeys.forEach(pk => {
      currKeys.forEach(ck => {
        if (prevModule[pk] === currModule[ck] && pk !== ck) {
          renamed.push(`${pk} renamed to ${ck} in Module \`${moduleKey}\``);
        }
      });
    });

    // Moved
    prevKeys.forEach(pk => {
      currModules.forEach(cm => {
        if (cm !== moduleKey && curr[cm] && curr[cm][pk] === prevModule[pk]) {
          moved.push(`${pk} moved from Module \`${moduleKey}\` to Module \`${cm}\``);
        }
      });
    });
  });

  return { added, removed, renamed, moved };
}

// Load JSON
const previousData = loadJson(prevFile);
const currentData = loadJson(currFile);
const { added, removed, renamed, moved } = diffModules(previousData, currentData);

const commitUrl = `${serverUrl}/${repoFull}/commit/${commitSha}`;

// Build Discord message
let discordMsg = '```diff\n';
if (removed.length) discordMsg += '### Removed\n' + removed.map(l => `- ${l}`).join('\n') + '\n';
if (added.length) discordMsg += '### Added\n' + added.map(l => `+ ${l}`).join('\n') + '\n';
if (renamed.length) discordMsg += '### Renamed\n' + renamed.map(l => `~ ${l}`).join('\n') + '\n';
if (moved.length) discordMsg += '### Moved\n' + moved.map(l => `> ${l}`).join('\n') + '\n';
discordMsg += '```';

// Truncate for Discord
if (discordMsg.length + commitUrl.length + 12 > MAX_DISCORD_LENGTH) {
  const allowedLength = MAX_DISCORD_LENGTH - commitUrl.length - 12;
  discordMsg = discordMsg.slice(0, allowedLength) + '\n```';
}
discordMsg += `\nFull details here: ${commitUrl}`;

// Post to Discord
axios.post(webhookUrl, { content: discordMsg })
  .then(() => console.log('Posted diff to Discord'))
  .catch(err => console.error('Failed to post to Discord:', err.message));

// Prepare full diff for GitHub
let githubDiff = '';
if (removed.length) githubDiff += '### Removed\n' + removed.join('\n') + '\n';
if (added.length) githubDiff += '### Added\n' + added.join('\n') + '\n';
if (renamed.length) githubDiff += '### Renamed\n' + renamed.join('\n') + '\n';
if (moved.length) githubDiff += '### Moved\n' + moved.join('\n') + '\n';
githubDiff += `Full commit here: ${commitUrl}`;

// Post to GitHub as comments
if (githubToken && githubDiff.trim()) {
  const octokit = new Octokit({ auth: githubToken });
  const [owner, repo] = repoFull.split('/');

  function splitText(text, maxLength) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLength));
      start += maxLength;
    }
    return chunks;
  }

  const githubChunks = splitText(githubDiff, MAX_GITHUB_LENGTH);

  (async () => {
    for (let i = 0; i < githubChunks.length; i++) {
      const body = githubChunks.length > 1
        ? `**Part ${i + 1} of ${githubChunks.length}**\n\n` + githubChunks[i]
        : githubChunks[i];

      await octokit.repos.createCommitComment({
        owner,
        repo,
        commit_sha: commitSha,
        body
      });

      console.log(`Posted GitHub comment part ${i + 1}/${githubChunks.length}`);
    }
  })();
}
