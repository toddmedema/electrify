const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  SteamActivity,
  describeActivity,
  MAX_TIMELINE_RUNS,
  MAX_TIMELINE_EVENTS,
} = require("./steam-activity.cjs");
const { SteamService } = require("./steam.cjs");
const { validateActivity, validateTimelineEvent } = require("./runtime.cjs");
const {
  loadTimelineFunctions,
  TIMELINE_DECLARATIONS,
} = require("./steam-native.cjs");
const {
  readScenarioMetadata,
  renderLocalization,
} = require("../scripts/generate-steam-localization.js");
const SCENARIOS = require("./steam-localization.cjs");
const { presenceTokens } = require("./steam-text.cjs");

const activity = {
  phase: "playing",
  scenarioId: 103,
  year: 8,
  totalYears: 20,
  timelineEnabled: true,
};
const event = {
  runId: "run-uuid",
  eventId: "construction-facility-1",
  kind: "construction",
  scenarioId: 103,
  year: 8,
};

function fixture({
  online = true,
  supported = true,
  language = "english",
} = {}) {
  const calls = [];
  const state = { online };
  const api = {
    friends: () => "friends",
    utils: () => "utils",
    uiLanguage: () => language,
    presence: (...args) => {
      calls.push(["presence", ...args]);
      return true;
    },
    clearPresence: (...args) => calls.push(["clearPresence", ...args]),
  };
  const timeline = {
    timeline: () => (supported ? "timeline" : null),
    mode: (...args) => calls.push(["mode", ...args]),
    description: (...args) => calls.push(["description", ...args]),
    clearDescription: (...args) => calls.push(["clearDescription", ...args]),
    event: (...args) => calls.push(["event", ...args]),
  };
  return {
    calls,
    state,
    api,
    timeline,
    service: new SteamActivity(api, timeline, () => state.online),
  };
}

test("authored scenario metadata and Steam upload tokens stay aligned without executing game code", () => {
  const root = path.resolve(__dirname, "..");
  const scenarios = readScenarioMetadata(
    fs.readFileSync(path.join(root, "src/data/Scenarios.tsx"), "utf8"),
  );
  assert.deepEqual(
    SCENARIOS,
    scenarios,
    "Run node scripts/generate-steam-localization.js after editing authored scenario metadata",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "steamworks/rich-presence.vdf"), "utf8"),
    renderLocalization(scenarios),
  );
  const fixtureSource =
    'throw new Error("Never execute"); export const SCENARIOS = [{id:12,name:"Authored",durationMonths:12*20,location:{id:99,name:"Private"}}];';
  assert.deepEqual(readScenarioMetadata(fixtureSource), {
    12: { name: "Authored", durationMonths: 240 },
  });
  assert.throws(
    () =>
      readScenarioMetadata(
        "const SCENARIOS = [{id:12,name:process.env.SECRET,durationMonths:12}];",
      ),
    /literal name/,
  );
});

test("every optional v001 Timeline export resolves in the shipped SDK; missing exports disable only Timeline", () => {
  const native = loadTimelineFunctions();
  assert.deepEqual(Object.keys(native), Object.keys(TIMELINE_DECLARATIONS));
  assert(Object.values(native).every((value) => typeof value === "function"));
  assert.equal(
    loadTimelineFunctions({
      func: () => {
        throw new Error("Old SDK");
      },
    }),
    null,
  );
  const partial = {
    func: (declaration) => {
      if (declaration.includes("AddTimelineEvent"))
        throw new Error("Missing event export");
      return () => {};
    },
  };
  assert.equal(loadTimelineFunctions(partial), null);
});

test("rich presence publishes localized authored scenario/progress tokens only on meaningful changes", () => {
  const { service, calls } = fixture();
  service.setActivity(activity);
  assert(
    calls.some(
      (entry) =>
        entry[0] === "presence" &&
        entry[2] === "steam_display" &&
        entry[3] === "#Status_playingProgress",
    ),
  );
  assert(
    calls.some(
      (entry) =>
        entry[2] === "status" && entry[3] === "The Shale Boom · Year 8 of 20",
    ),
  );
  const count = calls.length;
  service.refresh();
  service.setActivity({ ...activity });
  assert.equal(calls.length, count);
  service.setActivity({ ...activity, year: 9 });
  assert(calls.some((entry) => entry[2] === "year" && entry[3] === "9"));
  service.setActivity({ phase: "menu", timelineEnabled: true });
  for (const key of ["scenario", "year", "total"])
    assert(
      calls.some(
        (entry) =>
          entry[0] === "presence" && entry[2] === key && entry[3] === null,
      ),
    );
  assert(
    calls.some(
      (entry) => entry[2] === "steam_display" && entry[3] === "#Status_menu",
    ),
  );
});

