/*
 * Custom Interactive JavaScript
 * Emotional Support & Voice Calling Platform
 */

$(document).ready(function () {
  // Synchronize Credit Balances across UI Elements
  function updateUIBalances() {
    if (window.sessionUser) {
      $(".simulated-balance").text(window.sessionUser.credits);
      $(".simulated-name").text(window.sessionUser.name);
      $(".simulated-phone").text(window.sessionUser.mobile);
    }
  }
  updateUIBalances();

  // Toast Notification System
  function showToast(message, type = "success") {
    // Check if container exists, if not create it
    if ($(".toast-container-custom").length === 0) {
      $("body").append('<div class="toast-container-custom"></div>');
    }
    
    const iconClass = type === "success" ? "bi-check-circle-fill text-success" : "bi-exclamation-triangle-fill text-danger";
    const borderClass = type === "success" ? "success" : "danger";
    
    const toastHtml = `
      <div class="toast-custom ${borderClass}">
        <i class="bi ${iconClass}"></i>
        <div>
          <span class="d-block fw-semibold text-dark">Notification</span>
          <small class="text-muted">${message}</small>
        </div>
      </div>
    `;
    
    const $toast = $(toastHtml).appendTo(".toast-container-custom");
    setTimeout(() => {
      $toast.fadeOut(400, function() { $(this).remove(); });
    }, 4000);
  }

  // 3. Purchase Credits AJAX handler
  $(".btn-buy-credits").on("click", function (e) {
    e.preventDefault();
    const $btn = $(this);
    const creditsToBuy = parseInt($btn.data("credits"));
    const price = $btn.data("price");
    
    if (isNaN(creditsToBuy)) return;

    // Show simulated loader in button
    const origText = $btn.html();
    $btn.html('<span class="spinner-border spinner-border-sm me-2" role="status"></span>Processing...').prop("disabled", true);

    $.ajax({
      url: '/user/buy-credits',
      method: 'POST',
      data: { credits: creditsToBuy, price: price },
      success: function(res) {
        $btn.html(origText).prop("disabled", false);
        if (res.success) {
          if (window.sessionUser) {
            window.sessionUser.credits = res.credits;
          }
          saveUser(getUser());
          showToast(`Successfully purchased ${creditsToBuy} credits!`, "success");
          $("#checkoutModal").modal("hide");
          
          // Reload page to update ledger tables
          setTimeout(() => {
            location.reload();
          }, 1000);
        } else {
          showToast(res.message || "Failed to purchase credits.", "danger");
        }
      },
      error: function() {
        $btn.html(origText).prop("disabled", false);
        showToast("Error processing purchase request.", "danger");
      }
    });
  });

  // Check if redirect parameters exist
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("callFinished") === "true") {
    showToast("Call ended. Call history and wallet logs updated successfully.", "success");
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }


  // Profile and Password forms are handled via native POST submits to routes now.
  // No client-side simulated event interception needed.

  // 7. General Navigation & Interface Actions
  // Sidebar Toggler for Mobile Layouts
  $(".sidebar-toggle-btn").on("click", function () {
    $(".sidebar-panel").toggleClass("show");
  });

  // Close mobile sidebar when clicking main content area
  $(".content-panel").on("click", function (e) {
    if ($(".sidebar-panel").hasClass("show") && !$(e.target).closest(".sidebar-panel, .sidebar-toggle-btn").length) {
      $(".sidebar-panel").removeClass("show");
    }
  });

  // Form validations for Auth flow
  $(".auth-form-validate").on("submit", function (e) {
    let isValid = true;
    $(this).find("[required]").each(function () {
      if ($(this).val().trim() === "") {
        isValid = false;
        $(this).addClass("is-invalid");
      } else {
        $(this).removeClass("is-invalid");
      }
    });

    if (!isValid) {
      e.preventDefault();
      showToast("Please fill all required fields correctly.", "danger");
    }
  });

  // Interactive Admin Dashboard Mock Tasks
  // Block/Unblock user list toggles
  $(document).on("click", ".btn-admin-block", function () {
    const $btn = $(this);
    const isBlocked = $btn.hasClass("btn-outline-danger");
    if (isBlocked) {
      $btn.removeClass("btn-outline-danger").addClass("btn-danger").html('<i class="bi bi-x-circle me-1"></i> Blocked');
      showToast("User blocked successfully", "danger");
    } else {
      $btn.removeClass("btn-danger").addClass("btn-outline-danger").html('<i class="bi bi-check-circle me-1"></i> Block');
      showToast("User unblocked successfully", "success");
    }
  });

  // Enable/Disable plan pricing configurations
  $(document).on("click", ".btn-admin-toggle-plan", function () {
    const $btn = $(this);
    const isActive = $btn.text().trim() === "Active";
    if (isActive) {
      $btn.removeClass("bg-success-subtle text-success").addClass("bg-secondary-subtle text-muted").text("Disabled");
      showToast("Pricing plan disabled", "warning");
    } else {
      $btn.removeClass("bg-secondary-subtle text-muted").addClass("bg-success-subtle text-success").text("Active");
      showToast("Pricing plan activated", "success");
    }
  });
});
