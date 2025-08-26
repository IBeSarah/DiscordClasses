const fs = require('fs');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');

const MAX_DISCORD_CHARS = 2000;
const MAX_GITHUB_COMMENT = 65536;

// --- Read diff ---
const diff = fs.readFileSync('diff.txt', 'utf8').trim();
if (!diff) {
  console.log("No diff to post.");
  process.exit(0);
}

// --- DISCORD POST ---
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
let discordContent = `**Changes in discordclasses.json:**\n\`\`\`diff\n${diff}\n\`\`\`\nFull commit here: ${commitUrl}`;

// Truncate to 2000 chars including link
if (discordContent.length > MAX_DISCORD_CHARS) {
  const allowedDiffLength = MAX_DISCORD_CHARS - (`**Changes in discordclasses.json:**\n\`\`\`diff\n\`\`\`\nFull commit here: ${commitUrl}`).length;
  discordContent = `**Changes in discordclasses.json:**\n\`\`\`diff\n${diff.slice(0, allowedDiffLength)}\n\`\`\`\nFull commit here: ${commitUrl}`;
}

// Send Discord webhook
axios.post(webhookUrl, { content: discordContent })
  .then(() => console.log("Discord webhook sent."))
  .catch(err => {
    console.error("Failed to send Discord webhook:", err.message);
    process.exit(1);
  });

// --- GitHub COMMENT ---
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const header = `🧩 **Changes in \`discordclasses.json\`:**\n\n`;
const chunkPrefix = '```diff\n';
const chunkSuffix = '\n```';

function splitDiff(fullText, maxLength) {
  const chunks = [];
  let start = 0;
  while (start < fullText.length) {
    chunks.push(fullText.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

const rawChunks = splitDiff(diff, MAX_GITHUB_COMMENT - header.length - chunkPrefix.length - chunkSuffix.length);

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
