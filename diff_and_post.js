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

const fullDiff = {
    added: {},
    removed: {},
    renamed: {},
    moved: []
};

// Detect added/removed/renamed
for (const [module, items] of Object.entries(newData)) {
    if (!oldData[module]) {
        fullDiff.added[module] = items;
        continue;
    }

    for (const [key, value] of Object.entries(items)) {
        if (!oldData[module][key]) {
            fullDiff.added[module] = fullDiff.added[module] || {};
            fullDiff.added[module][key] = value;
        } else if (oldData[module][key] !== value) {
            fullDiff.renamed[module] = fullDiff.renamed[module] || {};
            fullDiff.renamed[module][key] = { from: oldData[module][key], to: value };
        }
    }
}

// Detect removed
for (const [module, items] of Object.entries(oldData)) {
    if (!newData[module]) {
        fullDiff.removed[module] = items;
        continue;
    }

    for (const [key, value] of Object.entries(items)) {
        if (!newData[module][key]) {
            fullDiff.removed[module] = fullDiff.removed[module] || {};
            fullDiff.removed[module][key] = value;
        }
    }
}

// Detect moved modules
for (const [module, items] of Object.entries(newData)) {
    if (oldData[module] && oldData[module] !== items) {
        fullDiff.moved.push({ module, from: oldData[module], to: items });
    }
}

// --- Build GitHub full diff ---
let githubDiff = '```diff\n';

for (const type of ['added', 'removed', 'renamed']) {
    const modules = fullDiff[type];
    if (Object.keys(modules).length) {
        githubDiff += `### ${_.startCase(type)}\n`;
        for (const [module, items] of Object.entries(modules)) {
            githubDiff += `Module ${module}:\n${JSON.stringify(items, null, 2)}\n`;
        }
    }
}

if (fullDiff.moved.length) {
    githubDiff += `### Moved\n`;
    fullDiff.moved.forEach(m => {
        githubDiff += `${m.module} moved from ${JSON.stringify(m.from)} to ${JSON.stringify(m.to)}\n`;
    });
}

githubDiff += '```';
fs.writeFileSync('full_diff.txt', githubDiff);

// --- Build Discord summary ---
let discordMessage = '';

function buildSummary(type, modules) {
    if (!Object.keys(modules).length) return '';
    return `### ${_.startCase(type)}\n${Object.keys(modules).length} module(s) affected: ${Object.keys(modules).join(', ')}\n\n`;
}

discordMessage += buildSummary('added', fullDiff.added);
discordMessage += buildSummary('removed', fullDiff.removed);
discordMessage += buildSummary('renamed', fullDiff.renamed);

if (fullDiff.moved.length) {
    discordMessage += `### Moved\n`;
    fullDiff.moved.forEach(m => {
        discordMessage += `Module ${m.module} moved\n`;
    });
    discordMessage += '\n';
}

// Post to Discord
if (discordMessage.trim()) {
    axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMessage })
        .then(() => console.log('Posted summary to Discord'))
        .catch(err => console.error('Error posting to Discord:', err));
} else {
    console.log('No changes detected for Discord');
}
