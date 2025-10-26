(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('agents-table-body');
    const searchInput = document.getElementById('search');
    const statusFilter = document.getElementById('status-filter');
    const modal = document.getElementById('agent-modal');
    const modalContent = document.getElementById('modal-content');
    const closeModal = document.getElementById('modal-close');

    let allAgents = [];

    async function loadAgents() {
      if (!tableBody) return;
      tableBody.innerHTML = '<tr><td colspan="4" class="help">Loading...</td></tr>';

      try {
        const res = await fetch('/api/admin/agents');
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Failed');

        allAgents = data.agents || [];
        renderAgents();
      } catch (e) {
        tableBody.innerHTML = '<tr><td colspan="4" class="help">Failed to load agents.</td></tr>';
      }
    }

    function renderAgents() {
      const searchTerm = searchInput.value.toLowerCase();
      const status = statusFilter.value;

      const filteredAgents = allAgents.filter(agent => {
        const name = `${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}`.toLowerCase();
        const email = (agent.profile?.email || '').toLowerCase();
        const matchesSearch = name.includes(searchTerm) || email.includes(searchTerm);

        const isComplete = agent.progress?.bankingSubmitted;
        const matchesStatus = (status === 'complete' && isComplete) || (status === 'pending' && !isComplete) || status === 'all';

        return matchesSearch && matchesStatus;
      });

      tableBody.innerHTML = '';
      if (!filteredAgents.length) {
        tableBody.innerHTML = '<tr><td colspan="4" class="help">No agents match the current filters.</td></tr>';
        return;
      }

      filteredAgents.forEach(agent => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${agent.profile?.firstName || ''} ${agent.profile?.lastName || ''}</td>
          <td>${agent.profile?.email || ''}</td>
          <td><span class="status-badge ${agent.progress?.bankingSubmitted ? 'status-complete' : 'status-pending'}">${agent.progress?.bankingSubmitted ? 'Complete' : 'Pending'}</span></td>
          <td>
            <button class="button primary" data-action="view" data-id="${agent.id}">View Details</button>
            <button class="button secondary" data-action="zip" data-id="${agent.id}">Download ZIP</button>
          </td>
        `;
        tableBody.appendChild(tr);
      });
    }

    async function openDetailsModal(agentId) {
      const agent = allAgents.find(a => a.id === agentId);
      if (!agent) return;

      let documentsHtml = '<h4>No documents available.</h4>';
      if (agent.documents && agent.documents.length > 0) {
        documentsHtml = '<ul>' + agent.documents.map(doc => `
          <li><a href="/api/admin/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(doc)}" target="_blank">${doc}</a></li>
        `).join('') + '</ul>';
      }

      modalContent.innerHTML = `
        <h2>${agent.profile.firstName} ${agent.profile.lastName}</h2>
        <p><strong>Email:</strong> ${agent.profile.email}</p>
        <p><strong>NPN:</strong> ${agent.profile.npn}</p>
        <hr>
        <h3>Generated Documents</h3>
        ${documentsHtml}
      `;
      modal.style.display = 'block';
    }

    searchInput?.addEventListener('input', renderAgents);
    statusFilter?.addEventListener('change', renderAgents);
    closeModal?.addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });

    tableBody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id || !action) return;

      if (action === 'view') {
        openDetailsModal(id);
      } else if (action === 'zip') {
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
