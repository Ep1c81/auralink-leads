export interface BantDimension {
  score: number;
  notes: string;
}

export type LeadStatus =
  | "new"
  | "qualified"
  | "unqualified"
  | "needs_more_info";

export interface BantQualification {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timeline: BantDimension;
  overall_score: number;
  status: LeadStatus;
  summary: string;
}

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: LeadStatus;
  lead_score: number;
  metadata: { bant?: BantQualification; [key: string]: unknown };
  created_at: string;
}

export interface LeadConversation {
  id: string;
  lead_id: string;
  sender: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WebEnrichment {
  emails: string[];
  socialLinks: Record<string, string>;
  description: string | null;
  fetchedAt: string;
  error?: string;
}

export interface OutreachContent {
  whatsapp_pitch: string;
  email_subject: string;
  email_body: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type OutreachMessageStatus =
  | "draft"
  | "queued"
  | "sent"
  | "failed"
  | "bounced";

export interface OutreachCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
}

export interface OutreachCampaignWithCounts extends OutreachCampaign {
  message_count: number;
  sent_count: number;
  reply_count: number;
}

export interface OutreachMessage {
  id: string;
  campaign_id: string;
  lead_id: string;
  subject: string | null;
  body: string | null;
  status: OutreachMessageStatus;
  sent_at: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export interface OutreachMessageWithLead extends OutreachMessage {
  lead: Pick<Lead, "id" | "name" | "company" | "email"> | null;
}

export interface OutreachReply {
  id: string;
  message_id: string;
  raw_content: string | null;
  received_at: string;
  classified: boolean;
}
