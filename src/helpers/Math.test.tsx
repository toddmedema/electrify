import {
  arrayMove,
  getIntersectionX,
  getRandomRangeAt,
  newSeed,
  normalAt,
  randomAt,
} from "./Math";

const STREAM = 1;

describe("getIntersectionX", () => {
  it("finds where two crossing segments meet", () => {
    // A rising line and a falling line through (5, 5)
    expect(getIntersectionX(0, 0, 10, 10, 0, 10, 10, 0)).toBeCloseTo(5);
  });

  it("finds the crossing of a sloped line and a flat one", () => {
    // Supply ramping past a flat demand line, which is what the chart actually uses this for
    expect(getIntersectionX(0, 0, 10, 20, 0, 5, 10, 5)).toBeCloseTo(2.5);
  });

  // Parallel lines never meet, so there is no x to return. Callers treat the 0 as "no crossing"
  it("returns zero for parallel lines rather than dividing by zero", () => {
    expect(getIntersectionX(0, 0, 10, 10, 0, 5, 10, 15)).toEqual(0);
  });
});

describe("randomAt", () => {
  it("stays inside [0, 1)", () => {
    for (let index = 0; index < 500; index++) {
      const result = randomAt(12345, STREAM, index);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(1);
    }
  });

  it("returns the same value for the same coordinates, whatever came before", () => {
    const expected = randomAt(12345, STREAM, 7);
    for (let index = 0; index < 100; index++) {
      randomAt(999, STREAM, index); // Draws that would have advanced a sequential generator
    }
    expect(randomAt(12345, STREAM, 7)).toEqual(expected);
  });

  it("gives neighbouring indexes unrelated values", () => {
    const values = [];
    for (let index = 0; index < 8; index++) {
      values.push(randomAt(12345, STREAM, index));
    }
    expect(new Set(values).size).toEqual(values.length);
  });

  it("separates seeds and streams", () => {
    expect(randomAt(1, STREAM, 0)).not.toEqual(randomAt(2, STREAM, 0));
    expect(randomAt(1, STREAM, 0)).not.toEqual(randomAt(1, STREAM + 1, 0));
  });

  // Cheap smoke test that the mixing actually spreads out, rather than clustering somewhere and
  // quietly biasing every draw built on top of it
  it("spreads draws roughly evenly across the range", () => {
    const buckets = new Array(10).fill(0);
    const draws = 10000;
    for (let index = 0; index < draws; index++) {
      buckets[Math.floor(randomAt(12345, STREAM, index) * 10)]++;
    }
    buckets.forEach((count) => {
      expect(count).toBeGreaterThan(draws / 10 - 150);
      expect(count).toBeLessThan(draws / 10 + 150);
    });
  });
});

describe("getRandomRangeAt", () => {
  it("should return a number within the specified range", () => {
    const min = 99;
    const max = 100;
    const result = getRandomRangeAt(12345, STREAM, 0, min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThan(max);
  });
});

describe("normalAt", () => {
  const sample = (seed: number, count: number) =>
    Array.from({ length: count }, (_, index) => normalAt(seed, STREAM, index));

  it("comes out standard normal", () => {
    const values = sample(12345, 20000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(
      values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length,
    );
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("puts about two thirds of its draws within one standard deviation", () => {
    // The property that makes this the right shape for a weather anomaly, and the one a uniform
    // does not have: most departures are small, big ones are rare, and none are impossible
    const values = sample(999, 20000);
    const within = (limit: number) =>
      values.filter((v) => Math.abs(v) < limit).length / values.length;
    expect(within(1)).toBeCloseTo(0.68, 1);
    expect(within(2)).toBeCloseTo(0.95, 1);
    expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(3);
  });

  it("returns the same value for the same coordinates, whatever came before", () => {
    const expected = normalAt(12345, STREAM, 7);
    for (let index = 0; index < 100; index++) {
      normalAt(999, STREAM, index); // Draws that would have advanced a sequential generator
    }
    expect(normalAt(12345, STREAM, 7)).toEqual(expected);
  });

  it("gives neighbouring indexes unrelated values rather than a shared uniform", () => {
    // One normal costs two uniforms, so a naive implementation would have index 0 and index 1
    // drawing from overlapping pairs
    const values = sample(12345, 500);
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).not.toEqual(values[index - 1]);
    }
  });

  it("never returns a value that would poison the simulation", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let index = 0; index < 200; index++) {
        expect(Number.isFinite(normalAt(seed, STREAM, index))).toBe(true);
      }
    }
  });
});

describe("newSeed", () => {
  // Seeds are mixed as 32 bit integers, so a wider or fractional one would not survive being
  // written to a save file and read back
  it("mints integers that fit in 32 bits", () => {
    for (let i = 0; i < 100; i++) {
      const seed = newSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe("arrayMove", () => {
  it("should correctly move an element to a new index", () => {
    const arr = [1, 2, 3, 4, 5];
    arrayMove(arr, 0, 2);
    expect(arr).toEqual([2, 3, 1, 4, 5]);
  });

  it("should add undefined elements if the new index is greater than array length", () => {
    const arr = [1, 2, 3];
    arrayMove(arr, 0, 5);
    expect(arr).toEqual([2, 3, undefined, undefined, undefined, 1]);
  });

  it("should handle negative indices", () => {
    const arr = [1, 2, 3, 4, 5];
    arrayMove(arr, -1, 0);
    expect(arr).toEqual([5, 1, 2, 3, 4]);
  });
});
