const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

// Load current and previous JSON
const current = JSON.parse(fs.readFileSync('current.json', 'utf8') || '{}');
const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8') || '{}');

const added = [];
const removed = [];
const moved = [];
const renamed = [];

// Helper: deep diff of modules
function diffModules(prev, curr) {
  const allModules = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  allModules.forEach(mod => {
    const prevItems = prev[mod] || {};
    const currItems = curr[mod] || {};

    // Check added and removed keys
    Object.keys(currItems).forEach(key => {
      if (!(key in prevItems)) added.push({ key, module: mod });
    });

    Object.keys(prevItems).forEach(key => {
      if (!(key in currItems)) removed.push({ key, module: mod });
    });

    // Check renamed keys by Levenshtein similarity (optional)
    Object.keys(currItems).forEach(currKey => {
      Object.keys(prevItems).forEach(prevKey => {
        if (
          currKey !== prevKey &&
          currItems[currKey] === prevItems[prevKey] &&
          levenshtein.get(currKey, prevKey) < 5 // tweak threshold
        ) {
          renamed.push({ oldKey: prevKey, newKey: currKey, newModule: mod });
        }
      });
    });
  });

  // Check moved modules
  Object.keys(prev).forEach(prevMod => {
    if (curr[prevMod] && !_.isEqual(prev[prevMod], curr[prevMod])) {
      moved.push({ from: prevMod, to: prevMod });
    }
  });
}

// Run diff
diffModules(previous, current);

// ---------------- Discord Summary ----------------
function groupByModule(items, keyName) {
  const groups = {};
  for (const item of items) {
    const moduleId = item[keyName];
    if (!groups[moduleId]) groups[moduleId] = 0;
    groups[moduleId]++;
  }
  return groups;
}

function discordSummary() {
  const lines = [];

  if (added.length) {
    const addedByModule = groupByModule(added, 'module');
    lines.push('### Added');
    for (const [mod, count] of Object.entries(addedByModule)) {
      lines.push(`+ ${count} item(s) in module ${mod}`);
    }
  }

  if (removed.length) {
    const removedByModule = groupByModule(removed, 'module');
    lines.push('### Removed');
    for (const [mod, count] of Object.entries(removedByModule)) {
      lines.push(`- ${count} item(s) in module ${mod}`);
    }
  }

  if (renamed.length) {
    const renamedByModule = groupByModule(renamed, 'newModule');
    lines.push('### Renamed');
    for (const [mod, count] of Object.entries(renamedByModule)) {
      lines.push(`* ${count} item(s) in module ${mod}`);
    }
  }

  if (moved.length) {
    const movedByModule = {};
    for (const item of moved) {
      const key = `${item.from} -> ${item.to}`;
      movedByModule[key] = (movedByModule[key] || 0) + 1;
    }
    lines.push('### Moved');
    for (const [modPair, count] of Object.entries(movedByModule)) {
      lines.push(`* ${count} item(s) moved from module ${modPair}`);
    }
  }

  return lines.join('\n') || 'No changes';
}

// ---------------- GitHub Full Diff ----------------
function fullDiff() {
  const lines = [];

  if (added.length) {
    lines.push('### Added');
    added.forEach(a => {
      lines.push(`+ ${JSON.stringify({ [a.key]: current[a.module][a.key] })} in module ${a.module}`);
    });
  }

  if (removed.length) {
    lines.push('### Removed');
    removed.forEach(r => {
      lines.push(`- ${JSON.stringify({ [r.key]: previous[r.module][r.key] })} in module ${r.module}`);
    });
  }

  if (renamed.length) {
    lines.push('### Renamed');
    renamed.forEach(r => {
      lines.push(`* ${r.oldKey} -> ${r.newKey} in module ${r.newModule}`);
    });
  }

  if (moved.length) {
    lines.push('### Moved');
    moved.forEach(m => {
      lines.push(`* Module ${m.from} changed from previous state to current state`);
    });
  }

  return lines.join('\n') || 'No changes';
}

// Write full diff for GitHub
fs.writeFileSync('full_diff.txt', fullDiff(), 'utf8');

// Post Discord
async function postToDiscord() {
  if (!process.env.DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      content: '```diff\n' + discordSummary() + '\n```',
    });
    console.log('Discord summary posted');
  } catch (err) {
    console.error('Error posting to Discord:', err);
  }
}

postToDiscord();
