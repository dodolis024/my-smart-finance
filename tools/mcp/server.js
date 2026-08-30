#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SmfError } from '../core/errors.js';
import { TOOLS, TOOL_MAP } from './tools.js';

/**
 * MCP server（stdio）。
 *
 * 只走標準輸入輸出，不開任何網路埠——這台 server 能存取使用者的完整帳本，
 * 不該有任何被遠端連上的可能。認證沿用 `finance login` 存下的 session。
 *
 * 注意：stdout 是 MCP 協定通道，任何除錯輸出都必須寫到 stderr，否則會弄壞協定。
 */
export async function startMcpServer() {
  const server = new Server(
    { name: 'my-smart-finance', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOL_MAP.get(request.params.name);

    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'UNKNOWN_TOOL', message: `沒有名為 ${request.params.name} 的工具` }) }],
      };
    }

    try {
      const result = await tool.handler(request.params.arguments || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      // SmfError 帶著 hint（例如可用的分類清單），原樣回給 agent 讓它能自己修正後重試
      const payload =
        error instanceof SmfError
          ? error.toJSON()
          : { error: 'UNEXPECTED', message: error?.message || '未預期的錯誤' };

      // 未登入時 core 的提示是寫給終端機使用者看的（「執行 finance login」），
      // 但這裡的對象是 agent，它能自己呼叫 login 工具，不必把人趕去開終端機
      if (payload.error === 'NOT_AUTHENTICATED' && request.params.name !== 'login') {
        payload.hint = '請呼叫 login 工具完成登入，它會在使用者的瀏覽器開啟授權頁面。';
      }

      return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    }
  });

  await server.connect(new StdioServerTransport());
  return server;
}

// 直接執行（node mcp/server.js）時自動啟動，讓填絕對路徑的舊設定仍然可用；
// 透過 npm 安裝的人則是走 `finance mcp`，不必知道檔案放在哪
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startMcpServer();
}
