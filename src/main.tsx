import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyThemeVisuals, getThemeById, getStoredThemeId } from "./lib/themes";

applyThemeVisuals(getThemeById(getStoredThemeId()));

createRoot(document.getElementById("root")!).render(<App />);
