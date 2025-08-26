const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');

// Load JSON files
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));
const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));

// Utility functions
function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const moved = [];
  const renamed = [];

  for (const [mod, items] of Object.entries(curr)) {
    if (!prev[mod]) {
      added.push({ mod, items });
    } else {
      for (const [key, val] of Object.entries(items)) {
        if (!prev[mod][key]) added.push({ mod, key, val });
        else if (prev[mod][key] !== val) renamed.push({ mod, key, old: prev[mod][key], new: val });
      }
    }
  }

  for (const [mod, items] of Object.entries(prev)) {
    if (!curr[mod]) removed.push({ mod, items });
    else {
      for (const [key, val] of Object.entries(items)) {
        if (!curr[mod][key]) removed.push({ mod, key, val });
      }
    }
  }

  // Detect moved items
  for (const r of removed.slice()) {
    if (r.key && curr[r.mod]?.[r.key]) {
      moved.push({ key: r.key, val: curr[r.mod][r.key], from: r.mod, to: r.mod });
      removed.splice(removed.indexOf(r), 1);
    }
  }

  return { added, removed, moved, renamed };
}

// Wrap module sections for GitHub
function wrapModule(title, lines) {
  if (lines.length > 30) {
    return `<details><summary>${title} (${lines.length} lines)</summary>\n\n${lines.join('\n')}\n</details>`;
  }
  return `### ${title}\n` + lines.join('\n');
}

const { added, removed, moved, renamed } = diffModules(previous, current);

const summary = [];

// Build sections
if (added.length) {
  const lines = added.map(a => a.key ? `+${a.key}: ${a.val}` : `+${JSON.stringify(a.items)}`);
  summary.push(wrapModule('Added', lines));
}

if (removed.length) {
  const lines = removed.map(r => r.key ? `-${r.key}: ${r.val}` : `-${JSON.stringify(r.items)}`);
  summary.push(wrapModule('Removed', lines));
}

if (moved.length) {
  const lines = moved.map(m => `+${m.key}: ${m.val} from module ${m.from} to module ${m.to}`);
  summary.push(wrapModule('Moved', lines));
}

if (renamed.length) {
  const lines = renamed.map(r => `+${r.key}: ${r.new} (was ${r.old}) in module ${r.mod}`);
  summary.push(wrapModule('Renamed', lines));
}

const fullSummary = summary.join('\n\n') || 'No changes detected.';
fs.writeFileSync('current_diff.txt', fullSummary, 'utf8');

// Post to Discord (first 2000 chars + commit link)
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

const discordMessage = fullSummary.substring(0, 1990) + `\n\nFull commit changes: ${commitUrl}`;

(async () => {
  try {
    await axios.post(webhookUrl, { content: discordMessage });
    console.log('Discord webhook sent successfully.');
  } catch (e) {
    console.error('Failed to send Discord webhook:', e);
  }
})();
