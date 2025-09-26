(function() {
  const LS_KEY = 'agentPortalId';

  async function api(path, options = {}) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  }

  function goDashboard(id) {
    localStorage.setItem(LS_KEY, id);
    location.href = `/dashboard.html?agentId=${encodeURIComponent(id)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const emailForm = document.getElementById('emailForm');
    const emailMsg = document.getElementById('emailMsg');
    const resumeBtn = document.getElementById('resumeBtn');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const resumeInput = document.getElementById('resumeAgentId');

    emailForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      emailMsg.textContent = 'Checking...';
      try {
        const fd = new FormData(emailForm);
        const email = String(fd.get('email') || '').trim();
        // Try to find by email
        try {
          const { agent } = await api(`/api/agents/find?email=${encodeURIComponent(email)}`);
          goDashboard(agent.id);
          return;
        } catch {}
        // Create new agent
        const { agent } = await api('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        goDashboard(agent.id);
      } catch (err) {
        emailMsg.textContent = 'Could not continue. Try again.';
      }
    });

    resumeBtn?.addEventListener('click', async () => {
      const id = resumeInput.value.trim();
      if (!id) return;
      try {
        await api(`/api/agents/${id}`);
        goDashboard(id);
      } catch (e) {
        alert('Agent ID not found.');
      }
    });

    copyLinkBtn?.addEventListener('click', async () => {
      const id = resumeInput.value.trim();
      if (!id) return;
      await navigator.clipboard.writeText(`${location.origin}/dashboard.html?agentId=${id}`);
      copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => copyLinkBtn.textContent = 'Copy portal link', 1200);
    });
  });
})();
