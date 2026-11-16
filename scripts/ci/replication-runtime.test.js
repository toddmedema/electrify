const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");
const loader = path.resolve(root, "scripts/testing/replication-runtime.js");

test("the standalone replica runtime executes repository TypeScript", () => {
  const source = path.resolve(root, "src/helpers/Pow.ts");
  const result = execFileSync(process.execPath, [
    "-e",
    `require(${JSON.stringify(loader)})(); process.stdout.write(String(require(${JSON.stringify(source)}).pow(2, 3)))`,
  ]);
  assert.equal(result.toString(), "8");
});

test("the standalone replica runtime refuses TypeScript outside repository source", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "replica-runtime-"));
  const filename = path.join(directory, "outside.ts");
  fs.writeFileSync(filename, "module.exports = 42;");
  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            "-e",
            `require(${JSON.stringify(loader)})(); require(${JSON.stringify(filename)})`,
          ],
          { stdio: "pipe" },
        ),
      /only transforms repository source/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
