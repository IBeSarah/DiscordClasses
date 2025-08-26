const fs = require('fs');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

const MAX_DISCORD_CHARS = 2000;
const MAX_GITHUB_COMMENT = 65536;

// --- Load JSON files ---
let current = {};
let previous = {};
try { current = JSON.parse(fs.readFileSync('current.json', 'utf8')); } catch { current = {}; }
try { previous = JSON.parse(fs.readFileSync('previous.json', 'utf8')); } catch { previous = {}; }

// --- Helper: detect added, removed, moved/renamed ---
function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const moved = [];
  const renamed = [];

  const prevModules = Object.keys(prev);
  const currModules = Object.keys(curr);

  // Added/removed modules
  currModules.forEach(mod => { if (!prevModules.includes(mod)) added.push(mod); });
  prevModules.forEach(mod => { if (!currModules.includes(mod)) removed.push(mod); });

  // Compare existing modules
  prevModules.forEach(mod => {
    if (curr[mod]) {
      const prevKeys = Object.keys(prev[mod]);
      const currKeys = Object.keys(curr[mod]);

      currKeys.forEach(key => {
        if (!prevKeys.includes(key)) added.push(`${key}: ${curr[mod][key]}`);
      });

      prevKeys.forEach(key => {
        if (!currKeys.includes(key)) removed.push(`${key}: ${prev[mod][key]}`);
      });

      // Detect renames (approximate match)
      prevKeys.forEach(prevKey => {
        currKeys.forEach(currKey => {
          if (prevKey !== currKey && levenshtein.get(prevKey, currKey) <= 2) {
            renamed.push(`"${prevKey}" → "${currKey}"`);
          }
        });
      });
    }
  });

  return { added, removed, renamed };
}

const { added, removed, renamed } = diffModules(previous, current);

// --- Format summary ---
let summary = [];
if (added.length) summary.push('### Added\n' + added.map(a => `+${a}`).join('\n'));
if (removed.length) summary.push('### Removed\n' + removed.map(r => `-${r}`).join('\n'));
if (renamed.length) summary.push('### Renamed\n' + renamed.map(r => `~${r}`).join('\n'));

const fullDiffText = summary.join('\n\n') || 'No changes';

// --- DISCORD POST ---
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
let discordContent = `${fullDiffText}\n\nFull commit here: ${commitUrl}`;

// Truncate to 2000 characters including commit link
if (discordContent.length > MAX_DISCORD_CHARS) {
  const allowedLength = MAX_DISCORD_CHARS - (`\n\nFull commit here: ${commitUrl}`).length;
  discordContent = `${fullDiffText.slice(0, allowedLength)}\n\nFull commit here: ${commitUrl}`;
}

// Send Discord webhook
axios.post(webhookUrl, { content: discordContent })
  .then(() => console.log("Discord webhook sent."))
  .catch(err => {
    console.error("Failed to send Discord webhook:", err.message);
    process.exit(1);
  });

// --- GITHUB COMMENT ---
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const header = `🧩 **Changes in \`discordclasses.json\`:**\n\n`;
const chunkPrefix = '';
const chunkSuffix = '';

function splitDiff(fullText, maxLength) {
  const chunks = [];
  let start = 0;
  while (start < fullText.length) {
    chunks.push(fullText.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

const rawChunks = splitDiff(fullDiffText, MAX_GITHUB_COMMENT - header.length - chunkPrefix.length - chunkSuffix.length);

(async () => {
  for (let i = 0; i < rawChunks.length; i++) {
    const partHeader = rawChunks.length > 1
      ? `${header}**Part ${i + 1} of ${rawChunks.length}**\n\n`
      : header;

    const commentBody = `${partHeader}${chunkPrefix}${rawChunks[i]}${chunkSuffix}`;

    await octokit.rest.repos.createCommitComment({
      owner: process.env.GITHUB_REPOSITORY.split('/')[0],
      repo: process.env.GITHUB_REPOSITORY.split('/')[1],
      commit_sha: process.env.GITHUB_SHA,
      body: commentBody,
    });

    console.log(`Posted GitHub comment part ${i + 1}/${rawChunks.length}`);
  }
})();
