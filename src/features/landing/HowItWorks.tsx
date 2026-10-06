const STEPS: Array<{ n: string; title: string; body: string; stamp?: boolean }> = [
  {
    n: "01",
    title: "Walk in",
    body: "The city is real restaurants, stores and venues, laid out on streets you can actually walk. No account, no download.",
  },
  {
    n: "02",
    title: "Ask or explore",
    body: "Tell the concierge what tonight is about, or wander in and talk to whoever is behind the counter. They only know what is really on the menu.",
  },
  {
    n: "03",
    title: "Get it IRL",
    body: "Delivered, picked up, shipped or booked. Prices are the merchant's prices. Every promotion here is a real one.",
    stamp: true,
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
        <div className="eyebrow">How it works</div>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {STEPS.map((step) => (
            <li key={step.n} className="relative border-t border-line pt-5">
              <div className="tabular font-display text-[12px] text-fog-3">{step.n}</div>
              <h3 className="font-display mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
                {step.title}
                {step.stamp ? <span className="stamp">Get it IRL</span> : null}
              </h3>
              <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-fog-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
