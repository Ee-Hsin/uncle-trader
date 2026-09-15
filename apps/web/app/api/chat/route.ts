import OpenAI from "openai";
import { createChatHandler } from "@/lib/chat-handler";
import { getConversationAgentPrompt } from "@/lib/conversation-prompt";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.WEB_OPENAI_API_KEY;
  const model = process.env.WEB_OPENAI_MODEL;
  if (!apiKey || !model) {
    return Response.json(
      {
        error: {
          code: "configuration_error",
          message: "The conversation service is not configured.",
        },
      },
      { status: 500 },
    );
  }

  try {
    const instructions = await getConversationAgentPrompt();
    return createChatHandler(new OpenAI({ apiKey, timeout: 30_000, maxRetries: 2 }), model, instructions)(request);
  } catch {
    return Response.json(
      {
        error: {
          code: "configuration_error",
          message: "The conversation instructions could not be loaded.",
        },
      },
      { status: 500 },
    );
  }
}
