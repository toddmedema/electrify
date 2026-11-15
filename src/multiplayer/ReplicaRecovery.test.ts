import "../Store";
import { webcrypto } from "crypto";
import { TextEncoder } from "util";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { currentTick } from "../helpers/GameSelectors";
import { createWorld, worldBlockers } from "./World";
import type { Command, CommandEnvelope } from "./Types";
import {
  canonicalWorldBytes,
  Replica,
  ReplicatedWorld,
  worldDigest,
} from "./Replication";
import type {
  DigestFunction,
  ReplicaBaseline,
  ReplicaBatch,
} from "./Replication";
import { ReplicaRecovery } from "./ReplicaRecovery";

Object.assign(globalThis, { TextEncoder });
const digest: DigestFunction = (bytes) =>
  webcrypto.subtle.digest("SHA-256", bytes);
const { parse, stringify } = require("../../electron/coop-codec.cjs");
beforeAll(() => loadSimData("SF"));
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
function fixture(hash: DigestFunction = digest, count = 2) {
  let now = 0;
  const host = new ReplicatedWorld(
    createWorld(COOP_TEST_SPEC, coopSeats(count), "match", "epoch"),
    () => now,
  );
  const events: (
    | { kind: "baseline"; to: string; baseline: ReplicaBaseline }
    | { kind: "records"; batch: ReplicaBatch }
  )[] = [];
  const flush = () => {
    const batch = host.drain();
    if (batch) events.push({ kind: "records", batch });
  };
  const error = jest.fn();
  const recovery = new ReplicaRecovery(host, "0", {
    now: () => now,
    digest: hash,
    flush,
    send: (to, baseline) => events.push({ kind: "baseline", to, baseline }),
    changed: () => {},
    error,
  });
  const progress = (
    applied = host.index,
    verified?: { index: number; hash: string },
    sender = "1",
  ) =>
    recovery.progress({
      sender,
      matchId: "match",
      epoch: "epoch",
      applied,
      verified,
    });
  const envelope = (seat: string, command: Command): CommandEnvelope => ({
    matchId: "match",
    epoch: "epoch",
    sequence: (host.world.sequences[seat] || 0) + 1,
    command,
  });
  const command = (seat: string, action: Command) =>
    host.command(seat, envelope(seat, action));
  return {
    host,
    recovery,
    events,
    flush,
    error,
    progress,
    command,
    envelope,
    time: (time: number) => {
      now = time;
    },
    baselines: () => events.filter((event) => event.kind === "baseline"),
  };
}

