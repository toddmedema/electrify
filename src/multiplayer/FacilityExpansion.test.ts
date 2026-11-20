import cloneDeep from "lodash.clonedeep";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import { createGame } from "../testing/Simulator";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { currentTick } from "../helpers/GameSelectors";
import { facilityExpansionQuote } from "../helpers/FacilityExpansion";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";

function command(world: World, sender: string, action: Command) {
  return applyCommand(world, sender, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[sender] ?? 0) + 1,
    command: action,
  });
}

it("host finances and cancels only the sender's expansion and restores its debt from checkpoints", () => {
  createGame({ scenarioId: 104 }); // Load the same simulation datasets as the real host.
  const world = createWorld(
    { scenarioId: 104, difficulty: "Employee" },
    coopSeats(2),
    "capacity",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e12;
  currentTick(world.grids[1])!.cash = 1e12;
  world.grids[1].facilities[0].id = 999;
  const peer = cloneDeep(world.grids[1].facilities);
  const original = world.grids[0].facilities[0];
  const quote = facilityExpansionQuote(
    world.grids[0],
    original.id,
    original.peakW * 1.2,
    true,
  );
  if (quote.status !== "ready") throw new Error(quote.reason);
  const action: Command = {
    kind: "action",
    name: "expandFacility",
    payload: {
      facilityId: original.id,
      targetSize: quote.targetSize,
      quoteKey: quote.quoteKey,
      financed: true,
    },
  };
  expect(
    command(world, "0", {
      ...action,
      payload: { ...(action.payload as object), facilityId: 999 },
    }),
  ).toBeDefined();
  expect(command(world, "0", action)).toBeUndefined();
  expect(world.grids[0].facilities[0].peakW).toBe(original.peakW);
  expect(world.grids[0].facilities[0].expansionInProgress?.loan).toEqual(
    quote.loan,
  );
  expect(world.grids[0].facilities[0].expansionInProgress!.quoteKey).toBe(
    quote.quoteKey,
  );
  expect(world.grids[1].facilities).toEqual(peer);
  expect(command(world, "0", action)).toBeDefined();
  const checkpoint = checkpointWorld(world);
  const restored = restoreWorld(checkpoint, "restored-epoch");
  expect(restored.grids[0].facilities).toEqual(world.grids[0].facilities);
  const mapLineages = [
    [
      20,
      "coop-2-f55523858de9d3d66c6be60626ffab92225cba0047b3e4611ad639f83b4aad90",
    ],
    [
      23,
      "coop-2-3a64b92f0462af2eb6286821f118c030f25aaf65b546a4a7652e87b1dbcd3e33",
    ],
  ] as const;
  const restoredPreviews = mapLineages.map(([gameSchema, rules]) => {
    const previewCheckpoint = { ...checkpoint, gameSchema, rules };
    const restoredPreview = restoreWorld(previewCheckpoint, "preview-epoch");
    expect(restoredPreview.gameSchema).toBe(SAVE_SCHEMA_VERSION);
    expect(restoredPreview.grids[0].facilities).toEqual(
      world.grids[0].facilities,
    );
    const badLoan = cloneDeep(previewCheckpoint);
    badLoan.grids[0].facilities[0].expansionInProgress!.loan!.loanAmountLeft =
      -1;
    expect(() => restoreWorld(badLoan, "corrupt-loan")).toThrow(
      /invalid grids/,
    );
    expect(() =>
      restoreWorld(
        { ...previewCheckpoint, rules: previewCheckpoint.rules + "-unknown" },
        "unknown-preview",
      ),
    ).toThrow(/unsupported format/);
    return restoredPreview;
  });
  for (const match of [world, restored, ...restoredPreviews]) {
    for (const seat of match.seats) {
      expect(command(match, seat.id, { kind: "ready" })).toBeUndefined();
      expect(
        command(match, seat.id, { kind: "speed", speed: "FAST" }),
      ).toBeUndefined();
    }
  }
  const beforeMinute = world.grids[0].date.minute;
  stepWorld(world);
  stepWorld(restored);
  for (const preview of restoredPreviews) {
    stepWorld(preview);
    expect(preview.grids[0].facilities).toEqual(restored.grids[0].facilities);
  }
  expect(world.grids[0].date.minute).toBeGreaterThan(beforeMinute);
  expect(restored.grids[0].facilities).toEqual(world.grids[0].facilities);
  expect(
    command(world, "0", {
      kind: "action",
      name: "cancelFacilityExpansion",
      payload: { facilityId: original.id, quoteKey: quote.quoteKey },
    }),
  ).toBeUndefined();
  expect(world.grids[0].facilities[0].expansionInProgress).toBeUndefined();
  expect(
    command(world, "0", {
      kind: "action",
      name: "cancelFacilityExpansion",
      payload: { facilityId: original.id, quoteKey: quote.quoteKey },
    }),
  ).toBeDefined();
});

it("rejects delayed cancellation and start commands after an identical same-month replacement", () => {
  createGame({ scenarioId: 104 });
  const world = createWorld(
    { scenarioId: 104, difficulty: "Employee" },
    coopSeats(2),
    "replacement",
    "epoch",
  );
  const game = world.grids[0];
  currentTick(game)!.cash = 1e12;
  const id = game.facilities[0].id;
  const target = game.facilities[0].peakW * 1.2;
  const first = facilityExpansionQuote(game, id, target);
  if (first.status !== "ready") throw new Error(first.reason);
  const startA: Command = {
    kind: "action",
    name: "expandFacility",
    payload: { facilityId: id, targetSize: target, quoteKey: first.quoteKey },
  };
  const cancelA: Command = {
    kind: "action",
    name: "cancelFacilityExpansion",
    payload: { facilityId: id, quoteKey: first.quoteKey },
  };
  expect(command(world, "0", startA)).toBeUndefined();
  expect(command(world, "0", cancelA)).toBeUndefined();
  const second = facilityExpansionQuote(world.grids[0], id, target);
  if (second.status !== "ready") throw new Error(second.reason);
  expect(second.quoteKey).not.toBe(first.quoteKey);
  expect(
    command(world, "0", {
      kind: "action",
      name: "expandFacility",
      payload: {
        facilityId: id,
        targetSize: target,
        quoteKey: second.quoteKey,
      },
    }),
  ).toBeUndefined();
  const cash = currentTick(world.grids[0])!.cash;
  expect(command(world, "0", cancelA)).toBeDefined();
  expect(command(world, "0", startA)).toBeDefined();
  expect(
    command(world, "0", {
      kind: "action",
      name: "cancelFacilityExpansion",
      payload: id,
    }),
  ).toBeDefined();
  expect(currentTick(world.grids[0])!.cash).toBe(cash);
  expect(world.grids[0].facilities[0].expansionInProgress!.quoteKey).toBe(
    second.quoteKey,
  );
  const restored = restoreWorld(checkpointWorld(world), "restored");
  expect(restored.grids[0].facilities[0].expansionSequence).toBe(
    second.projectSequence,
  );
  expect(command(restored, "0", cancelA)).toBeDefined();
});
