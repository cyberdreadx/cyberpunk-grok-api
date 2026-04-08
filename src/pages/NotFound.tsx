import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import CyberLayout from "@/components/CyberLayout";
import GlitchText from "@/components/GlitchText";

const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <CyberLayout>
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-center space-y-4">
          <GlitchText
            text="404"
            as="h1"
            className="font-orbitron text-6xl sm:text-8xl font-black neon-text-cyan"
            glitchIntensity="high"
          />
          <p className="font-mono-share text-sm text-muted-foreground animate-flicker">
            <span className="text-destructive/70">{t("notFound.error")}</span> {t("notFound.routeNotFound", { path: location.pathname })}
          </p>
          <div className="pt-4">
            <a
              href="/"
              className="font-mono-share text-xs text-primary hover:text-primary/80 underline underline-offset-4 transition-colors"
            >
              {t("notFound.goHome")}
            </a>
          </div>
        </div>
      </div>
    </CyberLayout>
  );
};

export default NotFound;
