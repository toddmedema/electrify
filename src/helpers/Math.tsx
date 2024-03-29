// http://jsfiddle.net/justin_c_rounds/Gd2S2/light/
export function getIntersectionX(line1StartX: number, line1StartY: number, line1EndX: number, line1EndY: number, line2StartX: number, line2StartY: number, line2EndX: number, line2EndY: number) {
  const denominator = ((line2EndY - line2StartY) * (line1EndX - line1StartX)) - ((line2EndX - line2StartX) * (line1EndY - line1StartY));
  if (denominator === 0) {
    return 0;
  }
  const a = line1StartY - line2StartY;
  const b = line1StartX - line2StartX;
  const numerator1 = ((line2EndX - line2StartX) * a) - ((line2EndY - line2StartY) * b);
  return line1StartX + (numerator1 / denominator * (line1EndX - line1StartX));
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
export function getRandomRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}