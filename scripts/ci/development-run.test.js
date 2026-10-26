const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { alive, acquireLease, readOwner } = require("../dev/coordination");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-run-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  execFileSync("git", ["init", "--quiet"], {
    cwd: root,
    stdio: "pipe",
    windowsHide: true,
  });
  write("package.json", { name: "fixture" });
  write("package-lock.json", {
    lockfileVersion: 3,
    packages: { "": { name: "fixture" } },
  });
  write("node_modules/.package-lock.json", {
    lockfileVersion: 3,
    packages: {},
  });
  write(
    "scripts/run-compatibility.js",
    "require('node:fs').appendFileSync('generators.log','compatibility\\n')",
  );
  write(
    "scripts/generate-icon-manifest.js",
    "require('node:fs').appendFileSync('generators.log','icons\\n')",
  );
  write(
    "runner.cjs",
    `
    process.on('message',message=>{if(message==='cancel')process.emit('SIGTERM')});
    require(${JSON.stringify(require.resolve("../dev/run"))}).runCommand(process.argv[2],process.argv.slice(3),
      {root:process.cwd(),coordinationRoot:require('node:path').join(process.cwd(),'locks')})
      .then(code=>{process.exitCode=code;if(process.connected)process.disconnect()})
      .catch(error=>{console.error(error.message);process.exitCode=1;if(process.connected)process.disconnect()});
  `,
  );
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "false",
    ELECTRIFY_TASK_ID: "fixture",
    ELECTRIFY_DEVELOPMENT_LEASE: "",
    ELECTRIFY_DEVELOPMENT_GROUP: "",
    npm_config_ignore_scripts: "false",
  };
  const run = (mode, args = [], extra = {}) =>
    spawnSync(process.execPath, ["runner.cjs", mode, ...args], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
  return { root, write, env, run };
}

test("wrapper runs generators inside coordination, forwards literal arguments and preserves failure", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/build.js",
    "require('node:fs').writeFileSync('argv.json',JSON.stringify(process.argv.slice(2)));process.exitCode=7",
  );
  const args = ["space inside", "dollar$literal", "semi;literal"];
  const result = run("build", args);
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "argv.json"))),
    args,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "generators.log"), "utf8"),
    "compatibility\nicons\n",
  );
  assert(!fs.existsSync(path.join(root, "locks/heavy")));
});

test("hosted trimmed installations preserve ignore-scripts and bypass only local coordination", (t) => {
  const { root, write, run } = fixture(t);
  fs.rmSync(path.join(root, "node_modules"), { recursive: true });
  write("scripts/build.js", "process.exitCode=9");
  const result = run("build", [], {
    GITHUB_ACTIONS: "true",
    npm_config_ignore_scripts: "true",
  });
  assert.equal(result.status, 9, result.stderr);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "locks")));
});

test("bad dependency installations fail before generators or work execute", (t) => {
  const { root, write, run } = fixture(t);
  fs.rmSync(path.join(root, "node_modules/.package-lock.json"));
  write("scripts/build.js", "require('node:fs').writeFileSync('ran','bad')");
  const result = run("build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency preflight failed/);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "ran")));
});

test("conflicting start ports fail before preparing or starting the server", (t) => {
  const { root, write, run } = fixture(t);
  write("scripts/start.js", "require('node:fs').writeFileSync('ran','bad')");
  const result = run("start", [], { PORT: "3101", E2E_PORT: "3102" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT.*E2E_PORT|E2E_PORT.*PORT/);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "ran")));
});

test("nested wrappers complete inside the parent's lease", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/check.js",
    `
    const {spawnSync}=require('node:child_process');
    const result=spawnSync(process.execPath,['runner.cjs','bench'],{env:process.env,stdio:'inherit'});
    process.exitCode=result.status;
  `,
  );
  write(
    "scripts/perf/bench.js",
    "require('node:fs').writeFileSync('nested-ran','yes')",
  );
  // The nested fixture runner must retain, rather than replace, inherited env.
  const result = run("check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "nested-ran"), "utf8"), "yes");
  assert.equal(
    (result.stderr.match(/Validation slot acquired/g) || []).length,
    1,
  );
});

test("cancelling nested work stops its descendants before releasing the validation slot", async (t) => {
  const { root, write, env } = fixture(t);
  write(
    "scripts/check.js",
    `
    const child=require('node:child_process').spawn(process.execPath,['runner.cjs','bench'],{env:process.env,stdio:'inherit'});
    child.on('exit',code=>process.exitCode=code);
  `,
  );
  write(
    "scripts/perf/bench.js",
    `
    require('node:fs').writeFileSync('leaf.pid',String(process.pid));
    process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),1200));
    process.stdout.write('leaf-ready\\n');
    setInterval(()=>{},100);
  `,
  );
  const child = spawn(process.execPath, ["runner.cjs", "check"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 10000;
  while (!output.includes("leaf-ready") && Date.now() < deadline)
    await delay(20);
  assert.match(output, /leaf-ready/);
  const leaf = Number(fs.readFileSync(path.join(root, "leaf.pid"), "utf8"));
  const exited = once(child, "close");
  // Windows kill(SIGTERM) force-terminates Node rather than delivering its JS
  // handler. Exercise that handler through IPC there; POSIX uses the real signal.
  if (process.platform === "win32") child.send("cancel");
  else child.kill("SIGTERM");
  await exited;
  assert.equal(
    alive(leaf),
    false,
    "the leaf cannot outlive the released reservation",
  );
  assert(!fs.existsSync(path.join(root, "locks/heavy")));
});

test("abrupt supervisor death keeps the slot reserved while its command is alive", async (t) => {
  const { root, write, env } = fixture(t);
  write(
    "scripts/perf/bench.js",
    "process.stdout.write('leaf-ready\\n');setInterval(()=>{},100)",
  );
  const supervisor = spawn(process.execPath, ["runner.cjs", "bench"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let owner = null;
  t.after(async () => {
    if (process.platform === "win32" && owner?.childPid)
      spawnSync("taskkill", ["/pid", String(owner.childPid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else if (owner?.groupId) {
      try {
        process.kill(-owner.groupId, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (supervisor.exitCode === null && supervisor.signalCode === null)
      supervisor.kill("SIGKILL");
  });
  let output = "";
  supervisor.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 10000;
  while (!output.includes("leaf-ready") && Date.now() < deadline)
    await delay(20);
  assert.match(output, /leaf-ready/);
  owner = readOwner(path.join(root, "locks/heavy"));
  assert(owner?.childPid);
  const exited = once(supervisor, "exit");
  supervisor.kill("SIGKILL");
  await exited;
  assert(alive(owner.childPid));
  await assert.rejects(
    acquireLease("heavy", { root: path.join(root, "locks"), wait: false }),
    /held by PID/,
  );
  assert.equal(readOwner(path.join(root, "locks/heavy")).token, owner.token);
});
