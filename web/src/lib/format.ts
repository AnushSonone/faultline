const DURATION_UNITS = ["ns", "µs", "ms", "s"] as const;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function mantissa(v: number): string {
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}

export function fmtOffset(
  ns: number | null | undefined,
  startNs: number | null | undefined,
): string {
  if (ns == null || startNs == null) return "-";
  const sec = Math.max(0, (ns - startNs) / 1e9);
  if (sec >= 600) {
    let m = Math.floor(sec / 60);
    let s = Math.round(sec - m * 60);
    if (s === 60) {
      m += 1;
      s = 0;
    }
    return `t+${m}m ${String(s).padStart(2, "0")}s`;
  }
  if (sec >= 100) return `t+${Math.round(sec)}s`;
  return `t+${sec.toFixed(1)}s`;
}

// Same clock as fmtOffset, in plain words for the transport readout and the
// narration: "7.5 s in", "312 s in", "23m 54s in".
export function fmtIn(
  ns: number | null | undefined,
  startNs: number | null | undefined,
): string {
  if (ns == null || startNs == null) return "-";
  const sec = Math.max(0, (ns - startNs) / 1e9);
  if (sec >= 600) {
    let m = Math.floor(sec / 60);
    let s = Math.round(sec - m * 60);
    if (s === 60) {
      m += 1;
      s = 0;
    }
    return `${m}m ${String(s).padStart(2, "0")}s in`;
  }
  if (sec >= 100) return `${Math.round(sec)} s in`;
  return `${sec.toFixed(1)} s in`;
}

export function fmtDurationNs(ns: number | null | undefined): string {
  if (ns == null) return "-";
  let v = ns;
  let i = 0;
  while (v >= 1000 && i < DURATION_UNITS.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${mantissa(v)} ${DURATION_UNITS[i]}`;
}

// The recorded window, for a status pill. RCAEval recordings are 1440 s, which
// reads as nonsense in seconds.
export function fmtWindowS(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unknown";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const min = seconds / 60;
  return `${min < 10 ? Number(min.toFixed(1)) : Math.round(min)} min`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "-";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${mantissa(v)} ${BYTE_UNITS[i]}`;
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString("en-US");
}

// Compact counts for dense grids: 950, 12.4k, 3.1M.
export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "-";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1e6) return `${(n / 1e3).toFixed(abs < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

export function titleCase(snake: string): string {
  const words = snake.replace(/_/g, " ").toLowerCase();
  if (words.length === 0) return words;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function shortTraceId(id: string): string {
  if (id.length <= 8) return id;
  return `…${id.slice(-6)}`;
}
