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
  steam: defineSecret("STEAM_PUBLISHER_KEY"),
  writer: defineSecret("COOP_FIREBASE_WRITER_API_KEY"),
  quota: defineSecret("COOP_RATE_LIMIT_KEY"),
  turnId: defineSecret("CLOUDFLARE_TURN_KEY_ID"),
  turnToken: defineSecret("CLOUDFLARE_TURN_KEY_API_TOKEN"),
};
const projectId = "electrify-game";
const serviceAccount = `coop-service@${projectId}.iam.gserviceaccount.com`;

function registerCrossplay(adminApp) {
  let services;
  function initialize() {
    if (services) return services;
    const db = getFirestore(adminApp);
    const auth = getAuth(adminApp);
    const steamAppId = process.env.STEAM_APP_ID;
    const checkpointBucket = process.env.COOP_CHECKPOINT_BUCKET;
    const relayCidrs = process.env.COOP_TURN_RELAY_CIDRS;
    if (!/^\d{1,10}$/.test(steamAppId) || !checkpointBucket || !relayCidrs)
      throw new CrossplayError(503, "unavailable");

    const store = createStore({
      db,
      projectId,
      writerToken: createWriter({ auth, apiKey: secrets.writer.value() }),
    });

    const { createTurnSignaling } = require("./coop-signaling.cjs");
    const signaling = createTurnSignaling({
      db,
      relayCidrs,
      keyId: secrets.turnId.value(),
      keyToken: secrets.turnToken.value(),
      loadRoom: (id) => service.loadRoom(id),
    });
    const checkpoints = require("./coop-checkpoints.cjs");
    const bucket = getStorage(adminApp).bucket(checkpointBucket);
    const transfer = (operation, context, body) =>
      checkpoints.handle(operation, { ...context, bucket }, body);

    const isStopped = async () =>
      (await db.collection("coopSettings").doc("runtime").get()).data()
        ?.stopped === true;
    const service = createCrossplay({
      store,
      verifyGoogle: (token) => auth.verifyIdToken(token, true),
      verifySteam: (ticket) =>
        steamUser(ticket, {
          appId: steamAppId,
          publisherKey: secrets.steam.value(),
        }),
      origins: ["https://electrifygame.com", "https://www.electrifygame.com"],
      quotaKey: secrets.quota.value(),
      isStopped,
      extensions: {
        signal: (operation, context, body) =>
          signaling.handle(operation, context, body),
        save: transfer,
        transfer,
      },
      onRoomChanged: () =>
        signaling.reap().catch(() => logger.warn("Co-op revocation retry")),
      audit: (event) => logger.info("Co-op control request", event),
    });
    services = { service, signaling, isStopped };
    return services;
  }

  return {
    coopV2: onRequest(
      {
        region: "us-central1",
        serviceAccount,
        secrets: Object.values(secrets),
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
        timeoutSeconds: 120,
      },
      async () => {
        try {
          const { signaling, isStopped } = initialize();
          await signaling.reap({ all: await isStopped() });
        } catch {
          logger.warn("Co-op scheduled revocation needs retry");
        }
      },
    ),
  };
}

module.exports = { registerCrossplay };
