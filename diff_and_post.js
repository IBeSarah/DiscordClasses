const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const prevFile = 'previous.json';
const currFile = 'current.json';
const fullDiffFile = 'full_diff.txt';

function parseJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const prev = parseJson(prevFile);
const curr = parseJson(currFile);

let discordSummary = [];
let fullDiff = [];

function diffModules(prev, curr) {
  const allModules = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  allModules.forEach(module => {
    const prevItems = prev[module] || {};
    const currItems = curr[module] || {};

    const added = [];
    const removed = [];
    const renamed = [];
    const moved = [];

    // Added & Removed
    for (let key of Object.keys(currItems)) {
      if (!(key in prevItems)) added.push(key);
    }
    for (let key of Object.keys(prevItems)) {
      if (!(key in currItems)) removed.push(key);
    }

    // Renamed detection
    Object.keys(currItems).forEach(currKey => {
      if (currKey in prevItems) return; // skip same key
      for (let prevKey of Object.keys(prevItems)) {
        if (removed.includes(prevKey)) {
          const distance = levenshtein.get(prevItems[prevKey], currItems[currKey]);
          if (distance <= Math.max(prevItems[prevKey].length, currItems[currKey].length) * 0.3) {
            renamed.push({ from: prevKey, to: currKey });
            _.remove(removed, r => r === prevKey);
            _.remove(added, a => a === currKey);
          }
        }
      }
    });

    // Only add sections if there’s something
    if (added.length) {
      discordSummary.push(`Module ${module}: Added: ${added.length}`);
      fullDiff.push(`### Added in module ${module}\n\`\`\`diff\n${added.map(k => `+ "${k}": "${currItems[k]}"`).join('\n')}\n\`\`\``);
    }
    if (removed.length) {
      discordSummary.push(`Module ${module}: Removed: ${removed.length}`);
      fullDiff.push(`### Removed from module ${module}\n\`\`\`diff\n${removed.map(k => `- "${k}": "${prevItems[k]}"`).join('\n')}\n\`\`\``);
    }
    if (renamed.length) {
      discordSummary.push(`Module ${module}: Renamed: ${renamed.length}`);
      fullDiff.push(`### Renamed in module ${module}\n\`\`\`diff\n${renamed.map(r => `- "${r.from}": "${prevItems[r.from]}"\n+ "${r.to}": "${currItems[r.to]}"`).join('\n')}\n\`\`\``);
    }
  });
}

diffModules(prev, curr);

// Write full diff file
fs.writeFileSync(fullDiffFile, fullDiff.join('\n\n'), 'utf8');

// Post to Discord
(async () => {
  if (!discordSummary.length) return console.log('No changes to post to Discord');

  const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  const discordBody = discordSummary.join('\n') + `\n\nView full list of changes here: ${commitUrl}`;

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordBody });
    console.log('Posted to Discord');
  } catch (e) {
    console.error('Discord post failed:', e.message);
  }
})();
