import * as React from "react";
import KeyboardShortcuts, {
  SHORTCUTS_SEARCH_TEXT,
} from "../components/base/KeyboardShortcuts";
import ConceptLegend from "../components/base/ConceptLegend";
import { useUnits } from "../components/base/UnitsContext";
import {
  formatLargeMassApprox,
  formatPricePerLargeMass,
  KG_PER_MEGATONNE,
  largeMassUnit,
  massUnitName,
} from "../helpers/Units";

// The entries are static markup, so the handful of places that name a unit read the setting
// through a component of their own rather than the array becoming a function of it. Their text
// is not walked by the search (see manualEntryText), which is what the keywords are for.
function MassUnitName(): React.JSX.Element {
  return <>{massUnitName(useUnits())}</>;
}

function LargeMassUnit(): React.JSX.Element {
  return <>{largeMassUnit(useUnits())}</>;
}

// The illustrative fee in the carbon fee entry, quoted per whichever ton the player reads in -
// $50 a tonne is $45 a ton
const EXAMPLE_FEE_PER_KG = 0.05;

function ExampleCarbonFee(): React.JSX.Element {
  return <>{formatPricePerLargeMass(EXAMPLE_FEE_PER_KG, useUnits())}</>;
}

function EmissionsPerPoint(): React.JSX.Element {
  return <>{formatLargeMassApprox(KG_PER_MEGATONNE, useUnits())}</>;
}

// Groups the entries into sections, so the list doesn't open on "Blackouts" and "BTU" purely
// because the alphabet says so. Ordered the way they're shown.
export const MANUAL_GROUPS = ["Gameplay", "Money", "Physics & Units"] as const;
export type ManualGroupType = (typeof MANUAL_GROUPS)[number];

// Entry titles are the deep link ids -- anywhere in the game that shows one of these terms can
// send the player straight to it with navigate({name: "MANUAL", entry: MANUAL_ENTRY.X}). Naming
// them here rather than passing raw strings means renaming an entry breaks the build instead of
// silently breaking the link.
export const MANUAL_ENTRY = {
  HOW_TO_PLAY: "How to Play",
  BASELOAD_VS_PEAKER: "Baseload vs Peaker",
  BLACKOUTS: "Blackouts",
  BTU: "BTU and MMBTU",
  CAPACITY_FACTOR: "Capacity Factor",
  CARBON_FEE: "Carbon Fee",
  CUSTOMERS: "Customers, Demand & Marketing",
  EMISSIONS: "Emissions and CO2e",
  FORECASTS: "Forecasts",
  INTEREST_RATES: "Interest Rates & Inflation",
  KEYBOARD_SHORTCUTS: "Keyboard Shortcuts",
  PRIORITIZING_GENERATORS: "Prioritizing Generators",
  RAMP_RATE: "Ramp Rate",
  RATES: "Rates",
  ROUND_TRIP_EFFICIENCY: "Round-trip Efficiency",
  SCORE: "Score",
  SYMBOLS: "Symbol Guide",
  TOTAL_COST_OF_ENERGY: "Total Cost of Energy",
} as const;

export type ManualEntryTitleType =
  (typeof MANUAL_ENTRY)[keyof typeof MANUAL_ENTRY];

export interface ManualEntryType {
  title: ManualEntryTitleType;
  group: ManualGroupType;
  entry: React.JSX.Element;
  // Terms a player would plausibly search for that aren't spelled out in the body, plus the
  // text of anything the body renders as a component (which has no children to walk). Body
  // prose is searched automatically -- see manualEntryText below -- so this is only for the
  // words that aren't there.
  keywords?: string;
  // Pins the entry above the grouped list. Only "How to Play" uses it; a new player shouldn't
  // have to scroll past the glossary to find the overview.
  pinned?: boolean;
}

// The source line for an image, shown to the player rather than hidden in the alt attribute:
// on an educational game a citation is worth reading, and alt text is for describing the
// picture to someone who can't see it
interface FigureProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  sourceName: string;
  sourceUrl: string;
}

