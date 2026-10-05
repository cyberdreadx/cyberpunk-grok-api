import React, { Suspense } from "react";
import MaintenanceBanner from "@/components/MaintenanceBanner";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import KeepAliveTabs from "@/components/KeepAliveTabs";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { captureRefFromUrl } from "@/lib/referral";

// Lazy-load heavy pages to keep initial bundle small
const Admin = lazyWithRetry(() => import("./pages/Admin"), "admin");
const Characters = lazyWithRetry(() => import("./pages/Characters"), "characters");
const Library = lazyWithRetry(() => import("./pages/Library"), "library");
const ShareView = lazyWithRetry(() => import("./pages/ShareView"), "share-view");
const ApiDocs = lazyWithRetry(() => import("./pages/ApiDocs"), "api-docs");
const FeedPage = lazyWithRetry(() => import("./pages/FeedPage"), "feed");
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"), "profile");
const ReferralPage = lazyWithRetry(() => import("./pages/ReferralPage"), "referral");
const AmbassadorPage = lazyWithRetry(() => import("./pages/AmbassadorPage"), "ambassador");
const RefLanding = lazyWithRetry(() => import("./pages/RefLanding"), "ref-landing");
const TerminalMode = lazyWithRetry(() => import("./pages/TerminalMode"), "terminal");
const VerificationStatusPage = lazyWithRetry(() => import("./pages/VerificationStatusPage"), "verification");
const StripePriceSwap = lazyWithRetry(() => import("./pages/StripePriceSwap"), "stripe-price-swap");
const Apply = lazyWithRetry(() => import("./pages/Apply"), "apply");
const ApplyStatus = lazyWithRetry(() => import("./pages/ApplyStatus"), "apply-status");
const CreatorsDirectory = lazyWithRetry(() => import("./pages/CreatorsDirectory"), "creators-directory");
const Chat = lazyWithRetry(() => import("./pages/Chat"), "chat");
const Messages = lazyWithRetry(() => import("./pages/Messages"), "messages");
const PromptsPage = lazyWithRetry(() => import("./pages/PromptsPage"), "prompts");
const LegalPage = lazyWithRetry(() => import("./pages/LegalPage"), "legal");
const PromoPage = lazyWithRetry(() => import("./pages/PromoPage"), "promo");
const AdminPromo = lazyWithRetry(() => import("./pages/AdminPromo"), "admin-promo");
import AgeGateDialog from "@/components/AgeGateDialog";
import KonamiTerminalUnlock from "@/components/KonamiTerminalUnlock";
import GlobalNavMenu from "@/components/GlobalNavMenu";
import { isStudio } from "@/lib/edition";

const queryClient = new QueryClient();

const PageShell = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary>
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

/** Redirect that keeps the query string, so /feed?post=<id> share links and
 *  Studio's /create?action=edit still carry their parameters across. */
const RedirectKeepingQuery = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
};

/*
 * The main tabs stay mounted between visits (see KeepAliveTabs), so scroll,
 * loaded posts, a half-written prompt and a running generation survive a trip
 * to another tab. Their <Route>s below render nothing; they exist so the router
 * knows the paths and the catch-all does not claim them.
 */
const keptTabs = isStudio
  ? [
      { path: "/", element: <PageShell><Index /></PageShell> },
      { path: "/library", element: <PageShell><Library /></PageShell> },
      { path: "/profile", element: <PageShell><ProfilePage /></PageShell> },
    ]
  : [
      { path: "/", element: <PageShell><FeedPage /></PageShell> },
      { path: "/create", element: <PageShell><Index /></PageShell> },
      { path: "/library", element: <PageShell><Library /></PageShell> },
      { path: "/profile", element: <PageShell><ProfilePage /></PageShell> },
    ];

