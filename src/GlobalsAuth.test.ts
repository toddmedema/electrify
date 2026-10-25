import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAppAuth, login } from "./Globals";

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(() => ({ currentUser: null })),
  GoogleAuthProvider: jest.fn(),
  OAuthProvider: jest.fn(),
  signInWithPopup: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it.each(["google", "apple"] as const)(
  "signs in with %s through Firebase",
  async (provider) => {
    (signInWithPopup as jest.Mock).mockResolvedValue({
      user: { uid: "player" },
    });
    await expect(login(provider)).resolves.toBe(true);
    const constructor =
      provider === "apple" ? OAuthProvider : GoogleAuthProvider;
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(signInWithPopup).toHaveBeenCalledWith(
      firebaseAppAuth,
      expect.any(constructor),
    );
    expect(constructor).toHaveBeenCalledWith(
      ...(provider === "apple" ? ["apple.com"] : []),
    );
  },
);

it("keeps Google as the default provider", async () => {
  (signInWithPopup as jest.Mock).mockResolvedValue({});
  await expect(login()).resolves.toBe(true);
  expect(GoogleAuthProvider).toHaveBeenCalledTimes(1);
  expect(OAuthProvider).not.toHaveBeenCalled();
});

it.each(["google", "apple"] as const)(
  "logs a %s authentication failure without exposing credentials",
  async (provider) => {
    const error = {
      code: "auth/account-exists-with-different-credential",
      credential: { accessToken: "private-token" },
    };
    (signInWithPopup as jest.Mock).mockRejectedValue(error);
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(login(provider)).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith("Auth error:", error.code);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
    } finally {
      log.mockRestore();
    }
  },
);
