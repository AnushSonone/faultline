import type { ReactNode } from "react";

// One section of the case report, shared by the rail brief and the Case file
// drawer, which occupy the same grid area and are the same 328 to 403 px wide.
// A sentence-case title, an optional one-line caption, then the content.
// Sections are separated by a hairline at one even rhythm set by the
// container. There is no role colour: on these surfaces colour only ever
// encodes data (the schematic, the recording band, the signal palette).
export function CaseSection({
  title,
  caption,
  testId,
  className,
  children,
}: {
  title: string;
  caption?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `case-section ${className}` : "case-section"} data-testid={testId}>
      <h4>{title}</h4>
      {caption && <p className="case-caption">{caption}</p>}
      {children}
    </section>
  );
}
