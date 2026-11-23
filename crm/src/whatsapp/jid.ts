const PHONE_JID = /^(\d{6,20})@s\.whatsapp\.net$/;

// Groups, status updates and channels are never customers.
export const isIgnoredJid = (jid: string): boolean => /@(g\.us|broadcast|newsletter)$/.test(jid);

// WhatsApp may hide the number behind a LID; Evolution sometimes sends the phone JID as `alt`.
export function phoneFromJid(jid: string, alt?: string): string | null {
  return PHONE_JID.exec(jid)?.[1] ?? (alt ? (PHONE_JID.exec(alt)?.[1] ?? null) : null);
}
