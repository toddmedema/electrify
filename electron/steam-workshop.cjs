const { nativeLibraryPath } = require("./steam-native.cjs");
const {
  MAX_WORKSHOP_DESCRIPTION_BYTES,
} = require("../src/mods/ModPublication.js");
// SDK 1.60 / ISteamUGC020. Async operations use the app's sole manual dispatcher.
const DECLARATIONS = {
  ugc: "void * SteamAPI_SteamUGC_v020()",
  create: "uint64_t SteamAPI_ISteamUGC_CreateItem(void *, uint32_t, int)",
  start:
    "uint64_t SteamAPI_ISteamUGC_StartItemUpdate(void *, uint32_t, uint64_t)",
  title: "bool SteamAPI_ISteamUGC_SetItemTitle(void *, uint64_t, const char *)",
  description:
    "bool SteamAPI_ISteamUGC_SetItemDescription(void *, uint64_t, const char *)",
  content:
    "bool SteamAPI_ISteamUGC_SetItemContent(void *, uint64_t, const char *)",
  visibility:
    "bool SteamAPI_ISteamUGC_SetItemVisibility(void *, uint64_t, int)",
  submit:
    "uint64_t SteamAPI_ISteamUGC_SubmitItemUpdate(void *, uint64_t, const char *)",
  subscribe: "uint64_t SteamAPI_ISteamUGC_SubscribeItem(void *, uint64_t)",
  unsubscribe: "uint64_t SteamAPI_ISteamUGC_UnsubscribeItem(void *, uint64_t)",
};
// k_UGCUpdateHandleInvalid
const INVALID_UPDATE_HANDLE = 0xffffffffffffffffn;
const CREATE_TIMEOUT_MS = 2 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const UNREACHABLE =
  "Steam couldn't be reached. Check your connection and try again.";
// Common EResult codes from Steam's Workshop calls, in player language.
const RESULT_MESSAGES = {
  3: UNREACHABLE,
  8: "Steam rejected the Workshop item's details.",
  9: "Steam couldn't find that Workshop item.",
  10: "Steam is busy. Try again in a moment.",
  15: "Steam denied access. You can only update Workshop items you own.",
  16: UNREACHABLE,
  17: "Your Steam account can't use Workshop right now.",
  20: "Steam Workshop is temporarily unavailable. Try again later.",
  21: "Sign in to Steam to use Workshop.",
  24: "Your Steam account doesn't have permission to publish Workshop items.",
  25: "Your Steam Workshop storage limit has been reached.",
  84: "Steam is limiting Workshop requests. Wait a few minutes, then try again.",
};
function resultMessage(code) {
  return (
    RESULT_MESSAGES[code] ||
    "Steam Workshop couldn't complete the request. Try again later."
  );
}
function itemId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  )
    throw new Error("Invalid Workshop item ID.");
  return BigInt(value);
}
function validUpdateHandle(handle) {
  try {
    const value = BigInt(handle);
    return value !== 0n && value !== INVALID_UPDATE_HANDLE;
  } catch {
    return false;
  }
}
class SteamWorkshop {
  constructor(steam, appId, api, platform = process.platform) {
    this.steam = steam;
    this.appId = appId;
    this.platform = platform;
    if (!api) {
      const lib = require("koffi").load(nativeLibraryPath());
      api = Object.fromEntries(
        Object.entries(DECLARATIONS).map(([key, signature]) => [
          key,
          lib.func(signature),
        ]),
      );
    }
    this.api = api;
    this.ugc = api.ugc();
    if (!this.ugc) throw new Error("Workshop is unavailable.");
  }
  async result(handle, callback, size, options) {
    if (!this.steam.state().online)
      throw new Error("Connect to Steam to use Workshop.");
    const result = await this.steam.dispatcher.callResult(
      handle,
      { callback, size },
      options,
    );
    const code = result.readInt32LE(0);
    if (code !== 1) throw new Error(resultMessage(code));
    return result;
  }
  async create() {
    const win = this.platform === "win32";
    let result;
    try {
      result = await this.result(
        this.api.create(this.ugc, this.appId, 0),
        3403,
        win ? 24 : 16,
        { timeoutMs: CREATE_TIMEOUT_MS },
      );
    } catch (error) {
      // Steam may still finish creating the item after we stop waiting.
      if (error instanceof Error && /timed out/.test(error.message))
        throw new Error(
          "Steam didn't confirm the new Workshop item in time. Check your Workshop items on Steam before publishing again.",
        );
      throw error;
    }
    return {
      id: result.readBigUInt64LE(win ? 8 : 4).toString(),
      agreement: !!result[win ? 16 : 12],
    };
  }
  /** Uploads one staged package. Visibility is set only on a new item's first upload. */
  async publish(
    id,
    pack,
    directory,
    { setVisibility = false, description = pack.description } = {},
  ) {
    if (
      typeof description !== "string" ||
      Buffer.byteLength(description, "utf8") > MAX_WORKSHOP_DESCRIPTION_BYTES ||
      description.includes("\0")
    )
      throw new Error("Workshop description must fit 7,999 UTF-8 bytes.");
    const handle = this.api.start(this.ugc, this.appId, itemId(id));
    if (
      !validUpdateHandle(handle) ||
      !this.api.title(this.ugc, handle, pack.title) ||
      !this.api.description(this.ugc, handle, description) ||
      !this.api.content(this.ugc, handle, directory) ||
      (setVisibility && !this.api.visibility(this.ugc, handle, 0))
    )
      throw new Error("Workshop upload could not start.");
    const result = await this.result(
      this.api.submit(this.ugc, handle, `Creator version ${pack.version}`),
      3404,
      16,
      { timeoutMs: UPLOAD_TIMEOUT_MS },
    );
    return { id, agreement: !!result[4] };
  }
  async subscription(id, subscribe) {
    await this.result(
      this.api[subscribe ? "subscribe" : "unsubscribe"](this.ugc, itemId(id)),
      subscribe ? 1313 : 1315,
      this.platform === "win32" ? 16 : 12,
    );
  }
  subscribed() {
    return this.steam.client.workshop
      .getSubscribedItems()
      .map((id) => id.toString());
  }
  downloadStatus(id) {
    const state = this.steam.client.workshop.state(itemId(id));
    return state & 16 ? "downloading" : "queued";
  }
  /** Install info for a finished download; otherwise asks Steam to download it and returns null. */
  installedOrQueueDownload(id) {
    const workshop = this.steam.client.workshop;
    const state = workshop.state(itemId(id));
    // Never copy while Steam is writing an update.
    if (!(state & 4) || state & (8 | 16 | 32)) {
      workshop.download(itemId(id), false);
      return null;
    }
    return workshop.installInfo(itemId(id));
  }
}
module.exports = {
  SteamWorkshop,
  itemId,
  resultMessage,
  DECLARATIONS,
  INVALID_UPDATE_HANDLE,
};
