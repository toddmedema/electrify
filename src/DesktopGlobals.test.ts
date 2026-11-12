export {};
const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockGetFirestore = jest.fn();
jest.mock("firebase/app", () => ({
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));
jest.mock("firebase/auth", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  GoogleAuthProvider: jest.fn(),
  signInWithPopup: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock("firebase/firestore", () => ({
  getFirestore: (...args: unknown[]) => mockGetFirestore(...args),
}));

afterEach(() => {
  delete window.electrifyDesktop;
  delete window.electrifyAnalytics;
});
it("does not initialize Firebase, auth, analytics or a database in the native app", async () => {
  window.electrifyDesktop = { apiVersion: 1 } as typeof window.electrifyDesktop;
  let globals!: typeof import("./Globals");
  jest.isolateModules(() => {
    globals = require("./Globals") as typeof import("./Globals");
  });
  const report = jest.fn();
  window.electrifyAnalytics = { initialize: jest.fn(), logEvent: report };
  globals.logEvent("launch");
  await expect(globals.login()).resolves.toBe(false);
  await expect(globals.logout()).resolves.toBeUndefined();
  expect(() => globals.getDb()).toThrow("desktop game");
  expect(mockInitializeApp).not.toHaveBeenCalled();
  expect(mockGetAuth).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  expect(mockGetFirestore).not.toHaveBeenCalled();
});
