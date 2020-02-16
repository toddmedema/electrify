import {Typography} from '@material-ui/core';
import * as React from 'react';

import {toCard} from './actions/Card';
import {setSpeed} from './reducers/GameState';
import {ScenarioType} from './Types';

export const SCENARIOS = [
  {
    id: 0, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: '101: Electricity Basics',
    icon: 'none',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 1,
    endTitle: 'Tutorial complete!',
    endMessage: 'Just a few tutorials to go',
    facilities: [{fuel: 'Natural Gas', peakW: 410000000}, {fuel: 'Sun', peakW: 300000000}],
    tutorialSteps: [
      {
        disableBeacon: true, // causes tutorial to auto-start
        target: '#topbar',
        content: <Typography variant="body1">
          Welcome! You're the new CEO of a regional power generation company.<br/><br/>
          Your goal: Make as much money as possible. You lose if you run out of cash (your cash is in the top left) or cause too many blackouts.
        </Typography>,
      },
      {
        target: '.VictoryContainer',
        content: <Typography variant="body1">
          Make money by supplying demand for electricity, measured in Megawatts (MW).<br/><br/>
          This graph represents an average day for the month.<br/><br/>
          Demand is driven by a variety of factors, including the weather and how many customers you have.
        </Typography>,
      },
      {
        target: '.VictoryContainer',
        content: <Typography variant="body1">
          Your generators automatically spin up to meet demand as best they can.<br/><br/>
          If you don't supply enough power, you'll cause blackouts that cost you customers.
        </Typography>,
      },
      {
        target: '.facility',
        content: <Typography variant="body1">
          Your facilities indicate how much power they're currently producting.<br/><br/>
          For example, your solar plant isn't producing because it's night time, so your natural gas is picking up the slack.
        </Typography>,
      },
      {
        target: '#speedChangeButtons',
        onNext: () => setSpeed('SLOW'),
        content: <Typography variant="body1">
          This tutorial will run for 1 month. See how demand and your supply changes over that time!
        </Typography>,
      },
    ],
  },
  {
    id: 1, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: '102: Generators',
    icon: 'none',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endTitle: 'Tutorial complete!',
    facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
    tutorialSteps: [
      {
        target: '.button-buildGenerator',
        onNext: () => toCard({name: 'BUILD_GENERATORS', dontRemember: true}),
        content: <Typography variant="body1">
          Build generators to produce additional electricity when you're having blackouts - or in anticipation of future growth.
        </Typography>,
      },
      {
        target: '#peak-output',
        content: <Typography variant="body1">
          Slide to change the size of generator you want to build.
        </Typography>,
      },
      {
        target: '#sort',
        content: <Typography variant="body1">
          Sort generators by different properties.
        </Typography>,
      },
      {
        target: '.action-seconday-text',
        content: <Typography variant="body1">
          See how long it will take to build, and the total cost of electricity across its lifetime.
        </Typography>,
      },
      {
        target: '.build-list-item',
        content: <Typography variant="body1">
          Click on a generator to see more detailed information.
        </Typography>,
      },
      {
        target: '.buy-button',
        content: <Typography variant="body1">
          Click on the price to buy it, either in cash or with a loan.
        </Typography>,
      },
      {
        target: '#close-button',
        onNext: () => toCard({name: 'FACILITIES'}),
        content: <Typography variant="body1">
          Tap X to close the buy screen.
        </Typography>,
      },
      {
        target: '#speedChangeButtons',
        content: <Typography variant="body1">
          Start the game by unpausing it. (If you're on a computer, you can also use keyboard shortcuts ~/1/2/3/Q/W/E)<br/><br/>
          To learn more about concepts, select "Manual" from the top left menu.<br/><br/>
          This tutorial will run for 1 year. Try building different types of generators!
        </Typography>,
      },
    ],
  },
  {
    id: 2, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: '103: Storage',
    icon: 'none',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endTitle: 'Tutorial complete!',
    facilities: [{name: 'Pumped Hydro', peakWh: 500000000}, {fuel: 'Coal', peakW: 480000000}],
    tutorialSteps: [
      {
        disableBeacon: true, // causes tutorial to auto-start
        target: '.VictoryContainer',
        content: <Typography variant="body1">
          When you're getting blackouts, generators aren't your only option.<br/><br/>
          If you have spare generator capcity at other times of day, it's often cheaper to store that energy than build more generators.
        </Typography>,
      },
      {
        target: '.button-buildStorage',
        onNext: () => toCard({name: 'BUILD_STORAGE', dontRemember: true}),
        content: <Typography variant="body1">
          Try building a storage facility now.
        </Typography>,
      },
      {
        target: '.build-list-item',
        content: <Typography variant="body1">
          Try moving the slider to change their capacity. Note how the peak output is different for each technology, and changes based on the capacity.
        </Typography>,
      },
      {
        target: '#close-button',
        onNext: () => toCard({name: 'FACILITIES'}),
        content: <Typography variant="body1">
          Tap X to close the buy screen.
        </Typography>,
      },
      {
        target: '.capacityProgressBar',
        content: <Typography variant="body1">
          In addition to the horizontal bar that indicates their output, storage units have a vertical bar that indicates how much energy they have stored.
        </Typography>,
      },
      {
        target: '.facility',
        content: <Typography variant="body1">
          Hold and drag to re-order your generators and storage. Generators at the top produce first and only charge storage below them.
        </Typography>,
      },
      {
        target: '.facility',
        content: <Typography variant="body1">
          This tutorial will run for 1 year. Try changing the order of storage and generators to see how it affects their output!
        </Typography>,
      },
    ],
  },
  // {
  //   id: 3, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
  //   name: '104: Finances',
  //   startingYear: 2020,
  //   feePerKgCO2e: 0,
  //   durationMonths: 12,
  //   endTitle: 'Tutorial complete! ',
  //   tutorialSteps: [
  //     {
  //       disableBeacon: true, // causes tutorial to auto-start
  //       target: '#topbar',
  //       content: <Typography variant="body1">
  //         TODO
  //       </Typography>,
  //     },
  //   ],
  // },
  // {
  //   id: 4, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
  //   name: '104: Forecasting',
  //   startingYear: 2020,
  //   feePerKgCO2e: 0,
  //   durationMonths: 12,
  //   endTitle: 'Tutorial complete! ',
  //   tutorialSteps: [
  //     {
  //       disableBeacon: true, // causes tutorial to auto-start
  //       target: '#topbar',
  //       content: <Typography variant="body1">
  //         TODO
  //       </Typography>,
  //     },
  //   ],
  // },
  {
    id: 100, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: 'Carbon Fee',
    icon: 'solar',
    summary: 'Do you have what it takes to transition into a new age?',
    startingYear: 2020,
    feePerKgCO2e: 50 / 1000,
    durationMonths: 12 * 12,
    facilities: [{name: 'Pumped Hydro', peakWh: 500000000}, {fuel: 'Natural Gas', peakW: 480000000}],
  },
  {
    id: 101, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: 'Rise of Renewables',
    icon: 'wind',
    summary: 'Technology is changing rapidly - can you keep up?',
    startingYear: 2002,
    feePerKgCO2e: 0,
    durationMonths: 12 * 12,
    facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
  },
  {
    id: 102, // Avoid changing IDs, linked to scores / completion, and doesn't impact order
    name: 'Natural Gas & Nuclear',
    icon: 'natural gas',
    summary: 'Your existing coal business faces new challengers.',
    startingYear: 1980,
    feePerKgCO2e: 0,
    durationMonths: 12 * 20,
    facilities: [{fuel: 'Coal', peakW: 500000000}],
  },
] as ScenarioType[];
