import type { Auth, User } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getStore } from "./StoreRegistry";
import { subscribeAfterSignIn } from "./MailingList";

jest.mock("firebase/functions", () => ({
  getFunctions: jest.fn(() => "functions"),
  httpsCallable: jest.fn(),
}));
jest.mock("./StoreRegistry", () => ({ getStore: jest.fn() }));
jest.mock("./reducers/UI", () => ({
  snackbarOpen: (message: string) => ({
    type: "ui/snackbarOpen",
    payload: message,
  }),
}));
const submit = jest.fn();
const dispatch = jest.fn();
const user = { uid: "player" } as User;
let auth: Auth;
beforeEach(() => {
  jest.clearAllMocks();
  auth = { currentUser: user, app: {} } as Auth;
  (getFunctions as jest.Mock).mockReturnValue("functions");
  (httpsCallable as jest.Mock).mockReturnValue(submit);
  (getStore as jest.Mock).mockReturnValue({ dispatch });
});

it.each(["subscribed", "already-subscribed"])(
  "submits only the captured identity and consent for %s",
  async (status) => {
    submit.mockResolvedValue({ data: { status } });
    await subscribeAfterSignIn(auth, user);
    expect(getFunctions).toHaveBeenCalledWith(auth.app, "us-central1");
    expect(httpsCallable).toHaveBeenCalledWith(
      "functions",
      "subscribeMailingList",
      { timeout: 20000 },
    );
    expect(submit).toHaveBeenCalledWith({
      uid: "player",
      consent: true,
      consentVersion: "electrify-updates-v1",
    });
  },
);

it("confirms an existing subscription", async () => {
  submit.mockResolvedValue({ data: { status: "already-subscribed" } });
  await subscribeAfterSignIn(auth, user);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: "You're already on the Electrify mailing list.",
    }),
  );
});

it("stays silent after a fresh signup", async () => {
  submit.mockResolvedValue({ data: { status: "subscribed" } });
  await subscribeAfterSignIn(auth, user);
  expect(dispatch).not.toHaveBeenCalled();
});

it("reports signup failure without claiming authentication failed", async () => {
  submit.mockRejectedValue(new Error("offline"));
  await subscribeAfterSignIn(auth, user);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.stringContaining(
        "You're signed in, but mailing-list signup didn't finish",
      ),
    }),
  );
});

it("does not start a signup after the account changes", async () => {
  auth = { ...auth, currentUser: { uid: "other" } } as Auth;
  await subscribeAfterSignIn(auth, user);
  expect(submit).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it("does not show a prior account's result in a different session", async () => {
  submit.mockImplementation(async () => {
    Object.assign(auth, { currentUser: null });
    return { data: { status: "already-subscribed" } };
  });
  await subscribeAfterSignIn(auth, user);
  expect(dispatch).not.toHaveBeenCalled();
});
