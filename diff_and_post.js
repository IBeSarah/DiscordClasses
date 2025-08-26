const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const [,, mode] = process.argv;

const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));

let summaryText = '';
let fullDiffText = '';

// Helper: detect renamed items
function detectRenames(prev, curr) {
  const renamed = [];
  const prevValues = Object.entries(prev);
  const currValues = Object.entries(curr);

  prevValues.forEach(([k1, v1]) => {
    currValues.forEach(([k2, v2]) => {
      if (k1 !== k2 && v1 === v2) {
        renamed.push({from: k1, to: k2, value: v1});
      }
    });
  });
  return renamed;
}

// Helper: diff a module
function diffModule(moduleName, prevModule, currModule) {
  const addedKeys = Object.keys(currModule || {}).filter(k => !prevModule || !(k in prevModule));
  const removedKeys = Object.keys(prevModule || {}).filter(k => !currModule || !(k in currModule));
  const renamedKeys = detectRenames(prevModule || {}, currModule || {});
  
  let moduleDiff = '';

  if (addedKeys.length) {
    summaryText += `Module ${moduleName}: Added: ${addedKeys.length}\n`;
    moduleDiff += `# Added in module ${moduleName}\n\`\`\`diff\n`;
    addedKeys.forEach(k => moduleDiff += `+ "${k}": "${currModule[k]}"\n`);
    moduleDiff += '```\n\n';
  }

  if (removedKeys.length) {
    summaryText += `Module ${moduleName}: Removed: ${removedKeys.length}\n`;
    moduleDiff += `# Removed from module ${moduleName}\n\`\`\`diff\n`;
    removedKeys.forEach(k => moduleDiff += `- "${k}": "${prevModule[k]}"\n`);
    moduleDiff += '```\n\n';
  }

  if (renamedKeys.length) {
    summaryText += `Module ${moduleName}: Renamed: ${renamedKeys.length}\n`;
    moduleDiff += `# Renamed in module ${moduleName}\n\`\`\`diff\n`;
    renamedKeys.forEach(r => moduleDiff += `- "${r.from}": "${r.value}"\n+ "${r.to}": "${r.value}"\n`);
    moduleDiff += '```\n\n';
  }

  return moduleDiff;
}

// Detect module moves
const prevKeys = Object.keys(previous);
const currKeys = Object.keys(current);
const movedModules = [];

prevKeys.forEach(k => {
  if (!currKeys.includes(k)) {
    const match = currKeys.find(ck => _.isEqual(previous[k], current[ck]));
    if (match) movedModules.push({from: k, to: match});
  }
});

if (movedModules.length) {
  summaryText += `Moved modules: ${movedModules.map(m => `${m.from} → ${m.to}`).join(', ')}\n`;
  fullDiffText += `# Moved Modules\n\`\`\`diff\n`;
  movedModules.forEach(m => fullDiffText += `Module ${m.from} moved to ${m.to}\n`);
  fullDiffText += '```\n\n';
}

// Process all modules
const allModuleKeys = _.union(prevKeys, currKeys);
allModuleKeys.forEach(k => {
  const mdiff = diffModule(k, previous[k], current[k]);
  fullDiffText += mdiff;
});

// Write full diff
fs.writeFileSync('full_diff.txt', fullDiffText, 'utf8');

// Post to Discord if summary mode
if (mode === 'summary') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) process.exit(1);

  let discordMessage = summaryText.trim();
  if (discordMessage) {
    discordMessage += `\n\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
    axios.post(webhookUrl, {content: discordMessage})
      .then(() => console.log('Discord summary posted'))
      .catch(err => console.error('Discord post failed:', err.message));
  } else {
    console.log('No changes to post to Discord');
  }
}
