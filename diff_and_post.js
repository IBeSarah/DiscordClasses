const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const MAX_DISCORD_LENGTH = 2000;

// Flatten modules into {item: module} mapping for fast lookup
function flattenModules(obj) {
  const map = {};
  Object.entries(obj).forEach(([mod, items]) => {
    Object.entries(items || {}).forEach(([key, value]) => {
      map[`${key}: ${value}`] = mod;
    });
  });
  return map;
}

const prevFlat = flattenModules(prev);
const currFlat = flattenModules(curr);

const prevItems = Object.keys(prevFlat);
const currItems = Object.keys(currFlat);

// Detect added, removed
let added = _.difference(currItems, prevItems);
let removed = _.difference(prevItems, currItems);

// Detect renames
const renames = [];
const unmatchedAdded = new Set(added);

removed.forEach(rem => {
  let bestMatch = null;
  let bestDist = Infinity;
  unmatchedAdded.forEach(add => {
    const dist = levenshtein.get(rem, add);
    if (dist < bestDist && dist <= Math.max(rem.length, add.length) * 0.4) {
      bestDist = dist;
      bestMatch = add;
    }
  });
  if (bestMatch) {
    renames.push({ from: rem, to: bestMatch });
    unmatchedAdded.delete(bestMatch);
  }
});

removed = removed.filter(r => !renames.some(rn => rn.from === r));
added = Array.from(unmatchedAdded);

// Detect moves
const moves = [];
renames.forEach(r => {
  const fromMod = prevFlat[r.from];
  const toMod = currFlat[r.to];
  if (fromMod !== toMod) {
    moves.push({ item: r.to, from: fromMod, to: toMod });
  }
});

// Prepare Discord message
let diffText = '';
if (added.length) diffText += '### Added\n' + added.map(a => `+${a}`).join('\n') + '\n';
if (removed.length) diffText += '### Removed\n' + removed.map(r => `-${r}`).join('\n') + '\n';
if (renames.length) diffText += '### Renamed\n' + renames.map(r => `-${r.from}\n+${r.to}`).join('\n') + '\n';
if (moves.length) diffText += '### Moved & Renamed\n' + moves.map(m => `+${m.item} from module ${m.from} to module ${m.to}`).join('\n') + '\n';

// Save for GitHub
fs.writeFileSync('current_diff.txt', diffText, 'utf8');

// Post to Discord (first 2000 chars)
if (diffText.trim()) {
  const webhookContent = (diffText.length > MAX_DISCORD_LENGTH - 50
    ? diffText.slice(0, MAX_DISCORD_LENGTH - 50)
    : diffText) + `\nFull commit changes: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

  axios.post(process.env.DISCORD_WEBHOOK_URL, { content: webhookContent })
    .then(() => console.log('Posted to Discord webhook'))
    .catch(err => console.error('Failed to send Discord webhook:', err.message));
} else {
  console.log('No changes to post');
}