// Persist ?ref= before anything can navigate the query string away, and count
// the click. Runs at module scope so it happens on the very first paint.
captureRefFromUrl();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AgeGateDialog />
        {!isStudio && <KonamiTerminalUnlock />}
        <GlobalNavMenu />
        <MaintenanceBanner />
        <Routes>
          {isStudio ? (
            /*
             * GLTCH Studio — the plain consumer edition. Only what a normal creator
             * needs: make things, keep them, manage the account. No feed, stories,
             * chat, creators, personas, terminal or developer pages; anything else
             * redirects home rather than 404ing, since a Studio visitor following an
             * old Runner link should land somewhere useful.
             */
            <>
              <Route path="/" element={null} />
              <Route path="/create" element={<RedirectKeepingQuery to="/" />} />
              <Route path="/library" element={null} />
              <Route path="/profile" element={null} />
              <Route path="/s/:shareId" element={<PageShell><ShareView /></PageShell>} />
              <Route path="/terms" element={<PageShell><LegalPage type="tos" /></PageShell>} />
              <Route path="/privacy" element={<PageShell><LegalPage type="privacy" /></PageShell>} />
              <Route path="/promo" element={<PageShell><PromoPage /></PageShell>} />
              <Route path="/referral" element={<PageShell><ReferralPage /></PageShell>} />
              <Route path="/r/:code" element={<PageShell><RefLanding /></PageShell>} />
              <Route path="/verification" element={<PageShell><VerificationStatusPage /></PageShell>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
          <Route path="/" element={null} />
          <Route path="/create" element={null} />
          <Route path="/index" element={<Navigate to="/create" replace />} />
          <Route path="/admin" element={<PageShell><Admin /></PageShell>} />
          <Route path="/characters" element={<PageShell><Characters /></PageShell>} />
          <Route path="/library" element={null} />
          <Route path="/s/:shareId" element={<PageShell><ShareView /></PageShell>} />
          <Route path="/docs" element={<PageShell><ApiDocs /></PageShell>} />
          {/* The published gltch-runner-mcp README and the gltchrunner.com
              landing page both link to /api-docs. Only /docs existed, so
              those links hit the 404 catch-all. Keep both working — the npm
              package is already out there with this path baked in. */}
          <Route path="/api-docs" element={<PageShell><ApiDocs /></PageShell>} />
          <Route path="/feed" element={<RedirectKeepingQuery to="/" />} />
          <Route path="/profile" element={null} />
          <Route path="/profile/:username" element={<PageShell><ProfilePage /></PageShell>} />
          {/* Terms and Privacy need real URLs, not just an in-app modal:
              payment processors, app stores and DMCA notices all need
              something they can link to. */}
          <Route path="/terms" element={<PageShell><LegalPage type="tos" /></PageShell>} />
          <Route path="/privacy" element={<PageShell><LegalPage type="privacy" /></PageShell>} />
          <Route path="/referral" element={<PageShell><ReferralPage /></PageShell>} />
          <Route path="/ambassador" element={<PageShell><AmbassadorPage /></PageShell>} />
          <Route path="/r/:code" element={<PageShell><RefLanding /></PageShell>} />
          <Route path="/terminal" element={<PageShell><TerminalMode /></PageShell>} />
          <Route path="/verification" element={<PageShell><VerificationStatusPage /></PageShell>} />
          <Route path="/promo" element={<PageShell><PromoPage /></PageShell>} />
          <Route path="/admin/promo" element={<PageShell><AdminPromo /></PageShell>} />
          <Route path="/admin/stripe-prices" element={<PageShell><StripePriceSwap /></PageShell>} />
          <Route path="/apply" element={<PageShell><Apply /></PageShell>} />
          <Route path="/apply/status" element={<PageShell><ApplyStatus /></PageShell>} />
          <Route path="/creators" element={<PageShell><CreatorsDirectory /></PageShell>} />
          <Route path="/chat" element={<PageShell><Chat /></PageShell>} />
          <Route path="/messages" element={<PageShell><Messages /></PageShell>} />
          <Route path="/prompts" element={<PageShell><PromptsPage /></PageShell>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
            </>
          )}
        </Routes>
        <KeepAliveTabs tabs={keptTabs} />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;
