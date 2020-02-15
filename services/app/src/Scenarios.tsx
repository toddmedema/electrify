import {Typography} from '@material-ui/core';
import * as React from 'react';

import {toCard} from './actions/Card';
import {ScenarioType} from './Types';

export const SCENARIOS = [
  {
    id: 1, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '101: Generators',
    icon: 'none',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endMessageTitle: 'Tutorial complete! ',
    facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
    tutorialSteps: [
      {
        disableBeacon: true, // causes tutorial to auto-start
        target: '#topbar',
        content: <Typography variant="body1">
          Welcome! You're the new CEO of a regional power generation company.<br/><br/>
          Your goal: Make as much money as possible. You lose if you run out of cash.
        </Typography>,
      },
      {
        target: '.VictoryContainer',
        content: <Typography variant="body1">
          Make money by supplying demand for electricity.<br/><br/>
          If you don't supply enough power, you'll cause blackouts that cost you customers.
        </Typography>,
      },
      {
        target: '.button-buildGenerator',
        onNext: () => toCard({name: 'BUILD_GENERATORS', dontRemember: true}),
        content: <Typography variant="body1">
          Build generators and storage to meet demand.
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
          Sort generators by different gproperties.
        </Typography>,
      },
      {
        target: '.buy-button',
        content: <Typography variant="body1">
          Click on the price to buy it, either in cash or with a loan.
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
          For questions and learning more, select "Manual" from the top left menu.<br/><br/>
          This tutorial will run for 1 year. Try building different types of generators!
        </Typography>,
      },
    ],
  },
  {
    id: 2, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '102: Storage',
    icon: 'none',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endMessageTitle: 'Tutorial complete! ',
    facilities: [{name: 'Pumped Hydro', peakWh: 500000000}, {fuel: 'Coal', peakW: 480000000}],
    tutorialSteps: [
      {
        disableBeacon: true, // causes tutorial to auto-start
        target: '.VictoryContainer',
        content: <Typography variant="body1">
          When you're getting blackouts, you can solve it with more generators... or with storage.<br/><br/>
          If you already have spare generator capcity, it's often cheaper to store the energy than build more generators.
        </Typography>,
      },
      {
        target: '.button-buildStorage',
        content: <Typography variant="body1">
          Try building a storage facility now - you can tap on each option to see more information.<br/><br/>
          Note how the peak output is different for each technology, and changes based on the capacity.
        </Typography>,
      },
      {
        target: '.capacityProgressBar',
        content: <Typography variant="body1">
          In addition to the horizontal bar that indicates output rate, storage units have a vertical bar that indicates how much they're charged.
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
          This tutorial will run for 1 year. Try changing the order of storage and generator units to see how it affects their output!
        </Typography>,
      },
    ],
  },
  // {
  //   id: 3, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
  //   name: '103: Finances',
  //   startingYear: 2020,
  //   feePerKgCO2e: 0,
  //   durationMonths: 12,
  //   endMessageTitle: 'Tutorial complete! ',
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
  //   id: 4, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
  //   name: '104: Forecasting',
  //   startingYear: 2020,
  //   feePerKgCO2e: 0,
  //   durationMonths: 12,
  //   endMessageTitle: 'Tutorial complete! ',
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
    id: 100, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: 'Carbon Fee',
    icon: 'solar',
    summary: 'Do you have what it takes to transition into a new age?',
    startingYear: 2020,
    feePerKgCO2e: 50 / 1000,
    durationMonths: 12 * 12,
    facilities: [{name: 'Pumped Hydro', peakWh: 500000000}, {fuel: 'Natural Gas', peakW: 480000000}],
  },
  {
    id: 101, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: 'Rise of Renewables',
    icon: 'wind',
    summary: 'Technology is changing rapidly - can you keep up?',
    startingYear: 2002,
    feePerKgCO2e: 0,
    durationMonths: 12 * 12,
    facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
  },
  {
    id: 102, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: 'Natural Gas & Nuclear',
    icon: 'natural gas',
    summary: 'Your existing coal business faces new challengers.',
    startingYear: 1980,
    feePerKgCO2e: 0,
    durationMonths: 12 * 20,
    facilities: [{fuel: 'Coal', peakW: 500000000}],
  },
] as ScenarioType[];
