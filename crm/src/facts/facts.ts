import { desc } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { businessFacts } from "@/db/schema";

// Learned answers for the bot prompt, newest first (the prompt caps the total size).
export function recentFacts(tenantId: string): Promise<{ question: string; answer: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ question: businessFacts.question, answer: businessFacts.answer })
      .from(businessFacts)
      .orderBy(desc(businessFacts.updatedAt))
      .limit(200),
  );
}
