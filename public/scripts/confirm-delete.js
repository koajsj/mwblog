(function () {
  "use strict";

  var activeForm = null;
  var modal = null;
  var messageEl = null;
  var titleEl = null;
  var confirmBtn = null;
  var cancelBtn = null;
  var previousFocus = null;
  var resolver = null;

  function ensureModal() {
    if (modal) return;

    modal = document.createElement("div");
    modal.className = "confirm-delete is-hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "confirmDeleteTitle");
    modal.setAttribute("aria-describedby", "confirmDeleteMessage");
    modal.innerHTML =
      '<div class="confirm-delete__mask" data-confirm-close></div>' +
      '<section class="confirm-delete__card" tabindex="-1">' +
        '<button class="confirm-delete__x" type="button" aria-label="Close" data-confirm-close>x</button>' +
        '<span class="confirm-delete__icon" aria-hidden="true">!</span>' +
        '<h2 class="confirm-delete__title" id="confirmDeleteTitle">Confirm deletion</h2>' +
        '<p class="confirm-delete__message" id="confirmDeleteMessage">This item will be deleted.</p>' +
        '<div class="confirm-delete__actions">' +
          '<button class="confirm-delete__cancel" type="button" data-confirm-close>Cancel</button>' +
          '<button class="confirm-delete__confirm" type="button">Delete</button>' +
        '</div>' +
      '</section>';

    document.body.appendChild(modal);
    titleEl = modal.querySelector(".confirm-delete__title");
    messageEl = modal.querySelector(".confirm-delete__message");
    confirmBtn = modal.querySelector(".confirm-delete__confirm");
    cancelBtn = modal.querySelector(".confirm-delete__cancel");

    modal.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-confirm-close]")) close(false);
    });
    confirmBtn.addEventListener("click", function () { close(true); });
    document.addEventListener("keydown", function (ev) {
      if (modal.classList.contains("is-hidden")) return;
      if (ev.key === "Escape") close(false);
      if (ev.key === "Tab") keepFocus(ev);
    });
  }

  function keepFocus(ev) {
    var focusables = Array.prototype.slice.call(
      modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function open(options) {
    ensureModal();
    previousFocus = document.activeElement;
    titleEl.textContent = options.title || "Confirm deletion";
    messageEl.textContent = options.message || "This item will be deleted.";
    confirmBtn.textContent = options.confirmText || "Delete";
    modal.classList.remove("is-hidden");
    document.documentElement.classList.add("has-confirm-delete");
    setTimeout(function () { confirmBtn.focus(); }, 0);
  }

  function close(ok) {
    if (!modal || modal.classList.contains("is-hidden")) return;
    modal.classList.add("is-hidden");
    document.documentElement.classList.remove("has-confirm-delete");
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    if (resolver) {
      var resolve = resolver;
      resolver = null;
      resolve(ok);
      return;
    }
    if (!ok || !activeForm) {
      activeForm = null;
      return;
    }
    var form = activeForm;
    activeForm = null;
    form.dataset.confirmApproved = "1";
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      HTMLFormElement.prototype.submit.call(form);
    }
  }

  window.CBConfirmDelete = function (message, options) {
    options = options || {};
    return new Promise(function (resolve) {
      resolver = resolve;
      open({
        title: options.title || "Confirm deletion",
        message: message,
        confirmText: options.confirmText || "Delete",
      });
    });
  };

  document.addEventListener("submit", function (ev) {
    var form = ev.target.closest && ev.target.closest("form[data-confirm]");
    if (!form) return;
    if (form.dataset.confirmApproved === "1") {
      delete form.dataset.confirmApproved;
      return;
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
    activeForm = form;
    open({
      title: form.getAttribute("data-confirm-title") || "Confirm deletion",
      message: form.getAttribute("data-confirm") || "This item will be deleted.",
      confirmText: form.getAttribute("data-confirm-action") || "Delete",
    });
  }, true);
})();
