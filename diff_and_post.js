const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

const args = process.argv.slice(2);
const summaryOnly = args[0] === 'summary';

function parseJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const oldData = parseJson('previous.json');
const newData = parseJson('current.json');

const diffResult = {};

for (const key of new Set([...Object.keys(oldData), ...Object.keys(newData)])) {
    const oldModule = oldData[key] || {};
    const newModule = newData[key] || {};

    const added = {};
    const removed = {};
    const renamed = {};

    for (const k in newModule) {
        if (!(k in oldModule)) {
            added[k] = newModule[k];
        } else if (oldModule[k] !== newModule[k]) {
            renamed[k] = { old: oldModule[k], new: newModule[k] };
        }
    }
    for (const k in oldModule) {
        if (!(k in newModule)) {
            removed[k] = oldModule[k];
        }
    }

    const moved = {};
    if (!_.isEqual(oldModule, newModule)) {
        moved.from = oldModule;
        moved.to = newModule;
    }

    if (Object.keys(added).length || Object.keys(removed).length || Object.keys(renamed).length || !_.isEqual(oldModule, newModule)) {
        diffResult[key] = { added, removed, renamed, moved };
    }
}

// ---------------- Discord summary ----------------
if (summaryOnly) {
    const summaryLines = [];
    for (const [moduleId, changes] of Object.entries(diffResult)) {
        const parts = [];
        if (Object.keys(changes.added).length) parts.push(`Added: ${Object.keys(changes.added).length}`);
        if (Object.keys(changes.removed).length) parts.push(`Removed: ${Object.keys(changes.removed).length}`);
        if (Object.keys(changes.renamed).length) parts.push(`Renamed: ${Object.keys(changes.renamed).length}`);
        if (Object.keys(changes.moved.from).length && !_.isEqual(changes.moved.from, changes.moved.to)) parts.push(`Moved: 1`);
        if (parts.length) summaryLines.push(`Module ${moduleId}: ${parts.join(', ')}`);
    }

    const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
    const summaryText = summaryLines.join('\n') + `\n\nView full list of changes here: ${commitUrl}`;

    axios.post(process.env.DISCORD_WEBHOOK_URL, { content: summaryText }).catch(console.error);
}

// ---------------- Full diff for GitHub ----------------
let fullDiffText = '';
for (const [moduleId, changes] of Object.entries(diffResult)) {
    if (Object.keys(changes.added).length) {
        fullDiffText += `### Added in module ${moduleId}\n\`\`\`diff\n`;
        for (const [k, v] of Object.entries(changes.added)) fullDiffText += `+ "${k}": "${v}"\n`;
        fullDiffText += '```\n';
    }
    if (Object.keys(changes.removed).length) {
        fullDiffText += `### Removed from module ${moduleId}\n\`\`\`diff\n`;
        for (const [k, v] of Object.entries(changes.removed)) fullDiffText += `- "${k}": "${v}"\n`;
        fullDiffText += '```\n';
    }
    if (Object.keys(changes.renamed).length) {
        fullDiffText += `### Renamed in module ${moduleId}\n\`\`\`diff\n`;
        for (const [k, v] of Object.entries(changes.renamed)) {
            fullDiffText += `- "${k}": "${v.old}"\n`;
            fullDiffText += `+ "${k}": "${v.new}"\n`;
        }
        fullDiffText += '```\n';
    }
    if (!_.isEqual(changes.moved.from, changes.moved.to)) {
        fullDiffText += `### Moved module ${moduleId}\n\`\`\`diff\n`;
        fullDiffText += `From: ${JSON.stringify(changes.moved.from, null, 2)}\n`;
        fullDiffText += `To:   ${JSON.stringify(changes.moved.to, null, 2)}\n`;
        fullDiffText += '```\n';
    }
}

// Write full diff for GitHub workflow
fs.writeFileSync('full_diff.txt', fullDiffText);
