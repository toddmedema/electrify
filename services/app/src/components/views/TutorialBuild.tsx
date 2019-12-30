import Button from '@material-ui/core/Button';
import MobileStepper from '@material-ui/core/MobileStepper';
import Typography from '@material-ui/core/Typography';
import KeyboardArrowLeft from '@material-ui/icons/KeyboardArrowLeft';
import KeyboardArrowRight from '@material-ui/icons/KeyboardArrowRight';
import * as React from 'react';
import SwipeableViews from 'react-swipeable-views';
import ChartSupplyDemand from '../base/ChartSupplyDemand';

export interface StateProps {
}

export interface DispatchProps {
  onCancel: () => any;
  onStart: () => any;
}

export interface Props extends StateProps, DispatchProps {}

const forecastGood = [
  {minute: 1, supplyW: 13000, demandW: 11500},
  {minute: 60, supplyW: 13000, demandW: 11400},
  {minute: 120, supplyW: 13000, demandW: 12000},
  {minute: 180, supplyW: 13000, demandW: 11800},
  {minute: 240, supplyW: 13000, demandW: 12100},
  {minute: 300, supplyW: 13200, demandW: 12850},
  {minute: 360, supplyW: 14000, demandW: 13600},
  {minute: 420, supplyW: 15000, demandW: 14700},
  {minute: 480, supplyW: 16000, demandW: 15800},
  {minute: 540, supplyW: 16400, demandW: 16000},
  {minute: 600, supplyW: 16300, demandW: 15700},
  {minute: 660, supplyW: 16800, demandW: 15800},
  {minute: 720, supplyW: 16600, demandW: 15600},
  {minute: 780, supplyW: 17400, demandW: 15500},
  {minute: 840, supplyW: 16200, demandW: 15600},
  {minute: 900, supplyW: 16400, demandW: 15900},
  {minute: 960, supplyW: 15500, demandW: 15400},
  {minute: 1020, supplyW: 14500, demandW: 14000},
  {minute: 1080, supplyW: 13200, demandW: 12950},
  {minute: 1140, supplyW: 13000, demandW: 12900},
  {minute: 1200, supplyW: 13000, demandW: 12800},
  {minute: 1260, supplyW: 13000, demandW: 12700},
  {minute: 1320, supplyW: 13000, demandW: 12000},
  {minute: 1380, supplyW: 13000, demandW: 11500},
];

const forecastShortBlackout = [
  {minute: 1, supplyW: 13000, demandW: 11500},
  {minute: 60, supplyW: 13000, demandW: 11400},
  {minute: 120, supplyW: 13000, demandW: 12000},
  {minute: 180, supplyW: 13000, demandW: 11800},
  {minute: 240, supplyW: 13000, demandW: 12100},
  {minute: 300, supplyW: 13000, demandW: 12900},
  {minute: 360, supplyW: 14000, demandW: 13600},
  {minute: 420, supplyW: 15000, demandW: 14700},
  {minute: 480, supplyW: 14600, demandW: 15400},
  {minute: 540, supplyW: 16500, demandW: 16000},
  {minute: 600, supplyW: 16000, demandW: 15700},
  {minute: 660, supplyW: 17000, demandW: 15800},
  {minute: 720, supplyW: 16500, demandW: 15600},
  {minute: 780, supplyW: 17500, demandW: 15500},
  {minute: 840, supplyW: 16000, demandW: 15600},
  {minute: 900, supplyW: 16200, demandW: 15900},
  {minute: 960, supplyW: 15500, demandW: 15500},
  {minute: 1020, supplyW: 14500, demandW: 14000},
  {minute: 1080, supplyW: 13000, demandW: 13000},
  {minute: 1140, supplyW: 13000, demandW: 12900},
  {minute: 1200, supplyW: 13000, demandW: 12800},
  {minute: 1260, supplyW: 13000, demandW: 12700},
  {minute: 1320, supplyW: 13000, demandW: 12000},
  {minute: 1380, supplyW: 13000, demandW: 11500},
];

const forecastLongBlackout = [
  {minute: 1, supplyW: 10000, demandW: 11500},
  {minute: 60, supplyW: 10000, demandW: 11400},
  {minute: 120, supplyW: 10000, demandW: 12000},
  {minute: 180, supplyW: 10000, demandW: 11800},
  {minute: 240, supplyW: 10000, demandW: 12100},
  {minute: 300, supplyW: 10000, demandW: 12900},
  {minute: 360, supplyW: 13000, demandW: 13600},
  {minute: 420, supplyW: 15000, demandW: 14700},
  {minute: 480, supplyW: 15600, demandW: 15300},
  {minute: 540, supplyW: 16500, demandW: 16000},
  {minute: 600, supplyW: 16000, demandW: 15700},
  {minute: 660, supplyW: 17000, demandW: 15800},
  {minute: 720, supplyW: 16500, demandW: 15600},
  {minute: 780, supplyW: 17500, demandW: 15500},
  {minute: 840, supplyW: 16000, demandW: 15600},
  {minute: 900, supplyW: 16200, demandW: 15900},
  {minute: 960, supplyW: 15500, demandW: 15500},
  {minute: 1020, supplyW: 14500, demandW: 14000},
  {minute: 1080, supplyW: 11000, demandW: 13000},
  {minute: 1140, supplyW: 10000, demandW: 12900},
  {minute: 1200, supplyW: 10000, demandW: 12800},
  {minute: 1260, supplyW: 10000, demandW: 12700},
  {minute: 1320, supplyW: 10000, demandW: 12000},
  {minute: 1380, supplyW: 10000, demandW: 11500},
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
    <ChartSupplyDemand
      legend={true}
      height={200}
      timeline={forecastGood}
    />
    <p>This graph shows your forecasted demand and maximum supply for next season. It represents <strong> an average day </strong> for the season.</p>
    <p>Use it to help decide which generators to build and when to acquire customers.</p>
  </div>,
  <div>
    <ChartSupplyDemand
      legend={true}
      height={160}
      timeline={forecastShortBlackout}
    />
    <p><strong>Short blackouts</strong> are best solved with batteries or “peaking” generators that spin up quickly</p>
    <ChartSupplyDemand
      legend={true}
      height={160}
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
    <div id="tutorialCard" className="flexContainer">
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
