// Self-mounting embed entry for the blog. Built as an IIFE by
// vite.embed.config.ts; every selector in the emitted CSS is scoped under
// #faultline-demo-root so nothing bleeds into the host page.
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { App } from "./app/App";
import { setApiBase } from "./api/client";
import { applyLightTheme } from "./theme/tokens";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import "./embed.css";

const root = document.getElementById("faultline-demo-root");

if (root) {
  const apiBase = root.getAttribute("data-api-base");
  if (apiBase) setApiBase(apiBase);

  root.setAttribute("data-theme", "light");
  applyLightTheme();

  // No StrictMode on purpose: double-mount effects would open and churn a
  // second demo session, which is unacceptable in the blog embed.
  createRoot(root).render(
    <MotionConfig reducedMotion="user">
      <App embedded />
    </MotionConfig>,
  );
}
