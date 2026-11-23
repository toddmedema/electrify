const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { gunzip: decompress } = require("node:zlib");
const { promisify } = require("node:util");
const { CrossplayError } = require("./crossplay-errors.cjs");
const {
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  snapshotJson,
} = require("./coop-checkpoint-wire.cjs");
const gunzip = promisify(decompress);
const { activeSignalPair } = require("./coop-signaling.cjs");

const CHECKPOINT_VALIDATION_MS = 8_000;
const defaultValidatorPath = path.join(
  __dirname,
  "build/runtime/server/checkpoint.cjs",
);
let validating = false;
const TRANSFER_MS = 60_000;
const CHECKPOINT_INTERVAL_MS = 10_000;
const TRANSFERS_PER_MINUTE = 8;
const STAGING_GRACE_MS = 60_000;
const CHECKPOINT_ORPHAN_AGE_MS = 10 * 60_000;
const REAP_BATCH = 300;
const reaperCursors = new Map();
const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;

function refuse(code, status = 400) {
  throw new CrossplayError(status, code);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compressedBody(body) {
  if (
    typeof body.content !== "string" ||
    body.content.length > (MAX_COMPRESSED_BYTES / 3) * 4 ||
    typeof body.digest !== "string" ||
    !HASH.test(body.digest)
  )
    refuse("invalid-snapshot");
  const bytes = Buffer.from(body.content, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_COMPRESSED_BYTES ||
    bytes.toString("base64") !== body.content ||
    hash(bytes) !== body.digest
  )
    refuse("invalid-snapshot");
  return { bytes, digest: body.digest };
}

async function decode(body) {
  const packed = compressedBody(body);
  let snapshot;
  try {
    const decoded = await gunzip(packed.bytes, {
      maxOutputLength: MAX_DECODED_BYTES,
    });
    snapshot = JSON.parse(snapshotJson(decoded));
  } catch {
    refuse("invalid-snapshot");
  }
  return { ...packed, snapshot };
}

function checkpointValidatorReady(runtimePath = defaultValidatorPath) {
  return fs.existsSync(runtimePath);
}

async function validateCheckpoint(bytes, runtimePath = defaultValidatorPath) {
  if (!checkpointValidatorReady(runtimePath))
    refuse("checkpoint-validator-unavailable", 503);
  if (validating) refuse("checkpoint-validator-busy", 429);
  validating = true;
  let worker;
  try {
    worker = new Worker(path.join(__dirname, "coop-checkpoint-worker.cjs"), {
      workerData: { runtimePath, bytes },
      resourceLimits: {
        maxOldGenerationSizeMb: 160,
        maxYoungGenerationSizeMb: 16,
      },
    });
    let deadline;
    const result = await new Promise((resolve, reject) => {
      const fail = () => reject(new CrossplayError(400, "invalid-checkpoint"));
      deadline = setTimeout(fail, CHECKPOINT_VALIDATION_MS);
      worker.once("message", resolve);
      worker.once("exit", fail);
      worker.once("error", fail);
    }).finally(() => clearTimeout(deadline));
    if (result.unavailable) refuse("checkpoint-validator-unavailable", 503);
    if (!result.fields) refuse("invalid-checkpoint");
    return result.fields;
  } finally {
    await worker?.terminate().catch(() => {});
    validating = false;
  }
}

function validateWorld(world, room) {
  const seats = new Map(room.members.map(({ id, name }) => [id, name]));
  if (
    !world ||
    world.schema !== 3 ||
    !Number.isSafeInteger(world.gameSchema) ||
    !Number.isSafeInteger(world.revision) ||
    world.revision < 0 ||
    typeof world.matchId !== "string" ||
    !ID.test(world.matchId) ||
    world.epoch !== room.epoch ||
    world.rules !== room.rules ||
    !Array.isArray(world.seats) ||
    world.seats.length !== seats.size ||
    new Set(world.seats.map((seat) => seat?.id)).size !== seats.size ||
    !world.seats.every((seat) => seat && seats.get(seat.id) === seat.name) ||
    !HASH.test(world.scenarioDigest)
  )
    refuse("invalid-checkpoint");
}

function requireHost(context) {
  if (context.seatId !== context.hostId) refuse("not-room-host", 403);
}

function guardedPair(context, body, room, sending) {
  if (
    typeof body.generation !== "string" ||
    typeof body.to !== "string" ||
    body.epoch !== room.epoch ||
    body.to === context.seatId ||
    (sending ? context.seatId : body.to) !== room.hostId
  )
    refuse("obsolete-transfer", 409);
  const pair = activeSignalPair(
    room,
    context.seatId,
    body.to,
    body.generation,
    Date.now(),
  );
  if (!pair?.offer || !pair.answer) refuse("obsolete-transfer", 409);
}

function bucketFor(context) {
  if (!context.bucket) refuse("storage-unavailable", 503);
  return context.bucket;
}

function metadataFor(result) {
  return {
    contentType: "application/octet-stream",
    cacheControl: "private, no-store",
    metadata: { sha256: result.digest },
  };
}

async function writeImmutable(bucket, key, result, metadata) {
  const object = bucket.file(key);
  await object.save(result.bytes, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata,
  });
  const [stored] = await object.getMetadata();
  await download(
    bucket,
    key,
    stored.generation,
    result.digest,
    result.bytes.length,
  );
  return stored.generation;
}

