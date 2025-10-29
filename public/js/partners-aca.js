// Partners ACA Page JavaScript
(function() {
    'use strict';

    // Currency formatter
    const currencyFormatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });

    // Analytics helper
    function track(event, properties = {}) {
        try {
            // Support for different analytics providers
            if (typeof window.analytics !== 'undefined' && window.analytics.track) {
                window.analytics.track(event, properties);
            } else if (typeof window.gtag !== 'undefined') {
                window.gtag('event', event, properties);
            } else if (typeof window.dataLayer !== 'undefined') {
                window.dataLayer.push({
                    event: event,
                    ...properties
                });
            }
        } catch (error) {
            console.warn('Analytics tracking failed:', error);
        }
    }

    // Calculator functionality
    class SavingsCalculator {
        constructor() {
            this.inputs = {
                agents: document.getElementById('agents'),
                hireCost: document.getElementById('hireCost'),
                appsPerDay: document.getElementById('appsPerDay'),
                oepDays: document.getElementById('oepDays'),
                inhousePay: document.getElementById('inhousePay'),
                perenrollUpfront: document.getElementById('perenrollUpfront'),
                perenrollBackend: document.getElementById('perenrollBackend'),
                persistency: document.getElementById('persistency'),
                months: document.getElementById('months')
            };

            this.outputs = {
                inhouseNear: document.getElementById('inhouseNear'),
                perenrollNear: document.getElementById('perenrollNear'),
                savings: document.getElementById('savings'),
                backendMonthly: document.getElementById('backendMonthly'),
                backendTotal: document.getElementById('backendTotal'),
                // KPI summary on top
                inhouseNearTop: document.getElementById('inhouseNearTop'),
                perenrollNearTop: document.getElementById('perenrollNearTop'),
                savingsHeadline: document.getElementById('savingsHeadline')
            };

            this.init();
        }

        init() {
            // Add event listeners to all inputs
            Object.values(this.inputs).forEach(input => {
                input.addEventListener('input', () => this.calculate());
                input.addEventListener('change', () => this.calculate());
            });

            // Initial calculation
            this.calculate();
        }

        calculate() {
            try {
                // Get input values
                const agents = parseFloat(this.inputs.agents.value) || 0;
                const hireCost = parseFloat(this.inputs.hireCost.value) || 0;
                const appsPerDay = parseFloat(this.inputs.appsPerDay.value) || 0;
                const oepDays = parseFloat(this.inputs.oepDays.value) || 0;
                const inhousePay = parseFloat(this.inputs.inhousePay.value) || 0;
                const perenrollUpfront = parseFloat(this.inputs.perenrollUpfront.value) || 0;
                const perenrollBackend = parseFloat(this.inputs.perenrollBackend.value) || 0;
                const persistency = parseFloat(this.inputs.persistency.value) || 0;
                const months = parseFloat(this.inputs.months.value) || 0;

                // Calculate totals
                const totalApps = agents * appsPerDay * oepDays;
                const inhouseNear = (agents * hireCost) + (inhousePay * totalApps);
                const perenrollNear = perenrollUpfront * totalApps;
                const savings = inhouseNear - perenrollNear;
                const activePolicies = totalApps * (persistency / 100);
                const backendMonthly = activePolicies * perenrollBackend;
                const backendTotal = backendMonthly * months;

                // Update display
                const inhouseNearFmt = currencyFormatter.format(inhouseNear);
                const perenrollNearFmt = currencyFormatter.format(perenrollNear);
                const savingsFmt = currencyFormatter.format(savings);

                this.outputs.inhouseNear.textContent = inhouseNearFmt;
                this.outputs.perenrollNear.textContent = perenrollNearFmt;
                this.outputs.savings.textContent = savingsFmt;
                this.outputs.backendMonthly.textContent = currencyFormatter.format(backendMonthly);
                this.outputs.backendTotal.textContent = currencyFormatter.format(backendTotal);

                if (this.outputs.inhouseNearTop) this.outputs.inhouseNearTop.textContent = inhouseNearFmt;
                if (this.outputs.perenrollNearTop) this.outputs.perenrollNearTop.textContent = perenrollNearFmt;
                if (this.outputs.savingsHeadline) this.outputs.savingsHeadline.textContent = savingsFmt;

                // Track calculator usage
                track('calculator_change', {
                    agents,
                    totalApps,
                    inhouseNear,
                    perenrollNear,
                    savings,
                    persistency,
                    months
                });

            } catch (error) {
                console.error('Calculator error:', error);
            }
        }
    }

    // Accordion functionality
    class FAQAccordion {
        constructor() {
            this.faqItems = document.querySelectorAll('.faq-item');
            this.init();
        }

        init() {
            this.faqItems.forEach(item => {
                const button = item.querySelector('.faq-question');
                const answer = item.querySelector('.faq-answer');

                button.addEventListener('click', () => {
                    const isExpanded = button.getAttribute('aria-expanded') === 'true';
                    
                    // Close all other items
                    this.faqItems.forEach(otherItem => {
                        if (otherItem !== item) {
                            const otherButton = otherItem.querySelector('.faq-question');
                            const otherAnswer = otherItem.querySelector('.faq-answer');
                            otherButton.setAttribute('aria-expanded', 'false');
                            otherAnswer.classList.remove('active');
                        }
                    });

                    // Toggle current item
                    if (isExpanded) {
                        button.setAttribute('aria-expanded', 'false');
                        answer.classList.remove('active');
                    } else {
                        button.setAttribute('aria-expanded', 'true');
                        answer.classList.add('active');
                    }
                });

                // Keyboard support
                button.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        button.click();
                    }
                });
            });
        }
    }

    // Form submission
    class LeadForm {
        constructor() {
            this.form = document.getElementById('partners-lead-form');
            this.statusElement = document.getElementById('form-status');
            this.init();
        }

        init() {
            if (this.form) {
                this.form.addEventListener('submit', (e) => this.handleSubmit(e));
            }
        }

        async handleSubmit(e) {
            e.preventDefault();
            
            const formData = new FormData(this.form);
            const data = {
                name: formData.get('name'),
                email: formData.get('email'),
                phone: formData.get('phone'),
                company: formData.get('company'),
                states: formData.get('states')
            };

            // Client-side validation
            if (!this.validateForm(data)) {
                return;
            }

            // Show loading state
            this.showStatus('Submitting...', 'loading');

            try {
                const response = await fetch('/api/partners/lead', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (response.ok && result.ok) {
                    this.showStatus('Thank you! We\'ll be in touch soon.', 'success');
                    this.form.reset();
                    
                    // Track successful submission
                    track('lead_submitted', {
                        source: 'partners_aca'
                    });
                } else {
                    throw new Error(result.error || 'Submission failed');
                }
            } catch (error) {
                console.error('Form submission error:', error);
                this.showStatus('Sorry, there was an error. Please try again or contact us directly.', 'error');
            }
        }

        validateForm(data) {
            const requiredFields = ['name', 'email', 'company'];
            const missingFields = requiredFields.filter(field => !data[field] || data[field].trim() === '');

            if (missingFields.length > 0) {
                this.showStatus(`Please fill in all required fields: ${missingFields.join(', ')}`, 'error');
                return false;
            }

            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.email)) {
                this.showStatus('Please enter a valid email address', 'error');
                return false;
            }

            return true;
        }

        showStatus(message, type) {
            this.statusElement.textContent = message;
            this.statusElement.className = `form-status ${type}`;
            
            // Clear status after 5 seconds for success/error
            if (type === 'success' || type === 'error') {
                setTimeout(() => {
                    this.statusElement.textContent = '';
                    this.statusElement.className = 'form-status';
                }, 5000);
            }
        }
    }

    // Smooth scrolling for anchor links
    class SmoothScrolling {
        constructor() {
            this.init();
        }

        init() {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    const target = document.querySelector(anchor.getAttribute('href'));
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                });
            });
        }
    }

    // Mobile menu functionality
    class MobileMenu {
        constructor() {
            this.toggle = document.getElementById('mobile-menu-toggle');
            this.menu = document.getElementById('mobile-menu');
            this.init();
        }

        init() {
            if (this.toggle && this.menu) {
                this.toggle.addEventListener('click', () => {
                    this.menu.classList.toggle('active');
                });

                // Close menu when clicking on links
                const menuLinks = this.menu.querySelectorAll('a');
                menuLinks.forEach(link => {
                    link.addEventListener('click', () => {
                        this.menu.classList.remove('active');
                    });
                });

                // Close menu when clicking outside
                document.addEventListener('click', (e) => {
                    if (!this.toggle.contains(e.target) && !this.menu.contains(e.target)) {
                        this.menu.classList.remove('active');
                    }
                });
            }
        }
    }

    // Intersection Observer for animations
    class ScrollAnimations {
        constructor() {
            this.init();
        }

        init() {
            // Only add animations if user hasn't requested reduced motion
            if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
                this.observeElements();
            }
        }

        observeElements() {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animate-in');
                    }
                });
            }, {
                threshold: 0.1,
                rootMargin: '0px 0px -50px 0px'
            });

            // Observe elements that should animate
            const animateElements = document.querySelectorAll('.value-card, .step-card, .comparison-card, .faq-item');
            animateElements.forEach(el => observer.observe(el));
        }
    }

    // CTA tracking
    class CTATracking {
        constructor() {
            this.init();
        }

        init() {
            // Track CTA clicks
            document.querySelectorAll('.cta-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const location = this.getCTALocation(e.target);
                    const label = e.target.textContent.trim();
                    
                    track('cta_click', {
                        location,
                        label
                    });
                });
            });
        }

        getCTALocation(element) {
            // Determine CTA location based on element's position in DOM
            if (element.closest('.hero')) return 'hero';
            if (element.closest('.final-cta')) return 'final';
            return 'body';
        }
    }

    // Initialize everything when DOM is ready
    function init() {
        try {
            new SavingsCalculator();
            new FAQAccordion();
            new LeadForm();
            new SmoothScrolling();
            new MobileMenu();
            new ScrollAnimations();
            new CTATracking();
        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
