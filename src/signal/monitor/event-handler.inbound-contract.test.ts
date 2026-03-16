import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectInboundContextContract } from "../../../test/helpers/inbound-contract.js";
import type { MsgContext } from "../../auto-reply/templating.js";
import { createSignalEventHandler } from "./event-handler.js";
import {
  createBaseSignalEventHandlerDeps,
  createSignalReceiveEvent,
} from "./event-handler.test-harness.js";
import type { SignalEventHandlerDeps } from "./event-handler.types.js";

const { sendTypingMock, sendReadReceiptMock, dispatchInboundMessageMock, capture } = vi.hoisted(
  () => {
    const captureState: { ctx: MsgContext | undefined } = { ctx: undefined };
    return {
      sendTypingMock: vi.fn(),
      sendReadReceiptMock: vi.fn(),
      dispatchInboundMessageMock: vi.fn(
        async (params: {
          ctx: MsgContext;
          replyOptions?: { onReplyStart?: () => void | Promise<void> };
        }) => {
          captureState.ctx = params.ctx;
          await Promise.resolve(params.replyOptions?.onReplyStart?.());
          return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
        },
      ),
      capture: captureState,
    };
  },
);

vi.mock("../send.js", () => ({
  sendMessageSignal: vi.fn(),
  sendTypingSignal: sendTypingMock,
  sendReadReceiptSignal: sendReadReceiptMock,
}));

vi.mock("../../auto-reply/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auto-reply/dispatch.js")>();
  return {
    ...actual,
    dispatchInboundMessage: dispatchInboundMessageMock,
    dispatchInboundMessageWithDispatcher: dispatchInboundMessageMock,
    dispatchInboundMessageWithBufferedDispatcher: dispatchInboundMessageMock,
  };
});

vi.mock("../../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore: vi.fn().mockResolvedValue([]),
  upsertChannelPairingRequest: vi.fn(),
}));

function createEnhancedTestHandler(overrides: Partial<SignalEventHandlerDeps> = {}) {
  return createSignalEventHandler(
    createBaseSignalEventHandlerDeps({
      // oxlint-disable-next-line typescript/no-explicit-any
      cfg: { messages: { inbound: { debounceMs: 0 } } } as any,
      historyLimit: 0,
      injectLinkPreviews: true,
      preserveTextStyles: true,
      ...overrides,
    }),
  );
}

function makeEnhancedReceiveEvent(
  dataMessage: Record<string, unknown>,
  envelopeOverrides: Record<string, unknown> = {},
) {
  return createSignalReceiveEvent({
    ...envelopeOverrides,
    dataMessage: {
      message: "",
      attachments: [],
      ...dataMessage,
    },
  });
}

function requireCapturedCtx() {
  expect(capture.ctx).toBeTruthy();
  expectInboundContextContract(capture.ctx!);
  return capture.ctx!;
}

