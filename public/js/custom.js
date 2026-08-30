/*
 * Custom Interactive JavaScript
 * Emotional Support & Voice Calling Platform
 */

$(document).ready(function () {
  // 1. Initialize Wallet & Simulated Database in Local Storage
  const defaultUser = {
    name: "Jane Doe",
    mobile: "+91 98765 43210",
    email: "jane.doe@example.com",
    credits: 25,
    joined: "2026-08-15"
  };

  const defaultCalls = [
    { id: "CALL-9824", date: "2026-08-29", time: "10:30 PM", duration: "08:24", credits: 8, status: "Completed" },
    { id: "CALL-8842", date: "2026-08-27", time: "04:15 PM", duration: "12:00", credits: 12, status: "Completed" },
    { id: "CALL-7731", date: "2026-08-24", time: "09:02 PM", duration: "00:00", credits: 0, status: "Missed" },
    { id: "CALL-5510", date: "2026-08-20", time: "02:40 PM", duration: "05:12", credits: 5, status: "Completed" }
  ];

  const defaultTransactions = [
    { id: "TXN-8812", date: "2026-08-28", desc: "Credit Purchase (20 Credits)", type: "credit", credits: 20, amount: "₹499", status: "Successful" },
    { id: "TXN-7741", date: "2026-08-25", desc: "Credit Purchase (10 Credits)", type: "credit", credits: 10, amount: "₹299", status: "Successful" },
    { id: "TXN-6610", date: "2026-08-24", desc: "Call Charges (CALL-7731)", type: "debit", credits: 0, amount: "₹0", status: "Completed" },
    { id: "TXN-5509", date: "2026-08-20", desc: "Call Charges (CALL-5510)", type: "debit", credits: 5, amount: "₹0", status: "Completed" }
  ];

  // Populate Local Storage defaults if not present
  if (!localStorage.getItem("support_user")) {
    localStorage.setItem("support_user", JSON.stringify(defaultUser));
  }
  if (!localStorage.getItem("support_calls")) {
    localStorage.setItem("support_calls", JSON.stringify(defaultCalls));
  }
  if (!localStorage.getItem("support_txns")) {
    localStorage.setItem("support_txns", JSON.stringify(defaultTransactions));
  }

  // Helper getters/setters
  function getUser() {
    if (window.sessionUser) {
      return window.sessionUser;
    }
    return JSON.parse(localStorage.getItem("support_user"));
  }
  function saveUser(user) {
    if (window.sessionUser) {
      window.sessionUser = user;
    } else {
      localStorage.setItem("support_user", JSON.stringify(user));
    }
    updateUIBalances();
  }
  function getCalls() {
    return JSON.parse(localStorage.getItem("support_calls"));
  }
  function getTxns() {
    return JSON.parse(localStorage.getItem("support_txns"));
  }

  // 2. Synchronize Credit Balances across UI Elements
  function updateUIBalances() {
    const user = getUser();
    if (user) {
      $(".simulated-balance").text(user.credits);
      $(".simulated-name").text(user.name);
      $(".simulated-phone").text(user.mobile);
      $(".simulated-email").val(user.email || "");
      $(".simulated-fullname-input").val(user.name);
      $(".simulated-mobile-input").val(user.mobile);
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

  // 4. Voice Call Simulator Engine
  if ($("#call-screen-trigger").length > 0) {
    let callTimerInterval;
    let secondsElapsed = 0;
    let activeUser = getUser();
    let currentCallCreditsUsed = 0;
    let initialCredits = activeUser.credits;

    // Transition stages: 'connecting' -> 'connected'
    setTimeout(() => {
      // Transition from connecting to connected
      $(".call-status-badge").removeClass("connecting").addClass("connected").text("You're Connected");
      $(".call-pulse-animation, .call-pulse-animation-2").css("animation-duration", "1.5s");
      $("#call-cancel-btn").addClass("d-none");
      $("#call-active-controls").removeClass("d-none");
      
      // Start call counting
      startCallTimer();
    }, 3000);

    function startCallTimer() {
      callTimerInterval = setInterval(() => {
        secondsElapsed++;
        
        // Format time mm:ss
        const mins = Math.floor(secondsElapsed / 60);
        const secs = secondsElapsed % 60;
        const timeStr = (mins < 10 ? "0" + mins : mins) + ":" + (secs < 10 ? "0" + secs : secs);
        $(".call-timer").text(timeStr);

        // Deduct credit every 60 seconds (1 minute = 1 credit)
        if (secondsElapsed % 60 === 0) {
          activeUser = getUser();
          if (activeUser.credits > 0) {
            activeUser.credits--;
            currentCallCreditsUsed++;
            saveUser(activeUser);
            
            // Sync call UI indicators
            $("#call-credits-remaining").text(activeUser.credits);
            $("#call-credits-used").text(currentCallCreditsUsed);

            // Trigger low credit warning at 2 minutes remaining
            if (activeUser.credits === 2) {
              triggerLowCreditWarning();
            }

            // Disconnect call automatically when credits run out
            if (activeUser.credits === 0) {
              terminateCall("Auto-Disconnected (No Credits)");
            }
          }
        }
      }, 1000);
    }

    function triggerLowCreditWarning() {
      if ($(".call-low-credit-bar").length === 0) {
        const warningHtml = `
          <div class="call-low-credit-bar">
            <span><i class="bi bi-exclamation-triangle-fill me-2"></i> Low Credit Alert: 2 Minutes Remaining</span>
            <a href="/user/buy-credits" class="btn btn-sm btn-light text-danger fw-bold rounded-pill px-3">Recharge Now</a>
          </div>
        `;
        $("#call-screen-footer-container").prepend(warningHtml);
      }
    }

    // Call End Trigger
    $("#call-end-btn, #call-cancel-btn").on("click", function () {
      terminateCall("Completed");
    });

    function terminateCall(statusType) {
      clearInterval(callTimerInterval);
      
      // Calculate final durations
      const mins = Math.floor(secondsElapsed / 60);
      const secs = secondsElapsed % 60;
      const formattedDuration = (mins < 10 ? "0" + mins : mins) + ":" + (secs < 10 ? "0" + secs : secs);
      
      // If connecting was cancelled
      const finalStatus = secondsElapsed > 0 ? statusType : "Cancelled";
      const creditsCharged = Math.max(1, Math.ceil(secondsElapsed / 60)); // minimum 1 credit if connected at least 1s
      const finalCreditsUsed = finalStatus === "Cancelled" ? 0 : creditsCharged;

      // Charge credits from storage if call was connected and completed
      if (finalStatus !== "Cancelled" && finalCreditsUsed > 0) {
        // Double check balance deducts
        const user = getUser();
        user.credits = Math.max(0, initialCredits - finalCreditsUsed);
        saveUser(user);
      }

      // Log Call History
      const calls = getCalls();
      const newCall = {
        id: "CALL-" + Math.floor(1000 + Math.random() * 9000),
        date: new Date().toISOString().split('T')[0],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: formattedDuration,
        credits: finalCreditsUsed,
        status: finalStatus
      };
      calls.unshift(newCall);
      localStorage.setItem("support_calls", JSON.stringify(calls));

      // Log Transaction details
      if (finalCreditsUsed > 0) {
        const txns = getTxns();
        const newTxn = {
          id: "TXN-" + Math.floor(1000 + Math.random() * 9000),
          date: new Date().toISOString().split('T')[0],
          desc: `Call Charges (${newCall.id})`,
          type: "debit",
          credits: finalCreditsUsed,
          amount: "₹0",
          status: "Completed"
        };
        txns.unshift(newTxn);
        localStorage.setItem("support_txns", JSON.stringify(txns));
      }

      // Redirect to Call History with a notification flag
      window.location.href = "/user/call-history?callFinished=true";
    }
  }

  // Check if redirect parameters exist
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("callFinished") === "true") {
    showToast("Call ended. Call history and wallet logs updated successfully.", "success");
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // 5. Populate Interactive Tables and Dashboards
  function populateTables() {
    const user = getUser();
    const calls = getCalls();
    const txns = getTxns();

    // Fill User Dashboard stats
    if ($("#dash-total-calls").length > 0) {
      const completedCalls = calls.filter(c => c.status === "Completed");
      const totalMins = completedCalls.reduce((acc, c) => {
        const parts = c.duration.split(":");
        return acc + parseInt(parts[0]) + (parseInt(parts[1]) / 60);
      }, 0);
      
      $("#dash-total-calls").text(calls.length);
      $("#dash-total-mins").text(Math.round(totalMins) + " mins");
      $("#dash-wallet-credits").text(user.credits);
      $("#dash-wallet-mins").text(user.credits + " min");
    }

    // Fill Call History Tables
    const $callTableBody = $("#call-history-table-body");
    if ($callTableBody.length > 0) {
      $callTableBody.empty();
      if (calls.length === 0) {
        $callTableBody.append('<tr><td colspan="5" class="text-center text-muted py-4">No calls logged yet.</td></tr>');
      } else {
        calls.forEach(call => {
          let badgeClass = "bg-success-subtle text-success";
          if (call.status === "Cancelled" || call.status === "Missed") badgeClass = "bg-warning-subtle text-warning";
          if (call.status === "Failed") badgeClass = "bg-danger-subtle text-danger";
          
          $callTableBody.append(`
            <tr>
              <td><span class="fw-semibold">${call.id}</span></td>
              <td>${call.date}</td>
              <td>${call.time}</td>
              <td>${call.duration}</td>
              <td><span class="fw-bold">${call.credits} Credits</span></td>
              <td><span class="badge ${badgeClass} rounded-pill px-2.5 py-1.5">${call.status}</span></td>
            </tr>
          `);
        });
      }
    }

    // Fill Transaction History Tables
    const $txnTableBody = $("#transaction-history-table-body");
    if ($txnTableBody.length > 0) {
      $txnTableBody.empty();
      if (txns.length === 0) {
        $txnTableBody.append('<tr><td colspan="6" class="text-center text-muted py-4">No transactions found.</td></tr>');
      } else {
        txns.forEach(txn => {
          const typeBadge = txn.type === "credit" 
            ? `<span class="badge bg-success-subtle text-success"><i class="bi bi-arrow-down-left me-1"></i> Recharge</span>`
            : `<span class="badge bg-danger-subtle text-danger"><i class="bi bi-arrow-up-right me-1"></i> Call Spend</span>`;
          
          const creditFormatted = txn.type === "credit"
            ? `<span class="text-success fw-bold">+${txn.credits} Credits</span>`
            : `<span class="text-danger fw-bold">-${txn.credits} Credits</span>`;

          $txnTableBody.append(`
            <tr>
              <td><span class="fw-semibold">${txn.id}</span></td>
              <td>${txn.date}</td>
              <td>${txn.desc}</td>
              <td>${typeBadge}</td>
              <td>${creditFormatted}</td>
              <td><span class="fw-bold">${txn.amount}</span></td>
              <td><span class="badge bg-success-subtle text-success rounded-pill px-2 py-1">${txn.status}</span></td>
            </tr>
          `);
        });
      }
    }
  }
  populateTables();

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
