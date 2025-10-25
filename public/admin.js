(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const listBtn = document.getElementById('listBtn');
    const zipBtn = document.getElementById('downloadZipBtn');
    const openW9Btn = document.getElementById('openW9Btn');
    const input = document.getElementById('agentIdInput');
    const emailInput = document.getElementById('emailInput');
    const findBtn = document.getElementById('findByEmailBtn');
    const passwordInput = document.getElementById('adminPasswordInput');
    const list = document.getElementById('docsList');
    const msg = document.getElementById('adminMsg');
    const refreshBtn = document.getElementById('refreshAgentsBtn');
    const recentMsg = document.getElementById('recentMsg');
    const recentInput = document.getElementById('recentSearchInput');
    const tableBody = document.getElementById('agentsTableBody');
    
    // Submissions elements
    const submissionsTableBody = document.getElementById('submissionsTableBody');
    const refreshSubmissionsBtn = document.getElementById('refreshSubmissionsBtn');
    const submissionTypeFilter = document.getElementById('submissionTypeFilter');
    const submissionSearchInput = document.getElementById('submissionSearchInput');
    const submissionsMsg = document.getElementById('submissionsMsg');

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

    async function loadAgents() {
      if (!tableBody) return;
      tableBody.innerHTML = '';
      recentMsg.textContent = 'Loading...';
      try {
        const q = (recentInput?.value || '').trim();
        const url = q ? `/api/admin/agents?q=${encodeURIComponent(q)}&limit=100` : '/api/admin/agents?limit=100';
        const res = await fetch(url, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed');
        const agents = data.agents || [];
        if (!agents.length) {
          tableBody.innerHTML = '<tr><td colspan="6" class="help">No agents found.</td></tr>';
          recentMsg.textContent = '';
          return;
        }
        const fmt = (s) => {
          try { return new Date(s).toLocaleString(); } catch { return s || ''; }
        };
        agents.forEach(a => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${fmt(a.createdAt)}</td>
            <td><code>${a.id}</code></td>
            <td>${(a.profile?.firstName || '')} ${(a.profile?.lastName || '')}</td>
            <td>${a.profile?.email || ''}</td>
            <td>
              ${a.progress?.packetSubmitted ? 'Packet ✓' : 'Packet —'} | 
              ${a.progress?.w9Submitted ? 'W‑9 ✓' : 'W‑9 —'}
            </td>
            <td>
              <button class="button ghost" data-action="copy" data-id="${a.id}">Copy ID</button>
              <button class="button ghost" data-action="openw9" data-id="${a.id}">Open W‑9</button>
              <button class="button secondary" data-action="zip" data-id="${a.id}">ZIP</button>
              <button class="button" data-action="list" data-id="${a.id}">List</button>
            </td>
          `;
          tableBody.appendChild(tr);
        });
        recentMsg.textContent = `${agents.length} result(s)`;
      } catch (e) {
        recentMsg.textContent = 'Failed to load agents.';
      }
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
          const link = document.createElement('a');
          link.href = `/api/admin/agents/${encodeURIComponent(id)}/documents/download/${encodeURIComponent(f.name)}`;
          link.textContent = f.name;
          link.download = f.name;
          link.style.marginRight = '10px';
          li.appendChild(link);
          
          const downloadBtn = document.createElement('button');
          downloadBtn.textContent = 'Download';
          downloadBtn.className = 'button ghost';
          downloadBtn.style.marginLeft = '10px';
          downloadBtn.onclick = () => {
            window.open(link.href, '_blank');
          };
          li.appendChild(downloadBtn);
          
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

    // Open W-9 (PDF) in a new tab for viewing/printing
    openW9Btn?.addEventListener('click', async () => {
      const id = input.value.trim();
      if (!id) { setMsg('Enter an Agent ID.'); return; }
      setMsg('Opening W-9...');
      try {
        const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/w9.pdf`, {
          headers: authHeaders()
        });
        if (!res.ok) {
          if (res.status === 404) { setMsg('No W-9 found for this agent.'); return; }
          throw new Error('Failed');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        // Revoke later to keep the tab working
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setMsg('');
      } catch (e) {
        setMsg('Could not open W-9.');
      }
    });

    // Recent list controls
    refreshBtn?.addEventListener('click', loadAgents);
    recentInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAgents(); });
    tableBody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id || !action) return;
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(id); btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy ID', 1000); } catch {}
      } else if (action === 'openw9') {
        // Reuse existing handler logic but for row ID
        try {
          const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/w9.pdf`, { headers: authHeaders() });
          if (!res.ok) { alert('No W‑9 found.'); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch { alert('Could not open W‑9.'); }
      } else if (action === 'zip') {
        try {
          const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/zip`, { headers: authHeaders() });
          if (!res.ok) throw new Error('Failed');
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `agent_${id}_packet.zip`; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
        } catch { alert('Could not download ZIP.'); }
      } else if (action === 'list') {
        input.value = id; listBtn.click();
      }
    });

    // Load submissions
    async function loadSubmissions() {
      if (!submissionsTableBody) return;
      submissionsTableBody.innerHTML = '';
      submissionsMsg.textContent = 'Loading...';
      try {
        const res = await fetch('/api/admin/submissions', { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed');
        const submissions = data.submissions || [];
        
        // Filter by type
        const typeFilter = submissionTypeFilter?.value || '';
        let filteredSubmissions = submissions;
        if (typeFilter) {
          filteredSubmissions = submissions.filter(s => s.type === typeFilter);
        }
        
        // Filter by search
        const searchTerm = (submissionSearchInput?.value || '').toLowerCase();
        if (searchTerm) {
          filteredSubmissions = filteredSubmissions.filter(s => {
            const data = s.data;
            const searchableText = [
              s.id,
              data.contact?.firstName || '',
              data.contact?.lastName || '',
              data.contact?.email || '',
              data.name || '',
              data.businessName || '',
              data.accountHolderName || '',
              data.bankName || ''
            ].join(' ').toLowerCase();
            return searchableText.includes(searchTerm);
          });
        }
        
        if (!filteredSubmissions.length) {
          submissionsTableBody.innerHTML = '<tr><td colspan="6" class="help">No submissions found.</td></tr>';
          submissionsMsg.textContent = '';
          return;
        }
        
        const fmt = (s) => {
          try { return new Date(s).toLocaleString(); } catch { return s || ''; }
        };
        
        filteredSubmissions.forEach(s => {
          const tr = document.createElement('tr');
          const data = s.data;
          let nameEmail = '';
          let details = '';
          
          // Extract name and email based on submission type
          if (s.type === 'intake') {
            nameEmail = `${data.contact?.firstName || ''} ${data.contact?.lastName || ''}`.trim() || data.contact?.email || '';
            details = `NPN: ${data.npn || 'N/A'} | States: ${(data.statesLicensed || []).join(', ') || 'None'}`;
          } else if (s.type === 'w9') {
            nameEmail = data.name || data.businessName || '';
            details = `Tax: ${data.taxClassification || 'N/A'} | SSN: ${data.tin?.ssn ? '***-**-' + data.tin.ssn.slice(-4) : 'N/A'}`;
          } else if (s.type === 'banking') {
            nameEmail = data.accountHolderName || '';
            details = `${data.bankName || 'N/A'} | ${data.accountType || 'N/A'} | ${data.paymentMethod || 'N/A'}`;
          } else if (s.type === 'packet') {
            nameEmail = data.payload?.full_name || 'Packet Submission';
            details = `Producer Agreement: ${data.payload?.signatureDataUrl ? 'Signed' : 'Not Signed'}`;
          }
          
          tr.innerHTML = `
            <td>${fmt(s.receivedAt)}</td>
            <td><span class="chip ${s.type}">${s.type.toUpperCase()}</span></td>
            <td><code>${s.id}</code></td>
            <td>${nameEmail}</td>
            <td>${details}</td>
            <td>
              <button class="button ghost" data-action="view-submission" data-id="${s.id}">View</button>
              <button class="button ghost" data-action="copy-submission-id" data-id="${s.id}">Copy ID</button>
            </td>
          `;
          submissionsTableBody.appendChild(tr);
        });
        
        submissionsMsg.textContent = `${filteredSubmissions.length} submission(s)`;
      } catch (e) {
        submissionsMsg.textContent = 'Failed to load submissions.';
      }
    }
    
    // Submissions event handlers
    refreshSubmissionsBtn?.addEventListener('click', loadSubmissions);
    submissionTypeFilter?.addEventListener('change', loadSubmissions);
    submissionSearchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSubmissions(); });
    submissionSearchInput?.addEventListener('input', () => {
      // Debounce search
      clearTimeout(submissionSearchInput.searchTimeout);
      submissionSearchInput.searchTimeout = setTimeout(loadSubmissions, 300);
    });
    
    // Handle submission table clicks
    submissionsTableBody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id || !action) return;
      
      if (action === 'copy-submission-id') {
        try { 
          await navigator.clipboard.writeText(id); 
          btn.textContent = 'Copied!'; 
          setTimeout(() => btn.textContent = 'Copy ID', 1000); 
        } catch {}
      } else if (action === 'view-submission') {
        try {
          const res = await fetch(`/api/admin/submissions/${encodeURIComponent(id)}`, { headers: authHeaders() });
          const data = await res.json();
          if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed');
          
          // Create a modal or new window to display submission details
          const submission = data.submission;
          const details = JSON.stringify(submission.data, null, 2);
          const newWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes');
          newWindow.document.write(`
            <html>
              <head><title>Submission ${id}</title></head>
              <body style="font-family: monospace; padding: 20px;">
                <h2>Submission Details: ${id}</h2>
                <p><strong>Type:</strong> ${submission.type}</p>
                <p><strong>Received:</strong> ${new Date(submission.receivedAt).toLocaleString()}</p>
                <h3>Data:</h3>
                <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow: auto;">${details}</pre>
              </body>
            </html>
          `);
        } catch (e) {
          alert('Could not load submission details.');
        }
      }
    });

    // Auto-load on page open
    loadAgents();
    loadSubmissions();
  });
})();
