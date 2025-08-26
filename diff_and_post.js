const fs = require('fs');
const _ = require('lodash');
const levenshtein = require('fast-levenshtein');
const axios = require('axios');

// Environment
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const commitSha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const serverUrl = process.env.GITHUB_SERVER_URL;

// Load JSON files
function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const prev = loadJson('previous.json');
const curr = loadJson('current.json');

// Helpers
function diffModules(prevObj, currObj) {
  const removed = [];
  const added = [];
  const renamed = [];
  const moved = [];

  for (const moduleId of Object.keys(prevObj)) {
    if (!currObj[moduleId]) {
      removed.push(`Module \`${moduleId}\``);
      continue;
    }

    const prevKeys = Object.keys(prevObj[moduleId]);
    const currKeys = Object.keys(currObj[moduleId]);

    // Removed keys
    prevKeys.forEach(k => {
      if (!currKeys.includes(k)) removed.push(`${k} removed from Module \`${moduleId}\``);
    });

    // Added keys
    currKeys.forEach(k => {
      if (!prevKeys.includes(k)) added.push(`${k} added to Module \`${moduleId}\``);
    });

    // Renamed detection (simple heuristic)
    prevKeys.forEach(pk => {
      currKeys.forEach(ck => {
        const dist = levenshtein.get(pk, ck);
        if (dist > 0 && dist <= 3 && prevObj[moduleId][pk] === currObj[moduleId][ck]) {
          renamed.push(`${pk} → ${ck} in Module \`${moduleId}\``);
        }
      });
    });
  }

  // Moved detection (if keys exist in both but modules changed)
  const prevKeyMap = _.flatMap(Object.entries(prevObj), ([mod, keys]) =>
    Object.keys(keys).map(k => ({ key: k, module: mod }))
  );
  const currKeyMap = _.flatMap(Object.entries(currObj), ([mod, keys]) =>
    Object.keys(keys).map(k => ({ key: k, module: mod }))
  );

  prevKeyMap.forEach(p => {
    const c = currKeyMap.find(x => x.key === p.key && x.module !== p.module);
    if (c) moved.push(`${p.key} moved from Module \`${p.module}\` to Module \`${c.module}\``);
  });

  return { removed, added, renamed, moved };
}

// Generate diff text
function generateDiffText(diffObj) {
  let text = '';
  if (diffObj.removed.length) text += '### Removed\n' + diffObj.removed.map(x => `- ${x}`).join('\n') + '\n';
  if (diffObj.added.length) text += '### Added\n' + diffObj.added.map(x => `+ ${x}`).join('\n') + '\n';
  if (diffObj.renamed.length) text += '### Renamed\n' + diffObj.renamed.map(x => `* ${x}`).join('\n') + '\n';
  if (diffObj.moved.length) text += '### Moved\n' + diffObj.moved.map(x => `* ${x}`).join('\n') + '\n';
  return text;
}

// Post to Discord
async function postToDiscord(text) {
  const MAX_LENGTH = 2000;
  let truncated = text;
  if (text.length > MAX_LENGTH - 50) { // reserve for commit link
    truncated = text.slice(0, MAX_LENGTH - 50) + '\n...';
  }
  truncated += `\nFull details here: ${serverUrl}/${repo}/commit/${commitSha}`;
  await axios.post(webhookUrl, { content: `\`\`\`diff\n${truncated}\`\`\`` });
}

// Prepare GitHub comment
function generateGitHubComments(text) {
  const MAX_LENGTH = 65000;
  const comments = [];
  let start = 0;
  while (start < text.length) {
    comments.push(text.slice(start, start + MAX_LENGTH));
    start += MAX_LENGTH;
  }
  return comments;
}

// Main
(async () => {
  const diffs = diffModules(prev, curr);
  const diffText = generateDiffText(diffs);

  if (!diffText.trim()) {
    console.log('No changes detected');
    return;
  }

  // Discord
  if (webhookUrl) await postToDiscord(diffText);

  // GitHub (write to file for github-script)
  fs.writeFileSync('full_diff.txt', diffText);
})();
