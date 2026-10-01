import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getDataSource } from "@/lib/data";
import { formatCents } from "@/lib/utils/money";
import { Badge, Button, ProductImage } from "@/components/ui";
import { DisplayNameForm } from "@/features/account/DisplayNameForm";
import { LevelCard } from "@/features/account/LevelCard";
import type { DigitalReward, Order, OrderStatus, RewardKind } from "@/types/domain";
import { updateDisplayName } from "./actions";

export const metadata: Metadata = { title: "Your account · Chifir" };

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  payment_failed: "Payment failed",
  paid: "Paid",
  in_fulfillment: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const STATUS_TONE: Record<OrderStatus, "neutral" | "signal" | "mint" | "sodium" | "danger"> = {
  pending_payment: "neutral",
  payment_failed: "danger",
  paid: "sodium",
  in_fulfillment: "sodium",
  completed: "mint",
  cancelled: "danger",
  refunded: "neutral",
};

const KIND_LABEL: Record<RewardKind, string> = {
  avatar_item: "Avatar item",
  apartment_item: "Apartment item",
  food_prop: "Table item",
  badge: "Badge",
  vehicle: "Vehicle",
  emote: "Emote",
  access_pass: "Access pass",
};

const RARITY_TONE: Record<DigitalReward["rarity"], "neutral" | "signal" | "mint" | "sodium"> = {
  common: "neutral",
  rare: "mint",
  epic: "sodium",
  legendary: "signal",
};

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function orderSummary(order: Order): string {
  const items = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const stores = new Set(order.items.map((i) => i.merchantNameSnapshot)).size;
  return `${plural(items, "item", "items")} from ${plural(stores, "store", "stores")}`;
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login?next=%2Faccount");

  const ds = getDataSource();
  const [profileResult, ordersResult, grantsResult] = await Promise.allSettled([
    ds.getProfile(user.id),
    ds.listOrdersForUser(user.id),
    ds.listUserRewards(user.id),
  ]);

  let loadFailed = false;
  for (const result of [profileResult, ordersResult, grantsResult]) {
    if (result.status === "rejected") {
      loadFailed = true;
      console.error("[account] load failed", result.reason);
    }
  }
  const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const grants = grantsResult.status === "fulfilled" ? grantsResult.value : [];

  let rewards: DigitalReward[] = [];
  if (grants.length > 0) {
    try {
      rewards = await ds.getRewards(grants.map((g) => g.rewardId));
    } catch (error) {
      loadFailed = true;
      console.error("[account] rewards load failed", error);
    }
  }
  const grantedAt = new Map(grants.map((g) => [g.rewardId, g.grantedAt]));
  rewards.sort(
    (a, b) => Date.parse(grantedAt.get(b.id) ?? "") - Date.parse(grantedAt.get(a.id) ?? ""),
  );

  const displayName =
    profile?.displayName ?? user.displayName ?? user.email?.split("@")[0] ?? "Citizen";
  const xp = profile?.xp ?? 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 pb-20">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Your account</div>
          <h1 className="font-display mt-1 truncate text-3xl font-semibold tracking-tight sm:text-4xl">
            {displayName}
          </h1>
          {user.email ? <p className="mt-1 truncate text-[14px] text-fog-3">{user.email}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/city"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-display text-[13px] font-semibold text-fog-2 hover:bg-white/5 hover:text-fog"
          >
            Back to the city
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <form method="post" action="/auth/signout">
            <Button type="submit" variant="secondary" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {loadFailed ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[14px] text-danger"
        >
          We could not load part of your account.{" "}
          <a href="/account" className="underline">
            Try again
          </a>
          .
        </p>
      ) : null}

      <div className="mt-8 grid gap-5">
        <LevelCard xp={xp} />

        <section className="sign p-6" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="font-display text-lg font-semibold tracking-tight">
            Profile
          </h2>
          <div className="mt-4">
            <DisplayNameForm action={updateDisplayName} initialName={displayName} />
          </div>
        </section>

        <section className="sign p-6" aria-labelledby="orders-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="orders-heading" className="font-display text-lg font-semibold tracking-tight">
              Orders
            </h2>
            {orders.length > 0 ? (
              <span className="text-[13px] text-fog-3">
                {plural(orders.length, "order", "orders")}
              </span>
            ) : null}
          </div>

          {orders.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center">
              <p className="font-display text-[15px] font-semibold">No orders yet.</p>
              <p className="mt-1 text-[14px] text-fog-2">
                Walk into a store. Everything you buy here is real.
              </p>
              <Link
                href="/city"
                className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-signal px-4 font-display text-[15px] font-semibold tracking-tight text-night shadow-[0_8px_24px_rgba(255,90,54,0.28)] hover:bg-[#ff7053]"
              >
                Enter the city
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-3.5 transition-colors hover:bg-white/4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                        <span className="text-[13px] text-fog-3">
                          {dateFmt.format(new Date(order.placedAt))}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[14px] text-fog-2">{orderSummary(order)}</p>
                    </div>
                    <div className="tabular font-display text-[15px] font-semibold">
                      {formatCents(order.totalCents, order.currency)}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fog-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="sign p-6" aria-labelledby="rewards-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="rewards-heading" className="font-display text-lg font-semibold tracking-tight">
              Your digital twins
            </h2>
            {rewards.length > 0 ? (
              <span className="text-[13px] text-fog-3">
                {plural(rewards.length, "item", "items")}
              </span>
            ) : null}
          </div>

          {rewards.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center">
              <p className="font-display text-[15px] font-semibold">Nothing here yet.</p>
              <p className="mt-1 text-[14px] text-fog-2">
                Some real things come with a digital twin: a hoodie for your avatar, flowers for
                your apartment. Buy one and it lands here.
              </p>
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {rewards.map((reward) => (
                <li
                  key={reward.id}
                  className="flex gap-3 rounded-xl border border-line bg-night/40 p-3"
                >
                  <ProductImage
                    src={reward.previewImageUrl}
                    alt={reward.name}
                    label={reward.name}
                    className="h-16 w-16 shrink-0 rounded-lg"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge>{KIND_LABEL[reward.kind]}</Badge>
                      <Badge tone={RARITY_TONE[reward.rarity]}>{reward.rarity}</Badge>
                    </div>
                    <p className="font-display mt-1.5 truncate text-[15px] font-semibold">
                      {reward.name}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-fog-2">
                      {reward.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
