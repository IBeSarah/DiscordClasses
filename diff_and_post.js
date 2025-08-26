const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

// Environment
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;

// Load JSON
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const prev = loadJson('previous.json');
const curr = loadJson('current.json');

// Output arrays
let discordOutput = [];
let githubOutput = [];

// Compare keys
const allModules = _.union(Object.keys(prev), Object.keys(curr));

allModules.forEach(mod => {
  const prevKeys = prev[mod] || {};
  const currKeys = curr[mod] || {};

  // Added
  const addedKeys = _.difference(Object.keys(currKeys), Object.keys(prevKeys));
  if (addedKeys.length) {
    const line = `### Added\n${addedKeys.map(k => `+ ${k}`).join('\n')}`;
    discordOutput.push(line);
    githubOutput.push(line);
  }

  // Removed
  const removedKeys = _.difference(Object.keys(prevKeys), Object.keys(currKeys));
  if (removedKeys.length) {
    const line = `### Removed\n${removedKeys.map(k => `- ${k}`).join('\n')}`;
    discordOutput.push(line);
    githubOutput.push(line);
  }

  // Renamed (simple heuristic: key exists but value changed)
  const renamedKeys = Object.keys(prevKeys).filter(k => currKeys[k] && currKeys[k] !== prevKeys[k]);
  if (renamedKeys.length) {
    const line = `### Renamed\n${renamedKeys.map(k => `* ${k}: ${prevKeys[k]} → ${currKeys[k]}`).join('\n')}`;
    discordOutput.push(line);
    githubOutput.push(line);
  }

  // Moved module
  if (prev[mod] && curr[mod] && !_.isEqual(prev[mod], curr[mod])) {
    const line = `### Moved\nModule ${mod} changed`;
    discordOutput.push(line);
    githubOutput.push(`Module ${mod} moved from previous state to current state`);
  }
});

// Final text
const discordText = '```diff\n' + discordOutput.join('\n') + '\n```';
const githubText = githubOutput.join('\n');

// Write full_diff.txt for GitHub action
fs.writeFileSync('full_diff.txt', githubText);

// Post to Discord
async function postToDiscord() {
  if (!webhookUrl || !discordText.trim()) return;
  try {
    await axios.post(webhookUrl, { content: discordText });
    console.log("Discord posted successfully");
  } catch (e) {
    console.error("Discord post failed:", e.message);
  }
}

postToDiscord();
