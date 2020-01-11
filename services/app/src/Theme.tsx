import amber from '@material-ui/core/colors/amber';
import {createMuiTheme} from '@material-ui/core/styles';
import {defaultTheme} from 'shared/Theme';

export default createMuiTheme({
  ...defaultTheme,
  palette: {
    ...defaultTheme.palette,
    type: 'light',
    secondary: amber,
  },
  typography: {
    body1: {
      lineHeight: 1.2,
    },
  },
});