async function download(bucket, key, generation, digest, size) {
  if (
    !/^\d+$/.test(generation) ||
    !HASH.test(digest) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_COMPRESSED_BYTES
  )
    refuse("invalid-snapshot");
  const file = bucket.file(key, { generation });
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== size || metadata.generation !== generation)
    refuse("invalid-snapshot");
  const [bytes] = await file.download();
  if (size !== bytes.length || hash(bytes) !== digest)
    refuse("invalid-snapshot");
  return { content: bytes.toString("base64"), digest };
}

async function publish(context, body) {
  requireHost(context);
  await context.limit?.("coop-checkpoint-upload", 6);
  if (typeof body.explicit !== "boolean") refuse("invalid-checkpoint");
  const bucket = bucketFor(context);
  const expected = context.room.head?.id ?? null;
  await context.updateRoom((room) => {
    if (!room.locked) refuse("roster-not-locked", 409);
    const now = Date.now();
    const current = room.checkpointQuota;
    const quota =
      current?.until > now
        ? { ...current, count: current.count + 1 }
        : { until: now + TRANSFER_MS, count: 1 };
    if (quota.count > 6) refuse("checkpoint-rate-limit", 429);
    return { room: { ...room, checkpointQuota: quota } };
  }, "host");
  const result = compressedBody(body);
  const now = Date.now();
  const previous = context.room.head;
  if (
    previous?.epoch === context.room.epoch &&
    previous.digest === result.digest
  ) {
    return context.updateRoom((room) => {
      const head = room.head;
      if (head?.id !== previous.id) refuse("checkpoint-conflict", 409);
      return {
        room: body.explicit ? { ...room, explicitHead: head } : undefined,
        value: { savedAt: head.savedAt },
      };
    }, "host");
  }
  if (
    previous?.epoch === context.room.epoch &&
    now - previous.savedAt < CHECKPOINT_INTERVAL_MS &&
    !body.explicit
  )
    refuse("checkpoint-rate-limit", 429);
  const fields = await validateCheckpoint(
    result.bytes,
    context.checkpointValidatorPath,
  );
  validateWorld(fields, context.room);
  const {
    matchId,
    epoch,
    revision,
    schema,
    gameSchema,
    rules,
    scenarioDigest,
  } = fields;
  function requireAdvance(head) {
    if (
      head &&
      (head.matchId !== matchId ||
        head.scenarioDigest !== scenarioDigest ||
        !head.seats.every(
          (entry, index) => entry.id === fields.seats[index]?.id,
        ) ||
        (head.epoch === epoch && head.revision >= revision))
    )
      refuse("checkpoint-conflict", 409);
  }
  requireAdvance(previous);
  const id = randomUUID();
  const key = `checkpoints/${context.roomId}/${id}`;
  const generation = await writeImmutable(
    bucket,
    key,
    result,
    metadataFor(result),
  );
  const manifest = {
    id,
    generation,
    digest: result.digest,
    bytes: result.bytes.length,
    matchId,
    epoch,
    revision,
    rules,
    schema,
    gameSchema,
    scenarioDigest,
    seats: fields.seats,
    activeSeatIds: fields.activeSeatIds,
    savedAt: now,
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 80)
        : "Multiplayer campaign",
  };
  const { savedAt, discarded } = await context.updateRoom((room) => {
    validateWorld(fields, room);
    if (!room.locked) refuse("roster-not-locked", 409);
    const head = room.head;
    if (head?.digest === manifest.digest)
      return {
        room: body.explicit ? { ...room, explicitHead: head } : undefined,
        value: { savedAt: head.savedAt, discarded: [manifest] },
      };
    if ((head?.id ?? null) !== expected) refuse("checkpoint-conflict", 409);
    requireAdvance(head);
    const updated = {
      ...room,
      head: manifest,
      previousHead: head ?? null,
      explicitHead: body.explicit ? manifest : (room.explicitHead ?? null),
      restoreHead: null,
      requiredIds: [...new Set([...fields.activeSeatIds, room.hostId])],
    };
    const protectedIds = new Set(
      [
        updated.head,
        updated.previousHead,
        updated.explicitHead,
        updated.restoreHead,
      ]
        .filter(Boolean)
        .map((entry) => entry.id),
    );
    const discarded = [
      room.previousHead,
      room.explicitHead,
      room.restoreHead,
    ].filter((entry) => entry && !protectedIds.has(entry.id));
    return { room: updated, value: { savedAt: now, discarded } };
  }, "host");
  for (const entry of discarded)
    await bucket
      .file(`checkpoints/${context.roomId}/${entry.id}`, {
        generation: entry.generation,
      })
      .delete({ ifGenerationMatch: entry.generation })
      .catch(() => {});
  return { savedAt };
}

