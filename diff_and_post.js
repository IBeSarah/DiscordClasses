const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
const GITHUB_SHA = process.env.GITHUB_SHA;
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_SHA}/comments`;

const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));

let discordSummary = { Added: {}, Removed: {}, Moved: {}, Renamed: {} };
let fullDiff = '';

// Helper to compare modules
function diffModules(prev, curr) {
  const allModules = _.union(Object.keys(prev), Object.keys(curr));

  allModules.forEach(mod => {
    const prevObj = prev[mod] || {};
    const currObj = curr[mod] || {};

    const prevKeys = Object.keys(prevObj);
    const currKeys = Object.keys(currObj);

    // Added items
    const added = currKeys.filter(k => !prevKeys.includes(k));
    if (added.length) discordSummary.Added[mod] = added;

    // Removed items
    const removed = prevKeys.filter(k => !currKeys.includes(k));
    if (removed.length) discordSummary.Removed[mod] = removed;

    // Renamed / Moved detection (same value, different key)
    prevKeys.forEach(pk => {
      const pv = prevObj[pk];
      // Moved: exists in another module
      const movedToModule = Object.entries(curr).find(([m, o]) => m !== mod && Object.values(o).includes(pv));
      if (movedToModule) {
        discordSummary.Moved[mod] = discordSummary.Moved[mod] || [];
        discordSummary.Moved[mod].push(`${pk} → ${movedToModule[0]}`);
      } else {
        // Renamed: key changed but value same
        const renamedKey = Object.keys(currObj).find(k => currObj[k] === pv && k !== pk);
        if (renamedKey) {
          discordSummary.Renamed[mod] = discordSummary.Renamed[mod] || [];
          discordSummary.Renamed[mod].push(`${pk} → ${renamedKey}`);
        }
      }
    });

    // Full diff for GitHub
    if (!_.isEqual(prevObj, currObj)) {
      fullDiff += `### Module ${mod}\n`;
      fullDiff += `Previous:\n${JSON.stringify(prevObj, null, 2)}\n`;
      fullDiff += `Current:\n${JSON.stringify(currObj, null, 2)}\n\n`;
    }
  });
}

diffModules(previous, current);

// --- Post to Discord ---
async function postDiscord() {
  if (!DISCORD_WEBHOOK_URL) return;

  const sections = [];
  for (const type of ['Added', 'Removed', 'Moved', 'Renamed']) {
    const mods = Object.entries(discordSummary[type]);
    if (!mods.length) continue;

    if (type === 'Moved') {
      const movedText = mods.map(([mod, items]) => items.join(', ')).join(', ');
      sections.push(`### ${type}\n${movedText}`);
    } else {
      const modsText = mods.map(([mod, items]) => `${mod}: ${items.length}`).join(', ');
      sections.push(`### ${type}\n${modsText}`);
    }
  }

  if (!sections.length) return;

  await axios.post(DISCORD_WEBHOOK_URL, {
    content: sections.join('\n\n')
  });
}

// --- Post full diff to GitHub ---
async function postGitHub() {
  if (!GITHUB_TOKEN || !fullDiff.trim()) return;

  const MAX_COMMENT_LENGTH = 65000;
  function splitText(text, maxLength) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLength));
      start += maxLength;
    }
    return chunks;
  }

  const chunks = splitText(fullDiff, MAX_COMMENT_LENGTH);

  for (let i = 0; i < chunks.length; i++) {
    const body = chunks.length > 1
      ? `**Part ${i + 1} of ${chunks.length}**\n\n${chunks[i]}`
      : chunks[i];

    await axios.post(GITHUB_API_URL, { body }, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'User-Agent': 'GitHub-Actions'
      }
    });
  }
}

// Run both
(async () => {
  await postDiscord();
  await postGitHub();
})();
