const fs = require('fs');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const added = {};
const removed = {};
const renamed = {};
const moved = {};

// Compare modules
for (const moduleId of new Set([...Object.keys(previous), ...Object.keys(current)])) {
  const prevModule = previous[moduleId] || {};
  const currModule = current[moduleId] || {};

  // Detect Added / Removed keys
  const addedKeys = Object.keys(currModule).filter(k => !(k in prevModule));
  const removedKeys = Object.keys(prevModule).filter(k => !(k in currModule));

  if (addedKeys.length) added[moduleId] = addedKeys;
  if (removedKeys.length) removed[moduleId] = removedKeys;

  // Detect Renamed (simple heuristic: same value changed)
  for (const key of Object.keys(prevModule)) {
    if (key in currModule && prevModule[key] !== currModule[key]) {
      if (!renamed[moduleId]) renamed[moduleId] = [];
      renamed[moduleId].push({ old: prevModule[key], new: currModule[key], key });
    }
  }

  // Detect Moved modules (only if the entire object changed)
  if (JSON.stringify(prevModule) !== JSON.stringify(currModule)) {
    moved[moduleId] = { from: prevModule, to: currModule };
  }
}

// Write full diff for GitHub comments
let fullDiff = '';
for (const [moduleId, keys] of Object.entries(added)) {
  fullDiff += `### Added in module ${moduleId}\n\`\`\`diff\n`;
  for (const key of keys) fullDiff += `+ "${key}": "${current[moduleId][key]}"\n`;
  fullDiff += '```\n';
}
for (const [moduleId, keys] of Object.entries(removed)) {
  fullDiff += `### Removed from module ${moduleId}\n\`\`\`diff\n`;
  for (const key of keys) fullDiff += `- "${key}": "${previous[moduleId][key]}"\n`;
  fullDiff += '```\n';
}
for (const [moduleId, changes] of Object.entries(renamed)) {
  fullDiff += `### Renamed in module ${moduleId}\n\`\`\`diff\n`;
  for (const { old, new: n, key } of changes) {
    fullDiff += `- "${key}": "${old}"\n+ "${key}": "${n}"\n`;
  }
  fullDiff += '```\n';
}
for (const [moduleId, data] of Object.entries(moved)) {
  if (Object.keys(data.from).length === 0 && Object.keys(data.to).length === 0) continue;
  fullDiff += `### Moved module ${moduleId}\n\`\`\`diff\n`;
  fullDiff += `From: ${JSON.stringify(data.from, null, 2)}\nTo:   ${JSON.stringify(data.to, null, 2)}\n`;
  fullDiff += '```\n';
}

fs.writeFileSync('full_diff.txt', fullDiff);

// Post summary to Discord
const discordSummary = [];
for (const moduleId of new Set([...Object.keys(previous), ...Object.keys(current)])) {
  const a = added[moduleId]?.length || 0;
  const r = removed[moduleId]?.length || 0;
  const rn = renamed[moduleId]?.length || 0;
  const m = moved[moduleId] ? 1 : 0;
  if (a + r + rn + m === 0) continue;
  discordSummary.push(`Module ${moduleId}: Added: ${a}, Removed: ${r}, Renamed: ${rn}, Moved: ${m}`);
}

if (discordSummary.length) {
  const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: discordSummary.join('\n') + `\n\nView full list of changes here: ${commitUrl}`
  }).catch(err => console.error('Discord post failed:', err.message));
}
