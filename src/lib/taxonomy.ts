// Fixed taxonomies used across ingestion, categorization and the UI.
// The site is focused on UK politics (Reform UK by default — see FOCUS_PARTY).

export function focusParty(): string {
  return process.env.FOCUS_PARTY || "Reform UK";
}

// What kind of content an archived item is.
export const ITEM_KINDS = ["email", "tweet"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// High-level "what kind of email is this" buckets (emails only).
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

// UK policy topic taxonomy the model is asked to pick from.
export const POLICY_TOPICS = [
  "Immigration & Small Boats",
  "Economy & Growth",
  "Tax & Spending",
  "NHS & Social Care",
  "Net Zero & Energy",
  "Crime & Policing",
  "Brexit & EU Relations",
  "Housing & Planning",
  "Education & Schools",
  "Welfare & Benefits",
  "Defence & Security",
  "Foreign Affairs",
  "Cost of Living",
  "Pensions",
  "Transport & Infrastructure",
  "Farming & Fishing",
  "Civil Liberties & Free Speech",
  "Devolution & the Union",
  "Local Government",
  "Elections & Democracy",
  "Government Waste & Reform",
  "Sovereignty & Constitution",
  "Media & Culture",
  "Technology & Online Safety",
] as const;

export type PolicyTopic = (typeof POLICY_TOPICS)[number];

// UK parties, focus party first (default selection for new people).
export const PARTIES = [
  "Reform UK",
  "Conservative",
  "Labour",
  "Liberal Democrat",
  "Green",
  "SNP",
  "Plaid Cymru",
  "DUP",
  "Independent",
  "Other",
  "Unknown",
] as const;

/** CSS-safe class fragment for a party, e.g. "Reform UK" → "reform-uk". */
export function partySlug(party: string): string {
  return party.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

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
