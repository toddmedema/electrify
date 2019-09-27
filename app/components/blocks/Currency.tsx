import * as React from 'react'


interface CurrencyProps extends React.Props<any> {
  delta?: boolean;
  val: number;
};

// TODO red if negative / green if positive (if delta)
export default class Currency extends React.Component<CurrencyProps, {}> {
  render() {
    const num = +this.props.val;
    let output = '-';

    if (num && typeof num === 'number') {
      output = Number(num).toLocaleString();
    }
    return (<span>${output}</span>);
  }
}
