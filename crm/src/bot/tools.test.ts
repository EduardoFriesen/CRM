import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeTools } from "@/bot/tools";

describe("set_stage schema", () => {
  it("is described with enum (not const), which every provider accepts", async () => {
    const tools = makeTools("t", "c", { dryRun: true });
    const schema = JSON.stringify(z.toJSONSchema(tools.set_stage.inputSchema as z.ZodType));
    expect(schema).toContain('"enum":["consulta"]');
    expect(schema).not.toContain('"const"');
  });
});
