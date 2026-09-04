import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/i18n";
import { applyThemeVisuals, getThemeById, getStoredThemeId } from "./lib/themes";
import { watchForUpdates } from "./lib/swUpdate";

applyThemeVisuals(getThemeById(getStoredThemeId()));

createRoot(document.getElementById("root")!).render(<App />);

// The generated registerSW.js only checks on `load`, which an installed PWA
// resumed from the app switcher never fires. Without this it serves whatever
// it precached at install time indefinitely.
watchForUpdates();
