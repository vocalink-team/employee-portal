const byId = id => document.getElementById(id);
const pageSize = 10;
const fields = 'id,title,body,published,published_at,updated_at';
const mentionFields = 'discord_user_ids,discord_role_ids';
const discordMessageUrl = /^https:\/\/discord\.com\/channels\/[0-9]{17,20}\/[0-9]{17,20}\/[0-9]{17,20}$/;
const deliveryLabels = {
  pending: '送信待ち',
  sent: '送信済み',
  failed: '失敗',
  not_configured: '未送信（Webhook未設定）',
  skipped_existing: '通知対象外',
  withdrawn: '未送信（公開取り下げ）'
};

function discordIds(value, type) {
  const pattern = type === 'role'
    ? /^(?:([1-9]\d{16,19})|<@&([1-9]\d{16,19})>)$/
    : /^(?:([1-9]\d{16,19})|<@!?([1-9]\d{16,19})>)$/;
  const ids = new Set();
  for (const token of value.trim().split(/[\s,、]+/).filter(Boolean)) {
    const match = token.match(pattern);
    if (!match) throw new Error('Invalid Discord mention');
    ids.add(match[1] ?? match[2]);
    if (ids.size > 10) throw new Error('Too many Discord mentions');
  }
  return [...ids];
}

const formatDate = new Intl.DateTimeFormat('ja-JP', {dateStyle: 'medium', timeZone: 'Asia/Tokyo'});

