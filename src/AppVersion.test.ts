const originalVersion = process.env.REACT_APP_VERSION;
afterEach(() => {
  if (originalVersion === undefined) delete process.env.REACT_APP_VERSION;
  else process.env.REACT_APP_VERSION = originalVersion;
});

it.each([undefined, "26sept26-1507"])(
  "uses the build timestamp when injected (%s), with a dev marker for unbuilt entry points",
  (version) => {
    if (version === undefined) delete process.env.REACT_APP_VERSION;
    else process.env.REACT_APP_VERSION = version;
    jest.isolateModules(() => {
      expect(
        (require("./AppVersion") as typeof import("./AppVersion")).APP_VERSION,
      ).toBe(version || "dev");
    });
  },
);
