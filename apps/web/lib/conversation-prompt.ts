import "server-only";

import { readFile } from "node:fs/promises";

const promptUrl = new URL("../../../prompts/conversation-agent.md", import.meta.url);
let promptPromise: Promise<string> | null = null;

export function getConversationAgentPrompt(): Promise<string> {
  promptPromise ??= readFile(promptUrl, "utf8");
  return promptPromise;
}
