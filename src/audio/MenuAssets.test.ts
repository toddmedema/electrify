import { readFileSync } from "fs";
import { resolve } from "path";

const { generateCue } = require("../../scripts/generate-menu-audio");

it.each(["select", "confirm", "back"])(
  "bundles the deterministic, quiet %s cue as real short PCM bytes",
  (name) => {
    const bytes = readFileSync(
      resolve(__dirname, "../../public/audio/menu", `${name}.wav`),
    );
    expect(bytes).toEqual(generateCue(name));
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(bytes.readUInt16LE(20)).toBe(1);
    expect(bytes.readUInt16LE(22)).toBe(1);
    expect(bytes.readUInt16LE(34)).toBe(16);
    const duration = (bytes.length - 44) / bytes.readUInt32LE(28);
    expect(duration).toBeGreaterThan(0.04);
    expect(duration).toBeLessThan(0.12);
    let peak = 0;
    for (let offset = 44; offset < bytes.length; offset += 2)
      peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(100);
    expect(peak / 32767).toBeLessThanOrEqual(0.09);
  },
);
