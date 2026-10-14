import { useEffect, useRef } from "react";

/** Virtual joystick for touch devices. Reports a normalized -1..1 vector. */
export function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    const base = baseRef.current!;
    const knob = knobRef.current!;
    const R = 52;

    const set = (dx: number, dy: number) => {
      const d = Math.hypot(dx, dy);
      const k = d > R ? R / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      onMove(Math.max(-1, Math.min(1, dx / R)), Math.max(-1, Math.min(1, dy / R)));
    };

    const rect = () => base.getBoundingClientRect();

    const start = (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      idRef.current = t.identifier;
      const r = rect();
      set(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
      e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== idRef.current) continue;
        const r = rect();
        set(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2));
        e.preventDefault();
      }
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== idRef.current) continue;
        idRef.current = null;
        knob.style.transform = "translate(0px, 0px)";
        onMove(0, 0);
      }
    };

    base.addEventListener("touchstart", start, { passive: false });
    base.addEventListener("touchmove", move, { passive: false });
    base.addEventListener("touchend", end);
    base.addEventListener("touchcancel", end);
    return () => {
      base.removeEventListener("touchstart", start);
      base.removeEventListener("touchmove", move);
      base.removeEventListener("touchend", end);
      base.removeEventListener("touchcancel", end);
    };
  }, [onMove]);

  return (
    <div
      ref={baseRef}
      className="pointer-events-auto absolute bottom-8 left-6 size-32 touch-none rounded-full border border-border bg-secondary/30 backdrop-blur-sm md:hidden"
    >
      <div
        ref={knobRef}
        className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/80 glow-primary"
        style={{ marginLeft: "-1.75rem", marginTop: "-1.75rem", left: "50%", top: "50%" }}
      />
    </div>
  );
}
