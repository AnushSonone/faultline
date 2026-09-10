import { useLayoutEffect, useState, type RefObject } from "react";

// Measured content width of an element, kept fresh by a ResizeObserver. The
// runtime visuals size themselves in pixels from this so labels never scale.
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 320): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setW(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return w;
}
