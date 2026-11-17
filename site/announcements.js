const byId = id => document.getElementById(id);
const pageSize = 10;
const fields = 'id,title,body,published,published_at,updated_at';
const mentionFields = 'discord_user_ids,discord_role_ids';

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
  const previous = byId('announcement-prev');
  const next = byId('announcement-next');
  const articles = () => client.from('employee_announcements');
  let edit = null;
  let page = 0;
  let owner = false;
  let saving = false;
  let revision = 0;

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
    if (owner) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '編集';
      button.setAttribute('aria-label', article.title + 'を編集');
      button.addEventListener('click', () => editArticle(article, button));
      item.append(button);
    }
    list.append(item);
  }

  async function load(savedMessage = '') {
    const request = ++revision;
    const start = page * pageSize;
    message.textContent = 'お知らせを読み込んでいます。';
    list.replaceChildren();
    byId('announcement-pages').hidden = true;
    const {data, error} = await articles().select(owner ? fields + ',' + mentionFields : fields)
      .order('published_at', {ascending: false, nullsFirst: false})
      .order('updated_at', {ascending: false})
      .order('id', {ascending: true})
      .range(start, start + pageSize);
    if (request !== revision) return;
    if (error) {
      message.textContent = savedMessage ?
        savedMessage + ' 一覧を更新できませんでした。' : 'お知らせを取得できませんでした。';
      return;
    }
    if (!data.length && page > 0) {
      page--;
      return load(savedMessage);
    }
    message.textContent = savedMessage || (data.length ? '' : 'お知らせはありません。');
    for (const article of data.slice(0, pageSize)) showArticle(article);
    previous.disabled = page === 0;
    next.disabled = data.length <= pageSize;
    byId('announcement-pages').hidden = previous.disabled && next.disabled;
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
      admin.hidden = true;
      closeEditor();
      for (const control of form.elements) control.disabled = false;
      list.replaceChildren();
      message.textContent = '';
      byId('announcement-pages').hidden = true;
    }
  };
}
