export const SIGNUP_URL: string;
export const TEXT: Record<string, unknown>;
export const FAQ: [string[], string][];
export type FunnelContact = { phone: string; business_name: string; contact_name?: string | null; conv_state: string; trial_status: string; customer?: boolean };
export function decide(input: { contact: FunnelContact | null; text?: string; button?: string; kind: 'reply' | 'optout' }): {
  reply: string | null; update: Record<string, unknown> | null; notify: string | null;
};
