const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PRESENTATION_DECLARATIONS,
  loadPresentationFunctions,
  steamPresentation,
} = require("./steam-presentation.cjs");
const { SteamService } = require("./steam.cjs");

function fixture(factors = []) {
  return {
    utils: () => "utils",
    bigPicture: () => true,
    steamDeck: () => false,
    remotePlay: () => "remote",
    sessionCount: () => factors.length,
    sessionId: (_remote, index) => index + 1,
    formFactor: (_remote, id) => factors[id - 1],
  };
}

test("reports Big Picture and Deck separately; only TV Remote Play clients count", () => {
  assert.deepEqual(steamPresentation(fixture([1, 2, 3, 0])), {
    bigPicture: true,
    steamDeck: false,
    remotePlayTv: false,
  });
  assert.deepEqual(
    steamPresentation({ ...fixture([3, 4]), steamDeck: () => true }),
    { bigPicture: true, steamDeck: true, remotePlayTv: true },
  );
  assert.equal(steamPresentation(fixture()).remotePlayTv, false);
  assert.equal(
    steamPresentation({ ...fixture([4]), sessionId: () => 0 }).remotePlayTv,
    false,
  );
});

test("missing interfaces and read failures remain unknown instead of identifying a PC", () => {
  assert.deepEqual(steamPresentation(null), {
    bigPicture: undefined,
    steamDeck: undefined,
    remotePlayTv: undefined,
  });
  const api = fixture([4]);
  delete api.steamDeck;
  api.sessionCount = () => {
    throw new Error("Steam disconnected");
  };
  assert.deepEqual(steamPresentation(api), {
    bigPicture: true,
    steamDeck: undefined,
    remotePlayTv: undefined,
  });
  assert.equal(
    steamPresentation({ ...fixture(), utils: () => null }).bigPicture,
    undefined,
  );
});

test("optional exports resolve independently, and bundled declarations match actual symbols", () => {
  const partial = loadPresentationFunctions({
    func: (declaration) => {
      if (declaration.includes("RemotePlay")) throw new Error("older SDK");
      return declaration;
    },
  });
  assert.deepEqual(Object.keys(partial), ["utils", "bigPicture", "steamDeck"]);
  const bundled = loadPresentationFunctions();
  assert.deepEqual(
    Object.keys(bundled),
    Object.keys(PRESENTATION_DECLARATIONS),
  );
});

test("the existing state bridge publishes hints only while Steam is available", () => {
  const steam = new SteamService();
  steam.presentation = fixture([4]);
  assert.equal(steam.state().presentation, undefined);
  steam.client = {};
  assert.deepEqual(steam.state().presentation, {
    bigPicture: true,
    steamDeck: false,
    remotePlayTv: true,
  });
  steam.stopped = true;
  assert.equal(steam.state().presentation, undefined);
});
