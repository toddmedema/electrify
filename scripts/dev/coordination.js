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

const heavySlots = 3;

function entries(root) {
  try {
    return fs.readdirSync(root);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function waitingOwners(root, reap = false) {
  return entries(root)
    .filter((name) => name.startsWith("heavy-wait-"))
    .sort()
    .flatMap((name) => {
      const dir = path.join(root, name);
      const owner = readOwner(dir);
      if (!owner) return [];
      if (ownerAlive(owner)) return [owner];
      if (reap) removeOwner(dir, owner.token);
      return [];
    });
}

function queueStatus(root = coordinationRoot()) {
  const holders = [],
    previews = [];
  const now = Date.now();
  const describe = (owner) => ({
    command: owner.command || "unknown (older checkout)",
    task: owner.task || null,
    pid: owner.pid,
    cwd: owner.cwd,
    ageMs: owner.startedAt
      ? Math.max(0, now - Date.parse(owner.startedAt))
      : null,
  });
  for (const name of entries(root).sort()) {
    if (!/^(heavy(?:-\d+)?|port-\d+)$/.test(name)) continue;
    const owner = readOwner(path.join(root, name));
    if (!owner || !ownerAlive(owner)) continue;
    if (name.startsWith("heavy"))
      holders.push({ slot: name, ...describe(owner) });
    else if (owner.preview)
      previews.push({ port: Number(name.slice(5)), ...describe(owner) });
  }
  const waiting = waitingOwners(root).map((owner, index) => ({
    position: index + 1,
    ...describe(owner),
  }));
  return { holders, waiting, previews };
}

function inheritedLease(
  name,
  { root = coordinationRoot(), slots = 1, inherited },
) {
  if (!inherited) return;
  for (const dir of slotDirectories(root, name, slots)) {
    const owner = readOwner(dir);
    if (owner?.token === inherited && ownerAlive(owner))
      return {
        token: inherited,
        groupId: owner.groupId,
        inherited: true,
        waitMs: 0,
        release() {},
      };
  }
}

function slotDirectories(root, name, slots) {
  // Keep the original slot names so older checkouts still respect the same cap.
  return Array.from({ length: slots }, (_, index) =>
    path.join(root, index === 0 ? name : `${name}-${index + 1}`),
  );
}

async function acquireLease(name, options = {}) {
  const root = options.root || coordinationRoot();
  fs.mkdirSync(root, { recursive: true });
  const slots = options.slots ?? 1;
  if (!Number.isSafeInteger(slots) || slots < 1)
    throw new Error("Reservation slots must be a positive integer");
  const directories = slotDirectories(root, name, slots);
  const nested = inheritedLease(name, options);
  if (nested) return nested;
  const token = randomUUID();
  const prepared = path.join(root, `${name}-${token}`);
  const started = Date.now();
  const owner = {
    token,
    pid: process.pid,
    cwd: options.cwd || process.cwd(),
    command: options.command,
    task: options.task,
    preview: options.preview,
    startedAt: new Date(started).toISOString(),
  };
  fs.mkdirSync(prepared);
  fs.writeFileSync(path.join(prepared, `${token}.json`), JSON.stringify(owner));
  // Publish a complete ticket, ordered by the machine's monotonic clock.
  // Renaming the ticket into a slot atomically dequeues the winner.
  let ticket = prepared;
  if (name === "heavy") {
    const order = process.hrtime.bigint().toString().padStart(24, "0");
    ticket = path.join(root, `heavy-wait-${order}-${token}`);
    fs.renameSync(prepared, ticket);
  }
  let announced = false;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      let recovered = false;
      const waiting = name === "heavy" ? waitingOwners(root, true) : [];
      const position =
        waiting.findIndex((waiter) => waiter.token === token) + 1;
      let occupied = position > 1 ? waiting[0] : null;
      for (const directory of occupied ? [] : directories) {
        try {
          // The complete metadata becomes visible atomically with ownership.
          fs.renameSync(ticket, directory);
          return {
            token,
            inherited: false,
            waitMs: Date.now() - started,
            queued: announced,
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
          if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code))
            throw error;
        }
        const current = readOwner(directory);
        if (!current) {
          recovered = true;
          try {
            fs.rmdirSync(directory);
          } catch (error) {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
              throw error;
          }
        } else if (!ownerAlive(current)) {
          removeOwner(directory, current.token);
          recovered = true;
        } else {
          occupied = current;
        }
      }
      if (recovered) continue;
      if (occupied) {
        if (options.wait === false)
          throw new Error(
            `Reservation ${name} is held by PID ${occupied.pid} in ${occupied.cwd}`,
          );
        if (!announced) {
          options.onWait?.(occupied, position);
          announced = true;
        }
      }
      await delay(options.pollMs || 200, undefined, { signal: options.signal });
    }
  } finally {
    fs.rmSync(ticket, { recursive: true, force: true });
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
  inheritedLease,
  queueStatus,
  heavySlots,
  reservePort,
  alive,
  groupAlive,
  readOwner,
  removeOwner,
};
