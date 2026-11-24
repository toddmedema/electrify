import type { User } from "firebase/auth";
import { getDesktop } from "../Desktop";
import { firebaseAppAuth } from "../Globals";
import {
  CrossplayApiError,
  SESSION_REFRESH_MS,
  crossplayPost,
  crossplayTransfer,
  crossplayUserAction,
  parseCrossplaySession,
} from "./CrossplayHttp";

export { CrossplayApiError };

export type DesktopCrossplayResult =
  { ok: true; value: unknown } | { ok: false; code: string };

export interface CrossplayRequestOptions {
  signal?: AbortSignal;
  userAction?: boolean;
}

export interface CrossplayApi {
  request<T>(
    operation: string,
    body: unknown,
    options?: CrossplayRequestOptions,
  ): Promise<T>;
  dispose?(): void;
}

function newDevice() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...Array.from(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function revoke(token: string) {
  return crossplayPost("auth/revoke", {}, { token, timeoutMs: 2_000 }).catch(
    () => undefined,
  );
}

// Authentication and renewal are lazy. The lobby owns the user gesture for Google sign-in.
export function createCrossplayApi(): CrossplayApi {
  if (process.env.REACT_APP_DESKTOP === "true") {
    const desktop = getDesktop();
    if (desktop)
      return {
        async request<T>(
          operation: string,
          body: unknown,
          options?: CrossplayRequestOptions,
        ) {
          if (!desktop.steamEdition || !desktop.crossplayRequest)
            throw new CrossplayApiError("unavailable");
          const signal = options?.signal;
          if (signal?.aborted) throw new CrossplayApiError("cancelled");
          const id = crypto.randomUUID();
          const abort = () => {
            void desktop.cancelCrossplayRequest?.(id).catch(() => undefined);
          };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            const reply = await desktop.crossplayRequest(
              operation,
              body,
              id,
              options?.userAction === true,
            );
            if (signal?.aborted) throw new CrossplayApiError("cancelled");
            if (!reply.ok) throw new CrossplayApiError(reply.code);
            return reply.value as T;
          } finally {
            signal?.removeEventListener("abort", abort);
          }
        },
      };
  }

  let device: string | undefined;
  let account: User | undefined;
  let session: ReturnType<typeof parseCrossplaySession> | undefined;
  let renewing: Promise<string> | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let fenced = false;

  function clearSession() {
    const token = session?.token;
    session = undefined;
    account = undefined;
    fenced = false;
    renewing = undefined;
    if (token) void revoke(token);
  }

  async function authenticate(operation: string, userAction: boolean) {
    if (disposed || !firebaseAppAuth)
      throw new CrossplayApiError("unavailable");
    const auth = firebaseAppAuth.initialize();
    await auth.authStateReady();
    if (disposed) throw new CrossplayApiError("unavailable");
    const user = auth.currentUser;
    if (!user) throw new CrossplayApiError("sign_in_required");
    if (account !== user) {
      clearSession();
      account = user;
    }
    stop ??= auth.onAuthStateChanged((current) => {
      if (account && current !== account) clearSession();
    });
    if (fenced && !(userAction && crossplayUserAction(operation)))
      throw new CrossplayApiError("unauthenticated");
    if (session && session.expiresAt - Date.now() > SESSION_REFRESH_MS)
      return session.token;
    if (renewing) return renewing;

    const exchange = (async () => {
      device ??= newDevice();
      const token = await user.getIdToken(true).catch(() => {
        throw new CrossplayApiError("sign_in_required");
      });
      if (disposed || auth.currentUser !== user || account !== user)
        throw new CrossplayApiError("sign_in_required");
      const next = parseCrossplaySession(
        await crossplayPost(
          "auth/google",
          { token, device },
          {
            token: session?.token,
          },
        ),
      );
      if (disposed || auth.currentUser !== user || account !== user) {
        void revoke(next.token);
        throw new CrossplayApiError("sign_in_required");
      }
      session = next;
      fenced = false;
      return next.token;
    })();
    renewing = exchange;
    try {
      return await exchange;
    } catch (error) {
      if (
        account === user &&
        error instanceof CrossplayApiError &&
        error.code === "unauthenticated"
      ) {
        session = undefined;
        fenced = true;
      }
      throw error;
    } finally {
      if (renewing === exchange) renewing = undefined;
    }
  }

  return {
    async request<T>(
      operation: string,
      body: unknown,
      options?: CrossplayRequestOptions,
    ) {
      if (options?.signal?.aborted) throw new CrossplayApiError("cancelled");
      const token = await authenticate(operation, options?.userAction === true);
      try {
        return (await crossplayPost(operation, body, {
          token,
          transfer: crossplayTransfer(operation),
          signal: options?.signal,
        })) as T;
      } catch (error) {
        // An authenticated operation can have committed. The caller decides when to retry.
        if (
          error instanceof CrossplayApiError &&
          error.code === "unauthenticated" &&
          session?.token === token &&
          !renewing
        ) {
          session = undefined;
          fenced = true;
        }
        throw error;
      }
    },
    dispose() {
      disposed = true;
      stop?.();
      clearSession();
    },
  };
}
