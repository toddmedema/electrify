const arrayUndefined = Symbol("explicit undefined array entry");

/** Network JSON preserves the numbers and array entries used by deterministic replication. */
export function encodeWire(value: unknown): string {
  return JSON.stringify(value, function (_key, item) {
    if (
      typeof item === "number" &&
      (Object.is(item, -0) || !Number.isFinite(item))
    )
      return { $electrifyNumber: Object.is(item, -0) ? "-0" : String(item) };
    if (item === undefined && Array.isArray(this))
      return { $electrifyNumber: "undefined" };
    return item;
  });
}

export function decodeWire(value: string): unknown {
  return JSON.parse(value, function (_key, item) {
    if (Array.isArray(item))
      return item.map((entry) =>
        entry === arrayUndefined ? undefined : entry,
      );
    if (!item || typeof item !== "object" || Object.keys(item).length !== 1)
      return item;
    const tag = item.$electrifyNumber;
    if (tag === "undefined")
      return Array.isArray(this) ? arrayUndefined : undefined;
    if (["Infinity", "-Infinity", "NaN", "-0"].includes(tag))
      return Number(tag);
    return item;
  });
}
