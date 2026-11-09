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
  const entries = (result.LD_LIBRARY_PATH || "").split(":");
  const index = entries.indexOf(runtime);
  if (index >= 0) entries.splice(index, 1);
  if (entries.some(Boolean)) result.LD_LIBRARY_PATH = entries.join(":");
  else delete result.LD_LIBRARY_PATH;
  return result;
}

/** Opens an already-approved https URL in the user's browser. */
function openExternalUrl(
  shell,
  href,
  { env = process.env, platform = process.platform, launch = spawn } = {},
) {
  if (platform !== "linux" || !env.ELECTRIFY_RUNTIME_LIB)
    return void shell.openExternal(href);
  try {
    const child = launch("xdg-open", [href], {
      env: hostEnvironment(env),
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => void shell.openExternal(href));
    child.unref();
  } catch {
    void shell.openExternal(href);
  }
}

module.exports = { hostEnvironment, openExternalUrl };
