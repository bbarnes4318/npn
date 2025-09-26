(function() {
  const QS = new URLSearchParams(window.location.search);
  const AGENT_LS_KEY = 'agentPortalId';
  const getAgentId = () => QS.get('agentId') || localStorage.getItem(AGENT_LS_KEY) || '';

  const STATES = [
    { abbr: 'AL', name: 'Alabama' }, { abbr: 'AK', name: 'Alaska' }, { abbr: 'AZ', name: 'Arizona' },
    { abbr: 'AR', name: 'Arkansas' }, { abbr: 'CA', name: 'California' }, { abbr: 'CO', name: 'Colorado' },
    { abbr: 'CT', name: 'Connecticut' }, { abbr: 'DE', name: 'Delaware' }, { abbr: 'DC', name: 'District of Columbia' },
    { abbr: 'FL', name: 'Florida' }, { abbr: 'GA', name: 'Georgia' }, { abbr: 'HI', name: 'Hawaii' },
    { abbr: 'ID', name: 'Idaho' }, { abbr: 'IL', name: 'Illinois' }, { abbr: 'IN', name: 'Indiana' },
    { abbr: 'IA', name: 'Iowa' }, { abbr: 'KS', name: 'Kansas' }, { abbr: 'KY', name: 'Kentucky' },
    { abbr: 'LA', name: 'Louisiana' }, { abbr: 'ME', name: 'Maine' }, { abbr: 'MD', name: 'Maryland' },
    { abbr: 'MA', name: 'Massachusetts' }, { abbr: 'MI', name: 'Michigan' }, { abbr: 'MN', name: 'Minnesota' },
    { abbr: 'MS', name: 'Mississippi' }, { abbr: 'MO', name: 'Missouri' }, { abbr: 'MT', name: 'Montana' },
    { abbr: 'NE', name: 'Nebraska' }, { abbr: 'NV', name: 'Nevada' }, { abbr: 'NH', name: 'New Hampshire' },
    { abbr: 'NJ', name: 'New Jersey' }, { abbr: 'NM', name: 'New Mexico' }, { abbr: 'NY', name: 'New York' },
    { abbr: 'NC', name: 'North Carolina' }, { abbr: 'ND', name: 'North Dakota' }, { abbr: 'OH', name: 'Ohio' },
    { abbr: 'OK', name: 'Oklahoma' }, { abbr: 'OR', name: 'Oregon' }, { abbr: 'PA', name: 'Pennsylvania' },
    { abbr: 'RI', name: 'Rhode Island' }, { abbr: 'SC', name: 'South Carolina' }, { abbr: 'SD', name: 'South Dakota' },
    { abbr: 'TN', name: 'Tennessee' }, { abbr: 'TX', name: 'Texas' }, { abbr: 'UT', name: 'Utah' },
    { abbr: 'VT', name: 'Vermont' }, { abbr: 'VA', name: 'Virginia' }, { abbr: 'WA', name: 'Washington' },
    { abbr: 'WV', name: 'West Virginia' }, { abbr: 'WI', name: 'Wisconsin' }, { abbr: 'WY', name: 'Wyoming' }
  ];

  function populateStates(select, includeBlank) {
    if (!select) return;
    select.innerHTML = '';
    if (includeBlank) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Select state';
      select.appendChild(opt);
    }
    STATES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.abbr;
      opt.textContent = `${s.abbr} — ${s.name}`;
      select.appendChild(opt);
    });
  }

  function populateStatesMulti(select) {
    if (!select) return;
    select.innerHTML = '';
    STATES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.abbr;
      opt.textContent = `${s.abbr} — ${s.name}`;
      select.appendChild(opt);
    });
  }

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = type === 'success' ? 'success' : (type === 'error' ? 'error' : 'notice');
    el.style.display = 'block';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const intakeForm = document.getElementById('intakeForm');
    if (!intakeForm) return;

    const agentId = getAgentId();
    // Carry agentId to W-9 link if present
    const w9Anchor = document.querySelector('a[href="/w9.html"]');
    if (w9Anchor && agentId) w9Anchor.href = `/w9.html?agentId=${encodeURIComponent(agentId)}`;

    populateStates(document.querySelector('.state-select'), true);
    populateStatesMulti(document.querySelector('.states-multi'));

    // Conditional textareas show/hide
    [['priorTerminations','priorTerminationsExplain'], ['felonies','feloniesExplain'], ['bankruptcies','bankruptciesExplain']].forEach(([name, explain]) => {
      const radios = intakeForm.querySelectorAll(`input[name="${name}"]`);
      const ta = intakeForm.querySelector(`textarea[name="${explain}"]`);
      const update = () => {
        const val = Array.from(radios).find(r => r.checked)?.value || 'no';
        if (val === 'yes') { ta.style.display = ''; ta.required = true; }
        else { ta.style.display = 'none'; ta.required = false; ta.value = ''; }
      };
      radios.forEach(r => r.addEventListener('change', update));
      update();
    });

    const msg = document.getElementById('intakeMsg');
    // Allow deferring certification upload to later
    const deferBtn = document.getElementById('deferCertBtn');
    deferBtn?.addEventListener('click', async () => {
      try {
        // Store a simple local flag; if an agentId exists, key it by agent
        const aId = getAgentId();
        if (aId) localStorage.setItem(`certProofDeferred:${aId}`, 'true');
        else localStorage.setItem('certProofDeferred', 'true');
        // Optionally update server-side progress
        if (aId) {
          try {
            await fetch(`/api/agents/${encodeURIComponent(aId)}/progress`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ certUploadDeferred: true })
            });
          } catch {}
        }
        showMessage(msg, 'Saved for later. You can upload your certification proof anytime.', 'notice');
      } catch (e) {
        showMessage(msg, 'Saved locally for later.', 'notice');
      }
    });
    intakeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showMessage(msg, 'Submitting...', 'notice');
      try {
        const fd = new FormData(intakeForm);
        if (agentId) fd.append('agentId', agentId);
        const multi = intakeForm.querySelector('.states-multi');
        if (multi) {
          const selected = Array.from(multi.selectedOptions).map(o => o.value);
          fd.delete('statesLicensed');
          selected.forEach(s => fd.append('statesLicensed', s));
        }
        const res = await fetch('/api/intake', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit');
        showMessage(msg, 'Thanks! Your intake was received. You can now complete your W-9.', 'success');
        setTimeout(() => {
          const aId = getAgentId();
          window.location.href = aId ? `/w9.html?agentId=${encodeURIComponent(aId)}` : '/w9.html';
        }, 1200);
      } catch (err) {
        console.error(err);
        showMessage(msg, 'There was an error submitting your intake. Please try again.', 'error');
      }
    });
  });
})();
