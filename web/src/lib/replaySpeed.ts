// Replay speed policy. The server accepts a fixed set of multipliers; pick
// the one whose wall-clock replay length lands closest to a watchable target.
// The guided incident spans 15 s of event time: at 10x it is over in 1.5 s,
// which is unreadable; at 1x it takes 15 s, which is a demo.

// Must match ReplaySpeed::parse in crates/replay/src/clock.rs.
export const SPEEDS = ["0.5", "1", "2", "5", "10", "50"] as const;
export type Speed = (typeof SPEEDS)[number];

export const DEFAULT_SPEED: Speed = "10";
export const TARGET_WALL_SECONDS = 20;

export function pickReplaySpeed(
  spanNs: number | null | undefined,
  targetWallSeconds: number = TARGET_WALL_SECONDS,
): Speed {
  if (spanNs == null || !Number.isFinite(spanNs) || spanNs <= 0) return DEFAULT_SPEED;
  const spanS = spanNs / 1e9;
  let best: Speed = DEFAULT_SPEED;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const s of SPEEDS) {
    const wall = spanS / Number(s);
    // Log-distance: 2x too slow and 2x too fast are equally wrong.
    const err = Math.abs(Math.log(wall / targetWallSeconds));
    if (err < bestErr) {
      best = s;
      bestErr = err;
    }
  }
  return best;
}