function Figure(props: FigureProps): React.JSX.Element {
  return (
    <figure>
      <img
        src={props.src}
        alt={props.alt}
        // Intrinsic dimensions reserve the right box before the file loads, so expanding an
        // entry doesn't shove the text below it around once the image arrives
        width={props.width}
        height={props.height}
        loading="lazy"
      />
      <figcaption>
        Source:{" "}
        <a href={props.sourceUrl} target="_blank" rel="noreferrer">
          {props.sourceName}
        </a>
      </figcaption>
    </figure>
  );
}

// Flattens an entry down to the words in it, so search can match body text. The old version
// only looked one level deep and only at children that were plain strings, so any paragraph
// with a <strong> in it dropped out of search entirely -- "merit order" and "peak shortage"
// were both in the manual and both unfindable. Walking the whole tree also means new entries
// are searchable the moment they're written, without anyone maintaining a parallel string.
export function manualEntryText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(manualEntryText).join(" ");
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return manualEntryText(props.children);
  }
  return "";
}

export const MANUAL_ENTRIES: ManualEntryType[] = [
  {
    title: MANUAL_ENTRY.HOW_TO_PLAY,
    group: "Gameplay",
    pinned: true,
    keywords: "getting started tutorial basics overview intro new player",
    entry: (
      <div>
        <p>
          You're the incoming CEO of an electric utility. Every hour of game
          time your customers demand a certain amount of power, and every hour
          your generators have to supply it. Supply too little and you cause{" "}
          blackouts; spend too much supplying it and you go broke.
        </p>
        <p>
          <strong>Facilities</strong> is your fleet. Generators higher in the
          list are asked to run first, so the order you put them in decides
          which ones burn fuel and which ones sit idle. Build from here, and
          pause or sell anything that's costing more than it earns.
        </p>
        <p>
          <strong>Finances</strong> shows where the money went, and is where you
          set marketing spend (which buys customers) and, in public-ownership
          scenarios, the rate you charge.
        </p>
        <p>
          <strong>Forecasts</strong> projects all of that forward so you can see
          a shortfall coming while there's still time to build for it - plants
          take months or years to finish.
        </p>
        <p>
          A good first move is to open Forecasts, find the first blackout, and
          work out whether it needs something cheap that runs constantly or
          something expensive that starts quickly. The rest of this manual
          explains the terms you'll meet along the way.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.SYMBOLS,
    group: "Gameplay",
    keywords:
      "icons glyphs legend key money supply demand blackout customers generator storage build buy reorder pause play time construction finances forecast marketing fuel weather danger goal",
    entry: (
      <div>
        <p>
          These symbols mean the same thing in missions, controls, events and
          results. Learn one once, then follow it everywhere.
        </p>
        <ConceptLegend />
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BASELOAD_VS_PEAKER,
    group: "Gameplay",
    keywords: "peaking plant intermediate load following mid-merit",
    entry: (
      <div>
        <p>
          Demand never sits still, so a fleet needs two very different kinds of
          plant.
        </p>
        <p>
          <strong>Baseload</strong> plants - nuclear, coal, large hydro - are
          cheap per unit of energy but slow and expensive to start and stop, so
          they run flat out around the clock and cover the demand that's always
          there. They're the wrong answer to a four-hour evening peak: by the
          time one has ramped up, the peak is over.
        </p>
        <p>
          <strong>Peakers</strong> - typically gas turbines - are the opposite.
          Cheap to build, expensive to run, and able to go from cold to full
          output in minutes. They spend most of the year switched off and earn
          their keep on the handful of days when demand spikes.
        </p>
        <p>
          Most of the cost of a peaker is the fuel it burns, so an idle one
          costs you little; most of the cost of a baseload plant is paid whether
          it runs or not. That's why a fleet made only of peakers loses money on
          fuel, and a fleet made only of baseload plants blacks out every summer
          afternoon.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BLACKOUTS,
    group: "Gameplay",
    entry: (
      <div>
        <p>
          If you don't supply enough electricity to meet demand, you'll cause
          rolling blackouts that cost you customers (and thus revenue).
        </p>
        <p>
          Like utilities in real life, you aren't financially responsible for
          blackouts. But, if you have chronic blackouts, your board of directors
          might fire you!
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BTU,
    group: "Physics & Units",
    keywords: "british thermal unit mmbtu heat energy kwh mwh",
    entry: (
      <p>
        The British Thermal Unit is a measure of heat energy. MMBTU is one
        million BTU, and equals approximately 300 kWh of electrical energy.
      </p>
    ),
  },
  {
    title: MANUAL_ENTRY.CAPACITY_FACTOR,
    group: "Physics & Units",
    keywords: "uptime utilization average output nameplate capacity",
    entry: (
      <div>
        <p>
          Capacity factor is the share of a generator's nameplate capacity it
          actually delivers over a year. A 100 MW plant at a 45% capacity factor
          produces as much energy in a year as a 45 MW plant running
          continuously would.
        </p>
        <p>
          It's shown in the build screen as "% uptime", and it's why nameplate
          size alone tells you very little. Nuclear runs above 90%. Coal and gas
          sit in the middle, limited by fuel cost and by how often you choose to
          dispatch them. Wind and solar are set by the weather and the seasons
          at your location, not by you - which is why the same solar farm is a
          much better deal in one scenario than another.
        </p>
        <p>
          Capacity factor is what turns a build cost into a cost per MWh, so
          it's baked into every Total Cost of Energy figure you see.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.CARBON_FEE,
    group: "Money",
    keywords: "carbon tax carbon price pollution fee co2 per ton tonne",
    entry: (
      <div>
        <p>
          A carbon fee is a charge on pollution, meant to cover the damage it
          does to everyone else. It's billed by the amount of greenhouse gas
          emitted, measured in <LargeMassUnit /> of CO2 equivalent, and it shows
          up in your P&amp;L as an operating expense on every dirty MWh you
          generate.
        </p>
        <p>
          Electricity generation is the 2nd largest source of greenhouse gas in
          the United States, and without a fee a utility has no financial reason
          to cut its emissions - the cheapest plant to run wins no matter what
          comes out of the stack. A fee changes the merit order itself: at{" "}
          <ExampleCarbonFee /> a coal plant can become more expensive to run
          than the gas plant beside it, without a single rule telling you to
          shut it down.
        </p>
        <p>
          Scenarios set their own fee, and custom games let you dial it from $0
          upwards. Turning it up is the fastest way to see how much of the
          fossil fuel fleet is only economic because the pollution is free.
        </p>
      </div>
    ),
  },
  {
    // Credit to https://www.e-education.psu.edu/ebf200/node/151
    title: MANUAL_ENTRY.CUSTOMERS,
    group: "Gameplay",
    keywords: "load shape residential commercial industrial growth churn",
    entry: (
      <div>
        <p>
          More customers drives more demand. Although individual customer types
          (residential, commercial, industrial) have different demand curves,
          we've aggregated them into a single "customers" number that reflects a
          blend of customer types. Here's what demand by type looks like in real
          life:
        </p>
        <Figure
          src="/images/manual-demand-customer-types.png"
          alt="Three charts of monthly US retail electricity sales from 2009 to 2012. Residential sales swing hardest, peaking each summer and winter; commercial sales follow the same shape but with about half the swing; industrial sales stay nearly flat all year."
          width={576}
          height={288}
          sourceName="U.S. Energy Information Administration"
          sourceUrl="https://www.eia.gov/todayinenergy/detail.php?id=10211"
        />
        <p>
          Like in real life, you as a company can spend money on marketing to
          acquire more customers (you exist as one of many electricity
          generation companies customers can select from). Your customer base
          also naturally grows or shrinks depending on if you provide them good
          service (i.e. few blackouts).
        </p>
        <p>
          Load changes continuously as people turn stuff on and off, as
          temperature changes, as the natural light comes and goes, and so on.
          This pattern of changing load is called a "load shape". We can have
          daily load shapes, weekly ones, and annual ones. The following diagram
          shows the path of load for three different weeks at three different
          times of year in 2009:
        </p>
        <Figure
          src="/images/manual-demand.jpg"
          alt="Hourly electricity load across a week in the PJM Mid-Atlantic region, plotted for a hot week, a cold week and a mild week of 2009. All three rise and fall once a day and drop over the weekend; the hot week peaks around 50,000 MW, roughly 20,000 MW above the mild week's overnight low."
          width={834}
          height={560}
          sourceName="Penn State, EBF 200"
          sourceUrl="https://www.e-education.psu.edu/ebf200/node/151"
        />
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.EMISSIONS,
    group: "Physics & Units",
    keywords:
      "greenhouse gas pollution carbon dioxide equivalent tons tonnes kilograms pounds",
    entry: (
      <div>
        <p>
          CO2e stands for Carbon Dioxide equivalent, a measure of the greenhouse
          warming impact of various pollutants. Each generator lists the{" "}
          <MassUnitName /> of CO2e it releases per MWh, which is what makes a
          coal plant and a gas plant of the same size comparable.
        </p>
        <p>
          Electricity generation is the 2nd largest source of greenhouse gas in
          the United States, but our utilities have no financial incentive to
          reduce their emissions.
        </p>
        <p>
          One of the highest-rated proposals to reduce emissions is a Carbon
          Fee, which creates a financial incentive for businesses to reduce
          their carbon footprint through innovation. Electrify lets you
          experiment with different levels of carbon fees, and see how
          technology innovation can enable better business decisions than the
          fossil fuels of the past.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.FORECASTS,
    group: "Gameplay",
    keywords: "projection supply demand fuel prices weather peak shortage",
    entry: (
      <div>
        <p>
          The Forecasts tab projects your company forward, so you can spot
          problems before they cost you customers. Use the dropdown at the top
          right to look ahead 1, 5, 10 or 20 years - the further out you look,
          the coarser (and less certain) the projection.
        </p>
        <p>
          <strong>Supply &amp; Demand</strong> plots your projected output
          against projected demand. Wherever demand rises above supply, the gap
          is shaded as a blackout. If any are forecasted, the table underneath
          breaks them down: total energy not served, the size of the single
          worst event, the peak shortage (how much extra capacity you'd need to
          cover it) and when it happens. That "when" is the most useful number
          on the page - it tells you whether you need generation that can ramp
          up for a few hours, or baseload for a whole season.
        </p>
        <p>
          <strong>Supply by Fuel</strong> breaks that same supply down by fuel,
          in dispatch order. This is where you can see your merit order at work:
          cheap, always-on sources carry the base, and expensive or fast-ramping
          ones fill the peaks. Re-ordering your facilities changes this chart.
        </p>
        <p>
          <strong>Stored power</strong> (shown once you own storage) tracks the
          energy in your batteries and reservoirs as they charge off surplus and
          discharge into peaks.
        </p>
        <p>
          <strong>Fuel Prices</strong> projects the cost of each fuel you can
          burn, based on real historical price data. Fuel prices move suddenly
          and by a lot, which can flip a profitable plant into a money-loser -
          watch this chart before committing to a decades-long build.
        </p>
        <p>
          <strong>Weather</strong> projects temperature and sunlight for your
          region. It drives demand (heating and air conditioning) as well as the
          output of your solar and wind generators.
        </p>
        <p>
          Forecasts assume you make no further changes, so treat them as "what
          happens if I do nothing" rather than a promise. Pausing a generator or
          reordering your stack updates them immediately, which makes them a
          cheap way to test a decision before you pay for it.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.KEYBOARD_SHORTCUTS,
    group: "Gameplay",
    keywords: `hotkeys keys controls ${SHORTCUTS_SEARCH_TEXT}`,
    entry: (
      <div>
        <p>
          While a scenario is running, you can drive the game from the keyboard:
        </p>
        <KeyboardShortcuts />
      </div>
    ),
  },
  {
    // Credit to https://www.e-education.psu.edu/ebf200/node/151
    title: MANUAL_ENTRY.PRIORITIZING_GENERATORS,
    group: "Gameplay",
    keywords: "merit order dispatch order generation stack marginal cost",
    entry: (
      <div>
        <p>
          Companies prioritize their generation stack based on how long they
          take to ramp up and down, their marginal cost (fuel) and whether
          they're controllable. That ordering is called the merit order, and in
          Electrify it's simply the order of your Facilities list: the top of
          the list is asked to generate first, and each plant below only runs
          once the ones above it are maxed out.
        </p>
        <p>
          Here's a real-world generation stack from the PJM
          (Pennsylvania-Jersey-Maryland) market in 2008:
        </p>
        <Figure
          src="/images/manual-generation-stack.jpg"
          alt="Scatter chart of PJM generation capacity sorted from cheapest to most expensive. Renewables and nuclear supply the first 40 GW at under $20/MWh, coal carries the next 60 GW below $50/MWh, natural gas climbs steeply from there, and oil tops out around $300/MWh for the last few GW."
          width={825}
          height={471}
          sourceName="Penn State, EBF 200"
          sourceUrl="https://www.e-education.psu.edu/ebf200/node/151"
        />
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.RAMP_RATE,
    group: "Physics & Units",
    keywords: "spin up spin down startup time ramping responsive dispatchable",
    entry: (
      <div>
        <p>
          Ramp rate is how fast a plant can change its output, shown on the
          build screen as the ramp up/down time needed to go from zero to full.
        </p>
        <p>
          It's set by physics, not by choice. A gas turbine is essentially a jet
          engine and reaches full power in a minute or two. A coal or nuclear
          plant has to heat thousands of tons of metal and water evenly, and
          rushing it cracks things, so it takes hours. Batteries respond in
          under a second; pumped hydro needs about ten minutes to get the water
          moving.
        </p>
        <p>
          Demand can swing by a third between 4am and 6pm, so a fleet has to be
          able to follow it. A slow plant is only useful for the demand that's
          there all day, which is why ramp rate, not price, is usually what
          decides whether a plant can help with a peak.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.INTEREST_RATES,
    group: "Money",
    keywords:
      "prime rate loan borrowing credit leverage debt apr financing mortgage cpi cost of living",
    entry: (
      <div>
        <p>
          Financing a plant means borrowing most of its cost over 30 years, and
          the interest on that loan is an operating expense for every one of
          them. What you're quoted is built from two things: what money costs
          everybody, and what it costs <em>you</em>.
        </p>
        <p>
          The first is the <strong>prime rate</strong>, the benchmark banks lend
          their best customers at. It moves on a cycle of eight to twelve years
          rather than month to month, and you have no influence over it
          whatsoever. It has been as low as 3.25% and, in December 1980, as high
          as 21.5% - so a scenario set in 1980 is playing a genuinely different
          game to one set in 2020.
        </p>
        <p>
          The second is your <strong>credit</strong>, and that part is entirely
          yours. Four things are weighed: whether you're profitable, how much
          cash you're sitting on relative to what you're worth, how much of the
          fleet is already mortgaged, and how many years of revenue it would
          take to repay what you owe. Fall short on any of them and the premium
          over prime goes up. The important consequence is that{" "}
          <strong>debt makes debt more expensive</strong>: every plant you
          finance raises the price of financing the next one, which is exactly
          how it works for a real utility.
        </p>
        <p>
          A loan's rate is fixed on the day you sign it and never changes, so{" "}
          <em>when</em> you borrow matters permanently. Building out during a
          cheap decade leaves you paying that rate long after the economy has
          turned - and a plant financed at the top of a cycle is still paying
          for it thirty years later.
        </p>
        <p>
          <strong>Inflation</strong> is the other half of the same cycle, and it
          leads it: prices run away first, and rates are raised to chase them.
          It pushes up what fuel costs and what it costs to build and operate a
          plant, year after year. Your rate per kWh does not rise on its own to
          match, so on a long scenario inflation quietly eats your margin unless
          you're a public utility and can raise the rate yourself.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.RATES,
    group: "Money",
    keywords: "price per kwh electricity rate revenue tariff bill",
    entry: (
      <div>
        <p>
          Your rate is what you charge customers per kWh of electricity, and it
          multiplied by the energy you supply is essentially all of your
          revenue. Real US residential rates run somewhere around $0.10-$0.30
          per kWh depending on the state.
        </p>
        <p>
          In <strong>investor-owned</strong> scenarios the rate is fixed by the
          regulator and you can't change it, so the only lever you have on
          revenue is supplying more energy to more customers.
        </p>
        <p>
          In <strong>public-owned</strong> scenarios you set the rate yourself
          on the Finances tab, and it's part of how you're scored: your lifetime
          average rate is compared against the scenario's target, and every cent
          per kWh above or below moves your score. Charging more makes the books
          easy and the score bad, so the game is to keep the rate down while
          still funding the plants you need.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
    group: "Physics & Units",
    keywords: "storage losses battery pumped hydro charge discharge",
    entry: (
      <div>
        <p>
          Storage never gives back everything you put in. Round-trip efficiency
          is the share that survives the trip: charge a battery with 100 MWh at
          85% round-trip efficiency, and you get 85 MWh back out. The rest is
          lost as heat in the conversion, or - for pumped hydro, at about 80% -
          as friction and evaporation moving water uphill and back down.
        </p>
        <p>
          That loss is what storage costs you, on top of the build cost. It only
          pays off when the power you charge with is much cheaper than the power
          you displace, which is why storage earns its keep soaking up surplus
          wind and solar and discharging into the evening peak, and loses money
          shuttling energy around for its own sake.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.SCORE,
    group: "Gameplay",
    keywords:
      "points scoring high score end of game investor public replay watch",
    entry: (
      <div>
        <p>
          At the end of your term as CEO (each scenario has a different length),
          you'll receive a score for how well you did. Try to beat your score
          the next time you play!
        </p>
        <p>
          If you're logged in, your score goes on the scenario's global
          leaderboard along with a replay of the run that set it. Any score with
          a play button beside it can be watched from the start, at whatever
          speed you like - a good way to see how somebody else got there.
        </p>
        <p>Investor-owned scenarios are scored as follows:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>+4</td>
              <td>per $100M of net worth at the end</td>
            </tr>
            <tr>
              <td>+2</td>
              <td>per 100k customers at the end</td>
            </tr>
            <tr>
              <td>+1</td>
              <td>per TWh supplied</td>
            </tr>
            <tr>
              <td>-2</td>
              <td>
                per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>-8</td>
              <td>per TWh of blackouts</td>
            </tr>
          </tbody>
        </table>
        <p>Public-owned scenarios are scored as follows:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>+/-80</td>
              <td>
                per $0.01/kWh that your lifetime average rate lands below/above
                the scenario's target rate
              </td>
            </tr>
            <tr>
              <td>+10</td>
              <td>per TWh supplied</td>
            </tr>
            <tr>
              <td>-5</td>
              <td>
                per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>-10</td>
              <td>per TWh of blackouts</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.TOTAL_COST_OF_ENERGY,
    group: "Money",
    keywords: "lcoe levelized cost of energy cost per mwh total energy cost",
    entry: (
      <p>
        Also known as "Levelized Cost of Energy", it's the expected cost of all
        energy produced by the plant during its lifetime, including
        construction, maintenance and fuel.
      </p>
    ),
  },
];
