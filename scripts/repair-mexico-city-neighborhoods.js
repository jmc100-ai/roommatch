/**
 * @deprecated Use scripts/repair-city-neighborhoods.js --city="Mexico City"
 *
 *   node scripts/repair-city-neighborhoods.js --city="Mexico City"
 */
console.warn("[repair-mexico-city-neighborhoods] deprecated — use repair-city-neighborhoods.js --city=\"Mexico City\"");
require("child_process").execSync(
  'node "' + require("path").join(__dirname, "repair-city-neighborhoods.js") + '" --city="Mexico City"',
  { stdio: "inherit", env: process.env },
);
