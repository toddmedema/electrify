const { nativeLibraryPath } = require("./steam-native.cjs");

// Valve ISteamUser and ISteamApps flat API. These exports exist in the bundled Steam SDK.
const DECLARATIONS = {
  getTicket:
    "uint32_t SteamAPI_ISteamUser_GetAuthTicketForWebApi(void *, const char *)",
  cancelTicket: "void SteamAPI_ISteamUser_CancelAuthTicket(void *, uint32_t)",
  apps: "void * SteamAPI_SteamApps_v008()",
  getLaunchCommandLine:
    "int SteamAPI_ISteamApps_GetLaunchCommandLine(void *, void *, int)",
};
const TICKET_IDENTITY = "electrify-coop-prod-v2";
const TICKET_CALLBACK = 168;
const LAUNCH_CALLBACK = 1014;
const TICKET_MAX_BYTES = 2560;
const TICKET_HEADER_BYTES = 12;
const INVITE_ARGUMENT = /^--electrify-coop=([A-Za-z0-9_-]{22})$/;

function loadSteamCrossplayFunctions() {
  const library = require("koffi").load(nativeLibraryPath());
  return Object.fromEntries(
    Object.entries(DECLARATIONS).map(([key, declaration]) => [
      key,
      library.func(declaration),
    ]),
  );
}

/** A ticket belongs to one exchange. The handle is cancelled after either outcome. */
async function withSteamWebTicket(
  { api, user, dispatcher, signal, timeoutMs = 8000 },
  exchange,
) {
  if (!user || !dispatcher || dispatcher.stopped || signal?.aborted)
    throw new Error("Steam authentication unavailable");

  const handle = api.getTicket(user, TICKET_IDENTITY);
  if (!handle) throw new Error("Steam ticket unavailable");

  let stop;
  let timeout;
  let abort;
  try {
    const ticket = await new Promise((resolve, reject) => {
      stop = dispatcher.onCallback(TICKET_CALLBACK, (payload) => {
        if (payload.length < 4 || payload.readUInt32LE(0) !== handle) return;
        if (payload.length !== TICKET_HEADER_BYTES + TICKET_MAX_BYTES)
          return reject(new Error("Invalid Steam ticket callback"));
        const code = payload.readInt32LE(4);
        const bytes = payload.readInt32LE(8);
        if (code !== 1 || bytes < 1 || bytes > TICKET_MAX_BYTES)
          return reject(new Error("Steam ticket unavailable"));
        resolve(
          payload
            .subarray(TICKET_HEADER_BYTES, TICKET_HEADER_BYTES + bytes)
            .toString("hex"),
        );
      });
      abort = () => reject(new Error("Steam authentication cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(
        () => reject(new Error("Steam authentication timed out")),
        timeoutMs,
      );
    });
    if (signal?.aborted) throw new Error("Steam authentication cancelled");
    return await exchange(ticket);
  } finally {
    clearTimeout(timeout);
    stop?.();
    if (abort) signal?.removeEventListener("abort", abort);
    if (!dispatcher.stopped) api.cancelTicket(user, handle);
  }
}

function parseSteamInviteArgument(argument) {
  const match = typeof argument === "string" && INVITE_ARGUMENT.exec(argument);
  return match ? match[1] : undefined;
}

/** Accept only Valve's isolated launch parameter. It never becomes an OS command line. */
function observeSteamInvites(api, dispatcher, onInvite) {
  const apps = api.apps();
  if (!apps) return () => {};
  function read() {
    const buffer = Buffer.alloc(128);
    const length = api.getLaunchCommandLine(apps, buffer, buffer.length);
    if (length <= 0 || length >= buffer.length) return;
    const nul = buffer.indexOf(0);
    if (nul !== length && nul !== length - 1) return;
    const token = parseSteamInviteArgument(buffer.toString("utf8", 0, nul));
    if (token) onInvite(token);
  }
  read();
  return dispatcher.onCallback(LAUNCH_CALLBACK, read);
}

module.exports = {
  LAUNCH_CALLBACK,
  TICKET_CALLBACK,
  TICKET_IDENTITY,
  loadSteamCrossplayFunctions,
  observeSteamInvites,
  parseSteamInviteArgument,
  withSteamWebTicket,
};
