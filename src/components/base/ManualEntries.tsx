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
// picture to someone who can't see it. A diagram drawn for the game (its source is in
// design/manual/) has nothing to cite, so it leaves the source out.
interface FigureProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  source?: { name: string; url: string };
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
      {props.source && (
        <figcaption>
          Source:{" "}
          <a href={props.source.url} target="_blank" rel="noreferrer">
            {props.source.name}
          </a>
        </figcaption>
      )}
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
        <p>
          You can meet growing demand by building more power plants, or by
          helping customers use less electricity. Set these programs in
          Insights; changes start next month.
        </p>
        <p>
          <strong>Efficiency and rooftop solar rebates:</strong> Each is a
          one-time project that takes 48 months, with a fixed monthly cost. You
          can pause installations and resume later. Both reduce demand, saving
          you from building more plants but also reducing your sales.
        </p>
        <p>
          Efficiency cuts home and business use by 10%, and heating and cooling
          by 35%, saving the most in hot or cold places. Those improvements
          don't last forever: savings fade after 10 years and are gone after 20.
        </p>
        <p>
          Rooftop solar cuts home and business daylight demand; you don't pay
          for any surplus electricity, which goes unused. Panels do best with
          plenty of sun and cooler temperatures. Rebates cost several times more
          in the early 2000s than today, because panel prices have fallen.
        </p>
        <p>
          <strong>Time-of-use tariff:</strong> Hourly prices nudge people to
          shift when they use electricity. Half of homes move 20% of their use
          from your chosen four-hour window to the next three hours. Total
          energy use stays the same. They pay 30% above the base rate during the
          window, 10% below it for the next three hours, and the base rate
          otherwise. Choose the hours when your grid is busiest.
        </p>
        <p>
          <strong>Peak curtailment contracts:</strong> Half of industrial and
          data-center demand participates, cutting use by 20% during a separate
          four-hour window, even when supply is sufficient. They use less energy
          overall. Participants get 10% off electricity delivered all day.
        </p>
        <p>
          <strong>Wildfire preparedness:</strong> In custom games in fire-prone
          areas, fund crews, inspections and vegetation clearing year-round, as
          California utilities do. You pay a fixed monthly cost while the
          program is active, with no upfront payment or annual renewal. It takes
          12 months to reach full protection. Turn it off and spending stops
          immediately, but protection fades over the next 12 months. Restarting
          builds on whatever protection remains.
        </p>
        <p>
          Full protection halves customer disconnections from safety shutoffs
          and output losses at affected generators. Partial protection gives
          smaller benefits. You still face fires and restoration costs. The
          preview estimates a typical fire next season, using the protection
          you'll have by then. Changing the program won't affect a fire that's
          already burning.
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
          You're the CEO of an electric utility, the company that keeps a
          region's lights on. Your job: supply the electricity customers need
          without running out of money. Build generators, store extra energy and
          trade with neighboring grids. Fall short and you'll cause blackouts.
        </p>
        <p>
          <strong>Facilities:</strong> Build and manage your plants here.
          Generators higher in the list run first when they can. To fit decades
          into one sitting, one simulated day represents a month.
        </p>
        <p>
          <strong>Insights:</strong> Manage finances, rates, customer programs
          and forecasts here.
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
        <p>These symbols mean the same thing everywhere in the game.</p>
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
          <strong>Baseload</strong> is the demand that's there around the clock,
          even at 3am. Nuclear and coal plants often cover it. They're slow or
          costly to start and stop, so it makes sense to keep them running.
        </p>
        <p>
          <strong>Peakers</strong>, usually gas turbines, start quickly to cover
          short peaks like hot summer evenings. They're cheap to build but burn
          expensive fuel. Keeping one ready for a few critical hours can be
          cheaper than a blackout, even if it sits idle most of the year.
        </p>
        <p>
          Gas comes in both roles. A <strong>Natural Gas Peaker</strong> is a
          single turbine that starts in minutes. A{" "}
          <strong>Natural Gas CC</strong> (combined cycle) reuses the turbine's
          hot exhaust to drive a second, steam-powered turbine. It burns about a
          third less gas per MWh, but takes longer to start, so it's better for
          demand that lasts several hours. A new gas peaker joins the dispatch
          order below your other generators; other new plants join at the top.
        </p>
        <p>
          Most grids need both steady and flexible plants. Hydro can do either
          job: run steadily or change output quickly.
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
          Electricity has to be supplied as it's used. A blackout happens when
          demand exceeds your available supply, including storage and imports.
          Outages cost you customers, revenue and points. Your job security is
          at stake too: too many blackouts and you're fired.
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
          A British thermal unit (Btu) measures heat energy, roughly what one
          kitchen match gives off. Fuel prices use MMBtu: a million Btu, or
          about 293 kWh of heat. A generator turns only some of that heat into
          electricity: about a third for old coal plants, over half for
          combined-cycle gas plants.
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
          A 100 MW plant won't produce 100 MW all the time. Its capacity factor
          compares the energy it actually produces with what it could produce
          running at full power. At 45%, it averages 45 MW over that period.
          This chart shows how much that varied by technology and region in
          2008–2012; wind and solar are grouped together:
        </p>
        <Figure
          src="/images/manual-capacity-factors.webp"
          alt="Bar chart of average electric generator capacity factors from 2008 to 2012 for 16 countries and regions, in four columns: nuclear, fossil fuels, hydropower, and solar and wind. US nuclear runs at 90%, US fossil fuels at 41%, US hydropower at 40% and US solar and wind at 27%. Solar and wind stay below 30% in every region."
          width={579}
          height={292}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=22832",
          }}
        />
        <p>
          The build screen uses expected capacity factor to estimate cost per
          MWh. The less it runs, the fewer MWh you have to spread its build cost
          over. Fuel costs and your choices affect how often coal and gas run.
          Wind and solar follow the weather; hot panels produce less power from
          the same sunlight.
        </p>
        <p>
          Wind estimates use simplified weather calculations. Real output also
          depends on terrain and siting.
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
          A carbon fee puts a price on pollution, per <LargeMassUnit /> of
          carbon dioxide equivalent (CO2e) emitted. Coal emits about twice as
          much per MWh as gas, so at <ExampleCarbonFee />, coal can cost more to
          run than gas.
        </p>
        <p>
          You'll find the fee in operating expenses. Imported electricity adds
          emissions to your score, but isn't charged a separate local carbon
          fee. You pay the wholesale price.
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
          Hydroelectric dams release stored water through turbines. Rain and
          melting snow refill the reservoir from its watershed: the land that
          drains into it. In effect, a dam is a battery the weather recharges.
          Generating uses up stored water. Drought leaves you with less to
          generate, while a full reservoir spills any extra.
        </p>
        <p>
          Once you own hydro, the <strong>Water</strong> chart shows
          precipitation, snow and reservoir levels. Snow falling in winter won't
          refill your reservoir until it melts. California's hydro output rises
          after the spring melt:
        </p>
        <Figure
          src="/images/manual-hydro-snowpack.webp"
          alt="Two line charts by month. Left: California snow water equivalent, which builds from January to a peak in March or April and is gone by June; the 2017 line reaches 46 inches by March, far above the 2001 to 2010 average of about 25. Right: California net hydroelectric generation, which climbs from about 2 million megawatt-hours in winter to a peak near 3.9 million in May to July before falling back by autumn."
          width={573}
          height={290}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=30452",
          }}
        />
        <p>
          Select a dam to see what limits its output and its reservoir forecast
          for the next year.
        </p>
        <p>
          <strong>Water rights</strong> require releases for farms, cities and
          other users downstream. Those releases generate power automatically
          when the reservoir is high enough, even when demand is low. Below the
          minimum generating level, required water bypasses the turbines.
        </p>
        <p>
          The game simplifies reservoir sizes. Pumped Hydro works differently:
          you use electricity to pump water uphill, then let it flow back down
          when you need power. In Electrify, it gets no river or rain inflow and
          loses stored energy to evaporation.
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
          More customers mean more demand, but the busiest hours depend on their
          routines and the weather. Home demand varies the most because of
          heating and cooling.
        </p>
        <Figure
          src="/images/manual-demand-customer-types.webp"
          alt="Three charts of monthly US retail electricity sales from 2009 to 2012. Residential sales swing hardest, peaking each summer and winter; commercial sales follow the same shape but with about half the swing; industrial sales stay nearly flat all year."
          width={576}
          height={288}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=10211",
          }}
        />
        <p>
          A <strong>load shape</strong> shows demand over time. Notice the daily
          cycle, the weekend dip and the hot week's higher peak.
        </p>
        <Figure
          src="/images/manual-demand.webp"
          alt="Hourly electricity load across a week in the PJM Mid-Atlantic region, plotted for a hot week, a cold week and a mild week of 2009. All three rise and fall once a day and drop over the weekend; the hot week peaks around 50,000 MW, roughly 20,000 MW above the mild week's overnight low."
          width={834}
          height={560}
          source={{
            name: "Penn State, EBF 200",
            url: "https://www.e-education.psu.edu/ebf200/node/151",
          }}
        />
        <p>
          In investor-owned scenarios, you compete for a limited market. Lower
          prices gradually win customers; higher prices and blackouts drive them
          away. Switching takes months, so small changes may not show up
          immediately in the rounded customer count.
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
          effect of different greenhouse gases. A kilogram of methane causes
          more warming than a kilogram of CO2, so it counts as more CO2e. Plants
          list emissions in <MassUnitName /> per megawatt-hour (MWh).
        </p>
        <p>
          Your total includes your own generation and the electricity you buy.
          Insights shows them separately. Find each neighbor's emissions
          estimate in Interties, with sources in its manual entry. Import
          emissions per MWh use annual estimates, rather than changing hourly.
        </p>
        <p>
          Local estimates count CO2 from burning fuel, including biomass, with
          no credit for regrowth. Most import estimates also count CO2; Québec's
          counts all greenhouse gases as CO2e. Fuel supply and land use are left
          out. A zero here doesn't mean the electricity has no environmental
          impact.
        </p>
        <p>
          Making steel and concrete and drilling wells also cause emissions.
          Each build card shows the total, spread evenly over construction. Even
          wind, solar, nuclear and storage have construction emissions. These
          carry no carbon fee in the game; the fee applies only to burning fuel
          locally.
        </p>
        <p>
          Even counting fuel supply and construction, wind, solar and nuclear
          produce far fewer emissions per unit of electricity than coal or gas:
        </p>
        <Figure
          src="/images/manual-lifecycle-emissions.webp"
          alt="Horizontal bar chart of lifecycle greenhouse gas emissions per gigawatt-hour of electricity, in tonnes of CO2-equivalent: coal 970, oil 720, natural gas 440, biomass 78 to 230, solar 53 (8 to 83 depending on technology and location), hydropower 24, wind 11 and nuclear 6."
          width={820}
          height={481}
          source={{
            name: "Our World in Data (CC BY), cropped",
            url: "https://ourworldindata.org/safest-sources-of-energy",
          }}
        />
        <p>
          Emissions affect your fees and score, but don't change local weather
          in the game.
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
          Insights estimates what will happen if you make no more changes.
          Choose a preset or select Layers to compare charts over the same time
          range. Pause or reorder plants and the forecasts update, so you can
          see the effect before running the clock.
        </p>
        <p>
          <strong>Supply &amp; Demand:</strong> Shading marks predicted
          blackouts, with the missing energy and the largest power shortage.
          Check when the gaps happen before choosing what to build. Missing
          energy is scaled to a month, because one simulated day represents a
          month. Shaded hours don't show a real outage's duration.
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
          <strong>Fuel Prices:</strong> Historical prices and future estimates.
          Prices can jump, so check before building fuel-burning plants.{" "}
          <strong>Compare possible costs in five years</strong> applies 0.5%,
          2.5% or 4.5% yearly growth to this month's fuel bill times 12. It
          assumes the same facilities and fuel use. These examples don't
          estimate how likely each cost is or change your loans or settings.
        </p>
        <p>
          <strong>Temperature</strong> and{" "}
          <strong>Renewable Capacity Factors</strong> show weather and expected
          output. Demand follows a simplified local heating and cooling pattern.
          Owning hydro adds a <strong>Water</strong> chart for precipitation,
          snow and reservoirs.
        </p>
        <p>
          Forecasts use one day per month (see How to Play), so they can't test
          a week of clouds or still air.
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
        <p>Use these keys while a scenario is running:</p>
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
          Move a plant higher in Facilities to have it run first. This is the{" "}
          <strong>dispatch order</strong>, or merit order. Real markets run the
          cheapest plants first, and often the last plant needed sets the price
          for everyone. In Electrify you choose the order yourself.
        </p>
        <p>
          Plants lower down cover the demand that's left. They still need time
          to change output, and some can't run below a minimum level. Wind and
          solar depend on the weather. Plants start and stop automatically.
        </p>
        <p>
          This 2008 chart from PJM, an eastern US market, ranks generators by
          cost:
        </p>
        <Figure
          src="/images/manual-generation-stack.webp"
          alt="Scatter chart of PJM generation capacity sorted from cheapest to most expensive. Renewables and nuclear supply the first 40 GW at under $20/MWh, coal carries the next 60 GW below $50/MWh, natural gas climbs steeply from there, and oil tops out around $300/MWh for the last few GW."
          width={825}
          height={471}
          source={{
            name: "Penn State, EBF 200",
            url: "https://www.e-education.psu.edu/ebf200/node/151",
          }}
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
          respond almost instantly; coal and nuclear plants need time, often
          hours, to heat equipment safely.
        </p>
        <p>
          Fuel-burning and nuclear plants also have a{" "}
          <strong>minimum stable output</strong>: the lowest power they can hold
          while running. In Electrify, it's 15%–50% of rated power. When demand
          is low, the game compares staying at minimum with shutting down and
          paying to restart.
        </p>
        <p>
          A slow plant can't help much with a sudden jump in demand.
          California's &ldquo;duck curve&rdquo; shows the problem: solar output
          falls just as people get home and use more electricity. Other plants
          and batteries have to make up the difference quickly:
        </p>
        <Figure
          src="/images/manual-duck-curve.webp"
          alt="Line chart of California's net load, meaning demand minus wind and solar, on the lowest spring day of each year from 2015 to 2023. Every year dips at midday and climbs steeply in the evening, and the dip deepens each year: in 2015 it bottoms near 13 GW, while in 2022 and 2023 it falls almost to zero before rising to about 20 GW by 8 PM."
          width={609}
          height={283}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=56880",
          }}
        />
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
          front and repay the loan monthly. Payments start during construction,
          before the plant earns anything, so leave enough cash to cover them.
        </p>
        <p>
          The <strong>prime rate</strong> is a benchmark borrowing rate that
          moves with the economy. Lenders add extra interest based on your
          company's profit, cash, existing loans and ability to repay, so more
          debt can make new loans costlier.
        </p>
        <p>
          Each loan's interest rate is locked in when you sign, even as the
          economy changes. On a plant costing hundreds of millions, borrowing
          when rates are low can save a fortune.
        </p>
        <p>
          <strong>Inflation</strong> means rising prices. It pushes up fuel,
          construction and operating costs in the game. Your electricity rate
          doesn't rise on its own; you set it in Insights. A public utility's
          target rate and an investor's market rate both rise with inflation.
          Future economic conditions are estimates.
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
          times electricity delivered, adjusted for time-of-use tariffs and
          curtailment credits.
        </p>
        <p>
          <strong>Investor-owned:</strong> Price below the market rate to win
          customers from rivals, or above it to earn more from each while some
          leave. The market rate rises with inflation; switching takes months.
        </p>
        <p>
          <strong>Publicly owned:</strong> Customers can't switch to another
          utility. Your score rewards affordable power: a lifetime average rate
          below the scenario's target earns points; above it loses points. You
          still need enough revenue to cover costs. Set your rate in Insights.
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
          equals 1 megawatt-hour (MWh). A kilowatt-hour (kWh), the unit on a
          power bill, is a thousandth of a MWh; a typical US home uses about 10
          MWh a year. A terawatt-hour (TWh) is a million MWh.
        </p>
        <p>
          A full 20 MW battery holding 80 MWh can supply 20 MW for about four
          hours, allowing for storage losses. Holding 80 MWh does not let it
          supply 80 MW.
        </p>
        <Figure
          src="/images/manual-power-energy.webp"
          alt="Diagram of two batteries that each store 80 MWh. The 20 MW battery has a narrow outlet and lasts about 4 hours; the 80 MW battery has a wide outlet and lasts about 1 hour. Caption: energy is how much is stored, and power is how fast it flows."
          width={720}
          height={360}
        />
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
          Reserve is how much extra demand you could cover within 15 minutes. It
          includes extra output from your plants and storage, charging you could
          stop, and exports you could redirect to your customers. Unused import
          access doesn't count.
        </p>
        <p>
          Real grids keep reserve for plant failures and unexpected demand. A
          low-reserve warning marks hours when demand is close to available
          supply. The game's 10% threshold isn't a real reliability standard;
          staying above it doesn't guarantee you'll avoid blackouts.
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
          storage.
        </p>
        <p>
          <strong>Import capacity</strong> is the maximum power you can buy;{" "}
          <strong>export capacity</strong> is the maximum surplus power you can
          sell. Weather and the neighbor’s spare supply determine what is
          available now.
        </p>
        <p>
          These capacities combine two underlying limits.{" "}
          <strong>Line capacity</strong> is the maximum power the line can
          carry; <strong>import access</strong> and{" "}
          <strong>export access</strong> are the trading allowances in each
          direction. Each directional capacity is the lower of the line capacity
          and its access allowance. Weather reduces the physical line’s
          capacity. Multiple paths share the same neighbor’s supply and export
          demand.
        </p>
        <p>
          Most of the mainland US belongs to one of three largely separate
          grids:
        </p>
        <Figure
          src="/images/manual-interconnections.webp"
          alt="Map of the Lower 48 US states divided into three interconnections: the Western Interconnection from the Rockies to the Pacific, the Eastern Interconnection covering everything east of the Rockies, and ERCOT covering most of Texas. Circles mark the 66 balancing authorities, including CISO in California, ERCO in Texas, and SWPP, MISO, PJM, TVA, SOCO, NYIS and ISNE in the east."
          width={576}
          height={288}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=27152",
          }}
        />
        <p>
          Mission tiers purchase import access as well as line capacity. Custom
          games start with full regional access, so upgrades only widen the
          line. Export access stays the same, but a wider line can increase
          export capacity until it reaches that allowance. The upgrade review
          compares import and export capacity before and after construction.
        </p>
        <p>
          Neighbors differ in spare power and prices. Each intertie&rsquo;s
          build card names the neighboring grid type, such as seasonal hydro or
          solar surplus. Open Show details for a description and monthly
          estimates of how much import capacity is available.
        </p>
        <p>
          Check &ldquo;At your peak&rdquo;: how much the neighbor can usually
          send during your busiest hours. A heat wave or cold snap can hit both
          grids at once, leaving your neighbor with less to spare when you need
          it most. On harder difficulties, they have even less available.
        </p>
        <p>
          Drag the handles beside your interties to set their trading order.
          Imports and exports use the first available connection in that order.
          Moving a cheaper neighbor first can lower import costs; moving a
          higher-paying neighbor first can raise export revenue. Hot, sunny
          weather can also reduce line capacity: hot wires sag, so carrying less
          power helps keep them clear of the ground. Build details show typical
          import availability and price, including how much of the line is
          available at your peak. Live line details show whether the line, the
          neighbor, or your own demand and trading rule is limiting the flow.
        </p>
        <p>
          Neighbors' prices and emissions change over time. The game uses
          historical data from about 1990 and official projections based on
          announced policies through 2050. After that, estimates stay flat.
          You'll see events like the 2022 energy crisis affect import prices,
          and each year's estimated emissions count toward your score. You can
          only build a connection once it existed in the real world. The game
          uses annual averages and simplifies the transmission network. Here are
          the sources:
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
          Round-trip efficiency tells you how much charging energy you get back.
          At 80%, charging with 10 MWh leaves 8 MWh to use. Electrify deducts
          the loss when you charge; the energy bar shows what's left. Batteries
          return about 85%, pumped hydro about 80%.
        </p>
        <p>
          Charging needs spare power and can't exceed the storage facility's
          power rating. Electricity used to charge it can't also serve customers
          or be exported.
        </p>
        <p>
          Pausing storage stops charging and discharging. Self-discharge or
          evaporation still drains stored energy until you pause the game clock.
        </p>
        <p>
          Why store energy if you lose some? Saving midday solar can cost less
          than running a gas plant in the evening, even with storage losses and
          construction costs. Here it is in California:
        </p>
        <Figure
          src="/images/manual-battery-evening.webp"
          alt="Three line charts of average hourly California grid generation in May and June of 2020, 2022 and 2025. Solar peaks at midday, growing from about 10 GW to 20 GW. Batteries barely register in 2020; by 2025 they charge up to about 6 GW at midday, shown below zero, and discharge about 8 GW around 7 PM as solar fades, while natural gas dips at midday and rises again in the evening."
          width={600}
          height={318}
          source={{
            name: "U.S. Energy Information Administration",
            url: "https://www.eia.gov/todayinenergy/detail.php?id=66704",
          }}
        />
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
          Your score tracks how you do as CEO. Check{" "}
          <strong>Victory conditions</strong> for reliability and customer
          goals; tutorial missions have their own objectives.
        </p>
        <p>
          In every scenario, you fail if you go bankrupt or serve less than 90%
          of demand three months in a row (95% on Expert difficulty).
        </p>
        <p>
          The tables below show how points add up, with reliability, costs and
          emissions shown separately. Log in to submit your score and replay.
          Use the leaderboard's play buttons to see how others beat your score!
        </p>
        <p>
          Saves and replays need matching game rules. After a rules update,
          older runs need their original game version. The saved file stays
          unchanged.
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
              <td>−2</td>
              <td>
                per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>−8</td>
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
              <td>−5</td>
              <td>
                per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>−10</td>
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
          Operations and maintenance (O&amp;M) covers staff, repairs and other
          upkeep. Some costs continue even when the plant isn't generating.
          Fuel, carbon fees and loans are separate.
        </p>
        <ul>
          <li>
            <strong>Fixed:</strong> Annual cost whether the plant runs or not.
          </li>
          <li>
            <strong>Base:</strong> Annual quote at the expected capacity factor.
          </li>
          <li>
            <strong>Variable:</strong> Cost per MWh generated.
          </li>
          <li>
            <strong>Non-fuel start cost:</strong> Maintenance charged each time
            the plant starts, because heating up strains equipment.
          </li>
        </ul>
        <p>
          The annual estimate assumes expected output and 365 starts per year;
          actual costs depend on how you run it. Oil plants pay fixed and
          variable O&amp;M; pausing halves the fixed charge and stops the
          variable one.
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
          Hail and extreme cold strike at random, more often in some places than
          others. Neither happens in tutorials.
        </p>
        <ul>
          <li>
            <strong>Hail:</strong> Breaks part of a solar farm. The broken share
            produces nothing until repairs finish, usually within weeks, and you
            pay the full repair cost.
          </li>
          <li>
            <strong>Extreme cold:</strong> Gas plants colder than their rating
            lose output for the month. Frozen equipment caused these kinds of
            failures in Texas in 2021. A cold-weather package halves the loss. A
            regional freeze also raises gas prices as demand for heating rises.
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
          more morning and evening power, about 20% more a year. They also tilt
          panels steeply to reduce hail damage. You can only add them when
          building.
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
          The fuel cost shown is what a plant would spend to produce one MWh at
          current fuel prices. Its heat rate measures how much fuel energy it
          needs to do that. A more efficient plant needs less fuel, so two gas
          plants can have very different costs.
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
          The accounting lifetime is the number of years a plant's construction
          cost is spread over in your books. As with real utilities, its book
          value falls each year even while it keeps running. This is called
          depreciation; it doesn't take money out of your cash balance.
        </p>
        <p>
          Electrify uses those years to estimate lifetime cost and cost per MWh,
          including construction, upkeep and fuel. It also sets resale value: a
          plant's book value declines evenly to zero over its accounting
          lifetime, so selling early returns more of the build cost. Any
          outstanding loan is paid off from the sale first.
        </p>
        <p>
          Reaching the end of its accounting lifetime doesn't retire a plant.
          Some real hydro dams are over a century old. Some technologies do lose
          a little output each year as they age.
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
          You can't put a dam or geothermal plant just anywhere. Each needs a
          suitable site. Hydro uses the smallest remaining site that fits your
          project; any unused capacity goes with it. You can't combine sites.
          Cancel before construction finishes to free the site; selling or
          retiring a plant won't free it.
        </p>
        <p>
          You can only build new Hydro where we've researched available sites.
          An empty list doesn't necessarily mean the area has no hydro
          potential.
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
          construction, upkeep, startups, fuel and carbon fees; loan interest is
          separate. Use it to compare a solar farm's upfront cost with a gas
          peaker's ongoing fuel bills.
        </p>
        <p>
          Those costs change over time. The global average cost of power from
          new solar farms fell about 90% between 2010 and 2025:
        </p>
        <Figure
          src="/images/manual-lcoe.webp"
          alt="Line chart of the worldwide levelized cost of energy for new renewable plants in constant 2025 US dollars per kilowatt-hour. Solar photovoltaic falls from about $0.41 in 2010 to about $0.04 in 2025, and onshore wind from $0.37 in 1984 to about $0.03, both now below the fossil fuel range of roughly $0.05 to $0.18. Hydropower, geothermal, bioenergy, offshore wind and concentrated solar power are also shown."
          width={850}
          height={600}
          source={{
            name: "Our World in Data (CC BY), IRENA data",
            url: "https://ourworldindata.org/grapher/levelized-cost-of-energy",
          }}
        />
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
