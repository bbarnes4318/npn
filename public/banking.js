// Banking Details Form Handler
document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('bankingForm');
  const msgEl = document.getElementById('bankingMsg');
  const clearBtn = document.getElementById('clearFormBtn');

  // Get agent ID from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const agentId = urlParams.get('agentId');

  // Set current date
  const dateInput = document.querySelector('input[name="signatureDate"]');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Form validation
  function validateForm() {
    const routingNumber = form.routingNumber.value;
    const accountNumber = form.accountNumber.value;
    const confirmRoutingNumber = form.confirmRoutingNumber.value;
    const confirmAccountNumber = form.confirmAccountNumber.value;

    // Validate routing number format
    if (routingNumber && !/^\d{9}$/.test(routingNumber)) {
      showMessage('Routing number must be exactly 9 digits', 'error');
      return false;
    }

    // Validate account number
    if (accountNumber && accountNumber.length < 4) {
      showMessage('Account number must be at least 4 digits', 'error');
      return false;
    }

    // Check if routing numbers match
    if (routingNumber !== confirmRoutingNumber) {
      showMessage('Routing numbers do not match', 'error');
      return false;
    }

    // Check if account numbers match
    if (accountNumber !== confirmAccountNumber) {
      showMessage('Account numbers do not match', 'error');
      return false;
    }

    return true;
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

  // Format routing number input
  const routingInput = form.routingNumber;
  const confirmRoutingInput = form.confirmRoutingNumber;
  
  [routingInput, confirmRoutingInput].forEach(input => {
    input.addEventListener('input', function(e) {
      // Remove non-digits
      e.target.value = e.target.value.replace(/\D/g, '');
      // Limit to 9 digits
      if (e.target.value.length > 9) {
        e.target.value = e.target.value.slice(0, 9);
      }
    });
  });

  // Format account number input
  const accountInput = form.accountNumber;
  const confirmAccountInput = form.confirmAccountNumber;
  
  [accountInput, confirmAccountInput].forEach(input => {
    input.addEventListener('input', function(e) {
      // Remove non-digits
      e.target.value = e.target.value.replace(/\D/g, '');
    });
  });

  // Real-time validation
  function validateRoutingNumber(routing) {
    if (routing.length === 9) {
      // Basic routing number validation (checksum)
      const digits = routing.split('').map(Number);
      const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
      let sum = 0;
      
      for (let i = 0; i < 9; i++) {
        sum += digits[i] * weights[i];
      }
      
      return sum % 10 === 0;
    }
    return true; // Don't show error for incomplete numbers
  }

  // Add validation feedback
  routingInput.addEventListener('blur', function() {
    if (this.value.length === 9 && !validateRoutingNumber(this.value)) {
      this.style.borderColor = '#bb1c29';
      showMessage('Invalid routing number. Please check and try again.', 'error');
    } else {
      this.style.borderColor = '';
    }
  });

  // Form submission
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      const formData = new FormData(form);
      
      // Add agent ID if available
      if (agentId) {
        formData.append('agentId', agentId);
      }

      const response = await fetch('/api/banking', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        showMessage('Banking information saved successfully!', 'success');
        form.reset();
        // Set current date again after reset
        if (dateInput) {
          dateInput.value = new Date().toISOString().split('T')[0];
        }
      } else {
        showMessage(result.error || 'Failed to save banking information', 'error');
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

  // Auto-populate account holder name if agent data is available
  if (agentId) {
    (async () => {
      try {
        const response = await fetch(`/api/agents/${agentId}`);
        if (response.ok) {
          const agent = await response.json();
          if (agent.firstName && agent.lastName) {
            const accountHolderInput = form.accountHolderName;
            if (accountHolderInput && !accountHolderInput.value) {
              accountHolderInput.value = `${agent.firstName} ${agent.lastName}`;
            }
          }
        }
      } catch (error) {
        console.log('Could not load agent data:', error);
      }
    })();
  }

  // Security: Mask account number in console logs
  const originalLog = console.log;
  console.log = function(...args) {
    const maskedArgs = args.map(arg => {
      if (typeof arg === 'string' && arg.includes('accountNumber')) {
        return arg.replace(/accountNumber[^,}]*/g, 'accountNumber: [MASKED]');
      }
      return arg;
    });
    originalLog.apply(console, maskedArgs);
  };
});
