import { normalizeTvInset, normalizeTvScale, tvDisplayScale } from "./TvLayout";

it("uses matching couch-scale density at 1080p and 4K", () => {
  expect(tvDisplayScale(1.5, 1080)).toBe(1.5);
  expect(tvDisplayScale(1.5, 2160)).toBe(3);
  expect(tvDisplayScale(2, 1080)).toBe(2);
});

it.each([undefined, null, NaN, -1, 100, "1.5"])(
  "bounds malformed device preferences: %p",
  (value) => {
    expect(normalizeTvScale(value)).toBe(1.5);
    expect(normalizeTvInset(value)).toBe(2);
  },
);
