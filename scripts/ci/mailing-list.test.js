const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  subscribe,
  describeFailure,
} = require("../../firebase/functions/mailing-list.cjs");

const request = (provider = "google.com", email = "Player@example.com") => ({
  auth: {
    uid: "player",
    token: {
      email,
      email_verified: true,
      firebase: { sign_in_provider: provider },
    },
  },
  data: { consent: true },
});
const key = "test-secret-us10";
const response = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

test("subscribes immediately using the token email", async () => {
  const calls = [];
  const input = request();
  input.data.email = "someone-else@example.com";
  const result = await subscribe(input, {
    apiKey: key,
    fetch: async (...args) => {
      calls.push(args);
      return response(200, { status: "subscribed" });
    },
  });
  assert.deepEqual(result, { status: "subscribed" });
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(
    url,
    "https://us10.api.mailchimp.com/3.0/lists/8ccd05ccba/members",
  );
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, `Bearer ${key}`);
  const body = JSON.parse(options.body);
  assert.equal(body.email_address, "player@example.com");
  assert.equal(body.status, "subscribed");
  assert.ok(body.tags.includes("electrify-updates-v1"));
  assert.ok(!Number.isNaN(Date.parse(body.timestamp_signup)));
});

test("sends the signup timestamp as UTC seconds in Mailchimp's accepted format", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.UTC(2026, 9, 30, 12, 34, 56, 789),
  });
  const result = await subscribe(request(), {
    apiKey: key,
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.timestamp_signup, "2026-10-30 12:34:56");
      return response(200, { status: "subscribed" });
    },
  });
  assert.deepEqual(result, { status: "subscribed" });
});

for (const [name, mutate, code] of [
  ["anonymous caller", (r) => delete r.auth, "unauthenticated"],
  ["unchecked consent", (r) => (r.data.consent = false), "invalid-argument"],
  ["missing consent", (r) => delete r.data, "invalid-argument"],
  [
    "unverified email",
    (r) => (r.auth.token.email_verified = false),
    "failed-precondition",
  ],
  ["missing email", (r) => delete r.auth.token.email, "failed-precondition"],
  [
    "unsupported identity",
    (r) => (r.auth.token.firebase.sign_in_provider = "anonymous"),
    "failed-precondition",
  ],
]) {
  test(`rejects ${name} before contacting Mailchimp`, async () => {
    const input = request();
    mutate(input);
    await assert.rejects(
      subscribe(input, {
        apiKey: key,
        fetch: () => assert.fail("must not submit an address"),
      }),
      { code },
    );
  });
}

for (const status of [
  "subscribed",
  "unsubscribed",
  "cleaned",
  "pending",
  "transactional",
]) {
  test(`preserves existing ${status} members without repeated welcome triggers`, async () => {
    const calls = [];
    const attempt = subscribe(request(), {
      apiKey: key,
      fetch: async (url, options) => {
        calls.push([url, options]);
        return calls.length === 1
          ? response(400, { title: "Member Exists" })
          : response(200, { status });
      },
    });
    if (status === "subscribed")
      assert.deepEqual(await attempt, { status: "already-subscribed" });
    else await assert.rejects(attempt, { code: "failed-precondition" });
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1].method, undefined);
    assert.match(calls[1][0], /\/members\/[a-f0-9]{32}\?fields=status$/);
  });
}

test("refuses missing or malformed server credentials", async () => {
  for (const apiKey of [undefined, "", "invalid", "key-evil.example.com"]) {
    await assert.rejects(
      subscribe(request(), { apiKey, fetch: () => assert.fail("no network") }),
      { code: "unavailable" },
    );
  }
});

test("reports service failures instead of claiming signup succeeded", async () => {
  for (const result of [
    response(500, {}),
    response(200, { status: "pending" }),
    response(400, { title: "Invalid Resource" }),
  ]) {
    await assert.rejects(
      subscribe(request(), { apiKey: key, fetch: async () => result }),
      { code: "unavailable" },
    );
  }
  await assert.rejects(
    subscribe(request(), {
      apiKey: key,
      fetch: async () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
});

test("describes failures with fixed fields and no address", async () => {
  const email = "player@example.com";
  const failure = (result) =>
    subscribe(request(), {
      apiKey: key,
      fetch: async () => result,
    }).catch(describeFailure);
  assert.deepEqual(
    await failure(
      response(400, { title: "Invalid Resource", detail: `${email} is fake` }),
    ),
    {
      code: "unavailable",
      mailchimpStatus: 400,
      mailchimpTitle: "Invalid Resource",
    },
  );
  assert.deepEqual(await failure(response(401, { detail: email })), {
    code: "unavailable",
    mailchimpStatus: 401,
    mailchimpTitle: undefined,
  });
  assert.deepEqual(describeFailure(new TypeError(`bad ${email}`)), {
    code: "unavailable",
    reason: "TypeError",
  });
  assert.deepEqual(
    await subscribe(request(), { apiKey: "invalid" }).catch(describeFailure),
    { code: "unavailable", reason: "malformed-api-key" },
  );
});
