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
  onCancel: () => any;
  onStart: () => any;
}

export interface Props extends StateProps, DispatchProps {}

const forecastGood = [
  {hour: 1, supplyW: 13000, demandW: 11500},
  {hour: 2, supplyW: 13000, demandW: 11400},
  {hour: 3, supplyW: 13000, demandW: 12000},
  {hour: 4, supplyW: 13000, demandW: 11800},
  {hour: 5, supplyW: 13000, demandW: 12100},
  {hour: 6, supplyW: 13200, demandW: 12850},
  {hour: 7, supplyW: 14000, demandW: 13600},
  {hour: 8, supplyW: 15000, demandW: 14700},
  {hour: 9, supplyW: 16000, demandW: 15800},
  {hour: 10, supplyW: 16400, demandW: 16000},
  {hour: 11, supplyW: 16300, demandW: 15700},
  {hour: 12, supplyW: 16800, demandW: 15800},
  {hour: 13, supplyW: 16600, demandW: 15600},
  {hour: 14, supplyW: 17400, demandW: 15500},
  {hour: 15, supplyW: 16200, demandW: 15600},
  {hour: 16, supplyW: 16400, demandW: 15900},
  {hour: 17, supplyW: 15500, demandW: 15400},
  {hour: 18, supplyW: 14500, demandW: 14000},
  {hour: 19, supplyW: 13200, demandW: 12950},
  {hour: 20, supplyW: 13000, demandW: 12900},
  {hour: 21, supplyW: 13000, demandW: 12800},
  {hour: 22, supplyW: 13000, demandW: 12700},
  {hour: 23, supplyW: 13000, demandW: 12000},
  {hour: 24, supplyW: 13000, demandW: 11500},
];

const forecastShortBlackout = [
  {hour: 1, supplyW: 13000, demandW: 11500},
  {hour: 2, supplyW: 13000, demandW: 11400},
  {hour: 3, supplyW: 13000, demandW: 12000},
  {hour: 4, supplyW: 13000, demandW: 11800},
  {hour: 5, supplyW: 13000, demandW: 12100},
  {hour: 6, supplyW: 13000, demandW: 12900},
  {hour: 7, supplyW: 14000, demandW: 13600},
  {hour: 8, supplyW: 15000, demandW: 14700},
  {hour: 9, supplyW: 14600, demandW: 15400},
  {hour: 10, supplyW: 16500, demandW: 16000},
  {hour: 11, supplyW: 16000, demandW: 15700},
  {hour: 12, supplyW: 17000, demandW: 15800},
  {hour: 13, supplyW: 16500, demandW: 15600},
  {hour: 14, supplyW: 17500, demandW: 15500},
  {hour: 15, supplyW: 16000, demandW: 15600},
  {hour: 16, supplyW: 16200, demandW: 15900},
  {hour: 17, supplyW: 15500, demandW: 15500},
  {hour: 18, supplyW: 14500, demandW: 14000},
  {hour: 19, supplyW: 13000, demandW: 13000},
  {hour: 20, supplyW: 13000, demandW: 12900},
  {hour: 21, supplyW: 13000, demandW: 12800},
  {hour: 22, supplyW: 13000, demandW: 12700},
  {hour: 23, supplyW: 13000, demandW: 12000},
  {hour: 24, supplyW: 13000, demandW: 11500},
];

const forecastLongBlackout = [
  {hour: 1, supplyW: 10000, demandW: 11500},
  {hour: 2, supplyW: 10000, demandW: 11400},
  {hour: 3, supplyW: 10000, demandW: 12000},
  {hour: 4, supplyW: 10000, demandW: 11800},
  {hour: 5, supplyW: 10000, demandW: 12100},
  {hour: 6, supplyW: 10000, demandW: 12900},
  {hour: 7, supplyW: 13000, demandW: 13600},
  {hour: 8, supplyW: 15000, demandW: 14700},
  {hour: 9, supplyW: 15600, demandW: 15300},
  {hour: 10, supplyW: 16500, demandW: 16000},
  {hour: 11, supplyW: 16000, demandW: 15700},
  {hour: 12, supplyW: 17000, demandW: 15800},
  {hour: 13, supplyW: 16500, demandW: 15600},
  {hour: 14, supplyW: 17500, demandW: 15500},
  {hour: 15, supplyW: 16000, demandW: 15600},
  {hour: 16, supplyW: 16200, demandW: 15900},
  {hour: 17, supplyW: 15500, demandW: 15500},
  {hour: 18, supplyW: 14500, demandW: 14000},
  {hour: 19, supplyW: 11000, demandW: 13000},
  {hour: 20, supplyW: 10000, demandW: 12900},
  {hour: 21, supplyW: 10000, demandW: 12800},
  {hour: 22, supplyW: 10000, demandW: 12700},
  {hour: 23, supplyW: 10000, demandW: 12000},
  {hour: 24, supplyW: 10000, demandW: 11500},
];

const tutorialSteps = [
  <div>
    <p><strong>Congratulations!</strong></p>
    <p>You are the new CEO of a Californian electric company trying to give your customers what they want: cheap, reliable electrons.</p>
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
    <Typography variant="h6">Forecast for average Spring day</Typography>
    <Chart
      height={200}
      sunrise={7}
      sunset={19}
      timeline={forecastGood}
    />
    <p>This graph shows your forecasted demand and maximum supply for next season. It represents <strong> an average day </strong> for the season.</p>
    <p>Use it to help decide which generators to build and when to acquire customers.</p>
  </div>,
  <div>
    <Chart
      height={160}
      sunrise={7}
      sunset={19}
      timeline={forecastShortBlackout}
    />
    <p><strong>Short blackouts</strong> are best solved with batteries or “peaking” generators that spin up quickly</p>
    <Chart
      height={160}
      sunrise={7}
      sunset={19}
      timeline={forecastLongBlackout}
    />
    <p><strong>Extended blackouts</strong> mean you need more “baseload” generators or fewer customers</p>
    <br/>
    <p><strong>Acquire customers</strong> to increase demand - but don’t grow faster than your capacity</p>
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
      props.onCancel();
    } else if (step >= maxStep) {
      props.onStart();
    } else {
      setActiveStep(step);
    }
  };

  return (
    <div id="tutorialCard">
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
