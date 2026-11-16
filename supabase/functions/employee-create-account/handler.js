const portalOrigin = 'https://portal.vocalink-team.com';
const headers = {
  'access-control-allow-origin': portalOrigin,
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
  'vary': 'Origin'
};

export function accountHandler({ identifyOwner, createAccount, issueSetupToken }) {
  const reply = (status, body) => Response.json(body, { status, headers });
  return async request => {
    if (request.headers.get('origin') !== portalOrigin) return reply(403, {code: 'forbidden'});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'POST') return reply(405, {code: 'method'});
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return reply(401, {code: 'session'});
    try {
      const owner = await identifyOwner(bearer);
      if (owner === null) return reply(401, {code: 'session'});
      if (!owner) return reply(403, {code: 'forbidden'});
      const body = await request.json().catch(() => null);
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply(400, {code: 'email'});
      }
      const {id, code} = await createAccount(email);
      if (!id) return reply(code === 'exists' ? 409 : 502, {code});
      const token = await issueSetupToken(email).catch(() => null);
      if (!token) return reply(201, {id, code: 'link_unavailable'});
      const setup = new URL('/', portalOrigin);
      setup.hash = new URLSearchParams({setup: token}).toString();
      return reply(201, {id, setup_url: setup.href});
    } catch {
      return reply(503, {code: 'unavailable'});
    }
  };
}
