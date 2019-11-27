/* tslint:disable:object-literal-sort-keys */

// Shared Material-UI theming
// https://material-ui.com/customization/themes

import blue from '@material-ui/core/colors/blue';
import grey from '@material-ui/core/colors/grey';
import red from '@material-ui/core/colors/red';
import {createMuiTheme} from '@material-ui/core/styles';
import {ThemeOptions} from '@material-ui/core/styles/createMuiTheme';

const darkBlack = '0x000000';

export const blackoutColor = red[500];
export const demandColor = grey[900];
export const supplyColor = blue[600];

export const defaultTheme = {
  palette: {
    type: 'light',
    primary: {
      light: grey[100],
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
