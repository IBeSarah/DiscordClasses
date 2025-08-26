const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');

const prev = JSON.parse(fs.readFileSync('previous.json','utf8') || '{}');
const curr = JSON.parse(fs.readFileSync('current.json','utf8') || '{}');

const MAX_LINES = 30;

// Utility functions
function moduleItems(obj){ if(!obj) return []; return Object.entries(obj).map(([k,v]) => `${k}: ${v}`); }
function detectRenames(removed, added){ 
  const renames = [];
  const unmatchedAdded = new Set(added);
  removed.forEach(rem => {
    let bestMatch = null, bestDist = Infinity;
    unmatchedAdded.forEach(add => {
      const dist = levenshtein.get(rem, add);
      if(dist < bestDist && dist <= Math.max(rem.length, add.length)*0.4){ bestDist = dist; bestMatch = add; }
    });
    if(bestMatch){ renames.push({from: rem, to: bestMatch}); unmatchedAdded.delete(bestMatch); }
  });
  const newRemoved = removed.filter(r => !renames.some(x => x.from === r));
  return {renames, newRemoved, newAdded: Array.from(unmatchedAdded)};
}
function detectMoves(prevObj, currObj){
  const moves = [];
  const prevFlat = {}, currFlat = {};
  Object.entries(prevObj).forEach(([mod,obj]) => prevFlat[mod] = moduleItems(obj));
  Object.entries(currObj).forEach(([mod,obj]) => currFlat[mod] = moduleItems(obj));
  Object.entries(prevFlat).forEach(([fromMod,items])=>{
    items.forEach(item=>{
      Object.entries(currFlat).forEach(([toMod,currItems])=>{
        if(fromMod!==toMod && currItems.includes(item)){
          moves.push({item,from:fromMod,to:toMod});
          currFlat[toMod] = currItems.filter(x=>x!==item);
          prevFlat[fromMod] = prevFlat[fromMod].filter(x=>x!==item);
        }
      });
    });
  });
  return moves;
}

// Compare modules
function compareModules(prevObj, currObj){
  const sections=[],summary=[];
  const prevHashes={},currHashes={},moduleRenames=[],renamedMap={};
  Object.entries(prevObj).forEach(([mod,obj])=>prevHashes[mod]=JSON.stringify(obj));
  Object.entries(currObj).forEach(([mod,obj])=>currHashes[mod]=JSON.stringify(obj));
  Object.entries(prevHashes).forEach(([prevMod,hash])=>{
    Object.entries(currHashes).forEach(([currMod,currHash])=>{
      if(hash===currHash && prevMod!==currMod){ moduleRenames.push({from:prevMod,to:currMod}); renamedMap[prevMod]=currMod; }
    });
  });
  const renamedReverseMap={}; Object.entries(renamedMap).forEach(([oldMod,newMod])=>renamedReverseMap[newMod]=oldMod);
  let renameSummaryText='';
  if(moduleRenames.length){ renameSummaryText+='### Module Renamed\n'; moduleRenames.forEach(r=>renameSummaryText+=`Module ${r.from} → ${r.to}\n`); renameSummaryText+='\n'; }

  const moves = detectMoves(prevObj, currObj);
  const allModules = _.union(Object.keys(prevObj),Object.keys(currObj));

  allModules.forEach(mod=>{
    if(Object.keys(renamedMap).includes(mod)) return;

    let prevItems=moduleItems(prevObj[mod]);
    let currItems=moduleItems(currObj[mod]);
    const movedFromThis = moves.filter(m=>m.from===mod);
    const movedToThis = moves.filter(m=>m.to===mod);
    prevItems = prevItems.filter(x=>!movedFromThis.some(m=>m.item===x));
    currItems = currItems.filter(x=>!movedToThis.some(m=>m.item===x));

    let removed = _.difference(prevItems,currItems);
    let added = _.difference(currItems,prevItems);
    const {renames,newRemoved,newAdded} = detectRenames(removed,added);
    removed = newRemoved; added = newAdded;
    const pureRenames = renames.filter(r=>!movedFromThis.some(m=>m.item===r.from));

    if(removed.length || added.length || pureRenames.length || movedFromThis.length){
      let movedSummary = movedFromThis.map(m=>{
        const rename = renames.find(r=>r.from===m.item);
        return rename
          ? `"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")`
          : `"${m.item}" → from module ${m.from} to module ${m.to}`;
      });
      let movedSummaryText = movedSummary.length<=3 ? movedSummary.join(', ') : movedSummary.slice(0,3).join(', ')+`, +${movedSummary.length-3} more`;
      const oldMod = renamedReverseMap[mod];
      const displayModHeader = oldMod ? `${mod} (was ${oldMod})` : mod;
      summary.push(`- ${displayModHeader}: +${added.length} / -${removed.length} / ~${pureRenames.length} / moved: ${movedSummaryText || 'none'}`);

      let diffContent='';
      if(removed.length){ diffContent+='### Removed\n'; removed.forEach(it=>diffContent+=`-"${it}"\n`);}
      if(added.length){ diffContent+='### Added\n'; added.forEach(it=>diffContent+=`+"${it}"\n`);}
      if(pureRenames.length){ diffContent+='### Renamed\n'; pureRenames.forEach(r=>diffContent+=`-"${r.from}"\n+"${r.to}"\n`);}
      if(movedFromThis.length){ diffContent+='### Moved & Renamed\n'; movedFromThis.forEach(m=>{
        const rename = renames.find(r=>r.from===m.item);
        diffContent += rename
          ? `+"${m.item}" → from module ${m.from} to module ${m.to} (renamed to "${rename.to}")\n`
          : `+"${m.item}" → from module ${m.from} to module ${m.to}\n`;
      });}

      const lines = diffContent.split('\n').length;
      let section = lines>MAX_LINES
        ? `<details>\n<summary>Module ${displayModHeader}: +${added.length} / -${removed.length} / ~${pureRenames.length} / moved: ${movedSummaryText || 'none'}</summary>\n\n\`\`\`diff\n${diffContent}\`\`\`\n</details>\n`
        : `Module ${displayModHeader}: +${added.length} / -${removed.length} / ~${pureRenames.length} / moved: ${movedSummaryText || 'none'}\n\`\`\`diff\n${diffContent}\`\`\`\n`;

      sections.push(section);
    }
  });

  const summaryText = summary.length ? `**Summary of changes:**\n${summary.join('\n')}\n\n` : '';
  const fullDiff = renameSummaryText + summaryText + sections.join('\n');

  fs.writeFileSync('current_diff.txt', fullDiff);
  console.log('Diff computation done.');
