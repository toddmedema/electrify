const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const {
  queueStatus,
  acquireLease,
  reservePort,
  readOwner,
  removeOwner,
} = require("../dev/coordination");
const { claimTask, releaseTask } = require("../dev/task");

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-coordination-test-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert(predicate(), "Expected asynchronous state was not reached");
}

function message(child, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Missing child message: ${type}`)),
      10000,
    );
    const onMessage = (value) => {
      if (value.type === type) finish(null, value);
    };
    const onExit = (code) =>
      finish(new Error(`Child exited ${code} before ${type}`));
    function finish(error, value) {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value);
    }
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

function worker(t, root, checkout, inherited) {
  const file = path.join(root, "worker.cjs");
  fs.writeFileSync(
    file,
    `
    const {acquireLease}=require(${JSON.stringify(require.resolve("../dev/coordination"))});
    process.once('message', async () => {
      const lease=await acquireLease('heavy', {root:process.env.LOCK_ROOT, inherited:process.env.INHERITED, pollMs:10,
        onWait:()=>process.send({type:'waiting'})});
      process.send({type:'acquired', token:lease.token, inherited:lease.inherited, waitMs:lease.waitMs});
      process.once('message',()=>{lease.release();process.disconnect()});
    });
  `,
  );
  const cwd = path.join(root, checkout);
  fs.mkdirSync(cwd, { recursive: true });
  const child = fork(file, [], {
    cwd,
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    env: {
      ...process.env,
      LOCK_ROOT: path.join(root, "locks"),
      INHERITED: inherited || "",
    },
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  return child;
}

test("two checkouts queue heavy work; valid nested ownership does not deadlock", async (t) => {
  const root = fixture(t);
  const first = worker(t, root, "checkout-a");
  const acquired = message(first, "acquired");
  first.send("start");
  const owner = await acquired;
  const nested = worker(t, root, "checkout-a", owner.token);
  const nestedReady = message(nested, "acquired");
  nested.send("start");
  assert.equal((await nestedReady).inherited, true);
  const nestedExit = once(nested, "exit");
  nested.send("release");
  await nestedExit;
  assert.equal(readOwner(path.join(root, "locks/heavy")).token, owner.token);
  const second = worker(t, root, "checkout-b", "stale-token");
  const waiting = message(second, "waiting");
  const secondReady = message(second, "acquired");
  second.send("start");
  await waiting;
  assert.equal(readOwner(path.join(root, "locks/heavy")).token, owner.token);
  const firstExit = once(first, "exit");
  first.send("release");
  await firstExit;
  const next = await secondReady;
  assert.equal(next.inherited, false);
  assert.notEqual(next.token, owner.token);
  assert(next.waitMs > 0);
  const secondExit = once(second, "exit");
  second.send("release");
  await secondExit;
});

test("three shared validation slots admit three owners and queue the fourth", async (t) => {
  const root = fixture(t);
  const options = { root, slots: 3, wait: false };
  const leases = [];
  t.after(() => leases.forEach((lease) => lease.release()));
  for (let index = 0; index < 3; index++)
    leases.push(await acquireLease("heavy", options));
  assert.equal(new Set(leases.map((lease) => lease.token)).size, 3);
  const nested = await acquireLease("heavy", {
    ...options,
    inherited: leases[1].token,
  });
  assert.equal(nested.inherited, true);
  nested.release();
  await assert.rejects(acquireLease("heavy", options), /held by PID/);
  const abort = new AbortController();
  await assert.rejects(
    acquireLease("heavy", {
      ...options,
      wait: true,
      signal: abort.signal,
      onWait: () => abort.abort(),
    }),
    /abort/i,
  );
  leases[1].release();
  const successor = await acquireLease("heavy", options);
  leases.push(successor);
  leases[1].release();
  await assert.rejects(acquireLease("heavy", options), /held by PID/);
});

test("dead owners are recovered and foreign releases cannot remove the successor", async (t) => {
  const root = fixture(t);
  const first = worker(t, root, "checkout-a");
  const ready = message(first, "acquired");
  first.send("start");
  const owner = await ready;
  const exited = once(first, "exit");
  first.kill("SIGKILL");
  await exited;
  const successor = await acquireLease("heavy", {
    root: path.join(root, "locks"),
    pollMs: 10,
  });
  removeOwner(path.join(root, "locks/heavy"), owner.token);
  assert.equal(
    readOwner(path.join(root, "locks/heavy")).token,
    successor.token,
  );
  successor.release();
});

test("a live command child retains a reservation after its supervisor dies", async (t) => {
  const root = fixture(t);
  const directory = path.join(root, "heavy");
  fs.mkdirSync(directory);
  fs.writeFileSync(
    path.join(directory, "old.json"),
    JSON.stringify({
      token: "old",
      pid: 2147483647,
      childPid: process.pid,
      cwd: "other checkout",
    }),
  );
  await assert.rejects(
    acquireLease("heavy", { root, wait: false }),
    /held by PID/,
  );
  assert.equal(readOwner(directory).token, "old");
});

test("aborting a queued waiter leaves the active reservation intact", async (t) => {
  const root = fixture(t);
  const first = await acquireLease("heavy", { root });
  const abort = new AbortController();
  const pending = acquireLease("heavy", {
    root,
    signal: abort.signal,
    onWait: () => abort.abort(),
  });
  await assert.rejects(pending, /abort/i);
  assert.equal(readOwner(path.join(root, "heavy")).token, first.token);
  first.release();
});

test("ports are reserved uniquely and an occupied listener is left running", async (t) => {
  const root = fixture(t);
  const first = await reservePort(undefined, { root });
  const second = await reservePort(undefined, { root });
  assert.notEqual(first.port, second.port);
  await assert.rejects(reservePort(first.port, { root }), /held by PID/);
  const server = net.createServer((socket) => socket.end("still running"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(reservePort(server.address().port, { root }), {
    code: "EADDRINUSE",
  });
  assert(server.listening);
  first.release();
  second.release();
});

test("checkout claims reject another task and survive command lifetimes", (t) => {
  const root = fixture(t);
  const first = claimTask(root, "task-a");
  assert.equal(claimTask(root, "task-a").token, first.token);
  assert.throws(() => claimTask(root, "task-b"), /isolated worktree/);
  assert.throws(() => releaseTask(root, "task-b"), /Only task task-a/);
  releaseTask(root, "task-a");
  assert.equal(claimTask(root, "task-b").task, "task-b");
  releaseTask(root, "task-b");
});

test("queued work keeps arrival order across slow polling, cancellation and new arrivals", async (t) => {
  const root = fixture(t);
  const busy = await acquireLease("heavy", {
    root,
    command: "build",
    task: "owner",
  });
  t.after(() => busy.release());
  const order = [];
  const abort = new AbortController();
  const enqueue = (command, pollMs, signal) =>
    acquireLease("heavy", {
      root,
      command,
      task: "test",
      pollMs,
      signal,
    }).then((lease) => {
      order.push(command);
      lease.release();
    });
  const older = enqueue("older", 100);
  const cancelled = enqueue("cancelled", 10, abort.signal);
  const newer = enqueue("newer", 5);
  const snapshot = () => queueStatus(root);
  try {
    await waitFor(() => snapshot().waiting.length === 3);
    assert.deepEqual(
      snapshot().waiting.map((w) => [w.position, w.command]),
      [
        [1, "older"],
        [2, "cancelled"],
        [3, "newer"],
      ],
    );
    assert.equal(snapshot().holders[0].task, "owner");
    assert(snapshot().holders[0].ageMs >= 0);
  } finally {
    abort.abort();
    await assert.rejects(cancelled, /abort/i);
    busy.release();
    await Promise.all([older, newer, enqueue("last", 1)]);
  }
  assert.deepEqual(order, ["older", "newer", "last"]);
  assert.deepEqual(snapshot().waiting, []);
});

test("a killed waiter gives the next live request its turn", async (t) => {
  const root = fixture(t);
  const locks = path.join(root, "locks");
  const held = await acquireLease("heavy", { root: locks });
  t.after(() => held.release());
  const abandoned = worker(t, root, "abandoned");
  const waiting = message(abandoned, "waiting");
  abandoned.send("start");
  await waiting;
  const exited = once(abandoned, "exit");
  abandoned.kill("SIGKILL");
  await exited;
  held.release();
  const next = await acquireLease("heavy", { root: locks, wait: false });
  next.release();
  assert.deepEqual(fs.readdirSync(locks), []);
});

test(
  "webpack yields a preview slot while idle and reacquires it for rebuilds",
  { timeout: 20000 },
  async (t) => {
    const { PreviewCompilation } = require("../dev/preview");
    const webpack = require("webpack");
    const root = fixture(t);
    const input = path.join(root, "index.js");
    fs.writeFileSync(input, "export default 1");
    const plugin = new PreviewCompilation(root);
    let active = 0;
    const compiler = webpack({
      mode: "development",
      context: root,
      entry: input,
      output: { path: path.join(root, "dist") },
      plugins: [
        plugin,
        {
          apply(c) {
            c.hooks.make.tap("observe", () => {
              assert.equal(
                queueStatus(root).holders.some(
                  (h) => h.command === "start (compile)",
                ),
                true,
              );
              active++;
            });
          },
        },
      ],
    });
    let finish;
    const completion = () =>
      new Promise((resolve, reject) => {
        finish = { resolve, reject };
      });
    let result = completion();
    compiler.hooks.afterDone.tap("observe idle preview", (stats) =>
      finish.resolve(stats),
    );
    const watch = compiler.watch({}, (err) => {
      if (err) finish.reject(err);
    });
    const leases = [];
    try {
      assert.equal((await result).hasErrors(), false);
      assert.deepEqual(queueStatus(root).holders, []);
      for (let i = 0; i < 3; i++)
        leases.push(
          await acquireLease("heavy", { root, slots: 3, command: "check" }),
        );
      result = completion();
      fs.writeFileSync(input, "export default (");
      const deadline = Date.now() + 5000;
      while (!queueStatus(root).waiting.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(queueStatus(root).waiting[0]?.command, "start (compile)");
      assert.equal(active, 1);
      leases[0].release();
      assert.equal((await result).hasErrors(), true);
      assert.equal(queueStatus(root).holders.length, 2);
      // A shared compilation slot also covers CRA's async TypeScript worker
      // after webpack has emitted the bundle.
      const checker = require("react-dev-utils/ForkTsCheckerWebpackPlugin");
      let finishTypecheck;
      await checker.issuesPool.submit(async (done) => {
        finishTypecheck = done;
      });
      try {
        const emitted = new Promise((resolve) =>
          compiler.hooks.done.tap("observe emitted bundle", resolve),
        );
        result = completion();
        fs.writeFileSync(input, "export default 2");
        await emitted;
        assert(
          queueStatus(root).holders.some(
            (h) => h.command === "start (compile)",
          ),
        );
      } finally {
        finishTypecheck();
      }
      assert.equal((await result).hasErrors(), false);
      assert.equal(active, 3);
      assert.equal(queueStatus(root).holders.length, 2);
    } finally {
      for (const lease of leases) lease.release();
      await new Promise((resolve) => watch.close(resolve));
    }
  },
);

test("a paused ticket publisher cannot be overtaken by another process", async (t) => {
  const root = fixture(t);
  const file = path.join(root, "publisher.cjs");
  fs.writeFileSync(
    file,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (process.argv[2] === 'first' && path.basename(to).startsWith('heavy-wait-')) {
        process.send({type:'paused'});
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(${JSON.stringify(path.join(root, "resume"))})) {
          if (Date.now() > deadline) throw Error('Publisher was never resumed');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      if (process.argv[2] === 'second' && path.basename(to) === 'heavy-admission')
        process.send({type:'progress', state:'contending'});
      return rename(from, to);
    };
    const {acquireLease} = require(${JSON.stringify(require.resolve("../dev/coordination"))});
    process.once('message', async () => {
      const lease = await acquireLease('heavy', {root:${JSON.stringify(root)}, pollMs:10});
      process.send({type:'progress', state:'acquired'});
      process.once('message', () => { lease.release(); process.disconnect(); });
    });
  `,
  );
  const children = ["first", "second"].map((name) =>
    fork(file, [name], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    }),
  );
  t.after(() => {
    if (fs.existsSync(root))
      fs.writeFileSync(path.join(root, "resume"), "resume");
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const [first, second] = children;
  const paused = message(first, "paused");
  const firstReady = message(first, "progress");
  first.send("start");
  await paused;
  const competing = message(second, "progress");
  second.send("start");
  assert.equal((await competing).state, "contending");
  assert.deepEqual(queueStatus(root).holders, []);
  const secondReady = new Promise((resolve) =>
    second.on("message", (value) => {
      if (value.state === "acquired") resolve(value);
    }),
  );
  fs.writeFileSync(path.join(root, "resume"), "resume");
  assert.equal((await firstReady).state, "acquired");
  first.send("release");
  await secondReady;
  const exited = once(second, "exit");
  second.send("release");
  await exited;
});

