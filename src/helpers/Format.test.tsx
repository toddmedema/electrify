import { formatWatts } from "./Format";

describe("formatWatts", () => {
  it("should correctly format numbers in the tens", () => {
    const result = formatWatts(10);
    expect(result).toEqual("10W");
  });

  it("should correctly format numbers in the thousands", () => {
    const result = formatWatts(1500);
    expect(result).toEqual("1.5kW");
  });

  it("should correctly format numbers in the millions", () => {
    const result = formatWatts(1500000);
    expect(result).toEqual("1.5MW");
  });

  it("should correctly format numbers in the billions", () => {
    const result = formatWatts(1500000000);
    expect(result).toEqual("1.5GW");
  });

  it("should correctly format numbers in the trillions", () => {
    const result = formatWatts(1500000000000);
    expect(result).toEqual("1.5TW");
  });

  it("should correctly handle the mantissa parameter when 0", () => {
    const result = formatWatts(1001, 0);
    expect(result).toEqual("1kW");
  });

  it("should correctly handle the mantissa parameter when 2", () => {
    const result = formatWatts(1521, 0);
    expect(result).toEqual("1.5kW");
  });

  it("should correctly handle the mantissa parameter when 3", () => {
    const result = formatWatts(1521, 3);
    expect(result).toEqual("1.52kW");
  });

  it("should correctly handle the mantissa parameter when 4", () => {
    const result = formatWatts(1521, 4);
    expect(result).toEqual("1.521kW");
  });
});
