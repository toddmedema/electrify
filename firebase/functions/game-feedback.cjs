const { createHash, randomUUID } = require("node:crypto");

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

// Sheets can keep processing an append for up to 180 seconds after we stop waiting.
const SHEETS_WRITE_LEASE_MS = 190_000;

async function reserveFeedback(db, submissionId, now) {
  const attemptId = randomUUID();
  const requestMinute = Math.floor(now / 60000);
  const budget = db.doc("privateServiceLimits/feedback");
  const receipt = budget.collection("submissions").doc(submissionId);
  return db.runTransaction(async (transaction) => {
    const existing = (await transaction.get(receipt)).data();
    if (existing?.delivered) return null;
    if (existing?.leaseUntil > now) throw new FeedbackError("unavailable");
    const previous = (await transaction.get(budget)).data();
    // A delayed request still counts against the newest recorded window.
    const minute = Math.max(requestMinute, previous?.minute ?? requestMinute);
    const day = Math.floor(minute / 1440);
    const today = previous?.day === day ? previous.today : 0;
    const thisMinute = previous?.minute === minute ? previous.thisMinute : 0;
    if (today >= 80 || thisMinute >= 8) {
      throw new FeedbackError("resource-exhausted");
    }
    const receivedAt = existing?.receivedAt ?? now;
    const leaseUntil = now + SHEETS_WRITE_LEASE_MS;
    transaction.set(budget, {
      day,
      today: today + 1,
      minute,
      thisMinute: thisMinute + 1,
    });
    transaction.set(receipt, {
      attemptId,
      receivedAt,
      leaseUntil,
    });
    return { receipt, receivedAt, attemptId, retry: Boolean(existing) };
  });
}

async function releaseLease(db, receipt, attemptId) {
  await db.runTransaction(async (transaction) => {
    const state = (await transaction.get(receipt)).data();
    if (state?.attemptId === attemptId) {
      transaction.set(receipt, { ...state, leaseUntil: 0 });
    }
  });
}

async function deliverFeedback(data, { db, openSheets, now = Date.now() }) {
  const feedback = validateFeedback(data);
  const submissionId = createHash("sha256")
    .update(JSON.stringify(feedback))
    .digest("hex");
  const signal = AbortSignal.timeout(6_500);
  const reservation = await reserveFeedback(db, submissionId, now);
  if (!reservation) return { sent: true };

  const { receivedAt, receipt, attemptId, retry } = reservation;
  let sheets;
  let alreadySaved;
  // If the previous append succeeded but we lost the response, finish the receipt
  // without appending a second row. The ID follows the row if reviewers sort it.
  try {
    signal.throwIfAborted();
    sheets = await openSheets();
    alreadySaved = retry && (await sheets.hasSubmission(submissionId, signal));
    signal.throwIfAborted();
  } catch (error) {
    await releaseLease(db, receipt, attemptId);
    throw error;
  }
  if (!alreadySaved) {
    await sheets.appendRow(
      [
        new Date(receivedAt).toISOString(),
        feedback.message,
        feedback.replyEmail,
        feedback.source,
        feedback.scenarioId ?? "",
        feedback.outcome ?? "",
        feedback.appVersion,
        submissionId,
      ],
      signal,
    );
  }
  await receipt.set({ receivedAt, delivered: true });
  return { sent: true };
}

module.exports = { deliverFeedback, FeedbackError };
