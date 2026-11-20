const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deliverFeedback,
} = require("../../firebase/functions/game-feedback.cjs");
const {
  createFeedbackSheets,
  createSheetsTokenProvider,
} = require("../../firebase/functions/game-feedback-sheets.cjs");

const input = {
  requestId: "6699734c-5897-47e6-b12f-8a853140f46a",
  source: "scenario",
  scenarioId: 101,
  outcome: "bankrupt",
  replyEmail: "player@example.com",
  message: '  =HYPERLINK("https://example.com")  ',
  appVersion: "19nov26-1938",
};

function firestoreFixture() {
  const documents = new Map();
  return {
    doc: (path) => ({
      path,
      collection: (collection) => ({
        doc: (id) => {
          const pathToReceipt = `${path}/${collection}/${id}`;
          return {
            path: pathToReceipt,
            set: async (data) => documents.set(pathToReceipt, data),
          };
        },
      }),
    }),
    runTransaction: async (run) => {
      const writes = new Map();
      const result = await run({
        get: async (ref) => ({ data: () => documents.get(ref.path) }),
        set: (ref, data) => writes.set(ref.path, data),
      });
      for (const [path, data] of writes) documents.set(path, data);
      return result;
    },
  };
}

test("writes literal feedback in the review columns and remembers successful retries", async () => {
  const rows = [];
  const sheets = createFeedbackSheets(
    "test-sheet",
    "sheet-token",
    async (url, options) => {
      const request = new URL(url);
      assert.equal(request.origin, "https://sheets.googleapis.com");
      assert.equal(
        decodeURIComponent(request.pathname),
        "/v4/spreadsheets/test-sheet/values/Feedback!A:H:append",
      );
      assert.equal(request.searchParams.get("valueInputOption"), "RAW");
      assert.equal(request.searchParams.get("insertDataOption"), "INSERT_ROWS");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer sheet-token");
      assert.equal(options.redirect, "error");
      rows.push(...JSON.parse(options.body).values);
      return Response.json({ updates: { updatedRows: 1 } });
    },
  );
  const dependencies = {
    db: firestoreFixture(),
    openSheets: async () => sheets,
    now: 0,
  };
  assert.deepEqual(
    await deliverFeedback({ ...input, spreadsheetId: "other" }, dependencies),
    { sent: true },
  );
  await deliverFeedback(input, dependencies);
  await deliverFeedback(
    { ...input, message: "A different report" },
    dependencies,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(0, 7), [
    "1970-01-01T00:00:00.000Z",
    input.message.trim(),
    input.replyEmail,
    input.source,
    input.scenarioId,
    input.outcome,
    input.appVersion,
  ]);
  assert.match(rows[0][7], /^[0-9a-f]{64}$/);
  assert.notEqual(rows[0][7], rows[1][7]);
});

test("reconciles an uncertain append by submission ID without adding another row", async () => {
  const rows = [];
  const sheets = createFeedbackSheets(
    "test-sheet",
    "sheet-token",
    async (url, options) => {
      if (options.method === "POST") {
        rows.push(...JSON.parse(options.body).values);
        throw new Error("Append succeeded but the connection closed");
      }
      assert.equal(
        decodeURIComponent(new URL(url).pathname),
        "/v4/spreadsheets/test-sheet/values/Feedback!H2:H",
      );
      return Response.json({ values: rows.map((row) => [row[7]]) });
    },
  );
  const dependencies = {
    db: firestoreFixture(),
    openSheets: async () => sheets,
    now: 0,
  };
  await assert.rejects(deliverFeedback(input, dependencies), {
    stage: "Sheets append",
  });
  await assert.rejects(deliverFeedback(input, { ...dependencies, now: 1 }), {
    code: "unavailable",
  });
  assert.deepEqual(
    await deliverFeedback(input, { ...dependencies, now: 190_001 }),
    { sent: true },
  );
  assert.equal(rows.length, 1);
});

test("retries a missing row with the original receipt time", async () => {
  const sheets = {
    hasSubmission: async () => false,
    appendRow: async () => {
      throw new Error("Sheets unavailable");
    },
  };
  const dependencies = {
    db: firestoreFixture(),
    openSheets: async () => sheets,
    now: 0,
  };
  await assert.rejects(
    deliverFeedback(input, dependencies),
    /Sheets unavailable/,
  );
  sheets.appendRow = async (row) => {
    assert.equal(row[0], "1970-01-01T00:00:00.000Z");
  };
  assert.deepEqual(
    await deliverFeedback(input, { ...dependencies, now: 190_001 }),
    { sent: true },
  );
});

