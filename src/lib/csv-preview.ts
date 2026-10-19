export interface CsvPreview {
  kind: "metrics" | "conversions" | "ads";
  header: string[];
  sample: string[][];
  rows: number;
  mapping: Record<string, string>;
  csv: string;
  extra: Record<string, string>;
}

export interface CsvPreviewResult {
  ok: boolean;
  message: string;
  preview?: CsvPreview;
}

export const CSV_TARGETS: Record<CsvPreview["kind"], Array<[string, string]>> = {
  metrics: [["post_url", "Post link"], ["date", "Date"], ["reach", "Reach"], ["impressions", "Impressions"], ["views", "Views"], ["retention_avg_pct", "Avg retention %"], ["likes", "Likes"], ["saves", "Saves"], ["shares", "Shares"], ["comments", "Comments"], ["clicks", "Clicks"], ["profile_visits", "Profile visits"], ["follows", "Follows"]],
  conversions: [["type", "Conversion type"], ["occurred_at", "Date"], ["external_ref", "Id"], ["amount", "Amount"], ["currency", "Currency"], ["landing_url", "Landing URL with UTM"], ["utm_campaign", "utm_campaign"], ["utm_content", "utm_content"]],
  ads: [["day", "Day"], ["campaign", "Campaign"], ["ad_group", "Ad set / ad group"], ["ad_name", "Ad name"], ["ad_id", "Ad id"], ["spend", "Spend"], ["impressions", "Impressions"], ["clicks", "Clicks"], ["results", "Results (platform-reported)"], ["reach", "Reach"], ["currency", "Currency"], ["final_url", "URL / URL tags"]],
};
