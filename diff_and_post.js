const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const prev = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const curr = JSON.parse(fs.readFileSync('current.json', 'utf8'));

const githubDiffs = [];
const discordSummary = [];

function diffModules(prev, curr) {
    const addedModules = [];
    const removedModules = [];
    const movedModules = [];
    const renamedModules = [];

    for (const key in prev) {
        if (!curr[key]) removedModules.push(key);
    }
    for (const key in curr) {
        if (!prev[key]) addedModules.push(key);
    }

    for (const key in curr) {
        if (prev[key]) {
            const prevKeys = Object.keys(prev[key]);
            const currKeys = Object.keys(curr[key]);

            const added = _.difference(currKeys, prevKeys);
            const removed = _.difference(prevKeys, currKeys);
            const renamed = [];

            // Detect renames (simple heuristic)
            for (const k of removed) {
                for (const k2 of added) {
                    if (levenshtein.get(prev[key][k], curr[key][k2]) <= 3) {
                        renamed.push([k, k2]);
                    }
                }
            }

            if (added.length || removed.length || renamed.length) {
                let text = '';

                if (added.length) {
                    text += `### Added in module ${key}\n\`\`\`diff\n`;
                    added.forEach(k => text += `+ "${k}": "${curr[key][k]}"\n`);
                    text += '```\n';
                }

                if (removed.length) {
                    text += `### Removed from module ${key}\n\`\`\`diff\n`;
                    removed.forEach(k => text += `- "${k}": "${prev[key][k]}"\n`);
                    text += '```\n';
                }

                if (renamed.length) {
                    text += `### Renamed in module ${key}\n\`\`\`diff\n`;
                    renamed.forEach(([oldK, newK]) => text += `- "${oldK}": "${prev[key][oldK]}"\n+ "${newK}": "${curr[key][newK]}"\n`);
                    text += '```\n';
                }

                githubDiffs.push(text);

                // Discord summary
                const summary = [];
                if (added.length) summary.push(`Added: ${added.length}`);
                if (removed.length) summary.push(`Removed: ${removed.length}`);
                if (renamed.length) summary.push(`Renamed: ${renamed.length}`);
                if (summary.length) discordSummary.push(`Module ${key}: ${summary.join(', ')}`);
            }
        }
    }

    return { addedModules, removedModules, movedModules, renamedModules };
}

diffModules(prev, curr);

// Write full diff for GitHub comments
fs.writeFileSync('full_diff.txt', githubDiffs.join('\n'));

// Post to Discord
if (discordSummary.length) {
    const commitUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
    const content = discordSummary.map(x => `### ${x}`).join('\n') + `\n\nView full list of changes here: ${commitUrl}`;

    axios.post(process.env.DISCORD_WEBHOOK_URL, { content })
        .then(() => console.log('Posted summary to Discord'))
        .catch(console.error);
} else {
    console.log('No changes detected for Discord');
}
