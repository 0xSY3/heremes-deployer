import { z } from "zod";

// Format sanity check to fail fast before a ~40s container boot; not provider validation.
const LLM_KEY_PREFIXES = ["sk-or-", "sk-ant-"];

export const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens only"),
  llmKey: z
    .string()
    .min(20, "LLM key looks too short")
    .refine(
      (k) => LLM_KEY_PREFIXES.some((p) => k.startsWith(p)),
      "expected an OpenRouter (sk-or-…) or Anthropic (sk-ant-…) key",
    ),
});

export type CreateAgentBody = z.infer<typeof createAgentSchema>;
