const FEEDBACK_ENDPOINT =
  "https://us-central1-electrify-game.cloudfunctions.net/submitGameFeedback";

async function submitFeedback(input, send = fetch) {
  const {
    requestId,
    message,
    replyEmail,
    source,
    scenarioId,
    outcome,
    appVersion,
  } = input ?? {};
  // Limit data copied to the network and keep this IPC tied to one destination.
  if (
    typeof requestId !== "string" ||
    requestId.length !== 36 ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 2048 ||
    typeof replyEmail !== "string" ||
    replyEmail.length > 254 ||
    !["game-menu", "tutorial", "scenario"].includes(source) ||
    (scenarioId !== undefined && !Number.isSafeInteger(scenarioId)) ||
    (outcome !== undefined &&
      !["completed", "bankrupt", "fired"].includes(outcome)) ||
    typeof appVersion !== "string" ||
    appVersion.length > 40
  ) {
    throw new Error("Invalid feedback");
  }
  const response = await send(FEEDBACK_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        requestId,
        message,
        replyEmail,
        source,
        scenarioId,
        outcome,
        appVersion,
      },
    }),
  });
  if (!response.ok || (await response.json()).result?.sent !== true) {
    throw new Error("Feedback is unavailable");
  }
}

module.exports = { submitFeedback };
