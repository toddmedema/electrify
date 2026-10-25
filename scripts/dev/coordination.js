const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

function coordinationRoot() {
  return path.join(
    os.tmpdir(),
    `electrify-development-${os.userInfo().username}`,
  );
}

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function alive(pid) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission failures must not evict another live process.
    return error.code !== "ESRCH";
  }
}

function readOwner(directory) {
  try {
    const files = fs
      .readdirSync(directory)
      .filter((file) => file.endsWith(".json"));
    if (!files.length) return null; // A release is between unlink and rmdir.
    if (files.length !== 1) throw new Error(`Invalid lease: ${directory}`);
    const file = path.join(directory, files[0]);
    const owner = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      !owner ||
      typeof owner.token !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(owner.token) ||
      files[0] !== `${owner.token}.json`
    )
      throw new Error(`Invalid lease owner: ${directory}`);
    return { ...owner, file };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function groupAlive(pid) {
  if (process.platform === "win32" || !validPid(pid)) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function ownerAlive(owner) {
  // Corrupt/unknown process metadata is not evidence that an owner has died.
  if (
    !validPid(owner.pid) ||
    (owner.childPid !== undefined && !validPid(owner.childPid)) ||
    (owner.groupId !== undefined && !validPid(owner.groupId))
  )
    return true;
  return alive(owner.pid) || alive(owner.childPid) || groupAlive(owner.groupId);
}

function removeOwner(directory, token) {
  // Remove only this owner's unique filename. Another reaper/acquirer can never
  // make us unlink a replacement owner, even between unlink and rmdir.
  try {
    fs.unlinkSync(path.join(directory, `${token}.json`));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}

async function acquireLease(name, options = {}) {
  const root = options.root || coordinationRoot();
  fs.mkdirSync(root, { recursive: true });
  const directory = path.join(root, name);
  const inherited = options.inherited;
  if (inherited) {
    const owner = readOwner(directory);
    if (owner?.token === inherited && ownerAlive(owner))
      return {
        token: inherited,
        groupId: owner.groupId,
        inherited: true,
        waitMs: 0,
        release() {},
      };
  }
  const token = randomUUID();
  const prepared = path.join(root, `${name}-${token}`);
  const owner = {
    token,
    pid: process.pid,
    cwd: process.cwd(),
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(prepared);
  fs.writeFileSync(path.join(prepared, `${token}.json`), JSON.stringify(owner));
  const started = Date.now();
  let announced = false;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      try {
        // The complete metadata becomes visible atomically with ownership.
        fs.renameSync(prepared, directory);
        return {
          token,
          inherited: false,
          waitMs: Date.now() - started,
          setChild(pid, groupId) {
            owner.childPid = pid;
            if (groupId !== undefined) owner.groupId = groupId;
            const file = path.join(directory, `${token}.json`);
            const temporary = path.join(root, `${token}.update`);
            fs.writeFileSync(temporary, JSON.stringify(owner));
            fs.renameSync(temporary, file);
          },
          release() {
            removeOwner(directory, token);
          },
        };
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      }
      const current = readOwner(directory);
      if (!current) {
        try {
          fs.rmdirSync(directory);
        } catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
            throw error;
        }
      } else if (!ownerAlive(current)) {
        removeOwner(directory, current.token);
      } else {
        if (options.wait === false)
          throw new Error(
            `Reservation ${name} is held by PID ${current.pid} in ${current.cwd}`,
          );
        if (!announced) {
          options.onWait?.(current);
          announced = true;
        }
      }
      await delay(options.pollMs || 200, undefined, { signal: options.signal });
    }
  } finally {
    fs.rmSync(prepared, { recursive: true, force: true });
  }
}

async function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      const selected = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

async function reservePort(requested, options = {}) {
  if (
    requested !== undefined &&
    (!/^\d+$/.test(String(requested)) ||
      Number(requested) < 1 ||
      Number(requested) > 65535)
  )
    throw new Error("E2E_PORT must be an integer from 1 to 65535");
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await probePort(Number(requested || 0));
    let lease;
    try {
      lease = await acquireLease(`port-${port}`, { ...options, wait: false });
      await probePort(port);
      return { ...lease, port };
    } catch (error) {
      lease?.release();
      if (requested !== undefined) throw error;
    }
  }
  throw new Error("Could not reserve a local test port");
}

module.exports = {
  coordinationRoot,
  acquireLease,
  reservePort,
  alive,
  groupAlive,
  readOwner,
  removeOwner,
};
