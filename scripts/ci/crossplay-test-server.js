const { spawn } = require("node:child_process");
const { createRelay } = require("../../relay/server.cjs");

const host = "127.0.0.1";
const origin = `http://${host}:${process.env.E2E_PORT}`;
const { server, sockets } = createRelay({ origins: [origin] });
server.listen(0, host, () => {
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
