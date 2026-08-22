import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import App from "./App.tsx";
import { applyTheme, getStoredTheme } from "./lib/theme.ts";
// Imported for its module-load side effect: the beforeinstallprompt listener
// has to be registered before the browser fires that event, which can happen
// before React mounts.
import "./lib/pwaInstall.ts";
import { initAppUpdates } from "./lib/appUpdate.ts";

// Applied before the first render so a stored Dark/Light choice never
// flashes the wrong palette on load.
applyTheme(getStoredTheme());

// Before render, and not from a component: a worker registered only once the
// signed-in shell mounts would leave the sign-in screen uninstallable.
initAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
