(function() {
  const QS = new URLSearchParams(window.location.search);
  const AGENT_LS_KEY = 'agentPortalId';
  const getAgentId = () => QS.get('agentId') || localStorage.getItem(AGENT_LS_KEY) || '';

  function setMsg(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const agentId = getAgentId();

    // Carry agentId on nav links if present
    const intakeAnchor = document.querySelector('a[href="/intake.html"]');
    if (intakeAnchor && agentId) intakeAnchor.href = `/intake.html?agentId=${encodeURIComponent(agentId)}`;

    const uploadBtn = document.getElementById('uploadW9Btn');
    const fileInput = document.getElementById('w9File');
    const msg = document.getElementById('uploadW9Msg');

    uploadBtn?.addEventListener('click', async () => {
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        setMsg(msg, 'Choose your completed W‑9 file first.');
        return;
      }
      const file = fileInput.files[0];
      setMsg(msg, 'Uploading...');

      // Prefer agent-specific upload endpoint
      const endpoint = agentId ? `/api/agents/${encodeURIComponent(agentId)}/w9` : '/api/w9/upload';
      try {
        const fd = new FormData();
        fd.append('w9', file);
        if (agentId) fd.append('agentId', agentId);
        const res = await fetch(endpoint, { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data && data.ok === false)) throw new Error(data.error || 'Upload failed');
        setMsg(msg, 'W‑9 uploaded successfully.');
        // Flag locally that W‑9 is uploaded
        localStorage.setItem(`w9Uploaded:${agentId || 'anon'}`, 'true');
      } catch (err) {
        console.error(err);
        // Local fallback flag
        localStorage.setItem(`w9Uploaded:${agentId || 'anon'}`, 'pending');
        setMsg(msg, 'Saved locally. We will sync your W‑9 when online.');
      }
    });
  });
})();
