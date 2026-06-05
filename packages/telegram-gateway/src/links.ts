// Telegram start-parameter rules: 1-64 chars, A-Z a-z 0-9 _ and -.
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStartParam(s: string): boolean {
  return START_PARAM_RE.test(s);
}

export function buildConnectLink(botUsername: string, token: string): string {
  const handle = botUsername.replace(/^@/, "");
  return `https://t.me/${handle}?start=${token}`;
}

export interface ParsedCommand {
  command: string; // lowercased, no leading slash, no @botname suffix
  arg: string; // everything after the first space, trimmed ("" if none)
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  const command = head.slice(1).split("@")[0]!.toLowerCase();
  return { command, arg };
}
