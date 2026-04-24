/**
 * KonamiTerminalUnlock — listens for the Konami code anywhere in the app
 * and navigates to /terminal as an easter-egg unlock.
 * Sequence: ↑ ↑ ↓ ↓ ← → ← → B A
 *
 * Mounted globally inside <App>. Pure side-effect component (renders nothing).
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const SEQUENCE = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

const KonamiTerminalUnlock = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let pos = 0;
    const onKey = (e: KeyboardEvent) => {
      // Ignore while typing in inputs/textareas to avoid hijacking the form.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const expected = SEQUENCE[pos];
      if (e.key === expected || e.key.toLowerCase() === expected) {
        pos++;
        if (pos === SEQUENCE.length) {
          pos = 0;
          toast.success("ACCESS GRANTED — entering terminal", { duration: 1500 });
          navigate("/terminal");
        }
      } else {
        pos = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return null;
};

export default KonamiTerminalUnlock;
