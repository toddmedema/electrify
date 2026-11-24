const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
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

const { deliverFeedback, FeedbackError } = require("./game-feedback.cjs");
const {
  createFeedbackSheets,
  createSheetsTokenProvider,
  SheetsServiceError,
} = require("./game-feedback-sheets.cjs");
const adminApp = initializeApp();
const credential = applicationDefault();
const getSheetsToken = createSheetsTokenProvider(
  () => process.env.GAME_FEEDBACK_SHEETS_WRITER,
  async () => (await credential.getAccessToken()).access_token,
);

exports.submitGameFeedback = onCall(
  {
    region: "us-central1",
    cors: [
      "https://electrifygame.com",
      "https://www.electrifygame.com",
      "https://beta.electrifygame.com",
    ],
    timeoutSeconds: 10,
    maxInstances: 2,
  },
  async (request) => {
    try {
      // Read just in this handler so the mailing-list deploy needs no feedback configuration.
      const spreadsheetId = process.env.GAME_FEEDBACK_SPREADSHEET_ID;
      if (!spreadsheetId || !process.env.GAME_FEEDBACK_SHEETS_WRITER) {
        throw new FeedbackError("unavailable");
      }
      return await deliverFeedback(request.data, {
        db: getFirestore(adminApp),
        openSheets: async () =>
          createFeedbackSheets(spreadsheetId, await getSheetsToken()),
      });
    } catch (error) {
      const code = error instanceof FeedbackError ? error.code : "unavailable";
      if (error instanceof SheetsServiceError) {
        logger.warn("Game feedback delivery unavailable", {
          stage: error.stage,
          status: error.status ?? null,
        });
      } else if (code === "unavailable") {
        logger.warn("Game feedback delivery unavailable");
      }
      throw new HttpsError(code, "Feedback couldn't be sent.");
    }
  },
);

Object.assign(
  exports,
  require("./crossplay-production.cjs").registerCrossplay(adminApp),
);
