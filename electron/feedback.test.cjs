const { test } = require("node:test");
const assert = require("node:assert/strict");
const { submitFeedback } = require("./feedback.cjs");

const input = {
  requestId: "6699734c-5897-47e6-b12f-8a853140f46a",
  source: "game-menu",
  message: "The chart was helpful.",
  replyEmail: "",
  appVersion: "19nov26-1938",
};

test("desktop feedback only calls the fixed function with bounded feedback fields", async () => {
  await submitFeedback(
    { ...input, url: "http://localhost/private" },
    async (url, options) => {
      assert.equal(
        url,
        "https://us-central1-electrify-game.cloudfunctions.net/submitGameFeedback",
      );
      assert.equal(options.redirect, "error");
      assert.deepEqual(JSON.parse(options.body), { data: input });
      return { ok: true, json: async () => ({ result: { sent: true } }) };
    },
  );
  await assert.rejects(
    submitFeedback({ ...input, message: "x".repeat(2049) }, assert.fail),
    /Invalid feedback/,
  );
  await assert.rejects(
    submitFeedback(input, async () => ({
      ok: true,
      json: async () => ({ result: { sent: false } }),
    })),
    /unavailable/,
  );
});
