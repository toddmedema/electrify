import { reportSaveDeleteFailure } from "./SaveDiagnostics";
import { logEvent } from "./Globals";
import { SaveRepositoryError } from "./SaveModel";

jest.mock("./Globals", () => ({ logEvent: jest.fn() }));
const context = {
  timedOut: false,
  elapsedMs: 42,
  saveCount: 10000,
  activeSave: true,
  pendingSave: false,
  saveState: "saved" as const,
  cloudState: "offline" as const,
};

it("reports bounded failure context without uploading raw errors or player data", () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const failure = new SaveRepositoryError("conflict", "PRIVATE SAVE NAME");
    reportSaveDeleteFailure(failure, context);
    expect(logEvent).toHaveBeenCalledWith(
      "exception",
      expect.objectContaining({
        description: "saved_game_delete_failed",
        fatal: false,
        operation: "delete_saved_game",
        error_code: "conflict",
        elapsed_ms: 42,
        save_count: 10000,
        active_save: true,
        pending_save: false,
        save_state: "saved",
        cloud_state: "offline",
        platform: "web",
      }),
    );
    expect(JSON.stringify((logEvent as jest.Mock).mock.calls)).not.toContain(
      "PRIVATE",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Saved-game deletion failed",
      expect.any(Object),
      failure,
    );
  } finally {
    consoleError.mockRestore();
  }
});

it("retains recovery even if diagnostic transport fails", () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  (logEvent as jest.Mock).mockImplementationOnce(() => {
    throw new Error("Blocked transport");
  });
  try {
    expect(() =>
      reportSaveDeleteFailure(new Error("Private message"), {
        ...context,
        timedOut: true,
      }),
    ).not.toThrow();
    expect(logEvent).toHaveBeenCalledWith(
      "exception",
      expect.objectContaining({
        description: "saved_game_delete_timeout",
        error_code: "unknown",
      }),
    );
  } finally {
    consoleError.mockRestore();
  }
});
