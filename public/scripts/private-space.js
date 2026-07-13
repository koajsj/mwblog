(function () {
  "use strict";

  if (window.OurNestPrivate) return;

  var TEXT_PREFIX = "enc:wc2:";
  var FILE_PREFIX = "MWBLOG-WC2 ";
  var PREVIOUS_TEXT_PREFIX = "enc:wc1:";
  var PREVIOUS_FILE_PREFIX = "MWBLOG-WC1 ";
  var LEGACY_TEXT_PREFIX = "enc:v1:";
  var LEGACY_FILE_PREFIX = "MWBLOG_FILE_V1 ";
  var LEGACY_RAW_KEY_SESSION = "ournest.private.raw.v1";
  var LEGACY_BUNDLE_SESSION = "ournest.private.bundle.v1";
  var RAW_KEY_SESSION = "ournest.private.raw.wc2";
  var RAW_KEY_PERSISTENT = "ournest.private.raw.wc2.persistent";
  var CLEAR_SIGNAL_KEY = "ournest.private.clear.v1";
  var READY_EVENT = "ournest-private-ready";
  var FAILED_EVENT = "ournest-private-failed";
  var PBKDF2_ITERATIONS = 600000;
  var MAX_IMAGE_BYTES = 50 * 1024 * 1024;
  var ALLOWED_IMAGE_TYPES = {
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true,
    "image/gif": true
  };

  var bundleCache = null;
  var keyPromise = null;
  var readyDispatched = false;
  var photoCache = new Map();
  var photoObjectUrls = new Set();
  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();
  var cspNonce = document.currentScript && document.currentScript.nonce || "";

  function b64urlEncode(bytes) {
    var binary = "";
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64urlDecode(value) {
    var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    var padded = normalized + "===".slice((normalized.length + 3) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  function fingerprint(rawKey) {
    return crypto.subtle.digest("SHA-256", rawKey).then(function (digest) {
      return b64urlEncode(new Uint8Array(digest).subarray(0, 12));
    });
  }

  function clearStoredRawKey() {
    try {
      sessionStorage.removeItem(RAW_KEY_SESSION);
      sessionStorage.removeItem(LEGACY_RAW_KEY_SESSION);
      sessionStorage.removeItem(LEGACY_BUNDLE_SESSION);
    } catch (error) {}
    try {
      localStorage.removeItem(RAW_KEY_PERSISTENT);
    } catch (error) {}
  }

  function clearLegacyStoredKeys() {
    try {
      sessionStorage.removeItem(LEGACY_RAW_KEY_SESSION);
      sessionStorage.removeItem(LEGACY_BUNDLE_SESSION);
    } catch (error) {}
  }

  function storeRawKey(rawKey, bundle) {
    var stored = JSON.stringify({
      fingerprint: String(bundle && bundle.fingerprint || ""),
      key: b64urlEncode(rawKey),
    });
    try {
      sessionStorage.setItem(RAW_KEY_SESSION, stored);
    } catch (error) {}
    try {
      localStorage.setItem(RAW_KEY_PERSISTENT, stored);
    } catch (error) {}
  }

  function loadStoredKey(bundle) {
    try {
      var stored = JSON.parse(localStorage.getItem(RAW_KEY_PERSISTENT) || sessionStorage.getItem(RAW_KEY_SESSION) || "null");
      if (!stored || stored.fingerprint !== String(bundle && bundle.fingerprint || "")) return Promise.resolve(null);
      var rawKey = b64urlDecode(stored.key);
      if (rawKey.length !== 32) throw new Error("invalid key");
      return fingerprint(rawKey).then(function (fp) {
        if (fp !== stored.fingerprint) throw new Error("invalid fingerprint");
        return importSpaceKey(rawKey).then(function (key) {
          storeRawKey(rawKey, bundle);
          rawKey.fill(0);
          return key;
        });
      }).catch(function () {
        rawKey.fill(0);
        clearStoredRawKey();
        return null;
      });
    } catch (error) {
      clearStoredRawKey();
      return Promise.resolve(null);
    }
  }

  function trim(value) {
    return String(value || "").trim();
  }

  function bundleIterations(bundle) {
    var iterations = Number(bundle && bundle.kdf && bundle.kdf.iterations);
    if (!Number.isInteger(iterations) || iterations < 200000 || iterations > 1000000) {
      throw new Error("The private-space key settings are invalid.");
    }
    return iterations;
  }

  function deriveWrappingKey(secret, salt, iterations) {
    return crypto.subtle.importKey(
      "raw",
      textEncoder.encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    ).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: salt,
          iterations: iterations,
          hash: "SHA-256",
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    });
  }

  function importSpaceKey(rawKey) {
    return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  function encryptionContext(value) {
    var context = trim(value);
    if (!/^[a-z][a-z0-9.]{2,63}$/.test(context)) {
      throw new Error("Private content is missing its encryption context.");
    }
    return context;
  }

  function additionalData(context) {
    return textEncoder.encode("mwblog:wc2:" + encryptionContext(context));
  }

  function wrapRawKey(rawKey, secret) {
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    return deriveWrappingKey(secret, salt, PBKDF2_ITERATIONS).then(function (wrappingKey) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, wrappingKey, rawKey).then(function (ciphertext) {
        return {
          salt: b64urlEncode(salt),
          iv: b64urlEncode(iv),
          data: b64urlEncode(new Uint8Array(ciphertext)),
        };
      });
    });
  }

  function unwrapRawKey(bundle, envelope, secret) {
    return deriveWrappingKey(secret, b64urlDecode(envelope.salt), bundleIterations(bundle)).then(function (wrappingKey) {
      return crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64urlDecode(envelope.iv) },
        wrappingKey,
        b64urlDecode(envelope.data),
      ).then(function (rawKey) {
        return new Uint8Array(rawKey);
      });
    });
  }

  function defaultBundleShape() {
    return {
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
      },
    };
  }

  function fetchBundle() {
    if (bundleCache) return Promise.resolve(bundleCache);
    return fetch("/api/private-space/key-bundle", { credentials: "same-origin" })
      .then(function (response) {
        if (response.status === 401 || response.status === 403) clearAfterSessionLoss();
        if (!response.ok) throw new Error("Could not load the private-space key bundle.");
        return response.json();
      })
      .then(function (data) {
        bundleCache = data && data.bundle ? data.bundle : null;
        return bundleCache;
      });
  }

  function saveBundle(bundle) {
    return fetch("/api/private-space/key-bundle", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: bundle }),
    }).then(function (response) {
      if (response.status === 401 || response.status === 403) clearAfterSessionLoss();
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          if (response.status === 409) {
            throw new Error("A private-space key already exists. Reload the page and unlock that space instead.");
          }
          throw new Error(data.error || "Could not save the private-space key bundle.");
        }
        bundleCache = data.bundle || bundle;
        return bundleCache;
      });
    });
  }

  function replaceBundle(bundle, expectedFingerprint) {
    return fetch("/api/private-space/key-bundle", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: bundle, expectedFingerprint: expectedFingerprint }),
    }).then(function (response) {
      if (response.status === 401 || response.status === 403) clearAfterSessionLoss();
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || "Could not update the private-space passphrase.");
        bundleCache = data.bundle || bundle;
        return bundleCache;
      });
    });
  }

  function ensureGate() {
    var gate = document.getElementById("privateSpaceGate");
    if (gate) return gate;

    var style = document.createElement("style");
    if (cspNonce) style.nonce = cspNonce;
    style.textContent = [
      ".private-space-gate{position:fixed;inset:0;z-index:300;background:rgba(242,245,250,.82);backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:20px;}",
      ".private-space-gate.is-hidden{display:none;}",
      ".private-space-card{width:min(100%,460px);background:rgba(255,255,255,.96);border:1px solid rgba(120,144,170,.18);border-radius:24px;box-shadow:0 30px 90px rgba(55,70,92,.18);padding:26px 24px 22px;color:#496176;font-family:'Satoshi','PingFang SC','Microsoft YaHei',sans-serif;}",
      ".private-space-card h2{margin:0 0 10px;font-size:26px;line-height:1.15;color:#31485f;}",
      ".private-space-card p{margin:0 0 14px;line-height:1.6;color:#60778e;font-size:14px;}",
      ".private-space-card label{display:block;margin:0 0 12px;}",
      ".private-space-card input,.private-space-card textarea{width:100%;box-sizing:border-box;border:1px solid rgba(125,150,178,.24);border-radius:14px;padding:12px 14px;background:#fff;color:#31485f;font:inherit;}",
      ".private-space-card textarea{min-height:92px;resize:vertical;}",
      ".private-space-card small{display:block;margin-top:8px;color:#7d8ea1;line-height:1.5;}",
      ".private-space-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;}",
      ".private-space-btn{border:none;border-radius:999px;padding:11px 18px;background:#7aa6d4;color:#fff;font:inherit;font-weight:700;cursor:pointer;}",
      ".private-space-btn.alt{background:rgba(122,166,212,.12);color:#53708c;}",
      ".private-space-btn:disabled{opacity:.6;cursor:not-allowed;}",
      ".private-space-error{min-height:20px;margin-top:8px;color:#9d3f3f;font-size:13px;}",
      ".private-space-code{display:block;width:100%;padding:12px 14px;border-radius:16px;background:#f5f8fc;color:#31485f;font-weight:700;font-family:'SFMono-Regular',Consolas,monospace;word-break:break-all;}",
      ".private-space-toggle{display:inline-flex;gap:8px;align-items:center;color:#58728b;background:none;border:none;padding:0;cursor:pointer;font:inherit;font-weight:700;}",
      "@media (max-width: 760px){.private-space-card{padding:22px 18px 18px;border-radius:20px}.private-space-card h2{font-size:22px}}",
    ].join("");
    document.head.appendChild(style);

    gate = document.createElement("div");
    gate.id = "privateSpaceGate";
    gate.className = "private-space-gate is-hidden";
    gate.innerHTML = [
      '<section class="private-space-card" role="dialog" aria-modal="true" aria-labelledby="privateSpaceTitle">',
      '<h2 id="privateSpaceTitle">Unlock your private space</h2>',
      '<p id="privateSpaceLead">Sensitive content is encrypted in your browser. Enter the private-space passphrase to unlock it on this device.</p>',
      '<label id="privateSpacePassphraseField"><input id="privateSpacePassphrase" type="password" autocomplete="off" placeholder="Private-space passphrase" /></label>',
      '<label id="privateSpaceNewPassphraseField" class="is-hidden"><input id="privateSpaceNewPassphrase" type="password" autocomplete="new-password" placeholder="New private-space passphrase" /></label>',
      '<label id="privateSpaceConfirmField" class="is-hidden"><input id="privateSpaceConfirm" type="password" autocomplete="new-password" placeholder="Confirm the passphrase" /></label>',
      '<label id="privateSpaceRecoveryField" class="is-hidden"><textarea id="privateSpaceRecovery" spellcheck="false" placeholder="Recovery code"></textarea></label>',
      '<small id="privateSpaceHelp">This passphrase is separate from the login password and never leaves the browser.</small>',
      '<div id="privateSpaceRecoveryBox" class="is-hidden"><p>Save this recovery code offline before continuing.</p><code class="private-space-code" id="privateSpaceRecoveryCode"></code></div>',
      '<div class="private-space-error" id="privateSpaceError" role="status"></div>',
      '<button class="private-space-toggle" id="privateSpaceMode" type="button">Use recovery code instead</button>',
      '<div class="private-space-actions"><button class="private-space-btn alt" id="privateSpaceSecondary" type="button">Cancel</button><button class="private-space-btn" id="privateSpacePrimary" type="button">Unlock</button></div>',
      "</section>",
    ].join("");
    document.body.appendChild(gate);
    return gate;
  }

  function showGate(mode, options) {
    var gate = ensureGate();
    var title = document.getElementById("privateSpaceTitle");
    var lead = document.getElementById("privateSpaceLead");
    var passField = document.getElementById("privateSpacePassphraseField");
    var newPassField = document.getElementById("privateSpaceNewPassphraseField");
    var confirmField = document.getElementById("privateSpaceConfirmField");
    var recoveryField = document.getElementById("privateSpaceRecoveryField");
    var help = document.getElementById("privateSpaceHelp");
    var error = document.getElementById("privateSpaceError");
    var modeBtn = document.getElementById("privateSpaceMode");
    var primary = document.getElementById("privateSpacePrimary");
    var secondary = document.getElementById("privateSpaceSecondary");
    var recoveryBox = document.getElementById("privateSpaceRecoveryBox");
    var recoveryCode = document.getElementById("privateSpaceRecoveryCode");
    var passInput = document.getElementById("privateSpacePassphrase");
    var newPassInput = document.getElementById("privateSpaceNewPassphrase");
    var confirmInput = document.getElementById("privateSpaceConfirm");
    var recoveryInput = document.getElementById("privateSpaceRecovery");

    gate.classList.remove("is-hidden");
    primary.disabled = false;
    secondary.disabled = false;
    error.textContent = "";
    modeBtn.classList.remove("is-hidden");
    passInput.value = "";
    newPassInput.value = "";
    confirmInput.value = "";
    recoveryInput.value = "";
    passInput.placeholder = "Private-space passphrase";
    newPassInput.placeholder = "New private-space passphrase";
    recoveryBox.classList.add("is-hidden");
    if (recoveryCode) recoveryCode.textContent = "";

    if (mode === "setup") {
      title.textContent = "Create your private-space key";
      lead.textContent = "Generate a browser-side encryption key for the two-person space. The passphrase protects the key, but is not the key itself.";
      newPassField.classList.add("is-hidden");
      confirmField.classList.remove("is-hidden");
      recoveryField.classList.add("is-hidden");
      passField.classList.remove("is-hidden");
      help.textContent = "Choose a strong passphrase. It will be needed on every new device.";
      modeBtn.classList.add("is-hidden");
      primary.textContent = "Create key";
      secondary.textContent = "Log out";
    } else if (mode === "recovery") {
      title.textContent = "Unlock with recovery code";
      lead.textContent = "Use the recovery code generated when the private-space key was first created.";
      newPassField.classList.add("is-hidden");
      confirmField.classList.add("is-hidden");
      passField.classList.add("is-hidden");
      recoveryField.classList.remove("is-hidden");
      help.textContent = "Recovery only unlocks the current session. Keep the code offline.";
      modeBtn.textContent = "Use passphrase instead";
      primary.textContent = "Unlock";
      secondary.textContent = "Cancel";
    } else if (mode === "created") {
      title.textContent = "Recovery code";
      lead.textContent = "This code can unlock the private-space key on a new device if the passphrase is forgotten.";
      newPassField.classList.add("is-hidden");
      confirmField.classList.add("is-hidden");
      passField.classList.add("is-hidden");
      recoveryField.classList.add("is-hidden");
      recoveryBox.classList.remove("is-hidden");
      if (recoveryCode) recoveryCode.textContent = options && options.recoveryCode || "";
      help.textContent = "Store it in a password manager or an offline note. It cannot be shown again from the server.";
      modeBtn.textContent = "Use passphrase instead";
      primary.textContent = "Continue";
      secondary.textContent = "Log out";
    } else if (mode === "change" || mode === "change-recovery") {
      var useRecovery = mode === "change-recovery";
      title.textContent = "Change private-space passphrase";
      lead.textContent = "Verify the current secret, then choose a new passphrase. Your encrypted content stays unchanged.";
      passField.classList.toggle("is-hidden", useRecovery);
      newPassField.classList.remove("is-hidden");
      confirmField.classList.remove("is-hidden");
      recoveryField.classList.toggle("is-hidden", !useRecovery);
      passInput.placeholder = "Current private-space passphrase";
      help.textContent = useRecovery
        ? "The recovery code can verify this change when the current passphrase is unavailable."
        : "Choose a passphrase you can remember. The recovery code will continue to work.";
      modeBtn.textContent = useRecovery ? "Use current passphrase instead" : "Use recovery code instead";
      primary.textContent = "Change passphrase";
      secondary.textContent = "Cancel";
    } else {
      title.textContent = "Unlock your private space";
      lead.textContent = "Sensitive content is encrypted in your browser. Enter the private-space passphrase to unlock it on this device.";
      newPassField.classList.add("is-hidden");
      confirmField.classList.add("is-hidden");
      recoveryField.classList.add("is-hidden");
      passField.classList.remove("is-hidden");
      help.textContent = "This passphrase is separate from the login password and never leaves the browser.";
      modeBtn.textContent = "Use recovery code instead";
      primary.textContent = "Unlock";
      secondary.textContent = "Log out";
    }

    return {
      gate: gate,
      passInput: passInput,
      newPassInput: newPassInput,
      confirmInput: confirmInput,
      recoveryInput: recoveryInput,
      error: error,
      primary: primary,
      secondary: secondary,
      modeBtn: modeBtn,
      recoveryCode: recoveryCode,
    };
  }

  function hideGate() {
    var gate = document.getElementById("privateSpaceGate");
    if (gate) gate.classList.add("is-hidden");
  }

  function broadcastPrivateClear() {
    try {
      localStorage.setItem(CLEAR_SIGNAL_KEY, String(Date.now()) + ":" + Math.random().toString(36).slice(2));
    } catch (error) {}
  }

  function clearPrivateState(shouldBroadcast) {
    clearStoredRawKey();
    bundleCache = null;
    keyPromise = null;
    readyDispatched = false;
    photoObjectUrls.forEach(function (url) {
      URL.revokeObjectURL(url);
    });
    photoObjectUrls.clear();
    photoCache.clear();
    document.documentElement.removeAttribute("data-private-ready");
    if (shouldBroadcast !== false) broadcastPrivateClear();
  }

  function clearAfterSessionLoss(shouldBroadcast) {
    clearPrivateState(shouldBroadcast);
    if (window.location.pathname !== "/auth/login") {
      var returnTo = window.location.pathname + window.location.search + window.location.hash;
      window.location.replace("/auth/login?redirect=" + encodeURIComponent(returnTo));
    }
  }

  function logoutNow() {
    return fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not log out.");
      window.location.href = "/auth/login";
      return true;
    }).catch(function () {
      window.alert("Could not log out. Please try again.");
      return false;
    });
  }

  function generateRecoveryCode() {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    var bytes = randomBytes(20);
    var raw = "";
    var buffer = 0;
    var bits = 0;
    for (var byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      buffer = (buffer << 8) | bytes[byteIndex];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        raw += alphabet[(buffer >>> bits) & 31];
        buffer &= (1 << bits) - 1;
      }
    }
    if (bits > 0) raw += alphabet[(buffer << (5 - bits)) & 31];
    var groups = [];
    for (var i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
    return groups.join("-");
  }

  function markReady(bundle) {
    if (bundle) bundleCache = bundle;
    if (!readyDispatched) {
      readyDispatched = true;
    }
    document.documentElement.setAttribute("data-private-ready", "true");
    document.dispatchEvent(new CustomEvent(READY_EVENT));
    window.dispatchEvent(new CustomEvent(READY_EVENT));
    hideGate();
  }

  function markFailure(error) {
    document.documentElement.removeAttribute("data-private-ready");
    document.dispatchEvent(new CustomEvent(FAILED_EVENT, { detail: error }));
    window.dispatchEvent(new CustomEvent(FAILED_EVENT, { detail: error }));
  }

  function setupKey() {
    var view = showGate("setup");
    return new Promise(function (resolve, reject) {
      function reset() {
        view.primary.disabled = false;
        view.secondary.disabled = false;
      }

      view.secondary.onclick = function () {
        logoutNow();
      };

      view.primary.onclick = function () {
        var passphrase = trim(view.passInput.value);
        var confirm = trim(view.confirmInput.value);
        if (!passphrase) {
          view.error.textContent = "Enter a private-space passphrase.";
          return;
        }
        if (passphrase !== confirm) {
          view.error.textContent = "The two passphrase entries do not match.";
          return;
        }
        if (!window.crypto || !window.crypto.subtle) {
          view.error.textContent = "This browser needs HTTPS and Web Crypto support to create the private-space key.";
          return;
        }
        view.error.textContent = "";
        view.primary.disabled = true;
        view.secondary.disabled = true;

        var rawKey = randomBytes(32);
        var recoveryCode = generateRecoveryCode();
        Promise.all([
          wrapRawKey(rawKey, passphrase),
          wrapRawKey(rawKey, recoveryCode),
          fingerprint(rawKey),
        ]).then(function (result) {
          var bundle = defaultBundleShape();
          bundle.passphrase = result[0];
          bundle.recovery = result[1];
          bundle.fingerprint = result[2];
          return saveBundle(bundle).then(function (savedBundle) {
            storeRawKey(rawKey, savedBundle);
            markReady(savedBundle);
            var createdView = showGate("created", { recoveryCode: recoveryCode });
            createdView.secondary.onclick = function () {
              logoutNow();
            };
            createdView.primary.onclick = function () {
              hideGate();
              importSpaceKey(rawKey).then(function (key) {
                rawKey.fill(0);
                resolve(key);
              }).catch(reject);
            };
          });
        }).catch(function (error) {
          view.error.textContent = error instanceof Error ? error.message : "Could not create the private-space key.";
          reset();
        });
      };
    });
  }

  function showRecovery() {
    var bundle = bundleCache;
    var view = showGate("recovery");
    return new Promise(function (resolve, reject) {
      view.secondary.onclick = function () {
        showUnlock().then(resolve).catch(reject);
      };
      view.modeBtn.onclick = function () {
        showUnlock().then(resolve).catch(reject);
      };
      view.primary.onclick = function () {
        var code = trim(view.recoveryInput.value);
        if (!code) {
          view.error.textContent = "Enter the recovery code first.";
          return;
        }
        view.primary.disabled = true;
        view.secondary.disabled = true;
        unwrapRawKey(bundle, bundle.recovery, code).then(function (rawKey) {
          return fingerprint(rawKey).then(function (fp) {
            if (fp !== String(bundle.fingerprint || "")) {
              throw new Error("The recovery code did not unlock this space.");
            }
            view.recoveryInput.value = "";
            storeRawKey(rawKey, bundle);
            markReady(bundle);
            return importSpaceKey(rawKey).then(function (key) {
              rawKey.fill(0);
              resolve(key);
            });
          });
        }).catch(function () {
          view.error.textContent = "The recovery code is incorrect.";
          view.primary.disabled = false;
          view.secondary.disabled = false;
        });
      };
    });
  }

  function showUnlock() {
    var bundle = bundleCache;
    var view = showGate("unlock");
    return new Promise(function (resolve, reject) {
      view.secondary.onclick = function () {
        logoutNow();
      };
      view.modeBtn.onclick = function () {
        showRecovery().then(resolve).catch(reject);
      };
      view.primary.onclick = function () {
        var passphrase = trim(view.passInput.value);
        if (!passphrase) {
          view.error.textContent = "Enter the private-space passphrase.";
          return;
        }
        view.primary.disabled = true;
        view.secondary.disabled = true;
        unwrapRawKey(bundle, bundle.passphrase, passphrase).then(function (rawKey) {
          return fingerprint(rawKey).then(function (fp) {
            if (fp !== String(bundle.fingerprint || "")) {
              throw new Error("wrong key");
            }
            view.passInput.value = "";
            storeRawKey(rawKey, bundle);
            markReady(bundle);
            return importSpaceKey(rawKey).then(function (key) {
              rawKey.fill(0);
              resolve(key);
            });
          });
        }).catch(function () {
          view.error.textContent = "The passphrase is incorrect.";
          view.primary.disabled = false;
          view.secondary.disabled = false;
          clearStoredRawKey();
        });
      };
    });
  }

  function showChangePassphrase() {
    return ensureReady().then(function () {
      var bundle = bundleCache;
      if (!bundle) throw new Error("The private-space key is not available.");
      var useRecovery = false;

      function render() {
        var view = showGate(useRecovery ? "change-recovery" : "change");
        view.secondary.onclick = function () {
          hideGate();
        };
        view.modeBtn.onclick = function () {
          useRecovery = !useRecovery;
          render();
        };
        view.primary.onclick = function () {
          var currentSecret = trim(useRecovery ? view.recoveryInput.value : view.passInput.value);
          var newPassphrase = trim(view.newPassInput.value);
          var confirmation = trim(view.confirmInput.value);
          if (!currentSecret) {
            view.error.textContent = useRecovery ? "Enter the recovery code first." : "Enter the current passphrase.";
            return;
          }
          if (!newPassphrase) {
            view.error.textContent = "Enter a new private-space passphrase.";
            return;
          }
          if (newPassphrase !== confirmation) {
            view.error.textContent = "The two new passphrase entries do not match.";
            return;
          }

          var rawKey = null;
          var verified = false;
          view.error.textContent = "";
          view.primary.disabled = true;
          view.secondary.disabled = true;
          unwrapRawKey(bundle, useRecovery ? bundle.recovery : bundle.passphrase, currentSecret)
            .then(function (key) {
              rawKey = key;
              return fingerprint(rawKey);
            })
            .then(function (fp) {
              if (fp !== String(bundle.fingerprint || "")) throw new Error("wrong key");
              verified = true;
              return wrapRawKey(rawKey, newPassphrase);
            })
            .then(function (passphraseEnvelope) {
              return replaceBundle({
                version: bundle.version,
                kdf: bundle.kdf,
                passphrase: passphraseEnvelope,
                recovery: bundle.recovery,
                fingerprint: bundle.fingerprint,
              }, bundle.fingerprint);
            })
            .then(function (savedBundle) {
              storeRawKey(rawKey, savedBundle);
              rawKey.fill(0);
              rawKey = null;
              bundle = savedBundle;
              hideGate();
              window.alert("Private-space passphrase changed.");
            })
            .catch(function (error) {
              if (rawKey) rawKey.fill(0);
              if (!verified) {
                view.error.textContent = useRecovery ? "The recovery code is incorrect." : "The current passphrase is incorrect.";
              } else {
                view.error.textContent = error instanceof Error ? error.message : "Could not change the private-space passphrase.";
              }
              view.primary.disabled = false;
              view.secondary.disabled = false;
            });
        };
      }

      render();
    });
  }

  function ensureReady() {
    if (!keyPromise) {
      keyPromise = fetchBundle().then(function (bundle) {
        if (!bundle) return setupKey();
        return loadStoredKey(bundle).then(function (key) {
          return key || showUnlock();
        });
      }).catch(function (error) {
        keyPromise = null;
        markFailure(error);
        throw error;
      });
    }
    return keyPromise;
  }

  function encryptText(value, expectedContext) {
    var text = String(value || "");
    if (!text) return Promise.resolve("");
    var context = encryptionContext(expectedContext);
    return ensureReady().then(function (key) {
      var iv = randomBytes(12);
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: additionalData(context) }, key, textEncoder.encode(text)).then(function (ciphertext) {
        return TEXT_PREFIX + b64urlEncode(textEncoder.encode(JSON.stringify({
          iv: b64urlEncode(iv),
          data: b64urlEncode(new Uint8Array(ciphertext)),
          context: context,
        })));
      });
    });
  }

  function decryptText(value, expectedContext) {
    var text = String(value || "");
    if (!text) return Promise.resolve("");
    var isCurrent = text.indexOf(TEXT_PREFIX) === 0;
    var isPrevious = text.indexOf(PREVIOUS_TEXT_PREFIX) === 0;
    if (!isCurrent && !isPrevious) {
      if (text.indexOf(LEGACY_TEXT_PREFIX) === 0) {
        return Promise.resolve("[Encrypted content needs migration]");
      }
      return Promise.resolve(text);
    }
    return ensureReady().then(function (key) {
      var payload;
      try {
        var prefix = isCurrent ? TEXT_PREFIX : PREVIOUS_TEXT_PREFIX;
        payload = JSON.parse(textDecoder.decode(b64urlDecode(text.slice(prefix.length))));
        if (!payload || typeof payload.iv !== "string" || typeof payload.data !== "string") {
          throw new Error("invalid payload");
        }
        if (isCurrent && (!payload.context || (expectedContext && payload.context !== expectedContext))) {
          throw new Error("invalid context");
        }
      } catch (error) {
        return "[Encrypted content unavailable]";
      }
      return crypto.subtle.decrypt(
        isCurrent
          ? { name: "AES-GCM", iv: b64urlDecode(payload.iv), additionalData: additionalData(payload.context) }
          : { name: "AES-GCM", iv: b64urlDecode(payload.iv) },
        key,
        b64urlDecode(payload.data),
      ).then(function (plain) {
        return textDecoder.decode(plain);
      }).catch(function () {
        return "[Encrypted content unavailable]";
      });
    });
  }

  function detectImageType(bytes) {
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
    if (view.length >= 8 && view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47 && view[4] === 0x0d && view[5] === 0x0a && view[6] === 0x1a && view[7] === 0x0a) return "image/png";
    if (view.length >= 6 && view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38 && (view[4] === 0x37 || view[4] === 0x39) && view[5] === 0x61) return "image/gif";
    if (view.length >= 12 && view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 && view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) return "image/webp";
    return null;
  }

  function encryptFile(file) {
    if (!(file instanceof File)) return Promise.reject(new Error("Please choose a photo to upload."));
    if (file.size > MAX_IMAGE_BYTES) return Promise.reject(new Error("Photos must be 50 MB or smaller."));
    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var detectedType = detectImageType(bytes);
      if (!detectedType || !ALLOWED_IMAGE_TYPES[detectedType]) {
        throw new Error("Only valid JPEG, PNG, WebP, or GIF images can be uploaded.");
      }
      return ensureReady().then(function (key) {
        var iv = randomBytes(12);
        return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: additionalData("photo.file") }, key, bytes).then(function (ciphertext) {
          var header = FILE_PREFIX + JSON.stringify({
            iv: b64urlEncode(iv),
            tag: "packed",
            mimeType: detectedType,
            context: "photo.file",
          }) + "\n";
          return {
            mimeType: detectedType,
            blob: new Blob([textEncoder.encode(header), new Uint8Array(ciphertext)], { type: "application/octet-stream" }),
          };
        });
      });
    });
  }

  function decryptFileBuffer(buffer, fallbackMimeType) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var prefix = textEncoder.encode(FILE_PREFIX);
    var previousPrefix = textEncoder.encode(PREVIOUS_FILE_PREFIX);
    var isCurrent = prefix.every(function (value, index) { return bytes[index] === value; });
    var isPrevious = previousPrefix.every(function (value, index) { return bytes[index] === value; });
    if (!isCurrent && !isPrevious) {
      if (textDecoder.decode(bytes.subarray(0, LEGACY_FILE_PREFIX.length)) === LEGACY_FILE_PREFIX) {
        return Promise.reject(new Error("Encrypted photo needs migration before it can be opened in the browser."));
      }
      return Promise.resolve({ bytes: bytes, mimeType: fallbackMimeType || "application/octet-stream" });
    }
    var activePrefix = isCurrent ? prefix : previousPrefix;
    var newline = bytes.indexOf(10);
    if (newline <= activePrefix.length) return Promise.reject(new Error("Encrypted photo header is invalid."));
    var header = JSON.parse(textDecoder.decode(bytes.subarray(activePrefix.length, newline)));
    if (isCurrent && header.context !== "photo.file") return Promise.reject(new Error("Encrypted photo context is invalid."));
    return ensureReady().then(function (key) {
      return crypto.subtle.decrypt(
        isCurrent
          ? { name: "AES-GCM", iv: b64urlDecode(header.iv), additionalData: additionalData("photo.file") }
          : { name: "AES-GCM", iv: b64urlDecode(header.iv) },
        key,
        bytes.subarray(newline + 1),
      ).then(function (plain) {
        return {
          bytes: new Uint8Array(plain),
          mimeType: String(header.mimeType || fallbackMimeType || "application/octet-stream"),
        };
      });
    });
  }

  function fetchPhotoBlobUrl(url) {
    var key = String(url || "");
    if (!key) return Promise.reject(new Error("Missing photo URL."));
    if (photoCache.has(key)) return photoCache.get(key);
    var promise = fetch(key, { credentials: "same-origin" })
      .then(function (response) {
        if (response.status === 401 || response.status === 403) clearAfterSessionLoss();
        if (!response.ok) throw new Error("Could not load the encrypted photo.");
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        return decryptFileBuffer(buffer, "application/octet-stream");
      })
      .then(function (file) {
        var objectUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType || "application/octet-stream" }));
        photoObjectUrls.add(objectUrl);
        return objectUrl;
      })
      .catch(function (error) {
        photoCache.delete(key);
        throw error;
      });
    photoCache.set(key, promise);
    return promise;
  }

  function decryptTextNodes(root) {
    var scope = root || document;
    return ensureReady().then(function () {
      var nodes = scope.querySelectorAll("[data-private-text]");
      return Promise.all(Array.prototype.map.call(nodes, function (node) {
        node.setAttribute("data-private-loaded", "loading");
        return decryptText(node.getAttribute("data-private-text") || "", node.getAttribute("data-private-context") || "").then(function (value) {
          node.textContent = value || node.getAttribute("data-private-fallback") || "";
          node.setAttribute("data-private-loaded", "true");
        }).catch(function (error) {
          node.setAttribute("data-private-loaded", "error");
          throw error;
        });
      }));
    });
  }

  function waitForImage(image) {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    if (typeof image.decode === "function") {
      return image.decode().catch(function () {
        if (image.complete && image.naturalWidth > 0) return;
        throw new Error("Could not decode the private photo.");
      });
    }
    return new Promise(function (resolve, reject) {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", function () {
        reject(new Error("Could not display the private photo."));
      }, { once: true });
    });
  }

  function hydratePhotoNodes(root) {
    var scope = root || document;
    return ensureReady().then(function () {
      var nodes = scope.querySelectorAll("[data-private-photo]");
      return Promise.all(Array.prototype.map.call(nodes, function (node) {
        var url = node.getAttribute("data-private-photo");
        if (!url) return Promise.resolve();
        node.setAttribute("data-private-loaded", "loading");
        return fetchPhotoBlobUrl(url).then(function (blobUrl) {
          if (node.tagName === "IMG") {
            node.src = blobUrl;
            return waitForImage(node);
          } else if (node.style) {
            var image = new Image();
            image.src = blobUrl;
            return waitForImage(image).then(function () {
              node.style.backgroundImage = 'url("' + blobUrl + '")';
            });
          }
        }).then(function () {
          node.setAttribute("data-private-loaded", "true");
        }).catch(function () {
          node.setAttribute("data-private-loaded", "error");
        });
      }));
    });
  }

  function encryptFormFields(form, fieldContexts) {
    var contexts = fieldContexts && typeof fieldContexts === "object" ? fieldContexts : {};
    var fields = Object.keys(contexts);
    return ensureReady().then(function () {
      return Promise.all(fields.map(function (name) {
        var field = form.elements.namedItem(name);
        if (!field || typeof field.value !== "string") return null;
        var value = trim(field.value);
        return encryptText(value, contexts[name]).then(function (encrypted) {
          field.value = encrypted;
          return true;
        });
      }));
    });
  }

  window.OurNestPrivate = {
    ready: ensureReady,
    encryptText: encryptText,
    decryptText: decryptText,
    encryptFile: encryptFile,
    decryptFileBuffer: decryptFileBuffer,
    decryptTextNodes: decryptTextNodes,
    hydratePhotoNodes: hydratePhotoNodes,
    fetchPhotoBlobUrl: fetchPhotoBlobUrl,
    encryptFormFields: encryptFormFields,
    changePassphrase: showChangePassphrase,
    isEncryptedText: function (value) {
      var text = String(value || "");
      return text.indexOf(TEXT_PREFIX) === 0 || text.indexOf(PREVIOUS_TEXT_PREFIX) === 0;
    },
    isLegacyEncryptedText: function (value) { return String(value || "").indexOf(LEGACY_TEXT_PREFIX) === 0; },
    clearCachedKey: clearPrivateState,
    events: { ready: READY_EVENT, failed: FAILED_EVENT },
  };

  window.addEventListener("storage", function (event) {
    if (event.key === CLEAR_SIGNAL_KEY && event.newValue) clearAfterSessionLoss(false);
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM" || form.getAttribute("action") !== "/api/auth/logout") return;
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    logoutNow().then(function (loggedOut) {
      if (!loggedOut && button) button.disabled = false;
    });
  });

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest && event.target.closest("[data-private-space-change]");
    if (!target) return;
    event.preventDefault();
    showChangePassphrase().catch(function (error) {
      window.alert(error instanceof Error ? error.message : "Could not open the passphrase settings.");
    });
  });

  clearLegacyStoredKeys();
  ensureReady().then(function () {
    markReady(bundleCache);
  }).catch(function () {});
})();
