import fs from "fs";
import path from "path";
import { webcrypto } from "crypto";
import { TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { getScenario } from "../data/Scenarios";
import { getScenarioLocation } from "../helpers/Locations";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { modScenario } from "../mods/ModScenario";
import { validateMod } from "../mods/ModSchema";
import {
  canonicalWorldBytes,
  ReplicatedWorld,
  worldDigest,
} from "../multiplayer/Replication";
import type { Command, MatchSpec, World } from "../multiplayer/Types";
import { createWorld } from "../multiplayer/World";
import { COOP_TEST_SPEC, coopSeats } from "./MultiplayerFixtures";
import { loadSimData } from "./SimData";

export type ReplicationFixture = "official" | "custom" | "mod";
export const replicaDigest = (world: World) =>
  worldDigest(canonicalWorldBytes(world), (bytes) =>
    webcrypto.subtle.digest("SHA-256", bytes),
  );

export function fixtureSpec(kind: ReplicationFixture): MatchSpec {
  if (kind === "official") return { scenarioId: 106, difficulty: "Employee" };
  if (kind === "custom") return COOP_TEST_SPEC;
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
  return {
    scenarioId: 999,
    difficulty: "Employee",
    customScenario: modScenario(pack, undefined, "Employee"),
  };
}

/** All setup is an ordinary validated command. No live grid is mutated by this driver. */
export function fixtureCommand(
  host: ReplicatedWorld,
  seat: string,
  command: Command,
) {
  const result = host.command(
    seat,
    {
      matchId: host.world.matchId,
      epoch: host.world.epoch,
      sequence: (host.world.sequences[seat] || 0) + 1,
      command,
    },
    true,
  );
  if (result.error)
    throw new Error(`Fixture command ${command.kind}: ${result.error}`);
}

export function createReplicationFixture(
  kind: ReplicationFixture,
  count: number,
) {
  const spec = fixtureSpec(kind);
  const scenario = getScenario(spec.scenarioId, spec.customScenario)!;
  loadSimData(getScenarioLocation(scenario)!);
  return new ReplicatedWorld(
    createWorld(
      spec,
      coopSeats(count),
      `replication-${kind}-${count}`,
      "fixed-epoch",
    ),
  );
}

export function prepareReplicationFixture(host: ReplicatedWorld) {
  for (const [index, seat] of host.world.seats.entries()) {
    const game = host.world.grids[index];
    const quote = GENERATORS(
      game,
      game.scenarioId === 106 || game.customScenario?.mod ? 50e6 : 500e6,
      game.timeline.map((tick) => tick.windKph),
      game.timeline.map((tick) => tick.solarIrradianceWM2),
    ).find(
      (facility) =>
        facility.name === "Natural Gas Peaker" && facility.available,
    );
    if (!quote) throw new Error("Fixture needs an available peaker");
    fixtureCommand(host, seat.id, {
      kind: "action",
      name: "buildFacility",
      payload: { facility: quote, financed: true },
    });
    fixtureCommand(host, seat.id, { kind: "rate", value: 0.12 });
    fixtureCommand(host, seat.id, { kind: "speed", speed: "ULTRA" });
  }
  const edge = host.world.edges[0];
  for (const seat of [edge.a, edge.b])
    fixtureCommand(host, seat, {
      kind: "action",
      name: "upgradeTransmissionLine",
      payload: { corridorId: `peer:${edge.id}`, financed: true },
    });
}

/** Script menus, readiness, shell/host blockers and all speed selections while time is stopped. */
export function exerciseReplicationControls(host: ReplicatedWorld) {
  const seat = host.world.seats[0].id;
  host.pause("Scripted safety pause");
  host.setBlockers(["Device menu open"], ["Waiting for fixture peer"]);
  fixtureCommand(host, seat, { kind: "activity", reason: "Building capacity" });
  fixtureCommand(host, seat, { kind: "activity", reason: null });
  for (const speed of ["SLOW", "NORMAL", "FAST", "ULTRA"] as const)
    fixtureCommand(host, seat, { kind: "speed", speed });
  host.setBlockers([]);
  for (const player of host.world.seats)
    fixtureCommand(host, player.id, { kind: "ready" });
}

export function answerReplicationChoices(host: ReplicatedWorld): number {
  let answered = 0;
  for (const [index, seat] of host.world.seats.entries()) {
    const choice = pendingScenarioChoice(host.world.grids[index]);
    if (!choice || host.world.outcomes[seat.id]) continue;
    const option =
      choice.options.find((value) => value.id === "phased") ||
      choice.options[0];
    fixtureCommand(host, seat.id, {
      kind: "action",
      name: "chooseScenarioResponse",
      payload: { decisionId: choice.id, optionId: option.id },
    });
    answered++;
  }
  return answered;
}

export function fixtureMonth(world: World) {
  return Math.max(...world.grids.map((game) => game.date.monthsElapsed));
}
export function advanceReplicationFixture(
  host: ReplicatedWorld,
  month: number,
) {
  for (
    let tick = 0;
    fixtureMonth(host.world) < month && tick <= (month + 1) * TICKS_PER_MONTH;
    tick++
  ) {
    answerReplicationChoices(host);
    if (!host.step())
      throw new Error(
        `Fixture stopped at month ${fixtureMonth(host.world)}: ${host.world.reason}`,
      );
  }
  if (fixtureMonth(host.world) !== month)
    throw new Error("Fixture did not reach target month");
}

/** Only the transcript pins build identity; production hashes always include the real rules ID. */
export async function transcriptDigest(world: World) {
  const rules = world.rules;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    world.rules = "replication-transcript-fixture-v1";
    bytes = canonicalWorldBytes(world);
  } finally {
    world.rules = rules;
  }
  return worldDigest(bytes, (value) =>
    webcrypto.subtle.digest("SHA-256", value),
  );
}
export async function fixedReplicationTranscript() {
  const host = createReplicationFixture("custom", 4);
  prepareReplicationFixture(host);
  const transcript = [];
  for (const month of [0, 1, 12, 24, 36, 48, 60]) {
    advanceReplicationFixture(host, month);
    host.verify();
    transcript.push({
      month,
      index: host.index,
      hash: await transcriptDigest(host.world),
    });
    host.drain();
  }
  return transcript;
}
