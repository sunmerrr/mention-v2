export type CampaignOrigin = "dashboard" | "external" | "legacy";
export function campaignOrigin(requestId: unknown): CampaignOrigin {
  if (typeof requestId !== "string") return "legacy";
  if (requestId.startsWith("mention_v2_")) return "dashboard";
  if (/^(scheduled_|welcome_|news_)/.test(requestId)) return "external";
  return "legacy";
}
