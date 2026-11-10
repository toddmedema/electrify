const { nativeLibraryPath } = require("./steam-native.cjs");

// Match the SDK bundled with steamworks.js 0.4.0. The Deck query in Utils010
// predates IsRunningOnSteamHardware; it remains the supported query in this SDK.
// https://partner.steamgames.com/doc/api/ISteamUtils#IsSteamInBigPictureMode
// https://partner.steamgames.com/doc/api/ISteamRemotePlay#GetSessionClientFormFactor
const PRESENTATION_DECLARATIONS = {
  utils: "void * SteamAPI_SteamUtils_v010()",
  bigPicture: "bool SteamAPI_ISteamUtils_IsSteamInBigPictureMode(void *)",
  steamDeck: "bool SteamAPI_ISteamUtils_IsSteamRunningOnSteamDeck(void *)",
  remotePlay: "void * SteamAPI_SteamRemotePlay_v002()",
  sessionCount: "uint32_t SteamAPI_ISteamRemotePlay_GetSessionCount(void *)",
  sessionId: "uint32_t SteamAPI_ISteamRemotePlay_GetSessionID(void *, int)",
  formFactor:
    "int SteamAPI_ISteamRemotePlay_GetSessionClientFormFactor(void *, uint32_t)",
};
const TV_FORM_FACTOR = 4;

function loadPresentationFunctions(library) {
  try {
    library ||= require("koffi").load(nativeLibraryPath());
    // Each signal is optional. Losing Remote Play must not disable Big Picture,
    // and an unknown Deck identity must never be treated as a desktop PC.
    return Object.fromEntries(
      Object.entries(PRESENTATION_DECLARATIONS).flatMap(
        ([key, declaration]) => {
          try {
            return [[key, library.func(declaration)]];
          } catch {
            return [];
          }
        },
      ),
    );
  } catch {
    return null;
  }
}

function optionalRead(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Read-only hints; choosing a presentation is always the player's decision. */
function steamPresentation(api) {
  const utils = optionalRead(() => api.utils());
  return {
    bigPicture: utils ? optionalRead(() => api.bigPicture(utils)) : undefined,
    steamDeck: utils ? optionalRead(() => api.steamDeck(utils)) : undefined,
    remotePlayTv: optionalRead(() => {
      const remote = api.remotePlay();
      if (!remote) return undefined;
      const count = api.sessionCount(remote);
      for (let index = 0; index < count; index++) {
        const id = api.sessionId(remote, index);
        if (id && api.formFactor(remote, id) === TV_FORM_FACTOR) return true;
      }
      return false;
    }),
  };
}

module.exports = {
  PRESENTATION_DECLARATIONS,
  loadPresentationFunctions,
  steamPresentation,
};
