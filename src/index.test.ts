import { describe, expect, it } from "bun:test";

import { createAI } from "./index.js";

describe("createAI", () => {
  const makeClient = () =>
    createAI({
      providers: {
        fake: () => (id: string) => ({ id }) as never,
      },
      models: {
        fast: { provider: "fake", id: "fake-fast" },
        smart: { provider: "fake", id: "fake-smart", costs: { input: 2.5, output: 10 } },
      },
    });

  it("exposes the configured model aliases", () => {
    const ai = makeClient();
    expect([...ai.models].sort()).toEqual(["fast", "smart"]);
  });

  it("freezes the models array", () => {
    const ai = makeClient();
    expect(Object.isFrozen(ai.models)).toBe(true);
  });

  it("exposes a generate function", () => {
    const ai = makeClient();
    expect(typeof ai.generate).toBe("function");
  });
});
