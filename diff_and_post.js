const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const path = require('path');
const axios = require('axios'); // for Discord webhook

// GitHub Actions environment
const githubToken = process.env.GITHUB_TOKEN;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY; // owner/repo
const commitUrl = `https://github.com/${repo}/commit/${commitSha}`;
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL; // optional

const prevPath = path.join(__dirname, 'previous.json');
const currPath = path.join(__dirname, 'current.json');

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

function diffObjects(prev, curr) {
  const added = [], removed = [], renamed = [], moved = [];
  const allModules = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  allModules.forEach(moduleKey => {
    const prevModule = prev[moduleKey] || {};
    const currModule = curr[moduleKey] || {};
    const allKeys = new Set([...Object.keys(prevModule), ...Object.keys(currModule)]);
    allKeys.forEach(k => {
      if (!(k in prevModule)) added.push({ module: moduleKey, key: k });
      else if (!(k in currModule)) removed.push({ module: moduleKey, key: k });
      else if (prevModule[k] !== currModule[k]) renamed.push({ module: moduleKey, key: k });
    });
  });
  return { added, removed, renamed, moved };
}

function formatDiff(diffObj) {
  const lines = [];
  if (diffObj.removed.length) {
    lines.push('### Removed');
    diffObj.removed.forEach(r => lines.push(`- ${r.key} removed from Module ${r.module}`));
  }
  if (diffObj.added.length) {
    lines.push('### Added');
    diffObj.added.forEach(a => lines.push(`+ ${a.key} added to Module ${a.module}`));
  }
  if (diffObj.renamed.length) {
    lines.push('### Renamed');
    diffObj.renamed.forEach(rn => lines.push(`~ ${rn.key} renamed in Module ${rn.module}`));
  }
  if (diffObj.moved.length) {
    lines.push('### Moved');
    diffObj.moved.forEach(mv => lines.push(`> ${mv.key} moved in Module ${mv.module}`));
  }
  return lines.join('\n');
}

async function postGitHubComment(octokit, body) {
  const MAX_LENGTH = 65000; // GitHub max per comment
  const chunks = [];
  for (let i = 0; i < body.length; i += MAX_LENGTH) {
    chunks.push(body.slice(i, i + MAX_LENGTH));
  }
  for (const chunk of chunks) {
    await octokit.rest.repos.createCommitComment({
      owner: repo.split('/')[0],
      repo: repo.split('/')[1],
      commit_sha: commitSha,
      body: chunk
    });
  }
}

async function postDiscordComment(body) {
  if (!discordWebhookUrl) return;
  const MAX_LENGTH = 2000 - 100;
  const msg = body.length > MAX_LENGTH ? body.slice(0, MAX_LENGTH) + '\n...' : body;
  await axios.post(discordWebhookUrl, { content: '```diff\n' + msg + '\n```\nFull commit here: ' + commitUrl });
}

async function main() {
  const prevJson = readJsonSafe(prevPath);
  const currJson = readJsonSafe(currPath);
  const diffObj = diffObjects(prevJson, currJson);
  const formattedDiff = formatDiff(diffObj);

  if (!formattedDiff) return console.log('No changes detected');

  const githubOctokit = new Octokit({ auth: githubToken });
  const fullGitHubComment = formattedDiff + '\nFull commit here: ' + commitUrl;

  await postGitHubComment(githubOctokit, fullGitHubComment);
  console.log('GitHub comment posted.');

  await postDiscordComment(formattedDiff);
  console.log('Discord comment posted.');
}

main().catch(err => console.error(err));
