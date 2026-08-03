type Props = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  mono?: boolean;
  testId?: string;
  tip?: React.ReactNode;
};

// Eyebrow label over a weighted value; the standard unit for stat readouts.
export function Stat({ label, value, hint, mono, testId, tip }: Props) {
  return (
    <div className="stat" data-testid={testId}>
      <span className="eyebrow">
        {label}
        {tip}
      </span>
      <span className={mono ? "stat-value mono" : "stat-value"}>{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
