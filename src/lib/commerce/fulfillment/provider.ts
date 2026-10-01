import type {
  FulfillmentProviderId,
  FulfillmentStatus,
  Merchant,
  Order,
  OrderFulfillment,
  OrderItem,
} from "@/types/domain";
import { SimulatedProvider } from "./simulated";

export interface FulfillmentCreateInput {
  order: Order;
  fulfillment: OrderFulfillment;
  merchant: Merchant | null;
  items: OrderItem[];
}

/**
 * A fulfillment channel (in-house courier, DoorDash Drive, Shippo, ...). Implementations are pure
 * over their inputs: they return the next fulfillment state and never write to storage themselves.
 */
export interface FulfillmentProvider {
  id: FulfillmentProviderId;
  /** Hands a paid fulfillment to the provider. Returns the accepted state with its ETA. */
  create(input: FulfillmentCreateInput, now?: Date): Promise<OrderFulfillment>;
  /** Advances the fulfillment to where it should be at `now`. Returns the same object when nothing changed. */
  getStatus(fulfillment: OrderFulfillment, now: Date): Promise<OrderFulfillment>;
  cancel(fulfillment: OrderFulfillment, now?: Date): Promise<OrderFulfillment>;
}

export const TERMINAL_FULFILLMENT_STATUSES: ReadonlySet<FulfillmentStatus> = new Set([
  "delivered",
  "cancelled",
  "failed",
]);

export function isTerminalFulfillment(status: FulfillmentStatus): boolean {
  return TERMINAL_FULFILLMENT_STATUSES.has(status);
}

const simulated = new SimulatedProvider();

/**
 * Registry. Only the simulated provider exists in the MVP; every configured id resolves to it so
 * seeded merchants declaring `doordash_drive` or `shippo` keep working until those land.
 */
const REGISTRY: Record<FulfillmentProviderId, FulfillmentProvider> = {
  simulated,
  merchant_self: simulated,
  doordash_drive: simulated,
  shippo: simulated,
};

export function getFulfillmentProvider(id: FulfillmentProviderId): FulfillmentProvider {
  return REGISTRY[id] ?? simulated;
}
