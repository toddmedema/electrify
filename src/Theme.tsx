/* tslint:disable:object-literal-sort-keys */

// Shared Material-UI theming
// https://material-ui.com/customization/themes

import {
  blue,
  green,
  grey,
  purple,
  red,
  amber,
  brown,
  yellow,
} from "@mui/material/colors";
import {
  createTheme,
  adaptV4Theme,
  DeprecatedThemeOptions,
} from "@mui/material/styles";

export const fuelColors = {
  Uranium: green[500],
  Coal: grey[900],
  Oil: brown[800],
  Geothermal: red[500],
  "Natural Gas": purple[500],
  Sun: yellow[600],
  Wind: blue[600],
};
export const darkBlack = "0x000000";
export const disabledColor = grey[100];
export const interactiveColor = blue[600];
export const blackoutColor = red[500];
export const demandColor = grey[900];
export const supplyColor = blue[600];
export const temperatureColor = red[500];
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
  } as DeprecatedThemeOptions)
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
