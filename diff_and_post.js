const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const oldFile = 'previous.json';
const newFile = 'current.json';

if (!fs.existsSync(oldFile) || !fs.existsSync(newFile)) {
  console.error('Missing old.json or new.json for diffing');
  process.exit(1);
}

const oldData = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
const newData = JSON.parse(fs.readFileSync(newFile, 'utf8'));

// Prepare arrays to collect changes
const addedItems = [];
const removedItems = [];
const renamedItems = [];
const movedItems = [];

// Helper to compare module contents
function diffModules(oldModules, newModules) {
  const allKeys = new Set([...Object.keys(oldModules), ...Object.keys(newModules)]);

  allKeys.forEach(module => {
    const oldModule = oldModules[module] || {};
    const newModule = newModules[module] || {};

    // Added keys
    Object.keys(newModule).forEach(key => {
      if (!oldModule[key]) {
        addedItems.push({ key, module });
      }
    });

    // Removed keys
    Object.keys(oldModule).forEach(key => {
      if (!newModule[key]) {
        removedItems.push({ key, module });
      }
    });

    // Renamed keys (simplistic: same value, different key, not present in added/removed)
    Object.keys(newModule).forEach(key => {
      if (!oldModule[key]) {
        Object.entries(oldModule).forEach(([oldKey, val]) => {
          if (val === newModule[key] && key !== oldKey) {
            renamedItems.push({ oldKey, newKey: key, module });
          }
        });
      }
    });

    // Moved modules (if module object moved to another key in newData)
    if (oldModules[module] && newModules[module] === undefined) {
      Object.entries(newModules).forEach(([newModuleKey, val]) => {
        if (_.isEqual(val, oldModules[module])) {
          movedItems.push({ from: module, to: newModuleKey });
        }
      });
    }
  });
}

// Run diff
diffModules(oldData, newData);

// ----------------------
// Discord summary
// ----------------------
const discordSummary = [];

if (addedItems.length) {
  const modules = [...new Set(addedItems.map(i => i.module))].join(', ');
  discordSummary.push(`### Added\n${addedItems.length} items in modules: ${modules}`);
}

if (removedItems.length) {
  const modules = [...new Set(removedItems.map(i => i.module))].join(', ');
  discordSummary.push(`### Removed\n${removedItems.length} items in modules: ${modules}`);
}

if (renamedItems.length) {
  const modules = [...new Set(renamedItems.map(i => i.module))].join(', ');
  discordSummary.push(`### Renamed\n${renamedItems.length} items in modules: ${modules}`);
}

if (movedItems.length) {
  const moves = movedItems.map(m => `- Module ${m.from} → Module ${m.to}`).join('\n');
  discordSummary.push(`### Moved\n${movedItems.length} items:\n${moves}`);
}

async function postToDiscord(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    console.error('Missing DISCORD_WEBHOOK_URL');
    return;
  }
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: message });
    console.log('Discord summary posted');
  } catch (err) {
    console.error('Error posting to Discord:', err.message);
  }
}

// ----------------------
// GitHub full diff
// ----------------------
const fullDiff = [];

// Added items
addedItems.forEach(i => {
  fullDiff.push(`### Added in module ${i.module}\n+ "${i.key}": "${newData[i.module][i.key]}"`);
});

// Removed items
removedItems.forEach(i => {
  fullDiff.push(`### Removed from module ${i.module}\n- "${i.key}": "${oldData[i.module][i.key]}"`);
});

// Renamed items
renamedItems.forEach(i => {
  fullDiff.push(`### Renamed in module ${i.module}\n- "${i.oldKey}" → "${i.newKey}"`);
});

// Moved modules
movedItems.forEach(i => {
  fullDiff.push(`### Moved\nModule ${i.from} → Module ${i.to}`);
});

// Write full diff to file
fs.writeFileSync('full_diff.txt', fullDiff.join('\n\n'), 'utf8');

// Post Discord summary
postToDiscord(discordSummary.join('\n\n'));
