const MEDIA: Record<string, string> = {
  audioMessage: "Audio",
  imageMessage: "Foto",
  videoMessage: "Video",
  stickerMessage: "Sticker",
  documentMessage: "Documento",
  locationMessage: "Ubicación",
  contactMessage: "Contacto",
};

// The webhook stores non-text messages as "[<messageType>]" (see whatsapp/webhook.ts).
export function messagePreview(body: string): { text: string; media: boolean } {
  const type = /^\[(\w+Message)\]$/.exec(body)?.[1];
  if (!type) return { text: body, media: false };
  return { text: MEDIA[type] ?? "Mensaje sin texto", media: true };
}
