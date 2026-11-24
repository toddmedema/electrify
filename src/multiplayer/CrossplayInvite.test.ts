import {
  captureCrossplayInvite,
  clearCrossplayInvite,
  crossplayInviteLink,
  parseCrossplayInvite,
  steamInviteLink,
} from "./CrossplayInvite";

const token = "AbCdEfGhIjKlMnOpQrStUv";
const key = "electrify-crossplay-invite";

afterEach(() => {
  clearCrossplayInvite();
  sessionStorage.clear();
});

test("accepts only official links, opaque invite secrets and paste codes", () => {
  expect(crossplayInviteLink(token)).toBe(
    "https://electrifygame.com/#invite=" + token,
  );
  expect(parseCrossplayInvite(crossplayInviteLink(token)!)).toBe(token);
  expect(parseCrossplayInvite("0123456789ABCDEF0123")).toBe(
    "0123456789abcdef0123",
  );
  expect(parseCrossplayInvite("  A1Z2Q3 ")).toBe("a1z2q3");
  expect(parseCrossplayInvite("a1z2q")).toBeUndefined();
  expect(
    parseCrossplayInvite("https://electrifygame.com/invite/#invite=" + token),
  ).toBe(token);
  expect(parseCrossplayInvite(token)).toBe(token);
  expect(
    parseCrossplayInvite("https://example.test/invite/#invite=" + token),
  ).toBeUndefined();
  expect(
    parseCrossplayInvite(
      "https://electrifygame.com/invite/?extra=1#invite=" + token,
    ),
  ).toBeUndefined();
  expect(crossplayInviteLink("url=//example.test/")).toBeUndefined();
});

test("captures the invitation from a new tab with empty storage", () => {
  window.history.replaceState(null, "", "/#invite=" + token);
  expect(captureCrossplayInvite()).toBe(token);
  expect(window.location.hash).toBe("");
  expect(captureCrossplayInvite()).toBe(token);
});

test("keeps an invite through sign-in and expires or clears the handoff", () => {
  sessionStorage.setItem(
    key,
    JSON.stringify({ token, expiresAt: Date.now() + 10_000 }),
  );
  expect(captureCrossplayInvite()).toBe(token);
  expect(captureCrossplayInvite()).toBe(token);
  clearCrossplayInvite();
  expect(captureCrossplayInvite()).toBeUndefined();
  sessionStorage.setItem(
    key,
    JSON.stringify({ token, expiresAt: Date.now() - 1 }),
  );
  expect(captureCrossplayInvite()).toBeUndefined();
  expect(sessionStorage.getItem(key)).toBeNull();
});

test("an optional Steam destination opens the same invite in the native join prompt", () => {
  expect(steamInviteLink(token, "123456")).toBe(
    "steam://run/123456//--electrify-coop%3D" + token + "/",
  );
  expect(steamInviteLink(token, "2147483648")).toBeUndefined();
});

test("keeps the invite in memory while stripping the fragment if storage is blocked", () => {
  const rejected = jest
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
  try {
    window.history.replaceState(null, "", "/#invite=" + token);
    expect(captureCrossplayInvite()).toBe(token);
    expect(window.location.hash).toBe("");
    expect(captureCrossplayInvite()).toBe(token);
    clearCrossplayInvite();
    expect(captureCrossplayInvite()).toBeUndefined();
  } finally {
    rejected.mockRestore();
  }
});
