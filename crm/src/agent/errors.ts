// Human-readable explanation of the agent's last error code (shown on the Agente screen).
const MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED:
    "Se agotó la cuota del proveedor de IA (en Gemini gratis, el límite diario por modelo). Esperá a que se renueve, activá la facturación en el proveedor o elegí otro modelo.",
  HTTP_429: "El proveedor de IA rechazó por límite de uso. Si se repite, revisá la cuota o la facturación de tu cuenta.",
  HTTP_401: "El proveedor rechazó la API key.",
  HTTP_403: "El proveedor rechazó la API key.",
  HTTP_404: "El proveedor no encuentra ese modelo. Revisá el nombre del modelo.",
  OLLAMA_UNAVAILABLE: "Ollama no está disponible en este servidor. Elegí otro proveedor.",
};

export const describeAgentError = (code: string): string => {
  if (MESSAGES[code]) return MESSAGES[code];
  if (code === "VERIFY_TIMEOUT")
    return "No pudimos verificar la key: el proveedor no respondió a tiempo (puede estar saturado). La guardamos igual; probala en el chat de prueba.";
  if (code.startsWith("VERIFY_"))
    return `No pudimos verificar la key (${code.slice(7)}): el proveedor dio un error. La guardamos igual; probala en el chat de prueba.`;
  return `Error del bot: ${code}`;
};
