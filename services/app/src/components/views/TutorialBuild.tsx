import Button from '@material-ui/core/Button';
import MobileStepper from '@material-ui/core/MobileStepper';
import Typography from '@material-ui/core/Typography';
import KeyboardArrowLeft from '@material-ui/icons/KeyboardArrowLeft';
import KeyboardArrowRight from '@material-ui/icons/KeyboardArrowRight';
import * as React from 'react';
import SwipeableViews from 'react-swipeable-views';
import Chart from '../base/Chart';

export interface StateProps {
}

export interface DispatchProps {
  onPrevious: () => any;
  onNext: () => any;
}

export interface Props extends StateProps, DispatchProps {}

const forecastGood = [
  {hour: 1, supply: 13000, demand: 11500},
  {hour: 2, supply: 13000, demand: 11400},
  {hour: 3, supply: 13000, demand: 12000},
  {hour: 4, supply: 13000, demand: 11800},
  {hour: 5, supply: 13000, demand: 12100},
  {hour: 6, supply: 13200, demand: 12850},
  {hour: 7, supply: 14000, demand: 13600},
  {hour: 8, supply: 15000, demand: 14700},
  {hour: 9, supply: 16000, demand: 15800},
  {hour: 10, supply: 16400, demand: 16000},
  {hour: 11, supply: 16300, demand: 15700},
  {hour: 12, supply: 16800, demand: 15800},
  {hour: 13, supply: 16600, demand: 15600},
  {hour: 14, supply: 17400, demand: 15500},
  {hour: 15, supply: 16200, demand: 15600},
  {hour: 16, supply: 16400, demand: 15900},
  {hour: 17, supply: 15500, demand: 15400},
  {hour: 18, supply: 14500, demand: 14000},
  {hour: 19, supply: 13200, demand: 12950},
  {hour: 20, supply: 13000, demand: 12900},
  {hour: 21, supply: 13000, demand: 12800},
  {hour: 22, supply: 13000, demand: 12700},
  {hour: 23, supply: 13000, demand: 12000},
  {hour: 24, supply: 13000, demand: 11500},
];

const forecastShortBlackout = [
  {hour: 1, supply: 13000, demand: 11500},
  {hour: 2, supply: 13000, demand: 11400},
  {hour: 3, supply: 13000, demand: 12000},
  {hour: 4, supply: 13000, demand: 11800},
  {hour: 5, supply: 13000, demand: 12100},
  {hour: 6, supply: 13000, demand: 12900},
  {hour: 7, supply: 14000, demand: 13600},
  {hour: 8, supply: 15000, demand: 14700},
  {hour: 9, supply: 14600, demand: 15400},
  {hour: 10, supply: 16500, demand: 16000},
  {hour: 11, supply: 16000, demand: 15700},
  {hour: 12, supply: 17000, demand: 15800},
  {hour: 13, supply: 16500, demand: 15600},
  {hour: 14, supply: 17500, demand: 15500},
  {hour: 15, supply: 16000, demand: 15600},
  {hour: 16, supply: 16200, demand: 15900},
  {hour: 17, supply: 15500, demand: 15500},
  {hour: 18, supply: 14500, demand: 14000},
  {hour: 19, supply: 13000, demand: 13000},
  {hour: 20, supply: 13000, demand: 12900},
  {hour: 21, supply: 13000, demand: 12800},
  {hour: 22, supply: 13000, demand: 12700},
  {hour: 23, supply: 13000, demand: 12000},
  {hour: 24, supply: 13000, demand: 11500},
];

