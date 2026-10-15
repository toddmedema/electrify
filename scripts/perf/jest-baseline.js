// Keep the timing environment used to record bench-baselines.json. Extra VM bindings can
// change draft/plain ratios independently of the reducer. This only changes the child
// process's cached configuration; the ordinary unit/simulation settings remain untouched.
require("../../package.json").jest.extraGlobals = ["Math"];
require("react-scripts/scripts/test");
