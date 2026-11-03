const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
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
