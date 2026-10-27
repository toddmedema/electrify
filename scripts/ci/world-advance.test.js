const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WorldAdvanceWorker } = require("./world-advance");

function fixture(t, failedExit = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "world-advance-worker-"));
  const entry = path.join(root, "worker.cjs");
  fs.writeFileSync(
    entry,
    `
    const fs = require('node:fs');
    let count = 0, active = false;
    process.on('message', ({ id, file, month }) => {
      if (active) throw new Error('requests overlapped');
      if (month === 777) { console.error('fixture worker crashed'); process.exit(7); }
      if (month === 888) return;
      if (month < 0) return process.send({ type: 'result', id, error: 'invalid month' });
      active = true;
      setTimeout(() => {
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid, count: ++count, month }));
        active = false;
        process.send({ type: 'result', id });
      }, 5);
    });
    process.once('disconnect', () => process.exit(0));
    process.send({ type: 'ready' });
  `,
  );
  const worker = new WorldAdvanceWorker({
    root,
    args: [entry],
    timeoutMs: 5000,
  });
  t.after(async () => {
    if (failedExit) await assert.rejects(worker.close(), /worker failed/);
    else await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { worker, root, read: (file) => JSON.parse(fs.readFileSync(file)) };
}

test("world advance requests reuse one runtime and execute in order", async (t) => {
  const { worker, root, read } = fixture(t);
  const files = [1, 2, 3].map((month) => path.join(root, `${month}.json`));
  await Promise.all(
    files.map((file, index) => worker.advance(file, index + 1)),
  );
  const results = files.map(read);
  assert.equal(new Set(results.map(({ pid }) => pid)).size, 1);
  assert.deepEqual(
    results.map(({ count }) => count),
    [1, 2, 3],
  );
  assert.deepEqual(
    results.map(({ month }) => month),
    [1, 2, 3],
  );
});

test("an assertion failure rejects its request without poisoning the next save", async (t) => {
  const { worker, root, read } = fixture(t);
  const file = path.join(root, "result.json");
  await assert.rejects(worker.advance(file, -1), /invalid month/);
  await worker.advance(file, 2);
  assert.equal(read(file).month, 2);
});

test("a worker crash rejects the pending request with its diagnostics", async (t) => {
  const { worker, root } = fixture(t, true);
  await assert.rejects(
    worker.advance(path.join(root, "result.json"), 777),
    /exited.*7[\s\S]*fixture worker crashed/,
  );
});

test("an unresponsive request fails and terminates its worker", async (t) => {
  const { worker, root } = fixture(t, true);
  const file = path.join(root, "result.json");
  await worker.advance(file, 1);
  const pid = worker.child.pid;
  worker.timeoutMs = 100;
  await assert.rejects(worker.advance(file, 888), /request 2 timed out/);
  await assert.rejects(worker.close(), /worker failed/);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("worker teardown terminates the process and rejects later work", async (t) => {
  const { worker, root } = fixture(t);
  const file = path.join(root, "result.json");
  await worker.advance(file, 1);
  const pid = worker.child.pid;
  await worker.close();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(worker.advance(file, 2), /closed/);
});

test("teardown cancels an outstanding request instead of waiting for its timeout", async (t) => {
  const { worker, root } = fixture(t);
  const file = path.join(root, "result.json");
  await worker.advance(file, 1);
  const pending = assert.rejects(worker.advance(file, 888), /closed/);
  await new Promise(setImmediate);
  await worker.close();
  await pending;
});

test("failure to spawn a worker rejects instead of waiting for its readiness", async () => {
  const worker = new WorldAdvanceWorker({
    command: "/no-such-world-worker",
    args: [],
  });
  await assert.rejects(worker.advance("unused", 1), /ENOENT/);
  await assert.rejects(worker.close(), /worker failed/);
});
