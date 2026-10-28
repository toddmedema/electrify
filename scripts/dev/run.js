const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const { acquireLease, reservePort, groupAlive } = require("./coordination");
const { setTimeout: delay } = require("node:timers/promises");
const { claimTask } = require("./task");
const { checkAssets } = require("../check-assets");

const generators = [
  "scripts/run-compatibility.js",
  "scripts/generate-icon-manifest.js",
];
const commands = {
  check: { entry: "scripts/check.js", port: true, generators },
  build: { entry: "scripts/build.js", generators },
  "desktop-build": { entry: "scripts/desktop-build.js" },
  start: { entry: "scripts/start.js", generators, port: true },
  jest: {
    entry: "node_modules/react-scripts/bin/react-scripts.js",
    generators,
  },
  playwright: {
    entry: "node_modules/@playwright/test/cli.js",
    generators,
    port: true,
  },
  sim: { entry: "scripts/sim.js", generators: generators.slice(0, 1) },
  bench: { entry: "scripts/perf/bench.js" },
  "ci-tests": { entry: "scripts/ci/test-suites.js" },
  types: {
    entry: "scripts/dev/typecheck.js",
    generators: generators.slice(0, 1),
  },
};

async function runCommand(command, args = [], options = {}) {
  const root = options.root || process.cwd();
  const env = { ...process.env, ...options.env };
  const descriptor = commands[command];
  if (!descriptor) throw new Error(`Unknown development command: ${command}`);
  if (
    command === "start" &&
    env.PORT &&
    env.E2E_PORT &&
    env.PORT !== env.E2E_PORT
  )
    throw new Error("PORT and E2E_PORT must match when both are set");
  const diagnostic =
    args.includes("--help") ||
    args.includes("--report") ||
    args.includes("--list");
  const local = env.GITHUB_ACTIONS !== "true" && !diagnostic;
  const abort = new AbortController();
  let child, lease, portLease;
  let stopped;
  let escalation;
  // Only the outermost wrapper starts a process group. Nested npm wrappers stay
  // in it, so cancellation cannot leave detached suites behind the supervisor.
  let ownsGroup = process.platform !== "win32";
  const stop = (signal) => {
    stopped = signal;
    abort.abort();
    if (!child) return;
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else {
      try {
        process.kill(ownsGroup ? -child.pid : child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      if (ownsGroup && !escalation) {
        escalation = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (error) {
            if (error.code !== "ESRCH") console.error(error.message);
          }
        }, 5000);
        escalation.unref();
      }
    }
  };
  const onInt = () => stop("SIGINT");
  const onTerm = () => stop("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    if (local) {
      claimTask(root);
      lease = await acquireLease("heavy", {
        slots: 3,
        root: options.coordinationRoot,
        inherited: env.ELECTRIFY_DEVELOPMENT_LEASE,
        signal: abort.signal,
        onWait: (owner) =>
          console.error(
            `Waiting for validation in ${owner.cwd} (PID ${owner.pid}); running suites remain uninterrupted.`,
          ),
      });
      env.ELECTRIFY_DEVELOPMENT_LEASE = lease.token;
      if (!lease.inherited) {
        // An install mismatch is detected before any generator, build or test.
        require("./preflight").checkDependencies(root);
        checkAssets(root);
        env.ELECTRIFY_COORDINATION_WAIT_MS = String(lease.waitMs);
        console.error(
          `Validation slot acquired after ${(lease.waitMs / 1000).toFixed(1)}s.`,
        );
      }
      const needsPort =
        descriptor.port &&
        (command !== "check" ||
          require("../check")
            .selectSteps(args)
            .some(({ id }) =>
              ["browser", "multiplayer", "steam-input"].includes(id),
            ));
      if (needsPort && !lease.inherited) {
        portLease = await reservePort(
          env.E2E_PORT || (command === "start" ? env.PORT : undefined),
          { root: options.coordinationRoot, signal: abort.signal },
        );
        env.E2E_PORT = String(portLease.port);
        console.error(`Reserved E2E_PORT=${portLease.port}`);
      }
      if (command === "start") env.PORT = env.PORT || env.E2E_PORT;
    }
    if (process.platform !== "win32") {
      const inheritedGroup = Number(env.ELECTRIFY_DEVELOPMENT_GROUP);
      const validGroup =
        groupAlive(inheritedGroup) &&
        (!local || (lease?.inherited && lease.groupId === inheritedGroup));
      if (local && lease?.inherited && !validGroup)
        throw new Error(
          "Inherited validation lease has no matching live process group.",
        );
      ownsGroup = !validGroup;
    }
    // CI's native workers intentionally suppress generators after adopting the
    // verified build. Run the remaining generators inside the supervised group.
    const prepare =
      !diagnostic && env.npm_config_ignore_scripts !== "true"
        ? (descriptor.generators || []).map((generator) =>
            path.join(root, generator),
          )
        : [];
    const result = await new Promise((resolve, reject) => {
      child = fork(path.join(__dirname, "child.js"), [], {
        cwd: root,
        env,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        detached: ownsGroup,
        windowsHide: true,
      });
      const groupId = ownsGroup ? child.pid : undefined;
      if (lease && !lease.inherited) lease.setChild(child.pid, groupId);
      if (portLease) portLease.setChild(child.pid, groupId);
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve(code ?? (signal === "SIGINT" ? 130 : 1)),
      );
      child.send({
        entry: path.join(root, descriptor.entry),
        args,
        prepare,
        ownsGroup,
      });
    });
    return stopped ? (stopped === "SIGINT" ? 130 : 143) : result;
  } finally {
    let released = false;
    try {
      if (ownsGroup && child?.pid) {
        // The immediate child can exit before npm/Jest/browser descendants.
        // Keep the reservation until the whole group has gone away. A killed
        // supervisor leaves this same group ID in its recoverable lease.
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          if (!groupAlive(child.pid)) break;
          try {
            process.kill(-child.pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
          const deadline = Date.now() + 5000;
          while (groupAlive(child.pid) && Date.now() < deadline)
            await delay(50);
        }
        if (groupAlive(child.pid))
          throw new Error(
            "Command descendants are still running; validation reservation retained.",
          );
      }
      portLease?.release();
      lease?.release();
      released = true;
    } finally {
      clearTimeout(escalation);
      if (!released && lease && !lease.inherited)
        console.error(
          "Validation reservation remains until its command group exits.",
        );
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
    }
  }
}

if (require.main === module)
  runCommand(process.argv[2], process.argv.slice(3))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { runCommand, commands };
