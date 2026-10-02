import type { GameType } from "./Types";

// Only the repeated records are packed. The rest of the envelope remains readable JSON.
// Objects become [shape index, ...values]; actual arrays use { items: [...] } so nulls,
// missing fields, and deferred-load queues retain their distinct meanings.
type PackedValue =
  null | string | number | boolean | PackedValue[] | { items: PackedValue[] };

interface PackedRecords {
  shapes: string[][];
  rows: PackedValue[];
}

function packRecords(records: unknown[]): PackedRecords {
  const shapes: string[][] = [];
  const indices = new Map<number, number[]>();
  const pack = (value: unknown): PackedValue => {
    if (value == null) return null;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return value;
    if (Array.isArray(value)) return { items: value.map(pack) };
    if (typeof value !== "object") throw new Error("Unsupported save value");
    // Match JSON's treatment of absent optional properties and ignore runtime symbol metadata.
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined);
    // Compare shared layouts directly rather than stringify long property names per row.
    const candidates = indices.get(keys.length) || [];
    let index = candidates.find((candidate) =>
      shapes[candidate].every((key, i) => key === keys[i]),
    );
    if (index === undefined) {
      index = shapes.length;
      candidates.push(index);
      indices.set(keys.length, candidates);
      shapes.push(keys);
    }
    return [index, ...keys.map((key) => pack(record[key]))];
  };
  return { shapes, rows: records.map(pack) };
}

function unpackRecords(raw: unknown): unknown[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const table = raw as Partial<PackedRecords>;
  if (
    !Array.isArray(table.shapes) ||
    !Array.isArray(table.rows) ||
    table.shapes.some(
      (keys) =>
        !Array.isArray(keys) ||
        keys.some(
          (key) =>
            typeof key !== "string" ||
            ["__proto__", "prototype", "constructor"].includes(key),
        ) ||
        new Set(keys).size !== keys.length,
    )
  )
    return null;
  const shapes = table.shapes;
  const unpack = (value: unknown, depth: number): unknown => {
    // An imported file must not exhaust the stack before domain validation can reject it.
    if (depth > 32) throw new Error("Save records are too deeply nested");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (Array.isArray(value)) {
      const index = value[0];
      if (!Number.isSafeInteger(index) || index < 0 || index >= shapes.length)
        throw new Error("Invalid save shape index");
      const keys = shapes[index];
      // Check width before allocating: a tiny tuple cannot expand a huge imported shape.
      if (value.length !== keys.length + 1)
        throw new Error("Invalid save record width");
      return Object.fromEntries(
        keys.map((key, i) => [key, unpack(value[i + 1], depth + 1)]),
      );
    }
    if (value && typeof value === "object") {
      const items = (value as { items?: unknown }).items;
      if (Object.keys(value).length === 1 && Array.isArray(items))
        return items.map((item) => unpack(item, depth + 1));
    }
    throw new Error("Invalid packed save value");
  };
  try {
    return table.rows.map((row) => unpack(row, 0));
  } catch (_err) {
    return null;
  }
}

/** Lossless wire representation for both local storage and downloaded files. */
export function encodeSave<
  T extends { game: GameType; commitmentForecast?: unknown[] },
>(save: T) {
  return {
    ...save,
    game: {
      ...save.game,
      timeline: packRecords(save.game.timeline),
      monthlyHistory: packRecords(save.game.monthlyHistory),
    },
    commitmentForecast:
      save.commitmentForecast === undefined
        ? undefined
        : packRecords(save.commitmentForecast),
  };
}

/** Expand wire records before the existing domain validator sees them. */
export function decodeSave(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const save = raw as Record<string, unknown>;
  if (!save.game || typeof save.game !== "object") return raw;
  const game = save.game as Record<string, unknown>;
  const timeline = Array.isArray(game.timeline)
    ? game.timeline
    : unpackRecords(game.timeline);
  const monthlyHistory = Array.isArray(game.monthlyHistory)
    ? game.monthlyHistory
    : unpackRecords(game.monthlyHistory);
  const commitmentForecast =
    save.commitmentForecast === undefined ||
    Array.isArray(save.commitmentForecast)
      ? save.commitmentForecast
      : unpackRecords(save.commitmentForecast);
  if (!timeline || !monthlyHistory || commitmentForecast === null) return null;
  return {
    ...save,
    game: { ...game, timeline, monthlyHistory },
    commitmentForecast,
  };
}
