import "../Store";
import cloneDeep from "lodash.clonedeep";
import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import {
  checkpointWorld,
  createWorld,
  hydrateWorld,
  worldBlockers,
} from "./World";
import type { Command, CommandEnvelope } from "./Types";
import {
  applyRecord,
  canonicalWorldBytes,
  Replica,
  ReplicaMismatch,
  ReplicatedWorld,
  worldDigest,
} from "./Replication";
const { parse, stringify } = require("../../electron/coop-codec.cjs");
Object.assign(globalThis, { TextEncoder });
const digest = (bytes: Uint8Array<ArrayBuffer>) =>
  webcrypto.subtle.digest("SHA-256", bytes);
beforeAll(() => loadSimData("SF"));
const create = () =>
  new ReplicatedWorld(
    createWorld(COOP_TEST_SPEC, coopSeats(2), "match", "epoch"),
  );
function envelope(
  host: ReplicatedWorld,
  seat: string,
  command: Command,
): CommandEnvelope {
  return {
    matchId: host.world.matchId,
    epoch: host.world.epoch,
    sequence: (host.world.sequences[seat] || 0) + 1,
    command,
  };
}
const command = (host: ReplicatedWorld, seat: string, action: Command) =>
  host.command(seat, envelope(host, seat, action), true);
function bootstrap(host: ReplicatedWorld) {
  const replica = new Replica();
  host.drain();
  replica.install(parse(stringify(host.baseline())));
  return replica;
}
function replay(host: ReplicatedWorld, replica: Replica) {
  const batch = host.drain();
  if (batch) return replica.apply(batch.from, parse(stringify(batch.records)));
  return [];
}

test("accepted and sequence-consuming rejected commands replay; retries and envelope refusals do not record", async () => {
  const host = create();
  const replica = bootstrap(host);
  const ready = envelope(host, "0", { kind: "ready" });
  expect(host.command("0", ready)).toEqual({
    error: undefined,
    recorded: true,
  });
  expect(host.command("0", ready)).toEqual({
    error: undefined,
    recorded: false,
  });
  expect(host.command("0", { ...ready, sequence: 3 }).recorded).toBe(false);
  expect(host.command("0", { ...ready, epoch: "old" }).recorded).toBe(false);
  expect(command(host, "1", { kind: "rate", value: -1 })).toMatchObject({
    recorded: true,
    error: expect.any(String),
  });
  command(host, "1", { kind: "ready" });
  host.step();
  host.step();
  host.verify();
  expect(replay(host, replica)).toEqual([1, 6]);
  expect(replica.applied).toBe(host.index);
  expect(await worldDigest(canonicalWorldBytes(replica.world), digest)).toBe(
    await worldDigest(canonicalWorldBytes(host.world), digest),
  );
});

test("steps coalesce only while unflushed and stop at record boundaries", () => {
  const host = create();
  expect(host.step()).toBe(false);
  command(host, "0", { kind: "ready" });
  command(host, "1", { kind: "ready" });
  host.drain();
  host.step();
  host.step();
  expect(host.drain()).toMatchObject({
    from: 3,
    records: [{ t: "step", n: 2, revision: 4 }],
  });
  host.step();
  host.verify();
  host.step();
  expect(host.drain()).toMatchObject({
    from: 4,
    records: [{ t: "step", n: 1 }, { t: "verify" }, { t: "step", n: 1 }],
  });
});

test("baseline detaches live state and includes shell and host blockers without resetting readiness", async () => {
  const host = create();
  command(host, "0", { kind: "ready" });
  command(host, "1", { kind: "speed", speed: "ULTRA" });
  host.setBlockers(["System dialog"], ["Waiting for Player 1"]);
  const baseline = host.baseline();
  const replica = new Replica();
  replica.install(parse(stringify(baseline)));
  expect(replica.world.selectedSpeeds).toEqual(host.world.selectedSpeeds);
  expect(worldBlockers(replica.world)).toEqual([
    "System dialog",
    "Waiting for Player 1",
  ]);
  const before = canonicalWorldBytes(replica.world);
  expect(await worldDigest(before, digest)).toBe(
    await worldDigest(canonicalWorldBytes(host.world), digest),
  );
  command(host, "0", { kind: "rate", value: 0.15 });
  expect(
    Buffer.compare(
      Buffer.from(canonicalWorldBytes(replica.world)),
      Buffer.from(before),
    ),
  ).toBe(0);
  expect(baseline.world.sequences["0"]).toBe(1);
});

