const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

// Load JSON
const prev = JSON.parse(fs.readFileSync('previous.json'));
const curr = JSON.parse(fs.readFileSync('current.json'));

// Flatten module structure into {module, item, value}
function flatten(json) {
  const result = [];
  for (const mod in json) {
    for (const key in json[mod]) {
      result.push({module: mod, item: key, value: json[mod][key]});
    }
  }
  return result;
}

const prevFlat = flatten(prev);
const currFlat = flatten(curr);

// Detect added/removed
const added = _.differenceWith(currFlat, prevFlat, _.isEqual);
const removed = _.differenceWith(prevFlat, currFlat, _.isEqual);

// Detect moved and/or renamed
const moved = [];
const renamed = [];

for (const c of currFlat) {
  const p = prevFlat.find(pf => pf.item === c.item);
  if (p && p.module !== c.module) {
    const renameMatch = prevFlat.find(pf => pf.value === c.value && pf.item !== c.item);
    moved.push({
      item: c.item,
      fromModule: p.module,
      toModule: c.module,
      renamed: renameMatch ? c.item : null
    });
  }
  if (!p) {
    const nameMatch = prevFlat.find(pf => pf.value === c.value && pf.item !== c.item);
    if (nameMatch) renamed.push({item: nameMatch.item, to: c.item, newModule: c.module});
  }
}

// Build GitHub comment with collapsible large modules
const githubSummary = [];
const COLLAPSE_THRESHOLD = 30; // lines

const moduleChanges = {};

added.forEach(a => (moduleChanges[a.module] = moduleChanges[a.module] || []).push(`+ ${a.item}`));
removed.forEach(r => (moduleChanges[r.module] = moduleChanges[r.module] || []).push(`- ${r.item}`));
moved.forEach(m => {
  const line = m.renamed
    ? `* ${m.item} moved from module ${m.fromModule} to module ${m.toModule} (renamed)`
    : `* ${m.item} moved from module ${m.fromModule} to module ${m.toModule}`;
  moduleChanges[m.toModule] = moduleChanges[m.toModule] || [];
  moduleChanges[m.toModule].push(line);
});
renamed.forEach(r => {
  moduleChanges[r.newModule] = moduleChanges[r.newModule] || [];
  moduleChanges[r.newModule].push(`* ${r.item} renamed to "${r.to}"`);
});

for (const mod in moduleChanges) {
  const lines = moduleChanges[mod];
  if (lines.length > COLLAPSE_THRESHOLD) {
    githubSummary.push(`### Module ${mod} (${lines.length} changes, collapsed)`);
  } else {
    githubSummary.push(`### Module ${mod}\n${lines.join('\n')}`);
  }
}

fs.writeFileSync('current_diff.txt', githubSummary.join('\n\n'));

// Prepare Discord message (first 2000 chars)
const discordMessage = `**Changes in discordclasses.json:**\n` +
  '```diff\n' +
  githubSummary.join('\n') +
  '\n```\n' +
  `Full commit here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

const snippet = discordMessage.slice(0, 2000);

async function postDiscord() {
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: snippet });
    console.log('Discord webhook posted successfully!');
  } catch (e) {
    console.error('Failed to send Discord webhook:', e);
  }
}

postDiscord();
