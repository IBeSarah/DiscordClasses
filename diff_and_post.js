const fs = require('fs');
const { execSync } = require('child_process');
const _ = require('lodash');
const axios = require('axios');

// Load JSON from Git
function loadJson(ref = 'HEAD') {
  try {
    const raw = execSync(`git show ${ref}:discordclasses.json`, { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load discordclasses.json from ${ref}:`, err.message);
    return {};
  }
}

const previous = loadJson('HEAD^');
const current = loadJson('HEAD');

function getModuleDiff(prev, curr) {
  const added = {};
  const removed = {};
  const moved = {};
  const renamed = {};

  const allModules = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  allModules.forEach(moduleId => {
    const oldObj = prev[moduleId] || {};
    const newObj = curr[moduleId] || {};

    const moduleAdded = {};
    const moduleRemoved = {};
    const moduleRenamed = {};

    // Added keys
    Object.keys(newObj).forEach(key => {
      if (!oldObj.hasOwnProperty(key)) moduleAdded[key] = newObj[key];
      else if (oldObj[key] !== newObj[key]) moduleRenamed[key] = { old: oldObj[key], new: newObj[key] };
    });

    // Removed keys
    Object.keys(oldObj).forEach(key => {
      if (!newObj.hasOwnProperty(key)) moduleRemoved[key] = oldObj[key];
    });

    if (!_.isEqual(oldObj, newObj)) {
      moved[moduleId] = { old: oldObj, new: newObj, added: moduleAdded, removed: moduleRemoved, renamed: moduleRenamed };
    }

    // Collect per-module added/removed/renamed globally
    Object.assign(added, Object.fromEntries(Object.keys(moduleAdded).map(k => [k, moduleId])));
    Object.assign(removed, Object.fromEntries(Object.keys(moduleRemoved).map(k => [k, moduleId])));
    Object.assign(renamed, Object.fromEntries(Object.keys(moduleRenamed).map(k => [k, moduleId])));
  });

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

  if (Object.keys(val.added).length) {
    fullDiff += `# Added in module ${moduleId}\n\`\`\`diff\n`;
    for (const [key, value] of Object.entries(val.added)) {
      fullDiff += `+ "${key}": "${value}"\n`;
    }
    fullDiff += '```\n';
  }

  if (Object.keys(val.removed).length) {
    fullDiff += `# Removed from module ${moduleId}\n\`\`\`diff\n`;
    for (const [key, value] of Object.entries(val.removed)) {
      fullDiff += `- "${key}": "${value}"\n`;
    }
    fullDiff += '```\n';
  }

  if (Object.keys(val.renamed).length) {
    fullDiff += `# Renamed in module ${moduleId}\n\`\`\`diff\n`;
    for (const [key, { old, new: newVal }] of Object.entries(val.renamed)) {
      fullDiff += `- "${key}": "${old}"\n+ "${key}": "${newVal}"\n`;
    }
    fullDiff += '```\n';
  }
}

fs.writeFileSync('full_diff.txt', fullDiff);
console.log('Full diff written to full_diff.txt');
