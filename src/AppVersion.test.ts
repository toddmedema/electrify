import packageJson from "../package.json";

const originalVersion = process.env.REACT_APP_VERSION;
afterEach(() => {
  if (originalVersion === undefined) delete process.env.REACT_APP_VERSION;
  else process.env.REACT_APP_VERSION = originalVersion;
});

it.each([undefined, "1.1.0-21sept26-1705"])(
  "uses the build version when injected (%s), with a source fallback for development",
  (version) => {
    if (version === undefined) delete process.env.REACT_APP_VERSION;
    else process.env.REACT_APP_VERSION = version;
    jest.isolateModules(() => {
      expect(
        (require("./AppVersion") as typeof import("./AppVersion")).APP_VERSION,
      ).toBe(version || packageJson.version);
    });
  },
);
