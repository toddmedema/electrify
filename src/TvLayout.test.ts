import { normalizeTvScale } from "./TvLayout";

it.each([undefined, null, NaN, -1, 100, "1.5"])(
  "bounds malformed device preferences: %p",
  (value) => {
    expect(normalizeTvScale(value)).toBe(1.5);
  },
);
