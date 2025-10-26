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

  function nextStep() {
    if (currentStep < steps.length - 1) {
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

  // Load form content
  async function loadFormContent() {
    const intakeRes = await fetch('/intake.html');
    const intakeHtml = await intakeRes.text();
    const intakeForm = new DOMParser().parseFromString(intakeHtml, 'text/html').querySelector('#intakeForm');
    document.getElementById('intake-form-step').append(...intakeForm.children);

    const w9Res = await fetch('/w9.html');
    const w9Html = await w9Res.text();
    const w9Form = new DOMParser().parseFromString(w9Html, 'text/html').querySelector('#w9Form');
    document.getElementById('w9-form-step').append(...w9Form.children);

    const bankingRes = await fetch('/banking.html');
    const bankingHtml = await bankingRes.text();
    const bankingForm = new DOMParser().parseFromString(bankingHtml, 'text/html').querySelector('#bankingForm');
    document.getElementById('banking-form-step').append(...bankingForm.children);
  }

  loadFormContent().then(() => {
    showStep(currentStep);
  });
});
