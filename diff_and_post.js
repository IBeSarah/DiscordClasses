const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8') || '{}');
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8') || '{}');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const MAX_DISCORD_CHARS = 2000;

// --- Helper functions ---
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
      if (dist < bestDist && dist <= Math.max(rem.length, add.length)*0.4) {
        bestDist = dist;
        bestMatch = add;
      }
    });
    if(bestMatch) {
      renames.push({from: rem, to: bestMatch});
      unmatchedAdded.delete(bestMatch);
    }
  });
  const newRemoved = removed.filter(r => !renames.some(x=>x.from===r));
  const newAdded = Array.from(unmatchedAdded);
  return {renames, newRemoved, newAdded};
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
        if(fromMod !== toMod && currItems.includes(item)) {
          moves.push({item, from: fromMod, to: toMod});
          currFlat[toMod] = currItems.filter(x=>x!==item);
          prevFlat[fromMod] = prevFlat[fromMod].filter(x=>x!==item);
        }
      });
    });
  });
  return moves;
}

function moduleChanged(prevObj, currObj, mod) {
  const prevItems = prevObj[mod] ? moduleItems(prevObj[mod]) : [];
  const currItems = currObj[mod] ? moduleItems(currObj[mod]) : [];
  if(prevItems.length !== currItems.length) return true;
  for(let i=0;i<prevItems.length;i++){
    if(prevItems[i] !== currItems[i]) return true;
  }
  return false;
}

function formatSection(mod, removed, added, renames, movedFromThis, movedSummary) {
  let section = '```diff\n';
  if(removed.length) { section += '### Removed\n'; removed.forEach(it => section += `-${it}\n`); }
  if(added.length) { section += '### Added\n'; added.forEach(it => section += `+${it}\n`); }
  const pureRenames = renames.filter(r => !movedFromThis.some(m=>m.item===r.from));
  if(pureRenames.length) { section += '### Renamed\n'; pureRenames.forEach(r => section += `-${r.from}\n+${r.to}\n`); }
  if(movedFromThis.length) {
    section += '### Moved & Renamed\n';
    movedFromThis.forEach(m => {
      const rename = renames.find(r=>r.from===m.item);
      const display = rename
        ? `+${m.item} → from module ${m.from} to module ${m.to} (renamed to ${rename.to})`
        : `+${m.item} → from module ${m.from} to module ${m.to}`;
      section += display + '\n';
    });
  }
  section += '```\n';
  return section;
}

function formatModuleSection(text) {
  const lines = text.split('\n');
  if(lines.length>30) return `<details><summary>Show diff (${lines.length} lines)</summary>\n\n${text}</details>`;
  return text;
}

function compareModules(prevObj, currObj) {
  const sections = [];
  const summary = [];
  const allModules = _.union(Object.keys(prevObj), Object.keys(currObj));
  const moves = detectMoves(prevObj, currObj);

  const changedModules = allModules.filter(mod => moduleChanged(prevObj, currObj, mod) || moves.some(m=>m.from===mod || m.to===mod));

  changedModules.forEach(mod => {
    let prevItems = moduleItems(prevObj[mod]);
    let currItems = moduleItems(currObj[mod]);

    const movedFromThis = moves.filter(m => m.from===mod);
    const movedToThis = moves.filter(m => m.to===mod);

    prevItems = prevItems.filter(x => !movedFromThis.some(m=>m.item===x));
    currItems = currItems.filter(x => !movedToThis.some(m=>m.item===x));

    let removed = _.difference(prevItems, currItems);
    let added = _.difference(currItems, prevItems);

    const {renames, newRemoved, newAdded} = detectRenames(removed, added);
    removed = newRemoved;
    added = newAdded;

    const movedSummary = movedFromThis.map(m => {
      const rename = renames.find(r => r.from===m.item);
      if(rename) return `"${m.item}" → ${m.to} (renamed to "${rename.to}")`;
      return `"${m.item}" → ${m.to}`;
    }).join(', ');

    const sectionText = formatSection(mod, removed, added, renames, movedFromThis, movedSummary);
    sections.push(`Module ${mod}: +${added.length} / -${removed.length} / ~${renames.length} / moved: ${movedSummary || 'none'}\n${formatModuleSection(sectionText)}`);
  });

  return sections.join('\n\n');
}

// --- Generate diff ---
const diffText = compareModules(prev, curr);

if(!diffText.trim()) {
  console.log("No changes to post");
  process.exit(0);
}

// --- Post to Discord ---
async function postDiscord() {
  let chunks = [];
  let start=0;
  while(start<diffText.length){
    chunks.push(diffText.slice(start, start+MAX_DISCORD_CHARS));
    start += MAX_DISCORD_CHARS;
  }

  for(let i=0;i<chunks.length;i++){
    const body = `**Changes in discordclasses.json:**\n${chunks[i]}`;
    try {
      await axios.post(DISCORD_WEBHOOK_URL, { content: body });
      console.log(`Posted Discord chunk ${i+1}/${chunks.length}`);
    } catch(e) {
      console.error('Failed to send Discord webhook:', e.message);
    }
  }
}

postDiscord();
