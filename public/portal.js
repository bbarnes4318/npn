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
    // If user already has an agent portal ID saved, take them straight to their dashboard
    try {
      const existing = localStorage.getItem(LS_KEY);
      if (existing) {
        location.replace(`/dashboard.html?agentId=${encodeURIComponent(existing)}`);
        return; // do not render the form
      }
    } catch {}

    const emailForm = document.getElementById('emailForm');
    const emailMsg = document.getElementById('emailMsg');
    const resumeBtn = document.getElementById('resumeBtn');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const resumeInput = document.getElementById('resumeAgentId');

    // Prefill email if previously typed and stored
    try {
      const last = localStorage.getItem('lastEmail');
      if (last) {
        const emailInput = emailForm?.querySelector('input[name="email"]');
        if (emailInput) emailInput.value = last;
      }
    } catch {}

    emailForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      emailMsg.textContent = 'Checking...';
      try {
        const fd = new FormData(emailForm);
        const email = String(fd.get('email') || '').trim();
        try { localStorage.setItem('lastEmail', email); } catch {}
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
