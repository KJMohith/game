import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function NeonButton({
  variant = "primary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "gold" | "danger" }) {
  return (
    <button
      {...rest}
      className={cn(
        "font-display relative w-full rounded-xl px-5 py-3 text-sm uppercase tracking-widest transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:brightness-110 glow-primary",
        variant === "ghost" &&
          "border border-border bg-secondary/40 text-foreground hover:bg-secondary/70",
        variant === "gold" && "bg-gold text-primary-foreground hover:brightness-110",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:brightness-110",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("panel animate-rise p-5", className)}>{children}</div>;
}

export function Bar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label?: string;
}) {
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary/70 ring-1 ring-border">
      <div
        className="h-full rounded-full transition-[width] duration-150"
        style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color, boxShadow: `0 0 12px ${color}` }}
      />
      {label && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-foreground/90">
          {label}
        </span>
      )}
    </div>
  );
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
