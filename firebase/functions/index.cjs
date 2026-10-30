const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { subscribe, SubscriptionError } = require("./mailing-list.cjs");

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
      // Mailchimp errors can include addresses and account details. Never expose them.
      throw new HttpsError(
        error instanceof SubscriptionError ? error.code : "unavailable",
        "Mailing-list signup didn't finish. Please use the signup form on the About page.",
      );
    }
  },
);
