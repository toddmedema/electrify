const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { deferStyles } = require("../site/defer-styles");

test("compiled app styles stop blocking startup and remain available without JavaScript", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "startup-css-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "index.html");
  fs.writeFileSync(
    file,
    '<!doctype html><html><head><link href="/static/css/main.hash.css" rel="stylesheet"><link rel="icon" href="/favicon.ico"></head><body></body></html>',
  );
  deferStyles(file);
  const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
    runScripts: "dangerously",
  });
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const css = document.querySelector("link[data-app-style]");
  assert.equal(css.media, "print");
  css.dispatchEvent(new dom.window.Event("load"));
  assert.equal(css.media, "all");
  assert.match(document.querySelector("noscript").textContent, /main.hash.css/);
  assert.equal(document.querySelector('link[rel="icon"]').href, "/favicon.ico");
});
