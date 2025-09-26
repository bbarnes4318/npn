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

  function onIntakePage() {
    return document.getElementById('intakeForm');
  }

  function onW9Page() {
    return document.getElementById('w9Form');
  }

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = type === 'success' ? 'success' : (type === 'error' ? 'error' : 'notice');
    el.style.display = 'block';
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Intake page behaviors
    const intakeForm = onIntakePage();
    if (intakeForm) {
      const agentId = getAgentId();
      // Carry agentId to W-9 link if present
      const w9Anchor = document.querySelector('a[href="/w9.html"]');
      if (w9Anchor && agentId) w9Anchor.href = `/w9.html?agentId=${encodeURIComponent(agentId)}`;
      // Populate state selects
      populateStates(document.querySelector('.state-select'), true);
      populateStatesMulti(document.querySelector('.states-multi'));

      // Conditional textareas
      [['priorTerminations','priorTerminationsExplain'], ['felonies','feloniesExplain'], ['bankruptcies','bankruptciesExplain']].forEach(([name, explain]) => {
        const radios = intakeForm.querySelectorAll(`input[name="${name}"]`);
        const ta = intakeForm.querySelector(`textarea[name="${explain}"]`);
        const update = () => {
          const val = Array.from(radios).find(r => r.checked)?.value || 'no';
          if (val === 'yes') {
            ta.style.display = '';
            ta.required = true;
          } else {
            ta.style.display = 'none';
            ta.required = false;
            ta.value = '';
          }
        };
        radios.forEach(r => r.addEventListener('change', update));
        update();
      });

      const msg = document.getElementById('intakeMsg');
      // Allow deferring certification upload to later
      const deferBtn = document.getElementById('deferCertBtn');
      deferBtn?.addEventListener('click', async () => {
        try {
          localStorage.setItem('certProofDeferred', 'true');
          // Optional server progress update if agentId is available
          if (agentId) {
            try {
              await fetch(`/api/agents/${encodeURIComponent(agentId)}/progress`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ certUploadDeferred: true })
              });
            } catch {}
          }
          showMessage(msg, 'Saved for later. You can upload your certification proof anytime.', 'notice');
        } catch {
          showMessage(msg, 'Saved locally for later.', 'notice');
        }
      });
      intakeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showMessage(msg, 'Submitting...', 'notice');
        try {
          const fd = new FormData(intakeForm);
          const agentId = getAgentId();
          if (agentId) fd.append('agentId', agentId);
          // Fetch selected states from multi-select to ensure multiple values are sent
          const multi = intakeForm.querySelector('.states-multi');
          if (multi) {
            const selected = Array.from(multi.selectedOptions).map(o => o.value);
            // Remove existing entries and append explicitly
            fd.delete('statesLicensed');
            selected.forEach(s => fd.append('statesLicensed', s));
          }
          const res = await fetch('/api/intake', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit');
          showMessage(msg, 'Thanks! Your intake was received. You can now complete your W-9.', 'success');
          // Soft prompt to navigate to W-9
          setTimeout(() => {
            const aId = getAgentId();
            window.location.href = aId ? `/w9.html?agentId=${encodeURIComponent(aId)}` : '/w9.html';
          }, 1200);
        } catch (err) {
          console.error(err);
          showMessage(msg, 'There was an error submitting your intake. Please try again.', 'error');
        }
      });
    }

    // W-9 page behaviors
    const w9Form = onW9Page();
    if (w9Form) {
      const agentId = getAgentId();
      // Carry agentId to Back to Intake link
      const intakeAnchor = document.querySelector('a[href="/intake.html"]');
      if (intakeAnchor && agentId) intakeAnchor.href = `/intake.html?agentId=${encodeURIComponent(agentId)}`;
      populateStates(w9Form.querySelector('.state-select'), true);

      // Tax classification: toggle LLC classification field when LLC selected
      const taxRadios = w9Form.querySelectorAll('input[name="taxClassification"]');
      const llcRow = w9Form.querySelector('#llcRow');
      const updateLLC = () => {
        const val = Array.from(taxRadios).find(r => r.checked)?.value;
        if (val === 'llc') {
          llcRow.style.display = '';
          const llc = w9Form.querySelector('input[name="llcClassification"]');
          if (llc) llc.required = true;
        } else {
          llcRow.style.display = 'none';
          const llc = w9Form.querySelector('input[name="llcClassification"]');
          if (llc) { llc.required = false; llc.value = ''; }
        }
      };
      taxRadios.forEach(r => r.addEventListener('change', updateLLC));
      updateLLC();

      // SSN vs EIN validation
      const ssn = w9Form.querySelector('input[name="ssn"]');
      const ein = w9Form.querySelector('input[name="ein"]');
      function validateTin() {
        const hasSSN = ssn.value.trim().length > 0;
        const hasEIN = ein.value.trim().length > 0;
        if (!hasSSN && !hasEIN) {
          ssn.setCustomValidity('Provide SSN or EIN');
          ein.setCustomValidity('Provide SSN or EIN');
        } else {
          ssn.setCustomValidity('');
          ein.setCustomValidity('');
        }
      }
      ssn.addEventListener('input', validateTin);
      ein.addEventListener('input', validateTin);

      const msg = document.getElementById('w9Msg');
      w9Form.addEventListener('submit', async (e) => {
        e.preventDefault();
        validateTin();
        if (!w9Form.reportValidity()) return;
        showMessage(msg, 'Submitting...', 'notice');
        try {
          const form = new FormData(w9Form);
          const payload = Object.fromEntries(form.entries());
          const agentId = getAgentId();
          if (agentId) payload.agentId = agentId;
          const res = await fetch('/api/w9', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit');
          showMessage(msg, 'Submitted! Returning you to your dashboard...', 'success');
          // Give a clear next step by returning to dashboard
          setTimeout(() => {
            const aId = getAgentId();
            if (aId) window.location.href = `/dashboard.html?agentId=${encodeURIComponent(aId)}`;
            else window.location.href = '/dashboard.html';
          }, 900);
        } catch (err) {
          console.error(err);
          showMessage(msg, 'There was an error submitting your W-9. Please try again.', 'error');
        }
      });

      // Handle uploaded completed W-9 files
      const uploadBtn = document.getElementById('uploadW9Btn');
      const fileInput = document.getElementById('w9File');
      const uploadMsg = document.getElementById('uploadW9Msg');
      uploadBtn?.addEventListener('click', async () => {
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          showMessage(uploadMsg, 'Choose your completed W‑9 file first.', 'notice');
          return;
        }
        const file = fileInput.files[0];
        showMessage(uploadMsg, 'Uploading...', 'notice');
        const endpoint = agentId ? `/api/agents/${encodeURIComponent(agentId)}/w9` : '/api/w9/upload';
        try {
          const fd = new FormData();
          fd.append('w9', file);
          if (agentId) fd.append('agentId', agentId);
          const res = await fetch(endpoint, { method: 'POST', body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || (data && data.ok === false)) throw new Error(data.error || 'Upload failed');
          showMessage(uploadMsg, 'W‑9 uploaded successfully.', 'success');
          localStorage.setItem(`w9Uploaded:${agentId || 'anon'}`, 'true');
        } catch (err) {
          console.error(err);
          localStorage.setItem(`w9Uploaded:${agentId || 'anon'}`, 'pending');
          showMessage(uploadMsg, 'Saved locally. We will sync your W‑9 when online.', 'notice');
        }
      });

      // Back to Dashboard link should carry agentId if present
      const backToDashboard = document.getElementById('backToDashboard');
      if (backToDashboard && agentId) backToDashboard.href = `/dashboard.html?agentId=${encodeURIComponent(agentId)}`;

      // Download All Documents (ZIP)
      const downloadAllBtn = document.getElementById('downloadAllBtn');
      downloadAllBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!agentId) { alert('Open your Dashboard to download your documents.'); return; }
        const url = `/api/agents/${encodeURIComponent(agentId)}/documents/zip`;
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }
  });
})();
