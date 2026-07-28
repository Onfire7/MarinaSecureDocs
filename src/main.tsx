import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import App from "./App.tsx";
import { applyTheme, getStoredTheme } from "./lib/theme.ts";

// Applied before the first render so a stored Dark/Light choice never
// flashes the wrong palette on load.
applyTheme(getStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
