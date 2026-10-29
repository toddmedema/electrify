const { validateActivity, validateTimelineEvent } = require("./runtime.cjs");
const SCENARIOS = require("./steam-localization.cjs");
const { TEXT } = require("./steam-text.cjs");

const MARKERS = {
  construction: {
    title: TEXT.construction,
    icon: "steam_fix",
    priority: 100,
    clip: 2,
  },
  blackout: {
    title: TEXT.blackout,
    icon: "steam_caution",
    priority: 200,
    clip: 2,
  },
  recovery: {
    title: TEXT.recovery,
    icon: "steam_bolt",
    priority: 150,
    clip: 2,
  },
  victory: {
    title: TEXT.victoryMarker,
    icon: "steam_trophy",
    priority: 300,
    clip: 3,
  },
};
const MAX_TIMELINE_RUNS = 64;
const MAX_TIMELINE_EVENTS = 4096;
const LANGUAGES = { english: TEXT };

function describeActivity(activity, textCatalog = TEXT) {
  const scenario = SCENARIOS[activity.scenarioId];
  const scenarioKey = scenario ? String(activity.scenarioId) : "custom";
  const title = scenario?.name || textCatalog.custom;
  if (activity.phase === "menu" || activity.phase === "loading")
    return {
      keys: {
        status: textCatalog[activity.phase],
        steam_display: `#Status_${activity.phase}`,
      },
      text: textCatalog[activity.phase],
    };
  const total =
    activity.totalYears ||
    (scenario && Math.max(1, Math.ceil(scenario.durationMonths / 12)));
  const year = activity.year && total && Math.min(activity.year, total);
  const progress = year
    ? textCatalog.year
        .replace("{year}", String(year))
        .replace("{total}", String(total))
    : textCatalog[activity.phase];
  const text = `${title} · ${progress}${year && activity.phase !== "playing" ? ` · ${textCatalog[activity.phase]}` : ""}`;
  return {
    keys: {
      scenario: scenarioKey,
      ...(year ? { year: String(year), total: String(total) } : {}),
      status: text,
      steam_display: `#Status_${activity.phase}${year ? "Progress" : ""}`,
    },
    text,
  };
}

class SteamActivity {
  constructor(api, timelineApi, online) {
    this.api = api;
    this.online = online;
    this.friends = api.friends();
    this.timelineApi = timelineApi;
    try {
      this.timeline = timelineApi?.timeline() || null;
    } catch {
      this.timeline = null;
    }
    // English is the game's supported language; Steam UI languages without an
    // authored catalog use English. No player-provided text crosses this boundary.
    this.text = TEXT;
    try {
      this.text = LANGUAGES[api.uiLanguage(api.utils())] || TEXT;
    } catch {
      /* English remains available without a client UI language. */
    }
    this.previousKeys = {};
    this.timelineWasEnabled = false;
    this.seen = new Map();
  }

  get supported() {
    return !!this.timeline && !this.stopped;
  }

  setActivity(input) {
    this.current = validateActivity(input);
    this.refresh();
  }

  refresh() {
    if (this.stopped || !this.current) return;
    let online = false;
    try {
      online = this.online();
    } catch {
      /* A disconnected client is an optional feature failure. */
    }
    if (!online) {
      this.lastPresence = undefined;
      this.lastTimeline = undefined;
      return;
    }
    const description = describeActivity(this.current, this.text);
    const key = JSON.stringify(description.keys);
    try {
      if (this.friends && key !== this.lastPresence) {
        // Remove substitutions from the previous phase before publishing the new token.
        for (const previous of Object.keys(this.previousKeys))
          if (!(previous in description.keys))
            this.api.presence(this.friends, previous, null);
        let success = true;
        for (const [name, value] of Object.entries(description.keys))
          if (!this.api.presence(this.friends, name, value)) success = false;
        this.previousKeys = description.keys;
        if (success) this.lastPresence = key;
      }
    } catch {
      // Rich presence failures must never interrupt the game or durable saves.
    }
    if (!this.supported) return;
    const enabled = this.current.timelineEnabled;
    const mode =
      this.current.phase === "loading"
        ? 4
        : this.current.phase === "playing"
          ? 1
          : 3;
    const timelineKey = JSON.stringify([enabled, mode, description.text]);
    if (timelineKey === this.lastTimeline) return;
    try {
      // Turning off markers also clears the optional recording state description.
      if (enabled) {
        this.timelineApi.mode(this.timeline, mode);
        this.timelineApi.description(this.timeline, description.text, 0);
        this.timelineWasEnabled = true;
      } else if (this.timelineWasEnabled) {
        this.timelineApi.clearDescription(this.timeline, 0);
        this.timelineWasEnabled = false;
      }
      this.lastTimeline = timelineKey;
    } catch {
      // An old/disconnected client can lose this optional interface independently.
    }
  }

  addEvent(input) {
    const event = validateTimelineEvent(input);
    if (
      this.stopped ||
      !this.supported ||
      !this.current?.timelineEnabled ||
      ["menu", "loading"].includes(this.current.phase) ||
      this.current.scenarioId !== event.scenarioId
    )
      return;
    try {
      if (!this.online()) return;
    } catch {
      return;
    }
    let seen = this.seen.get(event.runId);
    if (!seen) {
      if (this.seen.size >= MAX_TIMELINE_RUNS) return;
      seen = new Set();
      this.seen.set(event.runId, seen);
    }
    const id = `${event.kind}:${event.eventId}`;
    if (seen.has(id) || seen.size >= MAX_TIMELINE_EVENTS) return;
    seen.add(id);
    const marker = MARKERS[event.kind];
    const scenario = SCENARIOS[event.scenarioId]?.name || TEXT.custom;
    try {
      // Simulation years only describe the moment. Recording offsets/durations are
      // real-time seconds; each marker is instantaneous at the current wall-clock.
      const title =
        this.text[event.kind === "victory" ? "victoryMarker" : event.kind];
      this.timelineApi.event(
        this.timeline,
        marker.icon,
        title,
        `${scenario} · Year ${event.year}`,
        marker.priority,
        0,
        0,
        marker.clip,
      );
    } catch {
      // No queue/backfill: offline or failed markers must not land at a later moment.
    }
  }

  dispose() {
    if (this.stopped) return;
    try {
      if (this.friends) this.api.clearPresence(this.friends);
    } catch {
      /* Exiting with an unavailable Steam client is harmless. */
    }
    try {
      if (this.timeline && this.timelineWasEnabled)
        this.timelineApi.clearDescription(this.timeline, 0);
    } catch {
      /* Optional recording interface can disappear independently. */
    }
    this.stopped = true;
    this.seen.clear();
  }
}

module.exports = {
  SteamActivity,
  describeActivity,
  MAX_TIMELINE_RUNS,
  MAX_TIMELINE_EVENTS,
};
