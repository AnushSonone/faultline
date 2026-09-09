import { describe, expect, it } from "vitest";
import { evidenceWord, explainCandidate, ordinal } from "./explain";
import type { RootCauseCandidate } from "../types/protocol";

function candidate(
  service: string,
  parts: Array<[string, number]>,
  score = 0.5,
): RootCauseCandidate {
  return {
    rank: 1,
    service,
    score,
    components: parts.map(([name, contribution]) => ({
      name,
      feature_value: Math.abs(contribution),
      weight: 0.1,
      contribution,
    })),
    features: { peak_abs_z: 8, impacted_anomalous: [], preceding_impacted: [] },
  };
}

describe("explainCandidate", () => {
  it("keeps the top three clauses by contribution and appends the contradiction", () => {
    const c = candidate("recommendationservice", [
      ["change_proximity", 0.1],
      ["temporal_precedence", 0.15],
      ["anomaly_strength", 0.2],
      ["downstream_impact", 0.08],
      ["contradiction_penalty", -0.02],
      ["persistence", 0.5],
    ]);
    expect(explainCandidate(c)).toBe(
      "recommendationservice is the most likely culprit: its own numbers strayed far from normal, it went wrong before the services that depend on it, and it got a new version just before things went wrong. Though some evidence points the other way.",
    );
  });

  it("handles one and two clauses without a serial comma", () => {
    expect(explainCandidate(candidate("cartservice", [["anomaly_strength", 0.2]]))).toBe(
      "cartservice is the most likely culprit: its own numbers strayed far from normal.",
    );
    expect(
      explainCandidate(candidate("cartservice", [["anomaly_strength", 0.2], ["log_evidence", 0.03]])),
    ).toBe(
      "cartservice is the most likely culprit: its own numbers strayed far from normal and its logs show errors.",
    );
  });

  it("respects maxClauses and ignores tiny or unknown contributions", () => {
    const c = candidate("frontend", [
      ["anomaly_strength", 0.2],
      ["temporal_precedence", 0.15],
      ["log_evidence", 0.004],
      ["mystery_feature", 0.9],
    ]);
    expect(explainCandidate(c, { maxClauses: 1 })).toBe(
      "frontend is the most likely culprit: its own numbers strayed far from normal.",
    );
  });

  it("falls back when nothing positive carried the score", () => {
    const c = candidate("cartservice", [["anomaly_strength", 0], ["contradiction_penalty", -0.1]], -0.1);
    expect(explainCandidate(c)).toBe("cartservice is ranked first, but the evidence for it is weak.");
  });
});

describe("evidenceWord", () => {
  it("bands the score", () => {
    expect(evidenceWord(0.86)).toBe("strong");
    expect(evidenceWord(0.6)).toBe("strong");
    expect(evidenceWord(0.48)).toBe("some");
    expect(evidenceWord(0.3)).toBe("some");
    expect(evidenceWord(0.1)).toBe("weak");
    expect(evidenceWord(0)).toBe("none");
    expect(evidenceWord(-0.1)).toBe("none");
  });
});

describe("ordinal", () => {
  it("handles teens and the 1/2/3 endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th",
    ]);
  });
});
