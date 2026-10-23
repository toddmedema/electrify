/**
 * Sunrise, sunset and solar altitude, ported from suncalc 2.0.1 onto helpers/Libm so the daylight
 * the simulation runs on is the same on every machine (suncalc itself calls the platform's
 * `Math`). Only the sunrise and sunset pair is computed; the arithmetic is otherwise unchanged.
 *
 * Copyright (c) 2026, Volodymyr Agafonkin. All rights reserved. Redistribution and use in source
 * and binary forms, with or without modification, are permitted provided that redistributions
 * retain this copyright notice, this list of conditions and the following disclaimer. THIS
 * SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES ARE DISCLAIMED.
 */
import { acos, asin, atan2, cos, sin, tan } from "./Libm";

const PI = Math.PI;
const rad = PI / 180;
const dayMs = 1e3 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 9e-4;
// Sunrise and sunset: the top of the sun's disc at the horizon, seen from sea level
const SUNRISE_ANGLE = -0.833;

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * dayMs);
}

function toDays(date: Date): number {
  return date.valueOf() / dayMs - 0.5 + J1970 - J2000;
}

function deltaT(d: number): number {
  const y = 2e3 + d / 365.2425;
  let t: number;
  if (y < 1920) {
    t = y - 1900;
    return (
      -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 197e-6)))
    );
  }
  if (y < 1941) {
    t = y - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936));
  }
  if (y < 1961) {
    t = y - 1950;
    return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547));
  }
  if (y < 1986) {
    t = y - 1975;
    return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718));
  }
  if (y < 2005) {
    t = y - 2e3;
    return (
      63.86 +
      t *
        (0.3345 +
          t * (-0.060374 + t * (0.0017275 + t * (651814e-9 + t * 2373599e-11))))
    );
  }
  if (y < 2050) {
    t = y - 2e3;
    return 62.92 + t * (0.32217 + t * 0.005589);
  }
  t = (y - 1820) / 100;
  return -20 + 32 * t * t - 0.5628 * (2150 - y);
}

function toDaysTT(d: number): number {
  return d + deltaT(d) / 86400;
}

function altitude(H: number, phi: number, dec: number): number {
  return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
}

function siderealTime(d: number, lw: number): number {
  return rad * (280.46061837 + 360.98564736629 * d) - lw;
}

function astroRefraction(h: number): number {
  if (h < 0) h = 0;
  return 2967e-7 / tan(h + 0.00312536 / (h + 0.08901179));
}

function sunCoords(d: number): { ra: number; dec: number } {
  const t = d / 36525;
  const L0 = rad * (280.46646 + t * (36000.76983 + t * 3032e-7));
  const M = rad * (357.52911 + t * (35999.05029 - t * 1537e-7));
  const sinM = sin(M);
  const cosM = cos(M);
  const C =
    rad *
    ((1.914602 - t * (0.004817 + t * 14e-6)) * sinM +
      (0.019993 - 101e-6 * t) * 2 * sinM * cosM +
      289e-6 * sinM * (3 - 4 * sinM * sinM));
  const Om = rad * (125.04 - 1934.136 * t);
  const L = L0 + C - rad * (0.00569 + 0.00478 * sin(Om));
  const e =
    rad * (23.439291 - t * (0.0130042 + t * (16e-8 - t * 504e-9))) +
    rad * 0.00256 * cos(Om);
  return {
    ra: atan2(cos(e) * sin(L), cos(L)),
    dec: asin(sin(e) * sin(L)),
  };
}

function wrapPi(a: number): number {
  return a - 2 * PI * Math.round(a / (2 * PI));
}

function solarTransit(dt: number, lw: number): number {
  for (let i = 0; i < 3; i++) {
    const H = wrapPi(siderealTime(dt, lw) - sunCoords(toDaysTT(dt)).ra);
    dt -= H / (2 * PI);
  }
  return dt;
}

function getSetJ(
  h0: number,
  dt: number,
  sign: number,
  lw: number,
  phi: number,
  decT: number,
): number {
  const cosH0 = (sin(h0) - sin(phi) * sin(decT)) / (cos(phi) * cos(decT));
  if (cosH0 < -1 || cosH0 > 1) return NaN;
  let d = dt + (sign * acos(cosH0)) / (2 * PI);
  for (let i = 0; i < 2; i++) {
    const c = sunCoords(toDaysTT(d));
    const H = wrapPi(siderealTime(d, lw) - c.ra);
    const h = altitude(H, phi, c.dec);
    const sinH = cos(phi) * cos(c.dec) * sin(H);
    if (Math.abs(sinH) < 1e-6) break;
    d += (h - h0) / (2 * PI * sinH);
  }
  return d;
}

/** The sun's altitude above the horizon in degrees, with atmospheric refraction. */
export function getSunAltitude(date: Date, lat: number, lng: number): number {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const c = sunCoords(toDaysTT(d));
  const H = siderealTime(d, lw) - c.ra;
  const h = altitude(H, phi, c.dec);
  return (h + astroRefraction(h)) / rad;
}

/** Sunrise and sunset on the day of `date`, or null during a polar day or night. */
export function getSunriseSunsetTimes(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: Date | null; sunset: Date | null } {
  const lw = rad * -lng;
  const phi = rad * lat;
  const dt = solarTransit(
    Math.round(Math.round(toDays(date)) - J0 - lw / (2 * PI)) +
      J0 +
      lw / (2 * PI),
    lw,
  );
  const dec = sunCoords(toDaysTT(dt)).dec;
  const h0 = SUNRISE_ANGLE * rad;
  const jrise = getSetJ(h0, dt, -1, lw, phi, dec);
  const jset = getSetJ(h0, dt, 1, lw, phi, dec);
  return {
    sunrise: Number.isNaN(jrise) ? null : fromJulian(jrise + J2000),
    sunset: Number.isNaN(jset) ? null : fromJulian(jset + J2000),
  };
}