function restoreManifest(room) {
  return room.head?.epoch !== room.epoch
    ? (room.restoreHead ?? room.head)
    : room.head;
}

function sameGeneration(manifest, candidate) {
  return (
    candidate?.id === manifest.id &&
    candidate.generation === manifest.generation
  );
}

async function read(context, exporting) {
  await context.limit?.("coop-checkpoint-download", 6);
  const { room, roomId } = context;
  const manifest = exporting ? room.head : restoreManifest(room);
  if (!manifest) refuse("checkpoint-unavailable", 404);
  const result = await download(
    bucketFor(context),
    `checkpoints/${roomId}/${manifest.id}`,
    manifest.generation,
    manifest.digest,
    manifest.bytes,
  );
  const current = (await context.recheck?.(false)) ?? room;
  if (
    !(exporting
      ? [
          current.head,
          current.previousHead,
          current.explicitHead,
          current.restoreHead,
        ].some((candidate) => sameGeneration(manifest, candidate))
      : sameGeneration(manifest, restoreManifest(current)))
  )
    refuse("checkpoint-conflict", 409);
  return result;
}

async function storeTransfer(context, body) {
  requireHost(context);
  await context.limit?.("coop-transfer-upload", 8);
  const bucket = bucketFor(context);
  await context.updateRoom(
    (room, _now, projected) => {
      guardedPair(context, body, projected ?? room, true);
      const now = Date.now();
      const current = room.transferQuota;
      const quota =
        current?.until > now
          ? { ...current, count: current.count + 1 }
          : { until: now + TRANSFER_MS, count: 1 };
      if (quota.count > TRANSFERS_PER_MINUTE) refuse("transfer-limit", 429);
      return { room: { ...room, transferQuota: quota } };
    },
    { type: "host", peerId: body.to },
  );
  const result = await decode(body);
  const { snapshot } = result;
  if (
    !snapshot ||
    (snapshot.kind !== "baseline" && snapshot.kind !== "scenario") ||
    (snapshot.kind === "baseline" && snapshot.epoch !== body.epoch)
  )
    refuse("invalid-transfer");
  const reference = randomUUID();
  const metadata = metadataFor(result);
  Object.assign(metadata.metadata, {
    epoch: body.epoch,
    generation: body.generation,
    from: context.seatId,
    to: body.to,
    expires: String(Date.now() + TRANSFER_MS),
  });
  await writeImmutable(
    bucket,
    `staging/${context.roomId}/${reference}`,
    result,
    metadata,
  );
  guardedPair(context, body, (await context.recheck?.()) ?? context.room, true);
  return { reference };
}

