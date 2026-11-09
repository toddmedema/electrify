const { spawn } = require("node:child_process");

/**
 * The packaged Linux launcher prepends the depot's Ubuntu NSS/NSPR/SQLite libraries and names
 * that entry in ELECTRIFY_RUNTIME_LIB. Programs we start for the user, such as their browser,
 * must not inherit it: LD_LIBRARY_PATH outranks their own RUNPATH (NixOS and Flatpak builds
 * included) and would load our older NSS instead of theirs.
 */
function hostEnvironment(env = process.env) {
  const result = { ...env };
  const runtime = result.ELECTRIFY_RUNTIME_LIB;
  delete result.ELECTRIFY_RUNTIME_LIB;
  if (!runtime) return result;
  const entries = (result.LD_LIBRARY_PATH || "")
    .split(":")
    .filter((entry) => entry !== runtime);
  if (entries.some(Boolean)) result.LD_LIBRARY_PATH = entries.join(":");
  else delete result.LD_LIBRARY_PATH;
  return result;
}

/** Opens an already-approved https URL in the user's browser. */
function openExternalUrl(
  shell,
  href,
  {
    env = process.env,
    platform = process.platform,
    launch = spawn,
    dialog,
  } = {},
) {
  if (platform !== "linux" || !env.ELECTRIFY_RUNTIME_LIB)
    return void shell.openExternal(href);
  let handled = false;
  let spawned = false;
  const recover = (uncertain) => {
    if (handled) return;
    handled = true;
    if (!uncertain) return void shell.openExternal(href);
    // A browser can open successfully before its launcher reports a failure.
    // Let the player decide whether another attempt is needed.
    void dialog
      ?.showMessageBox({
        type: "warning",
        message: "Could not confirm that your browser opened the link.",
        detail: `${href}\nIf the link already opened, retrying may open another tab.`,
        buttons: ["Cancel", "Retry"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) return shell.openExternal(href);
      })
      .catch(() => {});
  };
  try {
    const child = launch("xdg-open", [href], {
      env: hostEnvironment(env),
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      spawned = true;
    });
    child.once("error", () => recover(spawned));
    child.once("exit", (code) => {
      if (code !== 0) recover(true);
    });
    child.unref();
  } catch {
    recover(spawned);
  }
}

module.exports = { hostEnvironment, openExternalUrl };
