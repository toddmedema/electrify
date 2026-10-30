const { createHash } = require("node:crypto");

class SubscriptionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Only an explicit choice may subscribe the verified OAuth account's own email. */
async function subscribe(request, { apiKey, fetch: send = fetch }) {
  const auth = request.auth;
  if (!auth) throw new SubscriptionError("unauthenticated");
  if (
    request.data?.consent !== true ||
    request.data?.uid !== auth.uid ||
    request.data?.consentVersion !== "electrify-updates-v1"
  )
    throw new SubscriptionError("invalid-argument");
  const token = auth.token;
  if (
    token.email_verified !== true ||
    token.firebase?.sign_in_provider !== "google.com" ||
    typeof token.email !== "string" ||
    !token.email.includes("@")
  )
    throw new SubscriptionError("failed-precondition");
  const datacenter = apiKey?.match(/-(us\d+)$/)?.[1];
  if (!datacenter) throw new SubscriptionError("unavailable");
  // Same public audience as public/about.html. The credential stays in Secret Manager.
  const members = `https://${datacenter}.api.mailchimp.com/3.0/lists/8ccd05ccba/members`;
  const email = token.email.trim().toLowerCase();
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const response = await send(members, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      email_address: email,
      status: "subscribed",
      timestamp_signup: new Date().toISOString(),
      tags: ["Electrify account signup", "electrify-updates-v1"],
    }),
  });
  if (response.ok) {
    if ((await response.json()).status === "subscribed")
      return { status: "subscribed" };
    throw new SubscriptionError("unavailable");
  }
  if (response.status === 400) {
    const error = await response.json();
    if (error.title === "Member Exists") {
      const hash = createHash("md5").update(email).digest("hex");
      const member = await send(`${members}/${hash}?fields=status`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (member.ok && (await member.json()).status === "subscribed")
        return { status: "already-subscribed" };
      // Never overwrite an existing unsubscribe, pending confirmation or cleaned address.
      throw new SubscriptionError("failed-precondition");
    }
  }
  throw new SubscriptionError("unavailable");
}

module.exports = { subscribe, SubscriptionError };
