const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildVersion, writeBuildVersion } = require("../build-version");

test("build timestamps use fixed PST, 24-hour time, and the requested month spelling", () => {
  for (const [utc, expected] of [
    ["2026-09-26T23:07:00Z", "26sept26-1507"],
    ["2026-01-01T07:59:00Z", "31dec25-2359"],
    ["2026-01-01T08:00:00Z", "01jan26-0000"],
    ["2026-07-01T08:09:00Z", "01jul26-0009"],
  ])
    assert.equal(buildVersion(new Date(utc)), expected);
});

test("the published package endpoint preserves the exact artifact version", () => {
  const sourceVersion = require("../../package.json").version;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-version-"),
  );
  try {
    const version = buildVersion(new Date("2026-09-26T23:07:00Z"));
    writeBuildVersion(version, directory);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"))
        .version,
      version,
    );
    assert.equal(require("../../package.json").version, sourceVersion);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