describe("signal createSignalEventHandler inbound contract", () => {
  beforeEach(() => {
    capture.ctx = undefined;
    sendTypingMock.mockReset().mockResolvedValue(true);
    sendReadReceiptMock.mockReset().mockResolvedValue(true);
    dispatchInboundMessageMock.mockClear();
  });

  it("passes a finalized MsgContext to dispatchInboundMessage", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        // oxlint-disable-next-line typescript/no-explicit-any
        cfg: { messages: { inbound: { debounceMs: 0 } } } as any,
        historyLimit: 0,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        dataMessage: {
          message: "hi",
          attachments: [],
          groupInfo: { groupId: "g1", groupName: "Test Group" },
        },
      }),
    );

    expect(capture.ctx).toBeTruthy();
    expectInboundContextContract(capture.ctx!);
    const contextWithBody = capture.ctx!;
    // Sender should appear as prefix in group messages (no redundant [from:] suffix)
    expect(String(contextWithBody.Body ?? "")).toContain("Alice");
    expect(String(contextWithBody.Body ?? "")).toMatch(/Alice.*:/);
    expect(String(contextWithBody.Body ?? "")).not.toContain("[from:");
  });

  it("normalizes direct chat To/OriginatingTo targets to canonical Signal ids", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        // oxlint-disable-next-line typescript/no-explicit-any
        cfg: { messages: { inbound: { debounceMs: 0 } } } as any,
        historyLimit: 0,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        sourceNumber: "+15550002222",
        sourceName: "Bob",
        timestamp: 1700000000001,
        dataMessage: {
          message: "hello",
          attachments: [],
        },
      }),
    );

    expect(capture.ctx).toBeTruthy();
    const context = capture.ctx!;
    expect(context.ChatType).toBe("direct");
    expect(context.To).toBe("+15550002222");
    expect(context.OriginatingTo).toBe("+15550002222");
  });

  it("sends typing + read receipt for allowed DMs", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        cfg: {
          messages: { inbound: { debounceMs: 0 } },
          channels: { signal: { dmPolicy: "open", allowFrom: ["*"] } },
        },
        account: "+15550009999",
        blockStreaming: false,
        historyLimit: 0,
        groupHistories: new Map(),
        sendReadReceipts: true,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        dataMessage: {
          message: "hi",
        },
      }),
    );

    expect(sendTypingMock).toHaveBeenCalledWith("+15550001111", expect.any(Object));
    expect(sendReadReceiptMock).toHaveBeenCalledWith(
      "signal:+15550001111",
      1700000000000,
      expect.any(Object),
    );
  });

  it("does not auto-authorize DM commands in open mode without allowlists", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        cfg: {
          messages: { inbound: { debounceMs: 0 } },
          channels: { signal: { dmPolicy: "open", allowFrom: [] } },
        },
        allowFrom: [],
        groupAllowFrom: [],
        account: "+15550009999",
        blockStreaming: false,
        historyLimit: 0,
        groupHistories: new Map(),
      }),
    );

    await handler(
      createSignalReceiveEvent({
        dataMessage: {
          message: "/status",
          attachments: [],
        },
      }),
    );

    expect(capture.ctx).toBeTruthy();
    expect(capture.ctx?.CommandAuthorized).toBe(false);
  });

  it("forwards all fetched attachments via MediaPaths/MediaTypes", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        cfg: {
          messages: { inbound: { debounceMs: 0 } },
          channels: { signal: { dmPolicy: "open", allowFrom: ["*"] } },
        },
        ignoreAttachments: false,
        fetchAttachment: async ({ attachment }) => ({
          path: `/tmp/${String(attachment.id)}.dat`,
          contentType: attachment.id === "a1" ? "image/jpeg" : undefined,
        }),
        historyLimit: 0,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        dataMessage: {
          message: "",
          attachments: [{ id: "a1", contentType: "image/jpeg" }, { id: "a2" }],
        },
      }),
    );

    expect(capture.ctx).toBeTruthy();
    expect(capture.ctx?.MediaPath).toBe("/tmp/a1.dat");
    expect(capture.ctx?.MediaType).toBe("image/jpeg");
    expect(capture.ctx?.MediaPaths).toEqual(["/tmp/a1.dat", "/tmp/a2.dat"]);
    expect(capture.ctx?.MediaUrls).toEqual(["/tmp/a1.dat", "/tmp/a2.dat"]);
    expect(capture.ctx?.MediaTypes).toEqual(["image/jpeg", "application/octet-stream"]);
  });

  it("drops own UUID inbound messages when only accountUuid is configured", async () => {
    const ownUuid = "123e4567-e89b-12d3-a456-426614174000";
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        cfg: {
          messages: { inbound: { debounceMs: 0 } },
          channels: { signal: { dmPolicy: "open", allowFrom: ["*"], accountUuid: ownUuid } },
        },
        account: undefined,
        accountUuid: ownUuid,
        historyLimit: 0,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        sourceNumber: null,
        sourceUuid: ownUuid,
        dataMessage: {
          message: "self message",
          attachments: [],
        },
      }),
    );

    expect(capture.ctx).toBeUndefined();
    expect(dispatchInboundMessageMock).not.toHaveBeenCalled();
  });

  it("drops sync envelopes when syncMessage is present but null", async () => {
    const handler = createSignalEventHandler(
      createBaseSignalEventHandlerDeps({
        cfg: {
          messages: { inbound: { debounceMs: 0 } },
          channels: { signal: { dmPolicy: "open", allowFrom: ["*"] } },
        },
        historyLimit: 0,
      }),
    );

    await handler(
      createSignalReceiveEvent({
        syncMessage: null,
        dataMessage: {
          message: "replayed sentTranscript envelope",
          attachments: [],
        },
      }),
    );

    expect(capture.ctx).toBeUndefined();
    expect(dispatchInboundMessageMock).not.toHaveBeenCalled();
  });
});

