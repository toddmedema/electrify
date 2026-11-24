const LOCATION = "https://electrifygame.com/";
const LEGACY_LOCATION = LOCATION + "invite/";
const INVITE_FRAGMENT = /^#invite=([A-Za-z0-9_-]{22})$/;
const KEY = "electrify-crossplay-invite";
const LINK_TOKEN = /^[A-Za-z0-9_-]{22}$/;
const HANDOFF_MS = 10 * 60_000;
let unsavedInvite: { token: string; expiresAt: number } | undefined;

export function crossplayInviteLink(token: string): string | undefined {
  if (!LINK_TOKEN.test(token)) return undefined;
  return LOCATION + "#invite=" + token;
}

export function parseCrossplayInvite(input: string): string | undefined {
  const token = input.trim();
  if (LINK_TOKEN.test(token)) return token;
  if (/^[a-z0-9]{6}$/i.test(token) || /^[a-f0-9]{20}$/i.test(token))
    return token.toLowerCase();
  for (const location of [LOCATION, LEGACY_LOCATION]) {
    if (!token.startsWith(location)) continue;
    const match = INVITE_FRAGMENT.exec(token.slice(location.length));
    if (match) return match[1];
  }
  return undefined;
}

export function steamInviteLink(
  token: string,
  appId = process.env.REACT_APP_STEAM_APP_ID,
): string | undefined {
  if (
    !LINK_TOKEN.test(token) ||
    !appId ||
    !/^[1-9][0-9]{0,9}$/.test(appId) ||
    Number(appId) > 2147483647
  )
    return undefined;
  return `steam://run/${appId}//${encodeURIComponent("--electrify-coop=" + token)}/`;
}

export function currentInviteFragment(): string | undefined {
  if (window.location.pathname === "/" && !window.location.search)
    return INVITE_FRAGMENT.exec(window.location.hash)?.[1];
  return undefined;
}

/** Capture a browser handoff in this tab, including links opened in a new tab. */
export function captureCrossplayInvite(onlyNew = false): string | undefined {
  const token = currentInviteFragment();
  if (token) {
    const invite = { token, expiresAt: Date.now() + HANDOFF_MS };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(invite));
      unsavedInvite = undefined;
    } catch {
      unsavedInvite = invite;
    }
    window.history.replaceState(window.history.state, "", "/");
    return token;
  }
  if (onlyNew) return undefined;
  if (unsavedInvite && unsavedInvite.expiresAt > Date.now())
    return unsavedInvite.token;
  unsavedInvite = undefined;
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
      expiresAt - now <= HANDOFF_MS
    )
      return token;
    clearCrossplayInvite();
  } catch {
    clearCrossplayInvite();
  }
  return undefined;
}

export function clearCrossplayInvite() {
  unsavedInvite = undefined;
  if (currentInviteFragment())
    window.history.replaceState(window.history.state, "", "/");
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // The Steam prompt and manually pasted codes need no browser storage.
  }
}
