import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Collapse,
  IconButton,
  List,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import SearchIcon from "@mui/icons-material/Search";
import InputBase from "@mui/material/InputBase";

export interface StateProps {}

export interface DispatchProps {
  onBack: () => void;
}

interface ManualEntry {
  title: string;
  entry: JSX.Element;
}

function ManualItem(props: ManualEntry): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  return (
    <Card onClick={toggleExpand} className="build-list-item expandable">
      <CardHeader title={props.title} />
      {!expanded && (
        <ArrowDropDownIcon color="primary" className="expand-icon" />
      )}
      {expanded && <ArrowDropUpIcon color="primary" className="expand-icon" />}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <CardContent>{props.entry}</CardContent>
      </Collapse>
    </Card>
  );
}

export interface Props extends StateProps, DispatchProps {}

export default class Manual extends React.PureComponent<
  Props,
  { searchTerm: string }
> {
  state = {
    searchTerm: "",
  };

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ searchTerm: event.target.value });
  };

  filterEntries = () => {
    return MANUAL_ENTRIES.filter((entry) => {
      const titleMatch = entry.title
        .toLowerCase()
        .includes(this.state.searchTerm.toLowerCase());

      let contentMatch = false;
      const children = entry.entry.props.children;

      if (typeof children === "string") {
        contentMatch = children
          .toLowerCase()
          .includes(this.state.searchTerm.toLowerCase());
      } else if (Array.isArray(children)) {
        contentMatch = children.some((child) => {
          if (typeof child === "string") {
            return child
              .toLowerCase()
              .includes(this.state.searchTerm.toLowerCase());
          }
          if (child && typeof child === "object" && "props" in child) {
            const childText = child.props.children;
            if (typeof childText === "string") {
              return childText
                .toLowerCase()
                .includes(this.state.searchTerm.toLowerCase());
            }
          }
          return false;
        });
      } else if (
        children &&
        typeof children === "object" &&
        "props" in children
      ) {
        const childText = children.props.children;
        if (typeof childText === "string") {
          contentMatch = childText
            .toLowerCase()
            .includes(this.state.searchTerm.toLowerCase());
        }
      }

      return titleMatch || contentMatch;
    });
  };

  public render() {
    const filteredEntries = this.state.searchTerm
      ? this.filterEntries()
      : MANUAL_ENTRIES;

    return (
      <div className="flexContainer" id="gameCard">
        <div id="topbar">
          <Toolbar>
            <IconButton
              onClick={this.props.onBack}
              aria-label="back"
              edge="start"
              color="primary"
              size="large"
            >
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6">Electrify Manual</Typography>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginLeft: "auto",
              }}
            >
              <InputBase
                placeholder="Search..."
                value={this.state.searchTerm}
                onChange={this.handleSearch}
                style={{ marginRight: "8px" }}
              />
              <IconButton
                aria-label="search"
                edge="end"
                color="primary"
                size="large"
              >
                <SearchIcon />
              </IconButton>
            </div>
          </Toolbar>
        </div>
        <List dense className="scrollable cardList" id="manual">
          <Card>
            <CardContent>
              Here, you can look up specific terms and mechanics to learn more
              about how they work in game - and in real life.
            </CardContent>
          </Card>
          {filteredEntries.map((entry: ManualEntry) => (
            <ManualItem {...entry} key={entry.title} />
          ))}
        </List>
      </div>
    );
  }
}

