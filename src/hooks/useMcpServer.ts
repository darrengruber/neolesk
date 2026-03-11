import { useCallback, useEffect, useRef, useState } from 'react';
import { McpServer } from '../mcp/server';
import type { McpServerCallbacks, McpDiagramState } from '../mcp/server';
import { createTunnel } from '../mcp/tunnel';
import type { McpTunnelHandle, TunnelState } from '../mcp/tunnel';
import { encode } from '../kroki/coder';

const DEFAULT_RELAY_URL = 'https://neolesk-mcp-relay.YOUR_SUBDOMAIN.workers.dev';

export interface UseMcpServerOptions {
    diagramType: string;
    diagramText: string;
    filetype: string;
    renderUrl: string;
    onSetDiagram: (patch: Partial<Pick<McpDiagramState, 'diagramType' | 'diagramText'>>) => void;
}

export interface UseMcpServerResult {
    tunnelState: TunnelState;
    start: (relayUrl?: string) => void;
    stop: () => void;
    isActive: boolean;
}

const createSvgUrl = (renderUrl: string, diagramType: string, diagramText: string): string => {
    const encoded = encode(diagramText);
    return `${renderUrl.replace(/\/*$/, '')}/${diagramType}/svg/${encoded}`;
};

export const useMcpServer = (options: UseMcpServerOptions): UseMcpServerResult => {
    const [tunnelState, setTunnelState] = useState<TunnelState>({
        status: 'disconnected',
        sessionId: null,
        sseUrl: null,
        error: null,
    });

    const serverRef = useRef<McpServer | null>(null);
    const tunnelRef = useRef<McpTunnelHandle | null>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;

    // Keep server callbacks up to date with latest state
    useEffect(() => {
        if (serverRef.current) {
            serverRef.current.updateCallbacks(createCallbacks());
        }
    });

    function createCallbacks(): McpServerCallbacks {
        return {
            getState: () => ({
                diagramType: optionsRef.current.diagramType,
                diagramText: optionsRef.current.diagramText,
                filetype: optionsRef.current.filetype,
                renderUrl: optionsRef.current.renderUrl,
            }),
            setState: (patch) => {
                optionsRef.current.onSetDiagram(patch);
            },
            fetchSvg: async (diagramType, diagramText, renderUrl) => {
                const url = createSvgUrl(renderUrl, diagramType, diagramText);
                const res = await fetch(url);
                if (!res.ok) {
                    throw new Error(`Kroki returned HTTP ${res.status}`);
                }
                return res.text();
            },
        };
    }

    const start = useCallback((relayUrl?: string) => {
        // Clean up existing
        if (tunnelRef.current) {
            tunnelRef.current.disconnect();
        }

        const server = new McpServer(createCallbacks());
        serverRef.current = server;

        const tunnel = createTunnel(server, { onStateChange: setTunnelState });
        tunnelRef.current = tunnel;

        tunnel.connect(relayUrl || DEFAULT_RELAY_URL);
    }, []);

    const stop = useCallback(() => {
        if (tunnelRef.current) {
            tunnelRef.current.disconnect();
            tunnelRef.current = null;
        }
        serverRef.current = null;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (tunnelRef.current) {
                tunnelRef.current.disconnect();
            }
        };
    }, []);

    return {
        tunnelState,
        start,
        stop,
        isActive: tunnelState.status === 'connected' || tunnelState.status === 'connecting' || tunnelState.status === 'reconnecting',
    };
};
