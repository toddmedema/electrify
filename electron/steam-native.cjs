const path = require("node:path");
const crypto = require("node:crypto");

// Flat declarations and packing match the SDK shipped by steamworks.js 0.4.0:
// https://github.com/Noxime/steamworks-rs/tree/fbb79635b06b4feea8261e5ca3e8ea3ef42facf9/steamworks-sys/lib/steam/public/steam
// The JS binding does not expose leaderboards. Keep all native pointers in main, and use
// the SDK's documented manual dispatch rather than fabricated steamworks.js methods.
const DECLARATIONS = {
  stats: "void * SteamAPI_SteamUserStats_v012()",
  requestStats: "bool SteamAPI_ISteamUserStats_RequestCurrentStats(void *)",
  getAchievement:
    "bool SteamAPI_ISteamUserStats_GetAchievement(void *, const char *, void *)",
  setAchievement:
    "bool SteamAPI_ISteamUserStats_SetAchievement(void *, const char *)",
  getStat:
    "bool SteamAPI_ISteamUserStats_GetStatInt32(void *, const char *, void *)",
  setStat:
    "bool SteamAPI_ISteamUserStats_SetStatInt32(void *, const char *, int32_t)",
  storeStats: "bool SteamAPI_ISteamUserStats_StoreStats(void *)",
  utils: "void * SteamAPI_SteamUtils_v010()",
  friends: "void * SteamAPI_SteamFriends_v017()",
  user: "void * SteamAPI_SteamUser_v023()",
  online: "bool SteamAPI_ISteamUser_BLoggedOn(void *)",
  presence:
    "bool SteamAPI_ISteamFriends_SetRichPresence(void *, const char *, const char *)",
  clearPresence: "void SteamAPI_ISteamFriends_ClearRichPresence(void *)",
  uiLanguage: "const char * SteamAPI_ISteamUtils_GetSteamUILanguage(void *)",
  persona:
    "const char * SteamAPI_ISteamFriends_GetFriendPersonaName(void *, uint64_t)",
  requestPersona:
    "bool SteamAPI_ISteamFriends_RequestUserInformation(void *, uint64_t, bool)",
  find: "uint64_t SteamAPI_ISteamUserStats_FindOrCreateLeaderboard(void *, const char *, int, int)",
  download:
    "uint64_t SteamAPI_ISteamUserStats_DownloadLeaderboardEntries(void *, uint64_t, int, int, int)",
  entry:
    "bool SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry(void *, uint64_t, int, void *, void *, int)",
  upload:
    "uint64_t SteamAPI_ISteamUserStats_UploadLeaderboardScore(void *, uint64_t, int, int32_t, void *, int)",
  shutdown: "void SteamAPI_Shutdown()",
  pipe: "int SteamAPI_GetHSteamPipe()",
  runFrame: "void SteamAPI_ManualDispatch_RunFrame(int)",
  nextCallback: "bool SteamAPI_ManualDispatch_GetNextCallback(int, void *)",
  freeCallback: "void SteamAPI_ManualDispatch_FreeLastCallback(int)",
  callResult:
    "bool SteamAPI_ManualDispatch_GetAPICallResult(int, uint64_t, void *, int, int, void *)",
};

// The bundled SDK is v001. Its icon-first/void event signature differs from the
// current v004 API. Resolve optional symbols separately so older SDKs stay playable.
const TIMELINE_DECLARATIONS = {
  timeline: "void * SteamAPI_SteamTimeline_v001()",
  mode: "void SteamAPI_ISteamTimeline_SetTimelineGameMode(void *, int)",
  description:
    "void SteamAPI_ISteamTimeline_SetTimelineStateDescription(void *, const char *, float)",
  clearDescription:
    "void SteamAPI_ISteamTimeline_ClearTimelineStateDescription(void *, float)",
  event:
    "void SteamAPI_ISteamTimeline_AddTimelineEvent(void *, const char *, const char *, const char *, uint32_t, float, float, int)",
};

function nativeLibraryPath(platform = process.platform, arch = process.arch) {
  const directory = path.dirname(require.resolve("steamworks.js/package.json"));
  const location = {
    "win32:x64": "dist/win64/steam_api64.dll",
    "linux:x64": "dist/linux64/libsteam_api.so",
    "darwin:x64": "dist/osx/libsteam_api.dylib",
    "darwin:arm64": "dist/osx/libsteam_api.dylib",
  }[`${platform}:${arch}`];
  if (!location)
    throw new Error("This platform does not have a bundled Steam runtime");
  return path
    .join(directory, location)
    .replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
}

function nativeBindingPath(platform = process.platform, arch = process.arch) {
  const directory = path.dirname(require.resolve("steamworks.js/package.json"));
  const location = {
    "win32:x64": "dist/win64/steamworksjs.win32-x64-msvc.node",
    "linux:x64": "dist/linux64/steamworksjs.linux-x64-gnu.node",
    "darwin:x64": "dist/osx/steamworksjs.darwin-x64.node",
    "darwin:arm64": "dist/osx/steamworksjs.darwin-arm64.node",
  }[`${platform}:${arch}`];
  if (!location)
    throw new Error("This platform does not have a bundled Steam binding");
  return path
    .join(directory, location)
    .replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
}

function initializeBinding(appId, binding = require(nativeBindingPath())) {
  // index.init also starts a Rust callback consumer. Own the only dispatch loop instead,
  // or it would consume our leaderboard results and never deliver overlay callback 331.
  binding.init(appId);
  return binding;
}

function loadFunctions() {
  const library = require("koffi").load(nativeLibraryPath());
  return Object.fromEntries(
    Object.entries(DECLARATIONS).map(([key, declaration]) => [
      key,
      library.func(declaration),
    ]),
  );
}

