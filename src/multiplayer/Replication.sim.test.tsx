import "../Store";
import cloneDeep from "lodash.clonedeep";
import fs from "fs";
import path from "path";
import { TextEncoder } from "util";
import { TICKS_PER_MONTH } from "../Constants";
import {
  answerReplicationChoices,
  createReplicationFixture,
  exerciseReplicationControls,
  fixtureCommand,
  fixtureMonth,
  fixedReplicationTranscript,
  prepareReplicationFixture,
  replicaDigest,
} from "../testing/ReplicationFixtures";
import { Replica } from "./Replication";
import type { ReplicaBatch, ReplicaRecord } from "./Replication";
const { parse, stringify } = require("../../electron/coop-codec.cjs");
Object.assign(globalThis, { TextEncoder });
jest.setTimeout(180000);

function wire<T>(value: T): T {
  return parse(stringify(value));
}

/** Hash captures occur synchronously at the verify boundary, before later records advance it. */
async function applyBatch(
  replica: Replica,
  batch: ReplicaBatch,
  expected: Map<number, string>,
) {
  for (const [offset, record] of wire(batch.records).entries()) {
    const index = batch.from + offset;
    replica.apply(index, [record]);
    if (record.t === "verify")
      expect(await replicaDigest(replica.world)).toBe(expected.get(index));
  }
}

for (const kind of ["official", "custom", "mod"] as const)
  test.each([2, 4])(
    `${kind}: %i companies replay five years from every bootstrap boundary`,
    async (players) => {
      const host = createReplicationFixture(kind, players);
      const replicas: Replica[] = [];
      const boundaries: string[] = [];
      const expected = new Map<number, string>();
      async function flush(verify = false) {
        if (verify) host.verify();
        if (verify) expected.set(host.index, await replicaDigest(host.world));
        const batch = host.drain();
        if (batch)
          for (const replica of replicas)
            await applyBatch(replica, batch, expected);
      }
      async function bootstrap(boundary: string) {
        await flush();
        const replica = new Replica();
        replica.install(wire(host.baseline()));
        replicas.push(replica);
        boundaries.push(boundary);
        expected.set(host.index, await replicaDigest(host.world));
        await flush();
      }
      await bootstrap("month zero");
      prepareReplicationFixture(host);
      exerciseReplicationControls(host);
      const rejected = {
        matchId: host.world.matchId,
        epoch: host.world.epoch,
        sequence: (host.world.sequences["0"] || 0) + 1,
        command: { kind: "rate", value: -1 } as const,
      };
      expect(host.command("0", rejected).recorded).toBe(true);
      expect(host.command("0", rejected).recorded).toBe(false);
      expect(
        host.command("0", { ...rejected, sequence: rejected.sequence + 2 })
          .recorded,
      ).toBe(false);
      await flush(true);
      let choices = 0;
      for (
        let tick = 0;
        fixtureMonth(host.world) < 60 && tick < 61 * TICKS_PER_MONTH;
        tick++
      ) {
        if (tick === TICKS_PER_MONTH / 2) await bootstrap("mid month");
        if (tick === TICKS_PER_MONTH - 1) await bootstrap("before rollover");
        if (tick === TICKS_PER_MONTH) await bootstrap("after rollover");
        if (kind !== "custom" && tick === 49 * TICKS_PER_MONTH) {
          const seat = host.world.seats[players - 1].id;
          fixtureCommand(host, seat, {
            kind: "action",
            name: "setBuyingRule",
            payload: "NONE",
          });
          for (const facility of host.world.grids[players - 1].facilities)
            fixtureCommand(host, seat, {
              kind: "action",
              name: "togglePauseFacility",
              payload: facility.id,
            });
        }
        const answered = answerReplicationChoices(host);
        if (answered && !choices) await bootstrap("after choice");
        choices += answered;
        const month = fixtureMonth(host.world);
        expect(host.step()).toBe(true);
        if (fixtureMonth(host.world) !== month) await flush(true);
      }
      await flush(true);
      expect(fixtureMonth(host.world)).toBe(60);
      expect(
        host.world.outcomes[host.world.seats[players - 1].id]?.outcome,
      ).toBe(kind === "custom" ? "completed" : "fired");
      expect(
        host.world.grids.some((game) => game.date.monthsElapsed === 60),
      ).toBe(true);
      expect(boundaries).toEqual(
        kind === "custom"
          ? ["month zero", "mid month", "before rollover", "after rollover"]
          : [
              "month zero",
              "mid month",
              "before rollover",
              "after rollover",
              "after choice",
            ],
      );
      for (const replica of replicas) {
        expect(replica.applied).toBe(host.index);
        expect(await replicaDigest(replica.world)).toBe(
          await replicaDigest(host.world),
        );
      }
    },
  );

async function mutationFixture() {
  const host = createReplicationFixture("custom", 2);
  prepareReplicationFixture(host);
  host.setBlockers(["Visible shell blocker"]);
  host.drain();
  const baseline = wire(host.baseline());
  const replica = new Replica();
  replica.install(baseline);
  const initial = host.drain()!;
  replica.apply(initial.from, initial.records);
  host.setBlockers([]);
  fixtureCommand(host, "0", { kind: "rate", value: 0.11 });
  fixtureCommand(host, "1", { kind: "rate", value: 0.1 });
  host.step();
  host.verify();
  return { host, baseline, initial, batch: wire(host.drain()!) };
}

test.each(["drop", "duplicate", "reorder", "alter"])(
  "the equivalence oracle detects a %s record",
  async (mutation) => {
    const { host, baseline, initial, batch } = await mutationFixture();
    const replica = new Replica();
    replica.install(baseline);
    replica.apply(initial.from, initial.records);
    const records = cloneDeep(batch.records);
    if (mutation === "drop") records.splice(1, 1);
    if (mutation === "duplicate") records.splice(1, 0, records[1]);
    if (mutation === "reorder")
      [records[1], records[2]] = [records[2], records[1]];
    if (mutation === "alter")
      (
        records.find((record) => record.t === "command") as Extract<
          ReplicaRecord,
          { t: "command" }
        >
      ).revision++;
    expect(() => replica.apply(batch.from, records)).toThrow();
    expect(await replicaDigest(replica.world)).not.toBe(
      await replicaDigest(host.world),
    );
  },
);

test("the hash oracle detects missing baseline blockers", async () => {
  const { baseline } = await mutationFixture();
  const original = new Replica();
  original.install(baseline);
  const broken = wire(baseline);
  broken.blockers = [];
  const replica = new Replica();
  replica.install(broken);
  expect(await replicaDigest(replica.world)).not.toBe(
    await replicaDigest(original.world),
  );
});

test("baseline hydration rejects omitted generator commitments", async () => {
  const { baseline } = await mutationFixture();
  const broken = wire(baseline);
  delete broken.world.commitments;
  expect(() => new Replica().install(broken)).toThrow(/dispatch plans/);
});

test("the four-company fixed transcript is bit-exact", async () => {
  const expected = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../testing/replication-transcript.json"),
      "utf8",
    ),
  );
  expect(await fixedReplicationTranscript()).toEqual(expected);
});
