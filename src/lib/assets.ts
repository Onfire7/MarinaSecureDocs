// Assets — shared display helpers (see docs: pages/asset-list.html).
// Asset.currentStatus is an open, marina-defined set; these are the common
// values the app offers by default.

export const COMMON_ASSET_STATUSES = [
  "available",
  "in_use",
  "needs_charging",
  "needs_service",
  "out_of_service",
] as const;

export const DEFAULT_POST_RETURN_STATUS = "available";

export function assetStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "available":
      return "badge badge-good";
    case "in_use":
      return "badge badge-accent";
    case "needs_charging":
    case "needs_service":
      return "badge badge-warn";
    case "out_of_service":
      return "badge badge-bad";
    default:
      return "badge";
  }
}

/**
 * What the meter column reads. A metered asset shows its absolute reading
 * with the unit; a meterless one accrues hours instead, so the same stored
 * number means "hours accumulated" rather than "current odometer."
 */
export function meterSummary(asset: {
  hasMeter: boolean;
  meterType?: string | null;
  meterReading?: number | null;
}): string {
  const value = asset.meterReading;
  if (!asset.hasMeter) {
    return value != null ? `${formatNumber(value)} hrs accrued` : "No hours logged";
  }
  if (value == null) return "No reading yet";
  return asset.meterType === "mileage"
    ? `${formatNumber(value)} mi`
    : `${formatNumber(value)} hrs`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
