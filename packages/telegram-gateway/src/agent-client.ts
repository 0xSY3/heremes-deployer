import type { AgentEndpoint } from "./types";

export interface AskAgentOptions {
  model?: string;
  fetchFn?: typeof fetch;
}

// POST /v1/chat/completions (Bearer key); X-Hermes-Session-Key carries per-chat context.
export async function askAgent(
  agent: AgentEndpoint,
  sessionKey: string,
  text: string,
  opts: AskAgentOptions = {},
): Promise<string> {
  const f = opts.fetchFn ?? fetch;
  const res = await f(`${agent.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${agent.apiKey}`,
      "x-hermes-session-key": sessionKey,
    },
    body: JSON.stringify({
      model: opts.model ?? "hermes",
      stream: false,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`agent /v1/chat/completions returned ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}
