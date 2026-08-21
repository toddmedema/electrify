/* tslint:disable:object-literal-sort-keys */

// Shared Material-UI theming
// https://material-ui.com/customization/themes

import { blue, grey, red, amber } from "@mui/material/colors";
import {
  createTheme,
  adaptV4Theme,
  DeprecatedThemeOptions,
} from "@mui/material/styles";

// Seven series can never all clear WCAG's 3:1 non-text contrast against each other - the
// luminance ladder runs out at about four - so these are tuned for two things that are achievable:
// every fuel clears 3:1 against the white plot area, and the pairs that share a line chart
// (the four priced fuels) are spread as far apart in luminance as that constraint allows.
// Where color still can't carry it alone, the charts add a second channel: stacked bands with
// direct labels in Supply by Fuel, dash patterns and end-of-line labels in Fuel Prices.
// Uranium is teal rather than green so that no series pairs red with green.
export const fuelColors = {
  Coal: "#1a1a1a", // 17.4:1 on white
  Uranium: "#0f5b63", // 7.8:1
  Oil: "#ac4e13", // 5.5:1
  "Natural Gas": "#bb79e6", // 3.0:1
  Sun: "#a87817", // 3.9:1
  Wind: "#193f79", // 10.4:1
  Geothermal: "#531834", // 13.6:1
};

// Second encoding channel for the fuel price chart, where the lines overlap and color alone
// can't separate four series. Ordered to match the drawing order of the lines.
export const fuelDashArrays = {
  Coal: undefined, // solid
  "Natural Gas": "6,3",
  Oil: "2,3",
  Uranium: "9,3,2,3",
};
export const darkBlack = "0x000000";
export const disabledColor = grey[100];
export const interactiveColor = blue[600];
export const blackoutColor = red[800]; // darker than red[500] so the translucent band reads on white
export const demandColor = grey[900];
export const supplyColor = blue[600];
export const temperatureColor = red[500];
export const cursorColor = grey[600]; // hover crosshair, lighter than the data it crosses
export const windColor = fuelColors.Wind; // for weather forecasts

export default createTheme(
  adaptV4Theme({
    palette: {
      mode: "light",
      primary: {
        light: disabledColor,
        main: supplyColor,
        dark: darkBlack,
        contrastText: grey[100],
      },
      secondary: amber,
    },
    typography: {
      fontSize: 14,
      body1: {
        lineHeight: 1.2,
      },
    },
  } as DeprecatedThemeOptions),
);

export const chartTheme = {
  axis: {
    stroke: "black",
    strokeWidth: 1,
  },
  tickLabels: {
    fill: `rgba(0, 0, 0, 0.54)`,
    fontWeight: 400,
    fontFamily: `Roboto, "Helvetica Neue", Helvetica, sans-serif`,
  },
};
