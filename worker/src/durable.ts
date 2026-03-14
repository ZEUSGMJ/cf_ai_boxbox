import { DurableObject } from 'cloudflare:workers';
import {
  capHistory,
  coerceStoredHistory,
  type HistoryMessage,
  validateHistoryWritePayload,
} from './durable-validation';

export class SessionMemory extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/history') {
      const stored = await this.ctx.storage.get<unknown>('history');
      const history = coerceStoredHistory(stored);
      return Response.json(history);
    }

    if (request.method === 'POST' && url.pathname === '/history') {
      let incoming: unknown;
      try {
        incoming = await request.json();
      } catch {
        return new Response('Invalid JSON', { status: 400 });
      }

      const validation = validateHistoryWritePayload(incoming);
      if (!validation.ok) {
        return new Response(validation.error, { status: 400 });
      }

      const stored = await this.ctx.storage.get<unknown>('history');
      const existing = coerceStoredHistory(stored);
      const updated: HistoryMessage[] = capHistory([...existing, ...validation.messages]);

      await this.ctx.storage.put('history', updated);
      return Response.json(updated);
    }

    if (request.method === 'DELETE' && url.pathname === '/history') {
      await this.ctx.storage.delete('history');
      return new Response(null, { status: 204 });
    }

    return new Response('Not found', { status: 404 });
  }
}
