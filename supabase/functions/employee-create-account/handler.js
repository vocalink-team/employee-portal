const portalOrigin = 'https://portal.vocalink-team.com';
const headers = {
  'access-control-allow-origin': portalOrigin,
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
  'vary': 'Origin'
};

function passwordLink(token, purpose) {
  const link = new URL('/', portalOrigin);
  link.hash = new URLSearchParams({[purpose]: token}).toString();
  return link.href;
}

export function accountHandler({ identifyOwner, createAccount, issueSetupToken, findResetTarget }) {
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
      if (body?.action === 'reset_password') {
        const target = body.user_id;
        if (typeof target !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(target)) {
          return reply(400, {code: 'member'});
        }
        const email = await findResetTarget(bearer, target);
        if (!email) return reply(404, {code: 'member'});
        const token = await issueSetupToken(email, target);
        return token ? reply(200, {reset_url: passwordLink(token, 'reset')}) :
          reply(502, {code: 'link_unavailable'});
      }
      if (body?.action != null) return reply(400, {code: 'action'});
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply(400, {code: 'email'});
      }
      const {id, code} = await createAccount(email);
      if (!id) return reply(code === 'exists' ? 409 : 502, {code});
      const token = await issueSetupToken(email, id).catch(() => null);
      if (!token) return reply(201, {id, code: 'link_unavailable'});
      return reply(201, {id, setup_url: passwordLink(token, 'setup')});
    } catch {
      return reply(503, {code: 'unavailable'});
    }
  };
}
