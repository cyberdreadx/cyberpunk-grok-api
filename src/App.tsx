import React, { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-load heavy pages to keep initial bundle small
const Admin = React.lazy(() => import("./pages/Admin"));
const Characters = React.lazy(() => import("./pages/Characters"));
const ShareView = React.lazy(() => import("./pages/ShareView"));
import AgeGateDialog from "@/components/AgeGateDialog";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AgeGateDialog />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<Suspense fallback={<div className="min-h-screen bg-background" />}><Admin /></Suspense>} />
          <Route path="/characters" element={<Suspense fallback={<div className="min-h-screen bg-background" />}><Characters /></Suspense>} />
          <Route path="/s/:shareId" element={<Suspense fallback={<div className="min-h-screen bg-background" />}><ShareView /></Suspense>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
