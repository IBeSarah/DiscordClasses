const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const mode = process.argv[2] || 'summary'; // summary or full
const current = JSON.parse(fs.readFileSync('current.json', 'utf8'));
const previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));

function diffModules(prev, curr) {
    const added = {};
    const removed = {};
    const renamed = {};
    const moved = {};

    const prevModules = Object.keys(prev);
    const currModules = Object.keys(curr);

    // Added modules
    currModules.forEach(mod => {
        if (!prevModules.includes(mod)) added[mod] = curr[mod];
    });

    // Removed modules
    prevModules.forEach(mod => {
        if (!currModules.includes(mod)) removed[mod] = prev[mod];
    });

    // Existing modules: check inside
    prevModules.forEach(mod => {
        if (currModules.includes(mod)) {
            const prevKeys = Object.keys(prev[mod]);
            const currKeys = Object.keys(curr[mod]);
            const addKeys = currKeys.filter(k => !prevKeys.includes(k));
            const remKeys = prevKeys.filter(k => !currKeys.includes(k));
            const renKeys = prevKeys.filter(pk => {
                const closest = currKeys.find(ck => levenshtein.get(pk, ck) === 1);
                return closest && prev[mod][pk] !== curr[mod][closest];
            });

            if (addKeys.length) added[mod] = _.pick(curr[mod], addKeys);
            if (remKeys.length) removed[mod] = _.pick(prev[mod], remKeys);
            if (renKeys.length) renamed[mod] = _.pick(curr[mod], renKeys);
        }
    });

    // Detect moved modules (name unchanged but content changed completely)
    prevModules.forEach(mod => {
        if (currModules.includes(mod)) {
            if (!_.isEqual(prev[mod], curr[mod])) {
                moved[mod] = { from: prev[mod], to: curr[mod] };
            }
        }
    });

    return { added, removed, renamed, moved };
}

function formatGitHubDiff(diff) {
    let output = '';

    for (const type of ['added', 'removed', 'renamed', 'moved']) {
        const data = diff[type];
        for (const mod of Object.keys(data)) {
            const content = type === 'moved' ? data[mod].to : data[mod];
            if (!content || Object.keys(content).length === 0) continue;
            output += `# ${type.charAt(0).toUpperCase() + type.slice(1)} in module ${mod}\n\`\`\`diff\n`;
            if (type === 'added' || type === 'renamed') {
                for (const k in content) output += `+ "${k}": "${content[k]}"\n`;
            } else if (type === 'removed') {
                for (const k in content) output += `- "${k}": "${content[k]}"\n`;
            } else if (type === 'moved') {
                output += JSON.stringify(content, null, 2) + '\n';
            }
            output += '```\n\n';
        }
    }
    return output;
}

function formatDiscordSummary(diff) {
    let summary = '';
    for (const type of ['added', 'removed', 'renamed', 'moved']) {
        const data = diff[type];
        for (const mod of Object.keys(data)) {
            const count = Object.keys(data[type] && data[type][mod] ? data[type][mod] : {}).length;
            if (count > 0) summary += `Module ${mod}: ${type.charAt(0).toUpperCase() + type.slice(1)}: ${count}\n`;
        }
    }
    summary += `\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
    return summary;
}

const diff = diffModules(previous, current);

if (mode === 'full') {
    const githubDiff = formatGitHubDiff(diff);
    if (githubDiff.trim()) fs.writeFileSync('full_diff.txt', githubDiff, 'utf8');
} else if (mode === 'summary') {
    const discordDiff = formatDiscordSummary(diff);
    if (discordDiff.trim() && process.env.DISCORD_WEBHOOK_URL) {
        axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordDiff })
            .then(() => console.log('Discord post succeeded'))
            .catch(err => console.error('Discord post failed:', err.response?.data || err));
    }
}
