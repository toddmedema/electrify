const LOCATION = "https://electrifygame.com/invite/";
const KEY = "electrify-crossplay-invite";
const LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export function crossplayInviteLink(token: string): string | undefined {
  if (!LINK_TOKEN.test(token)) return undefined;
  return LOCATION + "#invite=" + token;
}

export function parseCrossplayInvite(input: string): string | undefined {
  const token = input.trim();
  if (LINK_TOKEN.test(token)) return token;
  if (/^[a-f0-9]{20}$/i.test(token)) return token.toLowerCase();
  if (!token.startsWith(LOCATION + "#invite=")) return undefined;
  const fromLink = token.slice(LOCATION.length + "#invite=".length);
  return LINK_TOKEN.test(fromLink) ? fromLink : undefined;
}

/** The static first-party page strips the fragment before handing off to the app. */
export function captureCrossplayInvite(): string | undefined {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (!stored) return undefined;
    const { token, expiresAt } = JSON.parse(stored);
    const now = Date.now();
    if (
      typeof token === "string" &&
      LINK_TOKEN.test(token) &&
      Number.isSafeInteger(expiresAt) &&
      expiresAt > now &&
      expiresAt - now <= 10 * 60_000
    )
      return token;
    clearCrossplayInvite();
  } catch {
    clearCrossplayInvite();
  }
  return undefined;
}

export function clearCrossplayInvite() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // The Steam prompt and manually pasted codes need no browser storage.
  }
}
