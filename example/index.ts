import { Output } from "ai";
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
}

await main();
