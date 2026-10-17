import packageJson from "../package.json";

// Build scripts inject one immutable PST timestamp for the entire artifact.
// Tests and the development server use the source version without inventing a build time.
export const APP_VERSION = process.env.REACT_APP_VERSION || packageJson.version;
