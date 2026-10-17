// Build scripts inject one immutable PST timestamp for the entire artifact.
// Tests and other unbuilt entry points do not invent a build time.
export const APP_VERSION = process.env.REACT_APP_VERSION || "dev";
