// Placement of the walkthrough callout next to its spotlight. Pure, so the
// preference order and the clamping are unit-tested.

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Side = "below" | "above" | "right" | "left" | "center";
export type Placement = { left: number; top: number; side: Side; pointer: number };

const POINTER_INSET = 14;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Try below, above, right, left, in that order; the first side where the
// card fits wins. Centre the card on the spot along the other axis, then
// clamp into the shell. The pointer is the spot centre projected onto the
// card's facing edge, kept clear of the rounded corners. With no spot the
// card sits in the middle of the shell, where the first-visit dialog was.
export function placeCallout(
  spot: Rect | null,
  card: Size,
  shell: Size,
  gap = 12,
  margin = 8,
): Placement {
  const maxLeft = Math.max(margin, shell.width - card.width - margin);
  const maxTop = Math.max(margin, shell.height - card.height - margin);
  if (!spot) {
    return {
      left: clamp((shell.width - card.width) / 2, margin, maxLeft),
      top: clamp((shell.height - card.height) / 2, margin, maxTop),
      side: "center",
      pointer: 0,
    };
  }
  const cx = spot.left + spot.width / 2;
  const cy = spot.top + spot.height / 2;
  const fits = {
    below: spot.top + spot.height + gap + card.height <= shell.height - margin,
    above: spot.top - gap - card.height >= margin,
    right: spot.left + spot.width + gap + card.width <= shell.width - margin,
    left: spot.left - gap - card.width >= margin,
  };
  const side: Side = fits.below
    ? "below"
    : fits.above
      ? "above"
      : fits.right
        ? "right"
        : fits.left
          ? "left"
          : "below";
  let left: number;
  let top: number;
  switch (side) {
    case "below":
      top = spot.top + spot.height + gap;
      left = cx - card.width / 2;
      break;
    case "above":
      top = spot.top - gap - card.height;
      left = cx - card.width / 2;
      break;
    case "right":
      left = spot.left + spot.width + gap;
      top = cy - card.height / 2;
      break;
    default:
      left = spot.left - gap - card.width;
      top = cy - card.height / 2;
      break;
  }
  left = clamp(left, margin, maxLeft);
  top = clamp(top, margin, maxTop);
  const horizontalEdge = side === "below" || side === "above";
  const pointer = horizontalEdge
    ? clamp(cx - left, POINTER_INSET, Math.max(POINTER_INSET, card.width - POINTER_INSET))
    : clamp(cy - top, POINTER_INSET, Math.max(POINTER_INSET, card.height - POINTER_INSET));
  return { left, top, side, pointer };
}
