import "../Store";
import fs from "fs";
import path from "path";
import { TextEncoder } from "util";
import { webcrypto } from "crypto";
import cloneDeep from "lodash.clonedeep";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { modScenario } from "../mods/ModScenario";
import { modResolvedSetup } from "../mods/ModScenario";
import { getScenarioLocation } from "../helpers/Locations";
import { validateMod } from "../mods/ModSchema";
import {
  canonicalWorldBytes,
  ReplicatedWorld,
  worldDigest,
} from "./Replication";
import { createWorld } from "./World";
import { ReplicaRuntime } from "./ReplicaRuntime";
import type { ReplicaRequest, ReplicaResponse } from "./ReplicaProtocol";
import type { Command } from "./Types";

const { parse, stringify } = require("../../electron/coop-codec.cjs");
Object.assign(globalThis, { TextEncoder });
const digest = (bytes: Uint8Array<ArrayBuffer>) =>
  webcrypto.subtle.digest("SHA-256", bytes);
beforeAll(() => loadSimData("SF"));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const host = () =>
  new ReplicatedWorld(
    createWorld(COOP_TEST_SPEC, coopSeats(2), "match", "epoch"),
  );
const command = (world: ReplicatedWorld, seat: string, value: Command) =>
  world.command(seat, {
    matchId: world.world.matchId,
    epoch: world.world.epoch,
    sequence: (world.world.sequences[seat] ?? 0) + 1,
    command: value,
  });
function fixture(load = async () => {}, hash = digest) {
  const responses: ReplicaResponse[] = [];
  const runtime = new ReplicaRuntime(
    (response) => responses.push(response),
    load,
    () => performance.now(),
    hash,
  );
  const source = host();
  const baseline = parse(stringify(source.baseline()));
  const install = () =>
    runtime.receive({ kind: "baseline", baseline, seat: "1" });
  const replay = async () => {
    const batch = source.drain()!;
    await runtime.receive({
      kind: "records",
      matchId: "match",
      epoch: "epoch",
      ...batch,
    });
  };
  return { source, baseline, runtime, responses, install, replay };
}

test("baseline loading serializes subsequent records and renders only the guest company", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(() => gate);
  const installing = f.install();
  command(f.source, "1", { kind: "rate", value: 0.1 });
  const replay = f.replay();
  await Promise.resolve();
  expect(f.responses).toContainEqual(
    expect.objectContaining({ kind: "progress", state: "waiting" }),
  );
  expect(f.responses.some((response) => response.kind === "views")).toBe(false);
  release();
  await installing;
  await replay;
  const views = f.responses.filter((response) => response.kind === "views");
  expect(views).toHaveLength(1);
  expect(views[0]).toMatchObject({
    kind: "views",
    views: { "1": { lastSequence: 0 } },
  });
  expect(Object.keys(views[0].views)).toEqual(["1"]);
  await f.runtime.receive({ kind: "views-applied" });
  jest.advanceTimersByTime(100);
  expect(
    f.responses.filter((response) => response.kind === "views"),
  ).toHaveLength(2);
  expect(f.responses.at(-1)).toMatchObject({
    kind: "views",
    views: { "1": { lastSequence: 1 } },
  });
});

test("verify bytes are captured before later records in the same batch and only two digests can be pending", async () => {
  const bytes: Uint8Array<ArrayBuffer>[] = [];
  const releases: ((value: ArrayBuffer) => void)[] = [];
  const f = fixture(undefined, (value) => {
    bytes.push(value);
    return new Promise<ArrayBuffer>((resolve) => releases.push(resolve));
  });
  const first = canonicalWorldBytes(f.source.world);
  await f.install();
  command(f.source, "1", { kind: "rate", value: 0.1 });
  f.source.verify();
  const second = canonicalWorldBytes(f.source.world);
  command(f.source, "1", { kind: "rate", value: 0.11 });
  f.source.verify();
  await f.replay();
  expect(bytes).toHaveLength(2);
  expect(Buffer.compare(Buffer.from(bytes[0]), Buffer.from(first))).toBe(0);
  expect(Buffer.compare(Buffer.from(bytes[1]), Buffer.from(second))).toBe(0);
  releases[1](await digest(bytes[1]));
  releases[0](await digest(bytes[0]));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.responses).toContainEqual(
    expect.objectContaining({
      kind: "progress",
      applied: 5,
      verified: { index: 3, hash: await worldDigest(second, digest) },
    }),
  );
});

test.each(["gap", "epoch", "record", "empty"])(
  "a %s violation requests recovery, discards records, then accepts a new baseline",
  async (violation) => {
    const f = fixture();
    await f.install();
    const batch = f.source.drain()!;
    await f.runtime.receive({
      kind: "records",
      matchId: "match",
      epoch: violation === "epoch" ? "old" : "epoch",
      from: violation === "gap" ? 2 : batch.from,
      records:
        violation === "empty"
          ? []
          : violation === "record"
            ? [{ t: "step", n: 0, revision: 1 }]
            : batch.records,
    });
    expect(
      f.responses.filter((response) => response.kind === "resync"),
    ).toHaveLength(1);
    command(f.source, "1", { kind: "rate", value: 0.1 });
    await f.replay();
    expect(f.responses.at(-1)).toMatchObject({ kind: "resync" });
    const baseline = f.source.baseline();
    await f.runtime.receive({ kind: "baseline", baseline, seat: "1" });
    expect(f.responses).toContainEqual(
      expect.objectContaining({
        kind: "progress",
        state: "live",
        applied: baseline.index,
      }),
    );
  },
);

