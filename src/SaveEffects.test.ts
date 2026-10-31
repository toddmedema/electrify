import { requestCloudSave, subscribeCloudSaveRequests } from "./SaveEffects";

it("isolates a failing backup subscriber after a committed save operation", () => {
  const failed = jest.fn(() => {
    throw new Error("Backup listener failed");
  });
  const healthy = jest.fn();
  const unsubscribeFailed = subscribeCloudSaveRequests(failed);
  const unsubscribeHealthy = subscribeCloudSaveRequests(healthy);
  try {
    expect(() => requestCloudSave("saved-game")).not.toThrow();
    expect(failed).toHaveBeenCalledWith("saved-game");
    expect(healthy).toHaveBeenCalledWith("saved-game");
  } finally {
    unsubscribeFailed();
    unsubscribeHealthy();
  }
});
