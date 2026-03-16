import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithWebToolsNetworkGuard } from "./web-guarded-fetch.js";
import { createWebFetchTool } from "./web-tools.js";

vi.mock("./web-guarded-fetch.js", () => ({
  fetchWithWebToolsNetworkGuard: vi.fn(),
  withTrustedWebToolsEndpoint: vi.fn(),
}));

describe("web_fetch RFC2544 config", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not allow RFC2544 benchmark DNS answers by default", async () => {
    vi.mocked(fetchWithWebToolsNetworkGuard).mockResolvedValue({
      response: new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
      finalUrl: "https://public.test/default",
      release: async () => {},
    });

    const tool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 0,
              firecrawl: { enabled: false },
            },
          },
        },
      },
    });

    await tool?.execute?.("call", { url: "https://public.test/default" });

    expect(fetchWithWebToolsNetworkGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://public.test/default",
        policy: undefined,
      }),
    );
  });

  it("allows RFC2544 benchmark DNS answers only when explicitly enabled", async () => {
    vi.mocked(fetchWithWebToolsNetworkGuard).mockResolvedValue({
      response: new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
      finalUrl: "https://public.test/fake-ip",
      release: async () => {},
    });

    const tool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              allowRfc2544BenchmarkRange: true,
              cacheTtlMinutes: 0,
              firecrawl: { enabled: false },
            },
          },
        },
      },
    });

    await tool?.execute?.("call", { url: "https://public.test/fake-ip" });

    expect(fetchWithWebToolsNetworkGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://public.test/fake-ip",
        policy: {
          allowRfc2544BenchmarkRange: true,
        },
      }),
    );
  });
});
