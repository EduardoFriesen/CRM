import { plain } from "@/lib/plain";
import { GREETING, NO_RULE, RULES, TRIVIAL } from "./rules";
import type { Decision } from "./types";

export const MAX_RULE_WORDS = 8;

/** Zero-token step: silence trivial messages, map obvious questions to an FAQ. */
export function prefilter(text: string, lastBotText: string | null): Decision | null {
  const p = plain(text).trim();
  // A question anywhere counts: bots often add "Avisame" or an emoji after it.
  const botAsked = lastBotText?.includes("?") ?? false;
  if (!botAsked && !p.includes("?") && p.split("\n").every((line) => TRIVIAL.test(line))) return { kind: "silence" };

  const lines = p.split("\n").filter((line) => line.trim());
  if (lines.length > 0 && lines.every((line) => GREETING.test(line))) return { kind: "faq", fn: "greeting", args: {} };

  if (p.split(/\s+/).length > MAX_RULE_WORDS) return null;
  const rule = RULES.find((r) => r.pattern.test(p));
  if (!rule || (rule.fn !== "handoff" && NO_RULE.test(p))) return null;
  const args = rule.fn === "handoff" ? { reason: "El cliente quiere pagar" } : {};
  return { kind: "faq", fn: rule.fn, args };
}
