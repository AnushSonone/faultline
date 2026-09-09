// Curated briefing copy for the demo incidents. Facts come from
// benchmarks/rcaeval-eval.json (per-case ranks) and RESULTS.md (ablations).
// Claim discipline: the ranker produces a ranked hypothesis, never a proven
// root cause. Keep that framing in every field.
//
// `headline`, `story` and `watchFor` are the story card shown in the rail
// before the first Play; the longer fields feed "The story" tab.

export type Scenario = {
  title: string;
  // The story card in the rail: one headline, two sentences, one thing to watch.
  headline: string;
  story: string;
  watchFor: string;
  whatHappened: string;
  whatWeEvaluate: string;
  whatToWatch: string;
  caveat?: string;
};



const RCAEVAL_CAVEAT =
  "Traces are sampled 1 in 8 by whole trace and logs are capped at 4000 lines, so some evidence is structurally missing. RCAEval has no deploy events, which means the change proximity feature is structurally dead on every real case.";

export const SCENARIOS: Record<string, Scenario> = {
  "rec-mem-001": {
    title: "Guided demo: memory fault in recommendationservice",
    headline: "A memory leak in recommendationservice",
    story:
      "At 5 s in, recommendationservice gets a new version and starts leaking memory. Two seconds later the services that call it slow down.",
    watchFor: "recommendationservice turning red first, then checkoutservice and the storefront.",
    whatHappened:
      "A synthetic Online Boutique-style memory fault is injected into recommendationservice at t+5s, right after a deployment event lands. This is the only case in the demo with a change event on the timeline.",
    whatWeEvaluate:
      "Whether the deterministic nine-feature ranker, seeing only telemetry with labels hidden, pins the injected service. Here it ranks recommendationservice first.",
    whatToWatch:
      "The deploy marker on the timeline, the recommendationservice memory ramp, and its heatmap row brightening as the fault develops. In the score breakdown, change_proximity contributes because a deployment landed just before the fault.",
  },
  "eval-cpu-cart-007": {
    title: "Eval suite: CPU fault in cartservice",
    headline: "A CPU spike in cartservice",
    story:
      "cartservice suddenly maxes out its CPU. Nothing was deployed; it just starts.",
    watchFor: "cartservice turning red while everything else stays blue.",
    whatHappened:
      "A synthetic eval-suite CPU fault targets cartservice. The case comes from a 16-case suite generated with seed 7, and the ranker runs blind to the labels.",
    whatWeEvaluate:
      "A pipeline smoke test on cleanly separable synthetic faults. The ranker puts cartservice at rank 1, and 100% top-1 on this suite is expected. It is explicitly not evidence of real-world accuracy.",
    whatToWatch:
      "The cpu metric anomaly strength and topology consistency carrying the score for cartservice.",
  },
  "re2ob-checkoutservice-mem-1": {
    title: "RCAEval RE2-OB: memory fault in checkoutservice",
    headline: "A memory leak in checkoutservice (real recording)",
    story:
      "checkoutservice starts leaking memory on a real system. Many services look unwell at once; the question is which one started it.",
    watchFor: "how many circles turn red, and whether checkoutservice is ranked first. It is.",
    whatHappened:
      "A real RCAEval RE2-OB case: a memory fault injected into checkoutservice on a real Online Boutique deployment. The ranker puts checkoutservice at rank 1.",
    whatWeEvaluate:
      "Blind ranking on real fault-injection telemetry with untuned weights. A win here means the features generalize past the synthetic generator, at least for this case.",
    whatToWatch:
      "Topology consistency and temporal precedence, the two features ablations show carry real data. Removing topology drops top-1 from 26.7% to 6.7% on this benchmark.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-currencyservice-delay-1": {
    title: "RCAEval RE2-OB: network delay in currencyservice",
    headline: "A slow network to currencyservice (real recording)",
    story:
      "Every call into currencyservice gets slower, as if its network were congested. Nothing runs out; only latency moves.",
    watchFor: "slowness rather than memory or CPU in the reasoning, and currencyservice ranked first.",
    whatHappened:
      "A real RCAEval RE2-OB case: a network delay fault on currencyservice. The ranker puts currencyservice at rank 1.",
    whatWeEvaluate:
      "Blind ranking on real fault-injection telemetry with untuned weights. Delay faults surface through latency percentiles rather than resource metrics, so this exercises a different evidence path than the memory cases.",
    whatToWatch:
      "Topology consistency and temporal precedence carrying the score, with the anomaly signal coming from latency percentiles instead of cpu or memory.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-recommendationservice-mem-1": {
    title: "RCAEval RE2-OB: memory fault in recommendationservice",
    headline: "A memory leak in recommendationservice (real recording)",
    story:
      "The same fault as the guided demo, recorded on a real system. This time Faultline nearly gets it: the true cause lands 2nd.",
    watchFor: "how close the top two suspects are. Reveal the true cause in The story.",
    whatHappened:
      "A real RCAEval RE2-OB case with the same fault type and service class as the guided synthetic demo: a memory fault on recommendationservice. Here the ranker puts the true service at rank 2, not 1.",
    whatWeEvaluate:
      "The gap between synthetic and real. The same pipeline that aces the synthetic version of this fault near-misses the real one.",
    whatToWatch:
      "Reveal the answer and compare it with the number 1 candidate's evidence. The score margin between them is thin.",
    caveat: RCAEVAL_CAVEAT,
  },
  "re2ob-emailservice-cpu-1": {
    title: "RCAEval RE2-OB: CPU fault in emailservice",
    headline: "A CPU spike in emailservice (real recording)",
    story:
      "emailservice maxes out its CPU, but it sits at the edge of the system and little depends on it. Faultline misses: the true cause ends up 12th.",
    watchFor: "what the top suspects were blamed for, then reveal the true cause. An honest miss.",
    whatHappened:
      "A real RCAEval RE2-OB case: a cpu fault on emailservice. The ranker puts the true service at rank 12, an honest hard miss.",
    whatWeEvaluate:
      "Where an untuned deterministic ranker fails on real data. Sampled traces plus status codes carry little error signal for this fault, and cpu pressure on a leaf service barely perturbs the topology signal.",
    whatToWatch:
      "What the top-ranked candidates did score on, then reveal the answer. This case is why RESULTS.md reports 26.7% top-1 untuned, with the improvement path written down.",
    caveat: RCAEVAL_CAVEAT,
  },
};
