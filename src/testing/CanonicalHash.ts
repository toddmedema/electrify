import { createHash } from "crypto";

/**
 * Rounds finite numbers to 10 significant digits and sorts object keys, so a hash survives
 * last-bit libm drift while any real behavior change still moves it (see GoldenOutputs).
 */
export function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value === 0
        ? 0
        : Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** SHA-256 of the canonical JSON of `value`. */
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "undefined")
    .digest("hex");
