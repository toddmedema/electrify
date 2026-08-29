/* tslint:disable:object-literal-sort-keys */

// Shared Material-UI theming
// https://material-ui.com/customization/themes

import { blue, green, grey, red, amber } from "@mui/material/colors";
import { createTheme, Theme } from "@mui/material/styles";
import {
  DemandTypeNameType,
  FuelNameType,
  ThemeChoiceType,
  ThemeModeType,
} from "./Types";

/**
 * The game's two palettes.
 *
 * The charts draw to a canvas rather than to the DOM, so the custom properties app.scss switches
 * on are no use to them: every colour they paint with has to be looked up in JavaScript, at the
 * moment the plot is built. That is what this module is - the same light/dark split app.scss
 * makes, in the form uPlot can read.
 *
 * Dark is not light inverted. A series tuned to clear 3:1 against a white plot area is often
 * invisible against a near-black one - Coal at #1a1a1a most of all - so each one moves up its own
 * ramp far enough to clear the same bar against the dark plot surface, keeping the luminance
 * spread that lets four lines on one chart be told apart.
 */

// Nine series can never all clear WCAG's 3:1 non-text contrast against each other - the
// luminance ladder runs out at about four - so these are tuned for two things that are achievable:
// every fuel clears 3:1 against the plot area, and the pairs that share a line chart
// (the four priced fuels) are spread as far apart in luminance as that constraint allows.
// Where color still can't carry it alone, the charts add a second channel: stacked bands with
// direct labels in Supply by Fuel, dash patterns and end-of-line labels in Fuel Prices.
// Uranium is teal rather than green so that no series pairs red with green.
const FUEL_COLORS: { [mode in ThemeModeType]: { [fuel: string]: string } } = {
  light: {
    Coal: "#1a1a1a", // 17.4:1 on white
    Biomass: "#356b20",
    Uranium: "#0f5b63", // 7.8:1
    Oil: "#ac4e13", // 5.5:1
    "Natural Gas": "#bb79e6", // 3.0:1
    Sun: "#a87817", // 3.9:1
    Wind: "#193f79", // 10.4:1
    "Offshore Wind": "#0097a7", // 3.5:1 on white, 3.0:1 against Wind
    Geothermal: "#531834", // 13.6:1
    Hydro: "#006b54",
  },
  dark: {
    Coal: "#d0d0d0", // 11.8:1 on #0f161f - the darkest fuel has to become the lightest
    Biomass: "#9ccc65",
    Uranium: "#4dd0e1", // 9.9:1
    Oil: "#ffa726", // 10.6:1
    "Natural Gas": "#ce93d8", // 7.7:1
    Sun: "#ffd54f", // 13.6:1
    Wind: "#64b5f6", // 8.0:1
    "Offshore Wind": "#006e75", // 3.0:1 on #0f161f, 2.7:1 against Wind
    Geothermal: "#f48fb1", // 8.7:1
    Hydro: "#66d9b7",
  },
};

/** The fuel colours for the palette in use. */
export function fuelColors(): { [fuel: string]: string } {
  return FUEL_COLORS[currentMode];
}

const DEMAND_TYPE_COLORS: Record<
  ThemeModeType,
  Record<DemandTypeNameType, string>
> = {
  light: {
    Residential: "#1565c0",
    Commercial: "#6a1b9a",
    Industrial: "#8d4b20",
    Transportation: "#2e7d32",
    "Data centers": "#c62828",
  },
  dark: {
    Residential: "#64b5f6",
    Commercial: "#ce93d8",
    Industrial: "#d7a86e",
    Transportation: "#81c784",
    "Data centers": "#ef9a9a",
  },
};

/** Colors shared by the demand-by-type chart and its DOM legend. */
export function demandTypeColors(): Record<DemandTypeNameType, string> {
  return DEMAND_TYPE_COLORS[currentMode];
}

/** One fuel's colour, or the storage colour for a facility that burns nothing. */
export function facilityColor(fuel?: FuelNameType): string {
  return (fuel && fuelColors()[fuel]) || chartPalette().storage;
}

