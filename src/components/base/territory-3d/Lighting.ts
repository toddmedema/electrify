import type { MapLighting, RGB, Vec3 } from "./Types";

interface LightingInput {
  minute: number;
  sunrise: number;
  sunset: number;
  daylight: "normal" | "polar-day" | "polar-night";
  dark: boolean;
  cloud?: number;
}
const DAY = 1440;
const wrap = (value: number) => ((value % DAY) + DAY) % DAY;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Visual sky only: all time/daylight inputs come from the simulated calendar. */
export function mapLighting(input: LightingInput): MapLighting {
  const minute = wrap(Number.isFinite(input.minute) ? input.minute : 720);
  const sunrise = Number.isFinite(input.sunrise) ? wrap(input.sunrise) : 360;
  const sunset = Number.isFinite(input.sunset) ? wrap(input.sunset) : 1080;
  const dayLength = wrap(sunset - sunrise) || 720;
  const elapsed = wrap(minute - sunrise);
  const angle =
    elapsed <= dayLength
      ? (elapsed / dayLength) * Math.PI
      : Math.PI + ((elapsed - dayLength) / (DAY - dayLength)) * Math.PI;
  let altitude = Math.sin(angle);
  let horizontal = Math.cos(angle);
  let daylight = smooth((altitude + 0.16) / 0.32);
  if (input.daylight !== "normal") {
    const polarAngle = ((minute - 360) / DAY) * Math.PI * 2;
    horizontal = Math.cos(polarAngle);
    altitude =
      input.daylight === "polar-day"
        ? 0.55 + 0.25 * Math.sin(polarAngle)
        : 0.35 + 0.15 * Math.sin(polarAngle);
    daylight = input.daylight === "polar-day" ? 1 : 0;
  }
  // A continuous, mirrored night arc is a stylized moon, not lunar ephemeris.
  // The key stays above the receiver and on the camera-facing (+Z) side of
  // the board, where the solar panels tilt. Shadows fade at either horizon.
  const direction: Vec3 = [
    horizontal * 0.88,
    Math.max(0.12, Math.abs(altitude)),
    0.38,
  ];
  const length = Math.hypot(...direction);
  const cloud = smooth(((input.cloud ?? 0) - 0.24) / 0.76);
  const moon: RGB = [0.66, 0.78, 1];
  const sun: RGB = [1, 0.95, 0.82];
  return {
    direction: [
      direction[0] / length,
      direction[1] / length,
      direction[2] / length,
    ],
    color: [
      (moon[0] + (sun[0] - moon[0]) * daylight) * (1 - cloud * 0.16),
      (moon[1] + (sun[1] - moon[1]) * daylight) * (1 - cloud * 0.12),
      (moon[2] + (sun[2] - moon[2]) * daylight) * (1 - cloud * 0.05),
    ],
    ambient:
      (input.dark ? 0.3 : 0.46) +
      daylight * (input.dark ? 0.23 : 0.19) +
      cloud * 0.09,
    shadow:
      (0.12 + daylight * 0.13) *
      smooth(Math.abs(altitude) / 0.3) *
      (1 - cloud * 0.65),
  };
}

export function interpolateMapLighting(
  from: MapLighting,
  to: MapLighting,
  fraction: number,
): MapLighting {
  const blend = (start: number, end: number) =>
    start + (end - start) * fraction;
  const vector = (start: Vec3, end: Vec3): Vec3 => [
    blend(start[0], end[0]),
    blend(start[1], end[1]),
    blend(start[2], end[2]),
  ];
  const direction = vector(from.direction, to.direction);
  const length = Math.hypot(...direction);
  return {
    direction: [
      direction[0] / length,
      direction[1] / length,
      direction[2] / length,
    ],
    color: vector(from.color, to.color),
    ambient: blend(from.ambient, to.ambient),
    shadow: blend(from.shadow, to.shadow),
  };
}
