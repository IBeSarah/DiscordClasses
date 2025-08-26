const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));

let discordMessage = '';
let githubDiff = '```diff\n';

// Helper to get affected modules and count of keys
function summarizeDiff(diffType, obj) {
  const moduleIds = Object.keys(obj);
  const totalItems = moduleIds.reduce((sum, id) => sum + (_.isObject(obj[id]) ? Object.keys(obj[id]).length : 1), 0);
  return `${diffType} ${totalItems} item(s) in module(s) ${moduleIds.join(', ')}`;
}

// Added
const addedModules = _.omitBy(current, (v, k) => previous[k]);
if (!_.isEmpty(addedModules)) {
  discordMessage += '### Added\n' + summarizeDiff('Added', addedModules) + '\n';
  githubDiff += '### Added\n' + JSON.stringify(addedModules, null, 2) + '\n';
}

// Removed
const removedModules = _.omitBy(previous, (v, k) => current[k]);
if (!_.isEmpty(removedModules)) {
  discordMessage += '### Removed\n' + summarizeDiff('Removed', removedModules) + '\n';
  githubDiff += '### Removed\n' + JSON.stringify(removedModules, null, 2) + '\n';
}

// Moved
const movedModules = {};
Object.keys(previous).forEach(moduleId => {
  if (current[moduleId] && !_.isEqual(current[moduleId], previous[moduleId])) {
    movedModules[moduleId] = { from: previous[moduleId], to: current[moduleId] };
  }
});
if (!_.isEmpty(movedModules)) {
  discordMessage += '### Moved\n' + summarizeDiff('Moved', movedModules) + '\n';
  githubDiff += '### Moved\n';
  Object.entries(movedModules).forEach(([moduleId, { from, to }]) => {
    githubDiff += `Module ${moduleId} moved from:\n${JSON.stringify(from, null, 2)}\nto:\n${JSON.stringify(to, null, 2)}\n`;
  });
}

// TODO: Add similar logic for Renamed if needed

githubDiff += '```';

// Save GitHub diff
fs.writeFileSync('full_diff.txt', githubDiff);

// Post to Discord
if (discordMessage) {
  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage }).catch(console.error);
}
