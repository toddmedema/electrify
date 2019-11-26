import * as React from 'react';
import {initialSettings} from '../../reducers/Settings';
import QuestListCard, {Props} from './QuestListCard';
import {render} from 'app/Testing';

describe('QuestListCard', () => {
  function setup(overrides?: Partial<Props>) {
    const props: Props = {
      settings: {...initialSettings},
      onReturn: jasmine.createSpy('onReturn'),
      ...overrides,
    };
    const e = render(<QuestListCard {...(props as any as Props)} />);
    return {props, e};
  }

  test('Shows quests', () => {
    // TODO
  });
});