test("queued rebuilds reject changed dependency metadata before compilation", async (t) => {
  const root = fixture(t);
  const { PreviewCompilation } = require("../dev/preview");
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(path.join(checkout, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(checkout, "package.json"), "{}");
  fs.writeFileSync(
    path.join(checkout, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
  );
  const installed = path.join(checkout, "node_modules/.package-lock.json");
  fs.writeFileSync(
    installed,
    JSON.stringify({ lockfileVersion: 3, packages: {} }),
  );
  const plugin = new PreviewCompilation(root, undefined, checkout);
  await plugin.acquire();
  plugin.release();
  const leases = [];
  t.after(() => {
    plugin.release();
    for (const lease of leases) lease.release();
  });
  for (let i = 0; i < 3; i++)
    leases.push(await acquireLease("heavy", { root, slots: 3 }));
  // Use webpack's actual watchRun hook for the rebuild admission.
  const compiler = require("webpack")({
    mode: "development",
    entry: __filename,
  });
  plugin.apply(compiler);
  const rebuild = compiler.hooks.watchRun.promise(compiler);
  const rejected = assert.rejects(rebuild, /Dependency preflight failed/);
  await waitFor(() => queueStatus(root).waiting.length === 1);
  fs.rmSync(installed);
  leases[0].release();
  await rejected;
  assert.equal(queueStatus(root).holders.length, 2);
});

test(
  "fatal webpack errors retain the lease until pending TypeScript settles",
  { timeout: 20000 },
  async (t) => {
    const root = fixture(t);
    const { PreviewCompilation } = require("../dev/preview");
    const checker = require("react-dev-utils/ForkTsCheckerWebpackPlugin");
    const plugin = new PreviewCompilation(root);
    const input = path.join(root, "index.js");
    fs.writeFileSync(input, "export default 1");
    let finishTypecheck;
    let builds = 0;
    const compiler = require("webpack")({
      mode: "development",
      context: root,
      entry: input,
      output: { path: path.join(root, "dist") },
      plugins: [
        plugin,
        {
          apply(c) {
            c.hooks.emit.tapPromise("fatal once", async () => {
              if (++builds !== 1) return;
              await checker.issuesPool.submit(async (done) => {
                finishTypecheck = done;
              });
              throw new Error("fatal emit regression fixture");
            });
          },
        },
      ],
    });
    let failed;
    const failure = new Promise((resolve) => {
      failed = resolve;
    });
    let done;
    const completion = new Promise((resolve) => {
      done = resolve;
    });
    compiler.hooks.afterDone.tap("observe recovery", done);
    const watch = compiler.watch({}, (error) => {
      if (error) failed(error);
    });
    try {
      assert.match((await failure).message, /fatal emit regression fixture/);
      assert.equal(queueStatus(root).holders.length, 1);
      watch.invalidate();
      finishTypecheck();
      await completion;
      assert.equal(builds, 2);
      assert.deepEqual(queueStatus(root).holders, []);
    } finally {
      finishTypecheck?.();
      await new Promise((resolve) => watch.close(resolve));
    }
  },
);

test(
  "explicit invalidation during done cannot let an older completion release a rebuild",
  { timeout: 20000 },
  async (t) => {
    const root = fixture(t);
    const { PreviewCompilation } = require("../dev/preview");
    const checker = require("react-dev-utils/ForkTsCheckerWebpackPlugin");
    const input = path.join(root, "index.js");
    fs.writeFileSync(input, "export default 1");
    let finishTypecheck, resumeRebuild;
    let builds = 0;
    let bundleEmitted, rebuildEntered;
    const emitted = new Promise((resolve) => {
      bundleEmitted = resolve;
    });
    const rebuilding = new Promise((resolve) => {
      rebuildEntered = resolve;
    });
    const compiler = require("webpack")({
      mode: "development",
      context: root,
      entry: input,
      output: { path: path.join(root, "dist") },
      plugins: [
        new PreviewCompilation(root),
        {
          apply(c) {
            c.hooks.make.tapPromise("hold rebuild", async () => {
              builds++;
              if (builds === 1)
                await checker.issuesPool.submit(async (done) => {
                  finishTypecheck = done;
                });
              else
                await new Promise((resolve) => {
                  resumeRebuild = resolve;
                  rebuildEntered();
                });
            });
            c.hooks.done.tap("observe first bundle", () => {
              if (builds === 1) bundleEmitted();
            });
          },
        },
      ],
    });
    let firstDone, secondDone;
    const firstCompletion = new Promise((resolve) => {
      firstDone = resolve;
    });
    const secondCompletion = new Promise((resolve) => {
      secondDone = resolve;
    });
    let completions = 0;
    compiler.hooks.afterDone.tap("observe completion", () => {
      if (++completions === 1) firstDone();
      else secondDone();
    });
    const watch = compiler.watch({}, () => {});
    try {
      await emitted;
      watch.invalidate();
      finishTypecheck();
      await rebuilding;
      await firstCompletion;
      assert.equal(queueStatus(root).holders.length, 1);
      resumeRebuild();
      await secondCompletion;
      assert.deepEqual(queueStatus(root).holders, []);
    } finally {
      finishTypecheck?.();
      resumeRebuild?.();
      await new Promise((resolve) => watch.close(resolve));
    }
  },
);
