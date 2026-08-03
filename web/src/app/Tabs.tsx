import { useEffect } from "react";
import { motion } from "framer-motion";
import { useInvestigation, type TabId } from "../state/investigation";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "root-causes", label: "Root causes" },
  { id: "signals", label: "Signals" },
  { id: "runtime", label: "Runtime" },
];

// Jump navigation over one scrolling page: clicking scrolls to the section,
// the highlight follows scroll position via an IntersectionObserver.
export function Tabs() {
  const activeTab = useInvestigation((s) => s.activeTab);
  const setTab = useInvestigation((s) => s.setTab);

  useEffect(() => {
    const sections = TABS.map((t) => document.getElementById(`section-${t.id}`)).filter(
      (el): el is HTMLElement => el != null,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id.replace("section-", "") as TabId;
          setTab(id);
        }
      },
      // A narrow band near the top of the viewport decides the active section.
      { rootMargin: "-25% 0px -65% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [setTab]);

  const jump = (id: TabId) => {
    setTab(id);
    document
      .getElementById(`section-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "tab active" : "tab"}
            data-testid={`tab-${tab.id}`}
            onClick={() => jump(tab.id)}
          >
            {active && (
              <motion.span
                className="tab-indicator"
                layoutId="tab-indicator"
                transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
              />
            )}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
