import { handleWorkerFetch, type Env } from './chat-handler';
import { SessionMemory } from './durable';

export { SessionMemory };
export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleWorkerFetch(request, env);
  },
};
