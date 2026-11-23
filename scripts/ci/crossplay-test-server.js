const { spawn } = require("node:child_process");
const path = require("node:path");
const { createServer } = require("./serve");
const { createRelay } = require("../../relay/server.cjs");

const host = "127.0.0.1";
const origin = `http://${host}:${process.env.E2E_PORT}`;
const { server, sockets } = createRelay({ origins: [origin] });
const webBuild = process.env.CROSSPLAY_WEB_BUILD_DIR;
const relayPort = webBuild ? Number(process.env.CROSSPLAY_TEST_RELAY_PORT) : 0;
if (webBuild && !relayPort)
  throw new Error(
    "Set CROSSPLAY_TEST_RELAY_PORT to match the production web build's endpoint.",
  );
server.listen(relayPort, host, () => {
  if (webBuild) {
    const app = createServer(path.resolve(webBuild));
    app.listen(Number(process.env.E2E_PORT), host);
    const stop = () => {
      for (const client of sockets.clients) client.terminate();
      server.close();
      app.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  const child = spawn(process.execPath, ["scripts/dev/run.js", "start"], {
    stdio: "inherit",
    env: {
      ...process.env,
      BROWSER: "none",
      HOST: host,
      PORT: process.env.E2E_PORT,
      ELECTRIFY_E2E: "1",
      REACT_APP_DESKTOP: "true",
      REACT_APP_COOP_RELAY_URL: `ws://${host}:${server.address().port}/v1`,
    },
  });
  const stop = () => {
    for (const client of sockets.clients) client.terminate();
    server.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      child.kill(signal);
      stop();
    });
  child.once("exit", (status) => {
    stop();
    process.exitCode = status ?? 1;
  });
});
