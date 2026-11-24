const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { CrossplayError } = require("./crossplay-errors.cjs");
const { createCrossplay } = require("./crossplay-http.cjs");
const { steamUser } = require("./crossplay-identity.cjs");
const { createStore, createWriter } = require("./crossplay-store.cjs");

const secrets = {
  writer: defineSecret("COOP_FIREBASE_WRITER_API_KEY"),
  quota: defineSecret("COOP_RATE_LIMIT_KEY"),
  turnId: defineSecret("CLOUDFLARE_TURN_KEY_ID"),
  turnToken: defineSecret("CLOUDFLARE_TURN_KEY_API_TOKEN"),
};
const projectId = "electrify-game";
const serviceAccount = `coop-service@${projectId}.iam.gserviceaccount.com`;

function registerCrossplay(adminApp) {
  const steamAppId = process.env.STEAM_APP_ID;
  const steamKey = steamAppId ? defineSecret("STEAM_PUBLISHER_KEY") : undefined;
  let services;
  function initialize() {
    if (services) return services;
    const db = getFirestore(adminApp);
    const auth = getAuth(adminApp);
    const checkpointBucket = process.env.COOP_CHECKPOINT_BUCKET;
    if (!checkpointBucket) throw new CrossplayError(503, "unavailable");

    const writerToken = createWriter({ auth, apiKey: secrets.writer.value() });
    const store = createStore({ db, projectId, writerToken });

    const { createTurnSignaling } = require("./coop-signaling.cjs");
    const signaling = createTurnSignaling({
      db,
      keyId: secrets.turnId.value(),
      keyToken: secrets.turnToken.value(),
      loadRoom: (id) => service.loadRoom(id),
    });
    const checkpoints = require("./coop-checkpoints.cjs");
    const bucket = getStorage(adminApp).bucket(checkpointBucket);
    const transfer = (operation, context, body) =>
      checkpoints.handle(operation, { ...context, bucket }, body);

    const isStopped = async () =>
      (await db.doc("coopSettings/runtime").get()).data()?.stopped === true;
    const service = createCrossplay({
      store,
      verifyGoogle: (token) => auth.verifyIdToken(token, true),
      verifySteam: steamKey
        ? (ticket) =>
            steamUser(ticket, {
              appId: steamAppId,
              publisherKey: steamKey.value(),
            })
        : undefined,
      origins: ["https://electrifygame.com", "https://www.electrifygame.com"],
      quotaKey: secrets.quota.value(),
      isStopped,
      healthy: async () => {
        const [, [metadata]] = await Promise.all([
          writerToken(),
          bucket.getMetadata(),
        ]);
        return (
          checkpoints.checkpointValidatorReady() &&
          signaling.configured &&
          metadata.iamConfiguration?.publicAccessPrevention === "enforced" &&
          metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled === true
        );
      },
      extensions: {
        signal: (operation, context, body) =>
          signaling.handle(operation, context, body),
        save: transfer,
        transfer,
      },
      audit: (event) => logger.info("Co-op control request", event),
    });
    const cleanup = db.doc("coopOperations/checkpointReaper");
    services = {
      service,
      signaling,
      isStopped,
      reapCheckpoints: () =>
        checkpoints.reap(bucket, service.loadRoom, Date.now(), {
          load: async () => (await cleanup.get()).data(),
          save: (prefix, pageToken) =>
            cleanup.set({ [prefix]: pageToken }, { merge: true }),
        }),
    };
    return services;
  }

  return {
    coopV2: onRequest(
      {
        region: "us-central1",
        serviceAccount,
        secrets: [...Object.values(secrets), ...(steamKey ? [steamKey] : [])],
        maxInstances: 4,
        concurrency: 8,
        timeoutSeconds: 25,
        memory: "512MiB",
      },
      (request, response) => {
        try {
          return initialize().service.handle(request, response);
        } catch {
          response.set("Cache-Control", "no-store");
          response.status(503).json({ error: "unavailable" });
        }
      },
    ),
    coopV2Reap: onSchedule(
      {
        schedule: "every 1 minutes",
        region: "us-central1",
        serviceAccount,
        secrets: Object.values(secrets),
        maxInstances: 1,
        concurrency: 1,
        timeoutSeconds: 120,
      },
      async () => {
        try {
          const { signaling, isStopped, reapCheckpoints } = initialize();
          const results = await Promise.allSettled([
            signaling.reap({ all: await isStopped() }),
            reapCheckpoints(),
          ]);
          if (results.some((operation) => operation.status === "rejected"))
            logger.warn("Co-op scheduled cleanup needs retry");
        } catch {
          logger.warn("Co-op scheduled revocation needs retry");
        }
      },
    ),
  };
}

module.exports = { registerCrossplay };
