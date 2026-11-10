import type { SettingsType } from "../Types";

/** Project shared preferences onto a company without giving it independent TV/audio ownership. */
export function seatPresentation(settings: SettingsType) {
  return {
    theme: settings.theme,
    textSize: settings.textSize,
    units: settings.units,
    tvMode: true,
    tvInset: 0,
    audioEnabled: false,
  } as const;
}