test("all presence phases and authored scenarios have complete bounded localization substitutions", () => {
  const tokens = presenceTokens(SCENARIOS);
  for (const phase of [
    "loading",
    "menu",
    "playing",
    "paused",
    "replay",
    "victory",
    "ended",
  ])
    for (const scenarioId of [...Object.keys(SCENARIOS).map(Number), 99999]) {
      const described = describeActivity({
        ...activity,
        phase,
        scenarioId,
        year: 9999,
        totalYears: 10000,
      });
      assert(tokens[described.keys.steam_display]);
      for (const substitution of tokens[described.keys.steam_display].matchAll(
        /%([a-z]+)%/g,
      ))
        assert(described.keys[substitution[1]]);
      for (const value of Object.values(described.keys))
        assert(Buffer.byteLength(value) < 256);
      if (described.keys.scenario)
        assert(tokens[`#Scenario_${described.keys.scenario}`]);
    }
  assert.match(
    describeActivity({ ...activity, scenarioId: 99999 }).text,
    /^Custom grid/,
  );
});

test("the canonical custom scenario publishes only generic grid presence and recording labels", () => {
  // CUSTOM_SCENARIO_ID is 999 in the domain; it has no authored title in the catalog.
  const { service, calls } = fixture();
  service.setActivity({ ...activity, scenarioId: 999 });
  service.addEvent({ ...event, scenarioId: 999 });
  assert(
    calls.some(
      (entry) =>
        entry[0] === "presence" &&
        entry[2] === "scenario" &&
        entry[3] === "custom",
    ),
  );
  assert(
    calls.some(
      (entry) =>
        entry[0] === "presence" &&
        entry[2] === "status" &&
        entry[3] === "Custom grid · Year 8 of 20",
    ),
  );
  assert(
    calls.some(
      (entry) => entry[0] === "event" && entry[4] === "Custom grid · Year 8",
    ),
  );
  assert.throws(() => validateActivity({ ...activity, scenarioId: -1 }));
  assert.throws(() => validateTimelineEvent({ ...event, scenarioId: -1 }));
});

test("native activity rejects personal text, arbitrary phases, oversized IDs and invalid numbers", () => {
  for (const input of [
    { ...activity, saveName: "Private" },
    { ...activity, phase: "custom-text" },
    { ...activity, timelineEnabled: "yes" },
    { ...activity, year: Infinity },
    { ...activity, totalYears: 0 },
    { ...activity, scenarioId: -1 },
  ])
    assert.throws(() => validateActivity(input));
  for (const input of [
    { ...event, title: "Private" },
    { ...event, kind: "other" },
    { ...event, runId: "private name" },
    { ...event, eventId: "a".repeat(129) },
    { ...event, eventId: "nul\0" },
    { ...event, year: 0 },
  ])
    assert.throws(() => validateTimelineEvent(input));
});

test("v001 Timeline markers use documented icon-first arguments, instantaneous real-time offsets and per-run occurrence dedupe", () => {
  const { service, calls } = fixture();
  service.setActivity(activity);
  for (const kind of ["construction", "blackout", "recovery", "victory"]) {
    const marker = { ...event, kind };
    service.addEvent(marker);
    service.addEvent(marker);
  }
  const events = calls.filter((entry) => entry[0] === "event");
  assert.equal(events.length, 4);
  assert.deepEqual(events[0], [
    "event",
    "timeline",
    "steam_fix",
    "Major construction completed",
    "The Shale Boom · Year 8",
    100,
    0,
    0,
    2,
  ]);
  assert.equal(
    events[3].at(-1),
    3,
    "Victory uses Featured clip priority, not an achievement API",
  );
  assert(
    events.every(
      (entry) =>
        !entry.join(" ").includes(event.runId) &&
        !entry.join(" ").includes(event.eventId),
    ),
  );
  service.addEvent({ ...event, runId: "another-run" });
  service.addEvent({ ...event, eventId: "another-occurrence" });
  assert.equal(calls.filter((entry) => entry[0] === "event").length, 6);
});

