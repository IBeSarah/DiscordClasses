const fs = require("fs");
const axios = require("axios");

// Simple heuristic for renames
function looksLikeRename(oldVal, newVal) {
  const prefixOld = oldVal.split("_")[0];
  const prefixNew = newVal.split("_")[0];
  return prefixOld === prefixNew;
}

// Generate full diff for GitHub
function generateDiff(prev, curr) {
  let output = [];

  for (const id of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
    const oldObj = prev[id];
    const newObj = curr[id];

    if (!oldObj) {
      output.push(`### Added module ${id}`);
      output.push("```diff");
      for (const [k, v] of Object.entries(newObj)) output.push(`+ "${k}": "${v}"`);
      output.push("```");
    } else if (!newObj) {
      output.push(`### Removed module ${id}`);
      output.push("```diff");
      for (const [k, v] of Object.entries(oldObj)) output.push(`- "${k}": "${v}"`);
      output.push("```");
    } else {
      let added = [], removed = [], renamed = [], changed = [];

      for (const key of new Set([...Object.keys(oldObj), ...Object.keys(newObj)])) {
        if (!(key in oldObj)) added.push([key, newObj[key]]);
        else if (!(key in newObj)) removed.push([key, oldObj[key]]);
        else if (oldObj[key] !== newObj[key]) {
          if (looksLikeRename(oldObj[key], newObj[key])) renamed.push([key, oldObj[key], newObj[key]]);
          else changed.push([key, oldObj[key], newObj[key]]);
        }
      }

      if (added.length || removed.length || renamed.length || changed.length) {
        output.push(`### Changes in module ${id}`);
        output.push("```diff");
        for (const [k, v] of added) output.push(`+ "${k}": "${v}"`);
        for (const [k, v] of removed) output.push(`- "${k}": "${v}"`);
        for (const [k, oldVal, newVal] of renamed)
          output.push(`R "${k}": "${oldVal}" -> "${newVal}"`);
        for (const [k, oldVal, newVal] of changed) {
          output.push(`- "${k}": "${oldVal}"`);
          output.push(`+ "${k}": "${newVal}"`);
        }
        output.push("```");
      }
    }
  }

  return output.join("\n");
}

// Generate Discord summary (short, single message, max 2000 chars)
function discordSummary(prev, curr, commitUrl) {
  let lines = [];

  for (const id of new Set([...Object.keys(prev), ...Object.keys(curr)])) {
    const oldObj = prev[id] || {};
    const newObj = curr[id] || {};

    let added = 0, removed = 0, renamed = 0, moved = 0;

    for (const key of new Set([...Object.keys(oldObj), ...Object.keys(newObj)])) {
      if (!(key in oldObj)) added++;
      else if (!(key in newObj)) removed++;
      else if (oldObj[key] !== newObj[key]) {
        if (looksLikeRename(oldObj[key], newObj[key])) renamed++;
        else moved++;
      }
    }

    if (added || removed || renamed || moved) {
      const parts = [];
      if (added) parts.push(`Added: ${added}`);
      if (removed) parts.push(`Removed: ${removed}`);
      if (renamed) parts.push(`Renamed: ${renamed}`);
      if (moved) parts.push(`Moved: ${moved}`);
      lines.push(`Module ${id}: ${parts.join(", ")}`);
    }
  }

  let summary = lines.join("\n");
  if (summary.length > 1800) summary = summary.slice(0, 1797) + "...";
  return `**Module changes summary**\n${summary}\n\nView full list of changes here: ${commitUrl}`;
}

// Post to Discord
async function postDiscord(summary) {
  await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: summary });
  console.log("✅ Discord post successful");
}

// Post full diff to GitHub commit comments
async function postGitHub(diffText) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;

  const MAX_COMMENT = 65000;
  const chunks = [];
  let start = 0;
  while (start < diffText.length) {
    chunks.push(diffText.slice(start, start + MAX_COMMENT));
    start += MAX_COMMENT;
  }

  for (let i = 0; i < chunks.length; i++) {
    await axios.post(`https://api.github.com/repos/${repo}/commits/${sha}/comments`, {
      body: chunks.length > 1 ? `**Part ${i + 1}/${chunks.length}**\n\n${chunks[i]}` : chunks[i]
    }, {
      headers: { Authorization: `token ${token}` }
    });
  }
  console.log("✅ GitHub diff posted");
}

// Main
async function main() {
  const prev = JSON.parse(fs.readFileSync("previous.json", "utf8"));
  const curr = JSON.parse(fs.readFileSync("current.json", "utf8"));
  const commitUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;

  const fullDiff = generateDiff(prev, curr);
  fs.writeFileSync("full_diff.txt", fullDiff);

  const summary = discordSummary(prev, curr, commitUrl);

  // Always post both
  await postDiscord(summary);
  await postGitHub(fullDiff);
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
