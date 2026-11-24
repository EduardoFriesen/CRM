import { plain } from "../../lib/plain";
import { RULES, TRIVIAL } from "./rules";
import type { Decision } from "./types";

export const MAX_RULE_WORDS = 8;

/** Zero-token step: silence trivial messages, map obvious questions to an FAQ. */
export function prefilter(text: string, lastBotText: string | null): Decision | null {
  const p = plain(text).trim();
  const botAsked = lastBotText?.trim().endsWith("?") ?? false;
  if (!botAsked && p.split("\n").every((line) => TRIVIAL.test(line))) return { kind: "silence" };

  if (p.split(/\s+/).length > MAX_RULE_WORDS) return null;
  const rule = RULES.find((r) => r.pattern.test(p));
  if (!rule) return null;
  const args = rule.fn === "handoff" ? { reason: "El cliente quiere pagar" } : {};
  return { kind: "faq", fn: rule.fn, args };
}
