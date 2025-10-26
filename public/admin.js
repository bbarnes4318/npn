(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('agents-table-body');

    async function loadAgents() {
      if (!tableBody) return;
      tableBody.innerHTML = '';

      try {
        const res = await fetch('/api/admin/agents');
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed');

        const agents = data.agents || [];
        if (!agents.length) {
          tableBody.innerHTML = '<tr><td colspan="4" class="help">No agents found.</td></tr>';
          return;
        }

        agents.forEach(agent => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}</td>
            <td>${agent.profile?.email || ''}</td>
            <td><span class="status-badge ${agent.progress?.bankingSubmitted ? 'status-complete' : 'status-pending'}">${agent.progress?.bankingSubmitted ? 'Complete' : 'Pending'}</span></td>
            <td>
              <button class="button primary" data-action="view" data-id="${agent.id}">View Details</button>
              <button class="button secondary" data-action="zip" data-id="${agent.id}">Download PDFs</button>
            </td>
          `;
          tableBody.appendChild(tr);
        });
      } catch (e) {
        tableBody.innerHTML = '<tr><td colspan="4" class="help">Failed to load agents.</td></tr>';
      }
    }

    tableBody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id || !action) return;

      if (action === 'zip') {
        try {
          const res = await fetch(`/api/admin/agents/${encodeURIComponent(id)}/documents/zip`);
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
          alert('Could not download ZIP.');
        }
      }
    });

    loadAgents();
  });
})();
