/* 
 * Customer Ratings & Reviews Carousel & Submission Controller
 * Fullwidth Edition:
 * - Multi-card responsive sliding carousel (4 cards on ultra-wide, 3 on desktop, 2 on tablet, 1 on mobile)
 * - Automatic smooth autoplay on page load (no manual toggle button required)
 * - Auto-pauses on hover and mobile touch interactions, resumes smoothly
 * - Interactive 5-star rating picker
 * - Live character counter
 * - Secure AJAX submission with instant carousel insertion
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const section = document.getElementById('customer-reviews');
    if (!section) return;

    // Carousel Elements
    const track = document.getElementById('reviewsTrack');
    const viewport = document.getElementById('reviewsViewport');
    const prevBtn = document.getElementById('revPrevBtn');
    const nextBtn = document.getElementById('revNextBtn');
    const dotsContainer = document.getElementById('revDotsContainer');
    const autoplayPill = document.getElementById('revAutoplayPill');

    // Form Elements
    const form = document.getElementById('reviewSubmitForm');
    const nameInput = document.getElementById('reviewNameInput');
    const commentInput = document.getElementById('reviewCommentInput');
    const ratingInput = document.getElementById('reviewRatingInput');
    const starLabel = document.getElementById('starRatingLabel');
    const stars = Array.from(document.querySelectorAll('.star-choice'));
    const charCounter = document.getElementById('reviewCharCounter');
    const alertBox = document.getElementById('reviewFormAlert');
    const submitBtn = document.getElementById('reviewSubmitBtn');

    // -------------------------------------------------------------
    // 1. FULLWIDTH CAROUSEL ENGINE (ALWAYS AUTOPLAYS ON PAGE LOAD)
    // -------------------------------------------------------------
    let slides = Array.from(track.querySelectorAll('.review-card-slide'));
    let currentIndex = 0;
    const autoplayDelay = 4500; // 4.5 seconds per slide transition
    let autoplayTimer = null;
    let isAutoplayActive = true;
    let isInteracting = false;

    function getVisibleCardsCount() {
      const width = window.innerWidth;
      if (width >= 1400) return 4;
      if (width >= 992) return 3;
      if (width >= 768) return 2;
      return 1;
    }

    function getMaxIndex() {
      const visible = getVisibleCardsCount();
      return Math.max(0, slides.length - visible);
    }

    function updateCarousel(instant = false) {
      if (slides.length === 0) return;
      const visible = getVisibleCardsCount();
      const maxIndex = getMaxIndex();

      if (currentIndex > maxIndex) {
        currentIndex = maxIndex;
      }
      if (currentIndex < 0) {
        currentIndex = 0;
      }

      // Calculate shift using card width and gap
      const cardWidth = slides[0].getBoundingClientRect().width;
      const gap = visible >= 2 ? 24 : 0;
      const shiftX = currentIndex * (cardWidth + gap);

      track.style.transition = instant ? 'none' : 'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      track.style.transform = `translateX(-${shiftX}px)`;

      // Update Navigation Buttons
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;

      // Update Dots
      updateDots();
    }

    function updateDots() {
      if (!dotsContainer) return;
      const visible = getVisibleCardsCount();
      const totalPages = Math.max(1, slides.length - visible + 1);

      dotsContainer.innerHTML = '';
      for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('button');
        dot.className = 'rev-dot' + (i === currentIndex ? ' active' : '');
        dot.setAttribute('type', 'button');
        dot.setAttribute('aria-label', `Go to review slide ${i + 1}`);
        dot.addEventListener('click', () => {
          isInteracting = true;
          currentIndex = i;
          updateCarousel();
          setTimeout(() => { isInteracting = false; }, 2000);
        });
        dotsContainer.appendChild(dot);
      }
    }

    function nextSlide() {
      const maxIndex = getMaxIndex();
      if (currentIndex >= maxIndex) {
        currentIndex = 0; // wrap around smoothly
      } else {
        currentIndex++;
      }
      updateCarousel();
    }

    function prevSlide() {
      const maxIndex = getMaxIndex();
      if (currentIndex <= 0) {
        currentIndex = maxIndex;
      } else {
        currentIndex--;
      }
      updateCarousel();
    }

    // Navigation Buttons
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        isInteracting = true;
        nextSlide();
        setTimeout(() => { isInteracting = false; }, 2500);
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        isInteracting = true;
        prevSlide();
        setTimeout(() => { isInteracting = false; }, 2500);
      });
    }

    // Autoplay Controls (Runs automatically on page load)
    function startAutoplay() {
      if (!isAutoplayActive) return;
      stopAutoplay();
      autoplayTimer = setInterval(() => {
        if (!isInteracting) {
          nextSlide();
        }
      }, autoplayDelay);
    }

    function stopAutoplay() {
      if (autoplayTimer) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
    }

    if (autoplayPill) {
      autoplayPill.addEventListener('click', () => {
        isAutoplayActive = !isAutoplayActive;
        if (isAutoplayActive) {
          isInteracting = false;
          startAutoplay();
        } else {
          stopAutoplay();
        }
      });
    }

    // Pause on Hover & Resume on Leave
    viewport.addEventListener('mouseenter', () => { isInteracting = true; });
    viewport.addEventListener('mouseleave', () => { isInteracting = false; });

    // Mobile Touch Swipe Handling
    let touchStartX = 0;
    let touchDeltaX = 0;
    let isSwiping = false;

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isSwiping = true;
      touchStartX = e.touches[0].clientX;
      touchDeltaX = 0;
      isInteracting = true;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (!isSwiping || e.touches.length !== 1) return;
      touchDeltaX = e.touches[0].clientX - touchStartX;
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
      if (!isSwiping) return;
      isSwiping = false;
      const threshold = 40;
      if (touchDeltaX < -threshold) {
        nextSlide();
      } else if (touchDeltaX > threshold) {
        prevSlide();
      }
      setTimeout(() => { isInteracting = false; }, 1500);
    });

    // Window Resize Event
    window.addEventListener('resize', () => {
      updateCarousel(true);
    });

    // Initialize & Start Autoplay immediately on page load
    updateCarousel(true);
    startAutoplay();

    // -------------------------------------------------------------
    // 2. INTERACTIVE STAR RATING PICKER
    // -------------------------------------------------------------
    const ratingLabels = {
      1: '1 Star - Needs Improvement',
      2: '2 Stars - Fair',
      3: '3 Stars - Helpful Conversation',
      4: '4 Stars - Very Warm & Comforting',
      5: '5 Stars - Truly Wonderful & Heartwarming!'
    };

    let currentSelectedRating = 5;

    function renderStarStates(highlightUpTo) {
      stars.forEach(star => {
        const val = parseInt(star.dataset.rating, 10);
        if (val <= highlightUpTo) {
          star.classList.add('selected');
        } else {
          star.classList.remove('selected');
        }
      });
      if (starLabel) {
        starLabel.textContent = ratingLabels[highlightUpTo] || `${highlightUpTo} Stars`;
      }
    }

    stars.forEach(star => {
      star.addEventListener('mouseenter', () => {
        const val = parseInt(star.dataset.rating, 10);
        renderStarStates(val);
      });

      star.addEventListener('mouseleave', () => {
        renderStarStates(currentSelectedRating);
      });

      star.addEventListener('click', () => {
        currentSelectedRating = parseInt(star.dataset.rating, 10);
        if (ratingInput) ratingInput.value = currentSelectedRating;
        renderStarStates(currentSelectedRating);
      });
    });

    // Initialize with 5 stars
    renderStarStates(5);

    // -------------------------------------------------------------
    // 3. CHARACTER COUNTER
    // -------------------------------------------------------------
    if (commentInput && charCounter) {
      commentInput.addEventListener('input', () => {
        const len = commentInput.value.length;
        charCounter.textContent = `${len} / 600 characters`;
        if (len > 600) {
          charCounter.classList.add('text-danger');
        } else {
          charCounter.classList.remove('text-danger');
        }
      });
    }

    // -------------------------------------------------------------
    // 4. SECURE AJAX FORM SUBMISSION
    // -------------------------------------------------------------
    function showAlert(msg, isSuccess = true) {
      if (!alertBox) return;
      alertBox.className = `alert ${isSuccess ? 'alert-success' : 'alert-danger'} review-alert py-2.5 px-3`;
      alertBox.innerHTML = `<i class="bi ${isSuccess ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-2"></i> ${msg}`;
      alertBox.style.display = 'block';

      if (isSuccess) {
        setTimeout(() => {
          alertBox.style.display = 'none';
        }, 8000);
      }
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameInput ? nameInput.value.trim() : '';
        const comment = commentInput ? commentInput.value.trim() : '';
        const rating = ratingInput ? parseInt(ratingInput.value, 10) : 5;
        const honeypot = form.querySelector('input[name="hp_website"]') ? form.querySelector('input[name="hp_website"]').value : '';

        // Frontend Validation
        if (!name || name.length < 2) {
          showAlert('Please enter your name (minimum 2 characters).', false);
          if (nameInput) nameInput.focus();
          return;
        }

        if (!comment || comment.length < 5) {
          showAlert('Please write a few words about your experience (minimum 5 characters).', false);
          if (commentInput) commentInput.focus();
          return;
        }

        if (comment.length > 600) {
          showAlert('Review is too long (maximum 600 characters).', false);
          return;
        }

        // Disable button & show spinner
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Submitting...';

        try {
          const res = await fetch('/api/reviews', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              name,
              rating,
              comment,
              honeypot
            })
          });

          const data = await res.json();

          if (res.ok && data.success) {
            showAlert(data.message || 'Thank you! Your review has been published.', true);
            form.reset();
            renderStarStates(5);
            currentSelectedRating = 5;
            if (charCounter) charCounter.textContent = '0 / 600 characters';

            // Insert new review card dynamically into the carousel!
            const newRev = data.review;
            if (newRev && track) {
              const slide = createReviewCardElement(newRev);
              track.insertBefore(slide, track.firstChild);
              slides = Array.from(track.querySelectorAll('.review-card-slide'));

              // Jump to first slide so user sees their new review
              currentIndex = 0;
              updateCarousel();
            }
          } else {
            showAlert(data.message || 'Could not submit your review. Please try again.', false);
          }
        } catch (err) {
          console.error('[Review Submit Error]', err);
          showAlert('Network error. Please check your connection and try again.', false);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      });
    }

    // Helper: Build DOM card for newly submitted review
    function createReviewCardElement(review) {
      const slide = document.createElement('div');
      slide.className = 'review-card-slide';

      const initial = review.name ? review.name.charAt(0).toUpperCase() : 'U';
      const color = review.avatarColor || '#1769E0';
      const badge = review.badge || 'Verified Conversation';

      let starsHtml = '';
      for (let i = 1; i <= 5; i++) {
        if (i <= review.rating) {
          starsHtml += '<i class="bi bi-star-fill text-warning"></i>';
        } else {
          starsHtml += '<i class="bi bi-star text-muted"></i>';
        }
      }

      slide.innerHTML = `
        <div class="review-card">
          <i class="bi bi-quote review-quote-icon"></i>
          <div>
            <div class="review-card-top">
              <div class="review-stars">${starsHtml}</div>
              <span class="review-verified-badge"><i class="bi bi-patch-check-fill"></i> ${badge}</span>
            </div>
            <div class="review-comment-body">
              <p class="review-comment-text">"${escapeHtml(review.comment)}"</p>
            </div>
          </div>
          <div class="review-author-row">
            <div class="review-avatar-circle" style="background: ${color};">
              ${initial}
            </div>
            <div class="review-author-info">
              <h6 class="review-author-name">${escapeHtml(review.name)}</h6>
              <span class="review-author-tag">Just now • Verified</span>
            </div>
          </div>
        </div>
      `;

      return slide;
    }

    function escapeHtml(text) {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  });
})();
