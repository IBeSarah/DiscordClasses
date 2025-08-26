const fs = require('fs');
const { execSync } = require('child_process');
const _ = require('lodash');
const axios = require('axios');

// Load JSON directly from Git
function loadJsonFromGit(ref = 'HEAD') {
  try {
    const raw = execSync(`git show ${ref}:discordclasses.json`, { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load discordclasses.json from ${ref}:`, err.message);
    return {};
  }
}

const previous = loadJsonFromGit('HEAD^');
const current = loadJsonFromGit('HEAD');

function getModuleDiff(prev, curr) {
  const added = {};
  const removed = {};
  const moved = {};
  const renamed = {};

  for (const moduleId of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
    const oldObj = prev[moduleId] || {};
    const newObj = curr[moduleId] || {};

    // Detect added keys
    for (const key of Object.keys(newObj)) if (!oldObj[key]) added[key] = moduleId;
    // Detect removed keys
    for (const key of Object.keys(oldObj)) if (!newObj[key]) removed[key] = moduleId;

    // Detect renamed keys (same key, different value)
    for (const key of Object.keys(newObj)) {
      if (oldObj[key] && oldObj[key] !== newObj[key]) renamed[key] = moduleId;
    }

    // Detect moved modules (only if the object changed)
    if (!_.isEqual(oldObj, newObj) && Object.keys(oldObj).length && Object.keys(newObj).length) {
      moved[moduleId] = { old: oldObj, new: newObj };
    }
  }

  return { added, removed, moved, renamed };
}

const diff = getModuleDiff(previous, current);

// --- Discord Summary ---
let discordMessage = '';
function summarize(obj, type) {
  const modules = _.uniq(Object.values(obj));
  if (modules.length) {
    discordMessage += `# ${type} ${Object.keys(obj).length} items in modules: ${modules.join(', ')}\n`;
  }
}
summarize(diff.added, 'Added');
summarize(diff.removed, 'Removed');
summarize(diff.moved, 'Moved');
summarize(diff.renamed, 'Renamed');

if (discordMessage && process.env.DISCORD_WEBHOOK_URL) {
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage })
    .then(() => console.log('Discord posted'))
    .catch(e => console.error('Discord post failed:', e.message));
}

// --- GitHub Full Diff ---
let fullDiff = '';
for (const [moduleId, val] of Object.entries(diff.moved)) {
  fullDiff += `# Moved module ${moduleId}\n`;
  fullDiff += '```diff\n';
  fullDiff += `- ${JSON.stringify(val.old, null, 2)}\n`;
  fullDiff += `+ ${JSON.stringify(val.new, null, 2)}\n`;
  fullDiff += '```\n';
}
for (const [key, moduleId] of Object.entries(diff.added)) {
  fullDiff += `# Added in module ${moduleId}\n`;
  fullDiff += '```diff\n';
  fullDiff += `+ "${key}": "${current[moduleId][key]}"\n`;
  fullDiff += '```\n';
}
for (const [key, moduleId] of Object.entries(diff.removed)) {
  fullDiff += `# Removed from module ${moduleId}\n`;
  fullDiff += '```diff\n';
  fullDiff += `- "${key}": "${previous[moduleId][key]}"\n`;
  fullDiff += '```\n';
}
for (const [key, moduleId] of Object.entries(diff.renamed)) {
  fullDiff += `# Renamed in module ${moduleId}\n`;
  fullDiff += '```diff\n';
  fullDiff += `- "${key}": "${previous[moduleId][key]}"\n`;
  fullDiff += `+ "${key}": "${current[moduleId][key]}"\n`;
  fullDiff += '```\n';
}

fs.writeFileSync('full_diff.txt', fullDiff);
console.log('Full diff written to full_diff.txt');
