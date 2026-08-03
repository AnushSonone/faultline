type Props = {
  title: string;
  hint?: string;
  glyph?: string;
  testId?: string;
  children?: React.ReactNode;
};

// Shared empty-state block. testId lets views keep their container testids
// when the empty state is the only thing rendered.
export function EmptyState({ title, hint, glyph = "·", testId, children }: Props) {
  return (
    <div className="empty-state" data-testid={testId}>
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <span>{title}</span>
      {hint && <span className="hint">{hint}</span>}
      {children}
    </div>
  );
}
