const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_SHA = process.env.GITHUB_SHA;
const GITHUB_REPO = process.env.GITHUB_REPOSITORY;
const GITHUB_SERVER_URL = process.env.GITHUB_SERVER_URL;

const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));
const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));

function diffModules(prev, curr) {
  const added = [];
  const removed = [];
  const moved = [];
  const renamed = [];

  // Check added and renamed/moved
  for (const mod in curr) {
    if (!prev[mod]) {
      added.push({ module: mod, items: curr[mod] });
      continue;
    }
    const prevItems = prev[mod];
    const currItems = curr[mod];

    for (const key in currItems) {
      if (!prevItems[key]) {
        // Try to detect renames
        const match = Object.keys(prevItems).find(
          k => levenshtein.get(k, key) <= 3 && prevItems[k] === currItems[key]
        );
        if (match) {
          renamed.push({
            item: match,
            to: key,
            fromModule: mod,
            oldModule: Object.keys(prev).find(m => prev[m][match] !== undefined)
          });
        } else {
          added.push({ module: mod, item: key });
        }
      }
    }
  }

  // Check removed
  for (const mod in prev) {
    if (!curr[mod]) {
      removed.push({ module: mod, items: prev[mod] });
      continue;
    }
    const prevItems = prev[mod];
    const currItems = curr[mod];
    for (const key in prevItems) {
      if (!currItems[key]) removed.push({ module: mod, item: key });
    }
  }

  // Detect moves without rename
  for (const r of renamed) {
    if (r.oldModule !== r.fromModule) moved.push(r);
  }

  return { added, removed, moved, renamed };
}

const diff = diffModules(previous, current);

// Build Discord message
let message = '**Changes in discordclasses.json:**\n```diff\n';

// Add summary
const summary = [];

diff.added.forEach(a => summary.push(`+ ${a.item || Object.keys(a.items).join(', ')} (module ${a.module})`));
diff.removed.forEach(r => summary.push(`- ${r.item || Object.keys(r.items).join(', ')} (module ${r.module})`));
diff.moved.forEach(m => summary.push(`* ${m.item} from module ${m.oldModule} to module ${m.fromModule} (renamed to "${m.to}")`));
diff.renamed.forEach(r => {
  if (!diff.moved.includes(r)) summary.push(`* ${r.item} renamed to "${r.to}" in module ${r.fromModule}`);
});

message += summary.join('\n');

// Add full commit link at end (truncate Discord message to 2000 chars)
const commitUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPO}/commit/${GITHUB_SHA}`;
let finalMessage = message.slice(0, 1990) + `\n\nFull commit changes here: ${commitUrl}\n\`\`\``;

axios.post(DISCORD_WEBHOOK_URL, { content: finalMessage })
  .then(() => console.log('Discord message sent!'))
  .catch(e => console.error('Failed to send Discord webhook:', e));

// Also save full diff to file for GitHub comment
fs.writeFileSync('current_diff.txt', message);
