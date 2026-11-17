const byId = id => document.getElementById(id);

async function requestAccountAction(client, projectUrl, publishableKey, body) {
  const {data} = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {ok: false, result: {code: 'session'}};
  const response = await fetch(projectUrl + '/functions/v1/employee-create-account', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, apikey: publishableKey, 'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  return {ok: response.ok, result: await response.json().catch(() => null)};
}

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
      const {ok, result} = await requestAccountAction(client, projectUrl, publishableKey, {email: email.value.trim()});
      if (current !== revision) return;
      if (!ok || !result?.id) {
        message.textContent = result?.code === 'session' ? 'ログインし直してください。' :
          result?.code === 'exists' ? '既に登録済みです。一覧から選択してください。' :
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

export function setupPasswordReset(client, projectUrl, publishableKey, selectedMember) {
  const section = byId('reset-member');
  const submit = byId('reset-member-submit');
  const panel = byId('reset-member-link-panel');
  const link = byId('reset-member-link');
  const message = byId('reset-member-status');
  let revision = 0;

  function clearLink() {
    revision++;
    panel.hidden = true;
    link.value = '';
    message.textContent = '';
    submit.disabled = false;
  }

  byId('reset-member-copy').addEventListener('click', async () => {
    if (panel.hidden || !link.value) return;
    const current = revision;
    try {
      await navigator.clipboard.writeText(link.value);
      if (current === revision) message.textContent = 'リンクをコピーしました。';
    } catch {
      if (current === revision) {
        link.select();
        message.textContent = '選択したリンクをコピーしてください。';
      }
    }
  });
  byId('reset-member-clear').addEventListener('click', clearLink);

  submit.addEventListener('click', async () => {
    const member = selectedMember();
    if (section.hidden || submit.disabled || !panel.hidden || member?.status !== 'active' || !member.email) return;
    const current = ++revision;
    submit.disabled = true;
    message.textContent = 'リンクを発行しています。';
    try {
      const {ok, result} = await requestAccountAction(client, projectUrl, publishableKey, {
        action: 'reset_password', user_id: member.id
      });
      if (current !== revision) return;
      if (!ok || !result?.reset_url) {
        message.textContent = result?.code === 'session' ? 'ログインし直してください。' :
          'リンクを発行できませんでした。対象の利用状態を確認してください。';
        return;
      }
      link.value = result.reset_url;
      panel.hidden = false;
      message.textContent = member.email + ' の再設定リンクです。本人確認のうえ、個別に共有してください。';
    } catch {
      if (current === revision) message.textContent = 'リンクを取得できませんでした。時間をおいて再発行してください。';
    } finally {
      if (current === revision) submit.disabled = !panel.hidden;
    }
  });

  return {
    show(member) {
      clearLink();
      section.hidden = member?.status !== 'active' || !member.email;
    }
  };
}

export function openPasswordSetup(createClient, projectUrl, publishableKey, done) {
  const tokenParams = new URLSearchParams(location.hash.slice(1));
  const isReset = tokenParams.has('reset');
  if (!isReset && !tokenParams.has('setup')) return false;
  const token = tokenParams.get(isReset ? 'reset' : 'setup');
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
  if (isReset) {
    byId('password-setup-heading').textContent = 'パスワードの再設定';
    submit.textContent = 'パスワードを再設定';
  }
  section.hidden = false;
  byId('portal-status').textContent = '';

  async function close(scope = 'local') {
    await setupClient.auth.signOut({scope}).catch(() => {});
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
          message.textContent = isReset ? '再設定リンクが無効か、期限が切れています。Ownerに再発行を依頼してください。' :
            '初期設定リンクを確認できません。リンクの期限や使用済みかをOwnerに確認してください。';
          return;
        }
        verified = true;
      }
      const {error} = await setupClient.auth.updateUser({password: password.value});
      if (error) {
        message.textContent = 'パスワードを設定できませんでした。入力内容を確認して、もう一度お試しください。';
        return;
      }
      await close(isReset ? 'global' : 'local');
      byId('portal-status').textContent = byId('login').hidden ? 'パスワードを設定しました。' :
        '設定したパスワードでログインしてください。';
    } catch {
      message.textContent = '設定結果を確認できませんでした。時間をおいてお試しください。';
    } finally {
      submit.disabled = false;
    }
  });
  return true;
}
