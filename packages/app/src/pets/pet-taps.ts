/**
 * Desk-pet tap-burst classification.
 *
 * The single tap must react immediately (<50ms), so a burst never delays the
 * first pat: the first tap fires its reaction right away and the burst is only
 * *upgraded* once the window closes.
 *
 * @module paseo/pets/pet-taps
 */

/**
 * How long a burst of taps keeps counting. Taps that arrive inside this window
 * upgrade the burst to a double or triple tap when the window closes.
 */
export const TAP_BURST_WINDOW_MS = 300;

/** Which burst action a completed tap count resolves to. */
export function resolveTapBurstAction(tapCount: number): "double" | "triple" | null {
  if (tapCount >= 3) return "triple";
  if (tapCount === 2) return "double";
  return null;
}
