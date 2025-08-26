const fs = require("fs");
const axios = require("axios");
const { Octokit } = require("@octokit/rest");

const mode = process.argv[2] || "discord";

// Load diff text
const diffText = fs.existsSync("full_diff.txt")
  ? fs.readFileSync("full_diff.txt", "utf8")
  : "";

async function postToDiscord() {
  if (!diffText.trim()) {
    console.log("No diff to post to Discord.");
    return;
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.error("Missing DISCORD_WEBHOOK_URL env variable");
    process.exit(1);
  }

  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  const serverUrl = process.env.GITHUB_SERVER_URL;

  const shortSummary = diffText
    .split("\n")
    .filter((line) => line.startsWith("Module"))
    .join("\n");

  const body = {
    content: `\`\`\`\n${shortSummary}\n\`\`\`\n\nView full list of changes here: ${serverUrl}/${repo}/commit/${sha}`,
  };

  await axios.post(webhook, body);
  console.log("✅ Posted summary to Discord");
}

async function postToGitHub() {
  if (!diffText.trim()) {
    console.log("No diff to post to GitHub.");
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Missing GITHUB_TOKEN env variable");
    process.exit(1);
  }

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
  const sha = process.env.GITHUB_SHA;

  const octokit = new Octokit({ auth: token });

  await octokit.repos.createCommitComment({
    owner,
    repo,
    commit_sha: sha,
    body: diffText,
  });

  console.log("✅ Posted full diff as GitHub commit comment");
}

(async () => {
  if (mode === "discord") {
    await postToDiscord();
  } else if (mode === "github") {
    await postToGitHub();
  } else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
  }
})();
