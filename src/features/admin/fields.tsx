"use client";

import { useId, useState, type ReactNode } from "react";
import { Lock, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Small form kit for the admin editor: dark "sign" inputs, labelled, 44px tall on touch. */

export const inputClass =
  "w-full min-h-11 sm:min-h-9 rounded-lg border border-line bg-night/70 px-3 py-2 text-[14px] text-fog placeholder:text-fog-3 outline-none transition-colors focus:border-sodium/60 focus:bg-night disabled:opacity-50";

export function Section({ title, eyebrow, aside, children, className }: { title: string; eyebrow?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("sign p-4 sm:p-5", className)}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | undefined; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-fog-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[12px] text-danger">{error}</p> : hint ? <p className="text-[12px] text-fog-3">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
  maxLength,
  className,
  type = "text",
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string | undefined;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  type?: "text" | "url";
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <input
          id={id}
          type={type}
          className={inputClass}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          {...(testId ? { "data-testid": testId } : {})}
        />
      )}
    </Field>
  );
}

export function TextArea({ label, value, onChange, maxLength, rows = 3, hint, className }: { label: string; value: string; onChange: (v: string) => void; maxLength?: number; rows?: number; hint?: ReactNode; className?: string }) {
  return (
    <Field label={label} hint={hint ?? (maxLength ? `${value.length}/${maxLength}` : undefined)} className={className}>
      {(id) => <textarea id={id} rows={rows} className={cn(inputClass, "resize-y leading-relaxed")} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
  testId,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onChange: (v: T) => void;
  hint?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value as T)} {...(testId ? { "data-testid": testId } : {})}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Toggle({ label, checked, onChange, hint, testId }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; testId?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 sm:min-h-9">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        {...(testId ? { "data-testid": testId } : {})}
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full border border-line bg-ink-2 transition-colors peer-checked:border-mint/40 peer-checked:bg-mint/30 peer-focus-visible:outline-2 peer-focus-visible:outline-sodium after:absolute after:left-0.5 after:top-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-fog-2 after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-mint"
      />
      <span className="flex flex-col">
        <span className="text-[14px] text-fog">{label}</span>
        {hint ? <span className="text-[12px] text-fog-3">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange, swatches = [] }: { label: string; value: string; onChange: (v: string) => void; swatches?: readonly string[] }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <Field label={label} error={valid ? undefined : "Use #rrggbb"}>
      {(id) => (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${label} picker`}
              className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-1 sm:h-9 sm:w-9"
              value={valid ? value.toLowerCase() : "#000000"}
              onChange={(e) => onChange(e.target.value)}
            />
            <input id={id} className={cn(inputClass, "font-mono tabular")} value={value} maxLength={7} onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
          </div>
          {swatches.length ? (
            <div className="flex flex-wrap gap-1.5" aria-label={`Colours found on the store for ${label}`}>
              {swatches.map((s) => (
                <button
                  key={s}
                  type="button"
                  title={`Use ${s}`}
                  aria-label={`Use ${s} for ${label}`}
                  onClick={() => onChange(s)}
                  className={cn("h-11 w-11 rounded-md border border-white/20 transition-transform hover:scale-110 sm:h-6 sm:w-6", value.toLowerCase() === s && "ring-2 ring-sodium")}
                  style={{ background: s }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** "a, b ,, c" → ["a", "b", "c"] (trimmed, empty entries dropped). */
export const splitList = (text: string): string[] => text.split(",").map((t) => t.trim()).filter(Boolean);

/**
 * Comma-separated list input. The raw text is local state so a trailing comma survives while the
 * reviewer is typing (re-deriving the text from the parsed list would swallow it).
 */
export function CommaListField({ label, value, onChange, hint, error, placeholder, className, transform }: { label: string; value: readonly string[]; onChange: (v: string[]) => void; hint?: ReactNode; error?: string | undefined; placeholder?: string; className?: string; transform?: (item: string) => string }) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(", ");
  const [seen, setSeen] = useState(joined);
  if (joined !== seen && splitList(text).join(", ") !== joined) {
    // The list changed from outside (e.g. a save normalised it): show the new value.
    setSeen(joined);
    setText(joined);
  }
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <input
          id={id}
          className={inputClass}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value;
            const next = splitList(raw).map((t) => (transform ? transform(t) : t));
            setText(raw);
            setSeen(next.join(", "));
            onChange(next);
          }}
        />
      )}
    </Field>
  );
}

/**
 * Editable list of short strings. `locked` items (platform rules) are shown but cannot be edited
 * or removed: they are re-added by the server anyway.
 */
export function ListEditor({ label, items, onChange, max, maxLength = 200, locked = [], placeholder, hint }: { label: string; items: string[]; onChange: (v: string[]) => void; max: number; maxLength?: number; locked?: readonly string[]; placeholder?: string; hint?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v) || items.length >= max) return;
    onChange([...items, v.slice(0, maxLength)]);
    setDraft("");
  };
  return (
    <Field label={`${label} (${items.length}/${max})`} hint={hint}>
      {(id) => (
        <div className="flex flex-col gap-1.5">
          <ul className="flex flex-col gap-1.5">
            {items.map((item, i) => {
              const isLocked = locked.includes(item);
              return (
                // Keyed by position: a key that included the text would remount the input on every
                // keystroke and drop focus. Rows are only appended or removed, never reordered.
                <li key={i} className="flex items-start gap-2">
                  {isLocked ? (
                    <p className="flex min-h-9 flex-1 items-center gap-2 rounded-lg border border-line bg-white/3 px-3 py-2 text-[13px] text-fog-2">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-sodium" aria-label="Platform rule" />
                      {item}
                    </p>
                  ) : (
                    <input
                      aria-label={`${label} ${i + 1}`}
                      className={cn(inputClass, "flex-1")}
                      value={item}
                      maxLength={maxLength}
                      onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  )}
                  {isLocked ? null : (
                    <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-fog-3 hover:bg-white/5 hover:text-danger sm:h-9 sm:w-9" aria-label={`Remove ${item}`}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {items.length < max ? (
            <div className="flex gap-2">
              <input
                id={id}
                className={cn(inputClass, "flex-1")}
                value={draft}
                maxLength={maxLength}
                placeholder={placeholder ?? "Add…"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              <button type="button" onClick={add} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line text-fog-2 hover:bg-white/5 hover:text-fog sm:h-9 sm:w-9" aria-label={`Add to ${label}`}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** Image URL thumbnail that resets its error state when the URL changes. */
export function Thumb({ src, alt, className }: { src?: string | undefined; alt: string; className?: string }) {
  return <ThumbInner key={src ?? ""} src={src} alt={alt} className={className} />;
}

function ThumbInner({ src, alt, className }: { src?: string | undefined; alt: string; className?: string | undefined }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-[repeating-conic-gradient(#2a2e38_0%_25%,#22262f_0%_50%)] bg-[length:12px_12px]", className)}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      ) : (
        <span className="px-1 text-center text-[10px] leading-tight text-fog-3">{src ? "No image" : "None"}</span>
      )}
    </span>
  );
}