describe("signal enhanced inbound contract coverage", () => {
  beforeEach(() => {
    capture.ctx = undefined;
    dispatchInboundMessageMock.mockClear();
  });

  it("maps quote metadata to reply context fields", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        message: "reply with quote",
        quote: {
          id: 9001,
          text: "original message",
          authorUuid: "123e4567-e89b-12d3-a456-426614174000",
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.ReplyToId).toBe("9001");
    expect(ctx.ReplyToSender).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(ctx.ReplyToBody).toBe("original message");
    expect(ctx.ReplyToIsQuote).toBe(true);
  });

  it("maps attachment captions and dimensions into media aliases and arrays", async () => {
    const handler = createEnhancedTestHandler({
      ignoreAttachments: false,
      fetchAttachment: async ({ attachment }) => ({
        path: `/tmp/${String(attachment.id)}.jpg`,
        contentType: attachment.id === "att-1" ? "image/jpeg" : "image/png",
      }),
    });

    await handler(
      makeEnhancedReceiveEvent({
        attachments: [
          { id: "att-1", contentType: "image/jpeg", caption: "cover", width: 128.4, height: 64.2 },
          { id: "att-2", contentType: "image/png", width: 320.9, height: 240.1 },
        ],
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.MediaPath).toBe("/tmp/att-1.jpg");
    expect(ctx.MediaCaption).toBe("cover");
    expect(ctx.MediaCaptions).toEqual(["cover", ""]);
    expect(ctx.MediaDimension).toEqual({ width: 128, height: 64 });
    expect(ctx.MediaDimensions).toEqual([
      { width: 128, height: 64 },
      { width: 321, height: 240 },
    ]);
  });

  it("surfaces sticker metadata and placeholder context", async () => {
    const handler = createEnhancedTestHandler({
      ignoreAttachments: false,
      fetchAttachment: async () => ({
        path: "/tmp/sticker.webp",
        contentType: "image/webp",
      }),
    });

    await handler(
      makeEnhancedReceiveEvent({
        sticker: {
          packId: "pack-1",
          stickerId: "7",
          attachment: { id: "sticker-1", contentType: "image/webp", width: 512, height: 256 },
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("<media:sticker>");
    expect(ctx.MediaPath).toBe("/tmp/sticker.webp");
    expect(ctx.MediaDimension).toEqual({ width: 512, height: 256 });
    expect(ctx.UntrustedContext).toContain("Signal sticker packId: pack-1");
    expect(ctx.UntrustedContext).toContain("Signal stickerId: 7");
  });

  it("injects link previews by default and can disable them", async () => {
    const preview = [
      {
        url: "https://example.com/post",
        title: "Example Post",
        description: "A useful summary",
      },
    ];

    await createEnhancedTestHandler()(
      makeEnhancedReceiveEvent({
        message: "check this",
        previews: preview,
      }),
    );
    expect(requireCapturedCtx().UntrustedContext).toContain(
      "Link preview: Example Post - A useful summary (https://example.com/post)",
    );

    capture.ctx = undefined;
    await createEnhancedTestHandler({ injectLinkPreviews: false })(
      makeEnhancedReceiveEvent({
        message: "check this",
        previews: preview,
      }),
    );

    const disabledCtx = requireCapturedCtx();
    expect(disabledCtx.UntrustedContext ?? []).not.toContain(
      "Link preview: Example Post - A useful summary (https://example.com/post)",
    );
  });

  it("applies text styles and keeps spans aligned after mention expansion", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        message: "\uFFFC check this out",
        mentions: [
          {
            uuid: "550e8400-e29b-41d4-a716-446655440000",
            start: 0,
            length: 1,
          },
        ],
        textStyles: [{ style: "BOLD", start: 2, length: 5 }],
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("@550e8400-e29b-41d4-a716-446655440000 **check** this out");
  });

  it("respects preserveTextStyles false", async () => {
    const handler = createEnhancedTestHandler({ preserveTextStyles: false });

    await handler(
      makeEnhancedReceiveEvent({
        message: "hello world",
        textStyles: [
          { style: "BOLD", start: 0, length: 5 },
          { style: "ITALIC", start: 6, length: 5 },
        ],
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("hello world");
  });

  it("adds shared contacts as untrusted context with a contact placeholder", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        contacts: [
          {
            name: { display: "Jane Doe", given: "Jane", family: "Doe" },
            phone: [{ value: "+15551234567", type: "mobile" }],
            email: [{ value: "jane@example.com", type: "work" }],
            organization: "Acme Corp",
          },
        ],
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("<media:contact>");
    expect(ctx.UntrustedContext).toContain(
      "Shared contact: Jane Doe (+15551234567, jane@example.com, Acme Corp)",
    );
  });

  it("captures edit target timestamps from Signal edit envelopes", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      createSignalReceiveEvent({
        dataMessage: undefined,
        editMessage: {
          targetSentTimestamp: 1234567890,
          dataMessage: {
            message: "edited text",
            attachments: [],
          },
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.EditTargetTimestamp).toBe(1234567890);
    expect(ctx.BodyForCommands).toBe("edited text");
  });

  it("renders poll creation context and placeholder", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        pollCreate: {
          question: "What's for lunch?",
          allowMultiple: false,
          options: ["Pizza", "Sushi", "Tacos"],
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("[Poll] What's for lunch?");
    expect(ctx.UntrustedContext).toContain(
      'Poll: "What\'s for lunch?" — Options: Pizza, Sushi, Tacos',
    );
  });

  it("renders poll vote context without leaking author metadata", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        pollVote: {
          authorNumber: null,
          authorUuid: "abc-123-uuid",
          targetSentTimestamp: 1234567890,
          optionIndexes: [0, 2],
          voteCount: 2,
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("[Poll vote]");
    expect(ctx.UntrustedContext).toContain("Poll vote on #1234567890: option(s) 0, 2");
    expect((ctx.UntrustedContext ?? []).join("\n")).not.toContain("abc-123-uuid");
  });

  it("renders poll termination context", async () => {
    const handler = createEnhancedTestHandler();

    await handler(
      makeEnhancedReceiveEvent({
        pollTerminate: {
          targetSentTimestamp: 1234567890,
        },
      }),
    );

    const ctx = requireCapturedCtx();
    expect(ctx.BodyForCommands).toBe("[Poll closed]");
    expect(ctx.UntrustedContext).toContain("Poll #1234567890 closed");
  });
});
