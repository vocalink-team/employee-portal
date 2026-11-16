import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { accountHandler } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const auth = {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false};
const service = createClient(url, serviceKey, {auth});

Deno.serve(accountHandler({
  async identifyOwner(token: string) {
    const client = createClient(url, anonKey, {auth, global: {headers: {Authorization: 'Bearer ' + token}}});
    const identity = await client.auth.getUser(token);
    if (identity.error || !identity.data.user) return null;
    const profile = await client.rpc('employee_portal_profile');
    if (profile.error) throw new Error('Profile unavailable');
    return profile.data?.is_active === true && profile.data?.is_owner === true;
  },
  async createAccount(email: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    // The recipient chooses the actual password through the setup link.
    const password = 'aA0!' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const {data, error} = await service.auth.admin.createUser({email, password, email_confirm: true});
    return {
      id: data?.user?.id ?? null,
      code: error?.code === 'email_exists' || error?.code === 'user_already_exists' ? 'exists' : 'create_failed'
    };
  },
  async issueSetupToken(email: string) {
    const {data, error} = await service.auth.admin.generateLink({type: 'recovery', email});
    return error ? null : data.properties.hashed_token;
  }
}));
