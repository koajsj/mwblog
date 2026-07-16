(function () {
  "use strict";

  if (window.OurNestPrivateDrafts) return;

  var MAX_DRAFT_BYTES = 16 * 1024;
  var writeVersions = Object.create(null);
  var requestQueues = Object.create(null);
  var restorePromises = new WeakMap();
  var cspNonce = document.currentScript && document.currentScript.nonce || "";

  function validKey(value) {
    var key = String(value || "").toLowerCase();
    var uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
    return key === "record-create" || key === "todo-create"
      || new RegExp("^(record|blog)-comment-" + uuid + "$", "i").test(key)
      || new RegExp("^todo-edit-" + uuid + "$", "i").test(key);
  }

  function validContext(value) {
    return /^[a-z][a-z0-9.]{2,63}$/.test(String(value || ""));
  }

  function privateSpace() {
    return window.OurNestPrivate || null;
  }

  function request(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok) throw new Error("Could not reach your private cloud draft.");
        return data;
      });
    });
  }

  function enqueue(key, operation) {
    var previous = requestQueues[key] || Promise.resolve();
    var next = previous.catch(function () {}).then(operation);
    requestQueues[key] = next;
    return next;
  }

  function snapshot(values, contexts) {
    var fields = {};
    var total = 0;
    Object.keys(contexts || {}).forEach(function (name) {
      var value = String(values && values[name] || "");
      if (!value) return;
      total += value.length;
      fields[name] = value;
    });
    if (total > MAX_DRAFT_BYTES) throw new Error("Draft is too large to save safely.");
    return fields;
  }

  function clear(key) {
    if (!validKey(key)) return Promise.resolve(false);
    writeVersions[key] = (writeVersions[key] || 0) + 1;
    return enqueue(key, function () {
      return request("/api/private-drafts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: key }),
      }).then(function () { return true; });
    });
  }

  function write(key, values, contexts) {
    if (!validKey(key)) return Promise.reject(new Error("Invalid draft key."));
    var names = Object.keys(contexts || {}).filter(function (name) {
      return /^[a-z][a-z0-9_]{0,63}$/.test(name) && validContext(contexts[name]);
    });
    if (!names.length) return Promise.reject(new Error("Invalid draft fields."));

    var fields;
    try { fields = snapshot(values, contexts); } catch (error) { return Promise.reject(error); }
    var version = (writeVersions[key] || 0) + 1;
    writeVersions[key] = version;
    if (!Object.keys(fields).length) return clear(key);

    var api = privateSpace();
    if (!api || !api.ready || !api.encryptText) return Promise.reject(new Error("Private-space encryption is not ready."));
    return api.ready().then(function () {
      return Promise.all(names.filter(function (name) { return fields[name]; }).map(function (name) {
        return api.encryptText(fields[name], contexts[name]).then(function (encrypted) {
          return [name, encrypted];
        });
      }));
    }).then(function (encryptedFields) {
      if (writeVersions[key] !== version) return false;
      var payload = {};
      encryptedFields.forEach(function (entry) { payload[entry[0]] = entry[1]; });
      return enqueue(key, function () {
        if (writeVersions[key] !== version) return false;
        return request("/api/private-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: key, fields: payload }),
        }).then(function () { return writeVersions[key] === version; });
      });
    });
  }

  function read(key, contexts) {
    if (!validKey(key)) return Promise.resolve(null);
    var api = privateSpace();
    if (!api || !api.ready || !api.decryptText || !api.isEncryptedText) return Promise.resolve(null);

    return request(`/api/private-drafts?key=${encodeURIComponent(key)}`).then(function (data) {
      var draft = data && data.draft;
      if (!draft || !draft.fields || typeof draft.fields !== "object") return null;
      var names = Object.keys(contexts || {}).filter(function (name) {
        return Object.prototype.hasOwnProperty.call(draft.fields, name) && validContext(contexts[name]);
      });
      if (!names.length || names.length > 4) return null;
      return api.ready().then(function () {
        return Promise.all(names.map(function (name) {
          var encrypted = draft.fields[name];
          if (typeof encrypted !== "string" || encrypted.length > MAX_DRAFT_BYTES * 2 || !api.isEncryptedText(encrypted)) {
            throw new Error("Invalid encrypted draft.");
          }
          return api.decryptText(encrypted, contexts[name]).then(function (value) {
            if (value === "[Encrypted content unavailable]" || value === "[Encrypted content needs migration]") {
              throw new Error("Could not decrypt draft.");
            }
            return [name, value];
          });
        }));
      }).then(function (entries) {
        var values = {};
        entries.forEach(function (entry) { values[entry[0]] = entry[1]; });
        return { values: values, savedAt: typeof draft.updated_at === "string" ? draft.updated_at : "" };
      });
    });
  }

  function formConfig(form) {
    var key = form && form.getAttribute("data-private-draft") || "";
    var rawFields = form && form.getAttribute("data-private-draft-fields") || "";
    var contexts = {};
    rawFields.split(",").forEach(function (entry) {
      var parts = entry.split(":");
      var name = String(parts[0] || "").trim();
      var context = String(parts[1] || "").trim();
      if (/^[a-z][a-z0-9_]{0,63}$/.test(name) && validContext(context)) contexts[name] = context;
    });
    return validKey(key) && Object.keys(contexts).length ? { key: key, contexts: contexts } : null;
  }

  function formValues(form, contexts) {
    var values = {};
    Object.keys(contexts).forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field && typeof field.value === "string") values[name] = field.value;
    });
    return values;
  }

  function statusElement(form) {
    var existing = form.querySelector("[data-private-draft-status]");
    if (existing) return existing;
    var status = document.createElement("p");
    status.className = "private-draft-status";
    status.setAttribute("data-private-draft-status", "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    form.appendChild(status);
    return status;
  }

  function setStatus(form, message, kind) {
    var status = statusElement(form);
    status.textContent = message || "";
    status.dataset.state = kind || "";
  }

  function restoreForm(form) {
    var config = formConfig(form);
    if (!config) return Promise.resolve(null);
    var existing = restorePromises.get(form);
    if (existing) return existing;
    var restored = read(config.key, config.contexts).then(function (draft) {
      if (!draft) return null;
      Object.keys(draft.values).forEach(function (name) {
        var field = form.elements.namedItem(name);
        if (field && typeof field.value === "string" && !field.value) field.value = draft.values[name];
      });
      setStatus(
        form,
        form.querySelector('input[type="file"]')
          ? "Encrypted cloud draft restored. Please choose photos again before saving."
          : "Encrypted cloud draft restored.",
        "restored",
      );
      return draft;
    }).catch(function () {
      setStatus(form, "Cloud draft could not be restored. Try again when the connection is back.", "error");
      return null;
    });
    restorePromises.set(form, restored);
    return restored;
  }

  function saveForm(form, quiet) {
    var config = formConfig(form);
    if (!config) return Promise.resolve(false);
    return restoreForm(form).then(function () {
      return write(config.key, formValues(form, config.contexts), config.contexts);
    }).then(function (saved) {
      if (saved && !quiet) setStatus(form, "Encrypted draft saved to your private cloud.", "saved");
      return saved;
    }).catch(function (error) {
      if (!quiet) setStatus(form, error instanceof Error ? error.message : "Could not save the encrypted draft.", "error");
      throw error;
    });
  }

  function clearForm(form) {
    var config = formConfig(form);
    if (!config) return Promise.resolve(false);
    return clear(config.key).then(function () {
      setStatus(form, "", "");
      return true;
    });
  }

  function addStyles() {
    if (document.querySelector("style[data-private-draft-style]")) return;
    var style = document.createElement("style");
    style.setAttribute("data-private-draft-style", "");
    if (cspNonce) style.nonce = cspNonce;
    style.textContent = ".private-draft-status{margin:8px 0 0;color:#75899c;font-size:12px;line-height:1.45}.private-draft-status[data-state=error]{color:#a35454}";
    document.head.appendChild(style);
  }

  function bindForm(form) {
    var config = formConfig(form);
    if (!config || form.dataset.privateDraftBound === "true") return;
    form.dataset.privateDraftBound = "true";
    var timer = null;
    var schedule = function () {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () { saveForm(form, false).catch(function () {}); }, 600);
    };
    Object.keys(config.contexts).forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field) {
        field.addEventListener("input", schedule);
        field.addEventListener("change", schedule);
      }
    });
    if (form.hasAttribute("data-private-draft-lazy")) {
      Object.keys(config.contexts).forEach(function (name) {
        var field = form.elements.namedItem(name);
        if (field) field.addEventListener("focus", function () { restoreForm(form); }, { once: true });
      });
    } else {
      restoreForm(form);
    }
  }

  function clearSavedCommentDraft() {
    var params = new URLSearchParams(window.location.search);
    var key = params.get("draft_saved") || "";
    if (!/^(record|blog)-comment-[0-9a-f-]{36}$/i.test(key)) return;
    clear(key).catch(function () {}).finally(function () {
      params.delete("draft_saved");
      var query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    });
  }

  window.OurNestPrivateDrafts = {
    read: read,
    write: write,
    clear: clear,
    saveForm: saveForm,
    clearForm: clearForm,
  };

  function init() {
    addStyles();
    clearSavedCommentDraft();
    Array.prototype.forEach.call(document.querySelectorAll("form[data-private-draft]"), bindForm);
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest && event.target.closest("[data-private-draft-cancel]");
      if (!button) return;
      var form = button.closest("form[data-private-draft]");
      if (form) clearForm(form).catch(function () { setStatus(form, "Could not clear the cloud draft. Try again.", "error"); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
