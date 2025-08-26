// normalize-json.js
const fs = require('fs');
const prettier = require('prettier');

const filePath = 'discordclasses.json';

try {
  // Read JSON file
  const rawData = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(rawData);

  // Pretty-print using Prettier
  const prettyJson = prettier.format(JSON.stringify(jsonData), {
    parser: 'json',
    printWidth: 80,
    tabWidth: 2,
  });

  // Write back normalized JSON
  fs.writeFileSync(filePath, prettyJson, 'utf8');
  console.log(`✅ ${filePath} normalized successfully.`);
} catch (err) {
  console.error(`❌ Failed to normalize ${filePath}:`, err.message);
  process.exit(1);
}
