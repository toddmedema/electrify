/** Playwright fixture setup, explicitly selected by Jest like SimCli. Never part of the app. */
import fs from "fs";
import "../Store";
import {
  applyCommand,
  checkpointWorld,
  matchScenario,
  restoreWorld,
  savedMatchSpec,
  stepWorld,
} from "../multiplayer/World";
import { loadSimData } from "./SimData";

const { parse, stringify } = require("../../electron/steam-multiplayer.cjs");

function advance(file: string, throughMonth: number) {
  expect(Number.isSafeInteger(throughMonth) && throughMonth > 0).toBe(true);
  const saved = parse(fs.readFileSync(file, "utf8"));
  const { scenario, location } = matchScenario(savedMatchSpec(saved));
  loadSimData(location);
  const world = restoreWorld(saved, saved.epoch);
  expect(throughMonth).toBeLessThanOrEqual(scenario.durationMonths);
  world.seats.forEach((seat) => {
    expect(
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: 1,
        command: { kind: "ready" },
      }),
    ).toBeUndefined();
  });
  while (world.grids[0].date.monthsElapsed < throughMonth) {
    const minute = world.grids[0].date.minute;
    stepWorld(world);
    // A decision, bankruptcy or disconnected clock must fail setup, never skip forward.
    expect(world.grids.every((game) => game.date.minute > minute)).toBe(true);
  }
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual(
    world.seats.map(() => throughMonth),
  );
  const checkpoint = checkpointWorld(world);
  // Exercise the same untrusted-save boundary the browser will use on resuming.
  expect(() => restoreWorld(checkpoint, world.epoch)).not.toThrow();
  fs.writeFileSync(file, stringify(checkpoint));
}

// Keep the one-shot CLI for direct reproduction. Playwright keeps this same Jest test alive
// over IPC, amortizing the transform/import cost while every request runs all assertions above.
function serve(): Promise<void> {
  // Jest replaces both global process and require("process"); Node 24 exposes the real IPC.
  const ipc = process.getBuiltinModule("process");
  return new Promise((resolve) => {
    const receive = (message: {
      type: string;
      id: number;
      file: string;
      month: number;
    }) => {
      if (message.type !== "advance") return;
      try {
        advance(message.file, message.month);
        ipc.send!({ type: "result", id: message.id });
      } catch (error) {
        ipc.send!({
          type: "result",
          id: message.id,
          error:
            error instanceof Error
              ? error.stack || error.message
              : String(error),
        });
      }
    };
    ipc.on("message", receive);
    ipc.once("disconnect", () => {
      ipc.removeListener("message", receive);
      resolve();
    });
    ipc.send!({ type: "ready" });
  });
}

test(
  "advance a browser-created multiplayer save through every real simulation tick",
  async () => {
    if (process.env.E2E_WORLD_SERVICE === "1") await serve();
    else
      advance(process.env.E2E_WORLD_FILE!, Number(process.env.E2E_WORLD_MONTH));
  },
  process.env.E2E_WORLD_SERVICE === "1" ? 1800000 : 120000,
);