test("an authorization failure lets the same report retry immediately", async () => {
  let authorizationCalls = 0;
  let appends = 0;
  const dependencies = {
    db: firestoreFixture(),
    now: 0,
    openSheets: async () => {
      if (++authorizationCalls === 1) throw new Error("IAM unavailable");
      return {
        hasSubmission: async () => false,
        appendRow: async () => {
          appends++;
        },
      };
    },
  };
  await assert.rejects(deliverFeedback(input, dependencies), /IAM unavailable/);
  assert.deepEqual(await deliverFeedback(input, { ...dependencies, now: 1 }), {
    sent: true,
  });
  assert.equal(appends, 1);
});

test("replaying a failed attempt's release preserves a newer lease", async () => {
  const db = firestoreFixture();
  const runTransaction = db.runTransaction;
  const newerReserved = Promise.withResolvers();
  const allowAppend = Promise.withResolvers();
  let appends = 0;
  let transactions = 0;
  let newerAttempt;
  const dependencies = {
    db,
    now: 100,
    openSheets: async () => {
      newerReserved.resolve();
      await allowAppend.promise;
      return {
        hasSubmission: async () => false,
        appendRow: async () => {
          appends++;
        },
      };
    },
  };
  db.runTransaction = async (run) => {
    if (++transactions !== 2) return runTransaction(run);
    await runTransaction(run);
    // The release committed, but its acknowledgement was lost. A new attempt
    // reserves the same report before Firestore re-executes the release.
    newerAttempt = deliverFeedback(input, dependencies);
    await newerReserved.promise;
    return runTransaction(run);
  };
  await assert.rejects(
    deliverFeedback(input, {
      ...dependencies,
      openSheets: async () => {
        throw new Error("IAM unavailable");
      },
    }),
    /IAM unavailable/,
  );

  try {
    await assert.rejects(
      deliverFeedback(input, {
        ...dependencies,
        now: 101,
        openSheets: async () => ({
          hasSubmission: async () => false,
          appendRow: async () => {
            appends++;
          },
        }),
      }),
      { code: "unavailable" },
    );
  } finally {
    allowAppend.resolve();
    await newerAttempt;
  }
  assert.equal(appends, 1);
});

test("mints and shares a short-lived token scoped to Sheets", async () => {
  let calls = 0;
  const tokenProvider = createSheetsTokenProvider(
    () => "writer@example.iam.gserviceaccount.com",
    async () => "runtime-token",
    async (url, options) => {
      calls++;
      assert.equal(
        decodeURIComponent(url),
        "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/writer@example.iam.gserviceaccount.com:generateAccessToken",
      );
      assert.equal(options.headers.Authorization, "Bearer runtime-token");
      assert.deepEqual(JSON.parse(options.body), {
        scope: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      if (calls === 1) return new Response(null, { status: 503 });
      return Response.json({
        accessToken: "sheet-token",
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      });
    },
  );
  await assert.rejects(tokenProvider(), /authorization failed/);
  assert.deepEqual(await Promise.all([tokenProvider(), tokenProvider()]), [
    "sheet-token",
    "sheet-token",
  ]);
  assert.equal(await tokenProvider(), "sheet-token");
  assert.equal(calls, 2);
});

test("malformed feedback cannot consume quota or write to the spreadsheet", async () => {
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
      deliverFeedback({ ...input, ...patch }, { db: { doc: assert.fail } }),
      { code: "invalid-argument" },
    );
  }
});

test("the shared budget meters new submissions per minute and UTC day", async () => {
  const db = firestoreFixture();
  const sheets = { appendRow: async () => {} };
  const submit = (index, now) =>
    deliverFeedback(
      { ...input, message: `Report ${index}` },
      { db, openSheets: async () => sheets, now },
    );
  for (let i = 0; i < 80; i++) {
    await submit(i, Math.floor(i / 8) * 60_000);
    if (i === 7) {
      await assert.rejects(submit(8, 59_999), { code: "resource-exhausted" });
      await submit(7, 59_999);
    }
  }
  await assert.rejects(submit(80, 600_000), { code: "resource-exhausted" });
  await submit(81, 86_400_000);
  await submit(82, 86_399_999);
  for (let i = 83; i < 89; i++) await submit(i, 86_400_001);
  await assert.rejects(submit(89, 86_400_001), { code: "resource-exhausted" });
});