// Second encoding channel for the fuel price chart, where the lines overlap and color alone
// can't separate four series. Ordered to match the drawing order of the lines. Unlike colour,
// a dash pattern reads the same on either palette.
export const fuelDashArrays = {
  Coal: undefined, // solid
  Biomass: "12,3",
  "Natural Gas": "6,3",
  Oil: "2,3",
  Uranium: "9,3,2,3",
};

interface ChartPaletteType {
  /** Facilities that burn or catch nothing, which borrow the battery UI's blue */
  storage: string;
  demand: string;
  supply: string;
  /** The wash under the supply line marking history vs. forecast on the Facilities chart */
  historicFill: string;
  blackout: string;
  temperature: string;
  /** The temperature line's punch is too thin for the axis labels naming it */
  temperatureAxis: string;
  wind: string;
  offshoreWind: string;
  precipitation: string;
  snowpack: string;
  reservoir: string;
  /** Hover crosshair, lighter than the data it crosses */
  cursor: string;
  /** A trend line on offer rather than being read: the unselected metric tiles */
  muted: string;
  /** Baselines around the plot. Kept quieter than titles and data. */
  axis: string;
  tickLabel: string;
  grid: string;
  tick: string;
  legendText: string;
  /** What the interactive blue is on this palette, for the bits of chrome that aren't MUI's */
  interactive: string;
  /** The plot surface, for decorations that have to read as a gap rather than a line */
  background: string;
}

const CHART_PALETTES: { [mode in ThemeModeType]: ChartPaletteType } = {
  light: {
    storage: blue[800],
    demand: grey[900],
    supply: blue[600],
    historicFill: blue[50],
    blackout: red[800], // darker than red[500] so the translucent band reads on white
    temperature: red[500],
    temperatureAxis: red[800],
    // The weather chart draws wind in the same blue the wind generators are drawn in
    wind: FUEL_COLORS.light.Wind,
    offshoreWind: FUEL_COLORS.light["Offshore Wind"],
    precipitation: blue[400],
    snowpack: "#6d4c9a",
    reservoir: FUEL_COLORS.light.Hydro,
    cursor: grey[600],
    muted: grey[600],
    axis: "black",
    tickLabel: "rgba(0, 0, 0, 0.54)",
    grid: "#ECEFF1", // VictoryTheme.material's, which these charts inherited
    tick: "#90A4AE",
    legendText: "#252525",
    // blue600 misses 4.5:1 for the small link/button text used throughout the app.
    interactive: blue[800],
    background: "#ffffff",
  },
  dark: {
    storage: blue[300],
    // Near-white demand used to glare against the plot and visually overpower supply. This
    // cooler off-white still clears 13:1 while behaving like a peer rather than a highlight.
    demand: "#dce6f0",
    supply: "#6ab8f7",
    // Blue50 solid, as light uses, reads as a near-white glare on a near-black plot; a faint
    // tint of the supply line itself keeps the wash subtle enough for both lines to read over it
    historicFill: withAlpha("#6ab8f7", 0.12),
    blackout: "#ff6b6b",
    temperature: "#ff8a80",
    temperatureAxis: "#ff8a80",
    wind: FUEL_COLORS.dark.Wind,
    offshoreWind: FUEL_COLORS.dark["Offshore Wind"],
    precipitation: blue[300],
    snowpack: "#ce93d8",
    reservoir: FUEL_COLORS.dark.Hydro,
    cursor: "#7f91a6",
    muted: "#718094",
    axis: "#526173",
    tickLabel: "#9aa9ba",
    // Solid, low-contrast rules give the eye a scale without putting graph paper behind the data.
    grid: "rgba(148, 163, 184, 0.13)",
    tick: "rgba(148, 163, 184, 0.34)",
    legendText: "#dce6f0",
    interactive: "#6ab8f7",
    background: "#0f161f",
  },
};

/** Every colour the charts paint with, for the palette in use. */
export function chartPalette(): ChartPaletteType {
  return CHART_PALETTES[currentMode];
}

