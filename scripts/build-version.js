const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sept",
  "oct",
  "nov",
  "dec",
];

function buildVersion(now = new Date(), version = packageJson.version) {
  // PST is UTC-8 year-round, independent of the build machine and daylight saving time.
  const pst = new Date(now.getTime() - 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${version}-${pad(pst.getUTCDate())}${MONTHS[pst.getUTCMonth()]}${pad(pst.getUTCFullYear() % 100)}-${pad(pst.getUTCHours())}${pad(pst.getUTCMinutes())}`;
}

function writeBuildVersion(version, directory = "build") {
  // The deployed version endpoint must describe this artifact, not the source package.
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ ...packageJson, version }, null, 2) + "\n",
  );
}

module.exports = { buildVersion, writeBuildVersion };