test("a deliberately altered replica recovers at a hash boundary and a pending purchase applies exactly once", async () => {
  const f = fixture();
  const replica = new Replica();
  let cursor = 0;
  const deliver = async () => {
    f.flush();
    while (cursor < f.events.length) {
      const event = f.events[cursor++];
      if (event.kind === "baseline")
        replica.install(parse(stringify(event.baseline)));
      else {
        // A recovering replica discards stream entries preceding its first baseline.
        if (!replica.applied && cursor === 1) continue;
        for (const [i, record] of event.batch.records.entries()) {
          replica.apply(event.batch.from + i, parse(stringify([record])));
          if (record.t === "verify") {
            const hash = await worldDigest(
              canonicalWorldBytes(replica.world),
              digest,
            );
            f.progress(replica.applied, { index: replica.applied, hash });
          }
        }
      }
    }
    f.progress(replica.applied);
  };
  expect(f.recovery.baseline("1")).toBe(true);
  await deliver();
  await settle();
  const before = currentTick(f.host.world.grids[1])!.cash;
  // This corruption does not affect command validation or revision checks; only hashes catch it.
  replica.world.grids[1].eventLog.push({ kind: "FUEL_PRICE" } as never);
  const purchase = f.envelope("1", {
    kind: "action",
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  expect(f.host.command("1", purchase).recorded).toBe(true);
  f.time(1000);
  f.recovery.pulse();
  await settle();
  await deliver();
  await settle();
  await deliver();
  expect(f.baselines()).toHaveLength(2);
  expect(f.host.command("1", purchase)).toEqual({
    error: undefined,
    recorded: false,
  });
  expect(currentTick(f.host.world.grids[1])!.cash).toBeLessThan(before);
  expect(
    replica.world.grids[1].facilities.filter(
      (facility) => facility.name === "Wind",
    ),
  ).toHaveLength(2);
  expect(await worldDigest(canonicalWorldBytes(replica.world), digest)).toBe(
    await worldDigest(canonicalWorldBytes(f.host.world), digest),
  );
  expect(f.error).not.toHaveBeenCalled();
});

test("reconnect during an outstanding recovery installs a fresh baseline, while duplicate requests are capped", async () => {
  const f = fixture();
  expect(f.recovery.baseline("1")).toBe(true);
  const first = f.baselines()[0];
  expect(f.recovery.baseline("1")).toBe(false);
  f.progress(0); // A waiting replica cannot acknowledge a later baseline.
  expect(f.recovery.baseline("1")).toBe(false);
  f.recovery.connected([]);
  expect(f.recovery.baseline("1")).toBe(false);
  f.recovery.connected(["1"]);
  expect(f.recovery.baseline("1")).toBe(true);
  const latest = f.baselines()[1];
  expect(
    first.kind === "baseline" &&
      latest.kind === "baseline" &&
      latest.baseline.index > first.baseline.index,
  ).toBe(true);
  const replica = new Replica();
  if (latest.kind !== "baseline") throw new Error("Missing baseline");
  replica.install(parse(stringify(latest.baseline)));
  const batch = f.host.drain()!;
  replica.apply(batch.from, batch.records);
  f.progress(replica.applied);
  f.time(11000);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(2);
  expect(replica.world.sequences).toEqual(f.host.world.sequences);
  await settle();
});

test("slow replicas hold and release the clock without Ready; progress extends the stuck-replica deadline", async () => {
  const f = fixture();
  f.recovery.baseline("1");
  f.progress();
  f.command("0", { kind: "speed", speed: "NORMAL" });
  f.command("1", { kind: "speed", speed: "NORMAL" });
  f.progress();
  expect(f.host.world.readyRequired).toBe(false);
  expect(f.host.world.paused).toBe(false);
  f.host.step();
  const behind = f.host.index - 1;
  f.time(2001);
  f.recovery.pulse();
  expect(worldBlockers(f.host.world)).toEqual([
    "Waiting for Player 1 to catch up",
  ]);
  expect(f.host.world.paused).toBe(true);
  expect(f.host.world.readyRequired).toBe(false);
  f.recovery.setShellBlockers(["System dialog"]);
  f.progress();
  expect(worldBlockers(f.host.world)).toEqual(["System dialog"]);
  f.recovery.setShellBlockers([]);
  expect(f.host.world.paused).toBe(false);
  expect(f.host.world.readyRequired).toBe(false);
  f.host.drain();
  f.host.step();
  f.time(4100);
  f.recovery.pulse();
  f.time(13000);
  f.progress(behind + 1);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(1);
  f.time(23001);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(2);
  expect(f.host.world.readyRequired).toBe(true);
  await settle();
});

test("idle paused live replicas never recover or generate unchanged verify traffic", async () => {
  const f = fixture();
  f.recovery.baseline("1");
  f.progress();
  const index = f.host.index;
  for (let time = 500; time <= 30000; time += 500) {
    f.time(time);
    f.recovery.pulse();
    f.progress();
  }
  expect(f.baselines()).toHaveLength(1);
  expect(f.host.index).toBe(index);
  expect(worldBlockers(f.host.world)).toEqual([]);
  await settle();
});

test("disconnected and retired peers cannot hold time, and a third baseline stops recovery durably", async () => {
  const f = fixture();
  f.recovery.baseline("1");
  f.progress();
  f.command("0", { kind: "rate", value: 0.15 });
  f.time(3000);
  f.recovery.pulse();
  expect(worldBlockers(f.host.world)).toHaveLength(1);
  f.recovery.connected([]);
  expect(worldBlockers(f.host.world)).toEqual([]);
  f.recovery.connected(["1"]);
  f.host.world.outcomes["1"] = {
    outcome: "bankrupt",
    title: "Bankrupt",
    month: 0,
  };
  f.progress();
  f.command("0", { kind: "rate", value: 0.16 });
  f.time(6000);
  f.recovery.pulse();
  expect(worldBlockers(f.host.world)).toEqual([]);
  delete f.host.world.outcomes["1"];
  expect(f.recovery.baseline("1")).toBe(true);
  f.time(16000);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(2);
  const reason = "Player 1 could not stay in sync. Save and resume the match.";
  expect(f.host.world.reason).toBe(reason);
  expect(f.host.world.readyRequired).toBe(true);
  f.recovery.setShellBlockers(["System dialog"]);
  expect(worldBlockers(f.host.world)).toEqual(["System dialog", reason]);
  f.recovery.setShellBlockers([]);
  f.command("0", { kind: "ready" });
  f.command("1", { kind: "ready" });
  expect(f.host.world.paused).toBe(true);
  expect(f.host.world.reason).toContain(reason);
  expect(f.recovery.baseline("1")).toBe(false);
  await settle();
});

test("only changed worlds verify once per second, with two digest slots and synchronous boundary capture", async () => {
  const pending: {
    bytes: Uint8Array<ArrayBuffer>;
    resolve: (hash: ArrayBuffer) => void;
  }[] = [];
  const hash = jest.fn(
    (bytes: Uint8Array<ArrayBuffer>) =>
      new Promise<ArrayBuffer>((resolve) => pending.push({ bytes, resolve })),
  );
  const f = fixture(hash, 4);
  f.recovery.baseline("1");
  const firstBytes = canonicalWorldBytes(f.host.world);
  f.recovery.baseline("2");
  f.recovery.baseline("3");
  expect(hash).toHaveBeenCalledTimes(2);
  expect(pending[0].bytes).toEqual(firstBytes);
  expect(pending[0].bytes).not.toEqual(canonicalWorldBytes(f.host.world));
  for (const sender of ["1", "2", "3"])
    f.progress(f.host.index, undefined, sender);
  f.command("0", { kind: "rate", value: 0.15 });
  f.time(999);
  f.recovery.pulse();
  expect(hash).toHaveBeenCalledTimes(2);
  f.time(1000);
  f.recovery.pulse();
  expect(hash).toHaveBeenCalledTimes(2);
  // Resolve out of order; neither digest reads the world after its capture boundary.
  pending[1].resolve(await digest(pending[1].bytes));
  pending[0].resolve(await digest(pending[0].bytes));
  await settle();
  expect(hash).toHaveBeenCalledTimes(3);
  f.command("0", { kind: "rate", value: 0.16 });
  f.time(1999);
  f.recovery.pulse();
  expect(hash).toHaveBeenCalledTimes(3);
  f.time(2000);
  f.recovery.pulse();
  expect(hash).toHaveBeenCalledTimes(4);
  f.recovery.stop();
  pending[2].resolve(await digest(pending[2].bytes));
  pending[3].resolve(await digest(pending[3].bytes));
  await settle();
  f.time(20000);
  f.recovery.pulse();
  expect(hash).toHaveBeenCalledTimes(4);
  expect(f.error).not.toHaveBeenCalled();
});

test.each([0, 17])(
  "digest backpressure retries the final paused world after %i captures and detects its divergence",
  async (completed) => {
    const pending: {
      bytes: Uint8Array<ArrayBuffer>;
      resolve: (hash: ArrayBuffer) => void;
    }[] = [];
    const hash = jest.fn(
      (bytes: Uint8Array<ArrayBuffer>) =>
        new Promise<ArrayBuffer>((resolve) => pending.push({ bytes, resolve })),
    );
    const f = fixture(hash);
    f.recovery.baseline("1");
    f.progress();
    // Keep the first digest pending while enough later captures evict its comparison entry.
    for (let i = 0; i < completed; i++) {
      f.command("0", { kind: "rate", value: 0.1 + i / 1000 });
      f.time((i + 1) * 1000);
      f.recovery.pulse();
      f.progress();
      pending.at(-1)!.resolve(await digest(pending.at(-1)!.bytes));
      await settle();
    }
    f.command("0", { kind: "rate", value: 0.15 });
    f.time((completed + 1) * 1000);
    f.recovery.pulse();
    f.progress();
    f.command("0", { kind: "rate", value: 0.16 });
    f.time((completed + 2) * 1000);
    f.recovery.pulse();
    f.progress();
    expect(f.host.world.paused).toBe(true);
    expect(hash).toHaveBeenCalledTimes(completed + 2);
    const skipped = f.host.index;
    const finalBytes = canonicalWorldBytes(f.host.world);
    const released = pending[completed ? 0 : 1];
    released.resolve(await digest(released.bytes));
    await settle();
    expect(hash).toHaveBeenCalledTimes(completed + 3);
    expect(f.host.index).toBe(skipped + 1);
    const retried = pending.at(-1)!;
    expect(retried.bytes).toEqual(finalBytes);
    const verified = f.host.index;
    f.progress(verified, { index: verified, hash: "0".repeat(64) });
    expect(f.baselines()).toHaveLength(1);
    retried.resolve(await digest(retried.bytes));
    await settle();
    expect(f.baselines()).toHaveLength(2);
    f.recovery.stop();
    for (const entry of pending) entry.resolve(await digest(entry.bytes));
    await settle();
    expect(f.error).not.toHaveBeenCalled();
  },
);

test.each([false, true])(
  "a rejected digest retries skipped verification only while live, stopped=%s",
  async (stopped) => {
    const pending: {
      bytes: Uint8Array<ArrayBuffer>;
      resolve: (hash: ArrayBuffer) => void;
      reject: (error: Error) => void;
    }[] = [];
    const hash = jest.fn(
      (bytes: Uint8Array<ArrayBuffer>) =>
        new Promise<ArrayBuffer>((resolve, reject) =>
          pending.push({ bytes, resolve, reject }),
        ),
    );
    const f = fixture(hash);
    f.recovery.baseline("1");
    f.progress();
    for (const time of [1000, 2000]) {
      f.command("0", { kind: "rate", value: 0.1 + time / 100000 });
      f.time(time);
      f.recovery.pulse();
      f.progress();
    }
    expect(hash).toHaveBeenCalledTimes(2);
    if (stopped) f.recovery.stop();
    const error = new Error("Digest failed");
    pending[0].reject(error);
    await settle();
    expect(hash).toHaveBeenCalledTimes(stopped ? 2 : 3);
    expect(f.error.mock.calls).toEqual(stopped ? [] : [[error]]);
    const index = f.host.index;
    f.progress();
    for (const time of [3000, 4000, 5000]) {
      f.time(time);
      f.recovery.pulse();
    }
    expect(f.host.index).toBe(index);
    expect(hash).toHaveBeenCalledTimes(stopped ? 2 : 3);
    f.recovery.stop();
    for (const entry of pending) entry.resolve(await digest(entry.bytes));
    await settle();
    expect(hash).toHaveBeenCalledTimes(stopped ? 2 : 3);
  },
);

test("reports arriving before the captured digest compare later; unmatched, stale and old epoch reports are ignored", async () => {
  let finish!: (hash: ArrayBuffer) => void;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.recovery.baseline("1");
  f.progress(f.host.index, { index: f.host.index, hash: "0".repeat(64) });
  expect(f.baselines()).toHaveLength(1);
  finish(new Uint8Array(32).fill(1).buffer);
  await settle();
  expect(f.baselines()).toHaveLength(2);
  const index = f.host.index;
  f.progress(index, { index: index - 2, hash: "0".repeat(64) });
  f.progress(index, { index: index - 1, hash: "0".repeat(64) });
  f.recovery.progress({
    sender: "1",
    matchId: "match",
    epoch: "old",
    applied: index,
    verified: { index, hash: "0".repeat(64) },
  });
  expect(f.baselines()).toHaveLength(2);
  finish(new Uint8Array(32).fill(1).buffer);
  await settle();
  expect(f.baselines()).toHaveLength(2);
});

test("only the newest sixteen captured verify indexes remain comparable", async () => {
  const f = fixture(() => Promise.resolve(new Uint8Array(32).fill(1).buffer));
  f.recovery.baseline("1");
  const old = f.host.index;
  f.progress();
  for (let i = 1; i <= 17; i++) {
    f.command("0", { kind: "rate", value: 0.1 + i / 1000 });
    f.time(i * 1000);
    f.recovery.pulse();
    f.progress();
    await settle();
  }
  f.progress(f.host.index, { index: old, hash: "0".repeat(64) });
  expect(f.baselines()).toHaveLength(1);
  f.progress(f.host.index, { index: f.host.index, hash: "0".repeat(64) });
  expect(f.baselines()).toHaveLength(2);
});

test("old recovery attempts expire after sixty seconds, permitting a later baseline", async () => {
  const f = fixture();
  f.recovery.baseline("1");
  f.time(10000);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(2);
  f.time(61000);
  f.recovery.pulse();
  expect(f.baselines()).toHaveLength(3);
  expect(worldBlockers(f.host.world)).toEqual([]);
  await settle();
});

test("a terminal fault discards pending comparisons and digest failures", async () => {
  let reject!: (reason: Error) => void;
  const f = fixture(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  f.recovery.baseline("1");
  f.progress(f.host.index, { index: f.host.index, hash: "0".repeat(64) });
  f.recovery.stop();
  f.host.fault("Simulation stopped");
  reject(new Error("Digest failed after fault"));
  await settle();
  f.time(30000);
  f.recovery.pulse();
  expect(f.recovery.baseline("1")).toBe(false);
  expect(f.baselines()).toHaveLength(1);
  expect(f.error).not.toHaveBeenCalled();
});
