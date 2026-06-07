import { z } from "zod";

// Format sanity checks fail fast before a ~30s container boot; not provider
// validation. Provider chooses the env var name (OPENROUTER_API_KEY vs
// ANTHROPIC_API_KEY) the worker injects — see spec §4.
const LLM_KEY_PREFIXES = ["sk-or-", "sk-ant-"];

export const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, hyphens only"),
  llmProvider: z.enum(["openrouter", "anthropic"]),
  llmKey: z
    .string()
    .min(20, "LLM key looks too short")
    .refine(
      (k) => LLM_KEY_PREFIXES.some((p) => k.startsWith(p)),
      "expected an OpenRouter (sk-or-…) or Anthropic (sk-ant-…) key",
    ),
  personalityId: z.string().min(1).max(64).optional(),
});

export type CreateAgentBody = z.infer<typeof createAgentSchema>;
