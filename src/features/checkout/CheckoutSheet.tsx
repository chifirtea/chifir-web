"use client";

import { useEffect, useId, useMemo, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { ArrowLeft } from "lucide-react";
import type { Address, FulfillmentType } from "@/types/domain";
import { Button, Drawer } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatCents } from "@/lib/utils/money";
import { useIsPhone } from "@/features/hud/useMediaQuery";
import { useCartTotals } from "@/features/cart/useCartTotals";
import { feeLineLabel, fulfillmentOptionLabel } from "@/features/cart/fulfillmentLabels";
import type { CheckoutProblem } from "@/lib/commerce/types";
import { startCheckout } from "./startCheckout";

const CONTACT_STORAGE_KEY = "chifir.checkout.contact.v1";
const NEEDS_ADDRESS: ReadonlySet<FulfillmentType> = new Set(["delivery", "shipping"]);

interface ContactForm {
  email: string;
  name: string;
  phone: string;
}
interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}
const EMPTY_CONTACT: ContactForm = { email: "", name: "", phone: "" };
const EMPTY_ADDRESS: AddressForm = { line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" };

function loadSaved(): { contact: ContactForm; address: AddressForm } | null {
  try {
    const raw = localStorage.getItem(CONTACT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ contact: Partial<ContactForm>; address: Partial<AddressForm> }>;
    return {
      contact: { ...EMPTY_CONTACT, ...(parsed.contact ?? {}) },
      address: { ...EMPTY_ADDRESS, ...(parsed.address ?? {}) },
    };
  } catch {
    return null;
  }
}

function save(contact: ContactForm, address: AddressForm): void {
  try {
    localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify({ contact, address }));
  } catch {
    // Storage may be unavailable (private mode); prefill is a convenience only.
  }
}

export interface CheckoutSheetProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
}

