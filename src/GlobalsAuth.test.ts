import { signInWithPopup } from "firebase/auth";
import { firebaseAppAuth, login } from "./Globals";

import { subscribeAfterSignIn } from "./MailingList";

jest.mock("./MailingList", () => ({ subscribeAfterSignIn: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

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
    await expect(login()).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith("Auth error:", error.code);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
  } finally {
    log.mockRestore();
  }
});

it("subscribes only after a successful Google login with explicit consent", async () => {
  const user = { uid: "new-player" };
  (signInWithPopup as jest.Mock).mockResolvedValue({ user });
  const subscribe = subscribeAfterSignIn as jest.Mock;
  subscribe.mockResolvedValue(undefined);
  await expect(login()).resolves.toBe(true);
  await expect(login({ mailingList: false })).resolves.toBe(true);
  expect(subscribe).not.toHaveBeenCalled();
  await expect(login({ mailingList: true })).resolves.toBe(true);
  expect(subscribe).toHaveBeenCalledWith(firebaseAppAuth, user);
  expect(subscribe).toHaveBeenCalledTimes(1);
  (signInWithPopup as jest.Mock).mockRejectedValue({
    code: "auth/popup-closed-by-user",
  });
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(login({ mailingList: true })).resolves.toBe(false);
    expect(subscribe).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});

it("does not wait for mailing-list signup or fail authentication when it fails", async () => {
  (signInWithPopup as jest.Mock).mockResolvedValue({ user: { uid: "player" } });
  (subscribeAfterSignIn as jest.Mock).mockReturnValueOnce(
    new Promise(() => undefined),
  );
  await expect(login({ mailingList: true })).resolves.toBe(true);
  (subscribeAfterSignIn as jest.Mock).mockRejectedValueOnce(
    new Error("offline"),
  );
  await expect(login({ mailingList: true })).resolves.toBe(true);
});
