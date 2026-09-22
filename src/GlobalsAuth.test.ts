import { signInWithPopup } from "firebase/auth";
import { login } from "./Globals";

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithPopup: jest.fn(),
}));

it("logs an authentication failure without exposing credentials", async () => {
  const error = {
    code: "auth/account-exists-with-different-credential",
    credential: { accessToken: "private-token" },
  };
  (signInWithPopup as jest.Mock).mockRejectedValue(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    login();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalledWith("Auth error:", error.code);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
  } finally {
    log.mockRestore();
  }
});
