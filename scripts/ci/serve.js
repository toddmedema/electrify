const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function createServer(root = path.resolve("build")) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (file !== root && !file.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const target = file === root ? path.join(root, "index.html") : file;
      const contents = await fs.readFile(target);
      response
        .writeHead(200, {
          "Content-Type":
            types[path.extname(target)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(contents);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
    }
  });
}

if (require.main === module)
  createServer(path.resolve(process.env.E2E_BUILD_DIR || "build")).listen(
    Number(process.env.E2E_PORT || 3100),
    "127.0.0.1",
  );
module.exports = { createServer };
