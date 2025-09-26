(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const listBtn = document.getElementById('listBtn');
    const zipBtn = document.getElementById('downloadZipBtn');
    const input = document.getElementById('agentIdInput');
    const emailInput = document.getElementById('emailInput');
    const findBtn = document.getElementById('findByEmailBtn');
    const list = document.getElementById('docsList');
    const msg = document.getElementById('adminMsg');

    function setMsg(text) { if (msg) msg.textContent = text; }

    listBtn?.addEventListener('click', async () => {
      const id = input.value.trim();
      if (!id) { setMsg('Enter an Agent ID.'); return; }
      setMsg('Loading...');
      list.innerHTML = '';
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(id)}/documents/list`);
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

    findBtn?.addEventListener('click', async () => {
      const email = (emailInput?.value || '').trim();
      if (!email) { setMsg('Enter an email to search.'); return; }
      setMsg('Searching...');
      try {
        const res = await fetch(`/api/agents/find?email=${encodeURIComponent(email)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false || !data.agent?.id) throw new Error(data.error || 'Not found');
        input.value = data.agent.id;
        setMsg(`Found Agent ID: ${data.agent.id}`);
      } catch (e) {
        console.error(e);
        setMsg('Agent not found for that email.');
      }
    });
      } catch (e) {
        console.error(e);
        setMsg('Could not list documents.');
      }
    });

    zipBtn?.addEventListener('click', async () => {
      const id = input.value.trim();
      if (!id) { setMsg('Enter an Agent ID.'); return; }
      try {
        const a = document.createElement('a');
        a.href = `/api/agents/${encodeURIComponent(id)}/documents/zip`;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        setMsg('Could not download ZIP.');
      }
    });
  });
})();
