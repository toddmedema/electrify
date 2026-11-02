/** Pair both orders within each sample, so linear timing drift affects both paths equally. */
export function counterbalancedSamples<T>(
  measure: (immer: boolean) => T,
  immerFirst = false,
): { plain: [T, T]; immer: [T, T] } {
  const first = measure(immerFirst);
  const second = measure(!immerFirst);
  const third = measure(!immerFirst);
  const fourth = measure(immerFirst);
  return immerFirst
    ? { plain: [second, third], immer: [first, fourth] }
    : { plain: [first, fourth], immer: [second, third] };
}