const MANUAL_ENTRIES = [
  {
    title: `Blackouts`,
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
    title: `BTU and MMBTU`,
    entry: (
      <p>
        The British Thermal Unit is a measure of heat energy. MMBTU is one
        million BTU, and equals approximately 300 kWh of electrical energy.
      </p>
    ),
  },
  {
    // Credit to https://www.e-education.psu.edu/ebf200/node/151
    title: `Customers, Demand & Marketing`,
    entry: (
      <div>
        <p>
          More customers drives more demand. Although individual customer types
          (residential, commercial, industrial) have different demand curves,
          we've aggregated them into a single "customers" number that reflects a
          blend of customer types. Here's what demand by type looks like in real
          life:
        </p>
        <img
          src="/images/manual-demand-customer-types.png"
          alt="Source: https://www.eia.gov/todayinenergy/detail.php?id=10211"
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
        <img src="/images/manual-demand.jpg" alt="Demand chart" />
      </div>
    ),
  },
  {
    title: `Emissions and CO2e`,
    entry: (
      <div>
        <p>
          CO2e stands for Carbon Dioxide equivalent, a measure of the greenhouse
          warming impact of various pollutants.
        </p>
        <p>
          Electricity generation is the 2nd largest source of greenhouse gas in
          the United States, but our utilities have no financial incentive to
          reduce their emissions.
        </p>
        <p>
          One of the highest-rated proposals to reduce emissions is a "Carbon
          Fee" that creates a financial incentive for businesses to reduce their
          carbon footprint through innovation. Electrify lets you experiment
          with different levels of carbon fees, and see how technology
          innovation can enable better business decisions than the fossil fuels
          of the past.
        </p>
      </div>
    ),
  },
  {
    title: `Forecasts`,
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
    title: `Keyboard Shortcuts`,
    entry: (
      <div>
        <p>
          While a scenario is running, you can drive the game from the keyboard:
        </p>
        <table className="shortcuts">
          <tbody>
            <tr>
              <td>
                <kbd>`</kbd> <kbd>space</kbd> <kbd>0</kbd>
              </td>
              <td>Pause</td>
            </tr>
            <tr>
              <td>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </td>
              <td>Slow / normal / fast speed</td>
            </tr>
            <tr>
              <td>
                <kbd>Q</kbd>
              </td>
              <td>Facilities tab</td>
            </tr>
            <tr>
              <td>
                <kbd>W</kbd>
              </td>
              <td>Finances tab</td>
            </tr>
            <tr>
              <td>
                <kbd>E</kbd>
              </td>
              <td>Forecasts tab</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
  },
  {
    // Credit to https://www.e-education.psu.edu/ebf200/node/151
    title: `Prioritizing Generators`,
    entry: (
      <div>
        <p>
          Companies prioritize their generation stack based on how long they
          take to ramp up and down, their marginal cost (fuel) and whether
          they're controllable.
        </p>
        <p>
          Here's a real-world generation stack from the PJM
          (Pennsylvania-Jersey-Maryland) market in 2008:
        </p>
        <img src="/images/manual-generation-stack.jpg" alt="Generation stack" />
      </div>
    ),
  },
  {
    title: `Score`,
    entry: (
      <div>
        <p>
          At the end of your term as CEO (each scenario has a different length),
          you'll receive a score for how well you did. Try to beat your score
          the next time you play!
        </p>
        <p>Investor-owned scenarios are scored as follows:</p>
        <p>
          4 pts for each $100M of net worth at the end
          <br />
          2 pts for each 100k customers at the end
          <br />
          1 pt for each TWh supplied
          <br />
          -2 pts for each megaton (1M tons) of CO2e emitted
          <br />
          -8 pts for each TWh of blackouts
        </p>
        <p>Public-owned scenarios are scored as follows:</p>
        <p>
          +/-80 pts for each $0.01/kWh that your lifetime average rate lands
          below/above the scenario's target rate
          <br />
          10 pts for each TWh supplied
          <br />
          -5 pts for each megaton (1M tons) of CO2e emitted
          <br />
          -10 pts for each TWh of blackouts
        </p>
      </div>
    ),
  },
  {
    title: `Total Cost of Energy`,
    entry: (
      <p>
        Also known as "Levelized Cost of Energy", it's the expected cost of all
        energy produced by the plant during its lifetime, including
        construction, maintenance and fuel.
      </p>
    ),
  },
].sort((a, b) => (a.title > b.title ? 1 : -1)) as ManualEntry[];
