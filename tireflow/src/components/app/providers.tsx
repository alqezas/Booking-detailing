"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorker } from "./service-worker";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
  }));
  return (
    <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          <Toaster richColors position="top-right" />
          <ServiceWorker />
        </TooltipProvider>
    </QueryClientProvider>
  );
}
