const { isUtf8 } = require("node:buffer");
const { nativeLibraryPath } = require("./steam-native.cjs");

const TEXT_INPUT_CALLBACK = 714;
const MAX_TEXT_LENGTH = 2048;
// SteamUtils010 flat ABI; text retrieval must run while handling callback 714.
// https://partner.steamgames.com/doc/api/ISteamUtils#ShowGamepadTextInput
const TEXT_INPUT_DECLARATIONS = {
  utils: "void * SteamAPI_SteamUtils_v010()",
  appId: "uint32_t SteamAPI_ISteamUtils_GetAppID(void *)",
  show: "bool SteamAPI_ISteamUtils_ShowGamepadTextInput(void *, int, int, const char *, uint32_t, const char *)",
  length: "uint32_t SteamAPI_ISteamUtils_GetEnteredGamepadTextLength(void *)",
  text: "bool SteamAPI_ISteamUtils_GetEnteredGamepadTextInput(void *, void *, uint32_t)",
};

function loadTextInputFunctions(
  library = require("koffi").load(nativeLibraryPath()),
) {
  try {
    return Object.fromEntries(
      Object.entries(TEXT_INPUT_DECLARATIONS).map(([key, declaration]) => [
        key,
        library.func(declaration),
      ]),
    );
  } catch {
    return null;
  }
}

function validateTextInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 256 ||
    input.description.includes("\0") ||
    typeof input.text !== "string" ||
    input.text.includes("\0") ||
    !Number.isInteger(input.maxLength) ||
    input.maxLength < 1 ||
    input.maxLength > MAX_TEXT_LENGTH ||
    input.text.length > input.maxLength ||
    typeof input.multiline !== "boolean" ||
    typeof input.password !== "boolean"
  )
    throw new Error("Invalid Steam text input");
  return {
    description: input.description,
    text: input.text,
    maxLength: input.maxLength,
    multiline: input.multiline,
    password: input.password,
  };
}

class SteamTextInput {
  constructor(api, dispatcher, onActiveChanged = () => {}) {
    this.api = api;
    this.onActiveChanged = onActiveChanged;
    this.utils = api?.utils();
    this.appId = this.utils ? api.appId(this.utils) : 0;
    this.stopCallback = dispatcher?.onCallback(TEXT_INPUT_CALLBACK, (payload) =>
      this.dismissed(payload),
    );
  }

  get active() {
    return !!this.pending;
  }

  show(input) {
    const request = validateTextInput(input);
    if (!this.utils || this.stopped || this.pending)
      return Promise.resolve({ status: "unavailable" });
    return new Promise((resolve) => {
      // A lost callback cannot trap controller navigation indefinitely. Stop reopening
      // after a timeout so a late dismissal can never write into another text field.
      const timeout = setTimeout(
        () => {
          this.stopped = true;
          this.finish({ status: "unavailable" });
        },
        5 * 60 * 1000,
      );
      timeout.unref?.();
      this.pending = { resolve, timeout, maxLength: request.maxLength };
      this.onActiveChanged(true);
      try {
        if (
          !this.api.show(
            this.utils,
            request.password ? 1 : 0,
            request.multiline ? 1 : 0,
            request.description,
            request.maxLength,
            request.text,
          )
        )
          this.finish({ status: "unavailable" });
      } catch {
        this.finish({ status: "unavailable" });
      }
    });
  }

  dismissed(payload) {
    if (!this.pending) return;
    try {
      // Older SDKs omit AppID (8 bytes); current callbacks have it at offset8.
      if (payload.length !== 8 && payload.length !== 12)
        throw new Error("Invalid Steam text input dismissal");
      if (payload.length === 12 && payload.readUInt32LE(8) !== this.appId)
        return;
      if (!payload[0]) return this.finish({ status: "cancelled" });
      const maxBytes = this.pending.maxLength * 4 + 1;
      const length = this.api.length(this.utils);
      if (
        payload.readUInt32LE(4) > maxBytes ||
        !Number.isInteger(length) ||
        length < 1 ||
        length > maxBytes
      )
        throw new Error("Steam text input is too long");
      const buffer = Buffer.alloc(length);
      if (!this.api.text(this.utils, buffer, length))
        throw new Error("Steam text input unavailable");
      const end = buffer.indexOf(0);
      if (end < 0 || !isUtf8(buffer.subarray(0, end)))
        throw new Error("Invalid Steam text input encoding");
      const text = buffer.toString("utf8", 0, end);
      if (Array.from(text).length > this.pending.maxLength)
        throw new Error("Steam text input is too long");
      this.finish({ status: "submitted", text });
    } catch {
      this.finish({ status: "unavailable" });
    }
  }

  finish(result) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timeout);
    pending.resolve(result);
    this.onActiveChanged(false);
  }

  dispose() {
    this.stopped = true;
    this.stopCallback?.();
    this.finish({ status: "unavailable" });
  }
}

module.exports = {
  SteamTextInput,
  TEXT_INPUT_CALLBACK,
  TEXT_INPUT_DECLARATIONS,
  loadTextInputFunctions,
  validateTextInput,
};
