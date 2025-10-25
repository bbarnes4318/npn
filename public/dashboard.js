(function() {
  const QS = new URLSearchParams(location.search);
  const LS_KEY = 'agentPortalId';
  const agentId = QS.get('agentId') || localStorage.getItem(LS_KEY);

  if (!agentId) {
    location.href = '/portal.html';
    return;
  }

  // ---------- States (for Intake) ----------
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

  // ---------- Utilities ----------
  function todayLong() {
    try {
      return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      const d = new Date();
      return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
    }
  }

  async function api(path, options={}) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();
    if (data && data.ok === false) throw new Error(data.error || 'API error');
    return data;
  }

  // ---------- Persistence ----------
  const PACKET_KEY = `packetData:${agentId}`;
  function loadPacket() {
    try { return JSON.parse(localStorage.getItem(PACKET_KEY) || '{}'); } catch { return {}; }
  }
  function savePacket(data) {
    localStorage.setItem(PACKET_KEY, JSON.stringify(data));
  }
  function saveField(name, value) {
    const data = loadPacket();
    data[name] = value;
    savePacket(data);
  }

  // ---------- Autofill tokens ----------
  function updateTokens() {
    const data = loadPacket();
    const first = data.first_name || '';
    const last = data.last_name || '';
    const full = `${first} ${last}`.trim();
    const date = data.current_date || todayLong();
    document.querySelectorAll('[data-token="full_name"]').forEach(el => el.textContent = full);
    document.querySelectorAll('[data-token="current_date"]').forEach(el => el.textContent = date);
  }

  // ---------- Conditionals ----------
  function wireConditionals() {
    const map = {};
    document.querySelectorAll('.conditional[data-for]').forEach(div => {
      const key = div.getAttribute('data-for');
      map[key] = map[key] || [];
      map[key].push(div);
      div.classList.remove('show');
    });
    Object.keys(map).forEach(name => {
      const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
      const update = () => {
        let val = 'no';
        radios.forEach(r => { if (r.checked) val = r.value; });
        map[name].forEach(div => {
          if (val === 'yes') div.classList.add('show');
          else {
            div.classList.remove('show');
            // clear inputs inside
            div.querySelectorAll('input, textarea, select').forEach(el => {
              if (el.type === 'file') el.value = '';
              else if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
              else el.value = '';
            });
          }
        });
      };
      radios.forEach(r => r.addEventListener('change', () => {
        update();
        saveField(name, Array.from(radios).find(x => x.checked)?.value || 'no');
      }));
      update();
    });
  }

  // ---------- Signature ----------
  function initSignature(id) {
    const canvas = document.getElementById('sigPad');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null, hasInk = false;
    canvas.addEventListener('mousedown', e => { drawing = true; last = { x: e.offsetX, y: e.offsetY }; });
    canvas.addEventListener('mousemove', e => {
      if (!drawing) return;
      ctx.strokeStyle = '#0b5fa7';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();
      last = { x: e.offsetX, y: e.offsetY };
      hasInk = true;
    });
    window.addEventListener('mouseup', () => drawing = false);

    const msg = document.getElementById('sigMsg');
    const ackProducer = document.getElementById('ackProducer');
    // If signature isn't saved yet, require Save before allowing agree
    try {
      const savedState = loadPacket().signatureSaved;
      if (!savedState && ackProducer) ackProducer.disabled = true;
    } catch {}
    document.getElementById('clearSigBtn').addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; msg.textContent=''; });
    document.getElementById('saveSigBtn').addEventListener('click', async () => {
      const dataUrl = canvas.toDataURL('image/png');
      msg.textContent = 'Saving...';
      try {
        await api(`/api/agents/${id}/signatures`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc: 'producerAgreement', type: 'drawn', value: dataUrl })
        });
        saveField('signatureDataUrl', dataUrl);
        saveField('signatureSaved', true);
        // set signing date at the moment of signature save
        saveField('current_date', todayLong());
        msg.textContent = 'Signature saved.';
        if (ackProducer) ackProducer.disabled = false;
      } catch (e) {
        // Fallback to local save
        saveField('signatureDataUrl', dataUrl);
        saveField('signatureSaved', true);
        saveField('current_date', todayLong());
        msg.textContent = 'Signature saved locally.';
        if (ackProducer) ackProducer.disabled = false;
      }
    });

    return () => hasInk;
  }

  // ---------- Form Wiring ----------
  document.addEventListener('DOMContentLoaded', async () => {
    // Load agent (optional, to validate and keep LS in sync)
    let serverProgress = null;
    try {
      const { agent } = await api(`/api/agents/${agentId}`);
      localStorage.setItem(LS_KEY, agent.id);
      serverProgress = agent.progress || null;
    } catch {
      // if API not available, continue in local-only mode
    }

    // Preload saved data
    const data = loadPacket();
    if (!data.current_date) { data.current_date = todayLong(); savePacket(data); }

    // Status banner: show helpful direction
    (function setupStatusBanner() {
      const banner = document.getElementById('statusBanner');
      const text = document.getElementById('statusText');
      if (!banner || !text) return;
      const state = loadPacket();
      const submitted = !!state.packetSubmitted;
      if (submitted) {
        text.textContent = 'You\'re all set! Your packet has been submitted.';
      } else {
        text.textContent = 'Fill out the packet below and save your signature.';
      }
      banner.style.display = 'block';
    })();

    // Progress tracker: Step 1 of 2 (50%) on Dashboard
    (function setupProgress() {
      const fill = document.getElementById('progressFill');
      const label = document.getElementById('progressLabel');
      if (fill) fill.style.width = '50%';
      if (label) label.textContent = 'Step 1 of 2: Complete your packet';
    })();

    // Show Agent ID in header and allow copying
    (function showAgentId() {
      const idEl = document.getElementById('agentIdDisplay');
      if (idEl) idEl.textContent = agentId || '';
      const copyBtn = document.getElementById('copyAgentIdBtn');
      copyBtn?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(agentId || '');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => (copyBtn.textContent = 'Copy ID'), 1200);
        } catch {
          alert('Could not copy. Agent ID: ' + (agentId || ''));
        }
      });
    })();

    // Populate inputs
    document.querySelectorAll('#packetForm input, #packetForm select, #packetForm textarea').forEach(el => {
      const name = el.name;
      if (!name) return;
      if (el.multiple) {
        const saved = data[name];
        if (Array.isArray(saved)) {
          Array.from(el.options).forEach(opt => { opt.selected = saved.includes(opt.value); });
        }
      } else if (data[name] != null) {
        if (el.type === 'radio' || el.type === 'checkbox') {
          if (el.value === String(data[name])) el.checked = true;
        } else {
          el.value = data[name];
        }
      }
      el.addEventListener('input', () => {
        if (el.multiple) {
          const vals = Array.from(el.selectedOptions).map(o => o.value);
          saveField(name, vals);
        } else if (el.type === 'radio') {
          if (el.checked) saveField(name, el.value);
        } else if (el.type === 'checkbox') {
          saveField(name, el.checked);
        } else {
          saveField(name, el.value);
        }
        updateTokens();
      });
      el.addEventListener('change', () => {
        // ensure change also captured (useful for file/select)
        if (el.type !== 'file') {
          if (el.multiple) {
            const vals = Array.from(el.selectedOptions).map(o => o.value);
            saveField(name, vals);
          } else if (el.type === 'checkbox') saveField(name, el.checked);
          else if (el.type === 'radio') { if (el.checked) saveField(name, el.value); }
          else saveField(name, el.value);
          updateTokens();
        }
      });
    });

    // Update tokens for name and date
    updateTokens();

    // Wire conditionals
    wireConditionals();

    // Populate states for integrated Intake and re-select saved values
    const statesMulti = document.querySelector('.states-multi');
    if (statesMulti) {
      populateStatesMulti(statesMulti);
      const saved = loadPacket().statesLicensed;
      if (Array.isArray(saved)) {
        Array.from(statesMulti.options).forEach(opt => { opt.selected = saved.includes(opt.value); });
      }
    }

    // Integrated Intake: Upload certification proof
    const uploadCertBtn2 = document.getElementById('uploadCertBtn2');
    uploadCertBtn2?.addEventListener('click', async () => {
      const file = document.getElementById('certFile2')?.files?.[0];
      const msg = document.getElementById('uploadCertMsg2');
      if (!file) { if (msg) msg.textContent = 'Choose a file first.'; return; }
      if (msg) msg.textContent = 'Uploading...';
      try {
        const fd = new FormData();
        fd.append('certProof', file);
        await api(`/api/agents/${agentId}/uploadCert`, { method: 'POST', body: fd });
        if (msg) msg.textContent = 'Upload complete!';
      } catch (e) {
        if (msg) msg.textContent = 'Upload failed. Please try again.';
      }
    });

    // Allow deferring certification upload to later
    const deferCertBtn2 = document.getElementById('deferCertBtn2');
    deferCertBtn2?.addEventListener('click', async () => {
      const msg = document.getElementById('uploadCertMsg2');
      try {
        // Mark locally
        saveField('certProofDeferred', true);
        // Optionally update server-side progress flag (non-breaking if not recognized)
        try {
          await api(`/api/agents/${agentId}/progress`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ certUploadDeferred: true })
          });
        } catch {}
        if (msg) msg.textContent = 'Saved for later. You can upload this certification proof anytime.';
      } catch {
        if (msg) msg.textContent = 'Saved locally for later upload.';
      }
    });

    // Signature pad
    const hasInkCheck = initSignature(agentId);

    // Print
    document.getElementById('printBtn')?.addEventListener('click', () => window.print());

    // Download packet button removed per requirements

    // Removed Additional Forms and downloads per requirements

    // Submit
    const form = document.getElementById('packetForm');
    const submitMsg = document.getElementById('submitMsg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitMsg.textContent = '';

      // basic HTML5 validation
      if (!form.checkValidity()) {
        submitMsg.textContent = 'Please complete all required fields.';
        form.reportValidity();
        return;
      }

      // Require signature saved
      const saved = loadPacket().signatureSaved;
      if (!saved) {
        submitMsg.textContent = 'Please draw and save your signature in the Producer section.';
        return;
      }

      // Collect data (aggregate duplicate keys as arrays, e.g., multi-select values)
      const payload = {};
      const fd = new FormData(form);
      for (const [k, v] of fd.entries()) {
        if (v instanceof File) continue; // files not sent via JSON in this flow
        if (payload[k] === undefined) payload[k] = v;
        else if (Array.isArray(payload[k])) payload[k].push(v);
        else payload[k] = [payload[k], v];
      }
      const state = loadPacket();
      payload.full_name = `${state.first_name || ''} ${state.last_name || ''}`.trim();
      // Use today's date as the signing date at submission time
      payload.current_date = todayLong();
      payload.signatureDataUrl = state.signatureDataUrl || null;

      // Extract banking information for separate submission
      const bankingData = {
        agentId: agentId,
        bankName: payload.bankName || '',
        routingNumber: payload.routingNumber || '',
        accountNumber: payload.accountNumber || '',
        accountType: payload.accountType || '',
        accountHolderName: payload.accountHolderName || '',
        paymentMethod: payload.paymentMethod || 'direct_deposit',
        paymentFrequency: payload.paymentFrequency || 'bi-weekly',
        authorizeDirectDeposit: payload.authorizeDirectDeposit === 'on' || payload.authorizeDirectDeposit === 'true',
        verifyBankingInfo: payload.verifyBankingInfo === 'on' || payload.verifyBankingInfo === 'true',
        privacyConsent: payload.privacyConsent === 'on' || payload.privacyConsent === 'true',
        digitalSignature: payload.full_name,
        signatureDate: new Date().toISOString().split('T')[0]
      };

      submitMsg.textContent = 'Submitting...';
      try {
        // Submit intake data first
        await api('/api/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            agentId: agentId
          })
        });

        // Submit packet data
        await api(`/api/agents/${agentId}/packet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        // Submit banking data if provided
        if (bankingData.bankName && bankingData.routingNumber && bankingData.accountNumber) {
          try {
            await api('/api/banking', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(bankingData)
            });
          } catch (bankingErr) {
            console.warn('Banking submission failed:', bankingErr);
            // Continue even if banking fails
          }
        }

        submitMsg.textContent = 'Submitted! Taking you to your W‑9…';
        saveField('packetSubmitted', true);
        setTimeout(() => {
          window.location.href = `/w9.html?agentId=${encodeURIComponent(agentId)}`;
        }, 900);
      } catch (err) {
        console.error('Submission error:', err);
        // fallback to local save only
        saveField('packetSubmitted', 'pending');
        submitMsg.textContent = 'Saved locally. We will sync when online. You can proceed to W‑9.';
        setTimeout(() => {
          window.location.href = `/w9.html?agentId=${encodeURIComponent(agentId)}`;
        }, 900);
      }
    });
  });
})();
