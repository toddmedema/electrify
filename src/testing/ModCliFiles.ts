import * as fs from "fs";
import { TextDecoder } from "util";
import { MAX_MOD_BYTES } from "../mods/ModSchema";

/** Bound author input before allocating it, then reject malformed UTF-8 rather than replacing it. */
export function readModCliJson(filename: string): unknown {
  const descriptor = fs.openSync(filename, "r");
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("Choose a regular JSON file.");
    const tooLarge = () =>
      new Error(
        `JSON input exceeds the ${MAX_MOD_BYTES} byte authoring limit.`,
      );
    if (stat.size > MAX_MOD_BYTES) throw tooLarge();
    // A file that grows after fstat still cannot make this reader allocate an unbounded buffer.
    const bytes = Buffer.alloc(MAX_MOD_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(
        descriptor,
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!read) break;
      length += read;
    }
    if (length > MAX_MOD_BYTES) throw tooLarge();
    return JSON.parse(
      // Preserve a BOM so JSON.parse uses the same grammar as the native package parser.
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, length),
      ),
    );
  } finally {
    fs.closeSync(descriptor);
  }
}
