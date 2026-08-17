#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ZhenxiReleaseClient, ZhenxiReleaseError } from "./zhenxi-ai-release-client.mjs";

export function createZhenxiReleaseMcpServer(env = process.env) {
  const client = new ZhenxiReleaseClient(env);
  const server = new McpServer(
    { name: "smart-kefu-zhenxi-release", version: "0.1.0" },
    {
      instructions:
        "This MCP server is bundled with Smart Kefu and connects only to the installed Zhenxi AI release on 127.0.0.1:31870-31879. Check health before generation. Generation may consume credits. Never retry an unknown outcome automatically and never expose credentials.",
    },
  );

  server.registerTool(
    "zhenxi_health",
    {
      title: "检查臻希 AI 成品软件",
      description: "检查智能客服连接的是本机臻希 AI 成品软件，而不是开发服务器；不返回密钥。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => toolCall(() => client.health(), (result) =>
      `臻希 AI 成品软件可访问：${result.baseUrl}，图片模型 ${result.ai.imageModel || "未配置"}。`,
    ),
  );

  server.registerTool(
    "zhenxi_generate_copy",
    {
      title: "调用臻希 AI 成品软件生成文案",
      description:
        "使用臻希 AI 成品软件当前登录会话，按照成品 0.1.43 的真实 /api/local-generate 流程生成可用于图片阶段的文案。可能消耗文案积分；结果未知时禁止自动重试。",
      inputSchema: {
        brief: z.string().min(4).max(8000),
        count: z.number().int().min(1).max(6).default(1),
        request_id: z.string().regex(/^[A-Za-z0-9_.:-]{8,80}$/).optional(),
        module: z.enum(["poster_copy", "xiaohongshu", "detail_page", "video_script"]).default("poster_copy"),
        ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/).default("1:1"),
        card_type: z.string().max(120).default("空白模板"),
        template_group_key: z.string().max(120).default("blank"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ brief, count, request_id, module, ratio, card_type, template_group_key }) =>
      toolCall(
        () => client.generateCopy({
          brief,
          count,
          requestId: request_id,
          module,
          ratio,
          cardType: card_type,
          templateGroupKey: template_group_key,
        }),
        (result) => `臻希 AI 成品软件文案生成完成：${result.prompts.length} 条。`,
      ),
  );

  server.registerTool(
    "zhenxi_generate_images",
    {
      title: "调用臻希 AI 成品软件出图",
      description:
        "通过智能客服内置 MCP 调用本机臻希 AI 成品软件。仅在已确认出图时调用，可能消耗积分；严格保留请求数量，结果未知时禁止自动重试。",
      inputSchema: {
        prompt: z.string().min(4).max(8000),
        count: z.number().int().min(1).max(6),
        size: z.string().regex(/^\d{2,5}x\d{2,5}$/).default("1024x1024"),
        ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/).default("1:1"),
        reference_paths: z.array(z.string().min(1)).min(1).max(10),
        request_id: z.string().regex(/^[A-Za-z0-9_.:-]{8,80}$/).optional(),
        card_type: z.string().max(120).default("空白模板"),
        template_group_key: z.string().max(120).default("blank"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ prompt, count, size, ratio, reference_paths, request_id, card_type, template_group_key }) =>
      toolCall(
        () => client.generateImages({
          prompt,
          count,
          size,
          ratio,
          referencePaths: reference_paths,
          requestId: request_id,
          cardType: card_type,
          templateGroupKey: template_group_key,
        }),
        (result) => `臻希 AI 成品软件出图完成：请求 ${result.requestedCount} 张，成功 ${result.successCount} 张。`,
      ),
  );

  server.registerTool(
    "zhenxi_generate_design",
    {
      title: "臻希 AI 先生成文案再生成图片",
      description:
        "严格执行臻希 AI 成品软件的真实工作流：先用当前登录会话生成文案，确认是真实模型结果后，再把该文案和参考图交给正式图片接口。任一阶段结果未知时停止且不自动重试。",
      inputSchema: {
        brief: z.string().min(4).max(8000),
        count: z.number().int().min(1).max(6),
        size: z.string().regex(/^\d{2,5}x\d{2,5}$/).default("1024x1024"),
        ratio: z.string().regex(/^\d{1,2}:\d{1,2}$/).default("1:1"),
        reference_paths: z.array(z.string().min(1)).min(1).max(10),
        request_id: z.string().regex(/^[A-Za-z0-9_.:-]{8,80}$/).optional(),
        copy_module: z.enum(["poster_copy", "xiaohongshu", "detail_page"]).default("poster_copy"),
        card_type: z.string().max(120).default("空白模板"),
        template_group_key: z.string().max(120).default("blank"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ brief, count, size, ratio, reference_paths, request_id, copy_module, card_type, template_group_key }) =>
      toolCall(
        () => client.generateDesign({
          prompt: brief,
          count,
          size,
          ratio,
          referencePaths: reference_paths,
          requestId: request_id,
          copyModule: copy_module,
          cardType: card_type,
          templateGroupKey: template_group_key,
        }),
        (result) => `臻希 AI 已先生成文案，再完成图片：请求 ${result.requestedCount} 张，成功 ${result.successCount} 张。`,
      ),
  );

  return server;
}

async function toolCall(operation, summarize) {
  try {
    const result = await operation();
    return {
      structuredContent: { result },
      content: [{ type: "text", text: summarize(result) }],
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      isError: true,
      structuredContent: { result: { ok: false, error: normalized } },
      content: [{ type: "text", text: normalized.message }],
    };
  }
}

function normalizeError(error) {
  if (error instanceof ZhenxiReleaseError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status || null,
      outcomeUnknown: Boolean(error.outcomeUnknown),
    };
  }
  return {
    code: "ZHENXI_MCP_INTERNAL_ERROR",
    message: "智能客服内置的臻希 AI MCP 发生未预期错误。",
    status: null,
    outcomeUnknown: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createZhenxiReleaseMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
