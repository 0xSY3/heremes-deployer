import { describe, it, expect } from "vitest";
import { buildConnectLink, isValidStartParam, parseCommand } from "../src/links";

describe("buildConnectLink", () => {
  it("builds a t.me deep link and strips a leading @", () => {
    expect(buildConnectLink("HermesZyndBot", "abc-123")).toBe("https://t.me/HermesZyndBot?start=abc-123");
    expect(buildConnectLink("@HermesZyndBot", "x")).toBe("https://t.me/HermesZyndBot?start=x");
  });
});

describe("isValidStartParam", () => {
  it("accepts url-safe tokens up to 64 chars", () => {
    expect(isValidStartParam("aZ09_-")).toBe(true);
    expect(isValidStartParam("a".repeat(64))).toBe(true);
  });
  it("rejects empty, too-long, or out-of-charset values", () => {
    expect(isValidStartParam("")).toBe(false);
    expect(isValidStartParam("a".repeat(65))).toBe(false);
    expect(isValidStartParam("has space")).toBe(false);
    expect(isValidStartParam("dots.notallowed")).toBe(false);
  });
});

describe("parseCommand", () => {
  it("parses a bare command", () => {
    expect(parseCommand("/help")).toEqual({ command: "help", arg: "" });
  });
  it("parses a command with an argument", () => {
    expect(parseCommand("/start tok_EN-123")).toEqual({ command: "start", arg: "tok_EN-123" });
  });
  it("lowercases and strips a @botname suffix", () => {
    expect(parseCommand("/Start@HermesZyndBot payload")).toEqual({ command: "start", arg: "payload" });
  });
  it("returns null for non-commands", () => {
    expect(parseCommand("hello there")).toBeNull();
    expect(parseCommand("  not a command")).toBeNull();
  });
});
