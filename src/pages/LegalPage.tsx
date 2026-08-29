/**
 * Public, linkable Terms of Service and Privacy Policy.
 *
 * The text already existed, but only as a modal inside the app — which meant
 * it had no URL. Nothing could link to it: not the landing page, not Stripe,
 * not a payment processor doing a compliance review, not a takedown notice
 * quoting the DMCA clause. A legal document you can't cite is hard to rely on.
 *
 * Content is imported from LegalDialog rather than copied, so the page and the
 * dialog can never drift apart.
 */
import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Shield, Eye, ArrowLeft } from "lucide-react";
import { TosContent, PrivacyContent } from "@/components/LegalDialog";
import { BRAND } from "@/lib/brand";

interface Props {
  type: "tos" | "privacy";
}

const LegalPage: React.FC<Props> = ({ type }) => {
  const isTos = type === "tos";
  const Icon = isTos ? Shield : Eye;
  const { pathname } = useLocation();

  useEffect(() => {
    const title = isTos ? "Terms of Service" : "Privacy Policy";
    document.title = `${title} — ${BRAND.name}`;
    // These are the two pages most likely to be reached cold from an external
    // link, so start at the top rather than wherever the SPA was scrolled to.
    window.scrollTo(0, 0);
  }, [isTos, pathname]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/30 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 font-mono-share text-[10px] tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> BACK
          </Link>
          <span className="text-border/60">/</span>
          <h1
            className={`font-orbitron text-xs tracking-wider flex items-center gap-2 ${
              isTos ? "text-primary" : "text-secondary"
            }`}
          >
            <Icon className="w-4 h-4" />
            {isTos ? "TERMS_OF_SERVICE" : "PRIVACY_PROTOCOL"}
          </h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8">
        {isTos ? <TosContent /> : <PrivacyContent />}

        <nav className="mt-10 pt-6 border-t border-border/30 flex flex-wrap gap-x-5 gap-y-2 font-mono-share text-[11px]">
          <Link
            to={isTos ? "/privacy" : "/terms"}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            {isTos ? "Privacy Policy" : "Terms of Service"}
          </Link>
          <a
            href="mailto:dmca@grokrunner.gltch.app"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            DMCA / Copyright
          </a>
          <Link to="/" className="text-muted-foreground hover:text-primary transition-colors">
            Back to {BRAND.name}
          </Link>
        </nav>
      </main>
    </div>
  );
};

export default LegalPage;
