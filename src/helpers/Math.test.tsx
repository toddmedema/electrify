import { arrayMove, getRandomRange } from "./Math";

describe("getRandomRange", () => {
  it("should return a number within the specified range", () => {
    const min = 99;
    const max = 100;
    const result = getRandomRange(min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThanOrEqual(max);
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
