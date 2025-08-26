const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const previousPath = 'previous.json';
const currentPath = 'current.json';

// Parse JSON with duplicate key detection
function parseJsonWithDuplicateCheck(path) {
  const content = fs.readFileSync(path, 'utf8');
  const keyStack = [];
  const duplicates = [];

  JSON.parse(content, (key, value) => {
    if (key && keyStack.includes(key)) {
      duplicates.push(key);
    }
    if (key) keyStack.push(key);
    return value;
  });

  if (duplicates.length > 0) {
    console.warn(`⚠ Duplicate keys detected in ${path}:`, [...new Set(duplicates)]);
  }

  return JSON.parse(content);
}

const previous = parseJsonWithDuplicateCheck(previousPath);
const current = parseJsonWithDuplicateCheck(currentPath);

// Helper to detect added, removed, renamed, moved
function diffModules(prev, curr) {
  const added = {};
  const removed = {};
  const renamed = {};
  const moved = {};

  for (const mod in curr) {
    if (!prev[mod]) {
      added[mod] = curr[mod];
      continue;
    }

    // Compare keys inside module
    const prevKeys = prev[mod];
    const currKeys = curr[mod];

    // Added keys
    for (const key in currKeys) {
      if (!(key in prevKeys)) {
        added[key] = added[key] || [];
        added[key].push(mod);
      } else if (prevKeys[key] !== currKeys[key]) {
        renamed[key] = renamed[key] || [];
        renamed[key].push(mod);
      }
    }

    // Removed keys
    for (const key in prevKeys) {
      if (!(key in currKeys)) {
        removed[key] = removed[key] || [];
        removed[key].push(mod);
      }
    }

    // Detect module moved (if module contents changed)
    if (!_.isEqual(prevKeys, currKeys)) {
      moved[mod] = { from: prevKeys, to: currKeys };
    }
  }

  // Modules entirely removed
  for (const mod in prev) {
    if (!curr[mod]) {
      removed[mod] = prev[mod];
    }
  }

  return { added, removed, renamed, moved };
}

const diff = diffModules(previous, current);

// ---------- Discord Post ----------
let discordMsg = '';
const addSummary = (title, obj) => {
  const modules = Object.values(obj)
    .flatMap(x => (typeof x === 'object' ? Object.keys(x) : x))
    .join(', ');
  if (modules) discordMsg += `### ${title} ${modules.length} items in modules: ${modules}\n`;
};

addSummary('Added', diff.added);
addSummary('Removed', diff.removed);
addSummary('Renamed', diff.renamed);
addSummary('Moved', diff.moved);

if (discordMsg.trim()) {
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMsg })
    .catch(err => console.error('Discord post failed', err));
}

// ---------- GitHub Post ----------
let githubDiff = '';
for (const [mod, keys] of Object.entries(diff.moved)) {
  githubDiff += `# Moved in module ${mod}\n\`\`\`diff\n`;
  for (const [key, value] of Object.entries(keys.from)) {
    githubDiff += `- "${key}": "${value}"\n`;
  }
  for (const [key, value] of Object.entries(keys.to)) {
    githubDiff += `+ "${key}": "${value}"\n`;
  }
  githubDiff += '```\n';
}

const postGitHubComment = async () => {
  const { Octokit } = require("@octokit/rest");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  if (!githubDiff.trim()) return;

  await octokit.rest.repos.createCommitComment({
    owner: process.env.GITHUB_REPOSITORY.split('/')[0],
    repo: process.env.GITHUB_REPOSITORY.split('/')[1],
    commit_sha: process.env.GITHUB_SHA,
    body: githubDiff
  });
};

postGitHubComment().catch(err => console.error('GitHub comment failed', err));
