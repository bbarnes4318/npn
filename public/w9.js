// W-9 Form Handler
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('w9Form');
  const msgEl = document.getElementById('w9Msg');
  const clearBtn = document.getElementById('clearW9Btn');

  // Get agent ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const agentId = urlParams.get('agentId');

  // Set current date
  const dateInput = document.querySelector('input[name="signatureDate"]');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Show message
  function showMessage(text, type = 'notice') {
    msgEl.textContent = text;
    msgEl.className = type;
    msgEl.style.display = 'block';
    setTimeout(() => {
      msgEl.style.display = 'none';
    }, 5000);
  }

  // Handle LLC classification visibility
  const taxClassificationRadios = document.querySelectorAll('input[name="taxClassification"]');
  const llcField = document.getElementById('llcClassificationField');
  
  taxClassificationRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.value === 'llc') {
        llcField.style.display = 'block';
      } else {
        llcField.style.display = 'none';
        // Clear LLC classification when not LLC
        document.querySelectorAll('input[name="llcClassification"]').forEach(r => r.checked = false);
      }
    });
  });

  // Handle TIN type switching
  const ssnRadio = document.querySelector('input[name="tinType"][value="ssn"]');
  const einRadio = document.querySelector('input[name="tinType"][value="ein"]');
  const ssnInput = document.getElementById('w9_ssn');
  const einInput = document.getElementById('w9_ein');

  ssnRadio.addEventListener('change', function() {
    if (this.checked) {
      ssnInput.required = true;
      einInput.required = false;
      einInput.value = '';
    }
  });

  einRadio.addEventListener('change', function() {
    if (this.checked) {
      einInput.required = true;
      ssnInput.required = false;
      ssnInput.value = '';
    }
  });

  // Format SSN input
  ssnInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length >= 3) {
      value = value.slice(0, 3) + '-' + value.slice(3);
    }
    if (value.length >= 6) {
      value = value.slice(0, 6) + '-' + value.slice(6, 10);
    }
    e.target.value = value;
  });

  // Format EIN input
  einInput.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length >= 2) {
      value = value.slice(0, 2) + '-' + value.slice(2, 9);
    }
    e.target.value = value;
  });

  // Form validation
  function validateForm() {
    const name = form.name.value.trim();
    const address1 = form.address1.value.trim();
    const city = form.city.value.trim();
    const state = form.state.value.trim();
    const zip = form.zip.value.trim();
    const signature = form.signature.value.trim();
    const signatureDate = form.signatureDate.value;

    if (!name) {
      showMessage('Name is required', 'error');
      return false;
    }

    if (!address1 || !city || !state || !zip) {
      showMessage('Complete address is required', 'error');
      return false;
    }

    const ssnChecked = document.querySelector('input[name="tinType"][value="ssn"]').checked;
    const einChecked = document.querySelector('input[name="tinType"][value="ein"]').checked;
    
    if (!ssnChecked && !einChecked) {
      showMessage('Please select either SSN or EIN', 'error');
      return false;
    }

    if (ssnChecked && !form.ssn.value.trim()) {
      showMessage('SSN is required', 'error');
      return false;
    }

    if (einChecked && !form.ein.value.trim()) {
      showMessage('EIN is required', 'error');
      return false;
    }

    if (!signature) {
      showMessage('Digital signature is required', 'error');
      return false;
    }

    if (!signatureDate) {
      showMessage('Signature date is required', 'error');
      return false;
    }

    return true;
  }

  // Form submission
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      // Convert FormData to JSON object
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      
      // Add agent ID if available
      if (agentId) {
        payload.agentId = agentId;
      }

      const response = await fetch('/api/w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        showMessage('W-9 form submitted successfully!', 'success');
        form.reset();
        // Set current date again after reset
        if (dateInput) {
          dateInput.value = new Date().toISOString().split('T')[0];
        }
        // Redirect to completion page
        setTimeout(() => {
          window.location.href = '/completed.html';
        }, 2000);
      } else {
        showMessage(result.error || 'Failed to submit W-9 form', 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      showMessage('Network error. Please try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  // Clear form
  clearBtn.addEventListener('click', function() {
    if (confirm('Are you sure you want to clear all form data?')) {
      form.reset();
      if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
      }
      showMessage('Form cleared', 'notice');
    }
  });

  // Auto-populate from agent data if available
  if (agentId) {
    (async () => {
      try {
        const response = await fetch(`/api/agents/${agentId}`);
        if (response.ok) {
          const agent = await response.json();
          if (agent.profile) {
            // Pre-fill name if available
            const nameInput = document.getElementById('w9_name');
            if (nameInput && !nameInput.value && agent.profile.firstName && agent.profile.lastName) {
              nameInput.value = `${agent.profile.firstName} ${agent.profile.lastName}`;
            }
          }
        }
      } catch (error) {
        console.log('Could not load agent data:', error);
      }
    })();
  }

  // Security: Mask sensitive information in console logs
  const originalLog = console.log;
  console.log = function(...args) {
    const maskedArgs = args.map(arg => {
      if (typeof arg === 'string') {
        return arg.replace(/ssn[^,}]*/gi, 'ssn: [MASKED]')
                  .replace(/ein[^,}]*/gi, 'ein: [MASKED]');
      }
      return arg;
    });
    originalLog.apply(console, maskedArgs);
  };
});