const fs = require('fs');
const _ = require('lodash');
const axios = require('axios');
const leven = require('fast-levenshtein');

const mode = process.argv[2] || 'discord'; // "discord" or "github"

function parseJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

const oldData = parseJson('previous.json');
const newData = parseJson('current.json');

const added = {};
const removed = {};
const renamed = {};
const moved = {};

// Compare modules
for (const [modId, curr] of Object.entries(newData)) {
  const prev = oldData[modId] || {};
  const prevKeys = Object.keys(prev);
  const currKeys = Object.keys(curr);

  // Added keys
  const addedKeys = currKeys.filter(k => !prevKeys.includes(k));
  if (addedKeys.length) added[modId] = _.pick(curr, addedKeys);

  // Removed keys
  const removedKeys = prevKeys.filter(k => !currKeys.includes(k));
  if (removedKeys.length) removed[modId] = _.pick(prev, removedKeys);

  // Renamed detection (same value different key)
  const possibleRenames = [];
  for (const k1 of removedKeys) {
    for (const k2 of addedKeys) {
      if (prev[k1] === curr[k2]) possibleRenames.push([k1, k2]);
    }
  }
  if (possibleRenames.length) {
    renamed[modId] = possibleRenames;
    // Remove from added/removed
    possibleRenames.forEach(([oldK, newK]) => {
      delete added[modId][newK];
      delete removed[modId][oldK];
      if (!Object.keys(added[modId]).length) delete added[modId];
      if (!Object.keys(removed[modId]).length) delete removed[modId];
    });
  }

  // Moved modules (keys present but values changed)
  const movedKeys = currKeys.filter(k => prev[k] && prev[k] !== curr[k]);
  if (movedKeys.length) {
    moved[modId] = { from: _.pick(prev, movedKeys), to: _.pick(curr, movedKeys) };
  }
}

// Build Discord summary
if (mode === 'discord' || mode === 'summary') {
  let summary = '';
  const modules = _.uniq([
    ...Object.keys(added),
    ...Object.keys(removed),
    ...Object.keys(renamed),
    ...Object.keys(moved)
  ]);
  modules.forEach(modId => {
    const parts = [];
    if (added[modId]) parts.push(`Added: ${Object.keys(added[modId]).length}`);
    if (removed[modId]) parts.push(`Removed: ${Object.keys(removed[modId]).length}`);
    if (renamed[modId]) parts.push(`Renamed: ${renamed[modId].length}`);
    if (moved[modId]) parts.push(`Moved: ${Object.keys(moved[modId].to).length}`);
    summary += `Module ${modId}: ${parts.join(', ')}\n`;
  });

  if (summary) {
    summary += `\nView full list of changes here: https://github.com/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
    axios.post(process.env.DISCORD_WEBHOOK_URL, { content: summary })
      .then(() => console.log('Discord post successful'))
      .catch(err => console.error('Discord post failed:', err.message));
  } else {
    console.log('No changes to post to Discord');
  }
}

// Build GitHub diff
if (mode === 'github' || mode === 'discord') {
  let fullDiff = '';

  function writeDiff(modId, type, obj) {
    if (!obj || !Object.keys(obj).length) return;
    fullDiff += `### ${type} in module ${modId}\n\`\`\`diff\n`;
    for (const [k, v] of Object.entries(obj)) {
      fullDiff += (type === 'Added' ? `+ "${k}": "${v}"\n` : `- "${k}": "${v}"\n`);
    }
    fullDiff += '```\n';
  }

  Object.entries(added).forEach(([modId, obj]) => writeDiff(modId, 'Added', obj));
  Object.entries(removed).forEach(([modId, obj]) => writeDiff(modId, 'Removed', obj));

  // Renamed
  Object.entries(renamed).forEach(([modId, arr]) => {
    if (!arr.length) return;
    fullDiff += `### Renamed in module ${modId}\n\`\`\`diff\n`;
    arr.forEach(([oldK, newK]) => {
      fullDiff += `- "${oldK}": "${oldData[modId][oldK]}"\n`;
      fullDiff += `+ "${newK}": "${newData[modId][newK]}"\n`;
    });
    fullDiff += '```\n';
  });

  // Moved
  Object.entries(moved).forEach(([modId, data]) => {
    const fromKeys = Object.keys(data.from || {});
    const toKeys = Object.keys(data.to || {});
    if (!fromKeys.length && !toKeys.length) return;

    const addedKeys = toKeys.filter(k => !fromKeys.includes(k));
    const removedKeys = fromKeys.filter(k => !toKeys.includes(k));

    if (addedKeys.length) {
      fullDiff += `### Added in module ${modId}\n\`\`\`diff\n`;
      addedKeys.forEach(k => fullDiff += `+ "${k}": "${data.to[k]}"\n`);
      fullDiff += '```\n';
    }
    if (removedKeys.length) {
      fullDiff += `### Removed from module ${modId}\n\`\`\`diff\n`;
      removedKeys.forEach(k => fullDiff += `- "${k}": "${data.from[k]}"\n`);
      fullDiff += '```\n';
    }
  });

  fs.writeFileSync('full_diff.txt', fullDiff);
  console.log('GitHub diff generated: full_diff.txt');

  // Post as GitHub comment
  if (mode === 'github') {
    const { Octokit } = require('@octokit/rest');
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    if (!fullDiff.trim()) {
      console.log('No diff to post');
      process.exit(0);
    }

    const MAX_COMMENT_LENGTH = 65000;
    const chunks = [];
    let start = 0;
    while (start < fullDiff.length) {
      chunks.push(fullDiff.slice(start, start + MAX_COMMENT_LENGTH));
      start += MAX_COMMENT_LENGTH;
    }

    (async () => {
      for (let i = 0; i < chunks.length; i++) {
        const body = chunks.length > 1
          ? `**Part ${i + 1} of ${chunks.length}**\n\n${chunks[i]}`
          : chunks[i];

        await octokit.rest.repos.createCommitComment({
          owner: process.env.GITHUB_REPOSITORY.split('/')[0],
          repo: process.env.GITHUB_REPOSITORY.split('/')[1],
          commit_sha: process.env.GITHUB_SHA,
          body,
        });
        console.log(`Posted GitHub comment part ${i + 1}/${chunks.length}`);
      }
    })();
  }
}
