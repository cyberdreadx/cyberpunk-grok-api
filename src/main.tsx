import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/i18n";
import { applyThemeVisuals, getThemeById, getStoredThemeId } from "./lib/themes";
import { watchForUpdates } from "./lib/swUpdate";
import { EDITION, BRAND_NAME, isStudio } from "./lib/edition";


// Before first paint, so Studio never flashes the cyberpunk theme. In Studio,
// applyThemeVisuals is locked to the Studio theme whatever it is given.
document.documentElement.dataset.edition = EDITION;
applyThemeVisuals(getThemeById(getStoredThemeId()));
if (isStudio) document.title = `${BRAND_NAME} — AI image & video creator`;

createRoot(document.getElementById("root")!).render(<App />);

// The generated registerSW.js only checks on `load`, which an installed PWA
// resumed from the app switcher never fires. Without this it serves whatever
// it precached at install time indefinitely.
watchForUpdates();
