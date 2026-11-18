import { expenseStatusLabel, setupOwnerExpenses } from './owner-expenses.js?v=0.1.14';
import { setupAnnouncements } from './announcements.js?v=0.1.13';
import { setupMemberAdmin } from './member-admin.js?v=0.1.7';
import { openPasswordSetup } from './account-setup.js?v=0.1.7';
import { projectUrl, publishableKey } from './portal-config.js';
const byId = id => document.getElementById(id);
const status = byId('portal-status');
const loginForm = byId('login-form');
const expenseForm = byId('expense-form');
const expenseSubmit = byId('expense-submit');
const historyPrevious = byId('history-previous');
const historyNext = byId('history-next');
const HISTORY_PAGE_SIZE = 20;
const dateInJapan = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo'}).format(new Date());
const currency = new Intl.NumberFormat('ja-JP', {style: 'currency', currency: 'JPY'});
let memberId = null;
let pending = null;
let editingExpense = null;
let historyPage = 0;
let historyHasMore = false;
let historyRevision = 0;

if (window.supabase && projectUrl && publishableKey) {
  const client = window.supabase.createClient(projectUrl, publishableKey);
  const admin = setupMemberAdmin(client, projectUrl, publishableKey);
  const announcements = setupAnnouncements(client);
  const ownerExpenses = setupOwnerExpenses(client, currency, () => loadHistory(memberId, historyPage));
  const requests = () => client.from('employee_expense_requests');

  function resetExpenseForm() {
    editingExpense = null;
    expenseForm.reset();
    expenseSubmit.textContent = '申請する';
    byId('expense-edit-cancel').hidden = true;
  }

  function clearWorkspace() {
    admin.clear();
    announcements.clear();
    ownerExpenses.clear();
    memberId = null;
    pending = null;
    byId('workspace').hidden = true;
    byId('account').textContent = '';
    byId('account-roles').textContent = '';
    byId('expense-application').hidden = true;
    byId('expense-manual-title').textContent = '';
    byId('expense-manual-steps').replaceChildren();
    byId('expense-manual-note').textContent = '';
    byId('manual-status').textContent = '';
    historyRevision++;
    historyPage = 0;
    historyHasMore = false;
    byId('history-pages').hidden = true;
    byId('history-list').replaceChildren();
    byId('history-status').textContent = '';
    byId('submit-status').textContent = '';
    resetExpenseForm();
  }

  async function loadManual(userId) {
    const message = byId('manual-status');
    message.textContent = 'マニュアルを読み込んでいます。';
    const {data, error} = await client.from('employee_manual').select('title,steps,note')
      .eq('slug', 'expense-application').maybeSingle();
    if (memberId !== userId) return;
    if (error || !data) {
      message.textContent = 'マニュアルを取得できませんでした。ページを再読み込みしてください。';
      return;
    }
    byId('expense-manual-title').textContent = data.title;
    const steps = data.steps.map(step => {
      const item = document.createElement('li');
      item.textContent = step;
      return item;
    });
    byId('expense-manual-steps').replaceChildren(...steps);
    byId('expense-manual-note').textContent = data.note;
    byId('expense-application').hidden = false;
    message.textContent = '';
  }

  function beginExpenseEdit(row) {
    if (!memberId || expenseSubmit.disabled) return;
    if (pending) {
      byId('history-status').textContent = '先に送信中の申請を確認してください。';
      return;
    }
    editingExpense = row;
    for (const [name, input] of [
      ['spent_on', 'spent-on'], ['category', 'category'], ['amount_yen', 'amount'],
      ['payee', 'payee'], ['purpose', 'purpose'], ['evidence_reference', 'receipt']
    ]) {
      byId(input).value = row[name] ?? '';
    }
    expenseSubmit.textContent = '再申請する';
    byId('expense-edit-cancel').hidden = false;
    byId('submit-status').textContent = '差し戻し理由：' + row.return_reason;
    byId('spent-on').focus();
  }

  byId('expense-edit-cancel').addEventListener('click', () => {
    if (expenseSubmit.disabled) return;
    resetExpenseForm();
    byId('submit-status').textContent = '';
  });

  async function loadHistory(owner, page = 0) {
    if (!owner) return;
    const request = ++historyRevision;
    historyPrevious.disabled = historyNext.disabled = true;
    const offset = page * HISTORY_PAGE_SIZE;
    const {data, error} = await requests()
      .select('id,spent_on,category,amount_yen,payee,purpose,evidence_reference,status,return_reason,status_version')
      .order('submitted_at', {ascending: false}).order('id', {ascending: false})
      .range(offset, offset + HISTORY_PAGE_SIZE);
    if (memberId !== owner || request !== historyRevision) return;
    if (error) {
      byId('history-status').textContent = '申請履歴を取得できませんでした。';
      historyPrevious.disabled = historyPage === 0;
      historyNext.disabled = !historyHasMore;
      return;
    }
    historyPage = page;
    const list = byId('history-list');
    list.replaceChildren();
    historyHasMore = data.length > HISTORY_PAGE_SIZE;
    byId('history-pages').hidden = !page && !historyHasMore;
    historyPrevious.disabled = page === 0;
    historyNext.disabled = !historyHasMore;
    byId('history-status').textContent = data.length ? '' : '申請履歴はありません。';
    const labels = new Map([...byId('category').options].map(option => [option.value, option.textContent]));
    for (const row of data.slice(0, HISTORY_PAGE_SIZE)) {
      const item = document.createElement('li');
      const summary = document.createElement('div');
      summary.textContent = [
        row.spent_on, labels.get(row.category), row.payee, currency.format(row.amount_yen), expenseStatusLabel(row.status)
      ].join(' ／ ');
      item.append(summary);
      if (row.status === 'returned') {
        const reason = document.createElement('p');
        reason.textContent = '差し戻し理由：' + row.return_reason;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '修正して再申請';
        edit.addEventListener('click', () => beginExpenseEdit(row));
        item.append(reason, edit);
      }
      list.append(item);
    }
  }

  historyPrevious.addEventListener('click', () => {
    if (historyPage > 0) void loadHistory(memberId, historyPage - 1);
  });
  historyNext.addEventListener('click', () => {
    if (historyHasMore) void loadHistory(memberId, historyPage + 1);
  });

  async function refresh() {
    byId('retry').hidden = true;
    byId('login').hidden = true;
    clearWorkspace();
    const {data, error} = await client.auth.getUser();
    if (error || !data.user) {
      status.textContent = '従業員ポータルのアカウントでログインしてください。';
      byId('login').hidden = false;
      return;
    }
    const access = await client.rpc('employee_portal_profile');
    if (access.error) {
      status.textContent = '在籍状況を確認できませんでした。時間をおいて再確認してください。';
      byId('retry').hidden = false;
      return;
    }
    if (access.data?.is_active !== true) {
      await client.auth.signOut({scope: 'local'});
      status.textContent = 'このアカウントには従業員ポータルの利用権限がありません。';
      byId('login').hidden = false;
      return;
    }
    memberId = data.user.id;
    byId('account').textContent = data.user.email || 'ログイン中';
    byId('account-roles').textContent = access.data.roles.join(' ／ ');
    byId('spent-on').max = dateInJapan();
    status.textContent = '';
    byId('workspace').hidden = false;
    await Promise.all([
      loadManual(memberId),
      loadHistory(memberId),
      announcements.open(access.data.is_owner),
      access.data.is_owner ? admin.open() : null,
      access.data.is_owner ? ownerExpenses.open() : null
    ]);
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const {error} = await client.auth.signInWithPassword({
        email: byId('email').value.trim(), password: byId('password').value
      });
      byId('password').value = '';
      if (error) status.textContent = 'ログインできませんでした。入力内容を確認してください。';
      else await refresh();
    } finally {
      button.disabled = false;
    }
  });

  byId('retry').addEventListener('click', refresh);
  byId('logout').addEventListener('click', async () => {
    clearWorkspace();
    const {error} = await client.auth.signOut({scope: 'local'});
    status.textContent = error ? 'ログアウトを完了できませんでした。' : 'ログアウトしました。';
    byId(error ? 'retry' : 'login').hidden = false;
  });
  client.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_OUT' || !memberId) return;
    clearWorkspace();
    byId('login').hidden = false;
    status.textContent = 'もう一度ログインしてください。';
  });

  expenseForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = expenseSubmit;
    const message = byId('submit-status');
    const owner = memberId;
    if (!owner || button.disabled) return;
    const values = new FormData(expenseForm);
    const payload = {
      spent_on: values.get('spent_on'),
      category: values.get('category'),
      amount_yen: Number(values.get('amount_yen')),
      payee: values.get('payee').trim(),
      purpose: values.get('purpose').trim(),
      evidence_reference: values.get('evidence_reference').trim() || null
    };
    if (!payload.payee || !payload.purpose || payload.spent_on > dateInJapan()) {
      message.textContent = '支払先・用途・支払日を確認してください。';
      return;
    }
    const signature = JSON.stringify(payload);
    button.disabled = true;
    try {
      if (editingExpense) {
        const {error} = await client.rpc('employee_resubmit_expense', {
          expense_id: editingExpense.id, expected_version: editingExpense.status_version, expense_data: payload
        });
        if (memberId !== owner) return;
        if (error) {
          message.textContent = error.code === '40001'
            ? '申請の状態が変わりました。履歴で現在の状態を確認してください。'
            : '再申請できませんでした。入力内容を確認してください。';
          if (error.code === '40001') await loadHistory(owner, historyPage);
          return;
        }
        resetExpenseForm();
        message.textContent = '再申請を受け付けました。';
        await loadHistory(owner, historyPage);
        return;
      }
      if (pending && pending.signature !== signature) {
        const check = await requests().select('id').eq('id', pending.id).maybeSingle();
        if (memberId !== owner) return;
        if (check.error || check.data) {
          message.textContent = '前回の送信結果を確認するため、入力を元に戻して再送してください。';
          return;
        }
      }
      if (!pending || pending.signature !== signature) pending = {id: crypto.randomUUID(), signature};
      const requestId = pending.id;
      message.textContent = '申請を送信しています。';
      const {error} = await requests().insert({id: requestId, ...payload});
      if (memberId !== owner) return;
      if (error) {
        const check = await requests().select('id').eq('id', requestId).maybeSingle();
        if (memberId !== owner) return;
        if (check.error || !check.data) {
          message.textContent = '申請を確認できませんでした。このまま再送できます。';
          return;
        }
      }
      pending = null;
      expenseForm.reset();
      message.textContent = '申請を受け付けました。';
      await loadHistory(owner);
    } finally {
      button.disabled = false;
    }
  });
  if (!openPasswordSetup(window.supabase.createClient, projectUrl, publishableKey, refresh)) await refresh();
} else {
  status.textContent = projectUrl && publishableKey
    ? 'ログイン画面を読み込めませんでした。ページを再読み込みしてください。'
    : '従業員ポータルは準備中です。';
}