test("a superseded baseline load failure cannot discard the newer baseline or its records", async () => {
  let reject!: (reason: Error) => void;
  const load = jest.fn(async () => {});
  load.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const f = fixture(load);
  const obsolete = f.install();
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  command(f.source, "1", { kind: "rate", value: 0.1 });
  f.source.drain();
  const baseline = f.source.baseline();
  const current = f.runtime.receive({ kind: "baseline", baseline, seat: "1" });
  command(f.source, "1", { kind: "rate", value: 0.11 });
  const replay = f.replay();
  reject(new Error("Obsolete data load failed"));
  await Promise.all([obsolete, current, replay]);
  await f.runtime.receive({ kind: "views-applied" });
  jest.advanceTimersByTime(100);
  expect(load).toHaveBeenCalledTimes(2);
  expect(f.responses.some((response) => response.kind === "resync")).toBe(
    false,
  );
  expect(f.responses.at(-1)).toMatchObject({
    kind: "views",
    views: { "1": { lastSequence: 2, game: { dollarsPerkWh: 0.11 } } },
  });
});

test("an acknowledged old projection releases credit when a newer baseline supersedes its queued acknowledgement", async () => {
  const f = fixture();
  await f.install();
  const acknowledged = f.runtime.receive({ kind: "views-applied" });
  const baseline = f.source.baseline();
  const installed = f.runtime.receive({
    kind: "baseline",
    baseline,
    seat: "1",
  });
  await acknowledged;
  await installed;
  expect(
    f.responses.filter((response) => response.kind === "views"),
  ).toHaveLength(2);
});

test.each(["count", "bytes"])(
  "the %s loading limit rejects a violating buffer and allows a new valid baseline",
  async (limit) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture(() => gate);
    const installing = f.install();
    await Promise.resolve();
    const request: ReplicaRequest = {
      kind: "records",
      matchId: "match",
      epoch: "epoch",
      from: 1,
      records:
        limit === "count"
          ? Array.from({ length: 1025 }, () => ({ t: "verify" as const }))
          : [{ t: "pause", reason: "x".repeat(4 * 1024 * 1024) }],
    };
    await f.runtime.receive(request);
    expect(f.responses).toContainEqual(
      expect.objectContaining({
        kind: "resync",
        reason: "Replica loading buffer overflow",
      }),
    );
    release();
    await installing;
    expect(f.responses.some((response) => response.kind === "views")).toBe(
      false,
    );
    await f.install();
    expect(f.responses).toContainEqual(
      expect.objectContaining({ kind: "progress", state: "live" }),
    );
  },
);

test("a terminal fault stops replay without hashing the partly mutated host state", async () => {
  const hash = jest.fn(digest);
  const f = fixture(undefined, hash);
  await f.install();
  await f.replay();
  hash.mockClear();
  f.source.fault("Simulation stopped");
  await f.replay();
  expect(f.responses).toContainEqual(
    expect.objectContaining({
      kind: "progress",
      state: "stopped",
      error: "Simulation stopped",
    }),
  );
  expect(hash).not.toHaveBeenCalled();
  await f.runtime.receive({
    kind: "records",
    matchId: "match",
    epoch: "epoch",
    from: 3,
    records: [{ t: "verify" }],
  });
  expect(hash).not.toHaveBeenCalled();
});

test("a modded baseline requires the pinned scenario and its seed, difficulty and starting year", async () => {
  const pack = validateMod(
    JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../docs/mods/examples/funded-or-phased-connection.json",
        ),
        "utf8",
      ),
    ),
  );
  const scenario = modScenario(pack, undefined, "Employee");
  loadSimData(getScenarioLocation(modResolvedSetup(pack))!);
  const source = new ReplicatedWorld(
    createWorld(
      { scenarioId: 999, difficulty: "Employee", customScenario: scenario },
      coopSeats(2),
      "mod",
      "epoch",
    ),
  );
  const baseline = parse(stringify(source.baseline()));
  const responses: ReplicaResponse[] = [];
  const load = jest.fn(async () => {});
  const runtime = new ReplicaRuntime(
    (response) => responses.push(response),
    load,
    undefined,
    digest,
  );
  await runtime.receive({ kind: "baseline", baseline, seat: "1" });
  expect(responses).toContainEqual(
    expect.objectContaining({
      kind: "resync",
      reason: expect.stringContaining("validated scenario"),
    }),
  );
  expect(load).not.toHaveBeenCalled();
  const wrong = cloneDeep(baseline);
  wrong.world.grids[1].seed++;
  await runtime.receive({
    kind: "baseline",
    baseline: wrong,
    seat: "1",
    scenario,
  });
  expect(load).not.toHaveBeenCalled();
  await runtime.receive({ kind: "baseline", baseline, seat: "1", scenario });
  expect(load).toHaveBeenCalledTimes(1);
  expect(responses).toContainEqual(
    expect.objectContaining({ kind: "progress", state: "live" }),
  );
});