test("default-off, offline, unavailable, replay, loading and stale-scenario markers are harmless without backfill", () => {
  for (const phase of ["menu", "loading", "replay"]) {
    const { service, calls } = fixture();
    service.setActivity({ ...activity, phase });
    service.addEvent(event);
    assert.equal(calls.filter((entry) => entry[0] === "event").length, 0);
  }
  const disabled = fixture();
  disabled.service.setActivity({ ...activity, timelineEnabled: false });
  disabled.service.addEvent(event);
  assert(disabled.calls.every((entry) => entry[0] === "presence"));
  const unsupported = fixture({ supported: false });
  unsupported.service.setActivity(activity);
  unsupported.service.addEvent(event);
  assert.equal(unsupported.service.supported, false);
  assert(unsupported.calls.every((entry) => entry[0] === "presence"));
  const offline = fixture({ online: false });
  offline.service.setActivity(activity);
  offline.service.addEvent(event);
  assert.deepEqual(offline.calls, []);
  offline.state.online = true;
  offline.service.refresh();
  assert.equal(offline.calls.filter((entry) => entry[0] === "event").length, 0);
  offline.service.addEvent({ ...event, scenarioId: 101 });
  assert.equal(offline.calls.filter((entry) => entry[0] === "event").length, 0);
  const absent = new SteamService();
  assert.doesNotThrow(() => absent.setActivity(activity));
  assert.doesNotThrow(() => absent.addTimelineEvent(event));
  assert.equal(absent.state().timelineSupported, false);
});

test("Timeline mode tracks loading, gameplay, pause/menu and completion; disabling clears its owned description", () => {
  const { service, calls } = fixture();
  for (const phase of [
    "loading",
    "playing",
    "paused",
    "replay",
    "victory",
    "ended",
    "menu",
  ])
    service.setActivity({ ...activity, phase });
  assert.deepEqual(
    calls.filter((entry) => entry[0] === "mode").map((entry) => entry[2]),
    [4, 1, 3, 1, 3, 3, 3],
  );
  assert(
    calls
      .filter((entry) => entry[0] === "description")
      .every((entry) => entry[3] === 0),
  );
  service.setActivity({ ...activity, timelineEnabled: false });
  assert.deepEqual(calls.at(-1), ["clearDescription", "timeline", 0]);
});

test("Steam UI language falls back to supported English without leaking supplied identifiers", () => {
  const { service, calls } = fixture({ language: "unknown-client-language" });
  service.setActivity(activity);
  service.addEvent(event);
  assert(
    calls.some(
      (entry) =>
        entry[0] === "event" && entry[3] === "Major construction completed",
    ),
  );
});

test("Steam failure and shutdown preserve game flow and forbid later native activity calls", () => {
  const { service, api, timeline, calls } = fixture();
  api.presence = () => {
    throw new Error("Disconnected");
  };
  timeline.event = () => {
    throw new Error("Recording unavailable");
  };
  assert.doesNotThrow(() => service.setActivity(activity));
  assert.doesNotThrow(() => service.addEvent(event));
  service.dispose();
  assert(calls.some((entry) => entry[0] === "clearPresence"));
  assert(calls.some((entry) => entry[0] === "clearDescription"));
  const count = calls.length;
  service.setActivity(activity);
  service.addEvent({ ...event, eventId: "after-exit" });
  service.refresh();
  service.dispose();
  assert.equal(calls.length, count);
  assert.equal(service.supported, false);
});

test("the main Steam service clears owned presence and highlights before SDK shutdown, including offline startup", () => {
  const app = new EventEmitter();
  const service = new SteamService();
  service.initialize(app, { mode: "offline" });
  const calls = [];
  service.activity = { dispose: () => calls.push("activity"), supported: true };
  service.leaderboards = { dispose: () => calls.push("leaderboards") };
  service.dispatcher = { dispose: () => calls.push("dispatcher") };
  service.client = {};
  service.native = { shutdown: () => calls.push("shutdown") };
  app.emit("will-quit");
  assert.deepEqual(calls, [
    "activity",
    "leaderboards",
    "dispatcher",
    "shutdown",
  ]);
  assert.equal(service.state().timelineSupported, false);
  assert.equal(service.state().available, false);
});

test("Timeline dedupe remains bounded and does not evict old IDs to emit duplicates", () => {
  const { service, calls } = fixture();
  service.setActivity(activity);
  for (let index = 0; index <= MAX_TIMELINE_EVENTS; index++)
    service.addEvent({ ...event, eventId: `event-${index}` });
  assert.equal(service.seen.get(event.runId).size, MAX_TIMELINE_EVENTS);
  for (let index = 1; index <= MAX_TIMELINE_RUNS; index++)
    service.addEvent({ ...event, runId: `run-${index}` });
  assert.equal(service.seen.size, MAX_TIMELINE_RUNS);
  const count = calls.length;
  service.addEvent({ ...event, eventId: "event-0" });
  assert.equal(calls.length, count);
});