// Tints a palette hex for use as a backdrop behind list text, where the full-strength color
// would swamp the label sitting on top of it.
export function withAlpha(hex: string, alpha: number): string {
  const int = parseInt(hex.replace("#", ""), 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// What contained primary buttons darken to on hover. MUI passes this straight into a CSS custom
// property, so it has to be a real CSS color: an invalid one drops the background to transparent
// and leaves the light contrastText label sitting unreadable on the page behind it. blue800 also
// clears 4.5:1 against that label, so hovering is the more legible of the two states.
export const primaryDarkColor = blue[800];
export const disabledColor = grey[100];

/**
 * Which palette everything above is answering for.
 *
 * A module-level value rather than a React context because the things that read it are canvas
 * painters and plugin callbacks reached from inside uPlot, none of which are components. The
 * subscription below is what gets them repainted: a plot's options are built once and then fed
 * with data, so a chart has to be told to rebuild when the palette changes under it.
 */
let currentMode: ThemeModeType = "light";
let themeVersion = 0;
const THEME_EVENT = "electrify-theme";

export function getThemeMode(): ThemeModeType {
  return currentMode;
}

export function setThemeMode(mode: ThemeModeType) {
  if (mode === currentMode) {
    return;
  }
  currentMode = mode;
  themeVersion++;
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Bumped on every palette change, for the charts to rebuild against. */
export function getThemeVersion(): number {
  return themeVersion;
}

export function subscribeThemeMode(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/**
 * The MUI theme for a palette. Cached per mode: MUI rebuilds every component's styles whenever
 * it is handed a theme object it hasn't seen, which is not something a re-render should cost.
 */
const muiThemes: { [mode in ThemeModeType]?: Theme } = {};

export function createAppTheme(mode: ThemeModeType): Theme {
  const cached = muiThemes[mode];
  if (cached) {
    return cached;
  }
  const palette = CHART_PALETTES[mode];
  const built = createTheme({
    palette: {
      mode,
      primary: {
        light: mode === "dark" ? blue[200] : disabledColor,
        main: palette.interactive,
        dark: mode === "dark" ? blue[400] : primaryDarkColor,
        // Dark's primary is a pale blue, so the label on a filled button is the page behind it
        contrastText: mode === "dark" ? "#0a0a0a" : grey[100],
      },
      secondary: amber,
      success: { main: mode === "dark" ? green[400] : green[800] },
      error: { main: mode === "dark" ? red[400] : red[800] },
      // Kept in step with --bg-primary in app.scss, which paints everything MUI doesn't
      background:
        mode === "dark"
          ? { default: "#0b1016", paper: "#111820" }
          : { default: "#ffffff", paper: "#ffffff" },
    },
    typography: {
      fontSize: 15,
      body1: {
        lineHeight: 1.35,
      },
    },
    shape: {
      borderRadius: 6,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            minHeight: 40,
            fontWeight: 600,
            textTransform: "none",
            touchAction: "manipulation",
          },
        },
      },
      MuiButtonBase: {
        defaultProps: {
          disableRipple: false,
        },
      },
      // MUI's dark-mode elevation overlay muddies the deliberately layered charcoal surfaces.
      // Shadows and borders already communicate elevation, so keep paper on its authored colour.
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
    },
  });
  muiThemes[mode] = built;
  return built;
}

export default createAppTheme("light");

// In the order the settings screen lists them
export const THEME_CHOICES: ThemeChoiceType[] = ["system", "light", "dark"];

export const THEME_LABELS: { [choice in ThemeChoiceType]: string } = {
  system: "Match my system",
  light: "Light",
  dark: "Dark",
};

/** What the OS is asking for, and false anywhere that can't be asked (jsdom, old browsers). */
export function prefersDarkMode(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** The palette a choice resolves to right now. */
export function resolveThemeMode(choice: ThemeChoiceType): ThemeModeType {
  if (choice === "system") {
    return prefersDarkMode() ? "dark" : "light";
  }
  return choice;
}
