import { setupExpenseReport } from './expense-report.js?v=0.1.14';

const PAGE_SIZE = 20;

const statusLabels = {
  submitted: '申請済み',
  approved: '承認済み',
  returned: '差し戻し',
  settled: '精算済み'
};
export const expenseStatusLabel = status => statusLabels[status] ?? '状態不明';
const submittedInJapan = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo'
});

export function setupOwnerExpenses(client, currency, onChanged) {
  const byId = id => document.getElementById(id);
  const section = byId('owner-expenses');
  const list = byId('owner-expense-list');
  const status = byId('owner-expense-status');
  const pages = byId('owner-expense-pages');
  const refresh = byId('refresh-owner-expenses');
  const previous = byId('owner-expense-previous');
  const next = byId('owner-expense-next');
  const labels = new Map([...byId('category').options].map(option => [option.value, option.textContent]));
  const report = setupExpenseReport(client, currency, labels);
  let cursors = [null];
  let currentPage = 0;
  let nextCursor = null;
  let revision = 0;
  let saving = false;

  function detailRow(expense) {
    const item = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = [
      expense.spent_on, expense.applicant_email || 'メールアドレス未登録',
      labels.get(expense.category) || expense.category, currency.format(expense.amount_yen),
      expenseStatusLabel(expense.status)
    ].join(' ／ ');

    const fields = document.createElement('dl');
    for (const [label, value] of [
      ['申請日時', submittedInJapan.format(new Date(expense.submitted_at))],
      ['支払先', expense.payee],
      ['用途', expense.purpose],
      ['証憑のファイル名・管理番号', expense.evidence_reference || '記載なし']
    ]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      fields.append(term, description);
    }
    if (expense.return_reason) {
      const term = document.createElement('dt');
      term.textContent = '差し戻し理由';
      const reason = document.createElement('dd');
      reason.textContent = expense.return_reason;
      fields.append(term, reason);
    }
    details.append(summary, fields, historyPanel(expense.id));
    if (expense.status === 'submitted' || expense.status === 'approved') {
      details.append(reviewControls(expense, item));
    }
    item.append(details);
    return item;
  }

  function historyPanel(expenseId) {
    const panel = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = '変更履歴';
    const result = document.createElement('div');
    panel.append(heading, result);
    let loading = false;
    let loaded = false;
    panel.addEventListener('toggle', async () => {
      if (!panel.open || loading || loaded) return;
      loading = true;
      result.textContent = '変更履歴を読み込んでいます。';
      try {
        const {data, error} = await client.rpc('employee_owner_expense_history', {target_expense: expenseId});
        if (!panel.isConnected || section.hidden) return;
        if (error || !data) throw new Error('Expense history unavailable');
        result.textContent = data.length ? '' : '記録された変更はありません。';
        for (const entry of data) {
          const line = document.createElement('p');
          line.textContent = [
            submittedInJapan.format(new Date(entry.changed_at)),
            entry.actor_email || '操作者の記録なし',
            expenseStatusLabel(entry.previous_status) + ' → ' + expenseStatusLabel(entry.new_status),
            entry.return_reason
          ].filter(Boolean).join(' ／ ');
          result.append(line);
        }
        loaded = true;
      } catch {
        if (panel.isConnected) result.textContent = '変更履歴を取得できませんでした。閉じてから開き直してください。';
      } finally {
        loading = false;
      }
    });
    return panel;
  }

  function reviewControls(expense, item) {
    const form = document.createElement('form');
    const actions = document.createElement('div');
    actions.className = 'announcement-actions';
    const buttons = expense.status === 'submitted'
      ? [['approved', '承認する'], ['returned', '差し戻す']]
      : [['settled', '精算済みにする']];
    const reason = document.createElement('textarea');
    if (expense.status === 'submitted') {
      const label = document.createElement('label');
      label.textContent = '差し戻し理由（差し戻す場合は必須）';
      reason.maxLength = 500;
      label.append(reason);
      form.append(label);
    }
    for (const [value, label] of buttons) {
      const button = document.createElement('button');
      button.type = 'submit';
      button.value = value;
      button.textContent = label;
      actions.append(button);
    }
    const result = document.createElement('p');
    result.setAttribute('role', 'status');
    form.append(actions, result);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const nextStatus = event.submitter?.value;
      if (!nextStatus || saving || refresh.disabled || section.hidden) return;
      if (nextStatus === 'returned' && !reason.value.trim()) {
        result.textContent = '差し戻し理由を入力してください。';
        reason.focus();
        return;
      }

      const request = revision;
      saving = true;
      refresh.disabled = previous.disabled = next.disabled = true;
      for (const button of actions.children) button.disabled = true;
      reason.disabled = true;
      result.textContent = '保存しています。';
      try {
        const {data, error} = await client.rpc('employee_owner_change_expense_status', {
          expense_id: expense.id, expected_version: expense.status_version,
          next_status: nextStatus, reason: nextStatus === 'returned' ? reason.value.trim() : null
        });
        if (request !== revision) return;
        if (error || !data) {
          result.textContent = error?.code === '40001'
            ? '申請が更新されています。一覧を更新してください。'
            : '状態を保存できませんでした。一覧を更新して確認してください。';
          return;
        }
        const updated = detailRow({...expense, ...data});
        updated.firstElementChild.open = true;
        item.replaceWith(updated);
        status.textContent = '申請を「' + expenseStatusLabel(data.status) + '」に更新しました。';
        updated.querySelector('summary')?.focus();
        void onChanged();
        void report.refresh();
      } catch {
        if (request === revision) result.textContent = '保存結果を確認できませんでした。一覧を更新して確認してください。';
      } finally {
        if (request === revision) {
          saving = false;
          refresh.disabled = false;
          previous.disabled = currentPage === 0;
          next.disabled = !nextCursor;
          reason.disabled = false;
          for (const button of actions.children) button.disabled = false;
        }
      }
    });
    return form;
  }

  async function load(page, cursor) {
    if (section.hidden || refresh.disabled) return;
    const request = ++revision;
    refresh.disabled = previous.disabled = next.disabled = true;
    status.textContent = '経費申請を読み込んでいます。';
    try {
      const {data, error} = await client.rpc('employee_owner_expenses', {
        before_submitted_at: cursor?.submitted_at ?? null,
        before_expense_id: cursor?.id ?? null
      });
      if (request !== revision) return;
      if (error || !Array.isArray(data)) {
        throw new Error('Expense review unavailable');
      }
      const rows = data.slice(0, PAGE_SIZE);
      list.replaceChildren(...rows.map(detailRow));
      cursors = cursors.slice(0, page);
      cursors[page] = cursor;
      currentPage = page;
      nextCursor = data.length > PAGE_SIZE ? rows.at(-1) : null;
      pages.hidden = currentPage === 0 && !nextCursor;
      status.textContent = rows.length ? '' : '経費申請はありません。';
    } catch {
      if (request === revision) status.textContent = '経費申請を取得できませんでした。一覧を更新してください。';
    } finally {
      if (request === revision) {
        refresh.disabled = false;
        previous.disabled = currentPage === 0;
        next.disabled = !nextCursor;
      }
    }
  }

  refresh.addEventListener('click', () => {
    void load(0, null);
    void report.refresh();
  });
  previous.addEventListener('click', () => {
    if (currentPage > 0) void load(currentPage - 1, cursors[currentPage - 1]);
  });
  next.addEventListener('click', () => {
    if (nextCursor) void load(currentPage + 1, nextCursor);
  });

  return {
    open() {
      section.hidden = false;
      return Promise.all([load(0, null), report.open()]);
    },
    clear() {
      report.clear();
      revision++;
      saving = false;
      section.hidden = true;
      list.replaceChildren();
      status.textContent = '';
      pages.hidden = true;
      refresh.disabled = false;
      previous.disabled = next.disabled = true;
      cursors = [null];
      currentPage = 0;
      nextCursor = null;
    }
  };
}
