import {
  captureCrossplayInvite,
  clearCrossplayInvite,
  crossplayInviteLink,
  parseCrossplayInvite,
} from "./CrossplayInvite";

const token = "AbCdEfGhIjKlMnOpQrStUv";
const key = "electrify-crossplay-invite";

afterEach(() => sessionStorage.clear());

test("accepts only official links, opaque invite secrets and paste codes", () => {
  expect(crossplayInviteLink(token)).toBe(
    "https://electrifygame.com/invite/#invite=" + token,
  );
  expect(parseCrossplayInvite(crossplayInviteLink(token)!)).toBe(token);
  expect(parseCrossplayInvite("0123456789ABCDEF0123")).toBe(
    "0123456789abcdef0123",
  );
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
