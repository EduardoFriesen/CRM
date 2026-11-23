import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Agent evaluation against a real local Ollama: `npm run eval:agent` (EVAL_MODEL=<model>).
// Not part of the test suite: it needs Ollama running and its result is probabilistic.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["eval/**/*.eval.ts"],
    testTimeout: 600_000,
    silent: false,
    env: { ...base.test?.env, OLLAMA_URL: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1" },
  },
});
