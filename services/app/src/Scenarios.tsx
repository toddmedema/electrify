import {Typography} from '@material-ui/core';
import * as React from 'react';

import {ScenarioType} from './Types';

export const SCENARIOS = [
  {
    id: 1, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '101: Generators',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endMessageTitle: 'Tutorial complete! ',
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
        content: <Typography variant="body1">
          Build generators and storage to meet demand (options and prices change as new tech becomes available).
        </Typography>,
      },
      {
        target: '.facility',
        content: <Typography variant="body1">
          Hold and drag to re-order your generators and storage. Generators at the top produce first and only charge storage below them.
        </Typography>,
      },
      {
        target: '#speedChangeButtons',
        content: <Typography variant="body1">
          Start the game by unpausing it.<br/><br/>
          For questions and learning more, select "Manual" from the top left menu.<br/><br/>
          This tutorial will run for 1 year. Try building different types of generators!
        </Typography>,
      },
    ],
  },
  {
    id: 2, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '102: Storage',
    startingYear: 2020,
    feePerKgCO2e: 0,
    durationMonths: 12,
    endMessageTitle: 'Tutorial complete! ',
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
        target: '.facility',
        content: <Typography variant="body1">
          Make sure to re-order your storage to be after any generators you want to charge it.<br/><br/>
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
    name: '2020 - Carbon Fee',
    summary: 'Do you have what it takes to transition into a new age?',
    startingYear: 2020,
    feePerKgCO2e: 50,
    durationMonths: 12 * 20,
  },
  {
    id: 101, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '2000 - Renewables',
    summary: 'Technology is changing rapidly - can you keep up?',
    startingYear: 2000,
    feePerKgCO2e: 0,
    durationMonths: 12 * 20,
  },
  {
    id: 102, // Avoid changing once ID is in production, linked to scores / completion, and doesn't impact order
    name: '1980 - Natural Gas & Nuclear',
    summary: 'Your existing coal business faces new challengers.',
    startingYear: 2000,
    feePerKgCO2e: 0,
    durationMonths: 12 * 20,
  },
] as ScenarioType[];