function loadTimelineFunctions(
  library = require("koffi").load(nativeLibraryPath()),
) {
  try {
    return Object.fromEntries(
      Object.entries(TIMELINE_DECLARATIONS).map(([key, declaration]) => [
        key,
        library.func(declaration),
      ]),
    );
  } catch {
    return null;
  }
}

function layouts(platform = process.platform) {
  const large = platform === "win32";
  return {
    find: { size: large ? 16 : 12, callback: 1104 },
    download: { size: large ? 24 : 20, callback: 1105 },
    upload: { size: large ? 32 : 28, callback: 1106 },
    entrySize: large ? 32 : 28,
  };
}

function boardName(selection) {
  const digest = crypto
    .createHash("sha256")
    .update(selection.challengeId)
    .digest("hex")
    .slice(0, 24);
  return `electrify-v${selection.scoreVersion ?? 1}-s${selection.scenarioId}-${selection.difficulty.toLowerCase()}-${digest}`;
}

class SteamLeaderboards {
  constructor(api, dispatcher, platform = process.platform) {
    this.api = api;
    this.dispatcher = dispatcher;
    this.packing = layouts(platform);
    this.stats = api.stats();
    this.utils = api.utils();
    this.friends = api.friends();
    this.user = api.user();
    if (!this.stats || !this.utils || !this.friends || !this.user)
      throw new Error("Steam interfaces are unavailable");
    this.handles = new Map();
    this.queue = Promise.resolve();
  }

  online() {
    return this.api.online(this.user);
  }

  async callResult(handle, layout) {
    if (this.stopped) throw new Error("Steam is shutting down");
    const result = await this.dispatcher.callResult(handle, layout);
    if (this.stopped) throw new Error("Steam is shutting down");
    return result;
  }

  async handle(selection) {
    if (this.stopped) throw new Error("Steam is shutting down");
    const name = boardName(selection);
    if (this.handles.has(name)) return this.handles.get(name);
    const result = await this.callResult(
      this.api.find(this.stats, name, 2, 1),
      this.packing.find,
    );
    const handle = result.readBigUInt64LE(0);
    if (!result[8] || !handle)
      throw new Error("Steam leaderboard is unavailable");
    this.handles.set(name, handle);
    return handle;
  }

  serialize(action) {
    // Steam supports only one outstanding upload and entries are released once read.
    const task = this.queue.catch(() => {}).then(action);
    this.queue = task;
    return task;
  }

  read(selection) {
    return this.serialize(async () => {
      if (
        selection.startRank !== undefined ||
        selection.endRank !== undefined
      ) {
        if (
          selection.scope !== "global" ||
          !Number.isSafeInteger(selection.startRank) ||
          !Number.isSafeInteger(selection.endRank) ||
          selection.startRank < 1 ||
          selection.endRank < selection.startRank ||
          selection.endRank > 2147483647 ||
          selection.endRank - selection.startRank >= 100
        )
          throw new Error("Invalid leaderboard range");
      }
      const handle = await this.handle(selection);
      if (this.stopped) throw new Error("Steam is shutting down");
      const modes = {
        global: [0, selection.startRank ?? 1, selection.endRank ?? 100],
        friends: [2, 0, 0],
        player: [1, 0, 0],
      };
      const mode = modes[selection.scope];
      if (!mode) throw new Error("Invalid leaderboard scope");
      const result = await this.callResult(
        this.api.download(this.stats, handle, ...mode),
        this.packing.download,
      );
      if (this.stopped) throw new Error("Steam is shutting down");
      const entries = result.readBigUInt64LE(8);
      const count = result.readInt32LE(16);
      if (count < 0 || count > 10000)
        throw new Error("Invalid Steam leaderboard response");
      const rows = [];
      for (let index = 0; index < count; index++) {
        const entry = Buffer.alloc(this.packing.entrySize);
        if (!this.api.entry(this.stats, entries, index, entry, null, 0))
          throw new Error("Steam leaderboard entry could not be read");
        const steamId = entry.readBigUInt64LE(0);
        this.api.requestPersona(this.friends, steamId, true);
        rows.push({
          steamId: steamId.toString(),
          displayName:
            this.api.persona(this.friends, steamId) || "Steam player",
          rank: entry.readInt32LE(8),
          score: entry.readInt32LE(12),
          scenarioId: selection.scenarioId,
          difficulty: selection.difficulty,
        });
      }
      return rows;
    });
  }

  upload(selection) {
    return this.serialize(async () => {
      const handle = await this.handle(selection);
      if (this.stopped) throw new Error("Steam is shutting down");
      // Steam score details are int32 slots. Store the ASCII build version as
      // zero-padded bytes; old queued scores can still upload without metadata.
      const details = selection.appVersion
        ? Buffer.alloc(Math.ceil((selection.appVersion.length + 1) / 4) * 4)
        : null;
      if (details) details.write(selection.appVersion, "ascii");
      const result = await this.callResult(
        this.api.upload(
          this.stats,
          handle,
          1,
          selection.score,
          details,
          details ? details.length / 4 : 0,
        ),
        this.packing.upload,
      );
      if (!result[0]) throw new Error("Steam did not accept the score");
    });
  }

  dispose() {
    // Prevent a yielded or queued request from touching native interfaces after SDK shutdown.
    this.stopped = true;
    this.handles.clear();
  }
}

module.exports = {
  DECLARATIONS,
  TIMELINE_DECLARATIONS,
  nativeLibraryPath,
  nativeBindingPath,
  initializeBinding,
  loadFunctions,
  loadTimelineFunctions,
  layouts,
  boardName,
  SteamLeaderboards,
};
