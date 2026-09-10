// Curated case briefs for the demo incidents. Facts come from each fixture's
// labels.json, the live topology snapshot, benchmarks/rcaeval-eval.json
// (per-case ranks) and RESULTS.md (ablations).
// Claim discipline: the ranker produces a ranked hypothesis, never a proven
// root cause. Keep that framing in every field.
//
// `headline`, `brief`, `abstract`, `watch` and `schematic` make up the case
// brief in the rail before the first Play; the longer fields feed the Case
// file tab.

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
    brief: {
      fault: "memory leak, injected t+5 s of 15 s",
      changeEvent: "deployment on recommendationservice, t+5 s",
      signals: "metrics · traces · logs · change events",
      outcome: "ground truth ranked 1st by the untuned ranker",
    },
    abstract:
      "A deployment lands on recommendationservice at t+5 s and its memory metric departs from baseline. Two seconds later the latency of its callers, checkoutservice and then frontend, follows: a temporal-precedence gap that only exists on the event-time clock.",
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
    brief: {
      fault: "CPU saturation, injected t+6 s of 19 s",
      changeEvent: "none on the faulted service",
      signals: "metrics · traces · logs",
      outcome: "ground truth ranked 1st; 100% top-1 on this 16-case suite is expected",
    },
    abstract:
      "cartservice saturates its CPU with nothing deployed. Only frontend calls it, so the propagation is a single hop and the anomalous set is small and cleanly separable: a pipeline smoke test, not evidence of real-world accuracy.",
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
    brief: {
      fault: "memory fault, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st on this case",
    },
    abstract:
      "A memory fault injected into checkoutservice on a real Online Boutique deployment. Several services look anomalous at once; the ranking has to separate the origin from the callers it degrades using precedence and topology alone.",
    watch: [
      "topology_consistency and temporal_precedence: the two features ablations show carry real data",
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
      "Blind ranking on real fault-injection telemetry with untuned weights. A win here means the features generalize past the synthetic generator, at least for this case.",
    whatToWatch:
      "Topology consistency and temporal precedence, the two features ablations show carry real data. Removing topology drops top-1 from 26.7% to 6.7% on this benchmark.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-currencyservice-delay-1": {
    title: "RCAEval RE2-OB: network delay, currencyservice (real)",
    source: "rcaeval-re2ob",
    headline: "Network delay on currencyservice, real recording",
    brief: {
      fault: "network delay, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 1st on this case",
    },
    abstract:
      "Every call into currencyservice gets slower, as if its network were congested. No resource metric moves, so the anomaly surfaces through latency percentiles alone, and both of its callers, checkoutservice and frontend, degrade in the same hop.",
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
      "Blind ranking on real fault-injection telemetry with untuned weights. Delay faults surface through latency percentiles rather than resource metrics, so this exercises a different evidence path than the memory cases.",
    whatToWatch:
      "Topology consistency and temporal precedence carrying the score, with the anomaly signal coming from latency percentiles instead of cpu or memory.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-recommendationservice-mem-1": {
    title: "RCAEval RE2-OB: memory fault, recommendationservice (real)",
    source: "rcaeval-re2ob",
    headline: "Memory fault in recommendationservice, real recording",
    brief: {
      fault: "memory fault, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 2nd; a near miss",
    },
    abstract:
      "The same fault class as the guided case, recorded on a real system. recommendationservice has one caller, frontend, and one callee, productcatalogservice. The ranker places the injected service second by a thin score margin.",
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
      "A real RCAEval RE2-OB case with the same fault type and service class as the guided synthetic demo: a memory fault on recommendationservice. Here the ranker puts the true service at rank 2, not 1.",
    whatWeEvaluate:
      "The gap between synthetic and real. The same pipeline that aces the synthetic version of this fault near-misses the real one.",
    whatToWatch:
      "After the replay, open Case file to compare the ground truth with the number 1 candidate's evidence. The score margin between them is thin.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-emailservice-cpu-1": {
    title: "RCAEval RE2-OB: CPU fault, emailservice (real)",
    source: "rcaeval-re2ob",
    headline: "CPU fault in emailservice, real recording, an honest miss",
    brief: {
      fault: "CPU saturation, injected t+720 s of 1440 s",
      changeEvent: RCAEVAL_CHANGE,
      signals: RCAEVAL_SIGNALS,
      outcome: "ground truth ranked 12th; the miss behind the 26.7% top-1 figure",
    },
    abstract:
      "emailservice saturates its CPU at the edge of the graph: only checkoutservice calls it, on the confirmation path. Sampled traces and status codes carry little error signal for this fault, and CPU pressure on a leaf barely perturbs the topology features.",
    watch: [
      "what the top-ranked candidates did score on, with the true origin far down the list",
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
      "A real RCAEval RE2-OB case: a cpu fault on emailservice. The ranker puts the true service at rank 12, an honest hard miss.",
    whatWeEvaluate:
      "Where an untuned deterministic ranker fails on real data. Sampled traces plus status codes carry little error signal for this fault, and cpu pressure on a leaf service barely perturbs the topology signal.",
    whatToWatch:
      "What the top-ranked candidates did score on, then open Case file for the ground truth. This case is why RESULTS.md reports 26.7% top-1 untuned, with the improvement path written down.",
    caveat: RCAEVAL_CAVEAT,
  },
};
