import type { MerchantDraftStatus } from "@/types/domain";
import { cn } from "@/lib/utils/cn";
import { STATUS_LABEL } from "./editor";

const TONE: Record<MerchantDraftStatus, string> = {
  extracted: "border-sodium/30 bg-sodium/12 text-sodium",
  in_review: "border-sky/30 bg-sky/12 text-sky",
  approved: "border-mint/30 bg-mint/12 text-mint",
  published: "border-signal/30 bg-signal/12 text-signal",
  rejected: "border-danger/30 bg-danger/12 text-danger",
};

export function StatusChip({ status, className }: { status: MerchantDraftStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide", TONE[status], className)} data-testid="status-chip">
      {STATUS_LABEL[status]}
    </span>
  );
}
