// Curated case briefs for the demo incidents. Facts come from each fixture's
// labels.json, the live topology snapshot, benchmarks/rcaeval/tuning-v2.json
// (per-case ranks) and benchmarks/rcaeval/heldout-v2.json (held-out figures and
// ablations). The four real cases here are all in the 15-case tuning split, so
// any accuracy figure quoted beside them is the held-out one, with k/n and CI.
// Claim discipline: the ranker produces a ranked hypothesis, never a proven
// root cause. Keep that framing in every field.
//
// `headline`, `brief.fault`, `brief.changeEvent`, `brief.signals`, `abstract`,
// `watch` and `schematic` make up the case brief in the rail before the first
// Play. Keep `abstract` under about 180 characters: the rail card clamps it to
// two lines on a laptop-height viewport. `brief.outcome` and the longer fields
// feed the Case file tab, which is also where the ground truth is gated.

export type FaultSignal = "memory" | "cpu" | "latency";

export type CaseSchematic = {
  // The fault-injected service.
  origin: string;
  // Which metric departs from baseline at the origin.
  signal: FaultSignal;
  // Callers reached per propagation hop, nearest first.
  waves: string[][];
  // Bystanders drawn but never affected (callees of the origin, typically).
  bystanders?: string[];
  // Observed call edges, caller -> callee.
  edges: Array<[caller: string, callee: string]>;
  // A change event on the timeline, when the case has one.
  deploy?: { service: string; atS: number };
  injectedAtS: number;
};

export type Scenario = {
  // The incident picker option.
  title: string;
  source: "synthetic" | "eval-suite" | "rcaeval-re2ob";
  headline: string;
  // The case as an operator would meet it, before any methodology: what the
  // system is and what someone watching it would have noticed. Neither line
  // names the injected service; that is what the visitor is here to work out.
  // The question itself is the same for every case, so it lives in THE_QUESTION.
  caseSummary: { system: string; symptom: string };
  brief: {
    fault: string;
    changeEvent: string;
    signals: string;
    outcome: string;
  };
  abstract: string;
  // Two or three bullets, each starting with the feature it names.
  watch: string[];
  schematic: CaseSchematic;
  // Case file tab.
  whatHappened: string;
  whatWeEvaluate: string;
  whatToWatch: string;
  caveat?: string;
};

// The task, identical on every case: it is the demo's whole premise, so it is
// stated once rather than rewritten six times.
export const THE_QUESTION = "Which service is responsible?";
// The constraint under the question. Same on every case, like the question.
export const THE_INPUTS =
  "The only inputs are metrics, traces, logs and change events on an event-time clock. The ranker never reads the fault-injection label.";

const OB_SYSTEM =
  "Online Boutique, a demo e-commerce app under load. frontend calls checkout, which calls the cart, catalog and recommendation services.";

const RCAEVAL_SYSTEM =
  "Online Boutique on a real Kubernetes cluster, twelve services, recorded by RCAEval RE2-OB over 24 minutes of load.";

// Short forms for a status pill, where the full label would wrap the row.
export const SHORT_SOURCE: Record<Scenario["source"], string> = {
  synthetic: "synthetic",
  "eval-suite": "eval suite",
  "rcaeval-re2ob": "RCAEval RE2-OB",
};

export const SOURCE_LABELS: Record<Scenario["source"], string> = {
  synthetic: "synthetic fixture",
  "eval-suite": "synthetic eval suite",
  "rcaeval-re2ob": "RCAEval RE2-OB (real)",
};

const RCAEVAL_CAVEAT =
  "Traces are sampled 1 in 8 by whole trace and logs are capped at 4000 lines, so some evidence is structurally missing. RCAEval has no deploy events, which means the change proximity feature is structurally dead on every real case.";

const RCAEVAL_CHANGE = "none; RCAEval records no deploy events";
const RCAEVAL_SIGNALS = "metrics · traces (1/8 sampled) · logs (capped)";

