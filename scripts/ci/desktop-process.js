/** Native diagnostics must not strand cleanup when Electron stops answering RPCs. */
async function desktopDeadline(label, operation, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${label} did not finish within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeDesktop(
  { app, nativeProcess: child, isClosed },
  { force = false, timeoutMs = force ? 5000 : 30_000 } = {},
) {
  const running = () => child.exitCode === null && child.signalCode === null;
  if (!running()) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (force && running()) child.kill("SIGKILL");
  try {
    await desktopDeadline(
      "Closing Electron",
      async () => {
        if (!isClosed()) await app.close();
        await exited;
      },
      timeoutMs,
    );
  } catch (error) {
    if (running()) child.kill("SIGKILL");
    await desktopDeadline("Stopping Electron", () => exited);
    // A passing test must still report a broken graceful close.
    if (!force) throw error;
  }
}

module.exports = { desktopDeadline, closeDesktop };
