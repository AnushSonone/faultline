import { useEffect, useMemo, useRef, useState } from "react";
import { useInvestigation } from "../state/investigation";
import { buildNarration } from "../lib/narration";
import { fmtIn } from "../lib/format";
import { KIND_COLORS } from "../theme/kinds";
import { sentenceFor } from "../lib/narrate";

// Row pitch in px: line height + padding + gap. Kept in sync with .now-item.
const ROW_PX = 40; // two-line rows (see .now-item)
const HEADER_PX = 20;

// The running commentary during replay: newest event at the top, cut at the
// cursor. Every row is derived from the payloads, so it narrates any
// incident. The row count follows the space the rail actually has, so a row
// is either whole or absent, never cut in half.
export function NowStrip({ maxRows = 14 }: { maxRows?: number }) {
  const timeline = useInvestigation((s) => s.timeline);
  const evidenceGraph = useInvestigation((s) => s.evidenceGraph);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const hoverService = useInvestigation((s) => s.hoverService);
  const selectService = useInvestigation((s) => s.selectService);
  const boxRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(maxRows);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const rows = Math.floor((el.clientHeight - HEADER_PX) / ROW_PX);
      // 0 rows = not enough room for a header and one whole row: render nothing
      setLimit(Math.max(0, Math.min(maxRows, rows)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxRows]);

  const items = useMemo(
    () => buildNarration({ timeline, evidenceGraph, cursorNs: cursor, limit }),
    [timeline, evidenceGraph, cursor, limit],
  );

  return (
    <div className="now-scroll" ref={boxRef}>
      {limit > 0 && <span className="eyebrow now-head">What just happened</span>}
      {limit === 0 ? null : items.length === 0 ? (
        <p className="now-empty" data-testid="now-strip">
          Nothing yet. Press Play, or drag the track past the first deploy.
        </p>
      ) : (
        <ol className="now-list" data-testid="now-strip">
          {items.map((it, i) => (
            <li
              key={it.id}
              className={i === 0 ? "now-item fresh" : "now-item"}
              title={sentenceFor(it)}
              onMouseEnter={() => hoverService(it.service)}
              onMouseLeave={() => hoverService(null)}
              onClick={() => it.service && selectService(it.service)}
            >
              <span className="now-time mono">{fmtIn(it.timeNs, startNs)}</span>
              <span className="now-dot" style={{ background: KIND_COLORS[it.kind] }} aria-hidden="true" />
              <span className="now-text">{sentenceFor(it)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
