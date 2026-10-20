const { nativeLibraryPath } = require("./steam-native.cjs");
// SDK 1.60 / ISteamUGC020. Async operations use the app's sole manual dispatcher.
const DECLARATIONS = {
  ugc: "void * SteamAPI_SteamUGC_v020()",
  create: "uint64_t SteamAPI_ISteamUGC_CreateItem(void *, uint32_t, int)",
  start:
    "uint64_t SteamAPI_ISteamUGC_StartItemUpdate(void *, uint32_t, uint64_t)",
  title: "bool SteamAPI_ISteamUGC_SetItemTitle(void *, uint64_t, const char *)",
  content:
    "bool SteamAPI_ISteamUGC_SetItemContent(void *, uint64_t, const char *)",
  visibility:
    "bool SteamAPI_ISteamUGC_SetItemVisibility(void *, uint64_t, int)",
  submit:
    "uint64_t SteamAPI_ISteamUGC_SubmitItemUpdate(void *, uint64_t, const char *)",
  subscribe: "uint64_t SteamAPI_ISteamUGC_SubscribeItem(void *, uint64_t)",
  unsubscribe: "uint64_t SteamAPI_ISteamUGC_UnsubscribeItem(void *, uint64_t)",
};
function itemId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  )
    throw new Error("Invalid Workshop item ID.");
  return BigInt(value);
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
  async result(handle, callback, size, timeoutMs) {
    if (!this.steam.state().online)
      throw new Error("Connect to Steam to use Workshop.");
    const result = await this.steam.dispatcher.callResult(handle, {
      callback,
      size,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (result.readInt32LE(0) !== 1)
      throw new Error(`Workshop request failed (${result.readInt32LE(0)}).`);
    return result;
  }
  async create() {
    const win = this.platform === "win32";
    const result = await this.result(
      this.api.create(this.ugc, this.appId, 0),
      3403,
      win ? 24 : 16,
    );
    return {
      id: result.readBigUInt64LE(win ? 8 : 4).toString(),
      agreement: !!result[win ? 16 : 12],
    };
  }
  async publish(id, pack, directory) {
    const handle = this.api.start(this.ugc, this.appId, itemId(id));
    if (
      !handle ||
      !this.api.title(this.ugc, handle, pack.title) ||
      !this.api.content(this.ugc, handle, directory) ||
      !this.api.visibility(this.ugc, handle, 0)
    )
      throw new Error("Workshop upload could not start.");
    const result = await this.result(
      this.api.submit(this.ugc, handle, `Creator version ${pack.version}`),
      3404,
      16,
      10 * 60 * 1000,
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
  installed(id) {
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
module.exports = { SteamWorkshop, itemId, DECLARATIONS };
