import { getDesktop } from "../Desktop";

export const coopRelayUrl =
  (process.env.REACT_APP_DESKTOP === "true" && getDesktop()?.coopRelayUrl) ||
  process.env.REACT_APP_COOP_RELAY_URL;
