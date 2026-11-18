const currentMonthInJapan = () =>
  new Intl.DateTimeFormat('sv-SE', {year: 'numeric', month: '2-digit', timeZone: 'Asia/Tokyo'}).format(new Date());
const settlementTime = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Tokyo'
});

function csvCell(value) {
  let cell = String(value ?? '');
  if (/^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(cell)) cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}

function exportCsv(data, month, labels) {
  const rows = [['申請ID', '支払日', '申請者', '費目', '金額（円）', '支払先', '用途', '証憑', '精算日時（日本時間）']];
  for (const row of data) {
    rows.push([row.id, row.spent_on, row.applicant_email, labels.get(row.category) ?? row.category,
      row.amount_yen, row.payee, row.purpose, row.evidence_reference,
      row.settled_at ? settlementTime.format(new Date(row.settled_at)) : '']);
  }
  const blob = new Blob(['\ufeff', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), '\r\n'],
    {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '経費精算-' + month + '.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function setupExpenseReport(client, currency, labels) {
  const month = document.getElementById('expense-report-month');
  const total = document.getElementById('expense-report-total');
  const status = document.getElementById('expense-report-status');
  const download = document.getElementById('expense-report-download');
  let revision = 0;

  async function load(includeRows = false) {
    const selected = month.value;
    const request = ++revision;
    total.textContent = '';
    download.disabled = true;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) {
      status.textContent = '支払月を指定してください。';
      return;
    }

    status.textContent = '経費を集計しています。';
    try {
      const {data, error} = await client.rpc('employee_owner_expense_month', {
        month_start: selected + '-01', include_rows: includeRows
      });
      if (request !== revision) return;
      if (error || !data) throw new Error('Expense report unavailable');
      total.textContent = [
        '申請 ' + data.count + '件',
        '合計 ' + currency.format(data.total_yen),
        '未精算 ' + currency.format(data.unsettled_yen),
        '精算済み ' + currency.format(data.settled_yen)
      ].join(' ／ ');
      status.textContent = data.count ? '' : 'この月の申請はありません。';
      download.disabled = !data.settled_count;
      if (includeRows && data.rows?.length) exportCsv(data.rows, selected, labels);
      else if (includeRows) status.textContent = 'この月の精算済み申請はありません。';
    } catch {
      if (request === revision) status.textContent = '集計またはCSVを取得できませんでした。年月を選び直すか、一覧を更新してください。';
    }
  }

  month.addEventListener('change', () => void load());
  download.addEventListener('click', () => void load(true));
  return {
    open() {
      month.value = currentMonthInJapan();
      return load();
    },
    refresh: load,
    clear() {
      revision++;
      download.disabled = true;
      total.textContent = '';
      status.textContent = '';
    }
  };
}
