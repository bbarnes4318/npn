(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const listBtn = document.getElementById('listBtn');
    const zipBtn = document.getElementById('downloadZipBtn');
    const input = document.getElementById('agentIdInput');
    const emailInput = document.getElementById('emailInput');
    const findBtn = document.getElementById('findByEmailBtn');
    const passwordInput = document.getElementById('adminPasswordInput');
    const list = document.getElementById('docsList');
    const msg = document.getElementById('adminMsg');

    function setMsg(text) { if (msg) msg.textContent = text; }

    // Persist password locally for convenience
    try {
      const saved = localStorage.getItem('ADMIN_PASSWORD');
      if (saved && passwordInput && !passwordInput.value) passwordInput.value = saved;
      passwordInput?.addEventListener('change', () => {
        localStorage.setItem('ADMIN_PASSWORD', passwordInput.value || '');
      });
    } catch {}

    function authHeaders() {
      const h = {};
      const p = passwordInput?.value?.trim();
      if (p) h['X-Admin-Password'] = p;
      return h;
    }

    listBtn?.addEventListener('click', async () => {
      const id = input.value.trim();
      if (!id) { setMsg('Enter an Agent ID.'); return; }
      setMsg('Loading...');
      list.innerHTML = '';
      try {
        const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/list`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed to list');
        setMsg('');
        if (!data.files || !data.files.length) {
          list.innerHTML = '<li>No documents found.</li>';
          return;
        }
        data.files.forEach(f => {
          const li = document.createElement('li');
          li.textContent = f.name;
          list.appendChild(li);
        });
      } catch (e) {
        console.error(e);
        setMsg('Could not list documents.');
      }
    });

    findBtn?.addEventListener('click', async () => {
      const email = (emailInput?.value || '').trim();
      if (!email) { setMsg('Enter an email to search.'); return; }
      setMsg('Searching...');
      try {
        const res = await fetch(`/api/admin/agents/find?email=${encodeURIComponent(email)}`, {
          headers: authHeaders()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false || !data.agent?.id) throw new Error(data.error || 'Not found');
        input.value = data.agent.id;
        setMsg(`Found Agent ID: ${data.agent.id}`);
      } catch (e) {
        console.error(e);
        setMsg('Agent not found for that email.');
      }
    });

    zipBtn?.addEventListener('click', async () => {
      const id = input.value.trim();
      if (!id) { setMsg('Enter an Agent ID.'); return; }
      try {
        const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/zip`, {
          headers: authHeaders()
        });
        if (!res.ok) throw new Error('Failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent_${id}_packet.zip`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
      } catch (e) {
        setMsg('Could not download ZIP.');
      }
    });
  });
})();
