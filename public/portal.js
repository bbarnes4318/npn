document.addEventListener('DOMContentLoaded', () => {
  const steps = [
    { id: 'intake-form-step', title: 'Agent Intake' },
    { id: 'w9-form-step', title: 'W-9 Form' },
    { id: 'banking-form-step', title: 'Banking Information' },
    { id: 'completion-step', title: 'Onboarding Complete' },
  ];
  let currentStep = 0;

  // Pre-populate form with marketing data
  function prePopulateFromMarketing() {
    const marketingData = localStorage.getItem('marketingFormData');
    if (marketingData) {
      try {
        const data = JSON.parse(marketingData);
        const intakeForm = document.getElementById('intakeForm');
        
        if (intakeForm && data) {
          // Pre-populate basic fields if available
          if (data.fullName) {
            const nameParts = data.fullName.split(' ');
            const firstNameField = intakeForm.querySelector('input[name="firstName"]');
            const lastNameField = intakeForm.querySelector('input[name="lastName"]');
            
            if (firstNameField && nameParts[0]) {
              firstNameField.value = nameParts[0];
            }
            if (lastNameField && nameParts.length > 1) {
              lastNameField.value = nameParts.slice(1).join(' ');
            }
          }
          
          if (data.email) {
            const emailField = intakeForm.querySelector('input[name="email"]');
            if (emailField) {
              emailField.value = data.email;
            }
          }
          
          if (data.state) {
            const stateField = intakeForm.querySelector('select[name="state"]');
            if (stateField) {
              stateField.value = data.state;
            }
          }
          
          // Clear the marketing data after using it
          localStorage.removeItem('marketingFormData');
        }
      } catch (error) {
        console.error('Error parsing marketing form data:', error);
      }
    }
  }

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

    // Check form validity before submitting
    if (!intakeForm.checkValidity()) {
      showMessage('Please complete all required fields.', 'error');
      intakeForm.reportValidity();
      return false;
    }

    // Check if licensed states are selected
    const licensedStatesList = document.getElementById('licensed-states');
    if (licensedStatesList) {
      const licensedStates = Array.from(licensedStatesList.querySelectorAll('li')).map(li => li.dataset.value);
      if (licensedStates.length === 0) {
        showMessage('Please select at least one licensed state.', 'error');
        return false;
      }
    }

    const fd = new FormData(intakeForm);
    const agentId = getAgentId();
    if (agentId) fd.append('agentId', agentId);

    if (licensedStatesList) {
      const licensedStates = Array.from(licensedStatesList.querySelectorAll('li')).map(li => li.dataset.value);
      fd.delete('statesLicensed');
      licensedStates.forEach(state => fd.append('statesLicensed', state));
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

    // Check if signature is saved (either drawn or typed)
    const signatureValue = document.getElementById('w9_signature').value;
    const signatureText = document.getElementById('w9_signatureText').value;
    
    if (!signatureValue && !signatureText.trim()) {
      showMessage('Please either draw and save your signature or type your full name.', 'error');
      return false;
    }

    // If only text signature is provided, use that
    if (!signatureValue && signatureText.trim()) {
      document.getElementById('w9_signature').value = signatureText.trim();
    }

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
    console.log('handleBankingSubmit called');
    const bankingForm = document.getElementById('bankingForm');
    if (!bankingForm) {
      console.log('Banking form not found');
      return false;
    }

    // Check form validity
    if (!bankingForm.checkValidity()) {
      console.log('Form validation failed');
      bankingForm.reportValidity();
      showMessage('Please complete all required fields.', 'error');
      return false;
    }

    console.log('Form found, collecting data...');
    const formData = new FormData(bankingForm);
    const data = Object.fromEntries(formData.entries());
    console.log('Form data:', data);
    
    const agentId = getAgentId();
    if (agentId) {
      data.agentId = agentId;
    }

    try {
      showMessage('Submitting banking information...', 'info');
      console.log('Sending request to /api/banking');
      const res = await fetch('/api/banking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      console.log('Response status:', res.status);
      const result = await res.json();
      console.log('Response data:', result);
      if (!res.ok || !result.ok) throw new Error(result.error || 'Failed to save banking information');
      return true;
    } catch (err) {
      console.error('Banking submit error:', err);
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

    // Scroll to top of the page when transitioning to a new step
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(() => {
      // Try multiple scroll methods to ensure it works
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Also scroll the form container into view
      const formContainer = document.getElementById('form-step-container');
      if (formContainer) {
        formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
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
    console.log('Submit button clicked');
    const success = await handleBankingSubmit();
    console.log('Banking submit result:', success);
    if (success) {
      currentStep++;
      showStep(currentStep);
    }
  });

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

  function setupDualListBox() {
    const availableStatesList = document.getElementById('available-states');
    const licensedStatesList = document.getElementById('licensed-states');
    const addStateBtn = document.getElementById('add-state-btn');
    const removeStateBtn = document.getElementById('remove-state-btn');

    // Populate available states
    STATES.forEach(state => {
      const li = document.createElement('li');
      li.textContent = state.name;
      li.dataset.value = state.abbr;
      availableStatesList.appendChild(li);
    });

    function handleStateSelection(e) {
      if (e.target.tagName === 'LI') {
        // If clicking on available states, move to licensed states
        if (e.target.parentElement === availableStatesList) {
          licensedStatesList.appendChild(e.target);
          e.target.classList.remove('selected');
        } else {
          // If clicking on licensed states, just toggle selection
          e.target.classList.toggle('selected');
        }
      }
    }

    availableStatesList.addEventListener('click', handleStateSelection);
    licensedStatesList.addEventListener('click', handleStateSelection);

    addStateBtn.addEventListener('click', () => {
      const selectedStates = availableStatesList.querySelectorAll('.selected');
      selectedStates.forEach(state => {
        licensedStatesList.appendChild(state);
        state.classList.remove('selected');
      });
    });

    removeStateBtn.addEventListener('click', () => {
      const selectedStates = licensedStatesList.querySelectorAll('.selected');
      selectedStates.forEach(state => {
        availableStatesList.appendChild(state);
        state.classList.remove('selected');
      });
    });
  }

  function setupFileUpload() {
    const fileUploadInput = document.getElementById('certProof');
    const fileUploadPreview = document.getElementById('certProof-preview');
    const fileUploadText = document.querySelector('.file-upload-text');

    fileUploadInput.addEventListener('change', () => {
      const file = fileUploadInput.files[0];
      if (file) {
        fileUploadText.textContent = file.name;
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            fileUploadPreview.innerHTML = `<img src="${e.target.result}" alt="Image preview" style="max-width: 100%; height: auto;" />`;
          };
          reader.readAsDataURL(file);
        } else {
          fileUploadPreview.innerHTML = '';
        }
      }
    });
  }

  function setupW9SignaturePad() {
    const canvas = document.getElementById('w9SigPad');
    if (!canvas) {
      console.log('W9 signature canvas not found');
      return;
    }
    
    console.log('Setting up W9 signature pad');
    const ctx = canvas.getContext('2d');
    
    // Set up canvas properties
    ctx.strokeStyle = '#0b5fa7';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    let drawing = false;
    let last = null;
    let hasInk = false;
    
    // Mouse events
    canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      drawing = true;
      last = { x: e.offsetX, y: e.offsetY };
      console.log('Mouse down at:', last);
    });
    
    canvas.addEventListener('mousemove', e => {
      if (!drawing) return;
      e.preventDefault();
      
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();
      
      last = { x: e.offsetX, y: e.offsetY };
      hasInk = true;
    });
    
    canvas.addEventListener('mouseup', e => {
      e.preventDefault();
      drawing = false;
    });
    
    canvas.addEventListener('mouseout', e => {
      drawing = false;
    });
    
    // Touch events for mobile
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      drawing = true;
      last = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      console.log('Touch start at:', last);
    });
    
    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!drawing) return;
      
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
      ctx.stroke();
      
      last = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      hasInk = true;
    });
    
    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      drawing = false;
    });
    
    // Clear button
    const clearBtn = document.getElementById('clearW9SigBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        const msgEl = document.getElementById('w9SigMsg');
        if (msgEl) msgEl.textContent = '';
        const sigInput = document.getElementById('w9_signature');
        if (sigInput) sigInput.value = '';
        console.log('Signature cleared');
      });
    }
    
    // Save button
    const saveBtn = document.getElementById('saveW9SigBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!hasInk) {
          const msgEl = document.getElementById('w9SigMsg');
          if (msgEl) msgEl.textContent = 'Please draw your signature first.';
          return;
        }
        
        const dataUrl = canvas.toDataURL('image/png');
        const sigInput = document.getElementById('w9_signature');
        if (sigInput) sigInput.value = dataUrl;
        
        const msgEl = document.getElementById('w9SigMsg');
        if (msgEl) msgEl.textContent = 'Signature saved.';
        console.log('Signature saved');
      });
    }
    
    // Handle fallback text input
    const textInput = document.getElementById('w9_signatureText');
    if (textInput) {
      textInput.addEventListener('input', () => {
        const sigInput = document.getElementById('w9_signature');
        if (sigInput && textInput.value.trim()) {
          sigInput.value = textInput.value.trim();
        }
      });
    }
    
    console.log('W9 signature pad setup complete');
  }

  populateStates(document.querySelector('.state-select'), true);
  setupDualListBox();
  setupFileUpload();
  setupW9SignaturePad();
  prePopulateFromMarketing();
  showStep(currentStep);
  
  // Document download functionality
  let currentAgentId = null;
  
  // Get agent ID from URL or localStorage
  function getAgentId() {
    if (currentAgentId) return currentAgentId;
    
    // Try to get from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const agentId = urlParams.get('agentId');
    if (agentId) {
      currentAgentId = agentId;
      return agentId;
    }
    
    // Try to get from localStorage (if user came from marketing form)
    const marketingData = localStorage.getItem('marketingFormData');
    if (marketingData) {
      try {
        const data = JSON.parse(marketingData);
        if (data.agentId) {
          currentAgentId = data.agentId;
          return data.agentId;
        }
      } catch (e) {
        console.error('Error parsing marketing data:', e);
      }
    }
    
    return null;
  }
  
  // Download intake documents
  document.getElementById('downloadIntakeBtn')?.addEventListener('click', async () => {
    const agentId = getAgentId();
    if (!agentId) {
      alert('Unable to find your agent ID. Please contact support.');
      return;
    }
    
    try {
      const response = await fetch(`/api/agents/${agentId}/documents/intake.pdf`);
      if (!response.ok) {
        throw new Error('Failed to download intake documents');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Signed_Intake_Documents_${agentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download intake documents. Please contact support.');
    }
  });
  
  // Download W-9 form
  document.getElementById('downloadW9Btn')?.addEventListener('click', async () => {
    const agentId = getAgentId();
    if (!agentId) {
      alert('Unable to find your agent ID. Please contact support.');
      return;
    }
    
    try {
      const response = await fetch(`/api/agents/${agentId}/documents/w9.pdf`);
      if (!response.ok) {
        throw new Error('Failed to download W-9 form');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Signed_W9_Form_${agentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download W-9 form. Please contact support.');
    }
  });
});
