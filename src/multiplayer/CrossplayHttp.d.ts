export class CrossplayApiError extends Error {
  readonly code: string;
  constructor(code: string);
}

export const SESSION_REFRESH_MS: number;

export function crossplayPost(
  operation: string,
  body: unknown,
  options?: {
    token?: string;
    transfer?: boolean;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<unknown>;

export function crossplayTransfer(operation: string): boolean;

export function crossplayUserAction(operation: string): boolean;

export function parseCrossplaySession(value: unknown): {
  token: string;
  expiresAt: number;
};
