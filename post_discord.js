const fs = require('fs');
const axios = require('axios');

const diffText = fs.readFileSync('current_diff.txt','utf8');
const commitLink = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
const footer = `\nFull list of changes here: ${commitLink}`;
const MAX_TOTAL = 2000;
const maxDiffLength = MAX_TOTAL - footer.length;
const truncatedDiff = diffText.length > maxDiffLength ? diffText.slice(0, maxDiffLength) + '\n... (truncated)' : diffText;

const payload = {
  content: `**Changes in discordclasses.json:**\n\`\`\`diff\n${truncatedDiff}\n\`\`\`${footer}`
};

axios.post(process.env.DISCORD_WEBHOOK_URL, payload)
  .then(()=>console.log('Discord webhook sent'))
  .catch(console.error);
