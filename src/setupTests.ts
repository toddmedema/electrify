// jest-dom adds custom jest matchers for asserting on DOM nodes.
// https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom";

// uPlot watches for device-pixel-ratio changes as soon as it is imported, and jsdom has no
// matchMedia, so merely importing a chart would fail a suite. The charts never render in jsdom
// (they wait for a laid-out width, which jsdom never reports), so a stub that matches nothing
// is enough.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no IndexedDB, so Firebase Analytics warns loudly the first time anything logs an
// event. Nothing under test cares what was reported, so the transport is stubbed out entirely.
jest.mock("firebase/analytics", () => ({
  getAnalytics: () => ({}),
  logEvent: () => undefined,
}));
