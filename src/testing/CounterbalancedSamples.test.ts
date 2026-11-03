import { counterbalancedSamples } from "./CounterbalancedSamples";

describe("counterbalanced performance samples", () => {
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  it.each([false, true])(
    "recovers the real cost ratio despite linear timing drift (Immer first: %s)",
    (immerFirst) => {
      let calls = 0;
      const measure = (immer: boolean) =>
        (immer ? 1.35 : 1) * (1 + calls++ * 0.3);
      const samples = counterbalancedSamples(measure, immerFirst);
      expect(mean(samples.immer) / mean(samples.plain)).toBeCloseTo(1.35);
      expect(calls).toBe(4);
    },
  );

  it("preserves a real cost regression instead of masking it with timing drift", () => {
    let calls = 0;
    const samples = counterbalancedSamples(
      (immer) => (immer ? 1.9 : 1) * (1 + calls++ * 0.3),
    );
    expect(mean(samples.immer) / mean(samples.plain)).toBeCloseTo(1.9);
  });
});
