import {Card, CardContent, CardHeader, Collapse, IconButton, List, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import SearchIcon from '@material-ui/icons/Search';
import * as React from 'react';

export interface StateProps {
}

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
      {!expanded && <ArrowDropDownIcon color="primary" className="expand-icon"  />}
      {expanded && <ArrowDropUpIcon color="primary" className="expand-icon"  />}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <CardContent>{props.entry}</CardContent>
      </Collapse>
    </Card>
  );
}

export interface Props extends StateProps, DispatchProps {}

export default class Manual extends React.PureComponent<Props, {}> {

  // TODO search state, filtering entries

  public render() {
    return (
      <div className="flexContainer" id="gameCard">
        <div id="topbar">
          <Toolbar>
            <IconButton onClick={this.props.onBack} aria-label="back" edge="start" color="primary">
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6">Electrify Manual</Typography>
            <IconButton onClick={this.props.onBack} aria-label="search" edge="end" color="primary">
              <SearchIcon />
            </IconButton>
          </Toolbar>
        </div>
        <List dense className="scrollable expandableList">
          {MANUAL_ENTRIES.map((entry: ManualEntry) => <ManualItem {...entry} key={entry.title}/> )}
        </List>
      </div>
    );
  }
}

const MANUAL_ENTRIES = [
  {
    title: `Blackouts`,
    entry: <p>You don’t lose money for not providing service (utilities can’t be sued for blackouts), but you’ll lose customers</p>,
  },
  {
    title: `Forecasts`,
    entry: <p>TODO how to read the forecast</p>,
  },
  {
    title: `Prioritizing Generators`,
    entry: <p>Generally companies prioritize nuclear -> renewable -> coal -> natural gas -> oil... TODO link to PJM stack</p>,
  },
  {
    title: `Total Cost of Energy`,
    entry: <p>Also known as "Levelized Cost of Energy", it's the expected cost of all energy produced by the plant during its lifetime, including construction, maintenance and fuel.</p>,
  },
].sort((a, b) => a.title > b.title ? 1 : -1) as ManualEntry[];
