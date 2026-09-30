import { levelProgress } from "./level";

/** City level + XP progress, styled as a lit sign. Server-safe (no hooks, no server imports). */
export function LevelCard({ xp }: { xp: number }) {
  const p = levelProgress(xp);
  const percent = Math.round(p.fraction * 100);
  const xpFmt = (n: number) => n.toLocaleString("en-US");

  return (
    <section className="sign relative overflow-hidden p-6" aria-labelledby="level-heading">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(50% 60% at 0% 0%, rgba(255,196,107,0.12), transparent 70%)",
        }}
      />
      <div className="relative flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">City level</div>
          <h2
            id="level-heading"
            className="font-display mt-1 text-5xl font-bold tracking-tight text-sodium"
          >
            {p.level}
          </h2>
        </div>
        <div className="text-right">
          <div className="tabular font-display text-lg font-semibold">{xpFmt(p.xp)} XP</div>
          <div className="text-[13px] text-fog-3">
            {xpFmt(p.remainingXp)} to level {p.level + 1}
          </div>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`Progress to level ${p.level + 1}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="relative mt-5 h-2 overflow-hidden rounded-full bg-white/8"
      >
        <div
          className="h-full rounded-full bg-sodium transition-[width] duration-500"
          style={{ width: `${percent}%`, boxShadow: "0 0 12px rgba(255,196,107,0.6)" }}
        />
      </div>
      <p className="relative mt-3 text-[13px] text-fog-3">
        Every real order earns XP. Levels unlock as you spend time in the city.
      </p>
    </section>
  );
}
