import { setupAccountCreation, setupPasswordReset } from './account-setup.js?v=0.1.7';

const byId = id => document.getElementById(id);

export function setupMemberAdmin(client, projectUrl, publishableKey) {
  const section = byId('member-admin');
  const form = byId('member-form');
  const memberSelect = byId('member-select');
  const accessSelect = byId('access-select');
  const options = byId('role-options');
  const details = byId('role-details');
  const message = byId('member-status');
  const reload = byId('reload-members');
  const save = form.querySelector('button');
  let members = new Map();
  let revision = 0;

  function showMember() {
    const member = members.get(memberSelect.value);
    form.hidden = !member;
    passwordReset.show(member);
    if (!member) return;
    accessSelect.value = member.status || 'suspended';
    for (const input of options.querySelectorAll('input')) {
      input.checked = member.role_keys.includes(input.value);
    }
  }

  async function loadMembers(selected, saved = false) {
    const request = ++revision;
    form.hidden = true;
    passwordReset.show();
    reload.disabled = true;
    message.textContent = '一覧を読み込んでいます。';
    const {data, error} = await client.rpc('employee_owner_directory');
    if (request !== revision) return;
    reload.disabled = false;
    if (error) {
      message.textContent = saved ? '変更は保存しました。一覧を再取得できませんでした。' :
        '一覧を取得できませんでした。再ログインするか、一覧を更新してください。';
      return;
    }
    members = new Map(data.members.map(member => [member.id, member]));
    memberSelect.replaceChildren();
    for (const member of members.values()) {
      const label = member.email || member.id;
      memberSelect.add(new Option(member.status ? label : label + '（未登録）', member.id));
    }
    if (members.has(selected)) memberSelect.value = selected;

    options.replaceChildren();
    const groups = new Map();
    for (const role of data.roles) {
      if (!groups.has(role.department)) {
        const group = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = role.department;
        group.append(legend);
        options.append(group);
        groups.set(role.department, group);
      }
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = role.key;
      label.append(checkbox, role.label);
      groups.get(role.department).append(label);
    }
    message.textContent = saved ? '変更を保存しました。' :
      members.size ? '' : '管理対象のアカウントがまだありません。';
    showMember();
  }

  const creation = setupAccountCreation(client, projectUrl, publishableKey, loadMembers);
  const passwordReset = setupPasswordReset(client, projectUrl, publishableKey, () => members.get(memberSelect.value));

  memberSelect.addEventListener('change', () => {
    message.textContent = '';
    showMember();
  });
  reload.addEventListener('click', () => loadMembers(memberSelect.value));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled || section.hidden || form.hidden) return;
    const selected = memberSelect.value;
    const request = revision;
    memberSelect.disabled = true;
    save.disabled = true;
    reload.disabled = true;
    message.textContent = '保存しています。';
    const {error} = await client.rpc('employee_owner_save_member', {
      target_user: selected,
      new_status: accessSelect.value,
      role_keys: Array.from(options.querySelectorAll('input:checked'), input => input.value)
    });
    if (request !== revision) return;
    memberSelect.disabled = false;
    save.disabled = false;
    reload.disabled = false;
    if (error) {
      message.textContent = '変更を保存できませんでした。利用状態とロールを確認してください。';
      return;
    }
    await loadMembers(selected, true);
  });

  return {
    open() {
      section.hidden = false;
      return loadMembers();
    },
    clear() {
      revision++;
      section.hidden = true;
      form.hidden = true;
      details.open = false;
      byId('create-member-details').open = false;
      creation.clear();
      passwordReset.show();
      members.clear();
      options.replaceChildren();
      memberSelect.replaceChildren();
      form.reset();
      memberSelect.disabled = false;
      save.disabled = false;
      reload.disabled = false;
      message.textContent = '';
    }
  };
}
