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

export default class Manual extends React.PureComponent<Props, {}> {
  // TODO search state -> filter clones list of entries by title + entry text

  public render() {
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
            <IconButton
              onClick={this.props.onBack}
              aria-label="search"
              edge="end"
              color="primary"
              size="large"
            >
              <SearchIcon />
            </IconButton>
          </Toolbar>
        </div>
        <List dense className="scrollable cardList" id="manual">
          <Card>
            <CardContent>
              Here, you can look up specific terms and mechanics to learn more
              about how they work in game - and in real life.
            </CardContent>
          </Card>
          {MANUAL_ENTRIES.map((entry: ManualEntry) => (
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
    entry: <p>TODO how to read the forecast</p>,
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
        <p>Scores are calculated as follows:</p>
        <p>
          4 pts for each $100M of net worth at the end
          <br />
          2 pts for each 100k customers at the end
          <br />
          1 pt for each TWh supplied
          <br />
          -2 pts for each kTon of pollution
          <br />
          -8 pts for each TWh of blackouts
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
