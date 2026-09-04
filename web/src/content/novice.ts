import type { TabId } from "../state/investigation";

// Plain-language section intros for readers who have never done incident
// response. Kept here (not in scenarios.ts) because they describe the tool,
// not any particular incident.
export const SECTION_INTROS: Record<TabId, string> = {
  overview:
    "An incident is a stretch of time when something in a distributed system goes wrong: one service degrades, and the symptoms ripple to everything that calls it. This section shows the map of services, the timeline of what happened, and Faultline's best guess at the cause.",
  "root-causes":
    "Root cause analysis (RCA) means working backwards from the symptoms to the service that started it all. Faultline scores every service with a fixed formula over nine kinds of evidence. Click any score to see exactly why it believes what it believes.",
  signals:
    "The raw telemetry behind the verdict. The heatmap shows which services looked unusual and when; the trace waterfall follows one slow request hop by hop through the system.",
  runtime:
    "Under the hood: the streaming engine that computes everything above, live. Its watermarks, checkpoints, query planner, and internal counters, exposed rather than hidden.",
};
