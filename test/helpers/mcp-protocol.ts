import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
  type McpServer,
} from '@modelcontextprotocol/server';

export interface PendingProtocolRequest {
  readonly id: number;
  readonly response: Promise<Record<string, unknown>>;
}

export interface McpProtocolSession {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  startRequest(method: string, params: Record<string, unknown>): Promise<PendingProtocolRequest>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  hasResponse(requestId: number): boolean;
  close(): Promise<void>;
}

export async function createMcpProtocolSession(
  server: McpServer,
  clientName = 'api-intel-test',
): Promise<McpProtocolSession> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let requestId = 0;
  const responses = new Set<number>();
  const pending = new Map<
    number,
    {
      readonly resolve: (value: Record<string, unknown>) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  clientTransport.onmessage = (message) => {
    if (!('id' in message) || typeof message.id !== 'number') return;
    responses.add(message.id);
    const completion = pending.get(message.id);
    if (completion === undefined) return;
    pending.delete(message.id);
    if ('error' in message) completion.reject(new Error(message.error.message));
    else if ('result' in message) completion.resolve(message.result as Record<string, unknown>);
    else completion.reject(new Error('Received a non-response message for a pending request.'));
  };
  await clientTransport.start();
  await server.connect(serverTransport);

  const session: McpProtocolSession = {
    async startRequest(method, params) {
      requestId += 1;
      const id = requestId;
      const response = new Promise<Record<string, unknown>>((resolveResponse, rejectResponse) => {
        pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
      });
      await clientTransport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage);
      return { id, response };
    },
    async request(method, params) {
      return (await session.startRequest(method, params)).response;
    },
    async notify(method, params = {}) {
      await clientTransport.send({ jsonrpc: '2.0', method, params } as JSONRPCMessage);
    },
    hasResponse: (id) => responses.has(id),
    close: () => clientTransport.close(),
  };
  await session.request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: clientName, version: '1.0.0' },
  });
  await session.notify('notifications/initialized');
  return session;
}
