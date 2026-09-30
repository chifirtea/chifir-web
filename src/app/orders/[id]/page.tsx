import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { DigitalReward } from "@/types/domain";
import { getDataSource } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizeOrderAccess, publicOrder, refreshOrderStatus } from "@/lib/commerce/service";
import { orderIdSchema, orderTokenSchema } from "@/lib/commerce/validation";
import { OrderStatus } from "@/features/orders/OrderStatus";

export const metadata: Metadata = { title: "Your order — Chifir", robots: { index: false } };

/**
 * /orders/[id]?t=<guest token>&session_id=<stripe session>
 * Readable by the signed-in owner or anyone holding the guest token from checkout. Never listed.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; session_id?: string }>;
}) {
  const { id } = await params;
  const { t, session_id } = await searchParams;
  if (!orderIdSchema.safeParse(id).success) notFound();
  const token = t && orderTokenSchema.safeParse(t).success ? t : undefined;

  const ds = getDataSource();
  const order = await ds.getOrder(id);
  if (!order) notFound();
  const user = await getCurrentUser();
  if (!authorizeOrderAccess(order, { userId: user?.id, token })) notFound();

  const fresh = await refreshOrderStatus(order, new Date(), ds);
  const rewardIds = [
    ...new Set(fresh.items.map((i) => i.digitalRewardId).filter((r): r is string => Boolean(r))),
  ];
  const [rewards, offers] = await Promise.all([
    rewardIds.length ? ds.getRewards(rewardIds) : Promise.resolve([] as DigitalReward[]),
    ds.listOffers(),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <OrderStatus
        initialOrder={publicOrder(fresh)}
        token={token}
        sessionId={session_id}
        rewards={Object.fromEntries(rewards.map((r) => [r.id, r]))}
        offerTitles={Object.fromEntries(offers.map((o) => [o.id, o.title]))}
        initialUserId={user?.id}
      />
    </main>
  );
}
