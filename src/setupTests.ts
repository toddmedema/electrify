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

// Every chart watches its container for a width to lay out in, and jsdom has no ResizeObserver.
// One that never reports is the honest stub here: jsdom lays nothing out, so the width stays at
// zero and uPlot is never built, which is exactly what the charts do in a real pane of no width.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    public observe() {
      return undefined;
    }
    public unobserve() {
      return undefined;
    }
    public disconnect() {
      return undefined;
    }
  };
}

// jsdom has no IndexedDB, so Firebase Analytics warns loudly the first time anything logs an
// event. Nothing under test cares what was reported, so the transport is stubbed out entirely.
jest.mock("firebase/analytics", () => ({
  getAnalytics: () => ({}),
  logEvent: () => undefined,
}));

// Webpack recognizes import.meta.url as the entry point for a code-split Web Worker, while Jest's
// CommonJS parser intentionally does not. Component tests replace this browser-only constructor
// with their own workers when they exercise the protocol; everything else gets an inert stub.
jest.mock("./helpers/CustomGameForecastClient", () => ({
  createCustomGameForecastWorker: () => ({
    onmessage: null,
    onerror: null,
    postMessage: () => undefined,
    terminate: () => undefined,
  }),
}));
