// normalize-json.js
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'discordclasses.json');

try {
  const rawData = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(rawData);

  // Recursively sort object keys
  function sortKeys(obj) {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj && typeof obj === 'object') {
      return Object.keys(obj)
        .sort()
        .reduce((res, key) => {
          res[key] = sortKeys(obj[key]);
          return res;
        }, {});
    }
    return obj;
  }

  const normalized = sortKeys(jsonData);

  // Write back to file with 2-space indentation
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  console.log('discordclasses.json normalized successfully.');
} catch (err) {
  console.error('Error normalizing discordclasses.json:', err.message);
  process.exit(1);
}