function createAnnouncementId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function setupAnnouncements(client) {
  const admin = byId('announcement-admin');
  const form = byId('announcement-form');
  const title = byId('announcement-title');
  const body = byId('announcement-body');
  const users = byId('announcement-discord-users');
  const roles = byId('announcement-discord-roles');
  const message = byId('announcement-status');
  const list = byId('announcement-list');
  const back = byId('announcement-back');
  const reload = byId('announcement-delivery-reload');
  const linkedId = new URLSearchParams(location.search).get('announcement');
  const isAnnouncementId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(linkedId ?? '');
  const previous = byId('announcement-prev');
  const next = byId('announcement-next');
  const articles = () => client.from('employee_announcements');
  let edit = null;
  let page = 0;
  let owner = false;
  let saving = false;
  let revision = 0;
  let linkedFocused = false;

  function closeEditor() {
    form.hidden = true;
    form.reset();
    edit = null;
  }

  function editArticle(article, trigger) {
    if (!owner || saving) return;
    edit = article ?? {};
    byId('announcement-form-heading').textContent = article ? 'お知らせを編集' : 'お知らせを作成';
    title.value = article?.title ?? '';
    body.value = article?.body ?? '';
    users.value = (article?.discord_user_ids ?? []).join(', ');
    roles.value = (article?.discord_role_ids ?? []).join(', ');
    form.querySelector('[value="draft"]').textContent = article?.published ? '公開を取り下げる' : '下書き保存';
    form.querySelector('[value="publish"]').textContent = article?.published ? '公開内容を更新' : '公開する';
    form.hidden = false;
    byId('announcement-cancel').onclick = () => {
      closeEditor();
      (trigger.isConnected ? trigger : byId('announcement-new')).focus();
    };
    title.focus();
  }

  function showArticle(article) {
    const item = document.createElement('article');
    const heading = document.createElement('h3');
    heading.textContent = article.title;
    const stamp = document.createElement('p');
    stamp.textContent = article.published ? formatDate.format(new Date(article.published_at)) : '下書き';
    const content = document.createElement('p');
    content.className = 'announcement-body';
    content.textContent = article.body;
    item.append(heading, stamp, content);
    let delivery;
    if (owner) {
      delivery = document.createElement('p');
      delivery.textContent = 'Discord配信状況を確認しています。';
      item.append(delivery);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '編集';
      button.setAttribute('aria-label', article.title + 'を編集');
      button.addEventListener('click', () => editArticle(article, button));
      item.append(button);
    }
    list.append(item);
    return {heading, delivery};
  }

  async function load(savedMessage = '') {
    const request = ++revision;
    const start = page * pageSize;
    message.textContent = 'お知らせを読み込んでいます。';
    list.replaceChildren();
    back.hidden = linkedId === null;
    byId('announcement-pages').hidden = true;
    if (linkedId !== null && !isAnnouncementId) {
      message.textContent = 'お知らせが見つからないか、公開されていません。';
      return;
    }

    const query = articles().select(owner ? fields + ',' + mentionFields : fields);
    const {data, error} = await (linkedId === null
      ? query.order('published_at', {ascending: false, nullsFirst: false})
        .order('updated_at', {ascending: false}).order('id', {ascending: true}).range(start, start + pageSize)
      : query.eq('id', linkedId).eq('published', true));
    if (request !== revision) return;
    if (error) {
      message.textContent = savedMessage ?
        savedMessage + ' 一覧を更新できませんでした。' : 'お知らせを取得できませんでした。';
      return;
    }
    if (!data.length && page > 0 && linkedId === null) {
      page--;
      return load(savedMessage);
    }
    message.textContent = savedMessage || (data.length ? '' :
      linkedId === null ? 'お知らせはありません。' : 'お知らせが見つからないか、公開されていません。');

    const displayed = data.slice(0, pageSize);
    const elements = displayed.map(showArticle);
    if (linkedId !== null && elements.length && !linkedFocused) {
      linkedFocused = true;
      elements[0].heading.tabIndex = -1;
      elements[0].heading.focus();
    }
    previous.disabled = page === 0;
    next.disabled = data.length <= pageSize;
    byId('announcement-pages').hidden = linkedId !== null || (previous.disabled && next.disabled);

    if (!owner || !displayed.length) return;
    let result;
    try {
      result = await client.rpc('employee_announcement_delivery_status', {
        announcement_ids: displayed.map(article => article.id)
      });
    } catch {
      result = {error: true};
    }
    if (request !== revision) return;
    const deliveries = new Map((result.data ?? []).map(row => [row.announcement_id, row]));
    displayed.forEach((article, index) => {
      const row = deliveries.get(article.id);
      const delivery = elements[index].delivery;
      delivery.textContent = 'Discord配信：' + (result.error ? '取得できませんでした' :
        deliveryLabels[row?.state] ?? (article.published ? '配信記録なし' : '未公開'));
      if (discordMessageUrl.test(row?.discord_message_url ?? '')) {
        const link = document.createElement('a');
        link.href = row.discord_message_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Discord投稿を開く';
        delivery.append(' ／ ', link);
      }
    });
  }

  function go(delta) {
    if (saving || !form.hidden) return;
    page += delta;
    return load();
  }

  byId('announcement-new').addEventListener('click', event => {
    if (form.hidden) editArticle(null, event.currentTarget);
    else title.focus();
  });
  reload.addEventListener('click', () => {
    if (!saving && form.hidden) void load();
  });
  previous.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!owner || saving || form.hidden || !edit) return;
    const payload = {title: title.value.trim(), body: body.value.trim(), published: event.submitter?.value === 'publish'};
    if (!payload.title || !payload.body) {
      message.textContent = 'タイトルと本文を入力してください。';
      return;
    }
    try {
      payload.discord_user_ids = discordIds(users.value, 'user');
      payload.discord_role_ids = discordIds(roles.value, 'role');
    } catch {
      message.textContent = 'DiscordのユーザーIDとロールIDを確認してください。各欄に10件まで指定できます。';
      return;
    }
    saving = true;
    const request = ++revision;
    const controls = [...form.elements];
    for (const control of controls) control.disabled = true;
    message.textContent = '保存しています。';
    let savedMessage;
    try {
      edit.id ??= createAnnouncementId();
      const query = edit.updated_at ?
        articles().update(payload).eq('id', edit.id).eq('updated_at', edit.updated_at) :
        articles().insert({id: edit.id, ...payload});
      let {data, error} = await query.select('id').maybeSingle();
      if (request !== revision) return;
      if (error || !data) {
        const check = await articles().select('id,title,body,published,' + mentionFields).eq('id', edit.id).maybeSingle();
        if (request !== revision) return;
        data = check.data;
        if (check.error || !data || Object.entries(payload).some(([key, value]) => (
          Array.isArray(value) ? JSON.stringify(data[key]) !== JSON.stringify(value) : data[key] !== value
        ))) {
          message.textContent = !error && data ? '別の操作で内容が更新されました。ページを再読み込みして確認してください。' :
            '保存を確認できませんでした。入力内容を確認して、もう一度お試しください。';
          return;
        }
      }
      savedMessage = payload.published ? 'お知らせを公開しました。' :
        edit.published ? '公開を取り下げました。' : '下書きを保存しました。';
      closeEditor();
      byId('announcement-new').focus();
    } catch {
      if (request === revision) {
        message.textContent = '保存を確認できませんでした。入力内容を保持したまま再試行できます。';
      }
      return;
    } finally {
      if (request === revision) {
        saving = false;
        for (const control of controls) control.disabled = false;
      }
    }
    page = 0;
    await load(savedMessage);
  });

  return {
    open(isOwner) {
      owner = isOwner;
      admin.hidden = !owner;
      return load();
    },
    clear() {
      revision++;
      owner = false;
      saving = false;
      page = 0;
      linkedFocused = false;
      back.hidden = true;
      admin.hidden = true;
      closeEditor();
      for (const control of form.elements) control.disabled = false;
      list.replaceChildren();
      message.textContent = '';
      byId('announcement-pages').hidden = true;
    }
  };
}
