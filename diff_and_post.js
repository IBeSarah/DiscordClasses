const fs = require('fs');
const axios = require('axios');

// Environment variables
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

// Files
const prevFile = 'previous.json';
const currFile = 'current.json';
const outputFile = 'full_diff.txt';

// Helper to load JSON
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// Helper to format objects nicely
function formatValue(val) {
  if (typeof val === 'object' && val !== null) {
    return JSON.stringify(val, null, 2);
  }
  return val;
}

// Compare two JSON objects
function diffModules(prev, curr) {
  const added = {};
  const removed = {};
  const moved = {};

  // Check for removed or moved
  for (const key in prev) {
    if (!(key in curr)) {
      removed[key] = prev[key];
    } else {
      // Only mark as moved if the value itself changed (module ID changed)
      if (prev[key] !== curr[key]) {
        moved[key] = { from: prev[key], to: curr[key] };
      }
    }
  }

  // Check for added
  for (const key in curr) {
    if (!(key in prev)) {
      added[key] = curr[key];
    }
  }

  return { added, removed, moved };
}

// Build diff string
function buildDiffString(diffObj) {
  let str = '```diff\n';

  if (Object.keys(diffObj.added).length > 0) {
    str += '### Added\n';
    for (const key in diffObj.added) {
      str += `+ ${key}: ${formatValue(diffObj.added[key])}\n`;
    }
  }

  if (Object.keys(diffObj.removed).length > 0) {
    str += '### Removed\n';
    for (const key in diffObj.removed) {
      str += `- ${key}: ${formatValue(diffObj.removed[key])}\n`;
    }
  }

  if (Object.keys(diffObj.moved).length > 0) {
    str += '### Moved\n';
    for (const key in diffObj.moved) {
      str += `* ${key} moved from ${formatValue(diffObj.moved[key].from)} to ${formatValue(diffObj.moved[key].to)}\n`;
    }
  }

  str += '```';
  return str;
}

// Load JSON
const prevData = loadJson(prevFile);
const currData = loadJson(currFile);

// Generate diff
const diffObj = diffModules(prevData, currData);
const diffString = buildDiffString(diffObj);

// Save full diff for GitHub
fs.writeFileSync(outputFile, diffString, 'utf8');

// Truncate for Discord
function truncateForDiscord(text) {
  if (text.length > 1990) {
    return text.slice(0, 1990) + '\n...';
  }
  return text;
}

// Post to Discord
async function postToDiscord(content) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, { content });
    console.log('Discord webhook sent.');
  } catch (err) {
    console.error('Error posting to Discord:', err.response?.data || err.message);
  }
}

// Run
(async () => {
  await postToDiscord(truncateForDiscord(diffString));
})();
