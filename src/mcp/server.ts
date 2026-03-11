/**
 * Browser-side MCP server implementing JSON-RPC 2.0.
 *
 * Exposes diagram editing tools that MCP clients (like Claude Desktop)
 * can call to interact with the Neolesk editor in real-time.
 */

import { diagramTypes } from '../state';
import { encode } from '../kroki/coder';

// --- JSON-RPC types ---

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

// --- MCP Server ---

export interface McpDiagramState {
    diagramType: string;
    diagramText: string;
    filetype: string;
    renderUrl: string;
}

export interface McpServerCallbacks {
    getState: () => McpDiagramState;
    setState: (patch: Partial<Pick<McpDiagramState, 'diagramType' | 'diagramText'>>) => void;
    fetchSvg: (diagramType: string, diagramText: string, renderUrl: string) => Promise<string>;
}

const SERVER_INFO = {
    name: 'neolesk',
    version: '1.0.0',
};

const CAPABILITIES = {
    tools: {},
};

const TOOLS = [
    {
        name: 'get_diagram',
        description: 'Get the current diagram code, type, and render URL from the Neolesk editor.',
        inputSchema: {
            type: 'object' as const,
            properties: {},
        },
    },
    {
        name: 'set_diagram',
        description: 'Update the diagram in the Neolesk editor. You can change the diagram text, the diagram type, or both. The editor will update in real-time.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                diagramType: {
                    type: 'string',
                    description: 'The diagram type to switch to (e.g. "plantuml", "mermaid", "graphviz", "d2"). Use list_diagram_types to see all available types.',
                },
                diagramText: {
                    type: 'string',
                    description: 'The diagram source code to set in the editor.',
                },
            },
        },
    },
    {
        name: 'render_diagram',
        description: 'Render diagram text to SVG without changing the editor. Returns the raw SVG markup.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                diagramType: {
                    type: 'string',
                    description: 'The diagram type (e.g. "plantuml", "mermaid").',
                },
                diagramText: {
                    type: 'string',
                    description: 'The diagram source code to render.',
                },
            },
            required: ['diagramType', 'diagramText'],
        },
    },
    {
        name: 'list_diagram_types',
        description: 'List all available diagram types supported by Neolesk/Kroki.',
        inputSchema: {
            type: 'object' as const,
            properties: {},
        },
    },
];

export class McpServer {
    private callbacks: McpServerCallbacks;
    private initialized = false;

    constructor(callbacks: McpServerCallbacks) {
        this.callbacks = callbacks;
    }

    updateCallbacks(callbacks: McpServerCallbacks): void {
        this.callbacks = callbacks;
    }

    async handleMessage(raw: string): Promise<string | null> {
        let message: JsonRpcRequest;
        try {
            message = JSON.parse(raw);
        } catch {
            return JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            });
        }

        if (!message.method) {
            return null;
        }

        // Notifications (no id) don't get responses
        if (message.id === undefined || message.id === null) {
            this.handleNotification(message as JsonRpcNotification);
            return null;
        }

        const response = await this.handleRequest(message);
        return JSON.stringify(response);
    }

    private handleNotification(notification: JsonRpcNotification): void {
        // Handle known notifications silently
        if (notification.method === 'notifications/initialized') {
            this.initialized = true;
        }
    }

    private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { id, method, params } = request;

        switch (method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id: id!,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: CAPABILITIES,
                        serverInfo: SERVER_INFO,
                    },
                };

            case 'tools/list':
                return {
                    jsonrpc: '2.0',
                    id: id!,
                    result: { tools: TOOLS },
                };

            case 'tools/call':
                return this.handleToolCall(id!, params as { name: string; arguments?: Record<string, unknown> });

            case 'ping':
                return { jsonrpc: '2.0', id: id!, result: {} };

            default:
                return {
                    jsonrpc: '2.0',
                    id: id!,
                    error: { code: -32601, message: `Method not found: ${method}` },
                };
        }
    }

    private async handleToolCall(
        id: string | number,
        params: { name: string; arguments?: Record<string, unknown> },
    ): Promise<JsonRpcResponse> {
        const { name, arguments: args = {} } = params;

        try {
            switch (name) {
                case 'get_diagram': {
                    const state = this.callbacks.getState();
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [{
                                type: 'text',
                                text: JSON.stringify({
                                    diagramType: state.diagramType,
                                    diagramText: state.diagramText,
                                    renderUrl: state.renderUrl,
                                }, null, 2),
                            }],
                        },
                    };
                }

                case 'set_diagram': {
                    const patch: Partial<Pick<McpDiagramState, 'diagramType' | 'diagramText'>> = {};
                    if (typeof args.diagramType === 'string') {
                        if (!diagramTypes[args.diagramType]) {
                            return {
                                jsonrpc: '2.0',
                                id,
                                result: {
                                    content: [{
                                        type: 'text',
                                        text: `Unknown diagram type: ${args.diagramType}. Use list_diagram_types to see available types.`,
                                    }],
                                    isError: true,
                                },
                            };
                        }
                        patch.diagramType = args.diagramType;
                    }
                    if (typeof args.diagramText === 'string') {
                        patch.diagramText = args.diagramText;
                    }
                    if (Object.keys(patch).length === 0) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [{ type: 'text', text: 'No changes specified. Provide diagramType and/or diagramText.' }],
                                isError: true,
                            },
                        };
                    }

                    this.callbacks.setState(patch);
                    const newState = this.callbacks.getState();
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [{
                                type: 'text',
                                text: `Diagram updated. Type: ${newState.diagramType}, text length: ${newState.diagramText.length} chars.`,
                            }],
                        },
                    };
                }

                case 'render_diagram': {
                    const dtype = args.diagramType as string;
                    const dtext = args.diagramText as string;
                    if (!dtype || !dtext) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [{ type: 'text', text: 'diagramType and diagramText are required.' }],
                                isError: true,
                            },
                        };
                    }
                    if (!diagramTypes[dtype]) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [{ type: 'text', text: `Unknown diagram type: ${dtype}` }],
                                isError: true,
                            },
                        };
                    }
                    const state = this.callbacks.getState();
                    const svg = await this.callbacks.fetchSvg(dtype, dtext, state.renderUrl);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [{ type: 'text', text: svg }],
                        },
                    };
                }

                case 'list_diagram_types': {
                    const types = Object.entries(diagramTypes).map(([key, info]) => ({
                        id: key,
                        name: info.name,
                        language: info.language,
                    }));
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [{
                                type: 'text',
                                text: JSON.stringify(types, null, 2),
                            }],
                        },
                    };
                }

                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32601, message: `Unknown tool: ${name}` },
                    };
            }
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
                    isError: true,
                },
            };
        }
    }
}
