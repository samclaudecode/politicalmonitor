// Fixed taxonomies used across ingestion, categorization and the UI.

// High-level "what kind of email is this" buckets.
export const EMAIL_TYPES = [
  "fundraising",
  "event",
  "volunteer",
  "survey_or_petition",
  "newsletter_update",
  "endorsement",
  "attack_or_contrast",
  "get_out_the_vote",
  "merchandise",
  "thank_you",
  "other",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

// Policy topic taxonomy the model is asked to pick from.
export const POLICY_TOPICS = [
  "Economy & Jobs",
  "Taxes & Budget",
  "Healthcare",
  "Abortion & Reproductive Rights",
  "Immigration & Border",
  "Climate & Energy",
  "Environment",
  "Education",
  "Guns & Public Safety",
  "Crime & Policing",
  "Democracy & Voting Rights",
  "Foreign Policy & National Security",
  "Veterans & Military",
  "Social Security & Medicare",
  "Housing",
  "Labor & Unions",
  "Civil Rights & Equality",
  "LGBTQ+ Rights",
  "Technology & Privacy",
  "Agriculture & Rural Issues",
  "Infrastructure & Transportation",
  "Judiciary & Courts",
  "Government Ethics & Corruption",
  "Cost of Living & Inflation",
] as const;

export type PolicyTopic = (typeof POLICY_TOPICS)[number];

export const PARTIES = [
  "Democratic",
  "Republican",
  "Independent",
  "Libertarian",
  "Green",
  "Other",
  "Unknown",
] as const;

export const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  fundraising: "Fundraising",
  event: "Event",
  volunteer: "Volunteer",
  survey_or_petition: "Survey / Petition",
  newsletter_update: "Newsletter / Update",
  endorsement: "Endorsement",
  attack_or_contrast: "Attack / Contrast",
  get_out_the_vote: "Get Out The Vote",
  merchandise: "Merchandise",
  thank_you: "Thank You",
  other: "Other",
};

export function emailTypeLabel(type: string | null): string {
  if (!type) return "Uncategorized";
  return EMAIL_TYPE_LABELS[type as EmailType] ?? type;
}
