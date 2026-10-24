/* 
 * Contact Us Interactive Form Controller
 * Features:
 * - Real-time client-side input validation
 * - Dynamic character count for message
 * - Duplicate submission prevention
 * - AJAX submission to backend EmailJS API
 * - Accessible success and error alert banners
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('contactForm');
    if (!form) return;

    const nameInput = document.getElementById('contactName');
    const emailInput = document.getElementById('contactEmail');
    const phoneInput = document.getElementById('contactPhone');
    const subjectInput = document.getElementById('contactSubject');
    const messageInput = document.getElementById('contactMessage');
    const submitBtn = document.getElementById('contactSubmitBtn');
    const alertBox = document.getElementById('contactAlert');
    const charCounter = document.getElementById('contactCharCounter');

    let isSubmitting = false;

    // Helper: Show Alert
    function showAlert(message, isSuccess = true) {
      if (!alertBox) return;
      alertBox.className = `alert ${isSuccess ? 'alert-success' : 'alert-danger'} contact-alert mb-4 shadow-sm`;
      alertBox.innerHTML = `
        <div class="d-flex align-items-center">
          <i class="bi ${isSuccess ? 'bi-check-circle-fill text-success' : 'bi-exclamation-triangle-fill text-danger'} fs-4 me-3"></i>
          <div>
            <strong>${isSuccess ? 'Message Sent!' : 'Submission Issue'}</strong>
            <div class="small mt-0.5">${message}</div>
          </div>
        </div>
      `;
      alertBox.style.display = 'block';

      // Scroll smoothly to alert box
      alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      if (isSuccess) {
        setTimeout(() => {
          alertBox.style.display = 'none';
        }, 10000);
      }
    }

    // Live Character Counter
    if (messageInput && charCounter) {
      messageInput.addEventListener('input', function () {
        const len = this.value.length;
        charCounter.textContent = `${len} / 2000 characters`;
        if (len > 2000) {
          charCounter.classList.add('text-danger');
        } else {
          charCounter.classList.remove('text-danger');
        }
      });
    }

    // Validation Helpers
    function isValidEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function isValidPhone(phone) {
      const clean = phone.replace(/[^0-9+]/g, '');
      return clean.length >= 7 && clean.length <= 20;
    }

    // Input blur validation
    [nameInput, emailInput, phoneInput, subjectInput, messageInput].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', function () {
        this.classList.remove('is-invalid');
      });
    });

    // Form Submission Handler
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (isSubmitting) return;

      const name = nameInput ? nameInput.value.trim() : '';
      const email = emailInput ? emailInput.value.trim() : '';
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const subject = subjectInput ? subjectInput.value.trim() : '';
      const message = messageInput ? messageInput.value.trim() : '';
      const honeypot = form.querySelector('input[name="hp_website"]') ? form.querySelector('input[name="hp_website"]').value : '';

      // Client-Side Validation
      if (!name || name.length < 2) {
        if (nameInput) nameInput.classList.add('is-invalid');
        showAlert('Please enter your full name (minimum 2 characters).', false);
        if (nameInput) nameInput.focus();
        return;
      }

      if (!email || !isValidEmail(email)) {
        if (emailInput) emailInput.classList.add('is-invalid');
        showAlert('Please enter a valid email address so we can reply to you.', false);
        if (emailInput) emailInput.focus();
        return;
      }

      if (!phone || !isValidPhone(phone)) {
        if (phoneInput) phoneInput.classList.add('is-invalid');
        showAlert('Please provide a valid contact phone number (at least 7 digits).', false);
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (!subject || subject.length < 2) {
        if (subjectInput) subjectInput.classList.add('is-invalid');
        showAlert('Please enter a subject for your inquiry.', false);
        if (subjectInput) subjectInput.focus();
        return;
      }

      if (!message || message.length < 10) {
        if (messageInput) messageInput.classList.add('is-invalid');
        showAlert('Please write a message with at least 10 characters.', false);
        if (messageInput) messageInput.focus();
        return;
      }

      if (message.length > 2000) {
        showAlert('Message exceeds maximum limit of 2000 characters.', false);
        return;
      }

      // Lock button & show loading spinner
      isSubmitting = true;
      const originalBtnHtml = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Sending Message...';

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            name,
            email,
            phone,
            subject,
            message,
            hp_website: honeypot
          })
        });

        const result = await response.json();

        if (response.ok && result.success) {
          showAlert(result.message || 'Thank you! Your message has been sent successfully. We will get back to you shortly.', true);
          form.reset();
          if (charCounter) charCounter.textContent = '0 / 2000 characters';
        } else {
          showAlert(result.message || 'Unable to send message. Please review your input and try again.', false);
        }
      } catch (err) {
        console.error('[Contact Form Error]', err);
        showAlert('Network communication error. Please check your internet connection and try again.', false);
      } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    });
  });
})();
