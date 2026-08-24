// http://jsfiddle.net/justin_c_rounds/Gd2S2/light/
export function getIntersectionX(
  line1StartX: number,
  line1StartY: number,
  line1EndX: number,
  line1EndY: number,
  line2StartX: number,
  line2StartY: number,
  line2EndX: number,
  line2EndY: number,
) {
  const denominator =
    (line2EndY - line2StartY) * (line1EndX - line1StartX) -
    (line2EndX - line2StartX) * (line1EndY - line1StartY);
  if (denominator === 0) {
    return 0;
  }
  const a = line1StartY - line2StartY;
  const b = line1StartX - line2StartX;
  const numerator1 =
    (line2EndX - line2StartX) * a - (line2EndY - line2StartY) * b;
  return line1StartX + (numerator1 / denominator) * (line1EndX - line1StartX);
}

// Every random draw in the simulation is addressed by (seed, stream, index) rather than pulled
// from a running generator. That makes the whole run a pure function of its seed: any value can
// be recomputed at any point, in any order, without knowing how many draws came before it -- so
// nothing sequential has to be carried around for a reloaded game to match the one that was
// saved, and the caches built on top of these draws come out the same cold as warm.
//
// Streams keep unrelated parts of the simulation out of each other's draws: weather and fuel
// prices each walk their own index space, so adding a draw to one never shifts the other. The
// values are arbitrary but have to stay distinct, and have to stay put -- changing one changes
// what every existing seed produces.
export const RANDOM_STREAM = {
  weather: 1,
  fuelPrices: 2,
  economy: 3,
};

// https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
// splitmix32's finalizing mix, which spreads a counter-ish 32 bit value across the whole word.
// Applied here to a hash of (seed, stream, index) rather than to successive counter states.
function splitmix32Mix(a: number): number {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
}

/**
 * The simulation's only source of randomness: a value in [0, 1) determined entirely by the three
 * coordinates it is given. Neighbouring indexes are as unrelated as distant ones, so callers can
 * walk their index space in whatever order they need to.
 */
export function randomAt(seed: number, stream: number, index: number): number {
  // Fold the coordinates together before mixing so that a change to any one of them disturbs the
  // whole word rather than just its low bits
  let h = seed | 0;
  h = Math.imul(h ^ (stream + 0x9e3779b1), 0x85ebca6b) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) | 0;
  h = Math.imul(h ^ index, 0x27d4eb2f) | 0;
  return splitmix32Mix(h ^ (h >>> 16));
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
export function getRandomRangeAt(
  seed: number,
  stream: number,
  index: number,
  min: number,
  max: number,
): number {
  return randomAt(seed, stream, index) * (max - min) + min;
}

/**
 * A standard normal draw (mean 0, standard deviation 1) addressed the same way `randomAt` is.
 *
 * Box-Muller over a pair of uniforms, which is why one normal costs two indexes: the pair is
 * taken from `2 * index` and `2 * index + 1` rather than from neighbouring indexes, so callers
 * can walk their own index space one normal at a time without two of them ever sharing a uniform.
 *
 * Weather anomalies are the reason this exists. A uniform nudge gives every deviation inside its
 * range the same likelihood and nothing at all outside it, which is the wrong shape for a
 * departure from normal: real ones cluster near average with occasional outliers, and have no
 * hard cutoff. Scaling a normal by an observed standard deviation reproduces the spread that was
 * actually measured.
 */
export function normalAt(seed: number, stream: number, index: number): number {
  // Guarded because Box-Muller takes a log of the first uniform, and randomAt's range is
  // half open -- a draw of exactly 0 would return -Infinity
  const u1 = Math.max(Number.MIN_VALUE, randomAt(seed, stream, index * 2));
  const u2 = randomAt(seed, stream, index * 2 + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Seeds are mixed as 32 bit integers, so a wider one (a float, or Date.now() times something) is
// silently truncated and no longer describes the run it is stored alongside. Mint them here.
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

// https://stackoverflow.com/questions/5306680/move-an-array-element-from-one-array-position-to-another
export function arrayMove<T>(
  arr: Array<T | undefined>,
  oldIndex: number,
  newIndex: number,
) {
  if (newIndex >= arr.length) {
    let k = newIndex - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(newIndex, 0, arr.splice(oldIndex, 1)[0]);
}
