import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { World } from "../src/multiplayer/Types";

const { parse, stringify } = require("../electron/steam-multiplayer.cjs");

/** Advance an actual UI save without waiting years on the worker's wall-clock scheduler.
 * CRA/Jest supplies the same TS/DOM environment as the simulation CLI; no state is fabricated. */
export async function advanceWorldSave(
  world: World,
  month: number,
  file: string,
): Promise<World> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, stringify(world));
  await promisify(execFile)(
    process.execPath,
    [
      require.resolve("react-scripts/bin/react-scripts"),
      "test",
      "--watchAll=false",
      "--runInBand",
      "--testMatch=**/src/testing/WorldAdvanceCli.tsx",
      "--cacheDirectory=.tmp/jest-world-advance",
    ],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        CI: "true",
        E2E_WORLD_FILE: file,
        E2E_WORLD_MONTH: String(month),
      },
      windowsHide: true,
      timeout: 150000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return parse(await fs.readFile(file, "utf8"));
}
