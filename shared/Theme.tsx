/* tslint:disable:object-literal-sort-keys */

// Shared Material-UI theming
// https://material-ui.com/customization/themes

import {blue, green, grey, purple, red} from '@material-ui/core/colors';
import {createMuiTheme} from '@material-ui/core/styles';
import {ThemeOptions} from '@material-ui/core/styles/createMuiTheme';

const darkBlack = '0x000000';

export const disabledColor = grey[100];
export const interactiveColor = blue[600];
export const blackoutColor = red[500];
export const demandColor = grey[900];
export const supplyColor = blue[600];
export const uraniumColor = green[500];
export const coalColor = grey[900];
export const naturalGasColor = purple[500];
export const temperatureColor = red[500];
export const windColor = blue[600];

export const defaultTheme = {
  palette: {
    type: 'light',
    primary: {
      light: disabledColor,
      main: supplyColor,
      dark: darkBlack,
      contrastText: grey[100],
    },
  },
  typography: {
    fontSize: 14,
  },
} as ThemeOptions;

export default createMuiTheme(defaultTheme);

export const chartTheme = {
  axis: {
    stroke: 'black',
    strokeWidth: 1,
  },
  tickLabels: {
    fill: `rgba(0, 0, 0, 0.54)`,
    fontWeight: 400,
    fontFamily: `Roboto, "Helvetica Neue", Helvetica, sans-serif`,
  },
};
