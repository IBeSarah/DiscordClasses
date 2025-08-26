const fs = require('fs');
const axios = require('axios');

const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

const fullDiff = fs.readFileSync('full_diff.txt', 'utf8');

// Parse diff to count changes per module
const moduleChanges = {};
const lines = fullDiff.split('\n');
lines.forEach(line => {
  const match = line.match(/^### (\w+) in module (\d+)/);
  if (match) {
    const type = match[1]; // Added, Removed, Renamed, Moved
    const moduleId = match[2];
    if (!moduleChanges[moduleId]) moduleChanges[moduleId] = { Added: 0, Removed: 0, Renamed: 0, Moved: 0 };
    moduleChanges[moduleId][type]++;
  }
});

// Create summary message
let summary = '';
for (const moduleId in moduleChanges) {
  const counts = moduleChanges[moduleId];
  const parts = [];
  if (counts.Added) parts.push(`Added: ${counts.Added}`);
  if (counts.Removed) parts.push(`Removed: ${counts.Removed}`);
  if (counts.Renamed) parts.push(`Renamed: ${counts.Renamed}`);
  if (counts.Moved) parts.push(`Moved: ${counts.Moved}`);
  summary += `Module ${moduleId}: ${parts.join(', ')}\n`;
}

const commitUrl = `${serverUrl}/${repo}/commit/${commitSha}`;
summary += `\nView full list of changes here: ${commitUrl}`;

// Send to Discord
axios.post(discordWebhook, {
  content: summary
})
.then(() => console.log('Discord summary posted'))
.catch(err => console.error('Error posting to Discord:', err));
