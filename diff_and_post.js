const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');

console.log("Starting diff_and_post.js");

// Read the previous and current JSON files
let previous, current;
try {
    previous = JSON.parse(fs.readFileSync('previous.json', 'utf8'));
    console.log("Previous JSON loaded");
} catch (err) {
    console.error("Failed to read previous.json:", err);
    previous = {};
}

try {
    current = JSON.parse(fs.readFileSync('current.json', 'utf8'));
    console.log("Current JSON loaded");
} catch (err) {
    console.error("Failed to read current.json:", err);
    current = {};
}

// Compute diff (simplified example, adjust your diff logic)
const added = {};
const removed = {};
const renamed = {};
const moved = {}; // optional if you track module moves

for (const moduleKey in current) {
    const oldModule = previous[moduleKey] || {};
    const newModule = current[moduleKey];

    for (const key in newModule) {
        if (!(key in oldModule)) added[key] = moduleKey;
        else if (oldModule[key] !== newModule[key]) renamed[key] = moduleKey;
    }

    for (const key in oldModule) {
        if (!(key in newModule)) removed[key] = moduleKey;
    }
}

// Construct Discord message
let message = "";
if (Object.keys(added).length > 0) message += `### Added: ${Object.keys(added).length}\n`;
if (Object.keys(removed).length > 0) message += `### Removed: ${Object.keys(removed).length}\n`;
if (Object.keys(renamed).length > 0) message += `### Renamed: ${Object.keys(renamed).length}\n`;
if (Object.keys(moved).length > 0) message += `### Moved: ${Object.keys(moved).length}\n`;

message += `\nView full list of changes here: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

console.log("Prepared Discord message:\n", message);

// Send to Discord with timeout
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL not set!");
    process.exit(1);
}

axios.post(webhookUrl, { content: message }, { timeout: 10000 }) // 10s timeout
    .then(() => {
        console.log("Discord message sent successfully");
    })
    .catch(err => {
        console.error("Discord post failed:", err.message || err);
    });
