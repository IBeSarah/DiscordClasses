const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const current = JSON.parse(fs.readFileSync('current.json'));
const previous = JSON.parse(fs.readFileSync('previous.json'));

const fullDiff = [];
const summary = [];

function diffModule(oldModule, newModule, moduleName) {
  const added = [];
  const removed = [];
  const renamed = [];
  const moved = [];

  const oldKeys = Object.keys(oldModule);
  const newKeys = Object.keys(newModule);

  // Added
  newKeys.forEach(key => {
    if (!oldKeys.includes(key)) added.push(key);
  });

  // Removed
  oldKeys.forEach(key => {
    if (!newKeys.includes(key)) removed.push(key);
  });

  // Renamed (same values different keys)
  oldKeys.forEach(ok => {
    newKeys.forEach(nk => {
      if (oldModule[ok] === newModule[nk] && ok !== nk) renamed.push([ok, nk]);
    });
  });

  // Moved: keys exist in both but value changed
  oldKeys.forEach(k => {
    if (newModule[k] && oldModule[k] !== newModule[k]) moved.push(k);
  });

  // Build full diff text for GitHub
  if (added.length) {
    fullDiff.push(`### Added in module ${moduleName}\n\`\`\`diff`);
    added.forEach(k => fullDiff.push(`+ "${k}": "${newModule[k]}"`));
    fullDiff.push('```');
  }
  if (removed.length) {
    fullDiff.push(`### Removed from module ${moduleName}\n\`\`\`diff`);
    removed.forEach(k => fullDiff.push(`- "${k}": "${oldModule[k]}"`));
    fullDiff.push('```');
  }
  if (renamed.length) {
    fullDiff.push(`### Renamed in module ${moduleName}\n\`\`\`diff`);
    renamed.forEach(([oldKey, newKey]) => {
      fullDiff.push(`- "${oldKey}": "${oldModule[oldKey]}"`);
      fullDiff.push(`+ "${newKey}": "${newModule[newKey]}"`);
    });
    fullDiff.push('```');
  }
  if (moved.length) {
    fullDiff.push(`### Moved in module ${moduleName}\n\`\`\`diff`);
    moved.forEach(k => {
      fullDiff.push(`- "${k}": "${oldModule[k]}"`);
      fullDiff.push(`+ "${k}": "${newModule[k]}"`);
    });
    fullDiff.push('```');
  }

  // Discord summary
  const summaryParts = [];
  if (added.length) summaryParts.push(`Added: ${added.length}`);
  if (removed.length) summaryParts.push(`Removed: ${removed.length}`);
  if (renamed.length) summaryParts.push(`Renamed: ${renamed.length}`);
  if (moved.length) summaryParts.push(`Moved: ${moved.length}`);

  if (summaryParts.length) {
    summary.push(`Module ${moduleName}: ${summaryParts.join(', ')}`);
  }
}

// Compare all modules
const allModules = _.union(Object.keys(previous), Object.keys(current));
allModules.forEach(moduleName => {
  diffModule(previous[moduleName] || {}, current[moduleName] || {}, moduleName);
});

// Write full diff for GitHub comment
fs.writeFileSync('full_diff.txt', fullDiff.join('\n'));

// Discord summary
if (process.argv[2] === 'summary') {
  const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
  const discordText = summary.join('\n') + `\n\nView full list of changes here: ${commitUrl}`;

  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordText })
    .then(() => console.log('Discord post successful'))
    .catch(err => console.error('Discord post failed:', err.response?.data || err));
}
