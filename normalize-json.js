const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const filePath = path.join(__dirname, 'discordclasses.json');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Format using Prettier
const formatted = prettier.format(content, {
  parser: 'json',
  tabWidth: 2,
  useTabs: false,
  endOfLine: 'lf',
});

// Write back the normalized content
fs.writeFileSync(filePath, formatted, 'utf8');
console.log('discordclasses.json normalized ✅');
