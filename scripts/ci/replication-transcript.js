#!/usr/bin/env node
// Bit-exact real-reducer transcript on every shipping CPU architecture. No DOM or Jest required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../run-compatibility");
require("../testing/replication-runtime")();
const {
  fixedReplicationTranscript,
} = require("../../src/testing/ReplicationFixtures");
const destination = path.resolve(
  __dirname,
  "../../src/testing/replication-transcript.json",
);
fixedReplicationTranscript()
  .then((transcript) => {
    if (process.argv.includes("--write")) {
      fs.writeFileSync(destination, JSON.stringify(transcript, null, 2) + "\n");
    } else {
      assert.deepEqual(
        transcript,
        JSON.parse(fs.readFileSync(destination, "utf8")),
      );
      console.log(
        `Replica transcript passed: ${process.platform} ${process.arch}, Node ${process.versions.node}`,
      );
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
