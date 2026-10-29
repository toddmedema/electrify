import uPlot from "uplot";
import {
  getDateFromMinute,
  getSunriseSunset,
  SunriseSunsetType,
} from "../../helpers/DateTime";
import { LocationType } from "../../Types";
import { getTextScale } from "../../TextSize";

export interface DayNightSegment {
  start: number;
  end: number;
  day: boolean;
}

/** Clip each calendar day's solar intervals to the plotted window, including windows
 * crossing midnight and locations whose daylight itself crosses midnight. */
export function dayNightSegments(
  range: [number, number],
  startingYear: number,
  location: LocationType,
): DayNightSegment[] {
  const segments: DayNightSegment[] = [];
  if (range[1] <= range[0]) return segments;
  for (
    let midnight = Math.floor(range[0] / 1440) * 1440;
    midnight < range[1];
    midnight += 1440
  ) {
    const sun = getSunriseSunset(
      getDateFromMinute(midnight, startingYear),
      location,
    );
    const start = Math.max(midnight, range[0]);
    const end = Math.min(midnight + 1440, range[1]);
    const cuts = [start, end];
    if (sun.daylight === "normal") {
      for (const minute of [sun.sunrise, sun.sunset]) {
        const boundary = midnight + minute;
        if (boundary > start && boundary < end) cuts.push(boundary);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const from = cuts[i - 1];
      const to = cuts[i];
      if (from >= to) continue;
      const minute = (from + to) / 2 - midnight;
      const day =
        sun.daylight === "polar-day" ||
        (sun.daylight === "normal" &&
          (sun.sunrise <= sun.sunset
            ? minute >= sun.sunrise && minute < sun.sunset
            : minute >= sun.sunrise || minute < sun.sunset));
      const previous = segments[segments.length - 1];
      if (previous?.day === day && previous.end === from) previous.end = to;
      else segments.push({ start: from, end: to, day });
    }
  }
  return segments;
}

/** A two-hour visual blend centered on each solar boundary. Exact intervals remain
 * available to the accessible description; nearby short phases shorten the blend. */
export function dayNightGradient(
  segments: DayNightSegment[],
  range: [number, number],
): string {
  const color = (day: boolean) => `var(--${day ? "daylight" : "night"}-fill)`;
  if (!segments.length || range[1] <= range[0]) return "none";
  if (segments.length === 1) return color(segments[0].day);
  const stop = (day: boolean, minute: number) =>
    `${color(day)} ${((minute - range[0]) / (range[1] - range[0])) * 100}%`;
  const stops = [stop(segments[0].day, segments[0].start)];
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1];
    const next = segments[i];
    const blend = Math.min(
      60,
      (previous.end - previous.start) / 2,
      (next.end - next.start) / 2,
    );
    stops.push(stop(previous.day, next.start - blend));
    stops.push(stop(next.day, next.start + blend));
  }
  const last = segments[segments.length - 1];
  stops.push(stop(last.day, last.end));
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export function formatClockTime(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = Math.floor(minuteOfDay % 60)
    .toString()
    .padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

export function daylightDescription(sun: SunriseSunsetType): string {
  if (sun.daylight === "polar-day") return "Daylight all day (polar day)";
  if (sun.daylight === "polar-night") return "Night all day (polar night)";
  const daylightMinutes = (sun.sunset - sun.sunrise + 1440) % 1440;
  return [
    `Sunrise: ${formatClockTime(sun.sunrise)}`,
    `Solar noon: ${formatClockTime((sun.sunrise + daylightMinutes / 2) % 1440)}`,
    `Sunset: ${formatClockTime(sun.sunset)}`,
  ].join("\n");
}

export function describeDayNight(segments: DayNightSegment[]): string {
  if (segments.length === 1)
    return `${segments[0].day ? "Daylight" : "Night"} throughout the displayed period`;
  return segments
    .map(
      (segment) =>
        `${segment.day ? "Daylight" : "Night"} from ${formatClockTime(segment.start % 1440)} to ${formatClockTime(segment.end % 1440)}`,
    )
    .join(". ");
}

function phaseIcon(day: boolean): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  const path = document.createElementNS(ns, "path");
  // Small, monochrome sun/crescent silhouettes, consistent on every platform.
  path.setAttribute(
    "d",
    day
      ? "M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.5 1.5m7 7L13 13M3 13l1.5-1.5m7-7L13 3M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0"
      : "M10 2a6 6 0 1 0 4 9A6 6 0 0 1 10 2Z",
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.25");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  icon.appendChild(path);
  return icon;
}

/** Non-interactive footer inside the plot's reserved bottom padding. Its geometry follows
 * uPlot's actual bounds on every resize, rather than the surrounding panel's width. */
export function dayNightRibbonPlugin(
  getState: () => {
    range: [number, number];
    dayNight: DayNightSegment[];
    startingYear: number;
    location: LocationType;
  },
): uPlot.Plugin {
  let ribbon: HTMLDivElement;
  let previousKey = "";
  const textScale = getTextScale();
  return {
    hooks: {
      init: (u) => {
        ribbon = document.createElement("div");
        ribbon.className = "dayNightRibbon";
        ribbon.setAttribute("aria-hidden", "true");
        ribbon.style.height = `${16 * textScale}px`;
        ribbon.style.bottom = `${4 * textScale}px`;
        u.ctx.canvas.parentElement!.appendChild(ribbon);
      },
      draw: (u) => {
        const { range, dayNight, startingYear, location } = getState();
        const width = u.bbox.width / uPlot.pxRatio;
        const left = u.bbox.left / uPlot.pxRatio;
        const key = JSON.stringify([left, width, range, dayNight]);
        if (key === previousKey) return;
        previousKey = key;
        ribbon.style.left = `${left}px`;
        ribbon.style.width = `${width}px`;
        // Include offscreen dawn/dusk so a rolling window never clips a blend at its edge.
        ribbon.style.background = dayNightGradient(
          dayNightSegments(
            [range[0] - 120, range[1] + 120],
            startingYear,
            location,
          ),
          range,
        );
        ribbon.replaceChildren(
          ...dayNight.map((segment) => {
            const span = document.createElement("span");
            const fraction =
              (segment.end - segment.start) / (range[1] - range[0]);
            span.dataset.phase = segment.day ? "day" : "night";
            span.style.width = `${fraction * 100}%`;
            // Preserve short intervals at their true widths; don't squeeze or overlap symbols.
            if (fraction * width >= 24 * textScale) {
              const icon = phaseIcon(segment.day);
              icon.style.width = icon.style.height = `${12 * textScale}px`;
              span.appendChild(icon);
            }
            return span;
          }),
        );
      },
      destroy: () => ribbon.remove(),
    },
  };
}
