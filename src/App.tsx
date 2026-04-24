import React, { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Lazy-load heavy pages to keep initial bundle small
const Admin = lazyWithRetry(() => import("./pages/Admin"), "admin");
const Characters = lazyWithRetry(() => import("./pages/Characters"), "characters");
const Library = lazyWithRetry(() => import("./pages/Library"), "library");
const ShareView = lazyWithRetry(() => import("./pages/ShareView"), "share-view");
const ApiDocs = lazyWithRetry(() => import("./pages/ApiDocs"), "api-docs");
const FeedPage = lazyWithRetry(() => import("./pages/FeedPage"), "feed");
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"), "profile");
const ReferralPage = lazyWithRetry(() => import("./pages/ReferralPage"), "referral");
const TerminalMode = lazyWithRetry(() => import("./pages/TerminalMode"), "terminal");
const VerificationStatusPage = lazyWithRetry(() => import("./pages/VerificationStatusPage"), "verification");
import AgeGateDialog from "@/components/AgeGateDialog";
import KonamiTerminalUnlock from "@/components/KonamiTerminalUnlock";

const queryClient = new QueryClient();

const PageShell = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary>
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

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
        <KonamiTerminalUnlock />
        <Routes>
          <Route path="/" element={<PageShell><FeedPage /></PageShell>} />
          <Route path="/create" element={<PageShell><Index /></PageShell>} />
          <Route path="/index" element={<Navigate to="/create" replace />} />
          <Route path="/admin" element={<PageShell><Admin /></PageShell>} />
          <Route path="/characters" element={<PageShell><Characters /></PageShell>} />
          <Route path="/library" element={<PageShell><Library /></PageShell>} />
          <Route path="/s/:shareId" element={<PageShell><ShareView /></PageShell>} />
          <Route path="/docs" element={<PageShell><ApiDocs /></PageShell>} />
          <Route path="/feed" element={<Navigate to="/" replace />} />
          <Route path="/profile" element={<PageShell><ProfilePage /></PageShell>} />
          <Route path="/profile/:username" element={<PageShell><ProfilePage /></PageShell>} />
          <Route path="/referral" element={<PageShell><ReferralPage /></PageShell>} />
          <Route path="/terminal" element={<PageShell><TerminalMode /></PageShell>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;
