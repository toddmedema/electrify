import { fma, pow } from "./Pow";

const view = new DataView(new ArrayBuffer(8));
function bits(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

describe("pow", () => {
  // glibc's pow on x86-64 with FMA, which is what Linux CI's Math.pow returns. Windows' C runtime
  // rounds each of these the other way, which was enough to fork scenario 108's golden output.
  it.each([
    [2.70816, 3.711, "40442a8d18989bbc"],
    [2.61654, -0.46326, "3fe47e8c00bf0c46"],
    [0.307936, -3.483, "404e3edfa8629c49"],
    [2.67135, -1.7376, "3fc7366898ae3d92"],
    [2.52911, -14.126, "3ec10937ffcca097"],
  ])("rounds %p ** %p as glibc does", (x, y, expected) => {
    expect(bits(pow(x, y))).toBe(expected);
  });

  it("matches Math.pow's special cases exactly", () => {
    const values = [
      0,
      -0,
      1,
      -1,
      2,
      -2,
      0.5,
      -0.5,
      3,
      -3,
      Infinity,
      -Infinity,
      NaN,
      1e-310,
      -1e-310,
      1e-20,
      1e20,
      1024,
      -1075,
      2 ** -70,
    ];
    values.forEach((x) =>
      values.forEach((y) => {
        expect([x, y, pow(x, y)]).toEqual([x, y, Math.pow(x, y)]);
      }),
    );
  });

  it("stays within one ulp of Math.pow", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 20000; i++) {
      const x = next() * 4;
      const y = next() * 60 - 30;
      const expected = Math.pow(x, y);
      expect(Math.abs(pow(x, y) - expected)).toBeLessThanOrEqual(
        Math.abs(expected) * 2 ** -52,
      );
    }
  });
});

describe("fma", () => {
  it("rounds once", () => {
    // (1 + 2^-52)(1 - 2^-52) - 1 is -2^-104, lost entirely by a separate multiply and add
    expect(fma(1 + 2 ** -52, 1 - 2 ** -52, -1)).toBe(-(2 ** -104));
    expect(fma(0.1, 10, -1)).toBe(5.551115123125783e-17);
    expect(fma(2, 3, 4)).toBe(10);
  });

  it("breaks a tie the way the exact sum does", () => {
    // 1 + 2^-53 is a tie that rounds to even (1); a product a hair larger tips it up
    expect(fma(2 ** -30, 2 ** -23, 1)).toBe(1);
    expect(fma(2 ** -30, 2 ** -23 + 2 ** -75, 1)).toBe(1 + 2 ** -52);
  });
});
