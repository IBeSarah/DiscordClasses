const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));
const MAX_DISCORD_LENGTH = 2000;

// Helper to flatten module items
const moduleItems = obj => obj ? Object.entries(obj).map(([k,v])=>`${k}: ${v}`) : [];

// Detect renames
function detectRenames(removed, added) {
  const renames = [];
  const unmatchedAdded = new Set(added);
  removed.forEach(rem => {
    let bestMatch = null, bestDist = Infinity;
    unmatchedAdded.forEach(add => {
      const dist = levenshtein.get(rem, add);
      if (dist < bestDist && dist <= Math.max(rem.length, add.length)*0.4) {
        bestDist = dist;
        bestMatch = add;
      }
    });
    if(bestMatch){
      renames.push({from: rem, to: bestMatch});
      unmatchedAdded.delete(bestMatch);
    }
  });
  return {renames, newRemoved: removed.filter(r=>!renames.some(x=>x.from===r)), newAdded: Array.from(unmatchedAdded)};
}

// Detect moves
function detectMoves(prevObj, currObj){
  const moves = [];
  const prevFlat = {}, currFlat = {};
  Object.entries(prevObj).forEach(([mod,obj])=> prevFlat[mod]=moduleItems(obj));
  Object.entries(currObj).forEach(([mod,obj])=> currFlat[mod]=moduleItems(obj));

  Object.entries(prevFlat).forEach(([fromMod, items])=>{
    items.forEach(item=>{
      Object.entries(currFlat).forEach(([toMod, currItems])=>{
        if(fromMod!==toMod && currItems.includes(item)){
          moves.push({item, from: fromMod, to: toMod});
          currFlat[toMod]=currItems.filter(x=>x!==item);
          prevFlat[fromMod]=prevFlat[fromMod].filter(x=>x!==item);
        }
      });
    });
  });
  return moves;
}

// Compare modules
function compareModules(prevObj, currObj){
  const sections = [], summary=[];
  const allModules = _.union(Object.keys(prevObj), Object.keys(currObj));
  const moves = detectMoves(prevObj, currObj);

  allModules.forEach(mod=>{
    let prevItems=moduleItems(prevObj[mod]);
    let currItems=moduleItems(currObj[mod]);
    const movedFromThis = moves.filter(m=>m.from===mod);
    const movedToThis = moves.filter(m=>m.to===mod);

    prevItems = prevItems.filter(x=>!movedFromThis.some(m=>m.item===x));
    currItems = currItems.filter(x=>!movedToThis.some(m=>m.item===x));

    let removed = _.difference(prevItems, currItems);
    let added = _.difference(currItems, prevItems);

    const {renames, newRemoved, newAdded} = detectRenames(removed, added);
    removed = newRemoved; added = newAdded;

    const totalRenamed = renames.length + movedFromThis.filter(m=>renames.some(r=>r.from===m.item)).length;
    if(removed.length||added.length||totalRenamed||movedFromThis.length){
      const movedSummary = movedFromThis.map(m=>{
        const rename = renames.find(r=>r.from===m.item);
        if(rename) return `"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")`;
        return `"${m.item}" → from module ${m.from} to module ${m.to}`;
      }).join(', ');

      summary.push(`- ${mod}: +${added.length} / -${removed.length} / ~${totalRenamed} / moved: ${movedSummary || 'none'}`);

      let section = '```diff\n';
      if(removed.length){section+='### Removed\n'; removed.forEach(it=>section+=`-"${it}"\n`);}
      if(added.length){section+='### Added\n'; added.forEach(it=>section+=`+"${it}"\n`);}
      const pureRenames = renames.filter(r=>!movedFromThis.some(m=>m.item===r.from));
      if(pureRenames.length){section+='### Renamed\n'; pureRenames.forEach(r=>section+=`-"${r.from}"\n +"${r.to}"\n`);}
      if(movedFromThis.length){section+='### Moved & Renamed\n'; movedFromThis.forEach(m=>{
        const rename = renames.find(r=>r.from===m.item);
        section+=rename
          ? `+"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")\n`
          : `+"${m.item}" → from module ${m.from} to module ${m.to}\n`;
      });}
      section+='```\n';
      sections.push(section);
    }
  });
  return (summary.length?`**Summary of changes:**\n${summary.join('\n')}\n\n`:'') + sections.join('\n');
}

const diffText = compareModules(prev, curr);
if(!diffText.trim()){ console.log("No changes"); process.exit(0); }

const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
const commitLink = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

let message = `**Changes in discordclasses.json:**\n${diffText}`;
if(message.length>MAX_DISCORD_LENGTH){
  message = message.slice(0, MAX_DISCORD_LENGTH-commitLink.length-20);
  message += `\n\nFull commit changes here: ${commitLink}`;
}

(async()=>{
  try {
    await axios.post(discordWebhook, {content: message});
    console.log("Discord webhook sent successfully");
  }catch(e){
    console.error("Failed to send Discord webhook:", e);
    process.exit(1);
  }
})();
