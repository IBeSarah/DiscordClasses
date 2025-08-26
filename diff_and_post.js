// diff_and_post.js
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');

const MAX_GITHUB_COMMENT = 65536; // max characters per GitHub comment
const MAX_DISCORD_COMMENT = 2000; // max characters for Discord
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const COMMIT_SHA = process.env.GITHUB_SHA;
const REPO = process.env.GITHUB_REPOSITORY; // e.g., owner/repo

// Helper: read files
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Helper: generate diff in added/removed/renamed/moved format for Discord
function generateDiffForDiscord(prev, curr) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const prevModules = Object.keys(prev);
  const currModules = Object.keys(curr);

  // Added / Removed modules
  for (const key of currModules) if (!prevModules.includes(key)) added.push(key);
  for (const key of prevModules) if (!currModules.includes(key)) removed.push(key);

  // Changes inside modules
  for (const mod of currModules) {
    if (!prev[mod]) continue;
    const prevKeys = Object.keys(prev[mod]);
    const currKeys = Object.keys(curr[mod]);

    // Added / Removed keys
    for (const k of currKeys) if (!prevKeys.includes(k)) added.push(`${k} to Module ${mod}`);
    for (const k of prevKeys) if (!currKeys.includes(k)) removed.push(`${k} from Module ${mod}`);

    // Renames: simple check (if value changed)
    for (const k of currKeys) {
      if (prevKeys.includes(k) && prev[mod][k] !== curr[mod][k]) {
        renamed.push(`${k} in Module ${mod}`);
      }
    }
  }

  let discordText = '';
  if (removed.length) discordText += `### Removed\n${removed.map(r => `- ${r}`).join('\n')}\n`;
  if (added.length) discordText += `### Added\n${added.map(a => `+ ${a}`).join('\n')}\n`;
  if (renamed.length) discordText += `### Renamed\n${renamed.map(r => `~ ${r}`).join('\n')}\n`;
  if (moved.length) discordText += `### Moved\n${moved.map(m => `> ${m}`).join('\n')}\n`;

  return discordText;
}

// Helper: split text into chunks
function splitText(text, maxLen) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLen));
    start += maxLen;
  }
  return chunks;
}

(async () => {
  const prev = readJson('previous.json');
  const curr = readJson('current.json');

  // --- Discord ---
  if (DISCORD_WEBHOOK_URL) {
    const discordDiff = generateDiffForDiscord(prev, curr);
    const discordText = discordDiff + `\nFull commit here: https://github.com/${REPO}/commit/${COMMIT_SHA}`;
    const discordChunks = splitText(discordText, MAX_DISCORD_COMMENT);

    for (const chunk of discordChunks) {
      try {
        await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
      } catch (e) {
        console.error('Failed to send Discord webhook:', e.message);
      }
    }
    console.log('Discord diff posted.');
  }

  // --- GitHub ---
  if (GITHUB_TOKEN && COMMIT_SHA) {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    const fullDiff = JSON.stringify(curr, null, 2); // full JSON diff

    const githubChunks = splitText(fullDiff, MAX_GITHUB_COMMENT);

    for (let i = 0; i < githubChunks.length; i++) {
      const partHeader = githubChunks.length > 1 ? `Part ${i + 1} of ${githubChunks.length}\n\n` : '';
      const body = '```json\n' + partHeader + githubChunks[i] + '\n```';
      try {
        await octokit.repos.createCommitComment({
          owner: REPO.split('/')[0],
          repo: REPO.split('/')[1],
          commit_sha: COMMIT_SHA,
          body,
        });
        console.log(`GitHub comment part ${i + 1}/${githubChunks.length} posted.`);
      } catch (e) {
        console.error('Failed to post GitHub comment:', e.message);
      }
    }
  }
})();
