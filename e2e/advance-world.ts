import { test as base } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { World } from "../src/multiplayer/Types";

const { parse, stringify } = require("../electron/steam-multiplayer.cjs");
const { WorldAdvanceWorker } = require("../scripts/ci/world-advance");

type AdvanceWorldSave = (
  world: World,
  month: number,
  file: string,
) => Promise<World>;

/** A lazy, worker-scoped helper. Every request restores an actual UI save and runs all
 * assertions in WorldAdvanceCli; teardown also runs when a browser assertion fails. */
export const test = base.extend<{}, { advanceWorldSave: AdvanceWorldSave }>({
  advanceWorldSave: [
    async ({}, use) => {
      const worker = new WorldAdvanceWorker();
      try {
        await use(async (world, month, file) => {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, stringify(world));
          await worker.advance(file, month);
          return parse(await fs.readFile(file, "utf8"));
        });
      } finally {
        await worker.close();
      }
    },
    { scope: "worker" },
  ],
});
