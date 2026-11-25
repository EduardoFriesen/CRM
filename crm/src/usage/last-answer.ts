import type { LastAnswer } from "./events";

// Who wrote the last reply: the cheap router (template answer), the main model, or a fixed rule.
export function describeAnswerer(e: Pick<LastAnswer, "path" | "routerModel" | "model"> | null): string {
  if (!e) return "—";
  if (e.path === "example") return "Atajo (sin IA)";
  if (e.path === "complex" || e.path === "relay") return `Pesado (${e.model ?? "?"})`;
  if (e.routerModel) return `Router (${e.routerModel})`;
  return "Regla (sin IA)";
}
