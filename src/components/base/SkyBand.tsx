import * as React from "react";
import { EQUATOR_RADIANCE } from "../../Constants";
import { getSunriseSunset } from "../../helpers/DateTime";
import { skyPalette } from "../../Theme";
import { DateType, LocationType, TickPresentFutureType } from "../../Types";

export interface Props {
  date: DateType;
  location: LocationType;
  now: TickPresentFutureType;
  inBlackout: boolean;
}

// How far past the horizon the sky keeps some color, in minutes either side of sun up / sun down.
const TWILIGHT_MINUTES = 60;
// Above this fraction of a straight-up sun the sky has finished turning full daylight blue.
const FULL_DAYLIGHT_ELEVATION = 0.35;

function mix(a: string, b: string, t: number): string {
  const ai = parseInt(a.replace("#", ""), 16);
  const bi = parseInt(b.replace("#", ""), 16);
  const channel = (shift: number) => {
    const av = (ai >> shift) & 255;
    const bv = (bi >> shift) & 255;
    return Math.round(av + (bv - av) * t);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// 0 at the horizon, 1 with the sun straight overhead. A sine across the daylight window is a
// close enough stand-in for real solar elevation, and it matches the shape the solar generators
// are already producing power on, so the sky brightens in step with the panels.
export function sunElevation(
  minuteOfDay: number,
  sunrise: number,
  sunset: number,
): number {
  if (sunset <= sunrise || minuteOfDay < sunrise || minuteOfDay > sunset) {
    return 0;
  }
  return Math.sin((Math.PI * (minuteOfDay - sunrise)) / (sunset - sunrise));
}

// 0 in full dark, 1 right at sunrise / sunset. Only meaningful while the sun is down; it's what
// keeps the band from cutting hard from orange to navy the instant the sun sets.
export function twilightFactor(
  minuteOfDay: number,
  sunrise: number,
  sunset: number,
): number {
  const minutesPastDark = Math.min(
    Math.abs(minuteOfDay - sunrise),
    Math.abs(minuteOfDay - sunset),
  );
  return Math.max(0, 1 - minutesPastDark / TWILIGHT_MINUTES);
}

export default function SkyBand(props: Props) {
  const { date, location, now, inBlackout } = props;

  // SunCalc is comparatively expensive and only moves month to month, so don't pay for it on
  // every 15-minute tick
  const { sunrise, sunset } = React.useMemo(
    () => getSunriseSunset(date, location.lat, location.long),
    [date.month, date.year, location.lat, location.long], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const elevation = sunElevation(date.minuteOfDay, sunrise, sunset);
  const isDay = elevation > 0;

  let top: string;
  let bottom: string;
  if (isDay) {
    const t = Math.min(1, elevation / FULL_DAYLIGHT_ELEVATION);
    top = mix(skyPalette.twilight.top, skyPalette.day.top, t);
    bottom = mix(skyPalette.twilight.bottom, skyPalette.day.bottom, t);
  } else {
    const t = twilightFactor(date.minuteOfDay, sunrise, sunset);
    top = mix(skyPalette.night.top, skyPalette.twilight.top, t);
    bottom = mix(skyPalette.night.bottom, skyPalette.twilight.bottom, t);
  }

  // Cloud cover is only observable while there's sun to block, so hold the last daytime reading
  // through the night rather than showing a clear sky every evening.
  const lastCloudiness = React.useRef(0);
  const clearSkyWM2 = EQUATOR_RADIANCE * elevation;
  if (clearSkyWM2 > 50) {
    lastCloudiness.current = Math.max(
      0,
      Math.min(1, 1 - now.solarIrradianceWM2 / clearSkyWM2),
    );
  }
  const cloudiness = lastCloudiness.current;

  // Faster wind, faster drift. Clamped at both ends so a dead calm doesn't freeze mid-animation
  // and a storm doesn't strobe.
  const windSeconds = Math.max(4, Math.min(40, 320 / Math.max(now.windKph, 8)));

  return (
    <div
      id="skyBand"
      className={inBlackout ? "blackout" : ""}
      aria-hidden="true"
      style={{ background: `linear-gradient(${top}, ${bottom})` }}
    >
      <div className="skyStars" style={{ opacity: isDay ? 0 : 0.5 }} />
      <div
        className="skyClouds"
        style={{
          opacity: 0.15 + cloudiness * 0.55,
          animationDuration: `${windSeconds}s`,
        }}
      />
    </div>
  );
}
