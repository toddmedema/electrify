import {
  grey50,
  lightBlue400,




  deepOrange100, deepOrange700,
  cyan500, cyan700,
  pinkA200,
  grey100, grey300, grey400, grey500,
  white, darkBlack, fullBlack,
} from 'material-ui/styles/colors'
import {fade} from 'material-ui/utils/colorManipulator'
import spacing from 'material-ui/styles/spacing'

const theme: any = {
  spacing: spacing,
  fontFamily: 'LatoLight, sans-serif',
  palette: {
    primary1Color: cyan500,
    primary2Color: cyan700,
    primary3Color: grey400,
    accent1Color: pinkA200,
    accent2Color: grey100,
    accent3Color: grey500,
    textColor: darkBlack,
    alternateTextColor: white,
    canvasColor: white,
    borderColor: grey300,
    disabledColor: fade(darkBlack, 0.3),
    pickerHeaderColor: cyan500,
    clockCircleColor: fade(darkBlack, 0.07),
    shadowColor: fullBlack,
  },
  raisedButton: {
    primaryColor: lightBlue400,
  },
  vw: {
    huge: '12vw',
    large: '6vw',
    base: '2vw',
    small: '1vw',
    tiny: '0.5vw',
  },
  vh: {
    huge: '12vh',
    large: '6vh',
    base: '2vh',
    small: '1vh',
    tiny: '0.5vh',
  },
  icon: {
    width: '0.15in',
    size: '7vw',
    arrowSize: '8vw',
  },
  fontSize: {
    interactive: '5.5vw',
    flavortext: '4.7vw',
    title: '6.2vw',
  },
  card: {
    width: '3in',
    height: '5in',
    contentHeight: '3in',
    footerHeight: '0.4in',
    headerFont: 'CinzelBold, serif',
    fontBoldWeight: 700,
  },
  border: {
    primary: '0.03in solid #000000',
    accent: '0.03in solid #CCCCCC',
    faded: '0.03in solid #777777',
  },
  inlineIcon: {
    width: '5vw',
    marginBottom: '-0.5vw',
  },
};

export default theme;