const forecastLongBlackout = [
  {hour: 1, supply: 10000, demand: 11500},
  {hour: 2, supply: 10000, demand: 11400},
  {hour: 3, supply: 10000, demand: 12000},
  {hour: 4, supply: 10000, demand: 11800},
  {hour: 5, supply: 10000, demand: 12100},
  {hour: 6, supply: 10000, demand: 12900},
  {hour: 7, supply: 13000, demand: 13600},
  {hour: 8, supply: 15000, demand: 14700},
  {hour: 9, supply: 15600, demand: 15300},
  {hour: 10, supply: 16500, demand: 16000},
  {hour: 11, supply: 16000, demand: 15700},
  {hour: 12, supply: 17000, demand: 15800},
  {hour: 13, supply: 16500, demand: 15600},
  {hour: 14, supply: 17500, demand: 15500},
  {hour: 15, supply: 16000, demand: 15600},
  {hour: 16, supply: 16200, demand: 15900},
  {hour: 17, supply: 15500, demand: 15500},
  {hour: 18, supply: 14500, demand: 14000},
  {hour: 19, supply: 11000, demand: 13000},
  {hour: 20, supply: 10000, demand: 12900},
  {hour: 21, supply: 10000, demand: 12800},
  {hour: 22, supply: 10000, demand: 12700},
  {hour: 23, supply: 10000, demand: 12000},
  {hour: 24, supply: 10000, demand: 11500},
];

const tutorialSteps = [
  <div>
    <p><strong>Congratulations!</strong></p>
    <p>You are the new CEO of a local electric company trying to give your customers what they want: cheap, reliable electrons.</p>
    <p>Let’s get you comfortable with how to run  your company.</p>
  </div>,
  <div>
    <p>Your goal: <strong>Maximize your net worth</strong><br/>(in 4 years  / 16 turns)</p>
    <p><strong>Use forecasts</strong> to predict supply and demand</p>
    <p><strong>Build generators</strong> to expand your capacity</p>
    <p><strong>Acquire customers</strong> to increase your demand</p>
    <p><strong>Avoid blackouts</strong> to keep your customers paying</p>
  </div>,
  <div>
    <Typography variant="h6">Forecast for average Spring '98 day</Typography>
    <Chart
      height={200}
      sunrise={7}
      sunset={19}
      forecast={forecastGood}
    />
    <p>This graph shows your forecasted demand and maximum supply for next season. It represents <strong> an average day </strong> for the season.</p>
    <p>Use it to help decide which generators to build and when to acquire customers.</p>
  </div>,
  <div>
    <Chart
      height={160}
      sunrise={7}
      sunset={19}
      forecast={forecastShortBlackout}
    />
    <p><strong>Short blackouts</strong> are best solved with batteries or small “peaker” generators that spin up quickly</p>
    <Chart
      height={160}
      sunrise={7}
      sunset={19}
      forecast={forecastLongBlackout}
    />
    <p><strong>Extended blackouts</strong> mean you need more “baseload” generators or fewer customers</p>
    <br/>
    <p><strong>Acquire customers</strong> to increase demand - but don’t grow faster than your capacity!</p>
    <p>That’s all you need to get started. Good luck!</p>
  </div>,
];

const TutorialBuild = (props: Props): JSX.Element => {
  const [activeStep, setActiveStep] = React.useState(0);
  const maxStep = tutorialSteps.length;

  const handleNext = () => {
    handleStepChange(activeStep + 1);
  };

  const handleBack = () => {
    handleStepChange(activeStep - 1);
  };

  const handleStepChange = (step: any) => {
    if (step < 0) {
      props.onPrevious();
    } else if (step >= maxStep) {
      props.onNext();
    } else {
      setActiveStep(step);
    }
  };

  return (
    <div className="base_tutorial">
      <SwipeableViews
        axis="x"
        index={activeStep}
        onChangeIndex={handleStepChange}
        enableMouseEvents
      >
        {tutorialSteps.map((step: any, index) => (
          <div key={index}>
            {Math.abs(activeStep - index) <= 2 ? step : null}
          </div>
        ))}
      </SwipeableViews>
      <MobileStepper
        steps={maxStep}
        position="static"
        variant="dots"
        activeStep={activeStep}
        nextButton={
          <Button size="small" color="primary" onClick={handleNext}>
            {(activeStep < maxStep - 1) ? 'Next' : 'Start'}
            <KeyboardArrowRight />
          </Button>
        }
        backButton={
          <Button size="small" color="primary" onClick={handleBack}>
            <KeyboardArrowLeft />
            {(activeStep > 0) ? 'Back' : 'Cancel'}
          </Button>
        }
      />
    </div>
  );
};

export default TutorialBuild;
