(function() {
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('bankingForm');
    const msg = document.getElementById('bankingMsg');
    const submitBtn = document.getElementById('submitBtn');

    function setMsg(text, type = 'info') {
      if (msg) {
        msg.textContent = text;
        msg.className = `notice ${type}`;
        msg.style.display = 'block';
      }
    }

    function validateForm() {
      const requiredFields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'zipCode', 'ssn', 'dateOfBirth', 'bankName', 'routingNumber', 'accountNumber', 'accountType', 'accountHolderName', 'confirmAccountNumber', 'confirmRoutingNumber', 'digitalSignature', 'signatureDate'];
      
      for (const field of requiredFields) {
        const input = form[field];
        if (!input || !input.value.trim()) {
          setMsg(`Please fill in all required fields. Missing: ${field}`, 'error');
          return false;
        }
      }

      // Validate SSN format
      const ssn = form.ssn.value;
      if (!/^\d{9}$/.test(ssn)) {
        setMsg('SSN must be exactly 9 digits', 'error');
        return false;
      }

      // Validate routing number format
      const routingNumber = form.routingNumber.value;
      if (!/^\d{9}$/.test(routingNumber)) {
        setMsg('Routing number must be exactly 9 digits', 'error');
        return false;
      }

      // Validate account number confirmation
      if (form.accountNumber.value !== form.confirmAccountNumber.value) {
        setMsg('Account numbers do not match', 'error');
        return false;
      }

      if (form.routingNumber.value !== form.confirmRoutingNumber.value) {
        setMsg('Routing numbers do not match', 'error');
        return false;
      }

      // Validate checkboxes
      if (!form.authorizeDirectDeposit.checked) {
        setMsg('You must authorize direct deposit', 'error');
        return false;
      }

      if (!form.verifyBankingInfo.checked) {
        setMsg('You must verify your banking information', 'error');
        return false;
      }

      if (!form.privacyConsent.checked) {
        setMsg('You must consent to privacy policy', 'error');
        return false;
      }

      return true;
    }

    // Format SSN input
    const ssnInput = form.ssn;
    ssnInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '').slice(0, 9);
    });

    // Format routing number input
    const routingInput = form.routingNumber;
    routingInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '').slice(0, 9);
    });

    // Format confirm routing number input
    const confirmRoutingInput = form.confirmRoutingNumber;
    confirmRoutingInput.addEventListener('input', function() {
      this.value = this.value.replace(/\D/g, '').slice(0, 9);
    });

    // Auto-fill confirm fields
    form.accountNumber.addEventListener('input', function() {
      if (form.confirmAccountNumber.value === '') {
        form.confirmAccountNumber.value = this.value;
      }
    });

    form.routingNumber.addEventListener('input', function() {
      if (form.confirmRoutingNumber.value === '') {
        form.confirmRoutingNumber.value = this.value;
      }
    });

    // Set today's date as default for signature date
    const today = new Date().toISOString().split('T')[0];
    form.signatureDate.value = today;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!validateForm()) {
        return;
      }

      setMsg('Submitting your information...', 'info');
      submitBtn.disabled = true;

      try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // Get agent ID from URL or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        const agentId = urlParams.get('agentId') || localStorage.getItem('agentId');
        if (agentId) {
          data.agentId = agentId;
        }

        const res = await fetch('/api/banking', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        const result = await res.json();

        if (res.ok && result.ok) {
          setMsg('Employee information and banking details saved successfully!', 'success');
          form.reset();
          
          // Redirect to success page or next step
          setTimeout(() => {
            window.location.href = '/portal.html';
          }, 2000);
        } else {
          throw new Error(result.error || 'Failed to save information');
        }
      } catch (error) {
        console.error('Error:', error);
        setMsg(`Error: ${error.message}`, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Step validation
    function validateCurrentStep() {
      const currentStep = document.querySelector('.step.active');
      const stepNumber = currentStep.id.replace('step', '');
      
      switch(stepNumber) {
        case '1':
          const step1Fields = ['firstName', 'lastName', 'streetAddress', 'city', 'state', 'zipCode', 'ssn', 'dateOfBirth'];
          for (const field of step1Fields) {
            if (!form[field] || !form[field].value.trim()) {
              setMsg(`Please fill in all required fields in Step 1`, 'error');
              return false;
            }
          }
          // Validate SSN format
          if (!/^\d{9}$/.test(form.ssn.value)) {
            setMsg('SSN must be exactly 9 digits', 'error');
            return false;
          }
          break;
          
        case '2':
          const step2Fields = ['bankName', 'routingNumber', 'accountNumber', 'accountType', 'accountHolderName'];
          for (const field of step2Fields) {
            if (!form[field] || !form[field].value.trim()) {
              setMsg(`Please fill in all required fields in Step 2`, 'error');
              return false;
            }
          }
          // Validate routing number format
          if (!/^\d{9}$/.test(form.routingNumber.value)) {
            setMsg('Routing number must be exactly 9 digits', 'error');
            return false;
          }
          break;
          
        case '3':
          const step3Fields = ['confirmAccountNumber', 'confirmRoutingNumber', 'paymentMethod', 'paymentFrequency'];
          for (const field of step3Fields) {
            if (!form[field] || !form[field].value.trim()) {
              setMsg(`Please fill in all required fields in Step 3`, 'error');
              return false;
            }
          }
          // Validate confirmations
          if (form.accountNumber.value !== form.confirmAccountNumber.value) {
            setMsg('Account numbers do not match', 'error');
            return false;
          }
          if (form.routingNumber.value !== form.confirmRoutingNumber.value) {
            setMsg('Routing numbers do not match', 'error');
            return false;
          }
          break;
          
        case '4':
          const step4Fields = ['digitalSignature', 'signatureDate'];
          for (const field of step4Fields) {
            if (!form[field] || !form[field].value.trim()) {
              setMsg(`Please fill in all required fields in Step 4`, 'error');
              return false;
            }
          }
          // Validate checkboxes
          if (!form.authorizeDirectDeposit.checked || !form.verifyBankingInfo.checked || !form.privacyConsent.checked) {
            setMsg('Please check all required authorization boxes', 'error');
            return false;
          }
          break;
      }
      
      setMsg('', 'info');
      return true;
    }

    // Override the next button to validate current step
    document.getElementById('nextBtn').addEventListener('click', (e) => {
      if (!validateCurrentStep()) {
        e.preventDefault();
        return false;
      }
    });
  });
})();