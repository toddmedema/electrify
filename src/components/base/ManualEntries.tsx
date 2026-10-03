import * as React from "react";
import KeyboardShortcuts, { SHORTCUTS_SEARCH_TEXT } from "./KeyboardShortcuts";
import ConceptLegend from "./ConceptLegend";
import { useUnits } from "./UnitsContext";
import {
  formatLargeMassApprox,
  formatPricePerLargeMass,
  KG_PER_MEGATONNE,
  largeMassUnit,
  massUnitName,
} from "../../helpers/Units";
import { formatDesignTemperature } from "./WeatherResilienceText";
import { INTERTIE_TREND_SOURCE_FAMILIES } from "../../data/IntertieTrendData";
import { COLD_PACKAGE_MAX_DESIGN_MIN_TEMP_C } from "../../data/Hazards";

// The entries are static markup, so the handful of places that name a unit read the setting
// through a component of their own rather than the array becoming a function of it. Their text
// is not walked by the search (see manualEntryText), which is what the keywords are for.
function MassUnitName(): React.JSX.Element {
  return <>{massUnitName(useUnits())}</>;
}

/**
 * The families of data behind every neighbour's emissions and price trend.
 */
function IntertieTrendSources(): React.JSX.Element {
  return (
    <ul className="manual-sources">
      {INTERTIE_TREND_SOURCE_FAMILIES.map(({ label, href }) => (
        <li key={label}>
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
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

function ColdPackageRating(): React.JSX.Element {
  return (
    <>
      {formatDesignTemperature(COLD_PACKAGE_MAX_DESIGN_MIN_TEMP_C, useUnits())}
    </>
  );
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
  OPERATING_COSTS: "Operating costs",
  FUEL_COSTS: "Fuel costs",
  ACCOUNTING_LIFETIME: "Accounting lifetime",
  PROJECT_SITES: "Project sites",
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
  WEATHER_DAMAGE: "Weather Damage",
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
    keywords:
      "efficiency rooftop solar rebates build-out project pause resume completion demand time-of-use tariff curtailment contracts peak enrollment wildfire preparedness fire season",
    entry: (
      <div>
        <p>Customer programs are set in Insights. Changes start next month.</p>
        <p>
          <strong>Efficiency and rooftop solar rebates:</strong> Each is a
          one-time, 48-month project with a fixed monthly cost and no cost after
          completion. Pause installations and resume where you left off. Both
          reduce electricity sales.
        </p>
        <p>
          Efficiency cuts home and business use by 10%, and heating and cooling
          by 35%, saving most in hot or cold places. Savings fade after 10 years
          and disappear after 20.
        </p>
        <p>
          Rooftop solar cuts home and business daylight demand; surplus is
          discarded without payment. Panels produce most in sunny, cooler
          places. Rebates cost several times more in the early 2000s than today.
        </p>
        <p>
          <strong>Time-of-use tariff:</strong> Half of homes move 20% of their
          use from your chosen four-hour window to the next three hours, without
          changing total use. They pay 30% above the base rate in the window,
          10% below in the next three hours, and the base rate otherwise.
        </p>
        <p>
          <strong>Peak curtailment contracts:</strong> Half of industrial and
          data-center demand participates, cutting use by 20% during a separate
          four-hour window even when supply is sufficient. This use is canceled,
          not delayed. Participants get 10% off electricity delivered all day.
        </p>
        <p>
          <strong>Wildfire preparedness:</strong> In custom games in fire-prone
          areas, fund crews, inspections and vegetation clearing year-round. The
          budget stays fixed while active and is billed monthly, with no upfront
          payment or annual renewal. Protection builds steadily to full strength
          over 12 months. Turning it off stops spending immediately; protection
          fades over 12 months. Restarting builds from the remaining protection
          over 12 months.
        </p>
        <p>
          Full protection halves customer disconnections from safety shutoffs
          and output losses at affected generators; partial protection scales
          those benefits. It does not prevent fires or restoration costs. The
          program preview models a typical fire next season using the protection
          projected for that month. Fires already underway keep their original
          response.
        </p>
      </div>
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
          You run an electric utility: a company that supplies electricity. Meet
          customers' demand with generators, stored energy or imports. Too
          little supply causes blackouts; too much spending drains your cash.
        </p>
        <p>
          <strong>Facilities:</strong> Build and manage your plants here.
          Generators higher in the list run first when possible. One simulated
          day represents a month.
        </p>
        <p>
          <strong>Insights:</strong> Manage your finances, electricity rates,
          customer programs and future forecasts here.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.SYMBOLS,
    group: "Gameplay",
    keywords:
      "icons glyphs legend key money supply demand blackout customers generator storage build buy reorder pause play time construction finances forecast rate pricing fuel weather severe storm hail cold danger goal",
    entry: (
      <div>
        <p>These symbols have the same meaning throughout the game.</p>
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
          <strong>Baseload</strong> is demand present most of the time. Nuclear
          and coal plants often cover it because they are costly or slow to
          start and stop.
        </p>
        <p>
          <strong>Peakers</strong>, usually gas turbines, start quickly to cover
          short peaks. They cost relatively little to build but burn expensive
          fuel. Keeping one idle can be cheaper than a blackout.
        </p>
        <p>
          Gas comes in both roles. A <strong>Natural Gas Peaker</strong> is a
          single turbine that starts in minutes. A{" "}
          <strong>Natural Gas CC</strong> (combined cycle) reuses the turbine's
          hot exhaust to raise steam for a second turbine, so it burns about a
          third less gas per MWh, but it starts slowly and suits steady,
          mid-merit demand. A new gas peaker joins the dispatch order below your
          other generators; other new plants join at the top.
        </p>
        <p>
          Many grids use both steady and flexible plants. These are operating
          roles: hydro, for example, can provide steady power or change output
          quickly.
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
          A blackout happens when available supply falls below demand. Outages
          hurt customer numbers, revenue, score and job security.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BTU,
    group: "Physics & Units",
    keywords: "british thermal unit mmbtu heat energy kwh mwh",
    entry: (
      <div>
        <p>
          A British thermal unit (Btu) measures heat energy. One MMBtu is one
          million Btu, about 293 kWh of heat. A generator converts only part of
          that heat into electricity.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.CAPACITY_FACTOR,
    group: "Physics & Units",
    keywords: "uptime utilization average output nameplate capacity",
    entry: (
      <div>
        <p>
          Capacity factor is actual energy output divided by the energy a plant
          could produce at full power over the same period. A 100 MW plant at
          45% averages 45 MW; it does not always deliver 45 MW.
        </p>
        <p>
          The build screen uses expected capacity factor to estimate cost per
          MWh. Fuel costs and your choices affect how often coal and gas run.
          Wind and solar depend on weather and seasons. Hot panels produce less
          power from the same sunlight.
        </p>
        <p>
          Wind estimates use simplified weather calculations. Real output also
          depends on terrain and turbine placement.
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
          A carbon fee charges for emissions in <LargeMassUnit /> of carbon
          dioxide equivalent (CO2e). Higher-emitting plants pay more per MWh. At{" "}
          <ExampleCarbonFee />, coal can become more expensive to run than gas.
        </p>
        <p>
          The fee appears as an operating expense. Imports add emissions to your
          score but pay no separate local carbon fee: their cost is in the
          wholesale bill.
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
          Hydroelectric plants release stored water through turbines. Rain and
          melting snow refill the reservoir from its watershed: the surrounding
          land that drains into it. Generation lowers the reservoir; drought
          limits supply, and excess water spills.
        </p>
        <p>
          Once you own hydro, the <strong>Water</strong> chart shows
          precipitation, snow and reservoir levels. Winter snow can delay supply
          until spring. Select a dam to see what limits its output and its
          reservoir forecast for the next year.
        </p>
        <p>
          <strong>Water rights</strong> require releases for farms, cities and
          other uses. These automatically generate power when the reservoir is
          high enough, even with low demand. Below the minimum generating level,
          required water bypasses the turbines.
        </p>
        <p>
          Reservoir sizes are simplified game assumptions. Pumped Hydro is
          separate storage: it uses electricity to pump water uphill, receives
          no river or rain inflow in the game, and loses stored energy to
          evaporation.
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
          Homes, businesses and factories use electricity at different times.
          More customers raise demand; weather and daily routines change when it
          peaks.
        </p>
        <Figure
          src="/images/manual-demand-customer-types.webp"
          alt="Three charts of monthly US retail electricity sales from 2009 to 2012. Residential sales swing hardest, peaking each summer and winter; commercial sales follow the same shape but with about half the swing; industrial sales stay nearly flat all year."
          width={576}
          height={288}
          sourceName="U.S. Energy Information Administration"
          sourceUrl="https://www.eia.gov/todayinenergy/detail.php?id=10211"
        />
        <p>
          A <strong>load shape</strong> shows demand over time. These weeks show
          how temperature, time of day and weekends affect it.
        </p>
        <Figure
          src="/images/manual-demand.webp"
          alt="Hourly electricity load across a week in the PJM Mid-Atlantic region, plotted for a hot week, a cold week and a mild week of 2009. All three rise and fall once a day and drop over the weekend; the hot week peaks around 50,000 MW, roughly 20,000 MW above the mild week's overnight low."
          width={834}
          height={560}
          sourceName="Penn State, EBF 200"
          sourceUrl="https://www.e-education.psu.edu/ebf200/node/151"
        />
        <p>
          In investor-owned scenarios, lower prices gradually attract customers
          from a limited market. Higher prices and blackouts can drive them
          away. Switching takes months; small changes may not immediately appear
          in the rounded customer count.
        </p>
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
          CO2e means carbon dioxide equivalent: a common scale for the warming
          effects of greenhouse gases. Plants list emissions in <MassUnitName />{" "}
          per megawatt-hour (MWh).
        </p>
        <p>
          Your total includes local generation and purchased electricity.
          Insights separates them; Interties lists import estimates. Sources are
          listed in the Interties manual entry. Import emissions per MWh stay
          fixed rather than tracking each hour's generation.
        </p>
        <p>
          Local estimates count CO2 from burning fuel, including biomass without
          credit for regrowth. Most import estimates also count CO2; Québec's
          counts greenhouse gases as CO2e. Fuel supply and land use are
          excluded, so zero reported emissions does not mean zero environmental
          impact.
        </p>
        <p>
          Construction also emits through materials and drilling. Each build
          card shows the total, spread evenly over construction. Wind, solar,
          nuclear and storage are therefore low-carbon, not carbon-free. These
          emissions carry no carbon fee in the game; the fee applies to local
          fuel burning.
        </p>
        <p>
          Emissions affect fees and score, but do not change local weather in
          the game.
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
          Insights forecasts what happens if you make no further changes. Choose
          a preset or select Layers. Charts share a time range and marker;
          pausing or reordering plants updates them.
        </p>
        <p>
          <strong>Supply &amp; Demand:</strong> Shading marks predicted
          blackouts. It shows missing energy and the largest power shortage.
          Unserved energy is scaled to a month; shaded hours are not a real
          outage's duration.
        </p>
        <p>
          <strong>Supply by Fuel:</strong> Local generation appears in dispatch
          order (merit order). Supply available to customers also includes
          storage discharge and imports, minus charging and exports.
        </p>
        <p>
          <strong>Stored Energy:</strong> Energy left in batteries and
          reservoirs. Power ratings limit how quickly you can use it.
        </p>
        <p>
          <strong>Fuel Prices:</strong> Historical prices and future estimates.{" "}
          <strong>Compare possible costs in five years</strong> applies 0.5%,
          2.5% or 4.5% yearly growth to this month's fuel bill multiplied by 12.
          It holds fuel use and facilities fixed, assigns no probabilities and
          changes no loans or settings.
        </p>
        <p>
          <strong>Temperature</strong> and{" "}
          <strong>Renewable Capacity Factors</strong> show weather and expected
          output. Demand uses a simplified local heating and cooling pattern.
          Owning hydro adds a <strong>Water</strong> chart for precipitation,
          snow and reservoirs.
        </p>
        <p>
          Forecasts use one day per month, as explained in How to Play. They
          cannot test extended cloudy or windless spells.
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
        <p>Use these keys during a scenario:</p>
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
          Plants higher in Facilities are asked to run first. This is the{" "}
          <strong>dispatch order</strong>, or merit order: in real electricity
          markets, the cheapest plants run first. In Electrify you choose the
          order yourself.
        </p>
        <p>
          Plants lower down cover remaining demand. Minimum output and ramp rate
          limit their response; wind and solar follow weather. Startups and
          shutdowns are automatic.
        </p>
        <p>This 2008 PJM electricity-market chart ranks generators by cost:</p>
        <Figure
          src="/images/manual-generation-stack.webp"
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
          Ramp rate is how quickly a generator raises or lowers output. The
          build screen estimates its time from zero to full power. Batteries
          respond quickly; coal and nuclear plants need time to heat equipment
          safely.
        </p>
        <p>
          Fuel-burning and nuclear plants also have a{" "}
          <strong>minimum stable output</strong>: the lowest power they can
          maintain while running. In Electrify, it is 15%–50% of rated power. At
          low demand, the game compares staying at minimum with shutting down
          and paying to restart.
        </p>
        <p>
          Response time determines which demand a plant can follow: fast plants
          cover short peaks, slow ones suit steady hours.
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
          Financing means borrowing part of a plant's cost: you pay the rest up
          front and repay the loan in monthly payments. Payments start during
          construction, before the plant earns money.
        </p>
        <p>
          The <strong>prime rate</strong> is a benchmark borrowing rate that
          changes with the economy. Your company's profit, cash, existing loans
          and ability to repay determine how much extra interest lenders charge.
          More debt can make new loans costlier.
        </p>
        <p>
          Each loan's interest rate stays fixed from signing, even as the
          economy changes.
        </p>
        <p>
          <strong>Inflation</strong> means rising prices. It increases fuel,
          construction and operating costs in the game. Your electricity rate
          does not rise automatically; you set it in Insights. A public
          utility's target rate and an investor's market rate both rise with
          inflation. Future economic conditions are estimates.
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
          Your rate is the price per kWh customers pay. Revenue is that price
          multiplied by electricity delivered, with adjustments for time-of-use
          tariffs and curtailment credits.
        </p>
        <p>
          <strong>Investor-owned:</strong> A rate below the market rate attracts
          customers; above it earns more per customer while some leave. The
          market rate rises with inflation; switching takes months.
        </p>
        <p>
          <strong>Publicly owned:</strong> Set your rate in Insights. A lifetime
          average below the scenario's target earns points; above it loses
          points.
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
          <strong>Power</strong> is how fast electricity is produced or used,
          measured in watts. A megawatt (MW) is a million watts.{" "}
          <strong>Energy</strong> is power multiplied by time: 1 MW for one hour
          equals 1 megawatt-hour (MWh). A kilowatt-hour (kWh) is one thousandth
          of a MWh; a terawatt-hour (TWh) is a million MWh.
        </p>
        <p>
          A full 20 MW battery holding 80 MWh can supply 20 MW for about four
          hours, allowing for storage losses. Holding 80 MWh does not let it
          supply 80 MW.
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
          Reserve is extra demand you could cover within 15 minutes. It counts
          power that plants and storage can add, plus stopping charging or
          redirecting exports. Unused import promises do not count.
        </p>
        <p>
          A low-reserve warning flags hours when demand is close to available
          supply. The game's 10% threshold is a teaching guide, not a real
          reliability standard or protection against every blackout.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.INTERTIES,
    group: "Gameplay",
    keywords:
      "transmission power exchange imports exports neighbor trading purchased emissions backup surplus peak price hydro solar wind archetype source citation CO2e proxy quebec california washington IEA EIA",
    related: [
      MANUAL_ENTRY.RESERVE_CAPACITY,
      MANUAL_ENTRY.EMISSIONS,
      MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
    ],
    entry: (
      <div>
        <p>
          Interties connect neighboring grids. Your trading rule buys during
          shortages and sells surplus after serving customers and charging
          storage. Your utility buys access to a limited share of a regional
          connection, not the entire neighboring grid. A wider wire cannot
          create more neighboring generation; multiple paths share the same
          neighbor’s spare supply and export demand.
        </p>
        <p>
          In missions, higher tiers can purchase more import access along with a
          wider connection. Both become available when construction finishes;
          export access stays unchanged. The review shows your import access
          before and after an upgrade. Custom games already have the full
          regional allocation, so their upgrades only widen the connection.
        </p>
        <p>
          Neighbors differ in spare power and prices. Each intertie&rsquo;s
          build card names the neighboring grid type, such as seasonal hydro or
          solar surplus. Open Show details for a description and monthly
          estimates of how much line capacity it can fill.
        </p>
        <p>
          &ldquo;At your peak&rdquo; matters most. It is how much the neighbor
          can usually send during your highest-demand hours, when a shortage
          would hurt. Neighbors that share your heat waves and cold snaps help
          less then, and even less on harder difficulties.
        </p>
        <p>
          Imports come from the cheapest available neighbor first, and exports
          go to the best-paying one. Hot, sunny weather can also reduce line
          capacity. Build details show typical import availability and price,
          including how much of the line is available at your peak. Live line
          details identify whether your wire, the neighbor, or your own demand
          and trading rule limits actual flow.
        </p>
        <p>
          Neighbors change with the era. Each one follows a researched trend of
          its grid&rsquo;s carbon intensity and wholesale price from about 1990,
          with official stated-policy outlooks to 2050 and flat estimates
          beyond. Purchased electricity adds that year&rsquo;s estimated
          emissions to your score, and imports get dearer or cheaper as the
          neighbor&rsquo;s market did, such as during the 2022 energy crisis. A
          connection can only be built once its real path existed. These are
          annual averages that do not model a full transmission network. The
          source families below document their basis.
        </p>
        <IntertieTrendSources />
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
          Round-trip efficiency is the share of charging energy returned as
          electricity. At 80%, drawing 10 MWh leaves 8 MWh to use. Electrify
          deducts this loss on charging; the energy bar shows what remains.
        </p>
        <p>
          Charging needs surplus power and cannot exceed the storage power
          rating. That electricity cannot also serve customers or be exported.
        </p>
        <p>
          Pausing storage stops charging and discharging. Self-discharge or
          evaporation still reduces stored energy until you pause the game
          clock.
        </p>
        <p>
          Storage can be cheaper than running expensive generation, once its
          losses and construction cost are counted.
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
          Check <strong>Victory conditions</strong> for reliability and customer
          goals. Tutorial missions have separate objectives.
        </p>
        <p>
          In all scenarios, you fail if you go bankrupt or serve less than 90%
          of demand in three consecutive months (95% on Expert difficulty).
        </p>
        <p>
          The tables below score your term; reliability, costs and emissions are
          shown separately. Logged-in players submit scores and replays to the
          leaderboard; a play button opens a replay.
        </p>
        <p>
          Saves and replays require compatible game rules. Older runs need their
          original game version; their files remain unchanged.
        </p>
        <p>Investor-owned points:</p>
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
        <p>Publicly owned points:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>±80</td>
              <td>
                per $0.01/kWh your rate is below/above the target rate (adjusted
                for inflation)
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
    title: MANUAL_ENTRY.OPERATING_COSTS,
    group: "Money",
    keywords:
      "O&M fixed base variable operations maintenance non-fuel start annual upkeep",
    related: [
      MANUAL_ENTRY.CAPACITY_FACTOR,
      MANUAL_ENTRY.TOTAL_COST_OF_ENERGY,
      MANUAL_ENTRY.WEATHER_DAMAGE,
    ],
    entry: (
      <div>
        <p>
          Operations and maintenance (O&amp;M) means upkeep, excluding fuel,
          carbon fees and loans.
        </p>
        <ul>
          <li>
            <strong>Fixed:</strong> Annual cost regardless of output.
          </li>
          <li>
            <strong>Base:</strong> Annual quote at the expected capacity factor.
          </li>
          <li>
            <strong>Variable:</strong> Cost per MWh generated.
          </li>
          <li>
            <strong>Non-fuel start cost:</strong> Maintenance charged each
            startup.
          </li>
        </ul>
        <p>
          The annual estimate includes expected output and 365 starts per year.
          Actual costs depend on operation. Oil plants pay fixed and variable
          O&amp;M; pausing halves the fixed charge and stops the variable
          charge.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.WEATHER_DAMAGE,
    group: "Gameplay",
    keywords:
      "hail storm freeze cold snap winterization repair resilience retrofit hardening hail-resistant panels cold-weather package solar trackers downtime",
    related: [MANUAL_ENTRY.OPERATING_COSTS, MANUAL_ENTRY.FUEL_COSTS],
    entry: (
      <div>
        <p>
          Hail and extreme cold strike at random. How often depends on the
          location. Neither happens in tutorials.
        </p>
        <ul>
          <li>
            <strong>Hail:</strong> Breaks part of a solar farm. The broken share
            produces nothing until repairs finish, usually within weeks. You pay
            the full repair cost.
          </li>
          <li>
            <strong>Extreme cold:</strong> Gas plants colder than their rating
            lose output for the month; a cold-weather package halves the loss. A
            deep regional freeze also raises gas prices.
          </li>
        </ul>
        <p>
          When building, you can add hail-resistant panels to solar (less
          damage) or a cold-weather package to gas (rated to{" "}
          <ColdPackageRating />, colder in cold climates). Either can be added
          later from the facility&apos;s details for 50% more, and the plant
          goes offline for a month while it&apos;s installed. You can cancel
          before then for a full refund. The cold-weather package is only
          offered where winters get cold enough to matter.
        </p>
        <p>
          Solar trackers, available from 2014, turn panels to follow the sun for
          more morning and evening power, about 20% more a year, and stow
          steeply to cut hail damage. They can only be added when building.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.FUEL_COSTS,
    group: "Money",
    keywords: "fuel price per MWh gas coal oil uranium heat rate",
    related: [MANUAL_ENTRY.BTU, MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
    entry: (
      <div>
        <p>
          The fuel quote is cost per MWh at current prices and plant efficiency.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.ACCOUNTING_LIFETIME,
    group: "Money",
    keywords: "lifespan years depreciation retirement aging",
    related: [MANUAL_ENTRY.TOTAL_COST_OF_ENERGY],
    entry: (
      <div>
        <p>
          The accounting lifetime is the number of years a plant's capital cost
          is spread over in your accounts. Real utilities depreciate power
          plants the same way: book value declines year by year over an expected
          useful life, even while the plant keeps running. Depreciation is an
          accounting allocation, not a cash payment.
        </p>
        <p>
          In Electrify it sets the horizon for cost estimates: lifetime cost and
          levelized cost of energy divide construction, upkeep and fuel by the
          energy expected over those years. It also sets resale value: a plant's
          book value declines evenly to zero over its accounting lifetime, so an
          early sale returns more of the build cost. Any outstanding loan is
          settled from the sale first.
        </p>
        <p>
          Plants can run beyond their accounting lifetime; some technologies
          lose a little output each year as they age.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.PROJECT_SITES,
    group: "Gameplay",
    keywords:
      "sites left viable locations remaining available hydro geothermal",
    entry: (
      <div>
        <p>
          Each project uses one site. Hydro takes the smallest remaining site
          that fits, including unused capacity. Sites cannot be combined.
          Cancelling before completion frees the site; sale or retirement does
          not. Missing research blocks new Hydro. An empty inventory does not
          prove the area has no hydro potential.
        </p>
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
          Total cost of energy, or levelized cost of energy (LCOE), estimates
          average cost per MWh over a plant's accounting lifetime. It includes
          construction, upkeep, startups, fuel and carbon fees. Loan interest is
          separate.
        </p>
        <p>
          The estimate depends on expected output and quoted fuel prices. Actual
          bills depend on how you run the plant; fixed and variable O&amp;M are
          explained under Operating costs.
        </p>
        <p>
          A plant's lifetime revenue is its share of electricity sales,
          including exports. Charging storage creates no extra sale, and imports
          earn no revenue for local plants.
        </p>
      </div>
    ),
  },
];
