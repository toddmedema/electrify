const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { compileFunction } = require("node:vm");

const filename = join(__dirname, "crossplay-production.cjs");
const loadProduction = compileFunction(
  readFileSync(filename, "utf8"),
  ["require", "module", "process"],
  { filename },
);

async function productionHealth({
  quotaKey = "test-quota-key-of-at-least-24-characters",
  keyId = "fixture-id",
  keyToken = "fixture-token",
} = {}) {
  const turnSecrets = {
    COOP_RATE_LIMIT_KEY: quotaKey,
    CLOUDFLARE_TURN_KEY_ID: keyId,
    CLOUDFLARE_TURN_KEY_API_TOKEN: keyToken,
  };
  const db = {
    collection: () => ({}),
    doc: () => ({ get: async () => ({ data: () => undefined }) }),
  };
  const mocks = {
    "firebase-admin/auth": { getAuth: () => ({}) },
    "firebase-admin/firestore": { getFirestore: () => db },
    "firebase-admin/storage": {
      getStorage: () => ({
        bucket: () => ({
          getMetadata: async () => [
            {
              iamConfiguration: {
                publicAccessPrevention: "enforced",
                uniformBucketLevelAccess: { enabled: true },
              },
            },
          ],
        }),
      }),
    },
    "firebase-functions": { logger: { info() {} } },
    "firebase-functions/params": {
      defineSecret: (name) => ({ value: () => turnSecrets[name] ?? "fixture" }),
    },
    "firebase-functions/v2/https": { onRequest: (_, handler) => handler },
    "firebase-functions/v2/scheduler": { onSchedule: (_, handler) => handler },
    "./crossplay-store.cjs": {
      createStore: () => ({}),
      createWriter: () => async () => "fixture",
    },
    "./coop-checkpoints.cjs": { checkpointValidatorReady: () => true },
  };
  const module = { exports: {} };
  loadProduction(
    (id) => (Object.hasOwn(mocks, id) ? mocks[id] : require(id)),
    module,
    { env: { COOP_CHECKPOINT_BUCKET: "test-electrify-checkpoints" } },
  );
  const { coopV2 } = module.exports.registerCrossplay({});
  const observed = {};
  await coopV2(
    { method: "GET", path: "/healthz", get: () => undefined },
    {
      set() {},
      status(code) {
        observed.status = code;
        return this;
      },
      json(body) {
        observed.body = body;
      },
    },
  );
  return observed;
}

test("production co-op is ready with TURN credentials and no relay CIDRs or Steam settings", async () => {
  assert.deepEqual(await productionHealth(), {
    status: 200,
    body: { status: "ok" },
  });
});

test("production co-op fails readiness with missing or malformed TURN credentials", async () => {
  for (const credentials of [
    { quotaKey: "too-short" },
    { keyId: "" },
    { keyId: "invalid/id" },
    { keyToken: "" },
    { keyToken: "malformed\ntoken" },
    { keyToken: "has spaces" },
  ]) {
    assert.deepEqual(await productionHealth(credentials), {
      status: 503,
      body: { error: "unavailable" },
    });
  }
});