test("failed baseline validation preserves the installed replica", () => {
  const host = create();
  const replica = bootstrap(host);
  const before = replica.world;
  const bad = host.baseline();
  bad.epoch = "wrong";
  expect(() => replica.install(bad)).toThrow(ReplicaMismatch);
  expect(replica.world).toBe(before);
  const oldRules = host.baseline();
  oldRules.world.rules =
    "coop-2-52b30cebdf5c08f453a29c4d1b445fa8a949e8c6f354f2f344683029b032f167";
  expect(() => replica.install(oldRules)).toThrow(ReplicaMismatch);
  expect(replica.world).toBe(before);
  const malformed = { ...bad, epoch: host.world.epoch, blockers: [4] };
  expect(() => replica.install(malformed as unknown as typeof bad)).toThrow(
    ReplicaMismatch,
  );
});

test("gaps, duplicate batches, altered command results and non-advancing steps fail", () => {
  const host = create();
  const replica = bootstrap(host);
  const batch = host.drain()!;
  expect(() => replica.apply(batch.from + 1, batch.records)).toThrow(
    ReplicaMismatch,
  );
  replica.apply(batch.from, batch.records);
  expect(() => replica.apply(batch.from, batch.records)).toThrow(
    ReplicaMismatch,
  );
  command(host, "0", { kind: "ready" });
  const changed = host.drain()!;
  const altered = cloneDeep(changed.records);
  if (altered[0].t !== "command") throw new Error("Expected command");
  altered[0].error = "Invented error";
  expect(() => replica.apply(changed.from, altered)).toThrow(/Command result/);
  expect(() =>
    applyRecord(host.world, {
      t: "step",
      n: 1,
      revision: host.world.revision + 1,
    }),
  ).toThrow(/did not advance/);
  expect(() =>
    applyRecord(host.world, { t: "step", n: 0, revision: 1 }),
  ).toThrow(/Invalid/);
});

test("fault is terminal until a new baseline replaces the replica", () => {
  const host = create();
  const replica = bootstrap(host);
  host.fault("Simulation failed");
  replay(host, replica);
  expect(replica.stopped).toBe(true);
  expect(() => replica.apply(replica.applied + 1, [{ t: "verify" }])).toThrow(
    ReplicaMismatch,
  );
  expect(() => host.step()).toThrow(ReplicaMismatch);
  replica.install(create().baseline());
  expect(replica.stopped).toBe(false);
});

test("canonical bytes preserve special numbers/array undefined, omit object undefined and sort keys", async () => {
  const host = create();
  const left = host.world;
  const right = cloneDeep(left);
  Object.assign(left, {
    fixture: {
      z: [undefined, -0, NaN, Infinity, -Infinity],
      a: true,
      absent: undefined,
    },
  });
  Object.assign(right, {
    fixture: { a: true, z: [undefined, -0, NaN, Infinity, -Infinity] },
  });
  expect(
    Buffer.compare(
      Buffer.from(canonicalWorldBytes(left)),
      Buffer.from(canonicalWorldBytes(right)),
    ),
  ).toBe(0);
  expect(
    Buffer.compare(
      Buffer.from(canonicalWorldBytes(left)),
      Buffer.from(
        canonicalWorldBytes(
          hydrateWorld(parse(stringify(checkpointWorld(left)))),
        ),
      ),
    ),
  ).toBe(0);
  const altered = cloneDeep(right);
  Object.assign(altered, {
    fixture: { a: true, z: [null, 0, NaN, Infinity, -Infinity] },
  });
  expect(
    Buffer.compare(
      Buffer.from(canonicalWorldBytes(left)),
      Buffer.from(canonicalWorldBytes(altered)),
    ),
  ).not.toBe(0);
  expect(await worldDigest(new TextEncoder().encode("abc"), digest)).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
