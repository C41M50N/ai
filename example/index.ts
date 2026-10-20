import { Output, stepCountIs, tool } from "ai";
import { z } from "zod";

import { createAI } from "../src/index";

const ai = createAI({
  providers: {
    google: async () => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    },
  },
  models: {
    fast: {
      provider: "google",
      id: "gemini-2.5-flash-lite",
      costs: { input: 0.1, output: 0.4 },
    },
  },
});

async function main(): Promise<void> {
  console.log("Available models:", ai.models);

  const { data, metadata } = await ai.generate({
    model: "fast",
    prompt: "Suggest three names for a TypeScript AI SDK client.",
    reasoning: "minimal",
    output: Output.object({
      schema: z.object({
        names: z.array(z.string()).length(3),
      }),
    }),
    logKey: "name-ideas",
  });

  console.log("Structured output:", data);
  console.log("Usage and cost:", metadata);

  const assistant = ai.agent({
    model: "fast",
    instructions: "You answer questions about the weather using the available tools.",
    tools: {
      weather: tool({
        description: "Get the current weather for a city",
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => ({ city, tempC: 21, conditions: "partly cloudy" }),
      }),
    },
    stopWhen: stepCountIs(5),
    logKey: "weather-agent",
  });

  const run = await assistant.generate({ prompt: "What's the weather like in Paris right now?" });

  console.log("Agent answer:", run.text);
  console.log("Agent steps:", run.steps.length);
  console.log("Agent usage and cost:", run.metadata);
}

await main();
