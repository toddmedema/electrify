const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deliverFeedback,
  reserveFeedback,
} = require("../../firebase/functions/game-feedback.cjs");

const settings = {
  from: "feedback@example.com",
  to: "owner@example.com",
  apiKey: "test-key",
};
const input = {
  requestId: "6699734c-5897-47e6-b12f-8a853140f46a",
  source: "scenario",
  scenarioId: 101,
  outcome: "bankrupt",
  replyEmail: "player@example.com",
  message: "  <b>My grid went dark.</b>  ",
  appVersion: "19nov26-1938",
};

test("delivers plain text to the configured inbox with a stable retry key", async () => {
  const keys = [];
  let reservations = 0;
  const dependencies = {
    settings,
    reserve: async () => {
      reservations++;
    },
    send: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.redirect, "error");
      keys.push(options.headers["Idempotency-Key"]);
      assert.deepEqual(JSON.parse(options.body), {
        from: settings.from,
        to: [settings.to],
        subject: "Electrify player feedback",
        text: "<b>My grid went dark.</b>\n\nSource: scenario\nScenario: 101\nOutcome: bankrupt\nGame version: 19nov26-1938",
        reply_to: input.replyEmail,
      });
      return { ok: true };
    },
  };
  assert.deepEqual(
    await deliverFeedback(
      { ...input, to: "another@example.com" },
      dependencies,
    ),
    { sent: true },
  );
  await deliverFeedback(input, dependencies);
  assert.equal(reservations, 2);
  assert.equal(keys[0], keys[1]);
});

test("malformed feedback cannot consume quota or send email", async () => {
  for (const patch of [
    { requestId: "client-selected-header" },
    { message: "   " },
    { message: "x".repeat(2049) },
    { replyEmail: "a@example.com,b@example.com" },
    { replyEmail: "a@example.com\r\nb@example.com" },
    { source: "tutorial" },
    { scenarioId: -1 },
    { appVersion: "invalid version" },
  ]) {
    await assert.rejects(
      deliverFeedback(
        { ...input, ...patch },
        {
          settings,
          reserve: assert.fail,
          send: assert.fail,
        },
      ),
      { code: "invalid-argument" },
    );
  }
});

test("the shared budget meters anonymous submissions per minute and UTC day", async () => {
  let counter;
  const db = {
    doc: () => "feedback",
    runTransaction: (transaction) =>
      transaction({
        get: async () => ({ data: () => counter }),
        set: (_ref, data) => {
          counter = data;
        },
      }),
  };
  for (let i = 0; i < 80; i++) {
    await reserveFeedback(db, Math.floor(i / 8) * 60_000);
    if (i === 7) {
      await assert.rejects(reserveFeedback(db, 59_999), {
        code: "resource-exhausted",
      });
    }
  }
  await assert.rejects(reserveFeedback(db, 600_000), {
    code: "resource-exhausted",
  });
  await reserveFeedback(db, 86_400_000);
  assert.equal(counter.today, 1);
  await reserveFeedback(db, 86_399_999);
  await reserveFeedback(db, 86_400_001);
  assert.equal(counter.today, 3);
  assert.equal(counter.thisMinute, 3);
});
