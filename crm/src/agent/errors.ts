// Human-readable explanation of the agent's last error code (shown on the Agente screen).
const MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED:
    "Se agotó la cuota del proveedor de IA (en Gemini gratis, el límite diario por modelo). Esperá a que se renueve, activá la facturación en el proveedor o elegí otro modelo.",
  HTTP_429: "El proveedor de IA rechazó por límite de uso. Si se repite, revisá la cuota o la facturación de tu cuenta.",
  HTTP_401: "El proveedor rechazó la API key.",
  HTTP_403: "El proveedor rechazó la API key.",
  HTTP_404: "El proveedor no encuentra ese modelo. Revisá el nombre del modelo.",
};

export const describeAgentError = (code: string): string => MESSAGES[code] ?? `Error del bot: ${code}`;
