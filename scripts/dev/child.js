// Do not start generators or commands until the supervisor records this PID.
const { spawn, spawnSync } = require("node:child_process");
let child;
let stopping;
function stop(signal) {
  stopping = signal;
  if (!child) return finish(signal === "SIGINT" ? 130 : 143);
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  else child.kill(signal);
}
function finish(code) {
  process.exitCode = code;
  if (process.connected) process.disconnect();
}
function execute(entry, args) {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.once("close", (code, signal) =>
      resolve(code ?? (signal === "SIGINT" ? 130 : 1)),
    );
  });
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.once("message", async ({ entry, args, prepare = [], ownsGroup }) => {
  if (stopping) return finish(stopping === "SIGINT" ? 130 : 143);
  if (ownsGroup) process.env.ELECTRIFY_DEVELOPMENT_GROUP = String(process.pid);
  for (const generator of prepare) {
    const code = await execute(generator, []);
    if (code || stopping) return finish(code || 1);
  }
  if (!stopping) finish(await execute(entry, args));
});
// If the supervisor dies during the handshake, no work may have started. Once
// started, remain alive until the command finishes, retaining its recorded lease.
process.on("disconnect", () => {
  if (!child) process.exitCode = 1;
});
