const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const MAX_DISCORD = 2000;

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

function moduleItems(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([k,v]) => `${k}: ${v}`);
}

function detectRenames(removed, added) {
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
  const newRemoved = removed.filter(r => !renames.some(x => x.from === r));
  const newAdded = Array.from(unmatchedAdded);
  return { renames, newRemoved, newAdded };
}

function detectMoves(prevObj, currObj) {
  const moves = [];
  const prevFlat = {};
  Object.entries(prevObj).forEach(([mod, obj]) => { prevFlat[mod] = moduleItems(obj); });
  const currFlat = {};
  Object.entries(currObj).forEach(([mod, obj]) => { currFlat[mod] = moduleItems(obj); });

  Object.entries(prevFlat).forEach(([fromMod, items]) => {
    items.forEach(item => {
      Object.entries(currFlat).forEach(([toMod, currItems]) => {
        if (fromMod !== toMod && currItems.includes(item)) {
          moves.push({ item, from: fromMod, to: toMod });
          currFlat[toMod] = currItems.filter(x => x !== item);
          prevFlat[fromMod] = prevFlat[fromMod].filter(x => x !== item);
        }
      });
    });
  });

  return moves;
}

function compareModules(prevObj, currObj) {
  const sections = [];
  const summary = [];
  const allModules = _.union(Object.keys(prevObj), Object.keys(currObj));
  const moves = detectMoves(prevObj, currObj);

  allModules.forEach(mod => {
    let prevItems = moduleItems(prevObj[mod]);
    let currItems = moduleItems(currObj[mod]);

    const movedFromThis = moves.filter(m => m.from === mod);
    const movedToThis = moves.filter(m => m.to === mod);

    prevItems = prevItems.filter(x => !movedFromThis.some(m => m.item === x));
    currItems = currItems.filter(x => !movedToThis.some(m => m.item === x));

    let removed = _.difference(prevItems, currItems);
    let added = _.difference(currItems, prevItems);

    const { renames, newRemoved, newAdded } = detectRenames(removed, added);
    removed = newRemoved;
    added = newAdded;

    const totalRenamed = renames.length;

    if (removed.length || added.length || totalRenamed || movedFromThis.length) {
      const movedSummary = movedFromThis.map(m => {
        const rename = renames.find(r => r.from === m.item);
        if (rename) return `"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")`;
        return `"${m.item}" → from module ${m.from} to module ${m.to}`;
      }).join(', ');

      summary.push(`- ${mod}: +${added.length} / -${removed.length} / ~${totalRenamed} / moved: ${movedSummary || 'none'}`);

      let section = '```diff\n';
      if (removed.length) { section += '### Removed\n'; removed.forEach(it => section += `-"${it}"\n`); }
      if (added.length) { section += '### Added\n'; added.forEach(it => section += `+"${it}"\n`); }
      const pureRenames = renames.filter(r => !movedFromThis.some(m => m.item === r.from));
      if (pureRenames.length) { section += '### Renamed\n'; pureRenames.forEach(r => section += `-"${r.from}"\n +"${r.to}"\n`); }
      if (movedFromThis.length) { section += '### Moved & Renamed\n'; movedFromThis.forEach(m => {
        const rename = renames.find(r => r.from === m.item);
        const display = rename
          ? `+"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")`
          : `+"${m.item}" → from module ${m.from} to module ${m.to}`;
        section += display + '\n';
      }); }
      section += '```\n';
      sections.push(`Module ${mod}:\n${section}`);
    }
  });

  const summaryText = summary.length ? `**Summary of changes:**\n${summary.join('\n')}\n\n` : '';
  return summaryText + sections.join('\n');
}

// Generate full diff
const fullDiff = compareModules(prev, curr);
fs.writeFileSync('current_diff.txt', fullDiff, 'utf8');

// Send first 2000 characters to Discord
const discordContent = fullDiff.slice(0, MAX_DISCORD) +
  `\nFull commit changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

async function postDiscord() {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordContent });
    console.log('Discord webhook sent successfully');
  } catch (err) {
    console.error('Failed to send Discord webhook:', err.message);
  }
}

postDiscord();
