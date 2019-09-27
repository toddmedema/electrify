import * as React from 'react'
import {BottomNavigation, BottomNavigationItem} from 'material-ui/BottomNavigation'
import FlatButton from 'material-ui/FlatButton'
import FontIcon from 'material-ui/FontIcon'
import {List, ListItem} from 'material-ui/List'
import Paper from 'material-ui/Paper'
import RaisedButton from 'material-ui/RaisedButton'
import Currency from './blocks/Currency'
import SiNumber from './blocks/SiNumber'
import {GameState, GeneratorDefinition, GeneratorId, GeneratorState, NavigationState} from '../reducers/StateTypes'
import {GENERATORS} from '../Constants'


export interface BuildScreenStateProps {
  game: GameState;
  navigation: NavigationState;
};

export interface BuildScreenDispatchProps {
  onBuild: (id: GeneratorId) => void;
  onBuildNav: () => void;
  onGeneratorsNav: () => void;
  onResearchNav: () => void;
  onSimulateNav: () => void;
}

interface BuildScreenProps extends BuildScreenStateProps, BuildScreenDispatchProps {}

const BuildScreen = (props: BuildScreenProps): JSX.Element => {
  // render() {
  const company = props.game.company;
  const generators = company.generators;
  const time = props.game.time;

  let capacityMin = 0;
  let capacityMax = 0;
  generators.forEach((generator: GeneratorState) => {
    const gen = GENERATORS[generator.id];
    capacityMin += gen.whMin;
    capacityMax += gen.whMax;
  });


// TODO figure out where next time's estimates should be calculated
// Likely in its own game action, to be called at game start + end of simulate

    let bottomSection = <span></span>;
    switch (props.navigation.page) {
      case 'GENERATORS':
        const generatorList = generators
          .map((generator: GeneratorState, i: number): JSX.Element => {
            const details = GENERATORS[generator.id];
// TODO set up generator pausing and resuming prop function
            return <li key={i} className={`generatorList--item &{!generator.enabled && 'disabled'}`}>
              <span><FontIcon className="fa fa-industry" /> {details.name}</span>
              <div className="generatorList--pauseButton">
                <FlatButton>
                  {generator.enabled && <FontIcon className="fa fa-pause-circle-o" />}
                  {!generator.enabled && <FontIcon className="fa fa-play-circle" />}
                </FlatButton>
              </div>
              <section className="generatorList--details">
                <p>Capacity: <SiNumber val={details.whMin} unit="W" /> - <SiNumber val={details.whMax} unit="W" /></p>
                <p>Total Cost/MWh: <Currency val={details.costAmortizedMWh} /></p>
              </section>
            </li>;
          });
        bottomSection = <ul className="buildList">{generatorList}</ul>;
        break;
      case 'BUILD':
        const buildableGenerators = GENERATORS
// TODO filter down to just those available / researched
// along with flagging what you can vs can't afford, perhaps even letting the user sort by
// relevant metrics, such as build cost vs amortized cost per mw vs fastest ramping capacity
          .map((generator: GeneratorDefinition, i: number): JSX.Element => {
            return <li key={i} className="buildList--item">
              <span><FontIcon className="fa fa-industry" /> {generator.name}</span>
              <div className="buildList--buildButton">
                <FlatButton onTouchTap={() => props.onBuild(generator.id)}>
                  <FontIcon className="fa fa-plus" />
                </FlatButton>
              </div>
              <section className="buildList--details">
                <p>Capacity: <SiNumber val={generator.whMin} unit="W" /> - <SiNumber val={generator.whMax} unit="W" /></p>
                <p>Cost to build: <Currency val={generator.costBuild} /></p>
                <p>Total Cost/MWh: <Currency val={generator.costAmortizedMWh} /></p>
              </section>
            </li>;
          });
        bottomSection = <ul className="buildList">{buildableGenerators}</ul>;
        break;
      case 'RESEARCH':
        bottomSection = <ul className="researchList">
            <div className="researchList--item">
              <FontIcon className="fa fa-flask" /> Research
            </div>
          </ul>;
        break;
      default:
        break;
    }

    return (
      <div className="build">
        <header>
          <div className="floatLeft"><Currency val={company.money} /></div>
          <div className="floatRight">{time.quarter}, {time.year}</div>
          <h1>{company.name}</h1>
        </header>
        <section className="build--topSection">
          TODO: better display this information
          <div>Capacity: <SiNumber val={capacityMin} unit="W" />{capacityMin !== capacityMax && <span> - <SiNumber val={capacityMax} unit="W" /></span>}</div>
          <div>Expected demand: <SiNumber val={1} unit="W" /> - <SiNumber val={9001} unit="W" /></div>
          <div>Expected weather: TODO</div>
        </section>
        <section className="hasFooter scrollable build--bottomSection">
          {bottomSection}
        </section>
        <Paper zDepth={1} className="footer">
          <BottomNavigation selectedIndex={['GENERATORS', 'BUILD', 'RESEARCH'].indexOf(props.navigation.page)}>
            <BottomNavigationItem
              label="Generators"
              icon={<FontIcon className="fa fa-industry" />}
              onClick={props.onGeneratorsNav}
            />
            <BottomNavigationItem
              label="Build"
              icon={<FontIcon className="fa fa-wrench" />}
              onClick={props.onBuildNav}
            />
            <BottomNavigationItem
              label="Research"
              icon={<FontIcon className="fa fa-flask" />}
              onClick={props.onResearchNav}
            />
            <BottomNavigationItem
              label="Start"
              icon={<FontIcon className="fa fa-chevron-right" />}
              onClick={props.onSimulateNav}
            />
          </BottomNavigation>
        </Paper>
      </div>
    );
  // }
}

export default BuildScreen;
