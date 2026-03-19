import React, { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "@/components/ErrorBoundary";

// Lazy-load heavy pages to keep initial bundle small
const Admin = React.lazy(() => import("./pages/Admin"));
const Characters = React.lazy(() => import("./pages/Characters"));
const Library = React.lazy(() => import("./pages/Library"));
const ShareView = React.lazy(() => import("./pages/ShareView"));
import AgeGateDialog from "@/components/AgeGateDialog";

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
      <BrowserRouter>
        <AgeGateDialog />
        <Routes>
          <Route path="/" element={<PageShell><Index /></PageShell>} />
          <Route path="/admin" element={<PageShell><Admin /></PageShell>} />
          <Route path="/characters" element={<PageShell><Characters /></PageShell>} />
          <Route path="/library" element={<PageShell><Library /></PageShell>} />
          <Route path="/s/:shareId" element={<PageShell><ShareView /></PageShell>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;
