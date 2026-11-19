// Standalone CRA previews reserve a port for their lifetime and CPU capacity for
// each compilation. A preview nested in a validation command uses its parent's slot.
const { spawnSync } = require("node:child_process");
const { acquireLease, heavySlots } = require("./coordination");
const { checkDependencies } = require("./preflight");
const { checkAssets } = require("../check-assets");
const { taskId } = require("./task");
const { setTimeout: delay } = require("node:timers/promises");

class PreviewCompilation {
  constructor(root, signal, checkout = process.cwd()) {
    this.signal = signal;
    this.root = root;
    this.checkout = checkout;
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
    try {
      if (this.lease.queued) checkDependencies(this.checkout);
    } catch (error) {
      this.release();
      throw error;
    }
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
    const checker = require(
      require.resolve("react-dev-utils/ForkTsCheckerWebpackPlugin", {
        paths: [this.checkout],
      }),
    );
    let finishing;
    const completions = new WeakMap();
    const beginCompletion = () => {
      if (!finishing) {
        let resolve;
        const promise = new Promise((done) => {
          resolve = done;
        });
        finishing = { promise, resolve, lease: this.lease };
      }
      return finishing;
    };
    const finish = (completion = beginCompletion()) => {
      completion.draining ??= (async () => {
        // Watch-mode fatal errors do not disconnect ForkTsChecker. Both normal
        // and failed builds retain their slot until its workers have settled.
        while (checker.issuesPool.pending || checker.dependenciesPool.pending)
          await delay(50);
        if (this.lease === completion.lease) this.release();
        if (finishing === completion) finishing = undefined;
        completion.resolve();
      })();
      return completion.draining;
    };
    compiler.hooks.watchRun.tapPromise(
      { name: "ElectrifyPreview", stage: -Infinity },
      async () => {
        // Webpack clears Watching.running before awaiting done. Explicit
        // invalidation can enter watchRun while the previous cycle still drains.
        if (finishing) await finishing.promise;
        await this.acquire();
      },
    );
    compiler.hooks.done.tap(
      { name: "ElectrifyPreview", stage: -Infinity },
      (stats) => completions.set(stats.compilation, beginCompletion()),
    );
    // Let CRA publish HMR before draining, then release this completion's lease.
    // afterDone may run after another watch cycle has already started.
    compiler.hooks.done.tapPromise(
      { name: "ElectrifyPreview", stage: Infinity },
      (stats) => finish(completions.get(stats.compilation)),
    );
    for (const hook of [compiler.hooks.failed, compiler.hooks.watchClose])
      hook.tap("ElectrifyPreview", () => {
        void finish();
      });
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
    await compile.acquire();
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
    require(entry).start(compile);
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
