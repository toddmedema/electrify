#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function checkAssets(root = process.cwd()) {
  // Read headers only; artwork and soundtracks can be hundreds of MB. Tracked paths exclude
  // old worktrees and local screenshots without depending on git-lfs being installed.
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--", "public", "design"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  )
    .split("\0")
    .filter(Boolean);
  const missing = [];
  for (const file of files) {
    let fd;
    try {
      fd = fs.openSync(path.join(root, file), "r");
      const header = Buffer.alloc(80);
      const length = fs.readSync(fd, header, 0, header.length, 0);
      if (
        header
          .subarray(0, length)
          .toString()
          .startsWith("version https://git-lfs.github.com/spec/")
      )
        missing.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  if (missing.length)
    throw new Error(
      [
        `Asset preflight failed: ${missing.length} tracked files are missing or Git LFS pointers.`,
        ...missing.slice(0, 12),
        ...(missing.length > 12 ? [`...and ${missing.length - 12} more`] : []),
        "Run git lfs pull, then git lfs checkout in this worktree before retrying.",
      ].join("\n"),
    );
  console.error(`Asset preflight passed (${files.length} tracked files).`);
}

if (require.main === module) {
  try {
    checkAssets();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { checkAssets };
