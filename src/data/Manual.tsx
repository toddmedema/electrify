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
  CUSTOMER_PROGRAMS: "Customer programs",
  HOW_TO_PLAY: "How to Play",
  BASELOAD_VS_PEAKER: "Baseload vs Peaker",
  BLACKOUTS: "Blackouts",
  BTU: "BTU and MMBTU",
  CAPACITY_FACTOR: "Capacity Factor",
  CARBON_FEE: "Carbon Fee",
  CUSTOMERS: "Customers, Demand & Pricing",
  EMISSIONS: "Emissions and CO2e",
  FORECASTS: "Insights & data layers",
  HYDROPOWER: "Hydropower & Reservoirs",
  INTEREST_RATES: "Interest Rates & Inflation",
  KEYBOARD_SHORTCUTS: "Keyboard Shortcuts",
  PRIORITIZING_GENERATORS: "Prioritizing Generators",
  RAMP_RATE: "Ramp Rate",
  RATES: "Rates",
  POWER_AND_ENERGY: "Power and Energy",
  RESERVE_CAPACITY: "Reserve Capacity",
  INTERTIES: "Interties",
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
  related?: ManualEntryTitleType[];
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
    title: "Customer programs",
    group: "Gameplay",
    keywords: "efficiency rooftop solar rebates funding adoption demand",
    entry: (
      <p>
        In Insights, Customer programs lets you fund efficiency or rooftop solar
        rebates. Choose Off, Small, or Large and compare estimated utility
        demand before applying next month. Funding persists until changed.
        Charges pay only for new upgrades, up to the monthly budget, and stop at
        full adoption. Off stops new adoption and spending; installed upgrades
        stay for the rest of the run. Efficiency reduces residential and
        commercial use. Solar offsets their remaining daylight load, with
        surplus curtailed and no export payment. It does not directly cover an
        evening peak. Lower demand also means less electricity sold, so compare
        cash as well as peak demand.
      </p>
    ),
  },
  {
    title: MANUAL_ENTRY.HOW_TO_PLAY,
    group: "Gameplay",
    pinned: true,
    related: [
      MANUAL_ENTRY.POWER_AND_ENERGY,
      MANUAL_ENTRY.FORECASTS,
      MANUAL_ENTRY.SCORE,
    ],
    keywords: "getting started tutorial basics overview intro new player",
    entry: (
      <div>
        <p>
          You run an electric utility: a company that supplies electricity.
          Every hour, your customers need power. Meet that demand with
          generation, stored energy, or imports where available. Supply too
          little and you cause blackouts; spend too much and the company runs
          out of money.
        </p>
        <p>
          Start with three questions: will it keep the lights on, can you afford
          it, and what will it emit? The game handles plant startups, reservoir
          releases, and loan calculations automatically.
        </p>
        <p>
          One simulated day represents a month. This makes long games playable,
          but a four-hour battery still supplies power for about four hours when
          full. A successful day does not prove a real grid could survive
          several windless days.
        </p>
        <p>
          <strong>Facilities</strong> is your fleet. Generators higher in the
          list are asked to run first, so the order you put them in decides
          which ones burn fuel and which ones sit idle. Build from here. A
          backup plant may earn little but still prevent a costly blackout;
          check when it is needed before pausing or selling it.
        </p>
        <p>
          <strong>Insights</strong> combines the company's finances and its
          operational forecast. Choose data layers such as profit, supply,
          weather or fuel prices, then use the shared time range to read them
          together. This is also where you set the electricity rate.
        </p>
        <p>
          Pause and find a difficult hour in Insights when demand nearly exceeds
          supply. Solar helps in daylight; wind follows the weather, so check
          their output during that difficult hour. Compare controllable
          generation, storage backed by a surplus, and an available intertie.
          Check when each could be ready, its ongoing costs and its emissions
          before committing. Then run the game, observe the result and explain
          the tradeoff in one sentence.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.SYMBOLS,
    group: "Gameplay",
    keywords:
      "icons glyphs legend key money supply demand blackout customers generator storage build buy reorder pause play time construction finances forecast rate pricing fuel weather danger goal",
    entry: (
      <div>
        <p>
          These symbols mean the same thing in missions, controls, events and
          results. The same symbol always represents the same idea throughout
          the game.
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
          Electricity demand rises and falls during each day. Power companies
          often meet it with a mix of plants that run steadily and plants that
          can start quickly when demand peaks.
        </p>
        <p>
          <strong>Baseload</strong> describes the plants used to cover the
          demand that is present most of the time. Nuclear and coal plants often
          fill this role because they can be costly or slow to start and stop.
          Some hydro plants can also provide steady power, but many can change
          output quickly.
        </p>
        <p>
          <strong>Peakers</strong> - typically gas turbines - are the opposite.
          Cheap to build, expensive to run, and able to go from cold to full
          output in minutes. They spend most of the year switched off and earn
          their keep on the handful of days when demand spikes.
        </p>
        <p>
          Most of a peaker's cost comes from the fuel it burns, so an idle one
          costs relatively little. Much of a baseload plant's cost is paid
          whether it runs or not. A grid usually needs a mix: steady plants for
          regular demand and flexible plants for short peaks. These are
          operating roles, and some generators can serve more than one role.
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
          In Electrify, a blackout happens when available supply cannot meet
          demand. Repeated blackouts cost you customers, which lowers revenue.
        </p>
        <p>
          The game does not charge a separate damage bill for each blackout, but
          outages still reduce customers, revenue, score, and job security.
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
        A British thermal unit (Btu) measures heat energy. One MMBtu means one
        million Btu, equal to about 293 kWh of heat. A power plant produces less
        electricity because some energy is lost during conversion.
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
          Capacity factor compares how much electricity a generator actually
          produces with the most it could produce if it ran at full power all
          year. A 100 MW plant at a 45% capacity factor produces as much energy
          in a year as a 45 MW plant running continuously.
        </p>
        <p>
          It is shown on the build screen as expected output, and it is why a
          plant's maximum rated size alone tells you very little. Nuclear often
          runs above 90%. Coal and gas depend on fuel costs and how often you
          choose to run them. Wind and solar depend on local weather and
          seasons, so the same solar farm can perform differently in each
          scenario.
        </p>
        <p>
          Sunlight is the main driver of solar output. Hotter panels produce
          slightly less power from the same sunlight; panel temperature also
          rises in strong sun. The game estimates this effect automatically and
          caps output at the plant's rated power.
        </p>
        <p>
          Capacity factor is what turns a build cost into a cost per MWh, so
          it's baked into every Total Cost of Energy figure you see.
        </p>
        <p>
          Onshore wind uses a simple farm-speed estimate from the weather
          readings, checked against a broad fleet-average capacity factor. It is
          not a measured forecast for a particular wind farm; terrain and
          turbine siting can change real output.
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
          A carbon fee charges power plants for the greenhouse gases they
          release. Plants with higher emissions pay more for each unit of
          electricity they generate.
        </p>
        <p>
          The fee is based on greenhouse gas emissions, measured in{" "}
          <LargeMassUnit /> of carbon dioxide equivalent (CO2e). It appears in
          the profit-and-loss statement as an operating expense for each
          megawatt-hour (MWh) generated. At <ExampleCarbonFee />, a coal plant
          can become more expensive to run than a gas plant, changing the order
          in which the grid uses them.
        </p>
        <p>
          Scenarios set their own fee, and custom games let you dial it from $0
          upwards. A higher fee makes emitting plants more expensive to run. Oil
          plants pay for their fuel-burning emissions too: quick construction
          does not make them cheap for years of steady generation. Compare the
          displayed emissions and total cost before building.
        </p>
        <p>
          The game's fee applies to local generation. Purchased electricity adds
          estimated emissions to your score, but no separate local carbon fee:
          its cost appears in the wholesale electricity bill.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.HYDROPOWER,
    group: "Physics & Units",
    keywords:
      "hydro rain precipitation watershed snow snowpack melt runoff dam reservoir spill drought deadpool minimum power pool water rights irrigation municipal must run",
    entry: (
      <div>
        <p>
          A hydroelectric plant generates power when operators release stored
          water through its turbines. Its supply depends on rain, melting snow,
          and the amount of water left in its reservoir.
        </p>
        <p>
          Rain and snowmelt create runoff across the watershed, the land that
          drains into the reservoir. Every MWh the turbines generate lowers the
          reservoir. Water above the dam's capacity spills and cannot be
          recovered, while a drought can empty the usable supply.
        </p>
        <p>
          The <strong>Water</strong> forecast appears once you own conventional
          hydro. It plots monthly precipitation, snow-water equivalent and the
          fleet's reservoir level together. Cold months can store precipitation
          as snow instead of immediate runoff, then release it during a warm
          melt. Weather and scenario events affect this timing; your utility's
          emissions do not change the local weather in the game.
        </p>
        <p>
          Reservoirs also serve farms, cities, ecosystems and cultural uses.
          Those <strong>water rights</strong> create a seasonal minimum release.
          When the pool is high enough, that water becomes must-run generation
          even if demand is low. Below the dead-pool floor the plant cannot
          produce power, but required water can still bypass its turbines. These
          releases happen automatically. Your main decision is how much to rely
          on hydro when its water supply is low.
        </p>
        <p>
          Reservoir and watershed sizes are simplified game assumptions. These
          charts explain seasonal scarcity, not the engineering of a real dam.
        </p>
        <p>
          Pumped Hydro is different: Electrify models it as closed-loop storage,
          so it only returns electricity previously used to pump water uphill.
          It does not receive rain or river inflow, and evaporation slowly
          reduces its stored energy.
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
          More customers drive up electricity demand. Homes, businesses, and
          factories use electricity in different patterns, so the game combines
          them into one customer total. Here is what those patterns look like in
          real life:
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
          In investor-owned scenarios, you compete with other electricity
          companies for a finite market. Charge less than the market rate and
          customers gradually switch to you; charge more and they gradually
          leave. They react to several months of bills rather than a single rate
          change. Your customer base also naturally grows or shrinks depending
          on whether you provide good service, including avoiding blackouts.
        </p>
        <p>
          Gradual changes are kept internally even in a very small utility. The
          displayed whole-customer count may stay unchanged for a while; that
          does not mean the effect of your decision has disappeared.
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
          CO2e means carbon dioxide equivalent. It puts the warming effects of
          different greenhouse gases on one common scale, so you can compare
          power plants.
        </p>
        <p>
          Each generator lists the <MassUnitName /> of CO2e it releases per
          megawatt-hour (MWh) of electricity. This makes the emissions from a
          coal plant and a gas plant of the same size comparable.
        </p>
        <p>
          A carbon fee is one policy option that gives businesses a financial
          reason to lower emissions. Electrify lets you test different fee
          levels and observe how they change costs, investment choices, and the
          mix of power plants on the grid.
        </p>
        <p>
          Climate change depends on worldwide emissions over time. Your utility
          contributes to that problem, but its emissions do not set local
          temperatures, wind, or sunshine in this game. Emissions still affect
          carbon fees and your score.
        </p>
        <p>
          The total combines local plant emissions with estimated emissions from
          purchased electricity. Insights shows both parts; Interties lists the
          neighboring-grid assumptions and sources. These are fixed
          generation-mix proxies, sometimes a world-average fallback, not a
          measured hourly or historical mix.
        </p>
        <p>
          Local fuel factors estimate combustion CO2. Biomass includes the CO2
          released when burned, with no credit for later regrowth. Most import
          factors also report CO2; the Québec source reports greenhouse gases in
          CO2e. This is an operating-emissions comparison, not a complete
          inventory of construction, fuel supply or land-use impacts. Zero
          reported emissions do not mean zero real-world impact.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.FORECASTS,
    related: [
      MANUAL_ENTRY.RESERVE_CAPACITY,
      MANUAL_ENTRY.INTERTIES,
      MANUAL_ENTRY.POWER_AND_ENERGY,
    ],
    group: "Gameplay",
    keywords: "projection supply demand fuel prices weather peak shortage",
    entry: (
      <div>
        <p>
          Insights shows what may happen to the grid and the company in the
          future. Choose a preset question or use Layers to build your own view.
          Every chart covers the same time period, and a shared marker lets you
          compare values on the same date.
        </p>
        <p>
          <strong>Supply &amp; Demand</strong> plots your projected output
          against projected demand. Wherever demand rises above supply, the gap
          is shaded as a blackout. The summary underneath estimates total energy
          not served and the largest power shortage. Inspect the shaded dates to
          see when extra supply is needed. Shortfall energy is scaled to the
          represented month; the shaded period is not the duration of a real
          continuous outage.
        </p>
        <p>
          <strong>Supply by Fuel</strong> shows gross local generation by fuel,
          in dispatch order. This is where you can see your merit order at work.
          Available supply also includes storage discharge and imports, and
          subtracts electricity used for charging or exports. The fuel stack can
          therefore be higher than the supply available to customers.
          Re-ordering your facilities changes this chart.
        </p>
        <p>
          <strong>Stored Energy</strong> (shown once you own storage) tracks how
          much energy is available in batteries and reservoirs. Their power
          rating tells you how quickly they can charge or discharge.
        </p>
        <p>
          <strong>Fuel Prices</strong> distinguishes historical data from
          estimated future prices. Open{" "}
          <strong>Compare possible costs in five years</strong> to compare
          slower, baseline and faster price growth. It holds this month's fuel
          use and fleet fixed, multiplies the fuel bill by 12, and applies 2%,
          4% or 6% annual price growth. These are possible costs with no
          assigned probability, not predictions or a full simulation of three
          future grids. They change no game settings or existing loan contracts.
        </p>
        <p>
          <strong>Temperature</strong> projects heating and cooling conditions,
          while <strong>Renewable Capacity Factors</strong> translates local
          wind, sunshine and watershed runoff into expected output for every
          weather-driven technology available there, whether or not you have
          built it. Once you own hydro, a separate <strong>Water</strong> chart
          shows watershed precipitation, snowpack and reservoir level.
        </p>
        <p>
          Demand automatically uses a broad cooling, mixed, electric-heating or
          fuel-heating pattern appropriate to the location. These authored
          patterns preserve weather-driven peaks without asking you to choose
          building coefficients; they are not measured city load curves.
        </p>
        <p>
          One representative day stands for a month. Energy and bills scale to
          the month, while a four-hour battery lasts four simulated hours. Try
          Deep Freeze and Heatwave + Drought for tougher conditions. Those
          scenarios use the same time shortcut: success does not prove a grid
          could survive several consecutive windless or cloudy days.
        </p>
        <p>
          Insight projections assume you make no further changes, so treat them
          as "what happens if I do nothing" rather than a promise. Pausing a
          generator or reordering your stack updates them immediately, which
          makes them a cheap way to test a decision before you pay for it.
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
          Power companies choose which generators run first. In Electrify,
          plants at the top of the Facilities list are used before plants below
          them. This ranking is called the dispatch order, or merit order.
        </p>
        <p>
          Companies build that order around each plant's fuel cost, how quickly
          it can change output, and whether operators can control when it runs.
          Controllable plants lower in the list cover the remaining need.
          Ramping and minimum output can limit how closely they follow that
          request; solar and wind output follow the weather. The game handles
          startups and shutdowns automatically.
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
          Ramp rate describes how quickly a generator can raise or lower its
          power output. The build screen shows the approximate time needed to go
          from zero to full power.
        </p>
        <p>
          It's set by physics, not by choice. A gas turbine works on similar
          principles to a jet engine and reaches full power in a minute or two.
          A coal or nuclear plant has to heat thousands of tons of metal and
          water evenly, and rushing it cracks things, so it takes hours.
          Batteries respond in under a second; pumped hydro needs about ten
          minutes to get the water moving.
        </p>
        <p>
          Thermal plants also have a <strong>minimum stable output</strong>.
          While online they cannot sit at a trace output: depending on the
          technology, Electrify holds them at 15% to 50% of nameplate. When
          demand falls below that level, dispatch compares the predicted cost of
          running at minimum with the next start cost, then either keeps the
          plant online or begins shutting it down.
        </p>
        <p>
          Demand can swing by a third between 4am and 6pm, so a fleet has to be
          able to follow it. Slow plants work best when demand stays steady. For
          a peak, compare both the cost and how quickly a plant can respond; a
          low price alone does not guarantee timely power.
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
          Start with the down payment, monthly loan payment and estimated upkeep
          in the purchase review. Payments begin during construction, before the
          plant earns money. Leave cash for fuel, carbon fees and other bills
          too. Financing means borrowing most of the cost; the game calculates
          the loan automatically.
        </p>
        <details>
          <summary>How lenders set the quoted rate</summary>
          <p>
            The <strong>prime rate</strong> is a benchmark interest rate for
            strong borrowers. It changes with the wider economy, and you cannot
            control it. It has been as low as 3.25% and, in December 1980, as
            high as 21.5%, so a scenario set in 1980 plays differently from one
            set in 2020.
          </p>
          <p>
            The second is your <strong>credit</strong>, and that part is
            entirely yours. Four things are weighed: whether you're profitable,
            how much cash you're sitting on relative to what you're worth, how
            much of the fleet is already mortgaged, and how many years of
            revenue it would take to repay what you owe. Fall short on any of
            them and the premium over prime goes up. The important consequence
            is that{" "}
            <strong>more debt can make new borrowing more expensive</strong>.
            Check the quoted down payment and monthly payment before building.
            This reflects the real-world idea that heavily indebted companies
            often pay more to borrow.
          </p>
        </details>
        <p>
          A loan's rate is fixed on the day you sign it and never changes, so{" "}
          <em>when</em> you borrow matters permanently. Building out during a
          cheap decade leaves you paying that rate long after the economy has
          turned - and a plant financed at the top of a cycle is still paying
          for it thirty years later.
        </p>
        <p>
          <strong>Inflation</strong> is a broad rise in prices. Central banks
          may raise interest rates when inflation is high. In the game,
          inflation pushes up fuel, construction, and operating costs. Your rate
          per kWh does not rise automatically, so inflation can reduce your
          profit margin unless you adjust the rate when the scenario allows it.
        </p>
        <p>
          Future price growth and economic cycles are authored estimates.
          Compare possible costs in Insights before taking on debt; those
          comparisons do not reprice a loan you already signed.
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
          creates nearly all of your revenue. Multiply this rate by the
          electricity you sell to estimate your revenue. The game models each
          scenario's market and rules separately.
        </p>
        <p>
          In <strong>investor-owned</strong> scenarios you compete for
          customers. The market rate begins at the scenario's advertised rate
          and rises with inflation. Charge below it to gain market share or
          above it to earn more from each customer while accepting that some
          will leave. Switching takes several months, and the available market
          is finite.
        </p>
        <p>
          In <strong>publicly owned</strong> scenarios you set the rate yourself
          in Insights, and it's part of how you're scored: your lifetime average
          rate is compared against the scenario's target, and every cent per kWh
          above or below moves your score. Charging more makes the books easy
          and the score bad, so the game is to keep the rate down while still
          funding the plants you need.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.POWER_AND_ENERGY,
    group: "Physics & Units",
    keywords:
      "MW MWh watts watt hours megawatt megawatt-hour battery duration discharge power energy capacity",
    related: [MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY, MANUAL_ENTRY.FORECASTS],
    entry: (
      <div>
        <p>
          MW measures power: how quickly a plant produces electricity or storage
          charges or discharges. MWh measures energy: how much electricity is
          produced or stored over time.
        </p>
        <p>
          A full 20 MW battery holding 80 MWh can deliver 20 MW for about four
          hours, before further standing losses. Holding 80 MWh does not let it
          supply 80 MW. Check both its power and its duration against the
          shortage.
        </p>
        <p>
          One simulated day represents a month, but a four-hour battery still
          lasts four simulated hours. A successful representative day does not
          prove a real grid could survive several cloudy or windless days.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.RESERVE_CAPACITY,
    group: "Gameplay",
    keywords:
      "headroom spare capacity cushion fifteen minutes reliability warning",
    related: [
      MANUAL_ENTRY.RAMP_RATE,
      MANUAL_ENTRY.INTERTIES,
      MANUAL_ENTRY.FORECASTS,
    ],
    entry: (
      <div>
        <p>
          Reserve is extra demand the grid could cover within 15 minutes. It is
          spare capacity, not electricity that must be generated and left
          unused.
        </p>
        <p>
          The estimate allows for ramping, plant limits, water and stored
          energy. Stopping charging or redirecting exports can help too. Unused
          import promises do not count toward reserve.
        </p>
        <p>
          A low-reserve warning is a cue to investigate the difficult hours and
          compare available backup. The game's 10% warning is a teaching guide,
          not a real-world reliability standard or a guarantee against
          blackouts.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.INTERTIES,
    group: "Gameplay",
    keywords:
      "transmission power exchange imports exports neighbor trading purchased emissions backup surplus",
    related: [
      MANUAL_ENTRY.RESERVE_CAPACITY,
      MANUAL_ENTRY.EMISSIONS,
      MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
    ],
    entry: (
      <div>
        <p>
          Interties connect neighboring grids. Your trading rule can buy backup
          during shortages and sell surplus after customers and storage
          charging. Electricity used to charge storage cannot also be sold.
        </p>
        <p>
          Imports are limited by the line and the neighbor's available supply;
          hot, sunny weather can reduce line capacity. They are not guaranteed
          backup. Check construction time, loan payments, maintenance and the
          wholesale electricity bill before relying on a new connection.
        </p>
        <p>
          Purchased electricity adds estimated emissions to your total and
          score, shown separately in Insights. Each neighboring grid uses a
          fixed emissions factor, with its basis and source listed in the
          Interties panel. Imports pay their wholesale bill rather than an extra
          local carbon fee. These simplified flows and fixed factors are not a
          network engineering study or a full lifecycle assessment.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
    related: [
      MANUAL_ENTRY.POWER_AND_ENERGY,
      MANUAL_ENTRY.PRIORITIZING_GENERATORS,
    ],
    group: "Physics & Units",
    keywords: "storage losses battery pumped hydro charge discharge",
    entry: (
      <div>
        <p>
          Storage never gives back everything you put in. Round-trip efficiency
          is the share that survives charging and discharging. At 80%
          efficiency, drawing 10 MWh from the grid leaves 8 MWh to use later.
          The game takes that conversion loss when charging, so the stored
          energy bar shows what remains available. Self-discharge and
          evaporation can gradually reduce it further while game time runs, even
          if the storage facility is paused. Pausing the game clock stops these
          losses too.
        </p>
        <p>
          Charging cannot use more than the available surplus or the storage
          system's power rating. With a 10 MW surplus for one hour and 80%
          efficiency, at most 8 MWh is stored. That charging electricity cannot
          also power customers or be sold to a neighbor. Pausing storage stops
          its charging and discharging requests.
        </p>
        <p>
          That loss is one cost of storage, on top of the build cost. Storage is
          most valuable when the power used to charge it is cheaper than the
          power it replaces, such as when it absorbs surplus wind or solar and
          discharges during the evening peak.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.SCORE,
    group: "Gameplay",
    keywords:
      "points scoring high score meaningful decisions end of game investor public replay watch",
    entry: (
      <div>
        <p>
          At the end of your term as CEO (each scenario has a different length),
          you'll receive a score for how well you did. Try to beat your score
          the next time you play!
        </p>
        <p>
          Points reflect the scenario's ownership and teaching priorities.
          Compare reliability, operating expenses plus interest, and emissions
          separately in the scenario details. A high total is not a universal
          verdict on a utility's social value.
        </p>
        <p>
          Open Victory conditions to check required reliability, customer
          retention and decision goals for either ownership type. Regular
          scenarios end early when cash is negative at a month-end check, or
          less than 90% of demand is served in each of three consecutive
          completed months. Intern requires one meaningful decision; CEO
          requires ten across four types. These are learning rules, not
          regulatory standards. Tutorial missions have their own objectives.
        </p>
        <p>
          If you're logged in, your score goes on the scenario's global
          leaderboard along with a replay of the run that set it. Any score with
          a play button beside it can be watched from the start, at whatever
          speed you like - a good way to see how somebody else got there.
        </p>
        <p>
          Saves and replays require compatible simulation rules. This version
          uses save format 6 and replay format 8 and cannot open runs saved
          under earlier simulation rules. Original files are left unchanged and
          need the older game version to open.
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
              <td>per TWh of demand not served during blackouts</td>
            </tr>
          </tbody>
        </table>
        <p>Public-owned scenarios are scored as follows:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>+80</td>
              <td>
                per $0.01/kWh that your lifetime average rate is below the
                scenario's target rate
              </td>
            </tr>
            <tr>
              <td>-80</td>
              <td>
                per $0.01/kWh that your lifetime average rate is above the
                scenario's target rate
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
              <td>per TWh of demand not served during blackouts</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.TOTAL_COST_OF_ENERGY,
    group: "Money",
    keywords:
      "lcoe levelized cost of energy cost per mwh total energy cost oil fixed variable operating maintenance om",
    entry: (
      <div>
        <p>
          Total cost of energy estimates the average cost of all the electricity
          a plant will produce during its lifetime. It includes construction,
          estimated maintenance and startup costs, fuel, and the applicable
          carbon fee. It is also called the levelized cost of energy (LCOE).
          Loan interest is separate, so compare loan payments too. The quote
          uses estimated output and quoted fuel prices; it is not a guaranteed
          future bill.
        </p>
        <p>
          Accounting lifetime sets the period used for depreciation and cost
          estimates, not an automatic retirement date. Aging can reduce output
          or raise upkeep while a plant keeps running. Sites labeled available
          in this game are coarse project limits: zero sites does not prove the
          resource is physically impossible at that location.
        </p>
        <p>
          Operating and maintenance (O&amp;M) costs can be fixed or depend on
          output. Oil plants pay fixed O&amp;M while available, plus variable
          O&amp;M for each MWh they actually generate; pausing halves the fixed
          charge and stops the variable charge.
        </p>
        <p>
          A facility's lifetime revenue is an allocated share of the company's
          electricity sales, including exports. Charging does not create a
          second sale. The share supplied by imports is not credited to your
          local plants.
        </p>
      </div>
    ),
  },
];
