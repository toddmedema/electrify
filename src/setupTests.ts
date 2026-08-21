// jest-dom adds custom jest matchers for asserting on DOM nodes.
// https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

// jsdom has no IndexedDB, so Firebase Analytics warns loudly the first time anything logs an
// event. Nothing under test cares what was reported, so the transport is stubbed out entirely.
jest.mock("firebase/analytics", () => ({
  getAnalytics: () => ({}),
  logEvent: () => undefined,
}));
