import type { TabId, TourTarget } from "../state/investigation";

// One-sentence plain-language intros, shown in the info tips beside each
// section title. They describe the tool, not any particular incident.
export const SECTION_INTROS: Record<TabId, string> = {
  overview:
    "An incident is a stretch of time when one service degrades and the symptoms ripple to everything that calls it. The map shows the services, the evidence graph shows how Faultline reasons from what changed to who it ranks first.",
  "root-causes":
    "Root cause analysis works backwards from symptoms to the service that started it. Every service gets a fixed formula over nine kinds of evidence; click a score row to see exactly why.",
  signals:
    "The raw telemetry behind the verdict: which services looked unusual and when, and one slow request followed hop by hop.",
  case:
    "What is known about this incident up front, and the answer, which stays hidden until you reveal it. The ranker never sees it.",
  runtime:
    "Under the hood: the streaming engine computing everything on the stage, live. Watermarks, checkpoints, query plans and counters, exposed rather than hidden.",
};

export const MAP_INTRO =
  "Each circle is one small program, a service. An arrow means \"calls\". A circle turns red when that service gets slower than it usually is, a double ring means it just got a new version, and the top suspect carries its rank. Grey circles report numbers but no calls were seen.";

export const EVIDENCE_INTRO =
  "Follow the arrows left to right: something changed, some numbers went strange, some services got slow, and these are the suspects, ranked. It is an explanation of the evidence, not proof. Dashed red arrows point the other way. Faded boxes are still ahead of the replay.";

// Three sentences for someone who has never heard of services or incidents.
export const PRIMER: string[] = [
  "A modern app is not one program. It is many small programs, called services, calling each other.",
  "When one of them breaks, the ones that depend on it look broken too, so the alarm usually goes off far from the real problem.",
  "Faultline replays the incident and works out which service most likely started it.",
];

// The 30-second tour: one panel per step, plain words.
export const TOUR_STEPS: Array<{ target: TourTarget | null; title: string; text: string }> = [
  {
    target: null,
    title: "What is this?",
    text: PRIMER.join(" "),
  },
  {
    target: "map",
    title: "Who calls whom",
    text: "These circles are the shop's services. An arrow means \"calls\". Watch for circles turning red.",
  },
  {
    target: "track",
    title: "The recording",
    text: "This is the incident recording, about 15 seconds long. Yellow bars are new versions being deployed.",
  },
  {
    target: "evidence",
    title: "How Faultline reasoned",
    text: "Read it left to right: something changed, numbers went strange, services got slow, and these are the suspects.",
  },
  {
    target: "verdict",
    title: "Most likely culprit",
    text: "Faultline's answer, with how strong the evidence is. It is a best guess, not proof.",
  },
  {
    target: "verdict",
    title: "Now press Play",
    text: "Press Play to watch it all happen. Then open Why? for the numbers.",
  },
];
