import { connect } from 'cloudflare:sockets';
import { handleStart } from './handler.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/start') return handleStart(request, env, { connect });
    return env.ASSETS.fetch(request);
  },
};
