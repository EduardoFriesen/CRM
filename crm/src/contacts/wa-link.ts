// Opens the chat in WhatsApp (web or app) with whatever account is logged in on that device.
export const waLink = (phone: string | null): string | null => (phone ? `https://wa.me/${phone}` : null);
