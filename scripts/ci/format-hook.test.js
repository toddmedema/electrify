const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("the edit hook formats supported files with local Prettier, including paths with spaces", (t) => {
  const parent = path.resolve(".tmp", "format-hook-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "checkout with spaces-"));
  t.after(() => {
    assert(root.startsWith(parent + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const hook = path.resolve(".claude/hooks/format-edited-file.js");
  const run = (input) => {
    const result = spawnSync(process.execPath, [hook], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const source = "const value={a:1,b:2}";
  const formatted = "const value = { a: 1, b: 2 };\n";
  for (const relative of [
    path.join("src", "nested folder", "example.ts"),
    path.join("e2e", "example.ts"),
    path.join("scripts", "example.js"),
    path.join("electron", "example.cjs"),
    path.join("electron", "electron-builder.config.cjs"),
  ]) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    // Absolute and relative tool paths must both resolve within this checkout.
    run({ tool_input: { file_path: file } });
    assert.equal(fs.readFileSync(file, "utf8"), formatted, relative);
    fs.writeFileSync(file, source);
    run({ tool_input: { file_path: relative } });
    assert.equal(fs.readFileSync(file, "utf8"), formatted, relative);
  }
  for (const relative of ["README.md", path.join("..", "outside.ts")]) {
    const file = path.resolve(root, relative);
    fs.writeFileSync(file, source);
    if (!file.startsWith(root + path.sep)) t.after(() => fs.unlinkSync(file));
    run({ tool_input: { file_path: file } });
    assert.equal(fs.readFileSync(file, "utf8"), source);
  }
  run("malformed JSON");
  run({});
  const invalid = path.join(root, "src", "invalid.ts");
  fs.writeFileSync(invalid, "const =");
  run({ tool_input: { file_path: invalid } });
  assert.equal(fs.readFileSync(invalid, "utf8"), "const =");
});
