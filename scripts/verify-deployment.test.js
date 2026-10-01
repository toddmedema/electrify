const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { verifyDeployment } = require("./verify-deployment");

test("deployment checks catch missing, stale, fallback and cached HTML", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "electrify-deploy-"));
  const pages = {
    "/index.html": "<html>Game</html>",
    "/about.html": '<a href="/data-centers.html">Data centers</a>',
    "/data-centers.html": "<html>Data centers</html>",
    "/guide/index.html": "<html>Guide</html>",
  };
  await mkdir(path.join(dir, "guide"));
  for (const [route, body] of Object.entries(pages))
    await writeFile(path.join(dir, route), body);
  let fault;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const page = pages[req.url === "/" ? "/index.html" : req.url];
    const broken = req.url === "/data-centers.html";
    res.writeHead(broken && fault === "missing" ? 404 : 200, {
      "Content-Type":
        broken && fault === "type" ? "text/plain" : "text/html; charset=utf-8",
      "Cache-Control":
        broken && fault === "cache"
          ? "public, max-age=86400"
          : "public, max-age=0, must-revalidate",
    });
    res.end(
      broken && fault === "stale"
        ? "old page"
        : broken && fault === "fallback"
          ? pages["/index.html"]
          : page,
    );
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await verifyDeployment(dir, url);
  assert.deepEqual(requests.sort(), ["/", ...Object.keys(pages)].sort());
  for (const [kind, message] of [
    ["missing", /HTTP 404/],
    ["stale", /HTML differs/],
    ["fallback", /HTML differs/],
    ["type", /expected text/],
    ["cache", /HTML must revalidate/],
  ]) {
    fault = kind;
    await assert.rejects(verifyDeployment(dir, url), message);
  }
  const empty = path.join(dir, "empty");
  await mkdir(empty);
  await assert.rejects(verifyDeployment(empty, url), /no HTML pages/);
});
