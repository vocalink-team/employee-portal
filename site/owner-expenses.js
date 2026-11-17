const PAGE_SIZE = 20;
const submittedInJapan = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo'
});

export function setupOwnerExpenses(client, currency) {
  const byId = id => document.getElementById(id);
  const section = byId('owner-expenses');
  const list = byId('owner-expense-list');
  const status = byId('owner-expense-status');
  const pages = byId('owner-expense-pages');
  const refresh = byId('refresh-owner-expenses');
  const previous = byId('owner-expense-previous');
  const next = byId('owner-expense-next');
  const labels = new Map([...byId('category').options].map(option => [option.value, option.textContent]));
  let cursors = [null];
  let currentPage = 0;
  let nextCursor = null;
  let revision = 0;

  function detailRow(expense) {
    const item = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = [
      expense.spent_on, expense.applicant_email || 'メールアドレス未登録',
      labels.get(expense.category) || expense.category, currency.format(expense.amount_yen)
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
    details.append(summary, fields);
    item.append(details);
    return item;
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

  refresh.addEventListener('click', () => load(0, null));
  previous.addEventListener('click', () => {
    if (currentPage > 0) void load(currentPage - 1, cursors[currentPage - 1]);
  });
  next.addEventListener('click', () => {
    if (nextCursor) void load(currentPage + 1, nextCursor);
  });

  return {
    open() {
      section.hidden = false;
      return load(0, null);
    },
    clear() {
      revision++;
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
