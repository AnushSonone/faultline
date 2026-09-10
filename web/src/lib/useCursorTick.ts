import { useEffect, useState } from "react";
import { useInvestigation } from "../state/investigation";

// A counter that advances when the replay cursor moves: immediately on the
// first move (a seek), then at most once per `ms` while it keeps moving (play).
// Components that query the API at the cursor re-run on it.
export function useCursorTick(ms = 2000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let last = 0;
    let timer: number | null = null;
    let pending = false;
    const fire = () => {
      last = Date.now();
      pending = false;
      setTick((n) => n + 1);
    };
    const unsubscribe = useInvestigation.subscribe((state, prev) => {
      if (state.selectedEventTime === prev.selectedEventTime) return;
      const elapsed = Date.now() - last;
      if (elapsed >= ms) {
        if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
        fire();
        return;
      }
      if (!pending) {
        pending = true;
        timer = window.setTimeout(() => {
          timer = null;
          fire();
        }, ms - elapsed);
      }
    });
    return () => {
      unsubscribe();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [ms]);
  return tick;
}
