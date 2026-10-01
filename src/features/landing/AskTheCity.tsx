"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import styles from "./landing.module.css";

const EXAMPLES = [
  "Spicy dinner under $25, delivered",
  "Date night: dinner, flowers, an outfit",
  "What's happening tonight?",
];

const MAX_CHARS = 500;

/** The front door: one question, straight into the city with the concierge open. */
export function AskTheCity() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [leaving, setLeaving] = useState(false);

  const go = (question: string) => {
    const q = question.trim().slice(0, MAX_CHARS);
    setLeaving(true);
    router.push(q ? `/city?ask=${encodeURIComponent(q)}` : "/city");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(text);
  };

  return (
    <div className={styles.rise} style={{ animationDelay: "120ms" }}>
      <form
        onSubmit={onSubmit}
        className="sign flex items-center gap-2 p-2 focus-within:border-sodium/60"
      >
        <label htmlFor="ask" className="sr-only">
          What should we do tonight?
        </label>
        <Sparkles className="ml-2 h-5 w-5 shrink-0 text-sodium" aria-hidden="true" />
        <input
          id="ask"
          name="ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHARS}
          autoComplete="off"
          enterKeyHint="go"
          placeholder="Spicy dinner under $25, delivered"
          className="h-12 min-w-0 flex-1 bg-transparent text-[17px] text-fog placeholder:text-fog-3 focus:outline-none sm:h-14 sm:text-lg"
        />
        <button
          type="submit"
          disabled={leaving}
          aria-label="Ask the city"
          className="font-display flex h-12 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-signal px-4 text-[15px] font-semibold tracking-tight text-night shadow-[0_8px_24px_rgba(255,90,54,0.28)] transition-[background-color,transform] hover:bg-[#ff7053] active:scale-[0.98] disabled:opacity-60 sm:h-14 sm:px-5"
        >
          <span className="hidden sm:inline">Ask the city</span>
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => go(example)}
            className="h-10 rounded-full border border-line bg-white/4 px-3.5 text-[13px] text-fog-2 transition-colors hover:border-fog-3 hover:bg-white/8 hover:text-fog"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <Link
          href="/city"
          className="font-display inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-ink-2/80 px-5 text-[15px] font-semibold tracking-tight text-fog transition-colors hover:bg-[#2c313c]"
        >
          Just walk in
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <span className="text-[13px] text-fog-3">No account needed.</span>
      </div>
    </div>
  );
}
