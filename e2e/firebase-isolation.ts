import type { BrowserContext, Request } from "@playwright/test";

const { isFirebaseHost } = require("../scripts/ci/firebase-hosts") as {
  isFirebaseHost(host: string): boolean;
};

const database = "projects/electrify-game/databases/(default)";
const listenPath = "/google.firestore.v1.Firestore/Listen/channel";
const rankPath = `/v1/${database}/documents:runAggregationQuery`;

type FieldFilter = {
  field?: { fieldPath?: string };
  op?: string;
  value?: { integerValue?: string | number; stringValue?: string };
};
type StructuredQuery = {
  from?: { collectionId?: string }[];
  where?: {
    compositeFilter?: {
      op?: string;
      filters?: { fieldFilter?: FieldFilter }[];
    };
  };
};

function selectsLeaderboard(query: StructuredQuery | undefined): boolean {
  const filter = query?.where?.compositeFilter;
  const equalValue = (fieldPath: string) =>
    filter?.filters?.find(
      ({ fieldFilter }) =>
        fieldFilter?.field?.fieldPath === fieldPath &&
        fieldFilter.op === "EQUAL",
    )?.fieldFilter?.value;
  return (
    query?.from?.length === 1 &&
    query.from[0]?.collectionId === "scores" &&
    filter?.op === "AND" &&
    equalValue("scenarioId")?.integerValue != null &&
    equalValue("scoreVersion")?.integerValue != null &&
    equalValue("outcome")?.stringValue === "completed"
  );
}

// Scenario previews look up public scores even for signed-out players. Simulate an
// unavailable leaderboard so the SDK settles from its empty cache. Other operations
// on scores, including the profile rename lookup, need explicit fixtures.
function isLeaderboardRead(request: Request, url: URL): boolean {
  if (
    request.method() !== "POST" ||
    url.hostname !== "firestore.googleapis.com"
  )
    return false;
  try {
    if (url.pathname === rankPath) {
      const requestBody = request.postDataJSON() as {
        structuredAggregationQuery?: { structuredQuery?: StructuredQuery };
      } | null;
      return selectsLeaderboard(
        requestBody?.structuredAggregationQuery?.structuredQuery,
      );
    }
    if (
      url.pathname !== listenPath ||
      url.searchParams.get("database") !== database
    )
      return false;
    const messages = Array.from(
      new URLSearchParams(request.postData() ?? ""),
    ).filter(([key]) => /^req\d+___data__$/.test(key));
    return (
      messages.length > 0 &&
      messages.every(([, raw]) => {
        const message = JSON.parse(raw) as {
          addTarget?: {
            query?: { parent?: string; structuredQuery?: StructuredQuery };
          };
        } | null;
        return (
          message?.addTarget?.query?.parent === `${database}/documents` &&
          selectsLeaderboard(message.addTarget.query.structuredQuery)
        );
      })
    );
  } catch {
    return false;
  }
}

export async function isolateFirebase(
  context: BrowserContext,
): Promise<() => void> {
  const attempts = new Set<string>();
  const matches = (url: URL) => isFirebaseHost(url.hostname);
  const record = (method: string, url: URL) => {
    // Query strings and bodies can carry API keys and user credentials.
    attempts.add(`${method} ${url.origin}${url.pathname}`);
  };
  await context.route(matches, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (isLeaderboardRead(request, url)) {
      await route.abort("internetdisconnected");
      return;
    }
    record(request.method(), url);
    await route.abort("blockedbyclient");
  });
  await context.routeWebSocket(matches, (socket) => {
    record("WebSocket", new URL(socket.url()));
    return socket.close({ code: 1008, reason: "Unexpected Firebase request" });
  });
  context.on("requestfailed", (request) => {
    // A higher-priority route can call continue(), and service workers have their
    // own request path. Chromium blocks those at DNS when no local mock answers.
    const url = new URL(request.url());
    if (
      matches(url) &&
      request.failure()?.errorText === "net::ERR_NAME_NOT_RESOLVED"
    )
      record(request.method(), url);
  });
  return () => {
    if (attempts.size)
      throw new Error(
        `Unexpected Firebase request blocked. Add a local Playwright mock or use an emulator.\n${[...attempts].join("\n")}`,
      );
  };
}
