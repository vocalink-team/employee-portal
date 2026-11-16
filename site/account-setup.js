const byId = id => document.getElementById(id);

export function setupAccountCreation(client, projectUrl, publishableKey, reloadMembers) {
  const form = byId('create-member-form');
  const email = byId('create-member-email');
  const button = byId('create-member-submit');
  const message = byId('create-member-status');
  const linkPanel = byId('create-member-link-panel');
  const link = byId('create-member-link');
  let revision = 0;

  function clearLink() {
    link.value = '';
    linkPanel.hidden = true;
  }

  byId('create-member-copy').addEventListener('click', async () => {
    if (linkPanel.hidden || !link.value) return;
    const current = revision;
    try {
      await navigator.clipboard.writeText(link.value);
      if (current === revision) message.textContent = '初期設定リンクをコピーしました。';
    } catch {
      if (current === revision) {
        link.select();
        message.textContent = '選択したリンクをコピーしてください。';
      }
    }
  });
  byId('create-member-clear').addEventListener('click', () => {
    clearLink();
    message.textContent = '';
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (byId('member-admin').hidden || button.disabled || !linkPanel.hidden) return;
    const current = ++revision;
    button.disabled = true;
    message.textContent = 'アカウントを作成しています。';
    try {
      const auth = await client.auth.getSession();
      if (current !== revision) return;
      const token = auth.data.session?.access_token;
      if (!token) {
        message.textContent = 'ログインし直してください。';
        return;
      }
      const response = await fetch(projectUrl + '/functions/v1/employee-create-account', {
        method: 'POST',
        headers: {Authorization: 'Bearer ' + token, apikey: publishableKey, 'Content-Type': 'application/json'},
        body: JSON.stringify({email: email.value.trim()})
      });
      if (current !== revision) return;
      const result = await response.json().catch(() => null);
      if (current !== revision) return;
      if (!response.ok || !result?.id) {
        message.textContent = result?.code === 'exists' ? '既に登録済みです。一覧から選択してください。' :
          'アカウントを作成できませんでした。一覧と入力内容を確認してください。';
        return;
      }
      form.reset();
      if (result.setup_url) {
        link.value = result.setup_url;
        linkPanel.hidden = false;
        message.textContent = 'アカウントを作成しました。リンクを本人に個別共有し、下の一覧から利用状態とロールを設定してください。';
      } else {
        message.textContent = 'アカウントは作成済みです。初期設定リンクを作成できなかったため、Supabaseのユーザー管理から設定してください。';
      }
      await reloadMembers(result.id);
    } catch {
      if (current === revision) message.textContent = '作成結果を確認できませんでした。一覧を更新して確認してください。';
    } finally {
      if (current === revision) button.disabled = false;
    }
  });

  return {
    clear() {
      revision++;
      form.reset();
      clearLink();
      message.textContent = '';
      button.disabled = false;
    }
  };
}

export function openPasswordSetup(createClient, projectUrl, publishableKey, done) {
  const tokenParams = new URLSearchParams(location.hash.slice(1));
  if (!tokenParams.has('setup')) return false;
  const token = tokenParams.get('setup');
  history.replaceState(history.state, '', location.pathname + location.search);

  const section = byId('password-setup');
  const form = byId('password-setup-form');
  const submit = byId('password-setup-submit');
  const password = byId('password-setup-value');
  const repeat = byId('password-setup-repeat');
  const message = byId('password-setup-status');
  const setupClient = createClient(projectUrl, publishableKey, {
    auth: {storageKey: 'vocalink-employee-setup', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}
  });
  let verified = false;
  section.hidden = false;
  byId('portal-status').textContent = '';

  async function close() {
    await setupClient.auth.signOut({scope: 'local'}).catch(() => {});
    form.reset();
    section.hidden = true;
    await done();
  }

  byId('password-setup-cancel').addEventListener('click', () => {
    if (!submit.disabled) void close();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    if (password.value !== repeat.value) {
      message.textContent = '確認用パスワードが一致しません。';
      return;
    }
    submit.disabled = true;
    message.textContent = '設定しています。';
    try {
      if (!verified) {
        const {data, error} = await setupClient.auth.verifyOtp({token_hash: token, type: 'recovery'});
        if (error || !data.session) {
          message.textContent = '初期設定リンクを確認できません。リンクの期限や使用済みかをOwnerに確認してください。';
          return;
        }
        verified = true;
      }
      const {error} = await setupClient.auth.updateUser({password: password.value});
      if (error) {
        message.textContent = 'パスワードを設定できませんでした。入力内容を確認して、もう一度お試しください。';
        return;
      }
      await close();
      if (!byId('login').hidden) byId('portal-status').textContent = '設定したパスワードでログインしてください。';
    } catch {
      message.textContent = '設定結果を確認できませんでした。時間をおいてお試しください。';
    } finally {
      submit.disabled = false;
    }
  });
  return true;
}