export const SCENARIOS: Record<string, Scenario> = {
  "rec-mem-001": {
    title: "Guided: memory fault, recommendationservice (synthetic)",
    source: "synthetic",
    headline: "Memory fault in recommendationservice after a deployment",
    caseSummary: {
      system: OB_SYSTEM,
      symptom:
        "Five seconds into a fifteen second window, checkout slows and more than one service leaves its baseline. A deployment lands in the same window.",
    },
    brief: {
      fault: "memory leak, injected t+5 s of 15 s",
      changeEvent: "deployment on recommendationservice",
      signals: "metrics · traces · logs · change events",
      outcome: "ground truth ranked 1st",
    },
    abstract:
      "A deployment lands on recommendationservice at t+5 s and its memory departs from baseline. Its callers follow about 2 s later, a precedence gap visible only on the event-time clock.",
    watch: [
      "change_proximity: the deploy marker precedes the memory anomaly (left temporal interval join)",
      "temporal_precedence: recommendationservice's onset leads its callers' by about 2 s",
      "downstream_impact and topology_consistency: the anomalous set is exactly its caller closure",
    ],
    schematic: {
      origin: "recommendationservice",
      signal: "memory",
      waves: [["checkoutservice"], ["frontend"]],
      edges: [
        ["frontend", "checkoutservice"],
        ["checkoutservice", "recommendationservice"],
      ],
      deploy: { service: "recommendationservice", atS: 5 },
      injectedAtS: 5,
    },
    whatHappened:
      "A synthetic Online Boutique-style memory fault is injected into recommendationservice at t+5s, right after a deployment event lands. This is the only case in the demo with a change event on the timeline.",
    whatWeEvaluate:
      "Whether the deterministic nine-feature ranker, seeing only telemetry with labels hidden, pins the injected service. Here it ranks recommendationservice first.",
    whatToWatch:
      "The deploy marker on the timeline, the recommendationservice memory ramp, and its heatmap row brightening as the fault develops. In the score breakdown, change_proximity contributes because a deployment landed just before the fault.",
  },
  "eval-cpu-cart-007": {
    title: "Eval suite: CPU fault, cartservice (synthetic)",
    source: "eval-suite",
    headline: "CPU fault in cartservice, no change event",
    caseSummary: {
      system:
        "The same Online Boutique topology, generated by the eval suite with seed 7 and replayed under synthetic load.",
      symptom:
        "Six seconds into a nineteen second window, one service pins its CPU and its single caller slows behind it. Nothing was deployed.",
    },
    brief: {
      fault: "CPU saturation, injected t+6 s of 19 s",
      changeEvent: "none on the faulted service",
      signals: "metrics · traces · logs",
      outcome: "ground truth ranked 1st; 100% top-1 on this 16-case suite is expected",
    },
    abstract:
      "cartservice saturates its CPU with nothing deployed. Only frontend calls it, so the anomalous set is one hop wide and cleanly separable: a smoke test, not accuracy.",
    watch: [
      "anomaly_strength: the cpu metric's robust z-score carries most of the score",
      "topology_consistency: frontend's degradation is explained by its edge into cartservice",
      "change_proximity: zero, since no deployment precedes the onset",
    ],
    schematic: {
      origin: "cartservice",
      signal: "cpu",
      waves: [["frontend"]],
      bystanders: ["productcatalogservice"],
      edges: [
        ["frontend", "cartservice"],
        ["cartservice", "productcatalogservice"],
      ],
      injectedAtS: 6,
    },
    whatHappened:
      "A synthetic eval-suite CPU fault targets cartservice. The case comes from a 16-case suite generated with seed 7, and the ranker runs blind to the labels.",
    whatWeEvaluate:
      "A pipeline smoke test on cleanly separable synthetic faults. The ranker puts cartservice at rank 1, and 100% top-1 on this suite is expected. It is explicitly not evidence of real-world accuracy.",
    whatToWatch:
      "The cpu metric anomaly strength and topology consistency carrying the score for cartservice.",
  },
  "re2ob-checkoutservice-mem-1": {
    title: "RCAEval RE2-OB: memory fault, checkoutservice (real)",
    source: "rcaeval-re2ob",
    headline: "Memory fault in checkoutservice, real recording",
    caseSummary: {
      system: RCAEVAL_SYSTEM,
      symptom:
        "Halfway through the recording, memory climbs on one service and its callers slow behind it. Several services look anomalous at once.",
    },
    brief: {
      fault: "memory fault, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st on this case",
    },
    abstract:
      "A memory fault on a real Online Boutique deployment. Several services look anomalous at once, so the ranking separates origin from caller on precedence and topology alone.",
    watch: [
      "topology_consistency: removing it costs 7 of the 58 held-out top-1 hits",
      "anomaly_strength: memory departs from its rolling median well before latency does",
      "contradiction_penalty: stays near zero when no caller degrades before checkoutservice",
    ],
    schematic: {
      origin: "checkoutservice",
      signal: "memory",
      waves: [["frontend"]],
      bystanders: ["paymentservice"],
      edges: [
        ["frontend", "checkoutservice"],
        ["checkoutservice", "paymentservice"],
      ],
      injectedAtS: 720,
    },
    whatHappened:
      "A real RCAEval RE2-OB case: a memory fault injected into checkoutservice on a real Online Boutique deployment. The ranker puts checkoutservice at rank 1.",
    whatWeEvaluate:
      "Blind ranking on real fault-injection telemetry. Ranking weights are unchanged from the spec; the anomaly detector was fixed on the 15-case tuning split, which includes this case.",
    whatToWatch:
      "Topology consistency carrying the separation between origin and callers. On 75 held-out RE2-OB cases the ranker puts the injected service first in 58/75 (77%, 95% CI 67 to 85%) and in the top 3 in 73/75; without topology, top-1 falls to 51/75.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-currencyservice-delay-1": {
    title: "RCAEval RE2-OB: network delay, currencyservice (real)",
    source: "rcaeval-re2ob",
    headline: "Network delay on currencyservice, real recording",
    caseSummary: {
      system: RCAEVAL_SYSTEM,
      symptom:
        "Halfway through the recording, every call into one service takes longer, as if its network were congested. No resource metric moves.",
    },
    brief: {
      fault: "network delay, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st on this case",
    },
    abstract:
      "Every call into currencyservice slows as if the network were congested. No resource metric moves, so the anomaly surfaces through latency percentiles alone.",
    watch: [
      "anomaly_strength: the signal is p99 latency, not cpu or memory",
      "topology_consistency and temporal_precedence: carrying the score as on the other real cases",
      "failed_trace_coverage: sampled traces through currencyservice carry the excess latency",
    ],
    schematic: {
      origin: "currencyservice",
      signal: "latency",
      waves: [["checkoutservice"], ["frontend"]],
      edges: [
        ["frontend", "checkoutservice"],
        ["checkoutservice", "currencyservice"],
        ["frontend", "currencyservice"],
      ],
      injectedAtS: 720,
    },
    whatHappened:
      "A real RCAEval RE2-OB case: a network delay fault on currencyservice. The ranker puts currencyservice at rank 1.",
    whatWeEvaluate:
      "Blind ranking on real fault-injection telemetry, with ranking weights unchanged from the spec. Delay faults surface through latency percentiles rather than resource metrics, so this exercises a different evidence path than the memory cases.",
    whatToWatch:
      "Topology consistency and temporal precedence carrying the score, with the anomaly signal coming from latency percentiles instead of cpu or memory.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-recommendationservice-mem-1": {
    title: "RCAEval RE2-OB: memory fault, recommendationservice (real)",
    source: "rcaeval-re2ob",
    headline: "Memory fault in recommendationservice, real recording",
    caseSummary: {
      system: RCAEVAL_SYSTEM,
      symptom:
        "Halfway through the recording, one service's memory climbs and frontend slows behind it. Two services look almost equally responsible.",
    },
    brief: {
      fault: "memory fault, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st; 2nd before the detector fix",
    },
    abstract:
      "The same fault class as the guided case, recorded on a real system. The ranker places the injected service first, with frontend second.",
    watch: [
      "the score margin between the top two candidates",
      "temporal_precedence: whether frontend's onset is separable from recommendationservice's at this sampling",
      "after the replay, open Case file to compare with ground truth",
    ],
    schematic: {
      origin: "recommendationservice",
      signal: "memory",
      waves: [["frontend"]],
      bystanders: ["productcatalogservice"],
      edges: [
        ["frontend", "recommendationservice"],
        ["recommendationservice", "productcatalogservice"],
      ],
      injectedAtS: 720,
    },
    whatHappened:
      "A real RCAEval RE2-OB case with the same fault type and service class as the guided synthetic demo: a memory fault on recommendationservice. The ranker puts recommendationservice at rank 1.",
    whatWeEvaluate:
      "The same fault class as the synthetic guided case, on real telemetry. Before the detector fix this case ranked 2nd behind frontend; it now ranks 1st.",
    whatToWatch:
      "After the replay, open Case file to compare the ground truth with the evidence behind the number 1 and number 2 candidates.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-emailservice-cpu-1": {
    title: "RCAEval RE2-OB: CPU fault, emailservice (real)",
    source: "rcaeval-re2ob",
    headline: "CPU fault in emailservice, real recording",
    caseSummary: {
      system: RCAEVAL_SYSTEM,
      symptom:
        "Halfway through the recording, a service at the edge of the call graph pins its CPU. Little of it reaches the sampled traces or status codes.",
    },
    brief: {
      fault: "CPU saturation, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st; 12th before the detector fix",
    },
    abstract:
      "emailservice saturates its CPU at the edge of the graph. The old detector ranked it 12th; the fixed one waits for a real baseline and ranks it first.",
    watch: [
      "anomaly_strength: emailservice's cpu leaves a 300-sample baseline after the injection, not before",
      "topology_consistency: a leaf service explains almost none of the anomalous set",
      "after the replay, open Case file to compare with ground truth",
    ],
    schematic: {
      origin: "emailservice",
      signal: "cpu",
      waves: [["checkoutservice"], ["frontend"]],
      edges: [
        ["frontend", "checkoutservice"],
        ["checkoutservice", "emailservice"],
      ],
      injectedAtS: 720,
    },
    whatHappened:
      "A real RCAEval RE2-OB case: a cpu fault on emailservice. The ranker puts emailservice at rank 1; before the detector fix it ranked 12th.",
    whatWeEvaluate:
      "The case that exposed a detector bug. RE2-OB metrics repeat between scrapes, so the old detector's baseline spread collapsed to zero and every service looked anomalous within seconds, leaving the ranking to topology and name order. The fix floors the spread at a quarter of the median and requires an anomaly to persist before it counts.",
    whatToWatch:
      "The onset times in the evidence: no service is flagged before the injection at t+720 s. This case is in the 15-case tuning split; on 75 held-out cases the ranker puts the injected service first in 58/75 (77%, 95% CI 67 to 85%).",
    caveat: RCAEVAL_CAVEAT,
  },
};
