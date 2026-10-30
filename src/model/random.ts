/** A source of random numbers from 0 (included) to 1 (not included), like Math.random. */
export type Random = () => number;

/** Fisher-Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
