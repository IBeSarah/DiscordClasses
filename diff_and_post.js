const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const levenshtein = require('fast-levenshtein');

const previousJson = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
const currentJson  = JSON.parse(fs.readFileSync('current.json', 'utf8'));

// ---- Helper functions ----
function diffModules(prev, curr) {
    const added = {};
    const removed = {};
    const renamed = {};
    const moved = {};

    Object.keys(curr).forEach(module => {
        if (!prev[module]) {
            added[module] = curr[module];
        } else {
            Object.keys(curr[module]).forEach(key => {
                if (!prev[module][key]) {
                    added[module] = added[module] || {};
                    added[module][key] = curr[module][key];
                } else if (prev[module][key] !== curr[module][key]) {
                    renamed[module] = renamed[module] || {};
                    renamed[module][key] = { from: prev[module][key], to: curr[module][key] };
                }
            });
            Object.keys(prev[module]).forEach(key => {
                if (!curr[module][key]) {
                    removed[module] = removed[module] || {};
                    removed[module][key] = prev[module][key];
                }
            });
        }
    });

    Object.keys(prev).forEach(module => {
        if (!curr[module]) {
            removed[module] = prev[module];
        }
    });

    // For simplicity, treat "moved" as modules that changed keys completely
    Object.keys(curr).forEach(module => {
        if (prev[module] && JSON.stringify(prev[module]) !== JSON.stringify(curr[module])) {
            moved[module] = { from: prev[module], to: curr[module] };
        }
    });

    return { added, removed, renamed, moved };
}

function generateFullDiffText(diff) {
    let lines = [];

    Object.entries(diff.added).forEach(([mod, items]) => {
        if (Object.keys(items).length) {
            lines.push(`### Added in module ${mod}\n\`\`\`diff`);
            Object.entries(items).forEach(([k, v]) => {
                lines.push(`+ "${k}": "${v}"`);
            });
            lines.push('```');
        }
    });

    Object.entries(diff.removed).forEach(([mod, items]) => {
        if (Object.keys(items).length) {
            lines.push(`### Removed from module ${mod}\n\`\`\`diff`);
            Object.entries(items).forEach(([k, v]) => {
                lines.push(`- "${k}": "${v}"`);
            });
            lines.push('```');
        }
    });

    Object.entries(diff.renamed).forEach(([mod, items]) => {
        if (Object.keys(items).length) {
            lines.push(`### Renamed in module ${mod}\n\`\`\`diff`);
            Object.entries(items).forEach(([k, v]) => {
                lines.push(`- "${k}": "${v.from}"`);
                lines.push(`+ "${k}": "${v.to}"`);
            });
            lines.push('```');
        }
    });

    Object.entries(diff.moved).forEach(([mod, item]) => {
        if (Object.keys(item.to).length) {
            lines.push(`### Moved module ${mod}\n\`\`\`diff`);
            lines.push(`From: ${JSON.stringify(item.from, null, 2)}`);
            lines.push(`To:   ${JSON.stringify(item.to, null, 2)}`);
            lines.push('```');
        }
    });

    return lines.join('\n');
}

function generateDiscordSummary(diff) {
    const summary = [];
    const mods = new Set([
        ...Object.keys(diff.added),
        ...Object.keys(diff.removed),
        ...Object.keys(diff.renamed),
        ...Object.keys(diff.moved)
    ]);

    mods.forEach(mod => {
        const parts = [];
        if (diff.added[mod]) parts.push(`Added: ${Object.keys(diff.added[mod]).length}`);
        if (diff.removed[mod]) parts.push(`Removed: ${Object.keys(diff.removed[mod]).length}`);
        if (diff.renamed[mod]) parts.push(`Renamed: ${Object.keys(diff.renamed[mod]).length}`);
        if (diff.moved[mod]) parts.push(`Moved: 1`);
        summary.push(`Module ${mod}: ${parts.join(', ')}`);
    });

    return summary.join('\n') + `\n\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
}

// ---- Generate diffs ----
const diff = diffModules(previousJson, currentJson);
const fullDiffText = generateFullDiffText(diff);

// Always write full diff to file for GitHub step
fs.writeFileSync('full_diff.txt', fullDiffText, 'utf8');

// ---- Post Discord ----
(async () => {
    const discordMsg = generateDiscordSummary(diff);
    try {
        await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: discordMsg });
        console.log('Discord post successful.');
    } catch (err) {
        console.error('Discord post failed:', err.response?.data || err.message);
    }
})();
