/* 
 * Video Carousel Interactive Controller
 * Features:
 * - Autoplay with visual countdown progress bar
 * - Muted previews for universal browser policy compliance
 * - On-demand unmuting with audio indicator
 * - Smooth hardware-accelerated CSS transitions
 * - Responsive touch swipe gestures for mobile
 * - Viewport visibility observer (pauses offscreen to save battery/data)
 * - Expandable full-screen preview modal
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const wrapper = document.querySelector('.video-carousel-wrapper');
    if (!wrapper) return;

    const track = document.getElementById('vcTrack');
    const slides = Array.from(wrapper.querySelectorAll('.vc-slide'));
    const prevBtn = document.getElementById('vcPrevBtn');
    const nextBtn = document.getElementById('vcNextBtn');
    const paginationContainer = document.getElementById('vcPagination');
    const autoplayToggleBtn = document.getElementById('vcAutoplayToggle');
    const currentNumEl = document.getElementById('vcCurrentNum');

    if (!track || slides.length === 0) return;

    const totalSlides = slides.length;
    let currentIndex = 0;
    const slideDuration = 6500; // 6.5s per slide
    let isAutoplayActive = true;
    let isUserInteracting = false;
    let isOffscreen = false;

    // Progress Animation Variables
    let progressStartTime = null;
    let progressElapsed = 0;
    let progressAnimFrame = null;

    // Build Pagination Dots
    paginationContainer.innerHTML = '';
    const dots = [];
    slides.forEach((slide, idx) => {
      const dot = document.createElement('button');
      dot.className = 'vc-dot' + (idx === 0 ? ' active' : '');
      dot.setAttribute('type', 'button');
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', 'Go to slide ' + (idx + 1));
      dot.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      dot.dataset.index = idx;

      const fill = document.createElement('span');
      fill.className = 'vc-dot-fill';
      dot.appendChild(fill);

      dot.addEventListener('click', () => {
        isUserInteracting = true;
        goToSlide(idx, true);
      });

      paginationContainer.appendChild(dot);
      dots.push(dot);
    });

    // Helper: format seconds to M:SS
    function formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return '0:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // Set up Video Elements on all slides
    slides.forEach((slide, idx) => {
      const video = slide.querySelector('.vc-video');
      const videoBox = slide.querySelector('.vc-video-box');
      const soundBtn = slide.querySelector('.vc-btn-sound');
      const playBtn = slide.querySelector('.vc-btn-play-pause');
      const timeDisplay = slide.querySelector('.vc-time-display');
      const progressFill = slide.querySelector('.vc-video-progress-fill');
      const progressTrack = slide.querySelector('.vc-video-progress-track');
      const expandBtn = slide.querySelector('.vc-btn-expand');
      const openModalBtn = slide.querySelector('.vc-open-modal-btn');
      const centerActionBtn = slide.querySelector('.vc-center-action-btn');

      if (!video) return;

      // Ensure initial states
      video.muted = true;
      video.playsInline = true;
      video.loop = true;

      // Update time and progress scrubber
      video.addEventListener('timeupdate', () => {
        if (!timeDisplay) return;
        const cur = video.currentTime;
        const dur = video.duration || 0;
        timeDisplay.textContent = formatTime(cur) + ' / ' + formatTime(dur);

        if (progressFill && dur > 0) {
          const pct = (cur / dur) * 100;
          progressFill.style.width = pct + '%';
        }
      });

      // Click on mini progress track to seek
      if (progressTrack) {
        progressTrack.addEventListener('click', (e) => {
          e.stopPropagation();
          const rect = progressTrack.getBoundingClientRect();
          const clickPos = (e.clientX - rect.left) / rect.width;
          if (video.duration) {
            video.currentTime = clickPos * video.duration;
          }
        });
      }

      // Sound Toggle
      if (soundBtn) {
        soundBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          isUserInteracting = true;
          pauseAutoplay();

          video.muted = !video.muted;
          updateSoundUI(soundBtn, video.muted);
        });
      }

      // Play / Pause Toggle
      function toggleVideoPlay(e) {
        if (e) e.stopPropagation();
        if (video.paused) {
          video.play();
          if (playBtn) playBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
          if (videoBox) videoBox.classList.remove('is-paused');
          if (centerActionBtn) centerActionBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
        } else {
          video.pause();
          isUserInteracting = true;
          pauseAutoplay();
          if (playBtn) playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
          if (videoBox) videoBox.classList.add('is-paused');
          if (centerActionBtn) centerActionBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
        }
      }

      if (playBtn) playBtn.addEventListener('click', toggleVideoPlay);
      if (centerActionBtn) centerActionBtn.addEventListener('click', toggleVideoPlay);

      // Expand / Modal Launchers
      function handleOpenModal(e) {
        if (e) e.stopPropagation();
        openVideoModal(idx);
      }

      if (expandBtn) expandBtn.addEventListener('click', handleOpenModal);
      if (openModalBtn) openModalBtn.addEventListener('click', handleOpenModal);
    });

    function updateSoundUI(btn, isMuted) {
      if (!btn) return;
      const tooltip = btn.querySelector('.vc-sound-tooltip');
      if (isMuted) {
        btn.innerHTML = '<i class="bi bi-volume-mute-fill"></i><span class="vc-sound-tooltip">Click to Unmute</span>';
        btn.setAttribute('aria-label', 'Unmute audio');
      } else {
        btn.innerHTML = '<i class="bi bi-volume-up-fill"></i><span class="vc-sound-tooltip">Audio Playing • Click to Mute</span>';
        btn.setAttribute('aria-label', 'Mute audio');
      }
    }

    // Slide Switching Logic
    function goToSlide(targetIndex, userAction = false) {
      if (targetIndex < 0) {
        targetIndex = totalSlides - 1;
      } else if (targetIndex >= totalSlides) {
        targetIndex = 0;
      }

      if (targetIndex === currentIndex && !userAction) return;

      // 1. Pause and clean up current slide video
      const currentSlide = slides[currentIndex];
      if (currentSlide) {
        const curVideo = currentSlide.querySelector('.vc-video');
        if (curVideo) {
          curVideo.pause();
          curVideo.muted = true; // reset mute
        }
        const curSoundBtn = currentSlide.querySelector('.vc-btn-sound');
        if (curSoundBtn) updateSoundUI(curSoundBtn, true);
        currentSlide.classList.remove('active');
      }

      // 2. Clear dot fill on previous slide
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === targetIndex);
        dot.setAttribute('aria-selected', i === targetIndex ? 'true' : 'false');
        const fill = dot.querySelector('.vc-dot-fill');
        if (fill) fill.style.width = '0%';
      });

      // 3. Move Track
      currentIndex = targetIndex;
      track.style.transform = `translateX(-${currentIndex * 100}%)`;

      // 4. Activate new slide
      const newSlide = slides[currentIndex];
      newSlide.classList.add('active');

      // Update counter
      if (currentNumEl) {
        currentNumEl.textContent = (currentIndex + 1 < 10 ? '0' : '') + (currentIndex + 1);
      }

      // 5. Play video if not offscreen
      const newVideo = newSlide.querySelector('.vc-video');
      const newVideoBox = newSlide.querySelector('.vc-video-box');
      const newPlayBtn = newSlide.querySelector('.vc-btn-play-pause');

      if (newVideo) {
        if (!isOffscreen) {
          newVideo.currentTime = 0;
          const playPromise = newVideo.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              // Browser autoplay policy might restrict without user interaction
              if (newVideoBox) newVideoBox.classList.add('is-paused');
            });
          }
        }
        if (newPlayBtn) newPlayBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
        if (newVideoBox) newVideoBox.classList.remove('is-paused');
      }

      // 6. Preload next slide's video for instant zero-buffer transition
      const nextIdx = (currentIndex + 1) % totalSlides;
      const nextVid = slides[nextIdx].querySelector('.vc-video');
      if (nextVid && nextVid.preload === 'none') {
        nextVid.preload = 'metadata';
      }

      // 7. Restart progress timer
      resetProgress();
    }

    // Progress Bar Animation
    function startProgress() {
      if (!isAutoplayActive || isUserInteracting || isOffscreen) return;
      cancelAnimationFrame(progressAnimFrame);
      progressStartTime = performance.now() - progressElapsed;

      function frame(now) {
        progressElapsed = now - progressStartTime;
        const pct = Math.min((progressElapsed / slideDuration) * 100, 100);

        const activeDot = dots[currentIndex];
        if (activeDot) {
          const fill = activeDot.querySelector('.vc-dot-fill');
          if (fill) fill.style.width = pct + '%';
        }

        if (progressElapsed >= slideDuration) {
          progressElapsed = 0;
          goToSlide(currentIndex + 1);
        } else {
          progressAnimFrame = requestAnimationFrame(frame);
        }
      }

      progressAnimFrame = requestAnimationFrame(frame);
    }

    function pauseProgress() {
      cancelAnimationFrame(progressAnimFrame);
    }

    function resetProgress() {
      pauseProgress();
      progressElapsed = 0;
      dots.forEach((dot, i) => {
        const fill = dot.querySelector('.vc-dot-fill');
        if (fill) fill.style.width = (i === currentIndex ? '0%' : '0%');
      });
      if (isAutoplayActive && !isUserInteracting && !isOffscreen) {
        startProgress();
      }
    }

    function pauseAutoplay() {
      isAutoplayActive = false;
      pauseProgress();
      if (autoplayToggleBtn) {
        autoplayToggleBtn.classList.add('is-paused');
        autoplayToggleBtn.innerHTML = '<i class="bi bi-play-circle-fill"></i> <span class="vc-autoplay-label">Resume Autoplay</span>';
      }
    }

    function resumeAutoplay() {
      isAutoplayActive = true;
      isUserInteracting = false;
      if (autoplayToggleBtn) {
        autoplayToggleBtn.classList.remove('is-paused');
        autoplayToggleBtn.innerHTML = '<i class="bi bi-pause-circle-fill"></i> <span class="vc-autoplay-label">Autoplay On</span>';
      }
      startProgress();
    }

    // Autoplay Button Toggle
    if (autoplayToggleBtn) {
      autoplayToggleBtn.addEventListener('click', () => {
        if (isAutoplayActive) {
          pauseAutoplay();
        } else {
          resumeAutoplay();
        }
      });
    }

    // Navigation Arrow Buttons
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        isUserInteracting = true;
        goToSlide(currentIndex - 1, true);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        isUserInteracting = true;
        goToSlide(currentIndex + 1, true);
      });
    }

    // Hover & Mouse Interaction: Pause on hover, resume on leave
    wrapper.addEventListener('mouseenter', () => {
      pauseProgress();
    });

    wrapper.addEventListener('mouseleave', () => {
      if (isAutoplayActive && !isUserInteracting && !isOffscreen) {
        startProgress();
      }
    });

    // Mobile Touch Swipe Handling
    let touchStartX = 0;
    let touchStartY = 0;
    let touchDeltaX = 0;
    let isTouching = false;

    wrapper.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isTouching = true;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchDeltaX = 0;
      pauseProgress();
    }, { passive: true });

    wrapper.addEventListener('touchmove', (e) => {
      if (!isTouching || e.touches.length !== 1) return;
      touchDeltaX = e.touches[0].clientX - touchStartX;
    }, { passive: true });

    wrapper.addEventListener('touchend', () => {
      if (!isTouching) return;
      isTouching = false;
      const swipeThreshold = 45;

      if (touchDeltaX < -swipeThreshold) {
        // Swiped Left -> Next
        isUserInteracting = true;
        goToSlide(currentIndex + 1, true);
      } else if (touchDeltaX > swipeThreshold) {
        // Swiped Right -> Prev
        isUserInteracting = true;
        goToSlide(currentIndex - 1, true);
      } else {
        // Tap or small drag -> resume
        if (isAutoplayActive && !isUserInteracting && !isOffscreen) {
          startProgress();
        }
      }
    });

    // Keyboard Navigation (Arrow Keys)
    wrapper.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        isUserInteracting = true;
        goToSlide(currentIndex - 1, true);
      } else if (e.key === 'ArrowRight') {
        isUserInteracting = true;
        goToSlide(currentIndex + 1, true);
      } else if (e.key === ' ') {
        e.preventDefault();
        const activeSlide = slides[currentIndex];
        const playBtn = activeSlide.querySelector('.vc-btn-play-pause');
        if (playBtn) playBtn.click();
      }
    });

    // Optimized Video Loading via IntersectionObserver (Conserves CPU/Battery)
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const activeVideo = slides[currentIndex].querySelector('.vc-video');
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
            isOffscreen = false;
            if (activeVideo && activeVideo.paused && !isUserInteracting) {
              activeVideo.play().catch(() => {});
            }
            if (isAutoplayActive && !isUserInteracting) {
              startProgress();
            }
          } else {
            isOffscreen = true;
            if (activeVideo && !activeVideo.paused) {
              activeVideo.pause();
            }
            pauseProgress();
          }
        });
      }, { threshold: [0, 0.25, 0.5] });

      observer.observe(wrapper);
    }

    // Modal Full Preview Experience
    const modalEl = document.getElementById('vcPreviewModal');
    let bsModalInstance = null;
    if (modalEl && typeof bootstrap !== 'undefined') {
      bsModalInstance = new bootstrap.Modal(modalEl);

      modalEl.addEventListener('hidden.bs.modal', function () {
        const modalVideo = document.getElementById('vcModalVideo');
        if (modalVideo) {
          modalVideo.pause();
          modalVideo.src = '';
        }
        // Resume carousel slide video
        const activeVideo = slides[currentIndex].querySelector('.vc-video');
        if (activeVideo && !isOffscreen) {
          activeVideo.play().catch(() => {});
        }
        if (isAutoplayActive && !isUserInteracting && !isOffscreen) {
          startProgress();
        }
      });
    }

    function openVideoModal(slideIdx) {
      const slide = slides[slideIdx];
      if (!slide || !modalEl) return;

      pauseAutoplay();
      const currentVideo = slides[currentIndex].querySelector('.vc-video');
      if (currentVideo) currentVideo.pause();

      const modalVideo = document.getElementById('vcModalVideo');
      const modalTitle = document.getElementById('vcModalTitle');
      const modalDesc = document.getElementById('vcModalDesc');
      const modalTag = document.getElementById('vcModalTag');

      const titleText = slide.querySelector('.vc-slide-title') ? slide.querySelector('.vc-slide-title').textContent : 'Story Preview';
      const descText = slide.querySelector('.vc-slide-desc') ? slide.querySelector('.vc-slide-desc').textContent : '';
      const tagText = slide.querySelector('.vc-topic-tag') ? slide.querySelector('.vc-topic-tag').innerHTML : '';
      const videoSrc = slide.querySelector('.vc-video source') ? slide.querySelector('.vc-video source').getAttribute('src') : '';

      if (modalTitle) modalTitle.textContent = titleText;
      if (modalDesc) modalDesc.textContent = descText;
      if (modalTag) modalTag.innerHTML = tagText;

      if (modalVideo && videoSrc) {
        modalVideo.src = videoSrc;
        modalVideo.muted = false; // full sound in modal
        modalVideo.controls = true;
        modalVideo.play().catch(() => {});
      }

      if (bsModalInstance) {
        bsModalInstance.show();
      }
    }

    // Initialize first slide
    goToSlide(0);
  });
})();
