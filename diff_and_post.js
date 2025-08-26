const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const oldFile = 'previous.json';
const newFile = 'current.json';

const oldData = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
const newData = JSON.parse(fs.readFileSync(newFile, 'utf8'));

const added = [];
const removed = [];
const moved = [];
const renamed = [];

// Compare keys in modules
for (const moduleId of new Set([...Object.keys(oldData), ...Object.keys(newData)])) {
  const oldModule = oldData[moduleId] || {};
  const newModule = newData[moduleId] || {};

  // Added keys
  for (const key of Object.keys(newModule)) {
    if (!oldModule.hasOwnProperty(key)) added.push({ key, module: moduleId });
  }

  // Removed keys
  for (const key of Object.keys(oldModule)) {
    if (!newModule.hasOwnProperty(key)) removed.push({ key, module: moduleId });
  }

  // Moved or renamed keys (if values differ)
  for (const key of Object.keys(oldModule)) {
    if (newModule.hasOwnProperty(key) && oldModule[key] !== newModule[key]) {
      renamed.push({ key, module: moduleId, old: oldModule[key], new: newModule[key] });
    }
  }

  // Detect module moves
  if (oldData[moduleId] && !newData[moduleId]) {
    moved.push({ module: moduleId, from: 'previous state', to: 'removed from new state' });
  }
}

// ---- Discord summary ----
const discordSummary = [
  added.length ? `# Added: ${added.length} items in modules ${[...new Set(added.map(a => a.module))].join(', ')}` : '',
  removed.length ? `# Removed: ${removed.length} items in modules ${[...new Set(removed.map(r => r.module))].join(', ')}` : '',
  moved.length ? `# Moved: ${moved.length} modules` : '',
  renamed.length ? `# Renamed: ${renamed.length} items` : '',
].filter(Boolean).join('\n');

if (process.env.DISCORD_WEBHOOK_URL && discordSummary) {
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordSummary })
    .then(() => console.log('Discord summary posted'))
    .catch(err => console.error(err));
}

// ---- GitHub full diff ----
let githubDiff = '';

// Added
for (const a of added) {
  githubDiff += `# Added in module ${a.module}\n\`\`\`diff\n+ "${a.key}": "${newData[a.module][a.key]}"\n\`\`\`\n\n`;
}

// Removed
for (const r of removed) {
  githubDiff += `# Removed from module ${r.module}\n\`\`\`diff\n- "${r.key}": "${oldData[r.module][r.key]}"\n\`\`\`\n\n`;
}

// Renamed
for (const n of renamed) {
  githubDiff += `# Renamed in module ${n.module}\n\`\`\`diff\n- "${n.key}": "${n.old}"\n+ "${n.key}": "${n.new}"\n\`\`\`\n\n`;
}

// Moved
for (const m of moved) {
  githubDiff += `# Moved module ${m.module}\n\`\`\`diff\n- ${JSON.stringify(oldData[m.module], null, 2)}\n+ ${JSON.stringify(newData[m.module], null, 2)}\n\`\`\`\n\n`;
}

// Write full diff for GitHub Action to post
fs.writeFileSync('full_diff.txt', githubDiff);
