import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { firebaseAppAuth, login } from "./Globals";
import { subscribeAfterSignIn } from "./MailingList";
jest.mock("./MailingList", () => ({ subscribeAfterSignIn: jest.fn() }));

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
    await expect(login({ provider })).resolves.toBe(true);
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
      await expect(login({ provider })).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith("Auth error:", error.code);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
    } finally {
      log.mockRestore();
    }
  },
);

it.each(["google", "apple"] as const)(
  "subscribes only after successful %s login with explicit consent",
  async (provider) => {
    const user = { uid: "new-player" };
    (signInWithPopup as jest.Mock).mockResolvedValue({ user });
    const subscribe = subscribeAfterSignIn as jest.Mock;
    subscribe.mockResolvedValue(undefined);
    await expect(login()).resolves.toBe(true);
    await expect(login({ provider, mailingList: false })).resolves.toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    await expect(login({ provider, mailingList: true })).resolves.toBe(true);
    expect(subscribe).toHaveBeenCalledWith(firebaseAppAuth, user);
    expect(subscribe).toHaveBeenCalledTimes(1);
    (signInWithPopup as jest.Mock).mockRejectedValue({
      code: "auth/popup-closed-by-user",
    });
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await expect(login({ provider, mailingList: true })).resolves.toBe(false);
      expect(subscribe).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  },
);

it("does not wait for mailing-list signup or fail authentication when it fails", async () => {
  const provider = "google";
  (signInWithPopup as jest.Mock).mockResolvedValue({ user: { uid: "player" } });
  (subscribeAfterSignIn as jest.Mock).mockReturnValueOnce(
    new Promise(() => undefined),
  );
  await expect(login({ provider, mailingList: true })).resolves.toBe(true);
  (subscribeAfterSignIn as jest.Mock).mockRejectedValueOnce(
    new Error("offline"),
  );
  await expect(login({ provider, mailingList: true })).resolves.toBe(true);
});