async function readTransfer(context, body) {
  if (typeof body.reference !== "string" || !ID.test(body.reference))
    refuse("invalid-transfer");
  await context.limit?.("coop-transfer-download", 12);
  guardedPair(context, body, context.room, false);
  const bucket = bucketFor(context);
  const key = `staging/${context.roomId}/${body.reference}`;
  const [stored] = await bucket.file(key).getMetadata();
  const meta = stored.metadata;
  if (
    !meta ||
    Number(meta.expires) <= Date.now() ||
    meta.generation !== body.generation ||
    meta.epoch !== body.epoch ||
    meta.from !== body.to ||
    meta.to !== context.seatId
  )
    refuse("obsolete-transfer", 409);
  const result = await download(
    bucket,
    key,
    stored.generation,
    meta.sha256,
    Number(stored.size),
  );
  guardedPair(
    context,
    body,
    (await context.recheck?.()) ?? context.room,
    false,
  );
  return result;
}

async function handle(operation, context, body) {
  if (operation === "save/read" || operation === "save/download")
    return read(context, operation === "save/download");
  if (operation === "save/publish") return publish(context, body);
  if (operation === "transfer/put") return storeTransfer(context, body);
  if (operation === "transfer/get") return readTransfer(context, body);
  refuse("unknown-operation", 404);
}

async function reap(bucket, loadRoom, now = Date.now()) {
  const rooms = new Map();
  for (const prefix of ["staging/", "checkpoints/"]) {
    const [files, next] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      maxResults: REAP_BATCH,
      pageToken: reaperCursors.get(prefix),
    });
    for (const file of files) {
      const [namespace, roomId, id, extra] = file.name.split("/");
      if (extra || !ID.test(roomId) || !ID.test(id)) continue;
      const { generation, timeCreated } = file.metadata;
      const created = Date.parse(timeCreated);
      const staging = namespace === "staging";
      const grace = staging
        ? TRANSFER_MS + STAGING_GRACE_MS
        : CHECKPOINT_ORPHAN_AGE_MS;
      if (
        !Number.isFinite(created) ||
        now - created < grace ||
        !/^\d+$/.test(generation)
      )
        continue;
      if (!staging) {
        if (!rooms.has(roomId)) rooms.set(roomId, await loadRoom(roomId));
        const room = rooms.get(roomId);
        if (
          [
            room?.head,
            room?.previousHead,
            room?.explicitHead,
            room?.restoreHead,
          ].some((entry) => entry?.id === id && entry.generation === generation)
        )
          continue;
      }
      await bucket
        .file(file.name, { generation })
        .delete({ ignoreNotFound: true, ifGenerationMatch: generation })
        .catch((error) => {
          if (error.code !== 404 && error.code !== 412) throw error;
        });
    }
    reaperCursors.set(prefix, next?.pageToken);
  }
}

module.exports = { checkpointValidatorReady, handle, reap };
