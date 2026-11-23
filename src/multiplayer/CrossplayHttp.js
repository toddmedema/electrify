const CROSSPLAY_ENDPOINT =
  "https://us-central1-electrify-game.cloudfunctions.net/coopV2";
const CONTROL_BYTES = 128 * 1024;
const TRANSFER_BYTES = 12 * 1024 * 1024;
const SESSION_REFRESH_MS = 15_000;

class CrossplayApiError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = "CrossplayApiError";
    this.code = code;
  }
}

/**
 * @param {Response} response
 * @param {number} limit
 */
async function readJson(response, limit) {
  const declared = Number(response.headers.get("Content-Length"));
  if (!response.body || declared > limit) {
    await response.body?.cancel();
    throw new CrossplayApiError("unavailable");
  }

  const reader = response.body.getReader();
  const text = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new CrossplayApiError("unavailable");
      chunks.push(text.decode(value, { stream: true }));
    }
    chunks.push(text.decode());
    return JSON.parse(chunks.join(""));
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new CrossplayApiError("unavailable");
  } finally {
    reader.releaseLock();
  }
}

/**
 * @param {string} operation
 * @param {unknown} body
 * @param {{
 *   token?: string,
 *   transfer?: boolean,
 *   fetcher?: typeof fetch,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} [options]
 * @returns {Promise<unknown>}
 */
async function crossplayPost(operation, body, options = {}) {
  if (!/^[a-z]+\/[a-z-]+$/.test(operation))
    throw new CrossplayApiError("invalid_request");

  const limit = options.transfer ? TRANSFER_BYTES : CONTROL_BYTES;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? (options.transfer ? 20_000 : 8_000),
  );
  try {
    if (options.signal?.aborted) throw new CrossplayApiError("cancelled");
    const content = JSON.stringify(body);
    if (!content || new TextEncoder().encode(content).byteLength > limit)
      throw new CrossplayApiError("invalid_request");

    const response = await (options.fetcher ?? fetch)(
      CROSSPLAY_ENDPOINT + "/" + operation,
      {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          ...(options.token
            ? { Authorization: "Bearer " + options.token }
            : {}),
        },
        body: content,
        signal: controller.signal,
      },
    );
    const value = await readJson(response, response.ok ? limit : 1024);
    if (!response.ok) {
      const code = value?.error;
      throw new CrossplayApiError(
        typeof code === "string" && /^[a-z_]{1,40}$/.test(code)
          ? code
          : response.status === 401
            ? "unauthenticated"
            : "unavailable",
      );
    }
    return value;
  } catch (error) {
    if (options.signal?.aborted) throw new CrossplayApiError("cancelled");
    if (error instanceof CrossplayApiError) throw error;
    throw new CrossplayApiError("unavailable");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

/**
 * @param {unknown} value
 * @returns {{ token: string, expiresAt: number }}
 */
function parseCrossplaySession(value) {
  const session =
    /** @type {{token?: unknown, expiresAt?: unknown} | undefined} */ (value);
  if (
    typeof session?.token !== "string" ||
    !/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(session.token) ||
    typeof session.expiresAt !== "number" ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= Date.now()
  )
    throw new CrossplayApiError("unavailable");
  return { token: session.token, expiresAt: session.expiresAt };
}

/** @param {string} operation */
function crossplayTransfer(operation) {
  return operation.startsWith("save/") || operation.startsWith("transfer/");
}

/** @param {string} operation */
function crossplayUserAction(operation) {
  return (
    operation === "room/create" ||
    operation === "room/join" ||
    operation === "room/reconnect"
  );
}

module.exports = {
  CrossplayApiError,
  SESSION_REFRESH_MS,
  crossplayPost,
  crossplayTransfer,
  crossplayUserAction,
  parseCrossplaySession,
};
