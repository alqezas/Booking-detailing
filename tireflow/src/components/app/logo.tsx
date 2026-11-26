import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}>
      <svg viewBox="0 0 24 24" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21" />
      </svg>
    </span>
  );
}
