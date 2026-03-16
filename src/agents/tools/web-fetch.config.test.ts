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

  it("does not reuse cached responses across RFC2544 policy changes", async () => {
    vi.mocked(fetchWithWebToolsNetworkGuard)
      .mockResolvedValueOnce({
        response: new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
        finalUrl: "https://public.test/cache-scope",
        release: async () => {},
      })
      .mockResolvedValueOnce({
        response: new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
        finalUrl: "https://public.test/cache-scope",
        release: async () => {},
      });

    const enabledTool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              allowRfc2544BenchmarkRange: true,
              cacheTtlMinutes: 1,
              firecrawl: { enabled: false },
            },
          },
        },
      },
    });
    const disabledTool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 1,
              firecrawl: { enabled: false },
            },
          },
        },
      },
    });

    await enabledTool?.execute?.("call", { url: "https://public.test/cache-scope" });
    await disabledTool?.execute?.("call", { url: "https://public.test/cache-scope" });

    expect(fetchWithWebToolsNetworkGuard).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchWithWebToolsNetworkGuard).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        policy: {
          allowRfc2544BenchmarkRange: true,
        },
      }),
    );
    expect(vi.mocked(fetchWithWebToolsNetworkGuard).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        policy: undefined,
      }),
    );
  });
});
