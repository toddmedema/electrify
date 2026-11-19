// Standalone CRA previews reserve a port for their lifetime and CPU capacity for
// each compilation. A preview nested in a validation command uses its parent's slot.
const { spawnSync } = require("node:child_process");
const { acquireLease, heavySlots } = require("./coordination");
const { checkDependencies } = require("./preflight");
const { checkAssets } = require("../check-assets");
const { taskId } = require("./task");
const { setTimeout: delay } = require("node:timers/promises");

class PreviewCompilation {
  constructor(root, signal) {
    this.signal = signal;
    this.root = root;
  }

  async acquire() {
    // Webpack may invalidate an in-flight build and go straight back to
    // watchRun without calling afterDone for the superseded compilation.
    if (this.lease) return this.lease;
    this.lease = await acquireLease("heavy", {
      root: this.root,
      signal: this.signal,
      slots: heavySlots,
      command: "start (compile)",
      task: taskId(),
      onWait: (owner, position) =>
        console.error(
          `Preview compilation queued at position ${position} behind PID ${owner.pid}. Use npm run task -- queue for details.`,
        ),
    });
    this.lease.setChild(
      process.pid,
      Number(process.env.ELECTRIFY_DEVELOPMENT_GROUP) || undefined,
    );
    return this.lease;
  }

  release() {
    this.lease?.release();
    this.lease = undefined;
  }

  apply(compiler) {
    compiler.hooks.watchRun.tapPromise(
      { name: "ElectrifyPreview", stage: -Infinity },
      () => this.acquire(),
    );
    // CRA's development type checker can keep compiling after webpack emits
    // "Compiled successfully". Its pool belongs to this preview process. Let
    // the normal done handlers publish HMR immediately, then finish this build
    // before afterDone yields the slot or webpack starts another watch cycle.
    const checker = require("react-dev-utils/ForkTsCheckerWebpackPlugin");
    compiler.hooks.done.tapPromise(
      { name: "ElectrifyPreview", stage: Infinity },
      async () => {
        while (checker.issuesPool.pending)
          await delay(50, undefined, { signal: this.signal });
      },
    );
    for (const hook of [
      compiler.hooks.afterDone,
      compiler.hooks.failed,
      compiler.hooks.watchClose,
    ])
      hook.tap("ElectrifyPreview", () => this.release());
  }
}

async function startPreview({ coordinationRoot, entry, args, prepare }) {
  const abort = new AbortController();
  const stopWaiting = () => abort.abort();
  process.once("SIGINT", stopWaiting);
  process.once("SIGTERM", stopWaiting);
  const compile = new PreviewCompilation(coordinationRoot, abort.signal);
  process.once("exit", () => compile.release());
  try {
    if ((await compile.acquire()).queued) checkDependencies();
    checkAssets(process.cwd());
    for (const generator of prepare) {
      const result = spawnSync(process.execPath, [generator], {
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        process.exitCode = result.status || 1;
        compile.release();
        return;
      }
    }
    process.argv = [process.execPath, entry, ...args];
    require("../start").start(compile);
  } catch (error) {
    compile.release();
    throw error;
  }
}

if (require.main === module) {
  startPreview(JSON.parse(process.argv[2])).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { PreviewCompilation };
