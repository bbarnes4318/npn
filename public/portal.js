document.addEventListener('DOMContentLoaded', () => {
  const steps = [
    { id: 'intake-form-step', title: 'Agent Intake' },
    { id: 'w9-form-step', title: 'W-9 Form' },
    { id: 'banking-form-step', title: 'Banking Information' },
    { id: 'completion-step', title: 'Onboarding Complete' },
  ];
  let currentStep = 0;

  const formStepContainer = document.getElementById('form-step-container');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  const progressSteps = document.querySelectorAll('.progress-step');
  const msg = document.getElementById('portal-msg');

  function showMessage(text, type = 'info') {
    if (msg) {
      msg.textContent = text;
      msg.className = `notice ${type}`;
      msg.style.display = 'block';
    }
  }

  function getAgentId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('agentId') || localStorage.getItem('agentId');
  }

  async function handleIntakeSubmit() {
    const intakeForm = document.getElementById('intakeForm');
    if (!intakeForm) return false;

    const fd = new FormData(intakeForm);
    const agentId = getAgentId();
    if (agentId) fd.append('agentId', agentId);

    const multi = intakeForm.querySelector('.states-multi');
    if (multi) {
      const selected = Array.from(multi.selectedOptions).map(o => o.value);
      fd.delete('statesLicensed');
      selected.forEach(s => fd.append('statesLicensed', s));
    }

    try {
      showMessage('Submitting intake form...', 'info');
      const res = await fetch('/api/intake', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to submit intake');
      if (data.agent && data.agent.id) {
        localStorage.setItem('agentId', data.agent.id);
      }
      return true;
    } catch (err) {
      showMessage(err.message, 'error');
      return false;
    }
  }

  async function handleW9Submit() {
    const w9Form = document.getElementById('w9Form');
    if (!w9Form) return false;

    const formData = new FormData(w9Form);
    const payload = Object.fromEntries(formData.entries());
    const agentId = getAgentId();
    if (agentId) {
      payload.agentId = agentId;
    }

    try {
      showMessage('Submitting W-9 form...', 'info');
      const response = await fetch('/api/w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to submit W-9');
      return true;
    } catch (err) {
      showMessage(err.message, 'error');
      return false;
    }
  }

  async function handleBankingSubmit() {
    const bankingForm = document.getElementById('bankingForm');
    if (!bankingForm) return false;

    const formData = new FormData(bankingForm);
    const data = Object.fromEntries(formData.entries());
    const agentId = getAgentId();
    if (agentId) {
      data.agentId = agentId;
    }

    try {
      showMessage('Submitting banking information...', 'info');
      const res = await fetch('/api/banking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || 'Failed to save banking information');
      return true;
    } catch (err) {
      showMessage(err.message, 'error');
      return false;
    }
  }

  function showStep(stepIndex) {
    // Hide all steps
    document.querySelectorAll('.form-step').forEach(step => step.classList.remove('active'));

    // Show current step
    document.getElementById(steps[stepIndex].id).classList.add('active');

    // Update progress tracker
    progressSteps.forEach((step, index) => {
      if (index < stepIndex) {
        step.classList.add('completed');
        step.classList.remove('active');
      } else if (index === stepIndex) {
        step.classList.add('active');
        step.classList.remove('completed');
      } else {
        step.classList.remove('active');
        step.classList.remove('completed');
      }
    });

    // Update button visibility
    prevBtn.style.display = stepIndex > 0 ? 'inline-block' : 'none';
    nextBtn.style.display = stepIndex < steps.length - 2 ? 'inline-block' : 'none';
    submitBtn.style.display = stepIndex === steps.length - 2 ? 'inline-block' : 'none';
  }

  async function nextStep() {
    let success = false;
    if (currentStep === 0) {
      success = await handleIntakeSubmit();
    } else if (currentStep === 1) {
      success = await handleW9Submit();
    } else {
      success = true; // No submission on the last step
    }

    if (success && currentStep < steps.length - 1) {
      currentStep++;
      showStep(currentStep);
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
    }
  }

  prevBtn.addEventListener('click', prevStep);
  nextBtn.addEventListener('click', nextStep);
  submitBtn.addEventListener('click', async () => {
    const success = await handleBankingSubmit();
    if (success) {
      nextStep();
    }
  });

  // Load form content
  async function loadFormContent() {
    try {
      const [intakeRes, w9Res, bankingRes] = await Promise.all([
        fetch('/intake.html'),
        fetch('/w9.html'),
        fetch('/banking.html'),
      ]);

      const intakeHtml = await intakeRes.text();
      const intakeForm = new DOMParser().parseFromString(intakeHtml, 'text/html').querySelector('#intakeForm');
      document.getElementById('intake-form-step').append(intakeForm);

      const w9Html = await w9Res.text();
      const w9Form = new DOMParser().parseFromString(w9Html, 'text/html').querySelector('#w9Form');
      document.getElementById('w9-form-step').append(w9Form);

      const bankingHtml = await bankingRes.text();
      const bankingContainer = new DOMParser().parseFromString(bankingHtml, 'text/html').querySelector('.step-container');
      document.getElementById('banking-form-step').append(bankingContainer);
    } catch (err) {
      showMessage('Failed to load form content. Please refresh the page.', 'error');
    }
  }

  loadFormContent().then(() => {
    showStep(currentStep);
  });
});
