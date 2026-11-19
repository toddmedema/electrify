const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { subscribe, describeFailure } = require("./mailing-list.cjs");

const apiKey = defineSecret("MAILCHIMP_API_KEY");
exports.subscribeMailingList = onCall(
  {
    region: "us-central1",
    secrets: [apiKey],
    timeoutSeconds: 30,
    maxInstances: 3,
  },
  async (request) => {
    try {
      return await subscribe(request, { apiKey: apiKey.value() });
    } catch (error) {
      const failure = describeFailure(error);
      // Other codes are expected refusals; this one is an outage or misconfiguration.
      if (failure.code === "unavailable")
        logger.error("Mailing-list signup failed", failure);
      else logger.info("Mailing-list signup refused", failure);
      throw new HttpsError(failure.code, "Mailing-list signup didn't finish.");
    }
  },
);

const {
  deliverFeedback,
  reserveFeedback,
  FeedbackError,
} = require("./game-feedback.cjs");
const adminApp = initializeApp();

exports.submitGameFeedback = onCall(
  {
    region: "us-central1",
    cors: [
      "https://electrifygame.com",
      "https://www.electrifygame.com",
      "https://beta.electrifygame.com",
    ],
    secrets: ["GAME_FEEDBACK_EMAIL"],
    timeoutSeconds: 10,
    maxInstances: 2,
  },
  async (request) => {
    try {
      return await deliverFeedback(request.data, {
        settings: JSON.parse(process.env.GAME_FEEDBACK_EMAIL ?? "null"),
        reserve: () => reserveFeedback(getFirestore(adminApp)),
      });
    } catch (error) {
      const code = error instanceof FeedbackError ? error.code : "unavailable";
      if (code === "unavailable")
        logger.warn("Game feedback delivery unavailable");
      throw new HttpsError(code, "Feedback couldn't be sent.");
    }
  },
);
