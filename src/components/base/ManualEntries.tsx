import * as React from "react";
import KeyboardShortcuts, { SHORTCUTS_SEARCH_TEXT } from "./KeyboardShortcuts";
import ConceptLegend from "./ConceptLegend";
import EntryLink from "./ManualEntryLink";
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
// send the player straight to it with navigate({name: "MANUAL", entry: MANUAL_ENTRY.X}), and an
// entry's prose links the terms it shares with others through <EntryLink to={...}>, the way a
// wiki does, at most once per target and never to itself. Naming them here rather than passing
// raw strings means renaming an entry breaks the build instead of silently breaking the link.
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
}

// The source line for an image, shown to the player rather than hidden in the alt attribute:
// on an educational game a citation is worth reading, and alt text is for describing the
// picture to someone who can't see it. A diagram drawn for the game (its source is in
// docs/manual-images/) has nothing to cite, so it leaves the source out.
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
      "efficiency rooftop solar rebates build-out project pause resume completion demand time-of-use tariff curtailment contracts peak enrollment smart heating hot water thermostat managed ev charging electric vehicle home battery virtual power plant vpp flexibility",
    entry: (
      <div>
        <p>
          Instead of building another plant, you can help{" "}
          <EntryLink to={MANUAL_ENTRY.CUSTOMERS}>customers</EntryLink> use less
          electricity, or use it at a better time. Set these in Programs;
          changes start next month.
        </p>
        <p>
          <strong>Efficiency and rooftop solar rebates:</strong> One-time,
          48-month projects at a fixed monthly cost, which you can pause. Both
          save you from building plants, but also cut your sales.
        </p>
        <ul>
          <li>
            Efficiency cuts home and business use by 10%, and heating and
            cooling by 35%. Savings fade after 10 years and are gone after 20.
          </li>
          <li>
            Rooftop solar cuts daytime demand, best in sunny, cool places. You
            don't pay for surplus power. Rebates cost much more in the early
            2000s, when panels were expensive.
          </li>
        </ul>
        <p>
          The other programs each act on a four-hour peak window you choose:
        </p>
        <ul>
          <li>
            <strong>Time-of-use tariff:</strong> Half of homes move 20% of their
            use into the next three hours. They pay 30% above the{" "}
            <EntryLink to={MANUAL_ENTRY.RATES}>base rate</EntryLink> in the
            window and 10% below it for those three hours.
          </li>
          <li>
            <strong>Peak curtailment contracts:</strong> Half of industrial and
            data-center demand drops 20%, and that energy isn't used later.
            Participants get 10% off all day.
          </li>
          <li>
            <strong>Smart heating and hot water:</strong> Heaters pause during
            the window, then catch up over three hours.
          </li>
          <li>
            <strong>Managed EV charging:</strong> Charging moves into the next
            six hours, though drivers can override it.
          </li>
          <li>
            <strong>Home battery virtual power plant:</strong> Home batteries
            act like a shared power plant from 2016, keeping 20% for their
            owners.
          </li>
        </ul>
        <Figure
          src="/images/manual-peak-shifting.webp"
          alt="A day of electricity demand before and after a program. Demand drops during a four-hour evening peak window and rises in the three hours after it, so the highest peak is lower."
          width={720}
          height={390}
        />
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.HOW_TO_PLAY,
    group: "Gameplay",
    pinned: true,
    keywords: "getting started tutorial basics overview intro new player",
    entry: (
      <div>
        <p>
          You run an electric utility, the company that keeps a region's lights
          on. Supply the electricity customers need without running out of
          money. Build generators,{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>
            store extra energy
          </EntryLink>{" "}
          and{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>
            trade with neighboring grids
          </EntryLink>
          . Fall short and you'll cause{" "}
          <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>blackouts</EntryLink>. Your{" "}
          <EntryLink to={MANUAL_ENTRY.SCORE}>score</EntryLink> rewards a
          reliable, affordable, clean grid.
        </p>
        <p>
          <strong>Facilities:</strong> Build and manage plants.{" "}
          <EntryLink to={MANUAL_ENTRY.PRIORITIZING_GENERATORS}>
            Generators higher in the list run first
          </EntryLink>
          .
        </p>
        <p>
          <strong>Programs:</strong> Set{" "}
          <EntryLink to={MANUAL_ENTRY.RATES}>rates</EntryLink> and{" "}
          <EntryLink to={MANUAL_ENTRY.CUSTOMER_PROGRAMS}>
            customer programs
          </EntryLink>
          .
        </p>
        <p>
          <strong>Insights:</strong> Track finances and{" "}
          <EntryLink to={MANUAL_ENTRY.FORECASTS}>forecasts</EntryLink>.
        </p>
        <p>
          To fit decades into one sitting, one simulated day stands for a month.
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
          <strong>Baseload</strong> is the demand that's there even at 3am.
          Nuclear and coal often cover it. They're{" "}
          <EntryLink to={MANUAL_ENTRY.RAMP_RATE}>
            slow or costly to start and stop
          </EntryLink>
          , so they're best left running.
        </p>
        <p>
          <strong>Peakers</strong> start quickly to cover short peaks, like hot
          summer evenings. They're cheap to build but burn{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>expensive fuel</EntryLink>.
          Think of a spare generator: it may sit idle most of the year and still
          be cheaper than a{" "}
          <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>blackout</EntryLink>.
        </p>
        <Figure
          src="/images/manual-baseload-peaker.webp"
          alt="A day of electricity demand stacked in three layers: steady baseload that runs around the clock, flexible plants that follow demand, and peakers on top for a few evening hours."
          width={720}
          height={360}
        />
        <p>
          A <strong>Natural Gas Peaker</strong> is a single turbine that starts
          in minutes. A <strong>Natural Gas CC</strong> (combined cycle) also
          uses the turbine's hot exhaust to drive a steam turbine. It burns
          about a third less gas per MWh but starts more slowly, so it suits
          demand that lasts for hours.{" "}
          <EntryLink to={MANUAL_ENTRY.HYDROPOWER}>Hydro</EntryLink> can do
          either job.
        </p>
        <p>
          New gas peakers join the{" "}
          <EntryLink to={MANUAL_ENTRY.PRIORITIZING_GENERATORS}>
            dispatch order
          </EntryLink>{" "}
          below your other generators; other new plants join at the top.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BLACKOUTS,
    group: "Gameplay",
    keywords: "job security fired outage shortage",
    entry: (
      <div>
        <p>
          Electricity must be made the moment it's used. A blackout happens when{" "}
          <EntryLink to={MANUAL_ENTRY.CUSTOMERS}>demand</EntryLink> exceeds your
          available supply, including storage and{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>imports</EntryLink>. Keep some{" "}
          <EntryLink to={MANUAL_ENTRY.RESERVE_CAPACITY}>reserve</EntryLink> for
          surprises.
        </p>
        <Figure
          src="/images/manual-blackout.webp"
          alt="A day of demand against a flat line of available supply. Where evening demand rises above supply, the gap is shaded red and labeled blackout."
          width={720}
          height={360}
        />
        <p>
          Outages cost you customers, revenue and{" "}
          <EntryLink to={MANUAL_ENTRY.SCORE}>points</EntryLink>. Too many and
          you're fired.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.BTU,
    group: "Physics & Units",
    keywords:
      "british thermal unit mmbtu heat energy kwh mwh efficiency waste heat",
    entry: (
      <div>
        <p>
          A British thermal unit (Btu) measures heat, roughly what one kitchen
          match gives off.{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>Fuel prices</EntryLink> use
          MMBtu: a million Btu, or about 293{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>kWh</EntryLink> of heat.
          Plants turn only part of that heat into electricity:
        </p>
        <Figure
          src="/images/manual-heat-to-electricity.webp"
          alt="Bars for the share of fuel heat each plant turns into electricity in the game: biomass 26%, nuclear 32%, gas peaker 37%, coal 39% and gas combined cycle 54%. The rest is lost as heat."
          width={720}
          height={350}
        />
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
          A 100 MW plant doesn't produce 100 MW all the time. Capacity factor
          compares what it actually produces with what it could at full power.
          At 45%, it averages 45 MW. Here's how that varied in 2008–2012, with
          wind and solar grouped together:
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
          The build screen uses it to estimate{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>
            cost per MWh
          </EntryLink>
          : the less a plant runs, the fewer MWh share its build cost.{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>Fuel costs</EntryLink> and
          your{" "}
          <EntryLink to={MANUAL_ENTRY.PRIORITIZING_GENERATORS}>
            choices
          </EntryLink>{" "}
          decide how often coal and gas run. Wind and solar follow the weather,
          and hot panels produce less. Wind estimates are simplified; real
          output also depends on terrain and siting.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.CARBON_FEE,
    group: "Money",
    keywords:
      "carbon tax carbon price pollution fee co2 per ton tonne biomass exempt",
    entry: (
      <div>
        <p>
          A carbon fee charges for pollution, per <LargeMassUnit /> of{" "}
          <EntryLink to={MANUAL_ENTRY.EMISSIONS}>
            carbon dioxide equivalent (CO2e)
          </EntryLink>{" "}
          emitted. Coal emits about twice as much per MWh as gas, so at{" "}
          <ExampleCarbonFee />, coal can cost more to run than gas.
        </p>
        <Figure
          src="/images/manual-carbon-fee.webp"
          alt="Bars for the carbon fee per megawatt-hour at 50 dollars per tonne: coal 40 dollars, gas peaker 24, gas combined cycle 17, and wind, solar and nuclear zero."
          width={720}
          height={320}
        />
        <p>
          The fee appears in{" "}
          <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>
            operating expenses
          </EntryLink>
          . Biomass is exempt, as in most real carbon-pricing schemes.{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>
            Imported electricity
          </EntryLink>{" "}
          carries no local fee, but its emissions still count against your{" "}
          <EntryLink to={MANUAL_ENTRY.SCORE}>score</EntryLink>.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.HYDROPOWER,
    group: "Physics & Units",
    keywords:
      "hydro rain precipitation watershed snow snowpack melt runoff dam reservoir spill drought deadpool minimum power pool bypass water rights irrigation municipal must run",
    entry: (
      <div>
        <p>
          A dam releases stored water through turbines. Rain and melting snow
          refill the reservoir from its watershed, the land that drains into it,
          so a dam is like a{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>battery</EntryLink> the
          weather recharges. Drought leaves less to generate with, and a full
          reservoir spills any extra.
        </p>
        <Figure
          src="/images/manual-reservoir.webp"
          alt="Cross-section of a dam. Rain and snowmelt fill the reservoir. At the top, extra water spills. Below a minimum generating level, water bypasses the turbines. Water leaving through the dam spins a turbine that makes power."
          width={720}
          height={370}
        />
        <p>
          <strong>Water rights</strong> require releases for farms and cities
          downstream. These generate power automatically when the reservoir is
          high enough, even when demand is low.
        </p>
        <p>
          Once you own hydro, the{" "}
          <EntryLink to={MANUAL_ENTRY.FORECASTS}>
            <strong>Water</strong> chart
          </EntryLink>{" "}
          shows precipitation, snow and reservoir levels. Select a dam to see
          what limits its output and its forecast for the next year. Winter snow
          won't refill a reservoir until it melts, so California's hydro output
          rises after the spring melt:
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
          <strong>Pumped Hydro</strong> uses electricity to pump water uphill,
          then lets it flow back down when you need power,{" "}
          <EntryLink to={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}>
            losing some energy on the way
          </EntryLink>
          . In Electrify it gets no river or rain inflow and slowly loses water
          to evaporation. The game simplifies reservoir sizes.
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
          Home demand varies most, because of heating and cooling.
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
          A <strong>load shape</strong> shows demand over time. Look for the
          daily cycle, the weekend dip and the hot week's higher peak:
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
          In investor-owned scenarios, you compete for a limited market.{" "}
          <EntryLink to={MANUAL_ENTRY.RATES}>Lower prices</EntryLink> win
          customers; higher prices and{" "}
          <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>blackouts</EntryLink> drive
          them away. Switching takes months, so small changes may not show up
          right away.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.EMISSIONS,
    group: "Physics & Units",
    keywords:
      "greenhouse gas pollution carbon dioxide equivalent tons tonnes kilograms pounds construction lifecycle",
    entry: (
      <div>
        <p>
          CO2e, or carbon dioxide equivalent, puts different greenhouse gases on
          one scale of warming. A kilogram of methane warms more than a kilogram
          of CO2, so it counts as more CO2e. Plants list emissions in{" "}
          <MassUnitName /> per{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>
            megawatt-hour (MWh)
          </EntryLink>
          .
        </p>
        <p>
          Your total includes your generation and the electricity you buy, shown
          separately in{" "}
          <EntryLink to={MANUAL_ENTRY.FORECASTS}>Insights</EntryLink>. Each
          neighbor's estimate is an annual average, listed in{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>Interties</EntryLink>.
        </p>
        <p>
          Local figures count CO2 from burning fuel, including biomass, with no
          credit for regrowth. Most import figures do too; Québec's counts all
          greenhouse gases. Fuel supply and land use are left out, so a zero
          doesn't mean no environmental impact.
        </p>
        <p>
          Making steel and concrete also causes emissions, so every plant shows
          a construction total, spread evenly over its build. These carry no{" "}
          <EntryLink to={MANUAL_ENTRY.CARBON_FEE}>carbon fee</EntryLink>. Even
          with construction and fuel supply counted, wind, solar and nuclear
          emit far less than coal or gas:
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
          Emissions affect your fees and{" "}
          <EntryLink to={MANUAL_ENTRY.SCORE}>score</EntryLink>, but don't change
          the game's weather.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.FORECASTS,
    group: "Gameplay",
    keywords:
      "projection supply demand fuel prices weather peak shortage layers presets temperature",
    entry: (
      <div>
        <p>
          Insights estimates what happens if you change nothing. Pause or
          reorder plants and the forecasts update, so you can test an idea
          before running the clock. Choose a preset, or select Layers to compare
          charts over the same dates.
        </p>
        <ul>
          <li>
            <strong>Supply &amp; Demand:</strong> Shading marks predicted{" "}
            <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>blackouts</EntryLink>, with
            the missing{" "}
            <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>
              energy and the largest power shortage
            </EntryLink>
            . Check when gaps happen, and your{" "}
            <EntryLink to={MANUAL_ENTRY.RESERVE_CAPACITY}>reserve</EntryLink>,
            before choosing what to build. Missing energy is scaled to a month.
          </li>
          <li>
            <strong>Supply by Fuel:</strong> Local generation in{" "}
            <EntryLink to={MANUAL_ENTRY.PRIORITIZING_GENERATORS}>
              dispatch order
            </EntryLink>{" "}
            (merit order). Supply also includes storage discharge and{" "}
            <EntryLink to={MANUAL_ENTRY.INTERTIES}>imports</EntryLink>, minus
            charging and exports.
          </li>
          <li>
            <strong>Stored Energy:</strong> What's left in batteries and{" "}
            <EntryLink to={MANUAL_ENTRY.HYDROPOWER}>reservoirs</EntryLink>.
            Power ratings limit how quickly you can use it.
          </li>
          <li>
            <strong>Fuel Prices:</strong> History and estimates. Prices can
            jump, so check before building fuel-burning plants.
          </li>
          <li>
            <strong>Temperature</strong> and{" "}
            <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>
              <strong>Renewable Capacity Factors</strong>
            </EntryLink>
            : Weather and expected output. Hydro owners also get a{" "}
            <strong>Water</strong> chart.
          </li>
        </ul>
        <p>
          Forecasts use one day per month (see{" "}
          <EntryLink to={MANUAL_ENTRY.HOW_TO_PLAY}>How to Play</EntryLink>), so
          they can't test a week of clouds or still air.
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
          Move a plant higher in Facilities to run it first. This is the{" "}
          <strong>dispatch order</strong>, or merit order. Real markets usually
          run the cheapest plants first, and the last plant needed often sets
          the price for everyone. In Electrify you choose the order.
        </p>
        <p>
          Lower plants cover the demand that's left and start and stop
          automatically. They still{" "}
          <EntryLink to={MANUAL_ENTRY.RAMP_RATE}>
            need time to change output
          </EntryLink>
          , and wind and solar{" "}
          <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>
            depend on the weather
          </EntryLink>
          .
        </p>
        <p>
          This 2008 chart from PJM, an eastern US market, ranks generators by{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>cost</EntryLink>:
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
          Ramp rate is how quickly a generator changes output. The build screen
          estimates its time from zero to full power.{" "}
          <EntryLink to={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}>
            Batteries
          </EntryLink>{" "}
          respond almost instantly; coal and nuclear plants often need hours to
          heat equipment safely.
        </p>
        <p>
          Fuel-burning and nuclear plants also have a{" "}
          <strong>minimum output</strong>, the lowest power they can hold while
          running: 15%–50% of rated power in Electrify. When demand is low, the
          game compares staying at minimum with shutting down and{" "}
          <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>
            paying to restart
          </EntryLink>
          .
        </p>
        <p>
          Slow plants can't help much with sudden jumps, so{" "}
          <EntryLink to={MANUAL_ENTRY.RESERVE_CAPACITY}>reserve</EntryLink>{" "}
          counts only what can respond within 15 minutes. California's
          &ldquo;duck curve&rdquo; shows why:{" "}
          <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>solar output</EntryLink>{" "}
          falls just as people get home, and other plants and batteries must
          fill the gap quickly.
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
          Financing a plant works like a mortgage: pay part of the cost up front
          and repay the rest monthly. Payments start during construction, before
          the plant earns anything, so keep enough cash to cover them.
        </p>
        <p>
          The <strong>prime rate</strong> is a benchmark borrowing rate that
          moves with the economy. Lenders add interest based on your profit,
          cash and existing loans, so more debt can make new loans costlier.
          Each loan's rate locks in when you sign, so borrowing when rates are
          low can save a fortune.
        </p>
        <p>
          <strong>Inflation</strong> means rising prices. It pushes up{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>fuel</EntryLink>, construction
          and{" "}
          <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>
            operating costs
          </EntryLink>
          , along with market and target{" "}
          <EntryLink to={MANUAL_ENTRY.RATES}>electricity rates</EntryLink>.
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
          Your rate is the price customers pay per{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>kWh</EntryLink>, the
          number on a power bill. Set it in Programs. Revenue is that price
          times electricity delivered, adjusted for{" "}
          <EntryLink to={MANUAL_ENTRY.CUSTOMER_PROGRAMS}>
            time-of-use tariffs and curtailment credits
          </EntryLink>
          .
        </p>
        <p>
          <strong>Investor-owned:</strong> Price below the market rate to win{" "}
          <EntryLink to={MANUAL_ENTRY.CUSTOMERS}>customers</EntryLink> from
          rivals, or above it to earn more from each while some leave. The
          market rate rises with{" "}
          <EntryLink to={MANUAL_ENTRY.INTEREST_RATES}>inflation</EntryLink>.
        </p>
        <p>
          <strong>Publicly owned:</strong> Customers can't switch utilities.
          Your <EntryLink to={MANUAL_ENTRY.SCORE}>score</EntryLink> rewards a
          lifetime average rate below the scenario's target and penalizes one
          above it, but you still need revenue to cover costs. By default, your
          rate follows inflation.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.POWER_AND_ENERGY,
    group: "Physics & Units",
    keywords:
      "MW MWh watts watt hours megawatt megawatt-hour battery duration discharge power energy capacity",
    entry: (
      <div>
        <p>
          <strong>Power</strong> is how fast electricity is produced or used,
          like a car's speed. <strong>Energy</strong> is power over time, like
          distance driven. Run 1 megawatt (MW, a million watts) for an hour and
          you've made 1 megawatt-hour (MWh).
        </p>
        <p>
          Your power bill uses kilowatt-hours (kWh); 1,000 kWh is a MWh. A
          typical US home uses about 10 MWh a year. A terawatt-hour (TWh) is a
          million MWh.
        </p>
        <p>
          A full 20 MW battery holding 80 MWh can supply 20 MW for about four
          hours, allowing for{" "}
          <EntryLink to={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}>
            storage losses
          </EntryLink>
          . Holding 80 MWh does not let it supply 80 MW.{" "}
          <EntryLink to={MANUAL_ENTRY.FORECASTS}>Insights</EntryLink> charts
          both.
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
      "headroom spare capacity cushion fifteen minutes reliability warning low reserve",
    entry: (
      <div>
        <p>
          Reserve is how much extra demand you could cover within 15 minutes.
          Real grids keep it for plant failures and surprise demand. It counts
          what plants can{" "}
          <EntryLink to={MANUAL_ENTRY.RAMP_RATE}>ramp up</EntryLink> to and{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>exports</EntryLink> you could
          redirect to your customers.
        </p>
        <Figure
          src="/images/manual-reserve.webp"
          alt="A stacked bar. Demand sits at the bottom. Above it, reserve is made of output plants can add within 15 minutes, storage ready to discharge, charging you could stop, and exports you could redirect. Unused import access does not count."
          width={720}
          height={360}
        />
        <p>
          A warning marks hours when reserve falls below 10%, and{" "}
          <EntryLink to={MANUAL_ENTRY.FORECASTS}>forecasts</EntryLink> show
          where that's coming. That's the game's threshold, not a real
          reliability standard, and staying above it doesn't guarantee you'll
          avoid <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>blackouts</EntryLink>.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.INTERTIES,
    group: "Gameplay",
    keywords:
      "transmission power exchange imports exports neighbor trading purchased emissions backup surplus peak price hydro solar wind archetype source citation CO2e proxy quebec california washington IEA EIA line capacity access",
    entry: (
      <div>
        <p>
          Interties connect neighboring grids. Your trading rule buys during
          shortages and sells surplus after serving customers and charging{" "}
          <EntryLink to={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}>storage</EntryLink>
          . Exports you could redirect count toward your{" "}
          <EntryLink to={MANUAL_ENTRY.RESERVE_CAPACITY}>reserve</EntryLink>.
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
          <strong>Import capacity</strong> and <strong>export capacity</strong>{" "}
          are the most{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>power</EntryLink> you
          can buy or sell. Each is the lower of two limits:{" "}
          <strong>line capacity</strong>, what the wires can carry, and{" "}
          <strong>import access</strong> or <strong>export access</strong>, your
          trading allowance in that direction. Paths to the same neighbor share
          its supply and demand.
        </p>
        <p>
          Mission tiers buy import access as well as line capacity. Custom games
          start with full regional access, so upgrades only widen the line.
          Export access never changes, but a wider line can raise export
          capacity up to that allowance. The upgrade review shows the before and
          after.
        </p>
        <p>
          Neighbors differ in spare power and price. Each build card names the
          grid type, such as seasonal hydro or solar surplus; Show details gives
          monthly estimates. Check &ldquo;At your peak&rdquo; for what the
          neighbor can usually send in your busiest hours. A heat wave or cold
          snap can hit both grids at once, and harder difficulties leave them
          with less to spare.
        </p>
        <p>
          Drag the handles beside your interties to set their trading order. Put
          a cheaper neighbor first to lower import costs, or a higher-paying one
          first to raise export revenue. Live details show whether the line, the
          neighbor, or your own demand and trading rule is limiting the flow.
          Hot weather can reduce line capacity, because hot wires sag toward the
          ground.
        </p>
        <p>
          Neighbors' prices and emissions follow historical data from about 1990
          and official projections through 2050, then stay flat, so events like
          the 2022 energy crisis raise import prices. Each year's estimated{" "}
          <EntryLink to={MANUAL_ENTRY.EMISSIONS}>emissions</EntryLink> count
          toward your <EntryLink to={MANUAL_ENTRY.SCORE}>score</EntryLink>. You
          can only build a connection once it existed in the real world. The
          game uses annual averages and a simplified network. Sources:
        </p>
        <IntertieTrendSources />
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY,
    group: "Physics & Units",
    keywords:
      "storage losses battery pumped hydro iron-air charge discharge self-discharge evaporation",
    entry: (
      <div>
        <p>
          Round-trip efficiency is how much charging energy you get back. At
          80%, charging with 10 MWh leaves 8 MWh to use. Electrify deducts the
          loss when you charge. Batteries return about 85%,{" "}
          <EntryLink to={MANUAL_ENTRY.HYDROPOWER}>pumped hydro</EntryLink> 80%
          and iron-air batteries about 43%.
        </p>
        <p>
          Charging needs spare power, up to the facility's{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>power rating</EntryLink>
          , and that power can't also serve customers or be{" "}
          <EntryLink to={MANUAL_ENTRY.INTERTIES}>exported</EntryLink>. Pausing
          storage stops charging and discharging, but stored energy still slowly
          drains away.
        </p>
        <p>
          Why store energy if you lose some? Saving midday solar can cost less
          than running a{" "}
          <EntryLink to={MANUAL_ENTRY.BASELOAD_VS_PEAKER}>gas plant</EntryLink>{" "}
          in the evening, even counting{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>
            construction costs
          </EntryLink>
          . California now does this every day:
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
      "points scoring high score end of game investor public leaderboard",
    entry: (
      <div>
        <p>
          Your score tracks how you do as CEO. Check <strong>Goals</strong> for
          reliability and customer targets; tutorial missions have their own
          objectives.
        </p>
        <p>
          You fail if you go bankrupt or serve less than 90% of demand three
          months in a row (95% on Expert). See{" "}
          <EntryLink to={MANUAL_ENTRY.BLACKOUTS}>Blackouts</EntryLink>.
        </p>
        <p>
          The tables below show how points add up across Service, Financial
          performance and Environmental impact, including{" "}
          <EntryLink to={MANUAL_ENTRY.EMISSIONS}>emissions</EntryLink>. Each
          contribution is rounded before the totals are added. Customer
          retention can be a mission requirement, but adds no points.
        </p>
        <p>
          Only completed missions earn leaderboard ranks and personal bests. Log
          in to submit one.
        </p>
        <p>Investor-owned points:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>+4</td>
              <td>Financial performance: per $100M of net worth at the end</td>
            </tr>
            <tr>
              <td>+1</td>
              <td>Service: per TWh supplied</td>
            </tr>
            <tr>
              <td>−2</td>
              <td>
                Environmental impact: per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>−8</td>
              <td>Service: per TWh of demand not served during blackouts</td>
            </tr>
          </tbody>
        </table>
        <p>Publicly owned points:</p>
        <table className="points">
          <tbody>
            <tr>
              <td>±80</td>
              <td>
                Financial performance: per $0.01/kWh your lifetime average{" "}
                <EntryLink to={MANUAL_ENTRY.RATES}>rate</EntryLink> is
                below/above the target rate (adjusted for inflation)
              </td>
            </tr>
            <tr>
              <td>+10</td>
              <td>Service: per TWh supplied</td>
            </tr>
            <tr>
              <td>−5</td>
              <td>
                Environmental impact: per <EmissionsPerPoint /> of CO2e emitted
              </td>
            </tr>
            <tr>
              <td>−10</td>
              <td>Service: per TWh of demand not served during blackouts</td>
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
    entry: (
      <div>
        <p>
          Operations and maintenance (O&amp;M) covers staff, repairs and upkeep.
          Some of it continues even when a plant sits idle, like rent on an
          empty shop. Repairs after{" "}
          <EntryLink to={MANUAL_ENTRY.WEATHER_DAMAGE}>weather damage</EntryLink>{" "}
          count here; <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>fuel</EntryLink>,{" "}
          <EntryLink to={MANUAL_ENTRY.CARBON_FEE}>carbon fees</EntryLink> and{" "}
          <EntryLink to={MANUAL_ENTRY.INTEREST_RATES}>loans</EntryLink> are
          separate.
        </p>
        <ul>
          <li>
            <strong>Fixed:</strong> Annual cost whether the plant runs or not.
          </li>
          <li>
            <strong>Base:</strong> Annual quote at the expected{" "}
            <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>
              capacity factor
            </EntryLink>
            .
          </li>
          <li>
            <strong>Variable:</strong> Cost per MWh generated.
          </li>
          <li>
            <strong>Non-fuel start cost:</strong> Charged at each start, because
            heating up strains equipment.
          </li>
        </ul>
        <p>
          The annual estimate assumes expected output and 365 starts a year;
          actual costs depend on how you run the plant. Pausing an oil plant
          halves its fixed cost and stops its variable cost. O&amp;M is part of
          a plant's{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>
            total cost of energy
          </EntryLink>
          .
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.WEATHER_DAMAGE,
    group: "Gameplay",
    keywords:
      "hail storm freeze cold snap winterization repair resilience retrofit hardening hail-resistant panels cold-weather package solar trackers downtime",
    entry: (
      <div>
        <p>
          Hail and extreme cold strike at random, more often in some places.
          Neither happens in tutorials.
        </p>
        <ul>
          <li>
            <strong>Hail:</strong> Breaks part of a solar farm. The broken share
            produces nothing until repaired, usually within weeks, and repairs
            count as{" "}
            <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>O&amp;M</EntryLink>.
          </li>
          <li>
            <strong>Extreme cold:</strong> Gas plants colder than their rating
            lose output for the month, as frozen equipment did in Texas in 2021.
            A regional freeze also raises{" "}
            <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>gas prices</EntryLink>.
          </li>
        </ul>
        <p>
          <strong>Protection:</strong> When building, add hail-resistant panels
          to solar, or a cold-weather package to gas. The package is only
          offered where winters get cold enough to matter. It halves cold losses
          and is rated to <ColdPackageRating />, or colder in cold climates.
        </p>
        <p>
          Adding either later from the facility&apos;s details costs 50% more.
          Hail retrofits take the plant offline for a month; winterizing keeps
          90% of capacity available during a month of staged work. You can
          cancel before it starts for a full refund.
        </p>
        <p>
          In Deep Freeze, gas, coal, nuclear and wind plants can be winterized
          permanently. The bulk offer covers eligible plants still needing
          protection; new builds need their own package.
        </p>
        <p>
          <strong>Solar trackers</strong> (from 2014, only when building) turn
          panels to follow the sun, adding about 20% more power a year, mostly
          in the morning and evening (a higher{" "}
          <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>
            capacity factor
          </EntryLink>
          ). They also tilt panels steeply to reduce hail damage.
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.FUEL_COSTS,
    group: "Money",
    keywords: "fuel price per MWh gas coal oil uranium heat rate",
    entry: (
      <div>
        <p>
          The fuel cost shown is what a plant would spend to make one{" "}
          <EntryLink to={MANUAL_ENTRY.POWER_AND_ENERGY}>MWh</EntryLink> at
          current prices. Its <strong>heat rate</strong> is the{" "}
          <EntryLink to={MANUAL_ENTRY.BTU}>fuel energy</EntryLink> needed to do
          that, like a car's miles per gallon. A more efficient plant burns
          less, so two gas plants can have very different costs. Fuel is one
          part of a plant's{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>
            total cost of energy
          </EntryLink>
          .
        </p>
      </div>
    ),
  },
  {
    title: MANUAL_ENTRY.ACCOUNTING_LIFETIME,
    group: "Money",
    keywords: "lifespan years depreciation retirement aging",
    entry: (
      <div>
        <p>
          The accounting lifetime is the number of years a plant's construction
          cost is spread over in your books. Its book value falls evenly to zero
          over those years, like a car losing value. This is depreciation; it
          takes no money from your cash balance.
        </p>
        <Figure
          src="/images/manual-book-value.webp"
          alt="A straight line falling from the build cost to zero at the end of the accounting lifetime. A bar underneath shows the plant keeps running and earning the whole time, past that point."
          width={720}
          height={370}
        />
        <p>
          Those years set the estimated{" "}
          <EntryLink to={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}>
            cost per MWh
          </EntryLink>
          , including construction,{" "}
          <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>upkeep</EntryLink> and{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>fuel</EntryLink>. They also
          set resale value, so selling early returns more of the build cost. Any
          outstanding{" "}
          <EntryLink to={MANUAL_ENTRY.INTEREST_RATES}>loan</EntryLink> is paid
          off from the sale first.
        </p>
        <p>
          A plant isn't retired when its accounting lifetime ends. Some real{" "}
          <EntryLink to={MANUAL_ENTRY.HYDROPOWER}>hydro dams</EntryLink> are
          over a century old. Some technologies do lose a little output each
          year.
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
          Dams and geothermal plants need suitable sites. Hydro uses the
          smallest remaining site that fits your project, and any unused
          capacity goes with it. You can't combine sites. Cancel before
          construction finishes to free a site; selling or retiring a plant
          won't.
        </p>
        <p>
          New <EntryLink to={MANUAL_ENTRY.HYDROPOWER}>Hydro</EntryLink> is only
          offered where we've researched sites, so an empty list doesn't
          necessarily mean an area has no potential.
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
          the average cost per MWh over a plant's{" "}
          <EntryLink to={MANUAL_ENTRY.ACCOUNTING_LIFETIME}>
            accounting lifetime
          </EntryLink>
          : construction, upkeep, startups,{" "}
          <EntryLink to={MANUAL_ENTRY.FUEL_COSTS}>fuel</EntryLink> and{" "}
          <EntryLink to={MANUAL_ENTRY.CARBON_FEE}>carbon fees</EntryLink>. It
          lets you compare a solar farm's upfront cost with a{" "}
          <EntryLink to={MANUAL_ENTRY.BASELOAD_VS_PEAKER}>gas peaker</EntryLink>
          's ongoing fuel bills. Your borrowing rate weighs future costs against
          money spent today, but actual{" "}
          <EntryLink to={MANUAL_ENTRY.INTEREST_RATES}>
            loan payments
          </EntryLink>{" "}
          are separate.
        </p>
        <p>
          These costs change over time. The global average cost of power from
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
          The estimate depends on{" "}
          <EntryLink to={MANUAL_ENTRY.CAPACITY_FACTOR}>
            expected output
          </EntryLink>{" "}
          and quoted fuel prices; actual bills depend on how you run the plant.
          See{" "}
          <EntryLink to={MANUAL_ENTRY.OPERATING_COSTS}>
            Operating costs
          </EntryLink>{" "}
          for fixed and variable O&amp;M.
        </p>
        <p>
          A plant's lifetime revenue is its share of electricity sales,
          including exports. Charging storage creates no extra sale, and imports
          earn local plants nothing.
        </p>
      </div>
    ),
  },
];
