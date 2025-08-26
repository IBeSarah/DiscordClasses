const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');

const previousFile = 'previous.json';
const currentFile = 'current.json';

if (!fs.existsSync(previousFile) || !fs.existsSync(currentFile)) {
    console.error('Missing previous.json or current.json for diffing');
    process.exit(1);
}

const previous = JSON.parse(fs.readFileSync(previousFile, 'utf8'));
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));

let githubDiff = '';
let discordDiff = '```diff\n';

const addedKeys = [];
const removedKeys = [];
const movedKeys = [];
const renamedKeys = [];

// Helper function to stringify objects with 2-space indentation
function stringify(obj) {
    return JSON.stringify(obj, null, 2);
}

// Loop through all modules
const allModules = new Set([...Object.keys(previous), ...Object.keys(current)]);
allModules.forEach(module => {
    const prevModule = previous[module] || {};
    const currModule = current[module] || {};

    const prevKeys = Object.keys(prevModule);
    const currKeys = Object.keys(currModule);

    // Added keys
    currKeys.forEach(key => {
        if (!prevKeys.includes(key)) {
            addedKeys.push({ module, key, value: currModule[key] });
        }
    });

    // Removed keys
    prevKeys.forEach(key => {
        if (!currKeys.includes(key)) {
            removedKeys.push({ module, key, value: prevModule[key] });
        }
    });

    // Moved keys (module removed from previous, added to another)
    allModules.forEach(targetModule => {
        if (targetModule === module) return;
        const targetPrev = previous[targetModule] || {};
        const targetCurr = current[targetModule] || {};
        Object.keys(prevModule).forEach(key => {
            if (prevModule[key] && targetCurr[key] && prevModule[key] === targetCurr[key]) {
                movedKeys.push({ key, from: module, to: targetModule });
            }
        });
    });

    // Renamed keys (value matches, key changed)
    Object.values(prevModule).forEach(prevVal => {
        const oldKey = Object.keys(prevModule).find(k => prevModule[k] === prevVal);
        const newKey = Object.keys(currModule).find(k => currModule[k] === prevVal && k !== oldKey);
        if (newKey) {
            renamedKeys.push({ module, oldKey, newKey });
        }
    });
});

// Generate GitHub diff
if (addedKeys.length) {
    githubDiff += '### Added\n';
    addedKeys.forEach(a => {
        githubDiff += `Module ${a.module}:\n${stringify(current[a.module])}\n+ "${a.key}": "${a.value}" added in module ${a.module}\n\n`;
    });
    discordDiff += '### Added\n';
    addedKeys.forEach(a => {
        discordDiff += `+ "${a.key}" added in module ${a.module}\n`;
    });
}

if (removedKeys.length) {
    githubDiff += '### Removed\n';
    removedKeys.forEach(r => {
        githubDiff += `Module ${r.module}:\n${stringify(previous[r.module])}\n- "${r.key}": "${r.value}" removed from module ${r.module}\n\n`;
    });
    discordDiff += '### Removed\n';
    removedKeys.forEach(r => {
        discordDiff += `- "${r.key}" removed from module ${r.module}\n`;
    });
}

if (movedKeys.length) {
    githubDiff += '### Moved\n';
    movedKeys.forEach(m => {
        githubDiff += `"${m.key}" moved from module ${m.from} to module ${m.to}\n\n`;
        discordDiff += `"${m.key}" moved from module ${m.from} to module ${m.to}\n`;
    });
}

if (renamedKeys.length) {
    githubDiff += '### Renamed\n';
    renamedKeys.forEach(r => {
        githubDiff += `"${r.oldKey}" → "${r.newKey}" in module ${r.module}\n\n`;
        discordDiff += `"${r.oldKey}" → "${r.newKey}" in module ${r.module}\n`;
    });
}

discordDiff += '```';

// Write GitHub diff to full_diff.txt
fs.writeFileSync('full_diff.txt', githubDiff);

// Post to Discord
async function postToDiscord() {
    if (!process.env.DISCORD_WEBHOOK_URL) return console.error('DISCORD_WEBHOOK_URL not set');

    try {
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
            content: discordDiff
        });
        console.log('Posted diff to Discord');
    } catch (err) {
        console.error('Error posting to Discord:', err.message);
    }
}

postToDiscord();
