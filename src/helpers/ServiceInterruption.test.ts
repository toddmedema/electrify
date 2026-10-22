import { serviceInterruption } from "./ServiceInterruption";

describe("local service interruption accounting", () => {
  it("isolates delivery damage from grid supply and caps finite emergency energy", () => {
    const result = serviceInterruption(1e6, {
      serviceInterruptionFraction: 0.1,
      localBackupWhPerMonth: 3.6e6,
    });
    expect(result.connectedDemandW).toBe(900000);
    expect(result.disconnectedDemandW).toBe(100000);
    expect(result.localBackupW * 730).toBeCloseTo(3.6e6);
    expect(result.localBackupW).toBeLessThan(result.disconnectedDemandW);
  });

  it("cannot serve more isolated load than exists or reconnect it to the grid", () => {
    expect(
      serviceInterruption(100, {
        serviceInterruptionFraction: 1,
        localBackupWhPerMonth: 1e9,
      }),
    ).toEqual({
      connectedDemandW: 0,
      disconnectedDemandW: 100,
      localBackupW: 100,
    });
    expect(serviceInterruption(100, { localBackupWhPerMonth: 1e9 })).toEqual({
      connectedDemandW: 100,
      disconnectedDemandW: 0,
      localBackupW: 0,
    });
  });
});
