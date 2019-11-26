import * as React from 'react';

export interface StateProps {
  title: string;
  icon: string;
}

export interface DispatchProps {
  onReturn: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const QuestListCard = (props: Props): JSX.Element => {
  return <p>HI</p>;
};

export default QuestListCard;
