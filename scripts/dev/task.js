const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { readOwner, removeOwner } = require("./coordination");

function taskId(env = process.env) {
  return env.ELECTRIFY_TASK_ID || env.CODEX_THREAD_ID;
}

function claimTask(root = process.cwd(), id = taskId()) {
  const directory = path.join(root, ".tmp", "development-task");
  const current = readOwner(directory);
  if (!id) {
    if (current)
      throw new Error(
        `Checkout reserved by task ${current.task}. Use its ELECTRIFY_TASK_ID or another worktree.`,
      );
    return null;
  }
  if (current?.task === id) return current;
  const token = createHash("sha256").update(id).digest("hex");
  const owner = {
    token,
    task: id,
    cwd: root,
    startedAt: new Date().toISOString(),
  };
  const prepared = path.join(root, ".tmp", `task-${randomUUID()}`);
  fs.mkdirSync(prepared, { recursive: true });
  fs.writeFileSync(path.join(prepared, `${token}.json`), JSON.stringify(owner));
  try {
    fs.renameSync(prepared, directory);
    return owner;
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    const claimed = readOwner(directory);
    if (claimed?.task === id) return claimed;
    throw new Error(
      `Checkout reserved by task ${claimed?.task || "another task"}. Use an isolated worktree; do not switch or edit this checkout.`,
    );
  } finally {
    fs.rmSync(prepared, { recursive: true, force: true });
  }
}

function releaseTask(root = process.cwd(), id = taskId()) {
  const directory = path.join(root, ".tmp", "development-task");
  const current = readOwner(directory);
  if (!current) return;
  if (current.task !== id)
    throw new Error(
      `Only task ${current.task} can release this checkout. Pass that ID explicitly after confirming it is finished.`,
    );
  removeOwner(directory, current.token);
}

if (require.main === module) {
  try {
    const [action = "status", id = taskId()] = process.argv.slice(2);
    if (action === "claim") {
      if (!id) throw new Error("Pass a task ID or set ELECTRIFY_TASK_ID");
      console.error(
        `Checkout reserved for ${claimTask(process.cwd(), id).task}`,
      );
    } else if (action === "release") releaseTask(process.cwd(), id);
    else if (action === "status")
      console.error(
        readOwner(path.resolve(".tmp/development-task")) ||
          "Checkout is unclaimed",
      );
    else
      throw new Error(
        "Usage: npm run task -- [claim|release|status] [task-id]",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { taskId, claimTask, releaseTask };