/** Contact + address, then "Pay". Prices shown are the same preview the cart showed. */
export function CheckoutSheet({ open, onClose, onBack }: CheckoutSheetProps) {
  const isPhone = useIsPhone();
  const { totals, linesByMerchant, selection, promoCode, ready } = useCartTotals();
  const lines = useMemo(() => linesByMerchant.flatMap((g) => g.lines), [linesByMerchant]);
  const needsAddress = Object.values(selection).some((t) => NEEDS_ADDRESS.has(t));

  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<CheckoutProblem[]>([]);

  useEffect(() => {
    if (!open) return;
    const saved = loadSaved();
    if (saved) {
      setContact(saved.contact);
      setAddress(saved.address);
    }
    setError(null);
    setProblems([]);
    setTouched(false);
  }, [open]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
  const addressOk =
    !needsAddress ||
    (address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim().length >= 2 && /^[A-Za-z]{2}$/.test(address.country.trim()));
  const canPay = ready && lines.length > 0 && totals.problems.length === 0 && emailOk && Boolean(addressOk) && !submitting;

  const problemText = (p: CheckoutProblem): string => {
    const line = lines.find((l) => l.key === p.key);
    const group = linesByMerchant.find((g) => g.merchantId === line?.merchantId);
    const title = line ? group?.products.find((pr) => pr.id === line.productId)?.title : undefined;
    return title ? `${title}: ${p.reason}` : p.reason;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canPay) return;
    setSubmitting(true);
    setError(null);
    setProblems([]);
    const deliveryAddress: Address | undefined = needsAddress
      ? {
          line1: address.line1.trim(),
          ...(address.line2.trim() ? { line2: address.line2.trim() } : {}),
          city: address.city.trim(),
          region: address.region.trim(),
          postalCode: address.postalCode.trim(),
          country: address.country.trim().toUpperCase(),
        }
      : undefined;
    save(contact, address);
    const result = await startCheckout({
      lines,
      fulfillment: selection,
      contact: { email: contact.email.trim(), name: contact.name, phone: contact.phone },
      ...(deliveryAddress ? { deliveryAddress } : {}),
      ...(promoCode ? { promoCode } : {}),
      totals,
    });
    if (!result.ok) {
      setError(result.error);
      setProblems(result.problems ?? []);
      setSubmitting(false);
    }
    // On success the page navigates; keep the button in its loading state.
  }

  const formId = useId();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side={isPhone ? "bottom" : "right"}
      eyebrow="Checkout"
      title="Where should it go?"
      footer={
        <div className="space-y-2">
          {error ? (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              <p>{error}</p>
              {problems.length ? (
                <ul className="mt-1 list-disc pl-4">
                  {problems.map((p) => (
                    <li key={p.key}>{problemText(p)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <Button form={formId} type="submit" size="lg" className="w-full" disabled={!canPay} loading={submitting}>
            {submitting ? "Starting checkout" : `Pay ${formatCents(totals.totalCents, totals.currency)}`}
          </Button>
          <p className="text-center text-xs text-fog-3">You confirm payment on the next screen.</p>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-6 px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-fog-2 hover:bg-white/5 hover:text-fog"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to cart
        </button>

        <section className="space-y-3">
          <h3 className="eyebrow">Contact</h3>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={contact.email}
            onChange={(e) => setContact({ ...contact, email: e.target.value })}
            error={touched && !emailOk ? "Enter the email for your receipt and order updates." : undefined}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} hint="optional" />
            <Field label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} hint="optional" />
          </div>
        </section>

        {needsAddress ? (
          <section className="space-y-3">
            <h3 className="eyebrow">Delivery address</h3>
            <Field label="Street" autoComplete="address-line1" required value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} error={touched && !address.line1.trim() ? "Required." : undefined} />
            <Field label="Apt, suite, floor" autoComplete="address-line2" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} hint="optional" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" autoComplete="address-level2" required value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} error={touched && !address.city.trim() ? "Required." : undefined} />
              <Field label="State / region" autoComplete="address-level1" required value={address.region} onChange={(e) => setAddress({ ...address, region: e.target.value })} error={touched && !address.region.trim() ? "Required." : undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Postal code" autoComplete="postal-code" required value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} error={touched && address.postalCode.trim().length < 2 ? "Required." : undefined} />
              <Field label="Country" autoComplete="country" required maxLength={2} value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value.toUpperCase() })} hint="2-letter code" error={touched && !/^[A-Za-z]{2}$/.test(address.country.trim()) ? "Use a 2-letter code, like US." : undefined} />
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="eyebrow">Summary</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {linesByMerchant.map((g) => {
              const merchantTotals = totals.byMerchant.find((m) => m.merchantId === g.merchantId);
              const count = g.lines.reduce((n, l) => n + l.quantity, 0);
              return (
                <li key={g.merchantId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{g.merchant?.name ?? "Unknown merchant"}</p>
                    <p className="text-fog-3">
                      {count} {count === 1 ? "item" : "items"}
                      {g.type ? ` · ${fulfillmentOptionLabel(g.merchant, g.type, totals.currency).label}` : ""}
                    </p>
                  </div>
                  <span className="tabular shrink-0">
                    {formatCents((merchantTotals?.subtotalCents ?? 0) - (merchantTotals?.discountCents ?? 0) + (merchantTotals?.feeCents ?? 0), totals.currency)}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatCents(totals.subtotalCents, totals.currency)} />
            {totals.appliedOffers.map((o) => (
              <Row key={o.offerId} label={o.title} value={`-${formatCents(o.discountCents, totals.currency)}`} tone="mint" />
            ))}
            {totals.byMerchant
              .filter((m) => m.feeCents > 0)
              .map((m) => (
                <Row
                  key={m.merchantId}
                  label={`${feeLineLabel(m.type)} · ${linesByMerchant.find((g) => g.merchantId === m.merchantId)?.merchant?.name ?? ""}`}
                  value={formatCents(m.feeCents, totals.currency)}
                />
              ))}
            <Row label="Total" value={formatCents(totals.totalCents, totals.currency)} strong />
          </dl>
        </section>
      </form>
    </Drawer>
  );
}

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "mint"; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", tone === "mint" && "text-mint", strong && "border-t border-line pt-2 text-base font-semibold")}>
      <dt className={cn("min-w-0 truncate", !strong && !tone && "text-fog-2")}>{label}</dt>
      <dd className="tabular shrink-0">{value}</dd>
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | undefined;
}

function Field({ label, hint, error, className, id: givenId, ...rest }: FieldProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-fog-2">{label}</span>
        {hint ? <span className="text-xs text-fog-3">{hint}</span> : null}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "h-11 w-full rounded-lg border bg-ink-2 px-3 text-[15px] text-fog placeholder:text-fog-3 focus:outline-none",
          error ? "border-danger/60" : "border-line focus:border-sodium",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
