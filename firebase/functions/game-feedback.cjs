const { createHash } = require("node:crypto");

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = ["game-menu", "tutorial", "scenario"];
const OUTCOMES = ["completed", "bankrupt", "fired"];

class FeedbackError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function mailbox(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

function validateFeedback(data) {
  const {
    requestId,
    message,
    replyEmail,
    source,
    scenarioId,
    outcome,
    appVersion,
  } = data ?? {};
  if (
    typeof requestId !== "string" ||
    !UUID.test(requestId) ||
    typeof message !== "string" ||
    message.length > 2048 ||
    !message.trim() ||
    (replyEmail !== "" && !mailbox(replyEmail)) ||
    !SOURCES.includes(source) ||
    (scenarioId !== undefined &&
      (!Number.isSafeInteger(scenarioId) || scenarioId < 0)) ||
    (source !== "game-menu" && scenarioId === undefined) ||
    (source === "scenario"
      ? !OUTCOMES.includes(outcome)
      : outcome !== undefined) ||
    typeof appVersion !== "string" ||
    !/^[a-z0-9.-]{1,40}$/i.test(appVersion)
  ) {
    throw new FeedbackError("invalid-argument");
  }
  return {
    requestId,
    message: message.trim(),
    replyEmail,
    source,
    scenarioId,
    outcome,
    appVersion,
  };
}

// One fixed-size document bounds delivery volume across cold starts and parallel instances.
// Avoid storing network identifiers or feedback text in Firestore.
async function reserveFeedback(db, now = Date.now()) {
  const requestMinute = Math.floor(now / 60000);
  const ref = db.doc("privateServiceLimits/feedback");
  await db.runTransaction(async (transaction) => {
    const previous = (await transaction.get(ref)).data();
    // A delayed request still counts against the newest recorded window.
    const minute = Math.max(requestMinute, previous?.minute ?? requestMinute);
    const day = Math.floor(minute / 1440);
    const today = previous?.day === day ? previous.today : 0;
    const thisMinute = previous?.minute === minute ? previous.thisMinute : 0;
    if (today >= 80 || thisMinute >= 8) {
      throw new FeedbackError("resource-exhausted");
    }
    transaction.set(ref, {
      day,
      today: today + 1,
      minute,
      thisMinute: thisMinute + 1,
    });
  });
}

async function deliverFeedback(data, { settings, reserve, send = fetch }) {
  const feedback = validateFeedback(data);
  const { apiKey, from, to } = settings ?? {};
  if (typeof apiKey !== "string" || !apiKey || !mailbox(from) || !mailbox(to)) {
    throw new FeedbackError("unavailable");
  }
  await reserve();
  const {
    message,
    source,
    scenarioId,
    outcome,
    appVersion,
    replyEmail,
    requestId,
  } = feedback;
  const text = [
    message,
    "",
    `Source: ${source}`,
    ...(scenarioId === undefined ? [] : [`Scenario: ${scenarioId}`]),
    ...(outcome === undefined ? [] : [`Outcome: ${outcome}`]),
    `Game version: ${appVersion}`,
  ].join("\n");
  // Tying the key to the exact email lets a retry recover after a lost response
  // while a changed message is always a new submission.
  const key = createHash("sha256")
    .update(JSON.stringify([requestId, text, replyEmail]))
    .digest("hex");
  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(6500),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `electrify-feedback/${key}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Electrify player feedback",
      text,
      ...(replyEmail ? { reply_to: replyEmail } : {}),
    }),
  });
  if (!response.ok) throw new FeedbackError("unavailable");
  return { sent: true };
}

module.exports = { deliverFeedback, reserveFeedback, FeedbackError };
