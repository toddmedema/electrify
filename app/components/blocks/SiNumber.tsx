import * as React from 'react'


const MIN_VALUE = 100000;
const SI = [
  { value: 1E18, symbol: 'E' },
  { value: 1E15, symbol: 'P' },
  { value: 1E12, symbol: 'T' },
  { value: 1E9,  symbol: 'G' },
  { value: 1E6,  symbol: 'M' },
  { value: 1E3,  symbol: 'k' }
];

interface SiNumberProps extends React.Props<any> {
  unit: string;
  val: number;
};

// If number > 100,000, suffixes with k, M, etc and rounds to 1 digit
// Otherwise, rounds to the nearest whole digit and adds comas
export default class SiNumber extends React.Component<SiNumberProps, {}> {
  render() {
    const num = +this.props.val;
    let output = '-';

    if (num !== null && typeof num === 'number') {
      if (num >= MIN_VALUE) {
        for (let i = 0; i < SI.length; i++) {
          if (num >= SI[i].value) {
            const divided = Math.floor(num / SI[i].value * 10) / 10; // Show 1 decimal as long as it's not a 0
            output = divided + SI[i].symbol;
            break;
          }
        }
      } else {
        output = Number(num).toLocaleString();
      }
    }
    return (<span>{output}{this.props.unit}</span>);
  }
}
