// DuckDuckGo autoconsent 18.12.0, MPL-2.0 (https://github.com/duckduckgo/autoconsent). Built by Scripts/autoconsent.py.
"use strict";
(() => {
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

  // lib/rules.ts
  var SUPPORTED_RULE_STEP_VERSION = 3;

  // lib/random.ts
  function getRandomID() {
    if (crypto && typeof crypto.randomUUID !== "undefined") {
      return crypto.randomUUID();
    }
    return Math.random().toString();
  }

  // lib/eval-handler.ts
  var Deferred = class {
    constructor(id, timeout = 1e3) {
      this.id = id;
      this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
      this.timer = window.setTimeout(() => {
        this.reject(new Error("timeout"));
      }, timeout);
    }
  };
  var evalState = {
    pending: /* @__PURE__ */ new Map(),
    sendContentMessage: null
  };
  function requestEval(code, snippetId) {
    if (!evalState.sendContentMessage) {
      return Promise.reject(new Error("AutoConsent is not initialized yet"));
    }
    const id = getRandomID();
    evalState.sendContentMessage({
      type: "eval",
      id,
      code,
      snippetId
    });
    const deferred = new Deferred(id);
    evalState.pending.set(deferred.id, deferred);
    return deferred.promise;
  }
  function resolveEval(id, value) {
    const deferred = evalState.pending.get(id);
    if (deferred) {
      evalState.pending.delete(id);
      deferred.timer && window.clearTimeout(deferred.timer);
      deferred.resolve(value);
    } else {
      console.warn("no eval #", id);
    }
  }

  // lib/utils.ts
  function getStyleElement(styleOverrideElementId = "autoconsent-css-rules") {
    const styleSelector = `style#${styleOverrideElementId}`;
    const existingElement = document.querySelector(styleSelector);
    if (existingElement && existingElement instanceof HTMLStyleElement) {
      return existingElement;
    } else {
      const parent = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
      const css = document.createElement("style");
      css.id = styleOverrideElementId;
      parent.appendChild(css);
      return css;
    }
  }
  function getHidingStyle(method) {
    const hidingSnippet = method === "opacity" ? `opacity: 0` : `display: none`;
    return `${hidingSnippet} !important; z-index: -1 !important; pointer-events: none !important;`;
  }
  function hideElements(styleEl, selector, method = "display") {
    const rule = `${selector} { ${getHidingStyle(method)} } `;
    if (styleEl instanceof HTMLStyleElement) {
      styleEl.innerText += rule;
      return selector.length > 0;
    }
    return false;
  }
  function appendStylesheetRule(styleEl, cssRule, marker) {
    if (!(styleEl instanceof HTMLStyleElement) || cssRule.length === 0) {
      return false;
    }
    const markerComment = marker ? `/* autoconsent:${marker} */` : "";
    if (markerComment && styleEl.innerText.includes(markerComment)) {
      return true;
    }
    if (!markerComment && styleEl.innerText.includes(cssRule.trim())) {
      return true;
    }
    styleEl.innerText += `${markerComment}${markerComment ? " " : ""}${cssRule} `;
    return true;
  }
  async function waitFor(predicate, maxTimes, interval) {
    const result = await predicate();
    if (!result && maxTimes > 0) {
      return new Promise((resolve) => {
        setTimeout(async () => {
          resolve(waitFor(predicate, maxTimes - 1, interval));
        }, interval);
      });
    }
    return Promise.resolve(result);
  }
  function isElementVisible(elem) {
    if (!elem) {
      return false;
    }
    if (elem.offsetParent !== null) {
      return true;
    } else {
      const css = window.getComputedStyle(elem);
      if (css.position === "fixed" && css.display !== "none") {
        return true;
      }
    }
    return false;
  }
  function copyObject(data) {
    if (globalThis.structuredClone) {
      return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data));
  }
  function normalizeConfig(providedConfig) {
    const defaultConfig = {
      enabled: true,
      autoAction: "optOut",
      // if falsy, the extension will wait for an explicit user signal before opting in/out
      disabledCmps: [],
      enablePrehide: true,
      enableCosmeticRules: true,
      enableGeneratedRules: true,
      enableHeuristicDetection: false,
      enablePopupMutationObserver: false,
      detectRetries: 20,
      isMainWorld: false,
      prehideTimeout: 2e3,
      visualTest: false,
      logs: {
        lifecycle: false,
        rulesteps: false,
        detectionsteps: false,
        evals: false,
        errors: true,
        messages: false,
        waits: false
      },
      performanceLoggingEnabled: false,
      heuristicPopupSearchTimeout: 100,
      enableHeuristicHitTest: false,
      heuristicMode: "off"
      // heuristic disabled by default
    };
    const updatedConfig = copyObject(defaultConfig);
    for (const key of Object.keys(defaultConfig)) {
      if (typeof providedConfig[key] !== "undefined") {
        updatedConfig[key] = providedConfig[key];
      }
    }
    return updatedConfig;
  }
  function scheduleWhenIdle(callback, timeout = 500) {
    if (globalThis.requestIdleCallback) {
      requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, 0);
    }
  }
  function highlightNode(node) {
    const highlightedNode = node;
    if (!node.style) return;
    if (highlightedNode.__oldStyles !== void 0) {
      return;
    }
    if (node.hasAttribute("style")) {
      highlightedNode.__oldStyles = node.style.cssText;
    }
    node.style.animation = "pulsate .5s infinite";
    node.style.outline = "solid red";
    let styleTag = document.querySelector("style#autoconsent-debug-styles");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "autoconsent-debug-styles";
    }
    styleTag.textContent = `
      @keyframes pulsate {
        0% {
          outline-width: 8px;
          outline-offset: -4px;
        }
        50% {
          outline-width: 4px;
          outline-offset: -2px;
        }
        100% {
          outline-width: 8px;
          outline-offset: -4px;
        }
      }
    `;
    document.head.appendChild(styleTag);
  }
  function unhighlightNode(node) {
    const highlightedNode = node;
    if (!node.style || !node.hasAttribute("style")) return;
    if (highlightedNode.__oldStyles !== void 0) {
      node.style.cssText = highlightedNode.__oldStyles;
      delete highlightedNode.__oldStyles;
    } else {
      node.removeAttribute("style");
    }
  }
  function isTopFrame() {
    return window.top === window && (!globalThis.location.ancestorOrigins || globalThis.location.ancestorOrigins.length === 0);
  }

  // lib/eval-snippets.ts
  var snippets = {
    // code-based rules
    EVAL_0: () => console.log(1),
    EVAL_DIDOMI_OPT_OUT: () => {
      if (window.Didomi) {
        window.Didomi.setUserDisagreeToAll();
        return true;
      }
      return false;
    },
    EVAL_DIDOMI_TEST: () => {
      const purposes = window.Didomi?.getCurrentUserStatus?.()?.purposes;
      if (purposes) {
        return Object.values(purposes).some((p) => !p.enabled);
      }
      const disabled = window.Didomi?.getUserConsentStatusForAll?.()?.purposes?.disabled;
      return Array.isArray(disabled) && disabled.length > 0;
    },
    EVAL_CONSENTMANAGER_1: () => {
      const cmpData = window.__cmp?.("getCMPData");
      return !!cmpData && typeof cmpData === "object";
    },
    EVAL_CONSENTMANAGER_2: () => window.__cmp?.("consentStatus")?.userChoiceExists === false,
    EVAL_CONSENTMANAGER_3: () => __cmp("setConsent", 0),
    EVAL_CONSENTMANAGER_4: () => __cmp("setConsent", 1),
    EVAL_CONSENTMANAGER_5: () => __cmp("consentStatus").userChoiceExists,
    EVAL_CONSENTMANAGER_NCMP_REJECT: () => {
      if (typeof window.__npcmp !== "function") return false;
      window.__npcmp("reject");
      return true;
    },
    EVAL_CONSENTMANAGER_NCMP_ACCEPT: () => {
      if (typeof window.__npcmp !== "function") return false;
      window.__npcmp("save");
      return true;
    },
    EVAL_COOKIEBOT_1: () => !!window.Cookiebot,
    EVAL_COOKIEBOT_2: () => !window.Cookiebot.hasResponse && window.Cookiebot.dialog?.visible === true,
    EVAL_COOKIEBOT_3: () => window.Cookiebot.withdraw() || true,
    EVAL_COOKIEBOT_4: () => window.Cookiebot.hide() || true,
    EVAL_COOKIEBOT_5: () => window.Cookiebot.declined === true,
    EVAL_KLARO_1: () => {
      const config = globalThis.klaroConfig || globalThis.klaro?.getManager && globalThis.klaro.getManager().config;
      if (!config) {
        return true;
      }
      const optionalServices = (config.services || config.apps).filter((s) => !s.required).map((s) => s.name);
      if (klaro && klaro.getManager) {
        const manager = klaro.getManager();
        return optionalServices.every((name) => !manager.consents[name]);
      } else if (klaroConfig && klaroConfig.storageMethod === "cookie") {
        const cookieName = klaroConfig.cookieName || klaroConfig.storageName;
        const consents = JSON.parse(
          decodeURIComponent(
            document.cookie.split(";").find((c) => c.trim().startsWith(cookieName)).split("=")[1]
          )
        );
        return Object.keys(consents).filter((k) => optionalServices.includes(k)).every((k) => consents[k] === false);
      }
    },
    EVAL_KLARO_OPEN_POPUP: () => {
      klaro.show(void 0, true);
    },
    EVAL_KLARO_TRY_API_OPT_OUT: () => {
      if (window.klaro && typeof klaro.show === "function" && typeof klaro.getManager === "function") {
        try {
          klaro.getManager().changeAll(false);
          klaro.getManager().saveAndApplyConsents();
          return true;
        } catch (e) {
          console.warn(e);
          return false;
        }
      }
      return false;
    },
    EVAL_ONETRUST_1: () => window.OnetrustActiveGroups.split(",").filter((s) => s.length > 0).length <= 1,
    EVAL_TRUSTARC_TOP: () => window && window.truste && window.truste.eu.bindMap.prefCookie === "0",
    EVAL_TRUSTARC_FRAME_TEST: () => window && window.QueryString && window.QueryString.preferences === "0",
    EVAL_TRUSTARC_FRAME_GTM: () => window && window.QueryString && window.QueryString.gtm === "1",
    // declarative rules
    EVAL_ACCEPTRICS_TEST: () => Object.values(JSON.parse(localStorage.getItem("__acceptrics_settings")).purposes).every((purpose) => purpose === "rejected"),
    EVAL_ADOPT_TEST: () => !!localStorage.getItem("adoptConsentMode"),
    EVAL_ADULTFRIENDFINDER_TEST: () => !!localStorage.getItem("cookieConsent"),
    EVAL_AYLO_COOKIE_MANAGER_READY: () => !!(window.wl_cookie_consent_manager || window._Cookie_Consent_Manager_brand),
    EVAL_BAHN_TEST: () => utag.gdpr.getSelectedCategories().length === 1,
    // the close handler listens for mouseup, which element.click() does not dispatch
    EVAL_BING_NOTICE_CLOSE: () => {
      const close = document.querySelector("#bnp_ttc_close");
      close.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      close.click();
      return true;
    },
    EVAL_BIGCOMMERCE_CONSENT_MANAGER_DETECT: () => !!(window.consentManager && window.consentManager.version),
    EVAL_BORLABS_0: () => !JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((c) => c.indexOf("borlabs-cookie") !== -1).split("=", 2)[1]
      )
    ).consents.statistics,
    EVAL_CC_BANNER2_0: () => !!document.cookie.match(/sncc=[^;]+D%3Dtrue/),
    // the close icon is an SVG, which has no click() method
    EVAL_COOKIE_POPUP_CLOSE: () => document.querySelector("#cookie-popup #close-cookies").dispatchEvent(new MouseEvent("click", { bubbles: true })) || true,
    EVAL_COOKIE_LAW_INFO_0: () => {
      if (CLI.disableAllCookies) CLI.disableAllCookies();
      if (CLI.reject_close) CLI.reject_close();
      document.body.classList.remove("cli-barmodal-open");
      return true;
    },
    EVAL_COOKIE_LAW_INFO_DETECT: () => !!window.CLI,
    EVAL_COOKIEFIRST_0: () => ((o) => o.performance === false && o.functional === false && o.advertising === false)(
      JSON.parse(
        decodeURIComponent(
          document.cookie.split(";").find((c) => c.indexOf("cookiefirst") !== -1).trim()
        ).split("=")[1]
      )
    ),
    EVAL_COOKIEFIRST_1: () => document.querySelectorAll("button[data-cookiefirst-accent-color=true][role=checkbox]:not([disabled])").forEach((i) => i.getAttribute("aria-checked") === "true" && i.click()) || true,
    EVAL_COOKIEINFORMATION_0: () => CookieInformation.declineAllCategories() || true,
    EVAL_COOKIEINFORMATION_1: () => CookieInformation.submitAllCategories() || true,
    // banner button order and meaning are configurable per site, so set the consent levels through the public API
    EVAL_COOKIEREPORTS_OPT_OUT: () => {
      const cr = window._cookiereports;
      if (typeof cr?.saveConsent !== "function") return false;
      cr.saveConsent({ 1: true, 2: false, 3: false, 4: false, 5: false });
      cr.processConsent("banner", { trigger: "ok" });
      cr.hideBanner();
      return true;
    },
    EVAL_COOKIEREPORTS_OPT_IN: () => {
      const cr = window._cookiereports;
      if (typeof cr?.saveConsent !== "function") return false;
      cr.saveConsent({ 1: true, 2: true, 3: true, 4: true, 5: true });
      cr.processConsent("banner", { trigger: "ok" });
      cr.hideBanner();
      return true;
    },
    EVAL_COOKIEREPORTS_TEST: () => {
      const levels = window._cookiereports?.loadConsent?.();
      return !!levels && Object.keys(levels).length > 0 && Object.values(levels).every((v) => !v);
    },
    // turn the single-button form into a decline submission, same fields as the CMP's own decline form
    EVAL_EE_CONSENT_DECLINE_0: () => document.querySelectorAll('#cookieConsentFormAccept input[name^="ee:cookies_"]').forEach((i) => i.value = "n") || true,
    EVAL_ETSY_0: () => document.querySelectorAll(".gdpr-overlay-body input").forEach((toggle) => {
      toggle.checked = false;
    }) || true,
    EVAL_ETSY_1: () => document.querySelector(".gdpr-overlay-view button[data-wt-overlay-close]").click() || true,
    EVAL_EZOIC_0: () => ezCMP.handleAcceptAllClick(),
    EVAL_FIDES_DETECT_POPUP: () => window.Fides?.initialized,
    // Zero while the embedding page still keeps the consent iframe collapsed.
    EVAL_IFRAME_SHOWN: () => window.innerHeight > 0,
    EVAL_IUBENDA_0: () => document.querySelectorAll(".purposes-item input[type=checkbox]:not([disabled])").forEach((x) => {
      if (x.checked) x.click();
    }) || true,
    EVAL_IUBENDA_1: () => !!document.cookie.match(/_iub_cs-\d+=/),
    EVAL_KALLES_THEME_TEST: () => {
      const consent = window.Shopify.customerPrivacy.currentVisitorConsent();
      return consent.marketing === "no" && consent.analytics === "no";
    },
    EVAL_KROWN_COOKIE_BANNER_TEST: () => localStorage.getItem("krown-cookie-banner") === "true",
    // the decline handler listens for mouseup/touchend, which element.click() does not dispatch
    EVAL_LETHPOLYTECH_DECLINE: () => document.querySelector(".consent-banner .cookie-decline").dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })) || true,
    // reading a cross-origin parent's document throws
    EVAL_MERCADOLIBRE_CROSS_ORIGIN_PARENT: () => {
      try {
        return !window.parent.document;
      } catch (e) {
        return true;
      }
    },
    // the embedded preferences page saves its current toggles on this message, normally sent by the parent's Save button
    EVAL_MERCADOLIBRE_SAVE: () => window.postMessage({ eventName: "saveCookiesPreference" }, "*") || true,
    EVAL_MICROSOFT_0: () => Array.from(document.querySelectorAll("div > button")).filter((el) => el.innerText.match("Reject|Ablehnen"))[0].click() || true,
    EVAL_MICROSOFT_1: () => Array.from(document.querySelectorAll("div > button")).filter((el) => el.innerText.match("Accept|Annehmen"))[0].click() || true,
    EVAL_MICROSOFT_2: () => !!document.cookie.match("MSCC|GHCC"),
    EVAL_MOOVE_0: () => document.querySelectorAll("#moove_gdpr_cookie_modal input").forEach((i) => {
      if (!i.disabled) i.checked = i.name === "moove_gdpr_strict_cookies" || i.id === "moove_gdpr_strict_cookies";
    }) || true,
    // the site reloads on banner button clicks, which can abort the SDK's deferred save
    EVAL_NFL_ONETRUST_ALLOW_ALL: () => {
      window.OneTrust.AllowAll();
      return true;
    },
    EVAL_NFL_ONETRUST_REJECT_ALL: () => {
      window.OneTrust.RejectAll();
      return true;
    },
    EVAL_NHNIEUWS_TEST: () => !!localStorage.getItem("psh:cookies-seen"),
    EVAL_OSANO_DETECT: () => !!window.Osano?.cm?.dialogOpen,
    EVAL_PANDECTES_TEST: () => document.cookie.includes("_pandectes_gdpr=") && JSON.parse(
      atob(
        document.cookie.split(";").find((s) => s.trim().startsWith("_pandectes_gdpr")).split("=")[1]
      )
    ).status === "deny",
    EVAL_POSTHOG_TEST: () => localStorage.getItem("cookie_consent") === "acknowledged",
    EVAL_POVR_GOBACK: () => window.history.back() || true,
    EVAL_PUBTECH_0: () => document.cookie.includes("euconsent-v2") && (document.cookie.match(/.YAAAAAAAAAAA/) || document.cookie.match(/.aAAAAAAAAAAA/) || document.cookie.match(/.YAAACFgAAAAA/)),
    EVAL_SHOPIFY_TEST: () => document.cookie.includes("gdpr_cookie_consent=0") || document.cookie.includes("_tracking_consent=") && JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((s) => s.trim().startsWith("_tracking_consent")).split("=")[1]
      )
    ).purposes.a === false,
    EVAL_SIRDATA_UNBLOCK_SCROLL: () => {
      document.documentElement.classList.forEach((cls) => {
        if (cls.startsWith("sd-cmp-")) document.documentElement.classList.remove(cls);
      });
      return true;
    },
    EVAL_SOURCEPOINT_RESTORE_SCROLL: () => {
      const root = document.documentElement;
      const saved = root.dataset.previousScrollY;
      if (saved && saved !== "null") {
        root.dataset.previousScrollY = "null";
        const y = -parseInt(saved, 10);
        if (y > 0 && window.scrollY === 0) {
          const behavior = root.style.scrollBehavior;
          root.style.scrollBehavior = "auto";
          window.scrollTo(0, y);
          root.style.scrollBehavior = behavior;
        }
      }
      window.addEventListener("pagehide", () => {
        if (root.dataset.previousScrollY) root.dataset.previousScrollY = "null";
      });
      return true;
    },
    EVAL_SS_COM_OPT_OUT: () => _gdpr_confirm(false) || true,
    EVAL_SS_COM_TEST: () => /-necessary$/.test(localStorage.getItem("ss_cc")),
    EVAL_STEAMPOWERED_0: () => JSON.parse(
      decodeURIComponent(
        document.cookie.split(";").find((s) => s.trim().startsWith("cookieSettings")).split("=")[1]
      )
    ).preference_state === 2,
    EVAL_TARTEAUCITRON_0: () => tarteaucitron.userInterface.respondAll(false) || true,
    EVAL_TARTEAUCITRON_1: () => tarteaucitron.userInterface.respondAll(true) || true,
    EVAL_TARTEAUCITRON_2: () => document.cookie.match(/tarteaucitron=[^;]*/)?.[0].includes("false"),
    EVAL_TEALIUM_0: () => typeof window.utag !== "undefined" && typeof utag.gdpr === "object",
    EVAL_TEALIUM_1: () => utag.gdpr.setConsentValue(false) || true,
    EVAL_TEALIUM_DONOTSELL: () => utag.gdpr.dns?.setDnsState(false) || true,
    EVAL_TEALIUM_2: () => utag.gdpr.setConsentValue(true) || true,
    EVAL_TEALIUM_3: () => utag.gdpr.getConsentState() !== 1,
    EVAL_TEALIUM_DONOTSELL_CHECK: () => utag.gdpr.dns?.getDnsState() !== 1,
    // 0 means no stored decision; otherwise the user reopened the prompt themselves
    EVAL_TEALIUM_NO_DECISION: () => utag.gdpr.getConsentState() === 0,
    EVAL_TESTCMP_STEP: () => !!document.querySelector("#reject-all"),
    EVAL_TESTCMP_0: () => window.results.results[0] === "button_clicked",
    EVAL_TESTCMP_COSMETIC_0: () => window.results.results[0] === "banner_hidden",
    // Same handler the banner buttons call; which button refuses differs per template.
    EVAL_TRUSTCOMMANDER_BANNER_SHOWN: () => {
      const wrapper = document.getElementById("tc-privacy-wrapper");
      return !!wrapper && getComputedStyle(wrapper).visibility !== "hidden";
    },
    EVAL_TRUSTCOMMANDER_OPTIN: () => {
      if (typeof window.tC?.privacy?.clickBanner !== "function") return false;
      window.tC.privacy.clickBanner("optin");
      return true;
    },
    EVAL_TRUSTCOMMANDER_OPTOUT: () => {
      if (typeof window.tC?.privacy?.clickBanner !== "function") return false;
      window.tC.privacy.clickBanner("optout");
      return true;
    },
    EVAL_USERCENTRICS_API_0: () => typeof UC_UI === "object",
    EVAL_USERCENTRICS_API_1: () => !!UC_UI.closeCMP(),
    EVAL_USERCENTRICS_API_2: () => !!UC_UI.denyAllConsents(),
    EVAL_USERCENTRICS_API_3: () => !!UC_UI.acceptAllConsents(),
    EVAL_USERCENTRICS_API_4: () => !!UC_UI.closeCMP(),
    EVAL_USERCENTRICS_API_5: () => UC_UI.areAllConsentsAccepted() === true,
    EVAL_USERCENTRICS_API_6: () => UC_UI.areAllConsentsAccepted() === false,
    EVAL_WBD_LTP_CLOSE: () => document.querySelector("dialog#ltp-dialog").close() || true,
    EVAL_ZOHO_TEST: () => localStorage.getItem("zglobal_Acookie_optOut") === "3"
  };
  function getFunctionBody(snippetFunc) {
    const snippetStr = snippetFunc.toString();
    return `(${snippetStr})()`;
  }

  // lib/heuristic-patterns.ts
  var patternOf = (p) => p instanceof RegExp ? p : p.pattern;
  var BY_CONTINUING_PRIVACY = /(?:by continuing.{0,100}privacy)|(?:privacy.{0,100}by continuing)/gi;
  var USE_OF_COOKIES = /use of cookies/gi;
  var UTILISATION_DES_COOKIES = /utilisation.{0,100}des.{0,100}cookies/gi;
  var ACCEPTEZ_UTILISATION = /acceptez.{0,100}l.{0,100}utilisation/gi;
  var VERWENDUNG_VON_COOKIES = /verwendung.{0,100}von.{0,100}cookies/gi;
  var DE_COOKIE_VERB = /\b(?:nutzen|nutzt|verwenden|verwendet|setzen|setzt|benutzen|benutzt|speichert|platzieren)\b(?: \S+){0,4} cookies\b/gi;
  var GEBRUIK_VAN_COOKIES = /gebruik.{0,100}van.{0,100}cookies/gi;
  var USO_DEI_COOKIE = /\b(?:uso|utilizzo) dei cookies?\b/gi;
  var ANVANDNING_AV_COOKIES = /\b(?:användning|användningen|användandet) av (?:\S+ )?(?:cookies|kakor)\b/gi;
  var DE_THIS_SITE_COOKIES = /\b(?:unsere|diese)[rs]? (?:web)?(?:seite|site)\b.{0,100}cookies/gi;
  var DE_SITE_USES_COOKIES = /\b(?:seite|site)\b.{0,100}\b(?:nutzt|benutzt)\b.{0,100}cookies/gi;
  var DETECT_PATTERNS = [
    // no bare "accept all" / "reject all" labels in any language: page content with bulk actions has them too
    /accept cookies/gi,
    /only necessary cookies/gi,
    // "only necessary" is probably too broad
    /(?:by continuing.{0,100}cookie)|(?:cookie.{0,100}by continuing)/gi,
    /\bby using (?:this|our) (?:web)?site\b.{0,100}cookie/gi,
    // "By clicking 'Accept all', you agree to the storing of cookies …"
    /\bby clicking\b.{0,80}?\byou (?:allow|accept|agree|consent)\w*\b.{0,100}?\b(?:cookies?|technologies)\b/gi,
    // button labels count only with the cookie noun: bare "accept all" / "reject all" also label bulk actions in page content
    /accept all cookies/gi,
    /\breject non-(?:essential|necessary)\b/gi,
    /\bwhich (?:types? of )?cookies (?:that )?you (?:accept|allow|want)\b/gi,
    /\bstores? cookies on your (?:device|computer|browser)\b/gi,
    /\byour consent to (?:collect|use|store|process|set)\b/gi,
    /\byou agree to (?:our |the )?cookie use\b/gi,
    /\bblocking some types of cookies\b/gi,
    // consent management platform footers
    /\bpowered by usercentrics\b|\b(?:realisiert mit|realized with) klaro\b/gi,
    BY_CONTINUING_PRIVACY,
    // up to two qualifiers are common: "optional", "essential", "analytics", "google analytics", "third party", ...
    // singular too, but not "cookie-free"
    /we (?:also )?(?:use|serve)(?: \w+){0,2} cookies?\b(?!-)/gi,
    /\bwe use (?:\S+ )?cookie files\b/gi,
    // consent asked as a question: "can I use cookies to …?", "allow analytics cookies?"
    /\b(?:can|may) (?:i|we) use (?:\S+ ){0,2}cookies\b/gi,
    /\ballow (?:\S+ )?cookies\?/gi,
    /we are using cookies/gi,
    USE_OF_COOKIES,
    /website uses cookies to enhance your browsing experience/gi,
    /(?:this|our) (?:web)?site.{0,100}cookies/gi,
    /cookies (?:and|or) .{0,100} technologies/gi,
    /such as cookies/gi,
    /read more about.{0,100}cookies/gi,
    /consent to.{0,100}cookies/gi,
    /we and our (?:\w+ )?partners.{0,100}cookies/gi,
    /we.{0,100}store.{0,100}information.{0,100}such as.{0,100}cookies/gi,
    /store and\/or access information.{0,100}on a device/gi,
    /personalised ads and content, ad and content measurement/gi,
    // TCF wording: "store and/or access information", "and our partners ask for your consent", "we and our N partners"
    /\b(?:store|stores|storing) and\/or access(?:ing)? information\b/gi,
    /\band our partners ask for your consent\b/gi,
    /\bwe and (?:our|up to) (?:\d+ )?(?:partners|vendors)\b/gi,
    // a partner count, in each language: "our 186 partners", "unseren 107 Partnern", "nuestros 1064 socios"
    /\b(?:our|unseren|onze|nos|nuestros|i nostri) \d{2,4} (?:partners|partnern|partner|partenaires|socios|vendors|fornitori)\b/gi,
    /\b\d{2,4} iab[- ]partner/gi,
    // "technologies like cookies", in each language
    /\btechnolog(?:ies|ien|ieën|ías|ie) (?:like|such as|wie|zoals|como(?: las)?|telles que(?: les)?|come(?: i)?) cookies?\b/gi,
    /\buses (?:\S+ ){0,2}cookies\b/gi,
    /\b(?:like|want) to (?:use|set) (?:\S+ ){0,2}cookies\b/gi,
    /\b(?:optional|additional|non-essential) cookies\b/gi,
    /\bstoring of cookies\b|\bplaced cookies\b/gi,
    /\b(?:store|stores) and access (?:data|information) on your device\b|\baccess and store (?:data|information) on your device\b/gi,
    /\bwe use (?:\S+ ){1,4}cookies\b/gi,
    // US privacy notices: opt-out sentences, not the footer link labels
    /\byou (?:can|may) opt[- ]out of (?:the |this )?(?:sale|sharing|use|selling)\b/gi,
    /\b(?:if you wish to|to) opt[- ]out of the sale\b/gi,
    /\bthis website or its third[- ]party tools (?:process|use)\b/gi,
    /["“]?(?:share|sell)["”]? or ["“]?(?:sell|share)["”]? (?:your )?(?:personal )?information\b/gi,
    /\bresidents have (?:certain )?rights with regard to the sale\b/gi,
    /\bwe use technologies (?:on this website )?(?:that may )?(?:to )?collect\b/gi,
    /\bwe use third[- ]party tools to collect information\b/gi,
    // pay-or-consent walls
    /\bcontinue reading with advertising\b|\b(?:with|mit) (?:advertising|werbung) (?:and|und) tracking\b/gi,
    /\bconsent and continue\b/gi,
    // preference centres are often in the page but hidden, so popup text only
    { pattern: /\bstore or retrieve information on your browser\b|\bstockées dans votre navigateur ou récupérées\b/gi, input: "popup" },
    /\bwe have cookies\b/gi,
    /\b(?:revoke|withdraw) your consent at any time\b|\beinwilligung jederzeit widerrufen\b/gi,
    /\bwe use (?:[\w-]+ )?analytics (?:to|for)\b|\bwe use google analytics\b.{0,100}\bcookie/gi,
    /\b(?:con|senza) il (?:tuo|vostro) consenso\b/gi,
    /\baccept or (?:reject|decline) (?:all |optional |non-essential )?cookies\b/gi,
    // the consent choice itself, as in FR/IT/ES: "continuer sans accepter"
    /\bcontinue without accepting\b/gi,
    // "choose between essential cookies that are required for the site to work or all cookies"
    /\bcookies (?:that are )?(?:strictly )?(?:required|necessary|needed) for (?:the|this|our) (?:web)?site to (?:work|function)\b/gi,
    // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
    // /cookies? settings/i,
    // /cookies? preferences/i,
    // FR
    /utilisons.{0,100}des.{0,100}cookies/gi,
    /des.{0,100}cookies.{0,100}pour/gi,
    /retirer.{0,100}votre.{0,100}consentement/gi,
    /et.{0,100}nos.{0,100}partenaires/gi,
    /publicités.{0,100}et.{0,100}du.{0,100}contenu/gi,
    /utilise.{0,100}des.{0,100}cookies/gi,
    /utilisent.{0,100}des.{0,100}cookies/gi,
    /stocker.{0,100}et.{0,100}ou.{0,100}accéder/gi,
    /consentement.{0,100}à.{0,100}tout.{0,100}moment/gi,
    /votre.{0,100}consentement/gi,
    UTILISATION_DES_COOKIES,
    /cookies.{0,100}ou.{0,100}technologies/gi,
    ACCEPTEZ_UTILISATION,
    /continuer sans accepter/gi,
    /(?:refuser|rejeter) tous les cookies/gi,
    // not "je refuse d'…" in a headline
    /je refuse(?! d['’e])/gi,
    /refuser et continuer/gi,
    /\ben cliquant sur\b.{0,80}?\bvous (?:acceptez|consentez)\b.{0,60}?\b(?:cookies|traceurs)\b/gi,
    /\bvous consentez\b.{0,60}\bcookies\b/gi,
    /\baccepter ou refuser (?:\S+ ){0,3}cookies\b/gi,
    /\bles cookies nous (?:sont|permettent|aident)\b/gi,
    /\btraceurs (?:optionnels|publicitaires|non essentiels)\b/gi,
    /seulement nécessaires/gi,
    /je désactive les finalités non essentielles/gi,
    /cookies essentiels uniquement/gi,
    /nécessaires uniquement/gi,
    /\b(?:stocker|stockons) et\/ou (?:accéder|accédons)\b/gi,
    /\bnos partenaires demandent votre consentement\b/gi,
    /\bconsentez à l.utilisation (?:de |des )?cookies\b|\bdépôt (?:de|des) cookies\b/gi,
    /\bles cookies nous permettent\b|\bnos partenaires et nous(?:-mêmes)?\b/gi,
    /\baccepter (?:&|et) fermer\b/gi,
    // up to two qualifiers, as in English: "nous utilisons nos propres cookies", "nous utilisons des cookies tiers"
    /\b(?:on utilise|nous utilisons)(?: \S+){0,2} cookies\b/gi,
    /\ben (?:naviguant|poursuivant)\b.{0,100}cookies/gi,
    /(?:en continuant.{0,100}cookie)|(?:cookie.{0,100}en continuant)/gi,
    /\ben (?:naviguant|poursuivant|continuant)\b.{0,100}confidentialité/gi,
    // DE
    /wir.{0,100}verwenden.{0,100}cookies/gi,
    /wir.{0,100}und.{0,100}unsere.{0,100}partner/gi,
    /zugriff auf informationen auf/gi,
    /inhalte.{0,100}messung.{0,100}von.{0,100}werbeleistung.{0,100}und/gi,
    /cookies.{0,100}und.{0,100}andere/gi,
    VERWENDUNG_VON_COOKIES,
    /wir.{0,100}nutzen.{0,100}cookies/gi,
    /verwendet.{0,100}cookies/gi,
    /nutzt.{0,100}cookies/gi,
    /sie.{0,100}können.{0,100}ihre.{0,100}auswahl/gi,
    /und.{0,100}ähnliche.{0,100}technologien/gi,
    /cookies.{0,100}wir.{0,100}verwenden/gi,
    /(?:nur|nicht).{0,100}(?:zusätzliche|essenzielle|funktionale|notwendige|erforderliche).{0,100}(?:cookies|akzeptieren|erlauben|ablehnen)/gi,
    /weiter.{0,100}(?:ohne|mit).{0,100}(?:einwilligung|zustimmung|cookies)/gi,
    /(?:cookies|einwilligung).{0,100}ablehnen/gi,
    /nur funktionale cookies akzeptieren/gi,
    /optionale ablehnen/gi,
    /zustimmung verweigern/gi,
    /\bspeichern und\/oder (?:zugreifen|abrufen)\b/gi,
    /\bunsere partner bitten um ihre zustimmung\b/gi,
    DE_COOKIE_VERB,
    /\b(?:werden|wird) (?:\S+ ){0,3}cookies (?:verwendet|eingesetzt|gesetzt|genutzt)\b/gi,
    /\bcookies? zum einsatz\b|\beinsatz von cookies\b/gi,
    /\beinverstanden\b.{0,60}\bcookies\b|\bcookies\b.{0,80}\beinverstanden\b/gi,
    /\b(?:alle|alles) (?:cookies|optionalen \S+) (?:akzeptieren|zulassen|erlauben|zustimmen)\b/gi,
    /\bzustimmen und weiter\b|\bweiter,? ohne zu (?:akzeptieren|zustimmen)\b/gi,
    /\b(?:einwilligung|zustimmung) (?:zu|zur|in die) (?:\S+ )?cookies\b|\bcookie-(?:zustimmung|einwilligung)\b/gi,
    /\btracking-technologien\b/gi,
    DE_SITE_USES_COOKIES,
    // verb before the subject: "Für die Analyse nutzen wir Cookies"
    /\b(?:verwenden|nutzen|benutzen|setzen) wir\b.{0,100}cookies/gi,
    /\bwir\b.{0,100}\bsetzen\b.{0,100}cookies/gi,
    /\bbenutz(?:t|en)\b.{0,100}cookies/gi,
    /\bdurch die (?:weitere )?nutzung (?:unserer|dieser) (?:webseite|website|seite)\b.{0,100}datenschutz/gi,
    /\bakzeptier\w* (?:du |sie )?(?:die )?verwendung (?:\S+ )?cookies\b/gi,
    /\bmit werbetracking weiterlesen\b|\bweiter mit werbung\b|\bcon tracking e annunci\b/gi,
    // in page text, a footer line such as "Diese Website verwendet Cookies. Mehr erfahren" needs a consent control nearby (see heuristic-negatives.ts)
    DE_THIS_SITE_COOKIES,
    /(?:durch die weitere nutzung.{0,100}cookie)|(?:cookie.{0,100}durch die weitere nutzung)/gi,
    /\b(?:analyse|statistik)-?cookies\b/gi,
    /\b(?:marketing|tracking)-?cookies\b/gi,
    /\bcookies oder (?:andere|ähnliche)/gi,
    // "Wenn Sie auf „Alle akzeptieren“ klicken, stimmen Sie …", "Durch Klicken auf „Alle akzeptieren“ gestatten Sie …"
    /\b(?:indem sie auf|wenn sie auf|durch (?:das )?klicken auf)\b.{0,80}?\b(?:stimmen sie|gestatten sie|willigen sie|erklären sie sich)\b/gi,
    /\bbenötigen wir (?:ihre|deine) (?:einwilligung|zustimmung)\b/gi,
    {
      pattern: /\b(?:einwilligung|zustimmung)\b.{0,60}\b(?:jederzeit|widerrufen)\b|\bmit (?:ihrer|deiner) (?:einwilligung|zustimmung)\b/gi,
      input: "popup"
    },
    /\bwelche cookies sie (?:zulassen|akzeptieren)\b/gi,
    /\bcookies?\b.{0,60}\bauf (?:ihrem|deinem) (?:gerät|endgerät)\b/gi,
    /\bin form von cookies\b|\bblockierung bestimmter arten von cookies\b/gi,
    /\b(?:notwendige|essenzielle|funktionale) cookies\b/gi,
    // innerText can put every word on its own line
    /\bwir\s+(?:verwenden|nutzen|setzen)\s+cookies\b/gi,
    /\bzwecken und anbietern\b/gi,
    /\bweiter ohne akzeptanz\b/gi,
    // NL
    GEBRUIK_VAN_COOKIES,
    /(?:we|wij).{0,100}gebruiken.{0,100}cookies.{0,100}om/gi,
    /cookies.{0,100}en.{0,100}vergelijkbare/gi,
    /cookies.{0,100}(?:afwijzen|weigeren|verwerpen)/gi,
    /alleen.{0,100}noodzakelijke?\b/gi,
    /cookies weigeren/gi,
    /weiger.{0,100}cookies/gi,
    /doorgaan zonder (?:te accepteren|akkoord te gaan)/gi,
    /alleen.{0,100}(?:optionele|functionele|functioneel|noodzakelijke|essentiële|standaard).{0,100}cookies/gi,
    /\b(?:op te slaan en\/of te (?:raadplegen|openen|lezen)|opslaan en\/of (?:openen|raadplegen|lezen)|slaan informatie\b.{0,60}\bop en\/of)\b/gi,
    /\bonze partners vragen om (?:jouw|uw|je) toestemming\b/gi,
    /\bwij en onze (?:\d+ )?partners\b/gi,
    /\b(?:gebruiken|gebruikt|plaatsen|plaatst)\b(?: \S+){0,3} cookies\b/gi,
    /\baccepteer alle cookies\b/gi,
    // Dutch words only: "tracking cookies" and "marketing cookies" are also English prose and footer links
    /\b(?:analytische|functionele|essentiële|noodzakelijke) cookies\b/gi,
    /(?:te blijven gebruiken.{0,100}cookie)|(?:cookie.{0,100}te blijven gebruiken)/gi,
    /cookies.{0,100}beste? (?:mogelijke )?(?:ervaring|gebruikerservaring)/gi,
    /\b(?:we|wij) (?:gebruiken|plaatsen)\b.{0,100}cookies/gi,
    /\bgebruiken (?:we|wij) cookies\b/gi,
    /\bplaatsen van\b.{0,50}cookies/gi,
    /\bte blijven gebruiken\b.{0,100}privacy/gi,
    /\bdoor op\b.{0,60}?\bte klikken\b.{0,40}?\bga(?:at)? (?:u|je) akkoord\b/gi,
    /\balle cookies accepteren\b/gi,
    /\btoestemming voor (?:\S+ ){0,3}cookies\b/gi,
    // Spanish (ES)
    /(si|al) contin[úu]a[sr]?( navegando)?.{0,100} cookie/gi,
    /(usamos|utilizar?|utilizamos)( (tanto|las))?.{0,20}cookie/gi,
    /\b(hacemos|hace) uso de cookies\b/gi,
    /\busa cookies de google\b/gi,
    /acepta.{0,80} uso de cookies/gi,
    /al utilizar nuestro sitio web.{0,80}cookie/gi,
    /almacenar la información en un dispositivo y\/?o acceder a ella/gi,
    /cookie.{0,30} utiliza/gi,
    /cookies propias y de/gi,
    /cookies.{0,80}son necesarias/gi,
    /est[ea] (sitio|página|web)( web)?( también)? (usa|utiliza|requiere del uso de|se sirven|emplea) cookies?/gi,
    /navegando.{0,100}cookie/gi,
    /nosotros y nuestros( \d+)? (socios|proveedores).{0,180} cookies/gi,
    /recopilamos y almacenamos datos de usted y de su dispositivo/gi,
    /utilizamos tecnolog[ií]as como las cookies/gi,
    /\b(?:almacenar|almacenamos) y\/o (?:acceder|accedemos)\b/gi,
    /\bnuestros socios solicitan su consentimiento\b/gi,
    /\b(?:tanto nosotros como|nosotros y) nuestros (?:\d+ )?socios\b/gi,
    /\bcontinuar sin aceptar\b|\bsolo las necesarias\b/gi,
    /\bacept\w* (?:\S+ ){0,3}uso de (?:las )?cookies\b/gi,
    /\bcookies (?:técnicas|analíticas|propias|de terceros|opcionales|necesarias)\b/gi,
    /\blas cookies nos (?:ayudan|permiten)\b/gi,
    /\b(?:instalamos|empleamos)\b(?: \S+){0,4} cookies\b/gi,
    /\bacept(?:a|ar|as)? (?:el uso de |las )?(?:\S+ )?cookies\b|\bnecesitamos usar cookies\b/gi,
    /\bal hacer clic en\b.{0,80}?\bcookies\b/gi,
    /\b(?:aceptar|rechazar) todas las cookies\b/gi,
    /\bestrictamente necesarias\b/gi,
    /\balmacenar o acceder a (?:la )?información\b/gi,
    /\btecnolog[ií]as de seguimiento\b/gi,
    // Polish (PL)
    // examples:
    //  wykorzystuje pliki cookie (uses cookies)
    //  Wykorzystujemy informacje w plikach cookie (We use information in cookies)
    /(używamy|stosujemy|stosuje|wykorzystujemy|wykorzyst(uje|ywane))( są)?.{0,20} plik(i|ów|ach) [„"]?cookie/gi,
    /(używać|używamy).{0,80} (ciasteczek|cookie)/gi,
    /cele przetwarzania twoich danych przez zaufanych partnerów iab/gi,
    /dzięki (plikom cookie|ciasteczkom|cookie)/gi,
    /korzysta.{0,80} plików cookie/gi,
    /korzystamy z technologii, takich jak pliki cookie/gi,
    /korzystamy.{0,50} cookies/gi,
    /niektóre pliki cookies/gi,
    /pliki cookies i pokrewne im technologie umożliwiają poprawne działanie strony i pomagają nam dostosować ofertę do twoich potrzeb/gi,
    /przechowywanie informacji na urządzeniu lub dostęp do nich/gi,
    /przechowywanie plików cookie na swoim urządzeniu/gi,
    /przechowywać i uzyskiwać dostęp do informacji na twoich urządzeniach/gi,
    /przetwarzamy.{0,80} cookie/gi,
    /strona.{0,50} używa (ciasteczek|cookie)/gi,
    /ta strona korzysta z ciasteczek/gi,
    /uzyskujemy dostęp i przechowujemy informacje na urządzeniu/gi,
    /używa(?:ją)? plik[ió]w? cookie/gi,
    /używamy plików.{0,20}cookie/gi,
    /wykorzystują .{0,100}cookie/gi,
    /za pomocą plików cookies.{0,100} my lub nasi partnerzy/gi,
    /zgodą my i nasi partnerzy możemy wykorzystywać precyzyjne dane geolokalizacyjne i identyfikację/gi,
    // Catalan (CA)
    /cookies pròpies i de tercers/gi,
    /utilitzem galetes/gi,
    /únicament utilitza galetes pròpies amb finalitat tècnica\b/gi,
    /este lloc web utilitza només cookies tècniques necessàries per al seu funcionament/gi,
    /utilitza cookies tècniques,\s*de personalització i anàlisi/gi,
    /utilitzem cookies i altres tecnologies/gi,
    /\b(?:utilitz\w*|fa servir|fem servir|usem)\b(?: \S+){0,3} (?:cookies|galetes)\b/gi,
    // Basque (EU)
    /cookie propio eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/gi,
    /cookie propioak eta hirugarrenen cookieak erabiltzen ditugu/gi,
    /cookie propioak eta hirugarrenenak helburu teknikoarekin erabiltzen ditu/gi,
    /cookie[-\s]*ak erabiltzen ditu/gi,
    /cookieak erabiltzen ditu/gi,
    /guk eta gure \d+ bazkideek cookieak eta identifikadoreak erabiltzen ditugu/gi,
    /norberaren eta hirugarrenen cookie-?ak baino ez ditu erabiltzen/gi,
    /web orri honek cookieak erabiltzen ditu/gi,
    /webgune honek cookie propioak eta hirugarrenen cookie-fitxategiak erabiltzen ditu/gi,
    // Galician (GL)
    /^\s*empregamos cookies propias\b/gi,
    /este portal emprega cookies propias ou de terceiros con fins analíticos/gi,
    // Russian (RU)
    // e.g. "мы используем файлы cookie", "сайт использует куки", "используются технологии cookie"
    // note: \w does not match Cyrillic, so these use explicit character ranges
    /использу[а-яё]*.{0,40}(?:файл[а-яё]*[\s-]+)?(?:cookie|куки)/gi,
    /(?:cookie|куки).{0,40}использу[а-яё]*/gi,
    /(?:использовани[а-яё]*|обраб(?:отк|атыва)[а-яё]*|хранени[а-яё]*).{0,20}(?:файл(?:ов|ы)[\s-]+)?(?:cookie|куки)/gi,
    /технологи[а-яё]*\s+(?:cookie|куки)/gi,
    // e.g. "сайт собирает cookie", "мы применяем файлы cookie", "сохраняем куки на вашем устройстве"
    /(?:собира[а-яё]*|сбор|применя[а-яё]*|сохраня[а-яё]*|размеща[а-яё]*|устанавлива[а-яё]*).{0,30}(?:файл[а-яё]*[\s-]+)?(?:cookie|куки)/gi,
    // "файлы cookie" / "cookie-файлы" / "куки-файлы" in any phrasing
    /(?:файл[а-яё]*[\s-]+(?:cookie|куки)|(?:cookie|куки)[\s-]+файл[а-яё]*)/gi,
    // cookies described without the word: "файлов, сохраняемых в браузере пользователя"
    /файл[а-яё]*,?\s+(?:сохраня[а-яё]*|хран[а-яё]*)[а-яё\s]{0,30}браузер/gi,
    // e.g. "продолжая работу, ты принимаешь cookie", "вы принимаете куки"
    /продолжая.{0,100}(?:cookie|куки)/gi,
    /принима[а-яё]*\s+(?:cookie|куки)/gi,
    // Italian (IT)
    // e.g. "usiamo i cookie", "utilizziamo cookie tecnici", "questo sito utilizza i cookie", "noi e i nostri partner utilizziamo i cookie"
    /(?:usiamo|utilizziamo).{0,20}cookie/gi,
    /sito.{0,50}(?:usa|utilizza).{0,20}cookie/gi,
    /noi e i nostri.{0,20}partner.{0,100}cookie/gi,
    /\b(?:utilizziamo|usiamo|impieghiamo|installiamo)\b(?: \S+){0,3} cookies?\b/gi,
    /\b(?:utilizza|utilizzano|usa|usano|impiega|installa|fa uso di)\b(?: \S+){0,3} cookies?\b/gi,
    /\bcookies? (?:tecnici|di profilazione|di terze parti|analitici|statistici|di marketing)\b/gi,
    /\b(?:acconsent|accett)\w*\b.{0,40}\b(?:uso|utilizzo|installazione)\b.{0,15}\bcookies?\b/gi,
    /\b(?:continuando|proseguendo)(?: la| nella)? navigazione\b.{0,80}\b(?:accett|acconsent)\w*/gi,
    /\b(?:continua|prosegui|chiudi) senza accettare\b/gi,
    /\brifiuta e abbonati\b/gi,
    /\bconsenso (?:all.(?:uso|utilizzo) (?:dei |di )?)?cookies?\b/gi,
    /\b(?:insieme ai|con i) nostri (?:\d+ )?partner\b/gi,
    /\bterze parti selezionate\b/gi,
    /\b(?:archiviare|archiviamo|memorizzare|memorizziamo) e\/o (?:accedere|accediamo)\b/gi,
    USO_DEI_COOKIE,
    /\butilizz\w*\b.{0,30}cookie/gi,
    /\b(?:questo|il nostro) sito\b.{0,100}cookie/gi,
    /\bcookie\b.{0,30}\btecnologie (?:simili|analoghe)\b/gi,
    /\bcliccando su\b.{0,80}?\bcookie/gi,
    /\b(?:accetta|rifiuta) tutti i cookie/gi,
    // TCF: "noi e i nostri partner archiviamo …", "… potremmo utilizzare dati di localizzazione", not "partner commerciali"
    /\bnoi e i nostri (?:\d+ )?partner (?:archivia\w*|memorizz\w*|potremmo|trattiamo)\b/gi,
    /\bcookies? (?:essenziali|necessari)\b/gi,
    // Swedish (SV)
    // e.g. "vi använder cookies", "vi använder spårningstekniker såsom cookies", "webbplatsen använder kakor"
    /(?:vi|webbplatsen|webbplats|sajten|sidan)\s+använder.{0,60}(?:cookies|kakor)/gi,
    // any subject and inverted order: "Svenska kraftnät använder kakor", "använder vi också cookies", "vill använda cookies",
    // "vi sätter inga egna cookies"
    /\b(?:använd(?:er|a)|sätter|nyttjar) (?:vi |sig av |oss av )?(?:\S+ ){0,3}(?:cookies|kakor)\b/gi,
    // passive: "på webbplatsen används kakor", "kakor används för att …"
    /\banvänds (?:\S+ ){0,2}(?:cookies|kakor)\b|\b(?:cookies|kakor)\b.{0,60}\banvänds\b/gi,
    ANVANDNING_AV_COOKIES,
    /\b(?:godkänn|accepter|tillåt)\S* (?:\S+ ){0,4}(?:cookies|kakor)\b|\b(?:cookies|kakor) (?:som )?du tillåter\b/gi,
    // a button or "… nödvändiga kakor", not "endast nödvändiga resurser"
    /\b(?:endast|bara|enbart) nödvändiga(?: (?:cookies|kakor))?(?![ \t]*[\wåäö])/gi,
    // TCF wording
    /\blagra och\/eller (?:få åtkomst till|komma åt) information\b/gi,
    /\b(?:dess|våra) partners?\b.{0,100}\b(?:cookies|kakor)\b/gi,
    /\btekniker (?:såsom|som) (?:cookies|kakor)\b/gi,
    // Japanese (JA)
    // e.g. "当サイトはCookieを使用しています", "クッキー（Cookie）を利用しています"
    /(?:cookie|クッキー).{0,20}を(?:使用|利用)/gi,
    // e.g. "閲覧履歴を外部サービスに送信"
    /(?:閲覧履歴|端末情報|利用者情報).{0,30}を外部(?:サービス|事業者|に|へ)/gi,
    // Danish (DA)
    // e.g. "vi bruger cookies", "hjemmesiden bruger cookies til at ..."
    /\b(?:bruger|anvender|benytter) cookies\b/gi,
    // Norwegian (NO)
    // e.g. "vi bruker informasjonskapsler", "kan vi bruke valgfrie informasjonskapsler", "nettstedet bruker cookies"
    /\b(?:vi|nettstedet|nettsiden|siden)\s+bruker?\s.{0,60}?(?:informasjonskapsler|cookies)/gi,
    /\bvi benytter(?: \S+)? (?:cookies|informasjonskapsler)\b/gi,
    /\bbruk av (?:cookies|informasjonskapsler)\b/gi,
    // Turkish (TR): the verb comes last, hence the long gap; [ıI]/[iİ] match capitals, where the i flag pairs neither
    // e.g. "çerezler kullanıyoruz", "tanımlama bilgilerini ... için kullanıyoruz"; the verb endings skip "Kullanım Koşulları"
    /(?:çerez|cookie|tan[ıI]mlama b[iİ]lg[iİ])[^.]{0,200}(?:kullan|yararlan|faydalan)(?:[ıI]yor|makta|[ıI]lmakta|[ıI]l[ıI]yor|[ıI]l[ıI]r|[ıI]r)/gi,
    // e.g. "kullandığımız çerezler"
    /kulland[ıI]ğ[ıI]m[ıI]z (?:çerez|cookie|tan[ıI]mlama b[iİ]lg[iİ])/gi,
    // e.g. "Detaylı bilgi için Çerez Politikamızı inceleyebilirsiniz", "çerez aydınlatma metninden ulaşabilirsiniz"
    /çerez (?:pol[iİ]t[iİ]ka|ayd[ıI]nlatma)[^.]{0,40}(?:[iİ]ncele|ula[şŞ]|oku)/gi,
    // Greek (EL); accented vowels are matched with and without tonos, since all-caps Greek drops it
    // e.g. "χρησιμοποιούμε cookies", "η ιστοσελίδα χρησιμοποιεί cookies", "χρησιμοποιεί αρχεία cookie"
    /χρησιμοποι\S{0,6}\s(?:\S+\s){0,3}?(?:cookies?|μπισκ[οό]τα)/gi,
    // e.g. "cookies και άλλες παρόμοιες τεχνολογίες"
    /(?:cookies?|μπισκ[οό]τα).{0,40}παρ[οό]μοιε[σς]\s+τεχνολογ/gi,
    /συγκατ[αά]θεσ[ηή].{0,60}(?:cookies?|μπισκ[οό]τ)/gi,
    /αποδοχ[ηή]\s+[οό]λων/gi,
    /απ[οό]ρριψη\s+[οό]λων/gi
  ];
  var REJECT_PATTERNS_ENGLISH = [
    // e.g. "reject", "reject all", "reject all cookies", "reject cookie", "deny all", "refuse cookies", "decline", "disallow cookies",
    // "reject non-essential cookies", "reject unnecessary cookies", "reject all but necessary", "reject all and close"
    // note that "reject and subscribe" and "reject and pay" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    /^\s*(no,?\s*)?(i\s+)?(reject|deny|refuse|decline|disable|disallow)\s*(all)?\s*(but|except)?\s*(non[- ]?essential|un(necessary|required)|optional|additional|targeting|analytics|marketing|non[- ]?necessary|extra|tracking|advertising|necessary|essential)?\s*(cookies?)?\s*(and\s+close)?\s*$/is,
    // e.g. "i do not accept", "do not accept cookies", "i do not accept the use of cookies", "do not allow cookies", "dont allow"
    /^\s*(no,?\s*)?(i\s+)?(do\s+not|dont)\s+(accept|allow)\s*(the\s+use\s+of\s+)?(any\s+)?(cookies)?\s*$/is,
    // e.g. "continue without accepting", "continue without agreeing", "continue without agreeing →"
    /^\s*(continue|proceed|continue\s+browsing)\s+without\s+(accepting|agreeing|consent|cookies|tracking)(\s*→)?\s*$/is,
    // essential/necessary/functional-only, e.g. "essential cookies only", "accept only essential cookies",
    // "allow necessary cookies continue", "use essential cookies only", "functional only", "essential only cookies", "i confirm necessary",
    // "proceed with necessary cookies only"
    /^\s*(i\s+)?(want\s+to\s+)?(only\s+)?(use|accept|allow|keep|enable|choose|continue\s+with|proceed\s+with|i\s+confirm)\s*(only\s+)?(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s*(cookies)?\s*(continue|only)?\s*$/is,
    /^\s*(i\s+)?(want\s+to\s+)?only\s+(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s*(cookies)?\s*(continue|only)?\s*$/is,
    /^\s*(strictly\s+)?(necessary|essential|essentials|functional|required|minimal)\s+((cookies\s+)?only|only\s+cookies)\s*$/is,
    // e.g. "do not sell or share my personal information", "do not share my personal information", "opt out of sale ..." (CCPA)
    // "do not sell page" is a link; "do not sellcookie settings" is two concatenated buttons
    /do\s+not\s+sell(?!\s*(page|cookie settings))|do\s+not\s+share\s+my\s+(personal\s+)?(information|info|data)|opt\s+out\s+of\s+sale/is,
    // e.g. "opt-out of sale/share or targeted advertising", "opt-out of advertising/social media cookies"
    /^opt[ -]?out of /is,
    // e.g. "reject all except strictly necessary", "reject all (except necessary cookies)"
    /except\s+(strictly\s+)?necessary/is,
    // e.g. "disagree", "i disagree", "disagree and close"
    /^(i\s+)?disagree\s*(and\s+close)?$/i,
    "no",
    /^no,? thank(s| you)$/is,
    // e.g. "no cookies", "no cookies for me, thanks", "rather not", "no, rather not"
    /^no,?\s+cookies(\s+for\s+me)?(,?\s*thank(s| you))?$/is,
    /^(no,?\s+)?rather not$/is,
    /^opt[ -]out$/is,
    "dont enable",
    "i do not agree"
  ];
  var REJECT_PATTERNS_DUTCH = [
    // weigeren / afwijzen / verwerpen (reject verbs, any position)
    /weiger|afwijz|verwerp/is,
    // "wijs (alles/ze) af" (reject verb with split particle)
    /wijs\b.*\baf\b/is,
    // "alleen/enkel/uitsluitend ... (noodzakelijk|functioneel|essentieel|...)"
    /(^|\s)(alleen|enkel|uitsluitend)\s+.{0,20}(noodzakelijk|functione|essenti|vereiste|verplichte|strikt|minimale|basis|basic|standaard)/is,
    // essential/necessary-only nouns
    /^\s*(accepteer\s+|aanvaard\s+|gebruik\s+|sta\s+|ik wil\s+)?(alleen\s+|enkel\s+|uitsluitend\s+|strikt\s+)?(de\s+)?(noodzakelijke?|functionele?|functioneel|essentiële|essentieel|vereiste|verplichte|minimale|basiscookies|basis|standaard)\s*(cookies?)?\s*(accepteren|toestaan|aanvaarden)?\s*$/is,
    // continue without accepting / consent
    /(doorgaan|ga door|ga verder|verder)\s+.{0,15}(zonder|aanvaard)/is,
    // "nee" refusals (but not "nee, sluiten" → acknowledge)
    /^nee(,?\s+(bedankt|dank je|dankje|liever niet|liever geen cookies|geen persoonlijke cookies|geen cookies.*|weigeren?))?$/is,
    "niet accepteren",
    "niet akkoord",
    "ik ga niet akkoord",
    "liever niet",
    "geen cookies toestaan",
    "liever geen cookies",
    "functioneel altijd actief",
    // e.g. "ik accepteer geen cookies", "nee, ik wil geen optimale cookies"
    /^(nee,?\s+)?(ik\s+)?(wil|accepteer|aanvaard)\s+geen\s+(\S+\s+)?cookies$/is
  ];
  var REJECT_PATTERNS_FRENCH = [
    // refuser / rejeter / interdire / décliner (reject verbs, any position)
    // "refuser et s'abonner" / "refuser et payer" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    // skip English prose such as "cookies that you can refuse"
    /^(?!.*\bcan refuse\b)(.*\s)?(refus|rejet|rejeter|interdire|interdis|déclin|declin)/is,
    // only necessary / essential / technical / functional
    /^(?=.*(cookie|nécessaire|essentiel|techni|requis|obligatoire|fonctionnel|indispensable|sdk)).*(uniquement|seulement|indispensable|strictement nécessaire|que les cookies\s+(nécessaires|techniques|essentiels|indispensables|fonctionnels))/is,
    // continue/proceed without accepting; refuse everything; disable purposes
    /(sans accepter|ne pas accepter|je naccepte rien|je désactive)/is,
    // "non" / "non, merci"
    /^non(,?\s+merci\.?)?$/is
  ];
  var REJECT_PATTERNS_GERMAN = [
    // "... ablehnen" / "ablehnen ..." (reject/decline). Exclude the settings-list phrase "einstell(ungen|en) oder ablehnen".
    /^(?!einstell(ungen|en) oder ablehnen$).*ablehnen/is,
    // verweigern / verweigere / verweigert (refuse)
    /verweiger/is,
    // essential/necessary/functional-only variants (accepting only necessary → reject)
    /^\s*(nur|ausschließlich|lediglich|weiter\s+mit|mit|akzeptiere?n?|unbedingt|es\s+werden\s+nur)?\s*(technisch\s+)?(notwendige?[nrs]?|essenzielle?[nrs]?|essentielle?[nrs]?|erforderliche?[nrs]?|funktionale?[nrs]?|funktionelle?[nrs]?|wesentliche?[nrs]?)\s*(cookies?|technologien|funktionscookies|dienste)?\s*(akzeptieren|erlauben|zulassen|verwenden|annehmen|setzen|speichern|zustimmen|auswählen)?\.?\s*$/is,
    // continue with only necessary/functional cookies
    /^(weiter\s+|nur\s+)?mit\s+(nur\s+|ausschließlich\s+|lediglich\s+)?(den\s+)?(technisch\s+)?(notwendigen|essenziellen|essentiellen|erforderlichen|funktionalen|funktionellen)\s+(cookies\s+)?fortfahren\.?$/is,
    // continue without consent
    /(^|\s)(ohne\s+(zu\s+)?(einwilligung|zustimmung|einverständnis|annahme|annehmen|akzeptanz|akzeptieren)|(weiter|fortfahren)\s+ohne)/is,
    // negations / refusals not covered by the regexes above
    "nein, danke",
    "nein, bitte nicht",
    "nein, ich stimme nicht zu",
    "nicht zustimmen",
    "nicht einverstanden",
    "ich lehne ab",
    "mit erforderlichen einstellungen fortfahren"
  ];
  var REJECT_PATTERNS_ITALIAN = [
    // rifiuta / rifiutare / rifiuto / nega / negare / blocca (reject verbs)
    /(^|\s)(rifiut|neg(a|are|hi)|blocca i cookie)/is,
    // accept/use only necessary / essential / technical
    /^\s*(accetta|accettare|usa|installa|consenti|chiudi e prosegui( solo con)?)?\s*(solo|soltanto|unicamente)?\s*(i\s+|gli\s+)?(cookies?\s+)?(strettamente\s+)?(necessari|necessary|essenziali|tecnici|di navigazione)\s*(necessari|tecnici|essenziali)?\s*$/is,
    // continue without accepting
    /continua(re)? senza accettare/is,
    "non accetto"
  ];
  var REJECT_PATTERNS_BRAZILIAN_PORTUGUESE = [
    // (deny)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*$/is,
    // (proceed) (without accepting)
    /^\s*(continuar|prosseguir|seguir)\s*(sem\s*aceitar)\s*$/is,
    // (deny) (everything) (optional)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(tudo|o)?\s*(opcional|(não[-\s](essencial|funcional|obrigatório|necessário)))?\s*$/is,
    // (deny) (all) (the) (optional) (cookies)
    /^\s*(rejeitar|recusar|desativar|bloquear|negar|não\s*aceito|não \s*aceitar)\s*(todos)?\s*(os)?\s*(cookies)?\s*(opcionais|(não[-\s](essenciais|funcionais|obrigatórios|necessários)))?\s*$/is,
    // (accept) (only) (the) (essential)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(o)?\s*(essencial|funcional|obrigatório|necessário)\s*$/is,
    // (accept) (only) (the) (essential) (cookies)
    /^\s*(aceitar|utilizar)?\s*(apenas|somente|só)?\s*(os)?\s*(cookies)?\s*(essenciais|funcionais|obrigatórios|necessários)\s*$/is
  ];
  var REJECT_PATTERNS_SPANISH = [
    // rechazar / denegar / declinar / negar (reject verbs, any position)
    // "rechazar y pagar" / "rechazar y suscribirse" are excluded via BUTTON_NEVER_MATCH_PATTERNS
    /(^|\s)(rechaz|recház|deneg|negar|declin)/is,
    // accept/allow/use (only) necessary / essential / technical / functional / own
    /^\s*(aceptar?|acepta|permitir|permite|usar|utilizar)?\s*(solo|sólo|només|únicamente)?\s*(las?\s+|los\s+)?(cookies?\s+)?(estrictamente\s+)?(necesari\w*|esencial\w*|imprescindibl\w*|técnic\w*|obligatori\w*|funcional\w*|propias)\s*$/is,
    // "solo/sólo/no, sólo ... necessary/essential"
    /^(no,?\s+)?(solo|sólo|només)\s+(usar\s+|las?\s+|los\s+|lo\s+)?.{0,20}(necesari|esencial|estrictamente)/is,
    // refusals / opt-outs
    /^(no acept|no consentir|no permitir|no estoy de acuerdo|no,? gracias|sin consentimiento|continuar sin aceptar|prefiero rechazarlas|descartar todas)/is,
    "acceptar nom\xE9s les necess\xE0ries",
    "nom\xE9s sutilitzen cookies quan \xE9s necessari",
    "pulsa aqu\xED para desactivar las cookies opcionales"
  ];
  var REJECT_PATTERNS_SWEDISH = [
    // avvisa / avböj / neka / förneka (reject verbs)
    /(^|\s)(avvisa|avböj|neka|nekar|förneka)/is,
    // (allow/accept/use) only necessary cookies/kakor
    /(bara|endast|enbart)\s+nödvändig/is,
    // "godkänn/acceptera/använd/tillåt (bara/endast/enbart) nödvändiga (cookies/kakor)"
    /^(ok,?\s+|nej,?\s+)?(jag\s+)?(godkänn\w*|godta|acceptera\w*|använd\w*|tillåt|spara)?\s*(bara|endast|enbart)?\s*(strikt\s+)?nödvändiga?t?( (cookies|kakor|tjänster))?\.?$/is,
    // continue without accepting
    /fortsätt utan att (acceptera|godkänna)/is,
    /strikt nödvändig/is,
    "till\xE5t inte cookies",
    "jag accepterar endast grundl\xE4ggande kakor"
  ];
  var REJECT_PATTERNS_DANISH = [
    // afvis / afvis alle / afvis alle cookies (reject verbs)
    /(^|\s)afvis/is,
    // (accept/allow) only necessary cookies
    /^(accepter\s+|tillad\s+)?(kun|udelukkende)\s+(strengt\s+)?nødvendige( cookies)?$/is,
    // "nej tak" (no thanks), e.g. "du kan sige nej tak til statistik"
    /^nej(,?\s+tak)?$/is,
    /^(du kan )?(sige )?nej,? tak til \S+$/is
  ];
  var REJECT_PATTERNS_NORWEGIAN = [
    // avvis / avslå (reject verbs), not the status "avslått" (rejected)
    /(^|\s)(avvis|avslå)(\s|$)/is,
    // (accept/allow/use) only necessary cookies
    /^(godta\s+|tillat\s+|aksepter\s+|bruk\s+)?(kun|bare)\s+(strengt\s+)?nødvendige( (informasjonskapsler|cookies))?$/is,
    // "nei" / "nei takk" (no thanks)
    /^nei(,?\s+takk)?$/is
  ];
  var REJECT_PATTERNS_GREEK = [
    // απόρριψη / απορρίπτω / απόρριψε (reject); not "απόρρητο" (privacy)
    /(^|\s)απ[οό]ρρ[ιί](ψ|πτ)/is,
    /^[αά]ρνηση/is,
    // (accept) only necessary / mandatory / functional, e.g. "αποδοχή υποχρεωτικών", "μόνο τα απαραίτητα cookies"
    /^(αποδοχ[ηή]\s+|αποδ[εέ]χομαι\s+|επιτρ[εέ]ψτε\s+)?(μ[οό]νο\s+)?(των\s+|τα\s+)?(απαρα[ιί]τητ\S*|υποχρεωτικ\S*|αναγκα[ιί]\S*|λειτουργικ\S*|τεχνικ\S*)(\s+(cookies?|μπισκ[οό]τα))?$/is,
    // continue without accepting / consent
    /^συν[εέ]χεια\s+χωρ[ιί][σς]\s+(αποδοχ|συγκατ[αά]θεση)/is,
    // refusals: "δεν αποδέχομαι", "δε συμφωνώ", "όχι, ευχαριστώ"
    /^δεν?\s+(αποδ[εέ]χομαι|συμφων[ωώ]|συναιν[ωώ])/is,
    /^[οό]χι(,?\s+ευχαριστ[ωώ])?$/is
  ];
  var REJECT_PATTERNS_CATALAN = [
    /(^|\s)rebutj/is,
    "no accepto",
    "no, gr\xE0cies",
    // accept/allow/use (only) necessary / essential / technical / functional
    /^\s*(acceptar?|accepto|permetre|utilitzar|usar)?\s*(només|sols|únicament)?\s*(les\s+|els\s+)?(galetes\s+|cookies?\s+)?(estrictament\s+)?(necess[aà]ri\w*|essencial\w*|tècni\w*|funcional\w*|imprescindibles)\s*$/is,
    // continue without accepting
    /^continuar sense acceptar/is
  ];
  var REJECT_PATTERNS_GALICIAN = [/(^|\s)rexeitar/is];
  var REJECT_PATTERNS_BASQUE = [/(^|\s)(baztertu|ukatu)/is];
  var REJECT_PATTERNS_PORTUGUESE = [/^aceitar apenas cookies essenciais\.$/];
  var REJECT_PATTERNS_CZECH = ["povolit pouze nezbytn\xE9 cookie"];
  var REJECT_PATTERNS_POLISH = [
    // odrzuć / odrzucam / odmawiam / rezygnuję / blokuj wszystkie (reject verbs)
    /odrzu(ć|cam|cenie|cać|canie|cić)|odmaw|odmowa|odmów|rezygnuj|blokuj wszystk/is,
    // (accept) only necessary / required
    /(^|\s)tylko\s+(bezwzględnie\s+)?(niezbędn\w*|wymagan\w*|konieczne)/is,
    /(akceptuj|akceptuję|zaakceptuj|zatwierdź|potwierdzam|zezwól)\s+(tylko\s+)?(na\s+)?(niezbędn\w*|wymagan\w*|konieczne)/is,
    /korzystaj wyłącznie z niezbędn/is,
    // continue without accepting / consent
    /kontynuuj bez (akceptacj|akceptowani|wyrażania zgody)/is,
    // refusals
    /nie (akceptuję|zgadzam|wyrażam zgody|wyrażaj zgody|zezwalaj|potwierdzam)/is,
    /^nie(,?\s+(dziękuję|nie zgadzam.*))?$/is,
    "niezb\u0119dne",
    "niezb\u0119dne pliki cookie",
    /^funkcjonalne pliki cookie \(wymagane\)$/
  ];
  var REJECT_PATTERNS_RUSSIAN = [
    // отклонить / отказаться / запретить (reject verbs); \w does not match Cyrillic
    /(^|\s)(отклон[а-яё]*|отказ[а-яё]*|откаж[а-яё]*|запрет[а-яё]*|запрещ[а-яё]*)/is,
    // "только необходимые (файлы cookie)" / "принять только необходимые куки"
    /^\s*(принять\s+|принима[а-яё]+\s+|разрешить\s+|использовать\s+|оставить\s+)?(только|лишь)\s+(строго\s+)?(необходим[а-яё]+|нужн[а-яё]+|обязательн[а-яё]+|техническ[а-яё]+|функциональн[а-яё]+)(\s+файл[а-яё]*)?([\s-]+(cookie|куки)([\s-]+файл[а-яё]*)?)?\s*$/is,
    // refusals: "не принимаю", "не согласен", "не соглашаюсь", "нет, спасибо"
    /^\s*(не\s+(принима[а-яё]+|соглас[а-яё]+|разреша[а-яё]+|хочу)|нет(,?\s+спасибо)?)\s*$/is
  ];
  var REJECT_PATTERNS_TURKISH = [
    // e.g. "tümünü reddet", "isteğe bağlı çerezleri reddet"; [ıi] because text in capitals lowercases I to i
    /^((tümünü|hepsini|tüm çerezleri|çerezleri|isteğe bağl[ıi] çerezleri|zorunlu olmayan çerezleri) )?reddet( ve kapat)?$/,
    "reddediyorum",
    "kabul etmiyorum"
  ];
  var REJECT_PATTERNS_INDONESIAN = ["tolak cookie"];
  var REJECT_PATTERNS_JAPANESE = [
    // e.g. "拒否", "すべて拒否", "全て拒否する", "cookieを拒否"
    /^(すべて|全て)?\s?(の)?(cookie|クッキー)?\s?(を)?拒否(する)?$/i,
    "\u540C\u610F\u3057\u306A\u3044",
    "\u540C\u610F\u3057\u307E\u305B\u3093"
  ];
  var REJECT_PATTERNS = [
    ...REJECT_PATTERNS_ENGLISH,
    ...REJECT_PATTERNS_DUTCH,
    ...REJECT_PATTERNS_FRENCH,
    ...REJECT_PATTERNS_GERMAN,
    ...REJECT_PATTERNS_ITALIAN,
    ...REJECT_PATTERNS_BRAZILIAN_PORTUGUESE,
    ...REJECT_PATTERNS_SPANISH,
    ...REJECT_PATTERNS_SWEDISH,
    ...REJECT_PATTERNS_DANISH,
    ...REJECT_PATTERNS_NORWEGIAN,
    ...REJECT_PATTERNS_GREEK,
    ...REJECT_PATTERNS_CATALAN,
    ...REJECT_PATTERNS_GALICIAN,
    ...REJECT_PATTERNS_BASQUE,
    ...REJECT_PATTERNS_PORTUGUESE,
    ...REJECT_PATTERNS_CZECH,
    ...REJECT_PATTERNS_POLISH,
    ...REJECT_PATTERNS_RUSSIAN,
    ...REJECT_PATTERNS_TURKISH,
    ...REJECT_PATTERNS_INDONESIAN,
    ...REJECT_PATTERNS_JAPANESE
  ];
  var BUTTON_NEVER_MATCH_PATTERNS = [
    // text of several concatenated buttons, or popup body text rather than a button
    /accept all.*reject all|reject all.*accept all/is,
    /^.{300,}$/s,
    /pay|subscribe/is,
    /abonneer/is,
    /abonnier/is,
    /abonner/is,
    /abbonati/is,
    /iscriviti/is,
    /abbonare/is,
    /iscrivere/is,
    /sostienici/is,
    /suscribir/is,
    // Spanish (ES)
    /^abandonar este sitio$/,
    /suscribo/,
    /^accede gratis con cookies publicitarias$/,
    /pagar/,
    /suscríbete/,
    /sin cookies .{0,10}euro/s,
    // Polish (PL)
    /subskrybuj|subskrypcj/,
    // Russian (RU): paywall/subscription wording, e.g. "отказаться от подписки", "оплатить"
    /подписатьс|подписк|оплатит|оплачива/is
  ];
  var SETTINGS_PATTERNS = [
    // Multilingual "open customization" patterns: a customization verb next to a
    // cookie/preference/settings/options/details/purposes noun (both word orders).
    // The negative lookahead avoids policy links and save/confirm/accept phrases (those are accept/acknowledge/other).
    /^(?!.*\b(policy|policies|notice|statement|impressum|\w*richtlinie\w*|\w*erklärung|page|beschrijving|privacy$|beleid|politique|política|polityk|speichern|guardar|opslaan|zapisz|enregistrer|sauvegarder|bevestig|bestätig|confirm|save|submit|akzeptier|accept|zaakcept)\b)(customi[sz]e|manage|adjust|configure|personali[sz]e|let me choose|edit|change|set|select|view|see|review|update|open|show|choose|anpassen|verwalten|konfigurieren|bearbeiten|öffnen|anzeigen|einblenden|einstellen|festlegen|auswählen|wählen|aanpassen|beheren|instellen|wijzig\w*|personaliseren|personaliseer|kies|bekijk|toon|personnaliser|paramétrer|gérer|configurer|choisir|afficher|définir|modifier|configurar|personalizar|gestionar|administrar|ajustar|seleccionar|modificar|establecer|dostosuj|zarządzaj|personalizuj|ustaw\w*|zmień|pokaż|wybierz)(?!\w).{0,20}(cookies?|preferences?|settings?|options?|choices?|controls?|details?|purposes?|services?|consent|einstellung\w*|optionen|präferenzen|einzelheiten|zwecke|dienste|datenschutz\w*|auswahl|voorkeur\w*|instelling\w*|opties|diensten|préférences|paramètres|réglages|choix|détails|finalités|témoins|preferencia\w*|opciones|ajustes|configuraci\w*|detalles|servicios|elección|preferencj\w*|ustawie\w*|opcje|szczegół\w*|cele|galetes)\b/is,
    /^(?!.*\b(policy|policies|notice|statement|impressum|\w*richtlinie\w*|\w*erklärung|page|beschrijving|privacy$|beleid|politique|política|polityk|speichern|guardar|opslaan|zapisz|enregistrer|sauvegarder|bevestig|bestätig|confirm|save|submit|akzeptier|accept|zaakcept)\b)(cookies?|preferences?|settings?|options?|choices?|controls?|details?|purposes?|services?|consent|einstellung\w*|optionen|präferenzen|einzelheiten|zwecke|dienste|datenschutz\w*|auswahl|voorkeur\w*|instelling\w*|opties|diensten|préférences|paramètres|réglages|choix|détails|finalités|témoins|preferencia\w*|opciones|ajustes|configuraci\w*|detalles|servicios|elección|preferencj\w*|ustawie\w*|opcje|szczegół\w*|cele|galetes)\b(.{0,14}\W)?(customi[sz]e|manage|adjust|configure|personali[sz]e|let me choose|edit|change|set|select|view|see|review|update|open|show|choose|anpassen|verwalten|konfigurieren|bearbeiten|öffnen|anzeigen|einblenden|einstellen|festlegen|auswählen|wählen|aanpassen|beheren|instellen|wijzig\w*|personaliseren|personaliseer|kies|bekijk|toon|personnaliser|paramétrer|gérer|configurer|choisir|afficher|définir|modifier|configurar|personalizar|gestionar|administrar|ajustar|seleccionar|modificar|establecer|dostosuj|zarządzaj|personalizuj|ustaw\w*|zmień|pokaż|wybierz)(?!\w)/is,
    // settings noun + cookies, e.g. "paramètres des cookies", "ajustes de cookies", "instellingen voor cookies en diensten"
    /^(paramètres|préférences|réglages|ajustes|opciones|elección|preferencias|instellingen)( (de|des|les|voor|van))? cookies( (et des|en|y) (services|diensten|servicios))?$/is,
    "settings",
    "preferences",
    /customi(s|z)e/is,
    "more options",
    /^(?!.*\b(polic(y|ies)|notice|statement|privacy page)\b).*(manage|configure) (my|your) (preferences|choices|cookies)/is,
    /(cookie )?preference center/is,
    "configure",
    "cookie manager",
    "cookie preference",
    "let me choose",
    "cookieconsent preferences",
    /privacy choices/is,
    /^(privacy|cookie|custom) settings$/is,
    /^cookies? (settings|preferences|setting)(?!.*\bdo not\b)/is,
    /^(?!.*\b(polic(y|ies)|notice|statement|privacy page)\b).*(manage|customize|customise|opt-out|edit).*(cookies|preferences|settings|options)/is,
    "cookie consent options",
    "privacy controls",
    // German
    "einstellungen",
    // Spanish (ES)
    /^(configurar|configuración|administrar)$/,
    /^(gestionar|ver|establecer) preferencias$/,
    "ajustes",
    "centro de preferencias",
    "configura",
    /^configuración( de( las)?)? cookies?( y servicios)?$/,
    /^configurar\.\.\.$/,
    "configurarlas",
    "detalles",
    "gestiona tus preferencias",
    /^gestionar ?(las?|mis)? ?(configuración|preferencias)?(( de)? cookies?)?$/,
    "gesti\xF3n cookies",
    "gesti\xF3n de cookies",
    "mis preferencias",
    "mostrar detalles",
    "mostrar los prop\xF3sitos",
    "m\xE1s opciones",
    "no, ajustar",
    "obtener m\xE1s informaci\xF3n y configuraci\xF3n",
    "opciones de gesti\xF3n",
    "panel de configuraci\xF3n de cookies",
    "personalice",
    "personalizar",
    "preferencias de privacidad",
    "preferencias",
    "quiero configurarlas",
    "saber m\xE1s y personalizar",
    "seleccionar fines individuales",
    // Catalan (CA)
    "configura-les",
    "personalitza",
    "veure prefer\xE8ncies",
    /^(configuració|personalitzar|preferències|més opcions)$/,
    /^(configuració|preferències|opcions)( de( les)?)? (galetes|cookies?)$/is,
    /^(gestiona|gestionar|configura|configurar|personalitza|personalitzar|veure|establir|administrar)( les)?( meves)? (preferències|galetes|cookies?|opcions)$/is,
    // Galician (GL)
    "xestionar preferencias",
    // Basque (EU)
    /^(konfigurazioa|konfiguratu)$/,
    // Portuguese (PT)
    "gerenciar cookies",
    // French (FR)
    "param\xE9trage des cookies",
    "param\xE9trer",
    "personnaliser",
    "param\xE8tres",
    "pr\xE9f\xE9rences",
    "r\xE9glages",
    "d\xE9tails",
    "gestion des cookies",
    /^gérer (les |mes )?cookies$/,
    "je choisis",
    "voir les pr\xE9f\xE9rences",
    // German (DE)
    "abschnitt einzelheiten",
    "cookie-details",
    /^datenschutz-?einstellungen$/,
    "cookie-einstellungen",
    /^einstell(ungen|en) oder ablehnen$/,
    "ausw\xE4hlen",
    /^einstellungen (anpassen|ansehen|verwalten|ändern)$/,
    "erweiterte einstellungen",
    "individuelle datenschutz-pr\xE4ferenzen",
    "individuelle datenschutzeinstellungen",
    "konfigurieren",
    "mehr optionen",
    "pr\xE4ferenzen",
    "individuelle einstellungen",
    "privatsph\xE4re einstellungen",
    // Dutch (NL)
    /^(aan|an)passen$/,
    /^cookie[- ]instellingen$/,
    "cookiestatement instellingen",
    /^details (tonen|weergeven)$/,
    "instellingen",
    "meer opties",
    "zelf instellen",
    // Czech (CS)
    "podrobn\xE9 nastaven\xED",
    // Polish (PL)
    // examples:
    //  dostosuj pliki cookie (adjust cookies)
    //  zarządzaj plikami cookie (manage cookies)
    /^(dostosuj|s?personalizuj|chcę dostosować|zarządzaj) ?(moje|moimi)? ?(ustawieniami|preferencjami)? ?(zgody|wybory|(plik(i|ami|ów))? cookies?)?$/,
    /^(preferencje|zarządzaj preferencjami)$/,
    /^(ustawienia|zmień ustawienia|zmiana ustawień|zarządzaj opcjami)$/,
    "centrum preferencji",
    /^chcę dokonać ustawień cookies\.$/,
    "dostosuj wyb\xF3r",
    "edytuj ustawienia",
    "konfiguracja zg\xF3d",
    "otw\xF3rz ustawienia",
    "personalizacja",
    "poka\u017C cele",
    "poka\u017C szczeg\xF3\u0142y",
    "szczeg\xF3\u0142y",
    "pozw\xF3l mi wybra\u0107",
    /^przejdź do ustawień plików cookies\.$/,
    "przejd\u017A do ustawie\u0144 prywatno\u015Bci",
    "przejd\u017A do ustawie\u0144",
    "skonfiguruj",
    "ustaw swoje wybory",
    "ustawienia ciasteczek",
    "ustawienia prywatno\u015Bci",
    "ustawienia zaawansowane",
    "ustawienia zgody",
    /^ustawienia(ch)?( plików)? cookies?$/,
    "ustawieniach",
    "ustawie\u0144 zaawansowanych",
    "wi\u0119cej opcji",
    "wi\u0119cej ustawie\u0144",
    /^wybierz, jakie pliki cookies chcesz zaakceptować\.$/,
    "zaawansowane",
    "zarz\u0105dzaj zgodami dotycz\u0105cymi plik\xF3w cookies",
    "zarz\u0105dzaj zgodami",
    "zarz\u0105dzania zgodami",
    "zarz\u0105dzanie opcjami",
    "zarz\u0105dzanie preferencjami",
    "zarz\u0105dzanie ustawieniami plik\xF3w cookie",
    "zmieniam ustawienia",
    "zmieniam zgody",
    "zmie\u0144 swoje preferencje",
    /^zmień ustawienia( plików)? cookies?$/,
    "zmie\u0144 zgody",
    "zobacz preferencje",
    // Russian (RU)
    // e.g. "настроить", "настройки куки", "параметры конфиденциальности"; \w does not match Cyrillic
    /^\s*((мои|моими|свои|своими)\s+)?(настро[а-яё]+|парамет[а-яё]+|предпочтени[а-яё]+)([\s-]+(мои|моими|свои|своими|файл[а-яё]*|cookie|куки[а-яё]*|конфиденциальност[а-яё]*|согласи[а-яё]*|приватност[а-яё]*))*\s*$/is,
    // e.g. "управление файлами cookie", "изменить настройки", "выбрать категории"
    // "подробн" is deliberately excluded: it would also match the "подробнее о cookie" policy link
    /^\s*(управл[а-яё]+|измен[а-яё]+|выбрать|персонализ[а-яё]+|расширенн[а-яё]+|индивидуальн[а-яё]+)[\s-]+.{0,20}(настройк[а-яё]*|парамет[а-яё]*|предпочтени[а-яё]*|категори[а-яё]*|файл[а-яё]*|cookie|куки[а-яё]*|согласи[а-яё]*|конфиденциальност[а-яё]*)\s*$/is,
    "\u043F\u043E\u0434\u0440\u043E\u0431\u043D\u044B\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    // Turkish (TR)
    // e.g. "çerez ayarları", "seçenekler", "tercihleri yönet", "çerez tercihlerini yapılandır", "kişiselleştir"
    /^((çerez|tan[ıi]mlama bilgisi) )?(ayarlar[ıi]?|tercihler[ıi]?|seçenekler)$/,
    /^(çerezleri|çerez ayarlar[ıi]n[ıi]|çerez tercihlerini|ayarlar[ıi]|tercihleri) (yönet|düzenle|özelleştir|yap[ıi]land[ıi]r)([ıi]n)?$/,
    /^kişiselleştir(in)?$/,
    // Italian (IT)
    "personalizza cookie",
    // Greek (EL), e.g. "ρυθμίσεις", "πληροφορίες και ρυθμίσεις", "διαχείριση cookies", "περισσότερες επιλογές"
    /^(πληροφορ[ιί]ε[σς]\s+και\s+)?(ρυθμ[ιί]σει[σς]|προτιμ[ηή]σει[σς]|προσαρμογ[ηή]|διαχε[ιί]ριση|επιλογ[εέ][σς]|περισσ[οό]τερε[σς]\s+επιλογ[εέ][σς])(\s+(των\s+|για\s+)?(cookies?|μπισκ[οό]των|επιλογ[ωώ]ν|προτιμ[ηή]σεων|συγκατ[αά]θεσης))?$/is,
    // English (EN)
    "advanced settings",
    "consent settings",
    /^details (anzeigen|zeigen|section)$/,
    "no, adjust",
    "personalize",
    "plus doptions",
    "privacy manager"
  ];
  var ACCEPT_PATTERNS = [
    // EN accept/agree/allow/consent/enable (+ all/cookies/selection/continue/close/proceed...).
    // The negative lookahead avoids essential-only/reject wording (those are reject).
    /^(?!.*\b(essential|necessary|required|functional|minimal|reject|deny|refuse|decline|only|dismiss)\b)(?!.*all cookies continue)(yes,?\s+)?(i\s+)?(accept|agree|allow|consent|enable)(\s+(to\s+)?(all( cookies)?|cookies|selection|selected( cookies)?|everything|recommended( cookies| settings)?|optional( cookies)?|additional cookies|analytics cookies))?(\s+(and\s+)?(continue|close|proceed|save))?\s*$/is,
    /^continue (and accept|using cookies|with (all|recommended cookies|cookies))$/is,
    // DE accept verbs
    /^(alle[sn]?\s+|allem\s+|ich\s+|cookies\s+|ausgewählte\s+|webanalyse\s+)?(cookies?\s+)?(akzeptieren|annehmen|zustimmen|zulassen|erlauben|einwilligen|aktivieren|auswählen)(\s+(und\s+)?(weiter|schlie(ß|ss)en))?\s*$/is,
    /^((meine\s+)?auswahl|alle)\s+(bestätigen|akzeptieren|auswählen)$/is,
    /^(alle[nm]?\s+)?(zustimmen|einverstanden|einwilligung|zustimmung)$/is,
    /^ich (bin einverstanden|akzeptiere( alle)?|stimme zu)$/is,
    // NL accept verbs
    /^(ja,?\s+)?(alle[s]?\s+|ik\s+)?(cookies?\s+)?(accepteer|accepteren|toestaan|aanvaard|aanvaarden|ga akkoord|akkoord)(\s+((en\s+)?sluiten|en\s+(doorgaan|verdergaan)|cookies|alle))?\s*$/is,
    /^(selectie (accepteren|toestaan)|accepteer (selectie|alle)|alle (toestaan|accepteren|aanvaarden)|ja, (dat is prima|prima|alles toestaan|accepteren|ik accepteer cookies|ik ga akkoord)|is goed)$/is,
    // FR accept verbs
    /^(oui,?\s+)?(je\s+)?(tout\s+)?(accepter|jaccepte|autoriser)(\s+(tout|tous les (cookies|témoins)|les (cookies|témoins)|la sélection|et (continuer|fermer|poursuivre)))?\s*$/is,
    /^(oui, (jaccepte|je suis daccord)|jaccepte (les cookies|lutilisation de cookies)|accepter (continuer|et poursuivre)|continuer et accepter|fermer et accepter)$/is,
    // ES/CA accept verbs
    /^(sí,?\s+|si,?\s+)?(aceptar|acepta|permitir|permitirlas|consentir|estoy de acuerdo|de acuerdo|estic dacord)(\s+(todo|todas( las cookies)?|cookies|la selección|selección|y (cerrar|continuar|seguir( leyendo)?|leer gratis)))?\s*$/is,
    // save / submit selection / preferences (accept semantics; acknowledge catches "guardar configuración/selección" first)
    /^(save|store|submit|guardar|sauvegarder|zapisz|opslaan|bewaar)\b.{0,25}(preference|setting|selection|choice|mes choix|cookie|voorkeur|keuze|ustawien|zgod)/is,
    /^((meine\s+)?auswahl|einstellungen|einwilligung|voorkeuren|instellingen|selectie|keuzes)\s+(speichern|opslaan)$/is,
    /i (accept|allow)( all)?/is,
    "yes",
    /accept all above/is,
    "close and accept",
    /(^|\s)accept all$/is,
    "im ok with that",
    // Spanish (ES)
    /^acept(ar|o)( cookies)?$/,
    /^acept(o|ar) todas las cookies$/,
    "aceptar cookies opcionales",
    "aceptar gratis",
    "aceptar las cookies",
    "aceptar todas cookies",
    "aceptar todas y cerrar",
    "aceptar todas y continuar",
    "aceptar todo y cerrar",
    /^aceptar y (continuar|seguir|navegar)( gratis)?$/,
    "aceptar y seguir navegando",
    "aceptarlas todas",
    "guardar preferencias",
    "ok, las acepto",
    /^s[íi], acepto todas las cookies$/,
    /^s[íi], acepto$/,
    /^s[íi], estoy de acuerdo$/,
    "x aceptar y cerrar",
    // Catalan (CA)
    /^accept(ar|o)( cookies)?$/,
    "accepta",
    "accepta totes les cookies",
    "accepta-ho tot",
    // FR/CA "d'accord" / "d'acord"
    /^dac?cord( fermer)?$/is,
    "accepta-les totes",
    "acceptar galetes",
    "acceptar i tancar",
    "acceptar tot",
    "acepta-les totes",
    "permet-les totes",
    "permetre totes les cookies",
    "permetre la selecci\xF3",
    // Basque (EU)
    /^denak? onartu$/,
    /^onartu \(cookie\)$/,
    "onartu cookieak",
    "onartu",
    // Portuguese (PT)
    "aceitar cookies",
    "aceitar",
    "de acordo",
    // French (FR)
    /^accepter (tout|tous les cookies|fermer)$/,
    // German (DE)
    /^(alles akzeptieren|alle zulassen|auswahl erlauben|cookies zulassen|einverstanden|einwilligung|zustimmen|zustimmung)$/,
    // Dutch (NL)
    /^(accepteer (alles|alle cookies)|alles (accepteren|toestaan)|alle cookies (accepteren|toestaan))$/,
    // Czech (CS)
    "souhlas\xEDm",
    // Polish (PL)
    // examples:
    //  akceptuj cookies (Accept cookies)
    //  akceptuj wszystkie pliki cookie (Accept all cookies)
    /^(zaakceptuj|akceptuj[eę]|akceptuj) ?(wszystkie|wszystko)?( pliki)? ?(zgody|ciasteczka|cookies?)?$/,
    "akceptowanie plik\xF3w cookie",
    "akceptuj wybrane",
    "akceptuj i zamknij",
    "akceptuj wszystkie i przejd\u017A do serwisu",
    "akceptuj\u0119 i przechodz\u0119 do serwisu",
    "akceptuj\u0119 polityk\u0119 plik\xF3w cookies i przechodz\u0119 do strony",
    "akceptuj\u0119 ustawienia cookies",
    "akceptuj\u0119 wszystkie i korzystam z us\u0142ug",
    "akceptuj\u0119!",
    "ok, zgadzam si\u0119",
    "potwierdzam wszystkie",
    "tak",
    "tak, zgadzam si\u0119 na wszystkie pliki cookie",
    "tak, zgadzam si\u0119",
    "wyra\u017A zgod\u0119 na wszystko",
    "wyra\u017Cam zgod\u0119 na wszystkie",
    "wyra\u017Cam zgod\u0119",
    "w\u0142\u0105cz wszystkie ciasteczka",
    "zaakceptuj i kontynuuj",
    "zaakceptuj i zamknij",
    "zaakceptuj wszystkie i przejd\u017A do serwisu",
    "zaakceptuj wszystkie zgody i wejd\u017A do serwisu",
    "zaakceptuj wszystkie zgody i zapisz",
    "zatwierd\u017A",
    "zezwolenie na wszystkie",
    "zezw\xF3l na wszystkie ciasteczka",
    "zezw\xF3l na wszystkie cookies",
    "zezw\xF3l na wszystkie pliki cookies",
    "zezw\xF3l na wszystkie",
    "zezw\xF3l na wyb\xF3r",
    "zezw\xF3l",
    "zgadzam si\u0119 na wszystkie",
    "zgadzam si\u0119",
    "zgoda na wszystkie",
    "zgoda",
    "zaakceptuj wybrane",
    "zezw\xF3l na wybrane",
    "zgoda na wybrane",
    // Russian (RU)
    // e.g. "принять всё", "принять все файлы cookie", "разрешить куки", "я согласен"
    // confirm/save wording (подтвердить, сохранить) is acknowledge, not accept
    /^\s*(да,?\s+)?(я\s+)?(принять|принима[а-яё]+|соглас[а-яё]+|разрешить|разреша[а-яё]+)(\s+(вс[её]|(все\s+)?(файлы[\s-]+)?(cookie|куки)([\s-]+файл[а-яё]*)?|выбранные|выбор))?\s*$/is,
    "\u043F\u0440\u0438\u043D\u044F\u0442\u044C",
    // Turkish (TR)
    "kabul et",
    // Greek (EL), e.g. "αποδοχή", "αποδοχή όλων", "αποδέχομαι όλα τα cookies", "να επιτρέπονται όλα", "επιτρέπεται η επιλογή"
    /^(ναι,?\s+)?(αποδοχ[ηή]|αποδ[εέ]χομαι|αποδεχτε[ιί]τε|συμφων[ωώ]|συναιν[ωώ]|επιτρ[εέ]ψτε|(να\s+)?επιτρ[εέ]π(ονται|εται))(\s+(τα\s+|η\s+)?([οό]λ(α|ων)|επιλεγμ[εέ]ν(α|ων)|επιλογ[ηή]))?(\s+(τα\s+|των\s+)?(cookies?|μπισκ[οό]τ(α|ων)))?(\s+(και|&)\s+(κλε[ιί]σιμο|συν[εέ]χεια))?$/is,
    // Italian (IT)
    "accetta",
    "accetta tutti i cookie",
    "accetto tutti i cookie"
  ];
  var ACKNOWLEDGE_PATTERNS = [
    // close / dismiss the banner/dialog/message (multilingual). The negative lookahead avoids
    // accept/save phrases (e.g. "agree and close", "akkoord en sluiten", "speichern schließen").
    /^(?!.*\b(accept\w*|accepter|accepteer|accepteren|agree|allow|akkoord|aanvaard\w*|zustimm\w*|annehm\w*|akzeptier\w*|aceptar|acepta|permit\w*|consent\w*|einverstanden|zezw\w*|zgadzam|zgoda|guardar|opslaan|enregistrer|speicher\w*|zapisz)\b)(x\s+|nee,?\s+)?(close|dismiss|schlie(ß|ss)en|sluiten|afsluiten|fermer|cerrar|tanca|beenden|masquer|zamknij|ukryj)( (this|the|ce|le|el|de|des|het|la|een)?\s*(banner|bandeau|banier|bar|dialog|dialogue|disclaimer|window|okno|melding|message|notification|informa\w*|notificaci\w*|cookie\w*|bannière|rgpd|gdpr|hier|des cookies|de cookies|x))*\.?\s*$/is,
    // "ok" / "okay" / "oké" (optionally followed by a short acknowledgement)
    /^(ok|okay|oké|okey|k)([ .!,]*)(got it|verstanden|compris|rozumiem|thanks|gracias|ik begrijp( dat| het)?|continue to website|pour moi|fermer)?[ .!]*$/is,
    // "understood" / "got it" / "that's ok" (multilingual)
    /^(i understand|understood|got it|thats (ok|fine|okay)|alright|alles klar|in ordnung|verstanden|ich verstehe|ho capito|jag förstår|begrepen|jai compris|je comprends|compris|ik begrijp het|ik snap het|entendido|c(e)?st ok pour moi)[ !.,]*(merci|bedankt|dismiss this banner)?[ !.]*$/is,
    // confirm
    /^(confirm|bestätigen|bevestigen|confirmar|potwierdź)[ !.]*$/is,
    // neutral "continue" without accept/reject wording
    /^(continuer|poursuivre|doorgaan|ga verder)$/is,
    // e.g. "continue browsing", "continue to browse the site"
    /^continue (to )?brows(e|ing)( (the|our) (site|website))?$/is,
    // German "hide", e.g. "ausblenden", "hinweis ausblenden", "ok. ausblenden."
    /^(ok[ .!,]*)?(hinweis )?ausblenden[ .!]*$/is,
    "continue",
    "x",
    /^got it!?$/,
    "acknowledge",
    // notice-only banner with no choice
    "i agree, dismiss this banner",
    /^close (banner|cookie notification)$/is,
    /understood$/is,
    "confirm my choices",
    // German (DE)
    "speichern schlie\xDFen",
    // Spanish (ES)
    /^.?( lo)?(entendido|entiendo).?$/s,
    "aceptar seleccionadas",
    "continuar",
    "guardar configuraci\xF3n",
    "guardar selecci\xF3n",
    "guardar y cerrar",
    "ir al contenido principal",
    "seguir",
    "vale",
    "\xA1vamos!",
    // Portuguese (PT)
    "prosseguir",
    // Catalan (CA)
    /^(ho )?(entenc|entès|entesos)[ !.]*$/s,
    // Portuguese (PT)
    // e.g. "ciente" / "estou ciente" (I'm aware), "entendi" (got it)
    /^(estou )?ciente[ !.]*$/s,
    /^entendi[ !.]*$/s,
    // Polish (PL)
    "kontynuuj",
    "ok, zrozumia\u0142em",
    /^ok.? rozumiem.?$/s,
    "rozumiem!",
    "rozumiem",
    "rozumiem, nie pokazuj wi\u0119cej",
    "w porz\u0105dku!",
    "w porz\u0105dku",
    /^zamknij informację o( plikach)? cookies$/,
    "zapisz i zamknij",
    // Greek (EL), e.g. "εντάξει", "το κατάλαβα", "κλείσιμο", "συνέχεια", "αποθήκευση επιλογών"
    /^(εντ[αά]ξει|(το\s+)?κατ[αά]λαβα|κλε[ιί]σιμο|συν[εέ]χεια|επιβεβα[ιί]ωση)[ !.]*$/is,
    /^αποθ[ηή]κευση\s+(των\s+)?(επιλογ[ωώ]ν|ρυθμ[ιί]σεων|προτιμ[ηή]σεων)$/is,
    // Russian (RU)
    // e.g. "понятно", "всё понятно", "хорошо", "ясно"; \w does not match Cyrillic
    /^\s*(ок|окей|хорошо|ясно|(вс[её]\s+)?(понятно|понял[аи]?))[!.]*\s*$/is,
    // e.g. "закрыть", "закрыть уведомление о cookie"
    /^\s*закрыть([\s-]+(это|эту|баннер|уведомлени[а-яё]*|окно|сообщени[а-яё]*|плашк[а-яё]*|информаци[а-яё]*)){0,2}([\s-]+(о|об)[\s-]+(cookie|куки[а-яё]*|файл[а-яё]*[\s-]+cookie))?\s*$/is,
    // e.g. "больше не показывать", "не показывать снова"
    /^\s*(больше\s+не\s+показывать|не\s+показывать(\s+(снова|больше|это\s+сообщение))?)\s*$/is,
    // e.g. "подтвердить", "подтверждаю выбор", "сохранить настройки", "сохранить и закрыть"
    /^\s*(подтвер(дить|ждаю|ждени[а-яё]*)|сохран(ить|яю|ение))([\s-]+(мой|мои|моё|свой|свои|своё)?[\s-]*(выбор[а-яё]*|настройк[а-яё]*|парамет[а-яё]*|предпочтени[а-яё]*|согласи[а-яё]*))?([\s-]+и[\s-]+(закрыть|продолжить))?\s*$/is,
    "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C",
    // Japanese (JA)
    // e.g. "閉じる" (close), "確認" / "確認しました" (confirmed), "了解" (understood), "確認して閉じる";
    // not "同意して閉じる" (agree and close) or the verb "確認する" (confirm)
    /^(確認|了解)(しました)?$|^((確認|了解)して)?閉じる$/
  ];

  // lib/heuristic-negatives.ts
  var COOKIE_CHOICE = [
    "\\b(?:accept|reject|decline|refuse|deny|allow|manage|customi[sz]e)\\b[^\\n]{0,25}\\bcookies?\\b",
    "\\b(?:reject|decline|deny|refuse) all\\b",
    "\\b(?:essential|necessary|required) (?:cookies )?only\\b|\\bonly (?:essential|necessary|required)\\b",
    "\\bcookies? (?:notice|settings|preferences|banner)\\b",
    "\\b(?:alle )?(?:cookies )?ablehnen\\b",
    "\\b(?:alles |alle cookies )?(?:weigeren|weiger|afwijzen)\\b",
    "\\b(?:tout )?refuser\\b",
    "\\brechazar(?: todas?)?\\b",
    "\\brifiuta(?: tutti)?\\b",
    // purposes and vendors as a button or heading line: some consent dialogs ask "under 18?"
    "^[^\\n]{0,40}\\b(?:purposes|finalit\xE9s|prop\xF3sitos|zwecke|doeleinden|finalit\xE0|vendors|fournisseurs|proveedores|leveranciers|fornitori)(?!\\w)[^\\n]{0,10}$",
    "\\b(?:legitimate (?:business )?interest|int\xE9r\xEAt l\xE9gitime|inter\xE9s leg\xEDtimo|berechtigtes interesse|gerechtvaardigd belang|legittimo interesse)\\b",
    "\\b(?:we|nous|wir|wij|noi|nosotros) (?:and|et|und|en|e|y) (?:our|nos|unsere|onze|i nostri|nuestros) (?:\\d+ )?(?:partners|partenaires|partner|socios)\\b"
  ].join("|");
  var BARE_ACCEPT = [
    "\\b(?:accept|allow) all\\b",
    "\\b(?:alle )?(?:cookies )?(?:akzeptieren|erlauben|zulassen)\\b",
    "\\b(?:alles |alle cookies )?(?:accepteren|accepteer|toestaan)\\b",
    "\\b(?:tout )?accepter\\b",
    "\\baceptar(?: todas?)?\\b",
    "\\baccetta(?: tutti)?\\b"
  ].join("|");
  var COOKIE_CHOICE_RE = new RegExp(COOKIE_CHOICE, "im");
  var CONSENT_CHOICE = new RegExp(`${COOKIE_CHOICE}|${BARE_ACCEPT}`, "im");
  var AGE_WORDING = new RegExp(
    [
      "\\b(?:over|above|at least|older than|minimum(?: age of)?)\\s*(?:18|21|eighteen)\\b",
      // "18+" only with age words after it: a bare "18+" also appears in cookie banners on adult sites
      "\\b(?:18|21)\\+?\\s*(?:years?(?: of age| old)?|yo|or older|or over)\\b",
      "\\b(?:you|users?|visitors?) must be (?:over |above |at least )?(?:18|21)\\b",
      "\\b(?:i'?m|i am) (?:over |at least )?(?:18|21)\\b",
      "\\bage (?:verification|confirmation|check|gate|restriction)\\b",
      "\\b(?:adults? only|adult[\\s-](?:oriented|content|material|website)|legal age|age of majority|not a minor|minors)\\b",
      "\\b(?:18|21) jahre\\b",
      "\\balters(?:beschr\xE4nkung|best\xE4tigung|verifikation|pr\xFCfung|kontrolle)",
      "\\b(?:vollj\xE4hrig|f\xFCr erwachsene|minderj\xE4hrige)\\b",
      "\\b(?:18|21) jaar\\b",
      "\\b(?:volwassenen|meerderjarig|minderjarigen|leeftijdsverificatie)\\b",
      "\\b(?:18|21) ans\\b",
      // no \\b before an accented letter: without the u flag it is not a word character
      "\\b(?:pour adultes|v\xE9rification de l.\xE2ge|mineurs)\\b|\xE2ge l\xE9gal\\b",
      "\\b(?:18|21) a\xF1os\\b",
      "\\b(?:mayor(?:es)? de edad|menores de edad|para adultos|verificaci\xF3n de edad)\\b",
      "\\b(?:18|21) anni\\b",
      "\\b(?:maggiorenne|minorenni|per adulti)\\b|\\bverifica dell.et\xE0(?!\\w)"
    ].join("|"),
    "i"
  );
  var DISMISS_LINE = /^\s*(?:(?:yes,? )?(?:i )?(?:ok(?:ay)?|accept|agree|allow|decline|deny|reject|refuse|understand|acknowledge(?: the use of cookies)?|got it|understood)(?: all)?(?:,? (?:and|&) (?:continue|close))?(?: non-essential)?|close|dismiss|akzeptieren|zustimmen|verstanden|einverstanden|ablehnen|accepteren|akkoord|weigeren|accepter|j.accepte|d.accord|refuser|fermer|aceptar|acepto|rechazar|entendido|accetto|accetta|rifiuta|ho capito|chiudi)\s*[!.]?\s*$/im;
  var DISMISS_END = /[.!?]\s+(?:ok(?:ay)?|got it|i agree|accept)\s*!?\s*$|\[\s*[x×]\s*\]|^\s*[x×✕]\s*$/im;
  var NOTICE_CONTROL = new RegExp(`${CONSENT_CHOICE.source}|${DISMISS_LINE.source}|${DISMISS_END.source}`, "im");
  var LEAVE_LINE = /^\s*(?:(?:no,? )?(?:i )?(?:want to )?(?:leave|exit|verlassen|quitter|sortir|salir|abandonar|esci|uscire|verlaten)\b[^\n]{0,30}|no,? take me away|(?:seite|hier) verlassen|(?:i am|i'm|ich bin|ik ben|je suis|soy|sono) (?:under|unter|onder|jonger dan|menor de(?: edad)?|minorenne|mineur)\b[^\n]{0,10})\s*[!.]?\s*$/im;
  var NOTICE_OWN_CONTROL = new RegExp(
    [
      "\\bcookies? verwalten\\b|\\bcookie-?(?:einstellungen|pr\xE4ferenzen)\\b|\\beinstellungen verwalten\\b",
      "\\bconfigura(?:r|ci\xF3n de)(?: las)? cookies\\b|\\bgestionar(?: las)? cookies\\b|\\bpersonalizar(?: las)? cookies\\b",
      "\\bparam[\xE9e]trer(?: les)? cookies\\b|\\bparam[\xE8e]tres(?: des)? cookies\\b|\\bg[\xE9e]rer(?: les)? cookies\\b|\\bpersonnaliser(?: les)? cookies\\b",
      "\\bgestisci(?: i)? cookie|\\bimpostazioni(?: dei| sui)? cookie|\\bpersonalizza(?: i)? cookie",
      "\\bcookie-?instellingen\\b|\\bcookies? beheren\\b|\\bvoorkeuren (?:beheren|aanpassen)\\b",
      "^\\s*(?:customi[sz]e|personnaliser|param\xE9trer|personalizar|configurar|personalizza|anpassen|aanpassen|meer opties|more options|weitere optionen|plus d.options|m\xE1s opciones|altre opzioni|manage (?:options|preferences|choices))\\s*$",
      "^\\s*close (?:this|the) (?:popup|banner|notice|message)\\s*$"
    ].join("|"),
    "im"
  );
  var ageGateUnless = (control) => (text) => !LEAVE_LINE.test(text) && (control.test(text) || NOTICE_OWN_CONTROL.test(text));
  var CONSENT_WORDS = /cookie|consent|track|partner|personali[sz]|advertis|analytic|privacy (?:options|choices|settings|rights)|do not sell|opt[- ]out/i;
  var LEGAL_AGREEMENT = /\b(?:end[- ]user licen[cs]e agreement|licen[cs]e agreement|limitation of liability|governing law|indemnif\w*|hereunder|disclaimers? of warrant\w*|warrant(?:y|ies) of merchantability)\b/i;
  var INVESTOR_GATE = /\beligible\s+counterpart(?:y|ies)\b|\bnot\s+(?:suitable|intended)\s+for\s+retail\s+(?:clients|investors)\b|\bconfirm\w*\s+(?:that\s+)?(?:you\s+are|i\s+am)\s+an?\s+(?:(?:professional|institutional|qualified|accredited|sophisticated)\s+(?:investor|client)|financial\s+(?:intermediary|advis[eo]r))\b/i;
  var DETECT_CONTEXT_NEGATIVES = [
    // popups with their own age confirmation are age gates, even when they mention cookies; a bare accept doesn't count
    // as a cookie choice here, since it may confirm the age
    { name: "age-gate-popup", pattern: AGE_WORDING, unless: ageGateUnless(COOKIE_CHOICE_RE), whole: true, input: "popup" },
    // a license or terms agreement may mention cookies, and its decline button must not be clicked as a cookie reject
    { name: "legal-agreement", pattern: LEGAL_AGREEMENT, whole: true, input: "popup" },
    // an investor eligibility gate may mention cookies, and its decline button must not be clicked as a cookie reject
    { name: "investor-gate", pattern: INVESTOR_GATE, whole: true, input: "popup" },
    // page text next to an age gate, unless a consent control is there too
    { name: "age-gate", pattern: AGE_WORDING, unless: ageGateUnless(NOTICE_CONTROL), lines: [4, 5], input: "page" },
    // terms of use need cookie or consent wording; a privacy-policy-only notice needs that or a button
    {
      name: "terms-without-consent",
      pattern: /\bterms\b|\bconditions\b/i,
      unless: CONSENT_WORDS,
      appliesTo: [BY_CONTINUING_PRIVACY]
    },
    {
      name: "privacy-without-control",
      unless: new RegExp(`${CONSENT_WORDS.source}|${DISMISS_LINE.source}`, "im"),
      appliesTo: [BY_CONTINUING_PRIVACY]
    },
    // a cookie policy link among short footer link lines
    {
      name: "footer-link",
      pattern: /^[^.!?:\n]{0,60}\n[\s]*\n?[^.!?:\s][^.!?:\n]{0,59}(?:\n|$)/,
      unless: NOTICE_CONTROL,
      lines: [0, 2],
      input: "page",
      appliesTo: [USE_OF_COOKIES, VERWENDUNG_VON_COOKIES, UTILISATION_DES_COOKIES, GEBRUIK_VAN_COOKIES]
    },
    {
      name: "acceptez-terms",
      pattern: /conditions (?:générales )?d.utilisation|\bcgu\b/i,
      unless: /cookie|témoin|traceur|partenaire/i,
      appliesTo: [ACCEPTEZ_UTILISATION]
    },
    // the same sentence is also a footer line with only a "learn more" link
    {
      name: "de-cookie-verb-needs-control",
      unless: NOTICE_CONTROL,
      lines: [1, 6],
      input: "page",
      appliesTo: [DE_COOKIE_VERB, DE_THIS_SITE_COOKIES, DE_SITE_USES_COOKIES]
    }
  ];

  // lib/heuristic-literals.ts
  var DETECT_PATTERN_LITERALS = [
    ["accept cookies"],
    ["only necessary cookies"],
    [],
    ["by using "],
    ["by clicking"],
    ["accept all cookies"],
    ["reject non-"],
    ["cookies "],
    [" cookies on your "],
    ["your consent to "],
    ["you agree to "],
    ["blocking some types of cookies"],
    ["powered by usercentrics", "realisiert mit", "realized with"],
    [],
    [" cookie"],
    ["cookie files"],
    ["cookies"],
    ["cookies?"],
    ["we are using cookies"],
    ["use of cookies"],
    ["website uses cookies to enhance your browsing experience"],
    ["cookies"],
    [" technologies"],
    ["such as cookies"],
    ["read more about"],
    ["consent to"],
    ["we and our "],
    ["information"],
    ["store and/or access information"],
    ["personalised ads and content, ad and content measurement"],
    [" and/or access"],
    ["and our partners ask for your consent"],
    ["we and "],
    ["partners", "partnern", "partner", "partenaires", "socios", "vendors", "fornitori"],
    ["partner"],
    ["technolog"],
    ["cookies"],
    ["cookies"],
    ["optional", "additional", "non-essential"],
    ["storing of cookies", "placed cookies"],
    [" on your device", "access and store "],
    ["we use "],
    ["out of "],
    ["out of the sale"],
    ["this website or its third"],
    ["information"],
    ["rights with regard to the sale"],
    ["we use technologies "],
    ["party tools to collect information"],
    ["continue reading with advertising", " tracking"],
    ["consent and continue"],
    ["store or retrieve information on your browser", "stock\xE9es dans votre navigateur ou r\xE9cup\xE9r\xE9es"],
    ["we have cookies"],
    [" your consent at any time", "einwilligung jederzeit widerrufen"],
    ["analytics ", "we use google analytics"],
    [" consenso"],
    ["accept or "],
    ["continue without accepting"],
    ["cookies "],
    ["utilisons"],
    ["cookies"],
    ["consentement"],
    ["partenaires"],
    ["publicit\xE9s"],
    ["utilise"],
    ["utilisent"],
    ["stocker"],
    ["consentement"],
    ["consentement"],
    ["utilisation"],
    ["technologies"],
    ["utilisation"],
    ["continuer sans accepter"],
    [" tous les cookies"],
    ["je refuse"],
    ["refuser et continuer"],
    ["en cliquant sur"],
    ["vous consentez"],
    ["accepter ou refuser "],
    ["les cookies nous "],
    ["optionnels", "publicitaires", "non essentiels"],
    ["seulement n\xE9cessaires"],
    ["je d\xE9sactive les finalit\xE9s non essentielles"],
    ["cookies essentiels uniquement"],
    ["n\xE9cessaires uniquement"],
    ["stocker", "stockons"],
    ["nos partenaires demandent votre consentement"],
    ["consentez \xE0 l", " cookies"],
    ["les cookies nous permettent", "nos partenaires et nous"],
    ["accepter "],
    ["on utilise", "nous utilisons"],
    ["naviguant", "poursuivant"],
    [],
    ["confidentialit\xE9"],
    ["verwenden"],
    ["partner"],
    ["zugriff auf informationen auf"],
    ["werbeleistung"],
    ["cookies"],
    ["verwendung"],
    ["cookies"],
    ["verwendet"],
    ["cookies"],
    ["auswahl"],
    ["technologien"],
    ["verwenden"],
    ["zus\xE4tzliche", "essenzielle", "funktionale", "notwendige", "erforderliche"],
    ["einwilligung", "zustimmung", "cookies"],
    ["ablehnen"],
    ["nur funktionale cookies akzeptieren"],
    ["optionale ablehnen"],
    ["zustimmung verweigern"],
    ["speichern und/oder "],
    ["unsere partner bitten um ihre zustimmung"],
    [" cookies"],
    ["cookies "],
    [" zum einsatz", "einsatz von cookies"],
    ["einverstanden", "einverstanden"],
    ["akzeptieren", "zulassen", "erlauben", "zustimmen"],
    ["zustimmen und weiter", " ohne zu "],
    ["einwilligung", "zustimmung", "zustimmung", "einwilligung"],
    ["tracking-technologien"],
    ["cookies"],
    ["cookies"],
    ["cookies"],
    ["cookies"],
    ["datenschutz"],
    ["verwendung "],
    ["mit werbetracking weiterlesen", "weiter mit werbung", "con tracking e annunci"],
    ["cookies"],
    [],
    ["analyse", "statistik"],
    ["marketing", "tracking"],
    ["cookies oder "],
    ["stimmen sie", "gestatten sie", "willigen sie", "erkl\xE4ren sie sich"],
    ["ben\xF6tigen wir "],
    ["einwilligung", "zustimmung", "einwilligung", "zustimmung"],
    ["welche cookies sie "],
    ["cookie"],
    ["in form von cookies", "blockierung bestimmter arten von cookies"],
    ["notwendige", "essenzielle", "funktionale"],
    ["cookies"],
    ["zwecken und anbietern"],
    ["weiter ohne akzeptanz"],
    ["gebruik"],
    ["gebruiken"],
    ["vergelijkbare"],
    ["afwijzen", "weigeren", "verwerpen"],
    ["noodzakelijk"],
    ["cookies weigeren"],
    ["cookies"],
    ["doorgaan zonder "],
    ["optionele", "functionele", "functioneel", "noodzakelijke", "essenti\xEBle", "standaard"],
    [],
    ["onze partners vragen om "],
    ["wij en onze "],
    [" cookies"],
    ["accepteer alle cookies"],
    ["analytische", "functionele", "essenti\xEBle", "noodzakelijke"],
    [],
    ["ervaring", "gebruikerservaring"],
    ["gebruiken", "plaatsen"],
    ["gebruiken "],
    ["plaatsen van"],
    ["te blijven gebruiken"],
    ["te klikken"],
    ["alle cookies accepteren"],
    ["toestemming voor "],
    [" contin"],
    ["cookie"],
    [" uso de cookies"],
    ["usa cookies de google"],
    [" uso de cookies"],
    ["al utilizar nuestro sitio web"],
    ["almacenar la informaci\xF3n en un dispositivo y"],
    [" utiliza"],
    ["cookies propias y de"],
    ["son necesarias"],
    [" cookie"],
    ["navegando"],
    ["nosotros y nuestros"],
    ["recopilamos y almacenamos datos de usted y de su dispositivo"],
    ["utilizamos tecnolog"],
    ["almacenar", "almacenamos"],
    ["nuestros socios solicitan su consentimiento"],
    ["tanto nosotros como", "nosotros y"],
    ["continuar sin aceptar", "solo las necesarias"],
    ["uso de "],
    ["cookies "],
    ["las cookies nos "],
    ["instalamos", "empleamos"],
    ["cookies", "necesitamos usar cookies"],
    ["al hacer clic en"],
    [" todas las cookies"],
    ["estrictamente necesarias"],
    ["almacenar o acceder a "],
    ["as de seguimiento"],
    ["cookie"],
    ["u\u017Cywa\u0107", "u\u017Cywamy"],
    ["cele przetwarzania twoich danych przez zaufanych partner\xF3w iab"],
    ["dzi\u0119ki "],
    [" plik\xF3w cookie"],
    ["korzystamy z technologii, takich jak pliki cookie"],
    ["korzystamy"],
    ["niekt\xF3re pliki cookies"],
    ["pliki cookies i pokrewne im technologie umo\u017Cliwiaj\u0105 poprawne dzia\u0142anie strony i pomagaj\u0105 nam dostosowa\u0107 ofert\u0119 do twoich potrzeb"],
    ["przechowywanie informacji na urz\u0105dzeniu lub dost\u0119p do nich"],
    ["przechowywanie plik\xF3w cookie na swoim urz\u0105dzeniu"],
    ["przechowywa\u0107 i uzyskiwa\u0107 dost\u0119p do informacji na twoich urz\u0105dzeniach"],
    ["przetwarzamy"],
    [" u\u017Cywa "],
    ["ta strona korzysta z ciasteczek"],
    ["uzyskujemy dost\u0119p i przechowujemy informacje na urz\u0105dzeniu"],
    [" cookie"],
    ["u\u017Cywamy plik\xF3w"],
    ["wykorzystuj\u0105 "],
    ["za pomoc\u0105 plik\xF3w cookies"],
    ["zgod\u0105 my i nasi partnerzy mo\u017Cemy wykorzystywa\u0107 precyzyjne dane geolokalizacyjne i identyfikacj\u0119"],
    ["cookies pr\xF2pies i de tercers"],
    ["utilitzem galetes"],
    ["\xFAnicament utilitza galetes pr\xF2pies amb finalitat t\xE8cnica"],
    ["este lloc web utilitza nom\xE9s cookies t\xE8cniques necess\xE0ries per al seu funcionament"],
    ["de personalitzaci\xF3 i an\xE0lisi"],
    ["utilitzem cookies i altres tecnologies"],
    ["cookies", "galetes"],
    ["cookie propio eta hirugarrenenak helburu teknikoarekin erabiltzen ditu"],
    ["cookie propioak eta hirugarrenen cookieak erabiltzen ditugu"],
    ["cookie propioak eta hirugarrenenak helburu teknikoarekin erabiltzen ditu"],
    ["ak erabiltzen ditu"],
    ["cookieak erabiltzen ditu"],
    [" bazkideek cookieak eta identifikadoreak erabiltzen ditugu"],
    ["norberaren eta hirugarrenen cookie"],
    ["web orri honek cookieak erabiltzen ditu"],
    ["webgune honek cookie propioak eta hirugarrenen cookie-fitxategiak erabiltzen ditu"],
    ["empregamos cookies propias"],
    ["este portal emprega cookies propias ou de terceiros con fins anal\xEDticos"],
    ["\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443"],
    ["\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443"],
    ["cookie", "\u043A\u0443\u043A\u0438"],
    ["\u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438"],
    ["cookie", "\u043A\u0443\u043A\u0438"],
    [],
    ["\u0431\u0440\u0430\u0443\u0437\u0435\u0440"],
    ["\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u044F"],
    ["\u043F\u0440\u0438\u043D\u0438\u043C\u0430"],
    ["usiamo", "utilizziamo"],
    ["cookie"],
    ["noi e i nostri"],
    [" cookie"],
    [" cookie"],
    ["tecnici", "di profilazione", "di terze parti", "analitici", "statistici", "di marketing"],
    ["acconsent", "accett"],
    [" navigazione"],
    [" senza accettare"],
    ["rifiuta e abbonati"],
    ["consenso "],
    [" nostri "],
    ["terze parti selezionate"],
    ["archiviare", "archiviamo", "memorizzare", "memorizziamo"],
    [" dei cookie"],
    ["utilizz"],
    ["questo", "il nostro"],
    ["tecnologie "],
    ["cliccando su"],
    [" tutti i cookie"],
    ["noi e i nostri "],
    ["essenziali", "necessari"],
    ["anv\xE4nder"],
    ["cookies", "kakor"],
    ["anv\xE4nds ", "anv\xE4nds"],
    ["anv\xE4ndning", "anv\xE4ndningen", "anv\xE4ndandet"],
    ["godk\xE4nn", "accepter", "till\xE5t", "du till\xE5ter"],
    [" n\xF6dv\xE4ndiga"],
    ["lagra och/eller "],
    [" partner"],
    ["tekniker "],
    ["cookie", "\u30AF\u30C3\u30AD\u30FC"],
    ["\u95B2\u89A7\u5C65\u6B74", "\u7AEF\u672B\u60C5\u5831", "\u5229\u7528\u8005\u60C5\u5831"],
    [" cookies"],
    ["informasjonskapsler", "cookies"],
    ["vi benytter"],
    ["bruk av "],
    ["kullan", "yararlan", "faydalan"],
    ["kulland"],
    ["\xE7erez "],
    ["\u03C7\u03C1\u03B7\u03C3\u03B9\u03BC\u03BF\u03C0\u03BF\u03B9"],
    ["\u03C4\u03B5\u03C7\u03BD\u03BF\u03BB\u03BF\u03B3"],
    ["\u03C3\u03C5\u03B3\u03BA\u03B1\u03C4"],
    ["\u03B1\u03C0\u03BF\u03B4\u03BF\u03C7"],
    ["\u03C1\u03C1\u03B9\u03C8\u03B7"]
  ];

  // lib/heuristic-prefilter.ts
  function literalIndex(all) {
    const distinct = [...new Set(all)].sort((a, b) => b.length - a.length);
    if (distinct.length === 0) {
      return { present: () => /* @__PURE__ */ new Set() };
    }
    const escape = (l) => l.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const any = new RegExp(`(?=(${distinct.map(escape).join("|")}))`, "g");
    const implies = /* @__PURE__ */ new Map();
    const impliedBy = (m) => {
      let list = implies.get(m);
      if (!list) {
        list = distinct.filter((l) => m.startsWith(l));
        implies.set(m, list);
      }
      return list;
    };
    return {
      present(lower) {
        const found = /* @__PURE__ */ new Set();
        for (const m of lower.matchAll(any)) {
          if (!found.has(m[1])) {
            impliedBy(m[1]).forEach((l) => found.add(l));
          }
        }
        return found;
      }
    };
  }

  // lib/heuristic-detect.ts
  var TEXT_LIMIT = 1e5;
  var DEFAULT_WINDOW = 150;
  var builtinLiterals;
  function literalsOf(pattern) {
    if (!builtinLiterals) {
      const fresh = DETECT_PATTERN_LITERALS.length === DETECT_PATTERNS.length;
      builtinLiterals = new Map(fresh ? DETECT_PATTERNS.map((p, i) => [patternOf(p), DETECT_PATTERN_LITERALS[i]]) : []);
    }
    return builtinLiterals.get(pattern) ?? [];
  }
  var index;
  var literalsIn = (lower) => (index ??= literalIndex(DETECT_PATTERN_LITERALS.flat())).present(lower);
  var truncate = (text) => (text || "").slice(0, TEXT_LIMIT);
  var forInput = (scoped, input) => !scoped.input || scoped.input === input;
  var stateless = (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, ""));
  function toPredicate(test) {
    if (typeof test === "function") {
      return test;
    }
    const re = stateless(test);
    return (text) => re.test(text);
  }
  var compiledPatterns = /* @__PURE__ */ new WeakMap();
  var compiledNegatives = /* @__PURE__ */ new WeakMap();
  function compilePatterns(detectPatterns) {
    let compiled = compiledPatterns.get(detectPatterns);
    if (!compiled) {
      compiled = detectPatterns.map((p) => {
        const pattern = patternOf(p);
        const input = p instanceof RegExp ? void 0 : p.input;
        const global = pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
        return { id: pattern.toString(), pattern, global, input, literals: literalsOf(pattern) };
      });
      compiledPatterns.set(detectPatterns, compiled);
    }
    return compiled;
  }
  function compileNegatives(negatives) {
    let compiled = compiledNegatives.get(negatives);
    if (!compiled) {
      compiled = negatives.map((n) => {
        const pattern = n.pattern ? stateless(n.pattern) : null;
        const unless = n.unless ? toPredicate(n.unless) : null;
        return {
          ...n,
          hits: (context) => (!pattern || pattern.test(context)) && !(unless && unless(context)),
          applies: n.appliesTo ? new Set(n.appliesTo.map(String)) : null
        };
      });
      compiledNegatives.set(negatives, compiled);
    }
    return compiled;
  }
  function negativeContext(text, start, end, negative) {
    if (negative.whole) {
      return text;
    }
    if (negative.lines === void 0) {
      const w = negative.window ?? DEFAULT_WINDOW;
      return text.slice(Math.max(0, start - w), end + w);
    }
    const lineEnd = (i) => {
      const next = text.indexOf("\n", i);
      return next === -1 ? text.length : next;
    };
    const [before, after] = Array.isArray(negative.lines) ? negative.lines : [negative.lines, negative.lines];
    let from = start > 0 ? text.lastIndexOf("\n", start - 1) + 1 : 0;
    let to = lineEnd(end);
    for (let i = 0; i < before; i++) {
      from = from >= 2 ? text.lastIndexOf("\n", from - 2) + 1 : 0;
    }
    for (let i = 0; i < after; i++) {
      to = to < text.length ? lineEnd(to + 1) : to;
    }
    return text.slice(from, to);
  }
  function checkHeuristicPatterns(allText, input, options = {}) {
    return matchHeuristicPatterns(allText, input, options, false);
  }
  function hasHeuristicPatterns(allText, input, options = {}) {
    return matchHeuristicPatterns(allText, input, options, true).patterns.length > 0;
  }
  function matchHeuristicPatterns(allText, input, { patterns: detectPatterns = DETECT_PATTERNS, negatives = DETECT_CONTEXT_NEGATIVES }, firstOnly) {
    if (input !== void 0 && input !== "popup" && input !== "page") {
      const got = Array.isArray(input) ? "a pattern list (pass it as the `patterns` option)" : JSON.stringify(input);
      throw new TypeError(`heuristic input must be 'popup', 'page' or undefined, got ${got}`);
    }
    allText = truncate(allText);
    const patterns = [];
    const snippets2 = [];
    const suppressed = [];
    const applicable = compileNegatives(negatives).filter((n) => forInput(n, input));
    let present;
    const wholeHits = /* @__PURE__ */ new Map();
    const hitsAt = (n, start, end) => {
      if (!n.whole) {
        return n.hits(negativeContext(allText, start, end, n));
      }
      let hit = wholeHits.get(n);
      if (hit === void 0) {
        hit = n.hits(allText);
        wholeHits.set(n, hit);
      }
      return hit;
    };
    for (const d of compilePatterns(detectPatterns)) {
      if (!forInput(d, input)) {
        continue;
      }
      if (d.literals.length) {
        const inText = present ??= literalsIn(allText.toLowerCase());
        if (!d.literals.some((l) => inText.has(l))) {
          continue;
        }
      }
      const own = applicable.filter((n) => !n.applies || n.applies.has(d.id));
      const matched = [];
      const dropped = /* @__PURE__ */ new Set();
      let found = false;
      let kept = own.length === 0;
      for (const m of allText.matchAll(d.global)) {
        found = true;
        if (!kept) {
          const start = m.index ?? 0;
          const hit = own.find((n) => hitsAt(n, start, start + m[0].length));
          if (hit) {
            dropped.add(hit.name);
          } else {
            kept = true;
          }
        }
        if (kept && firstOnly) {
          break;
        }
        matched.push(m[0].substring(0, 200));
      }
      if (!found) {
        continue;
      }
      if (!kept) {
        dropped.forEach((negative) => suppressed.push({ pattern: d.id, negative }));
        continue;
      }
      patterns.push(d.id);
      if (firstOnly) {
        break;
      }
      snippets2.push(...matched);
    }
    return { patterns, snippets: snippets2, suppressed };
  }

  // lib/heuristic-classify.ts
  function classifyButtons(buttons) {
    for (const button of buttons) {
      button.regexClassification = classifyButtonTextRegex(button.text);
    }
  }
  function classifyPopup(buttons) {
    const { reject, settings, accept, acknowledge } = buttons.reduce(
      (acc, button) => {
        if (button.regexClassification && button.regexClassification !== "other") {
          acc[button.regexClassification]++;
        }
        return acc;
      },
      { reject: 0, settings: 0, accept: 0, acknowledge: 0 }
    );
    if (reject > 0) {
      return "reject";
    }
    if (settings > 0) {
      return "none";
    }
    if (acknowledge > 0) {
      return "tier1";
    }
    if (accept > 0) {
      return accept === 1 ? "tier2" : "none";
    }
    return "none";
  }
  function testButtonMatches(buttonText, matchPatterns, neverMatchPatterns) {
    if (!buttonText) {
      return false;
    }
    const cleanedButtonText = cleanButtonText(buttonText);
    return !neverMatchPatterns.some((p) => p instanceof RegExp && p.test(cleanedButtonText) || p === cleanedButtonText) && matchPatterns.some((p) => p instanceof RegExp && p.test(cleanedButtonText) || p === cleanedButtonText);
  }
  function cleanButtonText(buttonText) {
    let result = buttonText.toLowerCase();
    result = result.replace(/\u0307/g, "");
    result = result.replace(/[“”"'/#&[\]→✕×⟩❯><✗×‘’›«»]+/g, "");
    result = result.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u2600-\u26FF\u2700-\u27BF\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu,
      ""
    );
    result = result.replace(/\n+/g, " ");
    result = result.replace(/\s+/g, " ");
    result = result.trim();
    return result;
  }
  function classifyButtonTextRegex(buttonText) {
    if (testButtonMatches(buttonText, REJECT_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "reject";
    }
    if (testButtonMatches(buttonText, SETTINGS_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "settings";
    }
    if (testButtonMatches(buttonText, ACCEPT_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "accept";
    }
    if (testButtonMatches(buttonText, ACKNOWLEDGE_PATTERNS, BUTTON_NEVER_MATCH_PATTERNS)) {
      return "acknowledge";
    }
    return "other";
  }

  // lib/heuristics.ts
  var BUTTON_LIKE_ELEMENT_SELECTOR = 'button, input[type="button"], input[type="submit"], a, [role="button"], [class*="button"]';
  var POPUP_SEARCH_MAX_TIME = 100;
  var FRAGMENT_NEGATIVES = DETECT_CONTEXT_NEGATIVES.filter((n) => !n.whole);
  var hasFragmentPatterns = (text) => hasHeuristicPatterns(text, "popup", { negatives: FRAGMENT_NEGATIVES });
  var ACCEPTED_LEVELS = {
    off: [],
    reject: ["reject"],
    tier1: ["reject", "tier1"],
    tier2: ["reject", "tier1", "tier2"]
  };
  function getActionablePopups(mode = "reject", timeout = POPUP_SEARCH_MAX_TIME, hitTest = false) {
    const acceptedLevels = ACCEPTED_LEVELS[mode];
    const isActionable = (popup) => acceptedLevels.includes(popup.regexClassification) && isConsentPopup(popup);
    const popups = searchPopups(timeout, hitTest, DEFAULT_HIT_TEST_GRID, true).filter(isActionable);
    return popups.sort((a, b) => classificationRank(a) - classificationRank(b));
  }
  function searchPopups(timeout, hitTest, hitTestGrid, stopOnReject = false) {
    if (!isTopFrame()) {
      return getFramePopups();
    }
    const deadline = performance.now() + timeout;
    const hitTestPopups = hitTest ? findPopupsByHitTest(deadline, hitTestGrid) : [];
    if (stopOnReject && hitTestPopups.some((p) => p.regexClassification === "reject" && isConsentPopup(p))) {
      return hitTestPopups;
    }
    const walkPopups = collectPositionedPopups(deadline);
    return [...walkPopups, ...mergeWalkOverlaps(hitTestPopups, walkPopups)];
  }
  var consentPopups = /* @__PURE__ */ new WeakMap();
  function classificationRank(popup) {
    return ACCEPTED_LEVELS.tier2.indexOf(popup.regexClassification);
  }
  function isConsentPopup(popup) {
    if (!ACCEPTED_LEVELS.tier2.includes(popup.regexClassification)) {
      return false;
    }
    let result = consentPopups.get(popup);
    if (result === void 0) {
      const popupText = popup.text.trim();
      result = !!popupText && hasHeuristicPatterns(popupText, "popup");
      consentPopups.set(popup, result);
    }
    return result;
  }
  function mergeWalkOverlaps(hitTestPopups, walkPopups) {
    return hitTestPopups.filter((h) => {
      const hitIsConsent = isConsentPopup(h);
      const absorbs = (p) => !hitIsConsent || isConsentPopup(p) && classificationRank(p) <= classificationRank(h);
      const walkPopup = walkPopups.find((p) => composedOverlaps(p.element, h.element) && absorbs(p));
      if (walkPopup) {
        (walkPopup.hitPoints ??= []).push(...h.hitPoints ?? []);
      }
      return !walkPopup;
    });
  }
  function getFramePopups() {
    if (window.parent && window.parent !== window.top) {
      return [];
    }
    const frameElement = getFramePopupElement(document);
    const popup = frameElement && toPopupData(frameElement);
    if (!popup) {
      return [];
    }
    popup.source = "frame";
    return [popup];
  }
  function collectPositionedPopups(deadline) {
    const { elements, shadowHosts } = getPopupLikeElements(deadline);
    const potentialPopups = [];
    const expanded = [];
    for (const el of elements) {
      const popup = toPopupData(el, shadowHosts);
      if (!popup) {
        continue;
      }
      const root = performance.now() > deadline ? popup : expandPopupFragment(popup, shadowHosts);
      if (potentialPopups.some((p) => p.element === root.element)) {
        continue;
      }
      if (root !== popup) {
        expanded.push(root.element);
      }
      root.source = "walk";
      potentialPopups.push(root);
    }
    return potentialPopups.filter((p) => !expanded.some((root) => root !== p.element && composedContains(root, p.element)));
  }
  var DEFAULT_HIT_TEST_GRID = {
    columns: [0.1, 0.5, 0.9],
    // banners sit along the top and bottom edges and modals in the middle; rows 150px in added almost nothing in crawls
    edgeRows: [30, 90]
  };
  function findPopupsByHitTest(deadline, grid) {
    const climbed = /* @__PURE__ */ new Map();
    const found = [];
    const toPopup = (el) => el.querySelector(TEXT_ENTRY_SELECTOR) ? null : toPopupRoot(el);
    for (const [x, y] of getHitTestPoints(grid)) {
      if (performance.now() > deadline) {
        return found;
      }
      const path = [];
      let reached = null;
      const shouldStop = (el) => {
        if (climbed.has(el)) {
          reached = climbed.get(el) ?? null;
          return true;
        }
        const overlapped = found.find((p) => composedOverlaps(p.element, el));
        if (overlapped) {
          reached = composedContains(overlapped.element, el) ? overlapped : null;
          return true;
        }
        path.push(el);
        return false;
      };
      const hit = closestHTMLElement(deepElementFromPoint(x, y));
      const popup = climbToPopup(hit, MAX_HIT_TEST_CLIMB_DEPTH, toPopup, shouldStop);
      if (popup) {
        popup.source = "hitTest";
        found.push(popup);
        reached = popup;
      }
      for (const el of path) {
        climbed.set(el, reached);
      }
      if (reached) {
        (reached.hitPoints ??= []).push([x, y]);
      }
    }
    return found;
  }
  function getHitTestPoints(grid) {
    const { innerWidth: width, innerHeight: height } = window;
    const rows = [...grid.edgeRows, height / 2, ...grid.edgeRows.map((y) => height - y)].map((y) => Math.round(y));
    const ys = [...new Set(rows)].filter((y) => y >= 0 && y < height);
    return ys.flatMap((y) => grid.columns.map((column) => [Math.round(column * width), y]));
  }
  var TEXT_ENTRY_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="tel"], input[type="number"], input[type="url"]';
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) {
        break;
      }
      el = inner;
    }
    return el;
  }
  function closestHTMLElement(el) {
    while (el && !(el instanceof HTMLElement)) {
      el = el.parentElement;
    }
    return el;
  }
  function toPopupData(el, shadowHosts, text = getElementText(el)) {
    if (!text) {
      return null;
    }
    const buttons = getButtonData(el, shadowHosts);
    classifyButtons(buttons);
    return { text, element: el, buttons, regexClassification: classifyPopup(buttons) };
  }
  function hasPopupButtons(text, buttons) {
    return !isOnlyButtonText(text, buttons) && buttons.some((b) => b.regexClassification !== "other");
  }
  function isOnlyButtonText(text, buttons) {
    let rest = text;
    for (const button of buttons) {
      rest = rest.replace(button.text, "");
    }
    return rest.replace(/\s+/g, "").length < 10;
  }
  function toPopupRoot(el, shadowHosts) {
    const text = getElementText(el);
    if (!text || !hasFragmentPatterns(text)) {
      return null;
    }
    const popup = toPopupData(el, shadowHosts, text);
    return popup && hasPopupButtons(text, popup.buttons) ? popup : null;
  }
  var MAX_FRAGMENT_EXPANSION_DEPTH = 6;
  var MAX_HIT_TEST_CLIMB_DEPTH = 8;
  function climbToPopup(el, maxDepth, toPopup, shouldStop) {
    for (let depth = 0; el && depth < maxDepth; depth++, el = getComposedParent(el)) {
      if (shouldStop?.(el) || el === document.body || el === document.documentElement || el.getBoundingClientRect().height > window.innerHeight) {
        return null;
      }
      const popup = toPopup(el);
      if (popup) {
        return popup;
      }
    }
    return null;
  }
  function expandPopupFragment(popup, shadowHosts) {
    if (hasFragmentPatterns(popup.text) && hasPopupButtons(popup.text, popup.buttons)) {
      return popup;
    }
    const parent = getComposedParent(popup.element);
    return climbToPopup(parent, MAX_FRAGMENT_EXPANSION_DEPTH, (el) => toPopupRoot(el, shadowHosts)) ?? popup;
  }
  function getComposedParent(el) {
    if (el.parentElement) {
      return el.parentElement;
    }
    const parent = el.parentNode;
    return parent instanceof ShadowRoot && parent.host instanceof HTMLElement ? parent.host : null;
  }
  function getFramePopupElement(doc) {
    const el = doc.body || doc.documentElement;
    const win = doc.defaultView;
    if (!el || !win || win.innerWidth === 0 || win.innerHeight === 0 || !isStyleVisible(el)) {
      return null;
    }
    return getElementText(el).trim() ? el : null;
  }
  function isStyleVisible(el) {
    return typeof el.checkVisibility !== "function" || el.checkVisibility({ checkVisibilityCSS: true });
  }
  function getElementText(el) {
    const text = el.innerText || "";
    if (!el.shadowRoot) {
      return text;
    }
    const shadowTexts = Array.from(el.shadowRoot.children, (child) => isRenderedTextElement(child) ? getElementText(child) : "");
    return [text, ...shadowTexts].filter((t) => t.trim()).join("\n");
  }
  function isRenderedTextElement(el) {
    return el instanceof HTMLElement && !["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT", "LINK", "SLOT"].includes(el.tagName) && window.getComputedStyle(el).display !== "none";
  }
  function composedOverlaps(a, b) {
    return composedContains(a, b) || composedContains(b, a);
  }
  function composedContains(container, node) {
    if (container.contains(node)) {
      return true;
    }
    let root = node.getRootNode();
    while (root instanceof ShadowRoot) {
      if (container.contains(root.host)) {
        return true;
      }
      root = root.host.getRootNode();
    }
    return false;
  }
  function isPopupCandidateVisible(el) {
    return isElementVisible(el) && isStyleVisible(el) && isOnScreen(el);
  }
  function isOnScreen(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return window.getComputedStyle(el).overflow === "visible" && Array.from(el.children).some((child) => isOnScreen(child));
    }
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }
  function isDialogLikeElement(node) {
    if (node.tagName === "DIALOG" && node.hasAttribute("open")) {
      return true;
    }
    if (node.getAttribute("role") === "dialog" || node.getAttribute("aria-modal") === "true") {
      return true;
    }
    return false;
  }
  function getPopupLikeElements(deadline) {
    const found = [];
    const shadowHosts = [];
    const roots = [document.documentElement];
    for (let i = 0; i < roots.length; i++) {
      if (i > 0 && performance.now() > deadline) {
        break;
      }
      const walker = document.createTreeWalker(
        roots[i],
        NodeFilter.SHOW_ELEMENT,
        // visit only element nodes
        {
          acceptNode(node) {
            if (node.shadowRoot) {
              shadowHosts.push(node);
              roots.push(node.shadowRoot);
            }
            if (node.tagName === "BODY") {
              return NodeFilter.FILTER_SKIP;
            }
            const style = window.getComputedStyle(node);
            if (style.display === "none") {
              return NodeFilter.FILTER_REJECT;
            }
            const cssPosition = style.position;
            if ((cssPosition === "fixed" || cssPosition === "sticky" || isDialogLikeElement(node)) && isPopupCandidateVisible(node)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            if (performance.now() > deadline) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        found.push(node);
      }
    }
    return { elements: excludeContainers(found.filter((element) => getElementText(element).trim())), shadowHosts };
  }
  function getButtonData(el, shadowHosts) {
    const buttons = [];
    for (const b of excludeContainers(getButtonLikeElements(el, shadowHosts))) {
      if (!isElementVisible(b) || isDisabled(b)) {
        continue;
      }
      const text = getElementText(b).trim() || // <input> values do not appear in innerText
      (b instanceof HTMLInputElement && ["submit", "button"].includes(b.type) ? b.value?.trim() : "");
      if (text) {
        buttons.push({ text, element: b });
      }
    }
    return buttons;
  }
  function getButtonLikeElements(el, shadowHosts = findShadowHosts(el)) {
    const buttons = Array.from(el.querySelectorAll(BUTTON_LIKE_ELEMENT_SELECTOR));
    for (const host of shadowHosts) {
      if (composedContains(el, host)) {
        buttons.push(...host.shadowRoot.querySelectorAll(BUTTON_LIKE_ELEMENT_SELECTOR));
      }
    }
    return buttons;
  }
  function findShadowHosts(root) {
    const hosts = [];
    const candidates = root instanceof HTMLElement ? [root, ...root.querySelectorAll("*")] : root.querySelectorAll("*");
    for (const el of candidates) {
      if (el.shadowRoot) {
        hosts.push(el, ...findShadowHosts(el.shadowRoot));
      }
    }
    return hosts;
  }
  function isDisabled(el) {
    return "disabled" in el && Boolean(el.disabled) || el.hasAttribute("disabled");
  }
  function excludeContainers(elements) {
    const candidates = new Set(elements);
    const containers = /* @__PURE__ */ new Set();
    for (const el of elements) {
      for (let node = el.parentNode; node; node = node.parentNode || (node instanceof ShadowRoot ? node.host : null)) {
        if (candidates.has(node)) {
          containers.add(node);
        }
      }
    }
    return elements.filter((el) => !containers.has(el)).reverse();
  }

  // lib/cmps/base.ts
  var defaultRunContext = {
    main: true,
    frame: false,
    urlPattern: ""
  };
  var AutoConsentCMPBase = class {
    constructor(autoconsentInstance) {
      this.name = "BASERULE";
      this.runContext = defaultRunContext;
      this.autoconsent = autoconsentInstance;
    }
    get hasSelfTest() {
      throw new Error("Not Implemented");
    }
    get isIntermediate() {
      throw new Error("Not Implemented");
    }
    get isCosmetic() {
      throw new Error("Not Implemented");
    }
    mainWorldEval(snippetId) {
      const snippet = snippets[snippetId];
      if (!snippet) {
        this.autoconsent.config.logs.errors && console.warn("Snippet not found", snippetId);
        return Promise.resolve(false);
      }
      const logsConfig = this.autoconsent.config.logs;
      if (this.autoconsent.config.isMainWorld) {
        logsConfig.evals && console.log("inline eval:", snippetId, snippet);
        let result = false;
        try {
          result = !!snippet.call(globalThis);
        } catch (e) {
          logsConfig.evals && console.error("error evaluating rule", snippetId, e);
        }
        return Promise.resolve(result);
      }
      const snippetSrc = getFunctionBody(snippet);
      logsConfig.evals && console.log("async eval:", snippetId, snippetSrc);
      return requestEval(snippetSrc, snippetId).catch((e) => {
        logsConfig.evals && console.error("error evaluating rule", snippetId, e);
        return false;
      });
    }
    checkRunContext() {
      if (!this.checkFrameContext(isTopFrame())) {
        return false;
      }
      if (this.runContext.urlPattern && !this.hasMatchingUrlPattern()) {
        return false;
      }
      return true;
    }
    checkFrameContext(isTop) {
      const runCtx = {
        ...defaultRunContext,
        ...this.runContext
      };
      if (isTop && !runCtx.main) {
        return false;
      }
      if (!isTop && !runCtx.frame) {
        return false;
      }
      return true;
    }
    hasMatchingUrlPattern() {
      return Boolean(this.runContext?.urlPattern && window.location.href.match(this.runContext.urlPattern));
    }
    detectCmp() {
      throw new Error("Not Implemented");
    }
    async detectPopup() {
      return false;
    }
    optOut() {
      throw new Error("Not Implemented");
    }
    optIn() {
      throw new Error("Not Implemented");
    }
    openCmp() {
      throw new Error("Not Implemented");
    }
    async test() {
      return Promise.resolve(true);
    }
    async highlightElements(elements, all = false, delayTimeout = 2e3) {
      if (elements.length === 0) {
        return;
      }
      if (!all) {
        elements = [elements[0]];
      }
      this.autoconsent.sendContentMessage({
        type: "visualDelay",
        timeout: delayTimeout
      });
      for (const el of elements) {
        this.autoconsent.config.logs.rulesteps && console.log("highlighting", el);
        highlightNode(el);
      }
      await this.wait(delayTimeout);
      for (const el of elements) {
        unhighlightNode(el);
      }
    }
    // Implementing DomActionsProvider below:
    async clickElement(element) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements([element]);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.clickElement(element);
    }
    async click(selector, all = false) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements(this.elementSelector(selector), all);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.click(selector, all);
    }
    elementExists(selector) {
      return this.autoconsent.domActions.elementExists(selector);
    }
    elementVisible(selector, check) {
      return this.autoconsent.domActions.elementVisible(selector, check);
    }
    waitForElement(selector, timeout) {
      return this.autoconsent.domActions.waitForElement(selector, timeout);
    }
    waitForVisible(selector, timeout, check) {
      return this.autoconsent.domActions.waitForVisible(selector, timeout, check);
    }
    async waitForThenClick(selector, timeout, all, retries, retryInterval) {
      if (this.autoconsent.config.visualTest) {
        await this.highlightElements(this.elementSelector(selector), all);
      }
      this.autoconsent.updateState({ clicks: this.autoconsent.state.clicks + 1 });
      return this.autoconsent.domActions.waitForThenClick(selector, timeout, all, retries, retryInterval);
    }
    wait(ms) {
      return this.autoconsent.domActions.wait(ms);
    }
    hide(selector, method) {
      return this.autoconsent.domActions.hide(selector, method);
    }
    stylesheet(cssRule, stylesheetId) {
      return this.autoconsent.domActions.stylesheet(cssRule, stylesheetId);
    }
    removeClass(selector, className) {
      return this.autoconsent.domActions.removeClass(selector, className);
    }
    setStyle(selector, css) {
      return this.autoconsent.domActions.setStyle(selector, css);
    }
    addStyle(selector, css) {
      return this.autoconsent.domActions.addStyle(selector, css);
    }
    cookieContains(substring) {
      return this.autoconsent.domActions.cookieContains(substring);
    }
    prehide(selector) {
      return this.autoconsent.domActions.prehide(selector);
    }
    undoPrehide() {
      return this.autoconsent.domActions.undoPrehide();
    }
    querySingleReplySelector(selector, parent) {
      return this.autoconsent.domActions.querySingleReplySelector(selector, parent);
    }
    querySelectorChain(selectors) {
      return this.autoconsent.domActions.querySelectorChain(selectors);
    }
    elementSelector(selector) {
      return this.autoconsent.domActions.elementSelector(selector);
    }
    waitForMutation(selector) {
      return this.autoconsent.domActions.waitForMutation(selector);
    }
  };
  var AutoConsentCMP = class extends AutoConsentCMPBase {
    constructor(rule, autoconsentInstance) {
      super(autoconsentInstance);
      this.rule = rule;
      this.name = rule.name;
      this.runContext = rule.runContext || defaultRunContext;
    }
    get hasSelfTest() {
      return !!this.rule.test && this.rule.test.length > 0;
    }
    get isIntermediate() {
      return !!this.rule.intermediate;
    }
    get isCosmetic() {
      return !!this.rule.cosmetic;
    }
    get prehideSelectors() {
      return this.rule.prehideSelectors || [];
    }
    async detectCmp() {
      if (this.rule.detectCmp) {
        return this._runRulesSequentially(this.rule.detectCmp, this.autoconsent.config.logs.detectionsteps);
      }
      return false;
    }
    async detectPopup() {
      if (this.rule.detectPopup) {
        return this._runRulesSequentially(this.rule.detectPopup, this.autoconsent.config.logs.detectionsteps);
      }
      return false;
    }
    async optOut() {
      const logsConfig = this.autoconsent.config.logs;
      if (this.rule.optOut) {
        logsConfig.lifecycle && console.log("Initiated optOut()", this.rule.optOut);
        return this._runRulesSequentially(this.rule.optOut, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async optIn() {
      const logsConfig = this.autoconsent.config.logs;
      if (this.rule.optIn) {
        logsConfig.lifecycle && console.log("Initiated optIn()", this.rule.optIn);
        return this._runRulesSequentially(this.rule.optIn, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async openCmp() {
      if (this.rule.openCmp) {
        return this._runRulesSequentially(this.rule.openCmp, this.autoconsent.config.logs.rulesteps);
      }
      return false;
    }
    async test() {
      if (this.hasSelfTest && this.rule.test) {
        return this._runRulesSequentially(this.rule.test, this.autoconsent.config.logs.rulesteps);
      }
      return super.test();
    }
    async evaluateRuleStep(rule) {
      const results = [];
      const logsConfig = this.autoconsent.config.logs;
      if (rule.exists) {
        results.push(this.elementExists(rule.exists));
      }
      if (rule.visible) {
        results.push(this.elementVisible(rule.visible, rule.check));
      }
      if (rule.eval) {
        const res = this.mainWorldEval(rule.eval);
        results.push(res);
      }
      if (rule.waitFor) {
        results.push(this.waitForElement(rule.waitFor, rule.timeout));
      }
      if (rule.waitForVisible) {
        results.push(this.waitForVisible(rule.waitForVisible, rule.timeout, rule.check));
      }
      if (rule.click) {
        results.push(this.click(rule.click, rule.all));
      }
      if (rule.waitForThenClick) {
        results.push(this.waitForThenClick(rule.waitForThenClick, rule.timeout, rule.all, rule.retry, rule.retryInterval));
      }
      if (rule.wait) {
        results.push(this.wait(rule.wait));
      }
      if (rule.hide) {
        results.push(this.hide(rule.hide, rule.method));
      }
      if (rule.stylesheet !== void 0) {
        results.push(this.stylesheet(rule.stylesheet, rule.stylesheetId));
      }
      if (rule.removeClass !== void 0) {
        results.push(rule.selector ? this.removeClass(rule.selector, rule.removeClass) : false);
      }
      if (rule.setStyle !== void 0) {
        results.push(rule.selector ? this.setStyle(rule.selector, rule.setStyle) : false);
      }
      if (rule.addStyle !== void 0) {
        results.push(rule.selector ? this.addStyle(rule.selector, rule.addStyle) : false);
      }
      if (rule.cookieContains) {
        results.push(this.cookieContains(rule.cookieContains));
      }
      if (rule.if) {
        if (!rule.if.exists && !rule.if.visible) {
          console.error("invalid conditional rule", rule.if);
          return false;
        }
        if (!rule.then) {
          console.error('invalid conditional rule, missing "then" step', rule.if);
          return false;
        }
        const condition = await this.evaluateRuleStep(rule.if);
        logsConfig.rulesteps && console.log("Condition is", condition);
        if (condition) {
          results.push(this._runRulesSequentially(rule.then, logsConfig.rulesteps));
        } else if (rule.else) {
          results.push(this._runRulesSequentially(rule.else, logsConfig.rulesteps));
        } else {
          results.push(true);
        }
      }
      if (rule.any) {
        let resultOfAny = false;
        for (const step of rule.any) {
          if (await this.evaluateRuleStep(step)) {
            resultOfAny = true;
            break;
          }
        }
        results.push(resultOfAny);
      }
      if (results.length === 0) {
        logsConfig.errors && console.warn("Unrecognized rule", rule);
        return false;
      }
      const all = await Promise.all(results);
      const result = all.reduce((a, b) => a && b, true);
      if (rule.negated) {
        return !result;
      }
      return result;
    }
    async _runRulesParallel(rules) {
      const results = rules.map((rule) => this.evaluateRuleStep(rule));
      const detections = await Promise.all(results);
      return detections.every((r) => !!r);
    }
    async _runRulesSequentially(rules, logSteps = true) {
      for (const rule of rules) {
        logSteps && console.log("Running rule...", rule);
        const result = await this.evaluateRuleStep(rule);
        logSteps && console.log("...rule result", result);
        if (!result && !rule.optional) {
          return false;
        }
      }
      return true;
    }
  };
  var AutoConsentHeuristicCMP = class extends AutoConsentCMPBase {
    constructor(autoconsentInstance, mode = "reject") {
      super(autoconsentInstance);
      this.popups = [];
      this.name = "HEURISTIC";
      this.runContext = {
        main: true,
        frame: false
        // do not run in iframes for security reasons
      };
      this.mode = mode;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.autoconsent.config.performanceLoggingEnabled && performance.mark("heuristicDetectorStart");
      this.popups = getActionablePopups(
        this.mode,
        this.autoconsent.config.heuristicPopupSearchTimeout,
        this.autoconsent.config.enableHeuristicHitTest
      );
      this.autoconsent.config.performanceLoggingEnabled && performance.mark("heuristicDetectorEnd");
      this.autoconsent.config.performanceLoggingEnabled && performance.measure("heuristicDetector", "heuristicDetectorStart", "heuristicDetectorEnd");
      if (this.popups.length > 0) {
        this.name = `HEURISTIC-${this.popups[0].regexClassification?.toUpperCase()}`;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    async detectPopup() {
      if (this.popups.length > 0) {
        if (this.popups.length > 1) {
          this.autoconsent.config.logs.errors && console.warn("Heuristic found multiple popups");
        }
        return true;
      }
      return false;
    }
    getTargetButton() {
      const popup = this.popups[0];
      const level = popup.regexClassification;
      const buttons = popup.buttons;
      const targetButtonType = level === "reject" ? "reject" : level === "tier1" ? "acknowledge" : "accept";
      return buttons.find((button) => button.regexClassification === targetButtonType);
    }
    optOut() {
      const button = this.getTargetButton();
      if (button) {
        return this.clickElement(button.element);
      }
      return Promise.resolve(false);
    }
    optIn() {
      throw new Error("Not Implemented");
    }
    openCmp() {
      throw new Error("Not Implemented");
    }
    async test() {
      const button = this.getTargetButton();
      if (button) {
        await this.wait(500);
        return !isElementVisible(button.element);
      }
      return false;
    }
  };

  // lib/cmps/trustarc-top.ts
  var cookieSettingsButton = "#truste-show-consent";
  var shortcutOptOut = "#truste-consent-required";
  var shortcutOptIn = "#truste-consent-button";
  var popupContent = "#truste-consent-content";
  var bannerOverlay = "#trustarc-banner-overlay";
  var bannerContainer = "#truste-consent-track";
  var prefCenterDeclineAll = [
    ".truste_popframe.trustarc_newcm_container",
    'button[data-button-key="decline_all"], .trustarc-declineall-btn'
  ];
  var TrustArcTop = class extends AutoConsentCMPBase {
    constructor(autoconsentInstance) {
      super(autoconsentInstance);
      this.name = "TrustArc-top";
      this.prehideSelectors = [".trustarc-banner-container", `.truste_popframe,.truste_overlay,.truste_box_overlay,${bannerContainer}`];
      this.runContext = {
        main: true,
        frame: false
      };
      this._shortcutButton = null;
      this._optInDone = false;
      this._optOutDone = false;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      if (this._optInDone || this._optOutDone) {
        return false;
      }
      return !this._shortcutButton;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      const result = this.elementExists(`${cookieSettingsButton},${bannerContainer}`);
      if (result) {
        this._shortcutButton = document.querySelector(shortcutOptOut);
      }
      return result;
    }
    async detectPopup() {
      return this.elementVisible(`${popupContent},${bannerOverlay},${bannerContainer}`, "any");
    }
    async optOut() {
      if (this.elementExists(shortcutOptOut)) {
        const shortcutVisible = this.elementVisible(shortcutOptOut, "any");
        await this.click(shortcutOptOut);
        if (shortcutVisible || !this.elementExists(`${bannerContainer}.ta-show`)) {
          return true;
        }
        this._shortcutButton = null;
      }
      hideElements(getStyleElement(), `.truste_popframe, .truste_overlay, .truste_box_overlay, ${bannerContainer}`);
      await this.click(cookieSettingsButton);
      if (await this.waitForElement(prefCenterDeclineAll, 3e3)) {
        this._optOutDone = true;
        await this.click(prefCenterDeclineAll);
      }
      setTimeout(() => {
        getStyleElement().remove();
      }, 1e4);
      return true;
    }
    async optIn() {
      this._optInDone = true;
      return await this.click(shortcutOptIn);
    }
    async openCmp() {
      return true;
    }
    async test() {
      await this.wait(500);
      return await this.mainWorldEval("EVAL_TRUSTARC_TOP");
    }
  };

  // lib/cmps/cookiebot.ts
  var Cookiebot = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Cybotcookiebot";
      this.prehideSelectors = [
        "#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,#dtcookie-container,#cookiebanner,#cb-cookieoverlay,.modal--cookie-banner,#cookiebanner_outer,#CookieBanner"
      ];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return await this.mainWorldEval("EVAL_COOKIEBOT_1");
    }
    async detectPopup() {
      return this.mainWorldEval("EVAL_COOKIEBOT_2");
    }
    async optOut() {
      if (this.elementVisible("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll")) {
        return await this.click("#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll");
      }
      await this.wait(500);
      let res = await this.mainWorldEval("EVAL_COOKIEBOT_3");
      await this.wait(1e3);
      res = res && await this.mainWorldEval("EVAL_COOKIEBOT_4");
      if (this.elementVisible("#CybotCookiebotDialogBodyButtonDecline")) {
        return await this.click("#CybotCookiebotDialogBodyButtonDecline");
      }
      return res;
    }
    async optIn() {
      if (this.elementExists("#dtcookie-container")) {
        return await this.click(".h-dtcookie-accept");
      }
      await this.click(".CybotCookiebotDialogBodyLevelButton:not(:checked):enabled", true);
      await this.click("#CybotCookiebotDialogBodyLevelButtonAccept");
      await this.click("#CybotCookiebotDialogBodyButtonAccept");
      return true;
    }
    async test() {
      await this.wait(500);
      return await this.mainWorldEval("EVAL_COOKIEBOT_5");
    }
  };

  // lib/cmps/sourcepoint-frame.ts
  var SourcePoint = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Sourcepoint-frame";
      this.prehideSelectors = ["div[id^='sp_message_container_'],.message-overlay", "#sp_privacy_manager_container"];
      this.ccpaNotice = false;
      this.ccpaPopup = false;
      this.runContext = {
        main: true,
        frame: true
      };
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      const url = new URL(location.href);
      if (url.searchParams.has("message_id") && url.hostname === "ccpa-notice.sp-prod.net") {
        this.ccpaNotice = true;
        return true;
      }
      if (url.hostname === "ccpa-pm.sp-prod.net") {
        this.ccpaPopup = true;
        return true;
      }
      return (url.pathname === "/index.html" || url.pathname === "/privacy-manager/index.html" || url.pathname === "/ccpa_pm/index.html" || url.pathname === "/us_pm/index.html") && (url.searchParams.has("message_id") || url.searchParams.has("requestUUID") || url.searchParams.has("consentUUID"));
    }
    async detectPopup() {
      if (this.ccpaNotice) {
        return true;
      }
      if (this.ccpaPopup) {
        return await this.waitForElement(".priv-save-btn", 2e3);
      }
      await this.waitForElement(
        ".sp_choice_type_11,.sp_choice_type_12,.sp_choice_type_13,.sp_choice_type_ACCEPT_ALL,.sp_choice_type_SAVE_AND_EXIT",
        2e3
      );
      return !this.elementExists(".sp_choice_type_9");
    }
    async optIn() {
      await this.waitForElement(".sp_choice_type_11,.sp_choice_type_ACCEPT_ALL", 2e3);
      if (await this.click(".sp_choice_type_11")) {
        return true;
      }
      if (await this.click(".sp_choice_type_ACCEPT_ALL")) {
        return true;
      }
      return false;
    }
    isManagerOpen() {
      if (location.pathname === "/privacy-manager/index.html" || location.pathname === "/ccpa_pm/index.html") {
        return true;
      }
      if (location.pathname === "/us_pm/index.html" && !document.querySelector(".sp_choice_type_11,.sp_choice_type_ACCEPT_ALL")) {
        return true;
      }
      return false;
    }
    async optOut() {
      await this.wait(500);
      const logsConfig = this.autoconsent.config.logs;
      if (this.ccpaPopup) {
        const toggles = document.querySelectorAll(
          ".priv-purpose-container .sp-switch-arrow-block a.neutral.on .right"
        );
        for (const t of toggles) {
          t.click();
        }
        const switches = document.querySelectorAll(
          ".priv-purpose-container .sp-switch-arrow-block a.switch-bg.on"
        );
        for (const t of switches) {
          t.click();
        }
        return await this.click(".priv-save-btn");
      }
      if (this.elementVisible(".sp_choice_type_SE", "any")) {
        await this.click(
          [
            "xpath///div[contains(., 'Do not share my personal information') and contains(@class, 'switch-container')]",
            ".pm-switch[aria-checked=false] .slider"
          ],
          false
        );
        return await this.click(".sp_choice_type_SE");
      }
      if (!this.isManagerOpen()) {
        const manageSelector = '.sp_choice_type_12,[data-choice]:not([class*="sp_choice_type_"])';
        const actionable = await this.waitForVisible(`${manageSelector},.sp_choice_type_13`);
        if (!actionable) {
          return false;
        }
        if (this.elementVisible(".sp_choice_type_13", "any")) {
          return await this.click(".sp_choice_type_13");
        }
        await this.click(manageSelector);
        await waitFor(() => this.isManagerOpen(), 200, 100);
      }
      await this.waitForElement(".type-modal", 2e4);
      if (this.elementExists("[role=tablist]")) {
        await this.waitForElement("[role=tablist] [role=tab]", 1e4);
      }
      this.waitForThenClick(".ccpa-stack .pm-switch[aria-checked=true] .slider", 500, true);
      try {
        const rejectSelector1 = ".sp_choice_type_REJECT_ALL";
        const rejectSelector2 = ".reject-toggle";
        const path = await Promise.race([
          this.waitForElement(rejectSelector1, 2e3).then((success) => success ? 0 : -1),
          this.waitForElement(rejectSelector2, 2e3).then((success) => success ? 1 : -1),
          this.waitForElement(".pm-features", 2e3).then((success) => success ? 2 : -1)
        ]);
        if (path === 0) {
          await this.waitForVisible(rejectSelector1);
          return await this.click(rejectSelector1);
        } else if (path === 1) {
          await this.click(rejectSelector2);
        } else if (path === 2) {
          await this.waitForElement(".pm-features", 1e4);
          await this.click(".checked > span", true);
          await this.click(".chevron");
        }
      } catch (e) {
        logsConfig.errors && console.warn(e);
      }
      return await this.click(".sp_choice_type_SAVE_AND_EXIT");
    }
  };

  // lib/cmps/consentmanager.ts
  var ConsentManager = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "consentmanager.net";
      this.prehideSelectors = ["#cmpbox,#cmpbox2"];
      this.apiAvailable = false;
    }
    get hasSelfTest() {
      return this.apiAvailable;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      this.apiAvailable = await this.mainWorldEval("EVAL_CONSENTMANAGER_1");
      if (!this.apiAvailable) {
        return this.elementExists("#cmpbox");
      } else {
        return true;
      }
    }
    async detectPopup() {
      if (this.elementVisible("#cmpbox .cmpmore", "any")) {
        return true;
      } else if (this.apiAvailable) {
        await this.wait(500);
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_2");
      }
      return false;
    }
    async optOut() {
      await this.wait(500);
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_3");
      }
      if (await this.click(".cmpboxbtnno")) {
        return true;
      }
      if (this.elementExists(".cmpwelcomeprpsbtn")) {
        await this.click(".cmpwelcomeprpsbtn > a[aria-checked=true]", true);
        await this.click(".cmpboxbtnsave");
        return true;
      }
      await this.click(".cmpboxbtncustom");
      await this.waitForElement(".cmptblbox", 2e3);
      await this.click(".cmptdchoice > a[aria-checked=true]", true);
      await this.click(".cmpboxbtnyescustomchoices");
      this.hide("#cmpwrapper,#cmpbox", "display");
      return true;
    }
    async optIn() {
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_4");
      }
      return await this.click(".cmpboxbtnyes");
    }
    async test() {
      if (this.apiAvailable) {
        return await this.mainWorldEval("EVAL_CONSENTMANAGER_5");
      }
      return false;
    }
  };

  // lib/cmps/evidon.ts
  var Evidon = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Evidon";
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return this.elementExists("#_evidon_banner, #_evidon-barrier-wrapper");
    }
    async detectPopup() {
      return this.elementVisible("#_evidon_banner, #_evidon-barrier-wrapper #_evidon-banner", "any");
    }
    async optOut() {
      if (await this.click("#_evidon-decline-button, #_evidon-barrier-declinebutton, #_evidon_banner #RejectLink")) {
        return true;
      }
      hideElements(getStyleElement(), "#evidon-prefdiag-overlay,#evidon-prefdiag-background,#_evidon-background");
      await this.waitForThenClick("#_evidon-option-button");
      await this.waitForElement("#evidon-prefdiag-overlay", 5e3);
      await this.wait(500);
      await this.waitForThenClick("#evidon-prefdiag-decline");
      return true;
    }
    async optIn() {
      return await this.click("#_evidon-accept-button, #_evidon-banner-acceptbutton");
    }
  };

  // lib/cmps/onetrust.ts
  var Onetrust = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Onetrust";
      this.prehideSelectors = ["#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,.js-consent-banner"];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    // Some sites pre-render the banner before the SDK loads, and clicks before then may be lost.
    // Sites that copy the markup without the SDK never get #onetrust-style, so only wait when the page loads the SDK.
    async waitForSdk() {
      if (this.elementExists("#onetrust-style")) {
        return;
      }
      const sdkRef = /cookielaw\.org|otSDKStub|otBannerSdk/;
      const sdkExpected = Array.from(document.scripts).some((s) => sdkRef.test(s.src) || !s.src && sdkRef.test(s.textContent || ""));
      if (sdkExpected) {
        await this.waitForElement("#onetrust-style", 1e4);
      }
    }
    async detectCmp() {
      return this.elementExists("#onetrust-banner-sdk") || this.elementVisible("#onetrust-pc-sdk", "any");
    }
    async detectPopup() {
      return this.elementVisible("#onetrust-banner-sdk,#onetrust-pc-sdk", "any");
    }
    async optOut() {
      await this.wait(500);
      await this.waitForSdk();
      if (this.elementVisible("#onetrust-reject-all-handler", "any")) {
        return await this.click("#onetrust-reject-all-handler");
      }
      if (this.elementVisible(".ot-pc-refuse-all-handler", "any")) {
        return await this.click(".ot-pc-refuse-all-handler");
      }
      if (this.elementVisible(".js-reject-cookies", "any")) {
        return await this.click(".js-reject-cookies");
      }
      if (this.elementVisible(".onetrust-close-btn-handler", "any")) {
        const closeBtn = document.querySelector(".onetrust-close-btn-handler");
        const btnText = closeBtn?.textContent?.toLowerCase() || "";
        const rejectPatterns = ["without", "ohne", "sans", "sin ", "zonder", "senza", "refuse", "decline", "reject", "ablehnen"];
        if (rejectPatterns.some((pattern) => btnText.includes(pattern))) {
          return await this.click(".onetrust-close-btn-handler");
        }
        const banner = document.getElementById("onetrust-banner-sdk");
        const isCloseOnlyNotice = banner?.classList.contains("ot-close-btn-link") && !this.elementExists(
          "#onetrust-accept-btn-handler,#onetrust-reject-all-handler,#onetrust-pc-btn-handler,.ot-sdk-show-settings,button.js-cookie-settings"
        );
        if (isCloseOnlyNotice) {
          return await this.click(".onetrust-close-btn-handler");
        }
      }
      if (this.elementExists("#onetrust-pc-btn-handler")) {
        await this.click("#onetrust-pc-btn-handler");
      } else {
        await this.click(".ot-sdk-show-settings,button.js-cookie-settings");
      }
      await this.waitForElement("#onetrust-consent-sdk", 2e3);
      await this.wait(1e3);
      await this.click("#onetrust-consent-sdk input.category-switch-handler:checked,.js-editor-toggle-state:checked", true);
      await this.wait(1e3);
      await this.waitForElement(".save-preference-btn-handler,.js-consent-save", 2e3);
      await this.click(".save-preference-btn-handler,.js-consent-save");
      await this.waitForVisible("#onetrust-banner-sdk", 5e3, "none");
      return true;
    }
    async optIn() {
      await this.waitForSdk();
      return await this.click("#onetrust-accept-btn-handler,#accept-recommended-btn-handler,.js-accept-cookies");
    }
    async test() {
      return await waitFor(() => this.mainWorldEval("EVAL_ONETRUST_1"), 10, 500);
    }
  };

  // lib/cmps/klaro.ts
  var Klaro = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Klaro";
      this.prehideSelectors = [".klaro"];
      this.settingsOpen = false;
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      if (this.elementExists(".klaro > .cookie-modal")) {
        this.settingsOpen = true;
        return true;
      }
      return this.elementExists(".klaro > .cookie-notice");
    }
    async detectPopup() {
      return this.elementVisible(".klaro > .cookie-notice,.klaro > .cookie-modal", "any");
    }
    async optOut() {
      const apiOptOutSuccess = await this.mainWorldEval("EVAL_KLARO_TRY_API_OPT_OUT");
      if (apiOptOutSuccess) {
        return true;
      }
      if (await this.click(".klaro .cn-decline")) {
        return true;
      }
      await this.mainWorldEval("EVAL_KLARO_OPEN_POPUP");
      if (await this.click(".klaro .cn-decline")) {
        return true;
      }
      await this.click(
        ".cm-purpose:not(.cm-toggle-all) > input:not(.half-checked,.required,.only-required),.cm-purpose:not(.cm-toggle-all) > div > input:not(.half-checked,.required,.only-required)",
        true
      );
      return await this.click(".cm-btn-accept,.cm-button");
    }
    async optIn() {
      if (await this.click(".klaro .cm-btn-accept-all")) {
        return true;
      }
      if (this.settingsOpen) {
        await this.click(".cm-purpose:not(.cm-toggle-all) > input.half-checked", true);
        return await this.click(".cm-btn-accept");
      }
      return await this.click(".klaro .cookie-notice .cm-btn-success");
    }
    async test() {
      return await this.mainWorldEval("EVAL_KLARO_1");
    }
  };

  // lib/cmps/uniconsent.ts
  var POPUP_SELECTOR = ".unic .unic-box,.unic .unic-bar,.unic .unic-modal";
  var SHADOW_HOST = "#uniccmp";
  var Uniconsent = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Uniconsent";
    }
    get prehideSelectors() {
      return [".unic", ".modal:has(.unic)", SHADOW_HOST];
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    // Newer versions render the popup inside an open shadow root on #uniccmp
    sel(selector) {
      return document.querySelector(SHADOW_HOST)?.shadowRoot ? [SHADOW_HOST, selector] : selector;
    }
    get root() {
      return document.querySelector(SHADOW_HOST)?.shadowRoot || document;
    }
    async detectCmp() {
      return this.elementExists(this.sel(POPUP_SELECTOR));
    }
    async detectPopup() {
      return this.elementVisible(this.sel(POPUP_SELECTOR), "any");
    }
    async optOut() {
      await this.waitForElement(this.sel(".unic button"), 1e3);
      if (this.elementVisible(this.sel(".unic .unic-reject-all-button"), "any")) {
        return this.rejectAll();
      }
      if (this.elementExists(this.sel(".unic .unic-manage-options-button"))) {
        await this.click(this.sel(".unic .unic-manage-options-button"));
      } else {
        this.root.querySelectorAll(".unic button").forEach((button) => {
          const text = button.textContent || "";
          if (text.includes("Manage Options") || text.includes("Optionen verwalten")) {
            button.click();
          }
        });
      }
      if (await this.waitForElement(this.sel(".unic .unic-reject-all-button"), 1e3)) {
        return this.rejectAll();
      }
      if (await this.waitForElement(this.sel(".unic input[type=checkbox]"), 1e3)) {
        await this.waitForElement(this.sel(".unic button"), 1e3);
        this.root.querySelectorAll(".unic input[type=checkbox]").forEach((c) => {
          if (c.checked) {
            c.click();
          }
        });
        if (this.elementExists(this.sel(".unic .unic-confirm-button"))) {
          await this.click(this.sel(".unic .unic-confirm-button"));
          await this.wait(500);
          return true;
        }
        const buttons = [...this.root.querySelectorAll(".unic button")];
        for (const pattern of [
          "Reject All",
          "Alle ablehnen",
          "Confirm Choices",
          "Save Choices",
          "Auswahl speichern",
          "Auswahl best\xE4tigen"
        ]) {
          const b = buttons.find((button) => (button.textContent || "").includes(pattern));
          if (b) {
            b.click();
            await this.wait(500);
            return true;
          }
        }
      }
      return false;
    }
    async rejectAll() {
      await this.click(this.sel(".unic .unic-reject-all-button"));
      await this.wait(500);
      return true;
    }
    async optIn() {
      if (this.elementExists(this.sel(".unic .unic-agree-all-button"))) {
        return this.click(this.sel(".unic .unic-agree-all-button"));
      }
      return this.waitForThenClick(this.sel(".unic #unic-agree"));
    }
    async test() {
      await this.wait(1e3);
      return this.elementVisible(this.sel(POPUP_SELECTOR), "none");
    }
  };

  // lib/cmps/tiktok.ts
  var Tiktok = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "tiktok.com";
    }
    get hasSelfTest() {
      return true;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    getShadowRoot() {
      const container = document.querySelector("tiktok-cookie-banner");
      if (!container) {
        return null;
      }
      return container.shadowRoot;
    }
    async detectCmp() {
      return this.elementExists("tiktok-cookie-banner");
    }
    async detectPopup() {
      const banner = this.getShadowRoot()?.querySelector(".tiktok-cookie-banner");
      return isElementVisible(banner);
    }
    async optOut() {
      const logsConfig = this.autoconsent.config.logs;
      const declineButton = this.getShadowRoot()?.querySelector(".button-wrapper button:first-child");
      if (declineButton) {
        logsConfig.rulesteps && console.log("[clicking]", declineButton);
        declineButton.click();
        return true;
      } else {
        logsConfig.errors && console.log("no decline button found");
        return false;
      }
    }
    async optIn() {
      const logsConfig = this.autoconsent.config.logs;
      const acceptButton = this.getShadowRoot()?.querySelector(".button-wrapper button:last-child");
      if (acceptButton) {
        logsConfig.rulesteps && console.log("[clicking]", acceptButton);
        acceptButton.click();
        return true;
      } else {
        logsConfig.errors && console.log("no accept button found");
        return false;
      }
    }
    async test() {
      const match = document.cookie.match(/cookie-consent=([^;]+)/);
      if (!match) {
        return false;
      }
      const value = JSON.parse(decodeURIComponent(match[1]));
      return Object.values(value).every((x) => typeof x !== "boolean" || x === false);
    }
  };

  // lib/cmps/admiral.ts
  var Admiral = class extends AutoConsentCMPBase {
    constructor() {
      super(...arguments);
      this.name = "Admiral";
      this.consentCardSelector = "div > div[class*=Card] > div[class*=Frame] > div[class*=Pills] > button[class*=Pills__StyledPill]";
    }
    getVrmNotice() {
      return Array.from(document.querySelectorAll("body > div")).find((element) => {
        const text = element.innerText || "";
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.position === "fixed" && rect.width > 0 && rect.height > 0 && text.includes("Your Privacy") && text.includes("VRM") && text.includes("Admiral");
      });
    }
    isVisibleElement(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    getVrmCloseButton() {
      const notice = this.getVrmNotice();
      const closeButton = notice?.querySelector('button[aria-label="Close"]');
      return closeButton && this.isVisibleElement(closeButton) ? closeButton : null;
    }
    get hasSelfTest() {
      return false;
    }
    get isIntermediate() {
      return false;
    }
    get isCosmetic() {
      return false;
    }
    async detectCmp() {
      return await this.elementExists(this.consentCardSelector) || Boolean(this.getVrmNotice());
    }
    async detectPopup() {
      return await this.elementVisible(this.consentCardSelector, "any") || Boolean(this.getVrmNotice());
    }
    async optOut() {
      const rejectAllSelector = "xpath///button[contains(., 'Afvis alle') or contains(., 'Reject all') or contains(., 'Odbaci sve') or contains(., 'Rechazar todo') or contains(., 'Atmesti visus') or contains(., 'Odm\xEDtnout v\u0161e') or contains(., '\u0391\u03C0\u03CC\u03C1\u03C1\u03B9\u03C8\u03B7 \u03CC\u03BB\u03C9\u03BD') or contains(., 'Rejeitar tudo') or contains(., 'T\xFCm\xFCn\xFC reddet') or contains(., '\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C \u0432\u0441\u0435') or contains(., 'Noraid\u012Bt visu') or contains(., 'Avvisa alla') or contains(., 'Odrzu\u0107 wszystkie') or contains(., 'Alles afwijzen') or contains(., '\u041E\u0442\u0445\u0432\u044A\u0440\u043B\u044F\u043D\u0435 \u043D\u0430 \u0432\u0441\u0438\u0447\u043A\u0438') or contains(., 'Rifiuta tutto') or contains(., 'Zavrni vse') or contains(., 'Az \xF6sszes elutas\xEDt\xE1sa') or contains(., 'Respinge\u021Bi tot') or contains(., 'Alles ablehnen') or contains(., 'Tout rejeter') or contains(., 'Odmietnu\u0165 v\u0161etko') or contains(., 'L\xFCkka k\xF5ik tagasi') or contains(., 'Hylk\xE4\xE4 kaikki')]";
      if (await this.waitForElement(rejectAllSelector, 500)) {
        const rejectButton = this.elementSelector(rejectAllSelector)[0];
        if (rejectButton.disabled) {
          const cardBody = rejectButton.closest("div[class*=CardHeader]")?.parentElement?.querySelector("div[class*=CardBody]");
          if (cardBody) {
            cardBody.scrollTop = cardBody.scrollHeight;
          }
          await waitFor(() => !rejectButton.disabled, 10, 200);
        }
        return await this.click(rejectAllSelector);
      }
      const vrmCloseButton = this.getVrmCloseButton();
      if (vrmCloseButton) {
        return await this.clickElement(vrmCloseButton);
      }
      const purposesButtonSelector = "xpath///button[contains(., 'Zwecke') or contains(., '\u03A3\u03BA\u03BF\u03C0\u03BF\u03AF') or contains(., 'Purposes') or contains(., '\u0426\u0435\u043B\u0438') or contains(., 'Eesm\xE4rgid') or contains(., 'Tikslai') or contains(., 'Svrhe') or contains(., 'Cele') or contains(., '\xDA\u010Dely') or contains(., 'Finalidades') or contains(., 'M\u0113r\u0137i') or contains(., 'Scopuri') or contains(., 'Fines') or contains(., '\xC4ndam\xE5l') or contains(., 'Finalit\xE9s') or contains(., 'Doeleinden') or contains(., 'Tarkoitukset') or contains(., 'Scopi') or contains(., 'Ama\xE7lar') or contains(., 'Nameni') or contains(., 'C\xE9lok') or contains(., 'Form\xE5l')]";
      const saveAndExitSelector = "xpath///button[contains(., 'Spara & avsluta') or contains(., 'Save & exit') or contains(., 'Ulo\u017Eit a ukon\u010Dit') or contains(., 'Enregistrer et quitter') or contains(., 'Speichern & Verlassen') or contains(., 'Tallenna ja poistu') or contains(., 'I\u0161saugoti ir i\u0161eiti') or contains(., 'Opslaan & afsluiten') or contains(., 'Guardar y salir') or contains(., 'Shrani in zapri') or contains(., 'Ulo\u017Ei\u0165 a ukon\u010Di\u0165') or contains(., 'Kaydet ve \xE7\u0131k\u0131\u015F yap') or contains(., '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438 \u0432\u044B\u0439\u0442\u0438') or contains(., 'Salvesta ja v\xE4lju') or contains(., 'Salva ed esci') or contains(., 'Gem & afslut') or contains(., '\u0391\u03C0\u03BF\u03B8\u03AE\u03BA\u03B5\u03C5\u03C3\u03B7 \u03BA\u03B1\u03B9 \u03AD\u03BE\u03BF\u03B4\u03BF\u03C2') or contains(., 'Saglab\u0101t un iziet') or contains(., 'Ment\xE9s \xE9s kil\xE9p\xE9s') or contains(., 'Guardar e sair') or contains(., 'Zapisz & zako\u0144cz') or contains(., 'Salvare \u0219i ie\u0219ire') or contains(., 'Spremi i iza\u0111i') or contains(., '\u0417\u0430\u043F\u0430\u0437\u0432\u0430\u043D\u0435 \u0438 \u0438\u0437\u0445\u043E\u0434')]";
      if (await this.waitForThenClick(purposesButtonSelector) && await this.waitForVisible(saveAndExitSelector)) {
        const popupBody = this.elementSelector(saveAndExitSelector)[0].parentElement?.parentElement;
        const checkboxes = popupBody?.querySelectorAll("input[type=checkbox]:checked");
        checkboxes?.forEach((checkbox) => checkbox.click());
        return await this.click(saveAndExitSelector);
      }
      return false;
    }
    async optIn() {
      return await this.click(
        "xpath///button[contains(., 'Sprejmi vse') or contains(., 'Prihvati sve') or contains(., 'Godk\xE4nn alla') or contains(., 'Prija\u0165 v\u0161etko') or contains(., '\u041F\u0440\u0438\u043D\u044F\u0442\u044C \u0432\u0441\u0435') or contains(., 'Aceptar todo') or contains(., '\u0391\u03C0\u03BF\u03B4\u03BF\u03C7\u03AE \u03CC\u03BB\u03C9\u03BD') or contains(., 'Zaakceptuj wszystkie') or contains(., 'Accetta tutto') or contains(., 'Priimti visus') or contains(., 'Pie\u0146emt visu') or contains(., 'T\xFCm\xFCn\xFC kabul et') or contains(., 'Az \xF6sszes elfogad\xE1sa') or contains(., 'Accept all') or contains(., '\u041F\u0440\u0438\u0435\u043C\u0430\u043D\u0435 \u043D\u0430 \u0432\u0441\u0438\u0447\u043A\u0438') or contains(., 'Accepter alle') or contains(., 'Hyv\xE4ksy kaikki') or contains(., 'Tout accepter') or contains(., 'Alles accepteren') or contains(., 'Aktsepteeri k\xF5ik') or contains(., 'P\u0159ijmout v\u0161e') or contains(., 'Alles akzeptieren') or contains(., 'Aceitar tudo') or contains(., 'Accepta\u021Bi tot')]"
      );
    }
  };

  // lib/cmps/all.ts
  var dynamicCMPs = [TrustArcTop, Cookiebot, SourcePoint, ConsentManager, Evidon, Onetrust, Klaro, Uniconsent, Tiktok, Admiral];

  // lib/dom-actions.ts
  var DEFAULT_CLICK_RETRY_INTERVAL = 300;
  var CLICK_RETRY_POLL_INTERVAL = 50;
  var DomActions = class {
    constructor(autoconsentInstance) {
      this.autoconsentInstance = autoconsentInstance;
    }
    async clickElement(element) {
      if (!element || !(element instanceof HTMLElement)) {
        return false;
      }
      this.autoconsentInstance.config.logs.rulesteps && console.log("[clickElement]", element);
      element.click();
      return true;
    }
    async click(selector, all = false) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[click]", selector, all, elements);
      if (elements.length > 0) {
        if (all) {
          for (const e of elements) {
            e.click();
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } else {
          elements[0].click();
        }
      }
      return elements.length > 0;
    }
    elementExists(selector) {
      const exists = this.elementSelector(selector).length > 0;
      return exists;
    }
    elementVisible(selector, check = "all") {
      const elem = this.elementSelector(selector);
      const results = new Array(elem.length);
      elem.forEach((e, i) => {
        results[i] = isElementVisible(e);
      });
      if (check === "none") {
        return results.every((r) => !r);
      } else if (results.length === 0) {
        return false;
      } else if (check === "any") {
        return results.some((r) => r);
      }
      return results.every((r) => r);
    }
    waitForElement(selector, timeout = 1e4) {
      const interval = 200;
      const times = Math.ceil(timeout / interval);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForElement]", selector);
      return waitFor(() => this.elementSelector(selector).length > 0, times, interval);
    }
    waitForVisible(selector, timeout = 1e4, check = "any") {
      const interval = 200;
      const times = Math.ceil(timeout / interval);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForVisible]", selector);
      return waitFor(() => this.elementVisible(selector, check), times, interval);
    }
    async waitForThenClick(selector, timeout = 1e4, all = false, retries = 0, retryInterval = DEFAULT_CLICK_RETRY_INTERVAL) {
      await this.waitForElement(selector, timeout);
      let clicked = await this.click(selector, all);
      for (let attempt = 0; clicked && attempt < retries; attempt++) {
        const pollTimes = Math.ceil(retryInterval / CLICK_RETRY_POLL_INTERVAL);
        const isGone = await waitFor(() => !this.elementVisible(selector, "any"), pollTimes, CLICK_RETRY_POLL_INTERVAL);
        if (isGone) {
          break;
        }
        this.autoconsentInstance.config.logs.rulesteps && console.log("[waitForThenClick] retrying click", selector);
        clicked = await this.click(selector, all);
      }
      return clicked;
    }
    wait(ms) {
      this.autoconsentInstance.config.logs.rulesteps && this.autoconsentInstance.config.logs.waits && console.log("[wait]", ms);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(true);
        }, ms);
      });
    }
    cookieContains(substring) {
      return document.cookie.includes(substring);
    }
    hide(selector, method) {
      this.autoconsentInstance.config.logs.rulesteps && console.log("[hide]", selector);
      const styleEl = getStyleElement();
      return hideElements(styleEl, selector, method);
    }
    stylesheet(cssRule, stylesheetId) {
      this.autoconsentInstance.config.logs.rulesteps && console.log("[stylesheet]", cssRule, stylesheetId);
      const styleEl = getStyleElement();
      return appendStylesheetRule(styleEl, cssRule, stylesheetId);
    }
    removeClass(selector, className) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[removeClass]", selector, className, elements);
      elements.forEach((el) => el.classList.remove(className));
      return elements.length > 0;
    }
    setStyle(selector, css) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[setStyle]", selector, css, elements);
      elements.forEach((el) => el.style.cssText = css);
      return elements.length > 0;
    }
    addStyle(selector, css) {
      const elements = this.elementSelector(selector);
      this.autoconsentInstance.config.logs.rulesteps && console.log("[addStyle]", selector, css, elements);
      elements.forEach((el) => el.style.cssText += "; " + css);
      return elements.length > 0;
    }
    prehide(selector) {
      const styleEl = getStyleElement("autoconsent-prehide");
      this.autoconsentInstance.config.logs.lifecycle && console.log("[prehide]", styleEl, location.href);
      return hideElements(styleEl, selector, "opacity");
    }
    undoPrehide() {
      const existingElement = getStyleElement("autoconsent-prehide");
      this.autoconsentInstance.config.logs.lifecycle && console.log("[undoprehide]", existingElement, location.href);
      existingElement.remove();
    }
    async createOrUpdateStyleSheet(cssText, styleSheet) {
      if (!styleSheet) {
        styleSheet = new CSSStyleSheet();
      }
      styleSheet = await styleSheet.replace(cssText);
      return styleSheet;
    }
    removeStyleSheet(styleSheet) {
      if (styleSheet) {
        styleSheet.replace("");
        return true;
      }
      return false;
    }
    querySingleReplySelector(selector, parent = document) {
      if (selector.startsWith("aria/")) {
        return [];
      }
      if (selector.startsWith("xpath/")) {
        const xpath = selector.slice(6);
        const result = document.evaluate(xpath, parent, null, XPathResult.ANY_TYPE, null);
        let node;
        const elements = [];
        while (node = result.iterateNext()) {
          elements.push(node);
        }
        return elements;
      }
      if (selector.startsWith("text/")) {
        return [];
      }
      if (selector.startsWith("pierce/")) {
        return [];
      }
      if (parent.shadowRoot) {
        return Array.from(parent.shadowRoot.querySelectorAll(selector));
      }
      if (parent.contentDocument?.querySelectorAll) {
        return Array.from(parent.contentDocument.querySelectorAll(selector));
      }
      return Array.from(parent.querySelectorAll(selector));
    }
    querySelectorChain(selectors) {
      let parent = document;
      let matches = [];
      for (const selector of selectors) {
        matches = this.querySingleReplySelector(selector, parent);
        if (matches.length === 0) {
          return [];
        }
        parent = matches[0];
      }
      return matches;
    }
    elementSelector(selector) {
      if (typeof selector === "string") {
        return this.querySingleReplySelector(selector);
      }
      return this.querySelectorChain(selector);
    }
    waitForMutation(selector, timeout = 6e4) {
      const node = this.elementSelector(selector);
      if (node.length === 0) {
        throw new Error(`${selector} did not match any elements`);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Timed out waiting for mutation"));
          observer.disconnect();
        }, timeout);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          observer.disconnect();
          resolve(true);
        });
        observer.observe(node[0], {
          subtree: true,
          childList: true,
          attributes: true
        });
      });
    }
  };

  // lib/encoding.ts
  var compactedRuleSteps = [
    ["exists", "e"],
    ["visible", "v"],
    ["waitForThenClick", "c"],
    ["click", "k"],
    ["waitFor", "w"],
    ["waitForVisible", "wv"],
    ["hide", "h"],
    ["cookieContains", "cc"]
  ];
  function decodeNullableBoolean(value) {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return void 0;
  }
  function decodeRules(encoded) {
    if (encoded.v > 1) {
      throw new Error("Unsupported rule format.");
    }
    return encoded.r.filter((r) => r[0] <= SUPPORTED_RULE_STEP_VERSION).map((rule) => new CompactedCMPRule(rule, encoded.s));
  }
  var CompactedCMPRule = class {
    constructor(rule, strings) {
      this.intermediate = false;
      this.optIn = [];
      this.r = rule;
      this.s = strings;
      if (this.r[10] && this.r[10].intermediate) {
        this.intermediate = this.r[10].intermediate;
      }
    }
    _decodeRuleStep(step) {
      const clonedStep = { ...step };
      const decodeRuleStep = this._decodeRuleStep.bind(this);
      for (const [longKey, shortKey] of compactedRuleSteps) {
        if (clonedStep[shortKey] !== void 0) {
          clonedStep[longKey] = this.s[clonedStep[shortKey]];
          delete clonedStep[shortKey];
        }
      }
      if (step.if) {
        clonedStep.if = decodeRuleStep(step.if);
        clonedStep.then = step.then && step.then.map(decodeRuleStep);
        if (step.else) {
          clonedStep.else = step.else.map(decodeRuleStep);
        }
      }
      if (step.any) {
        clonedStep.any = step.any.map(decodeRuleStep);
      }
      return { ...clonedStep };
    }
    get minimumRuleStepVersion() {
      return this.r[0];
    }
    get name() {
      return this.r[1];
    }
    get cosmetic() {
      return decodeNullableBoolean(this.r[2]);
    }
    get runContext() {
      const runContext = {};
      const urlPattern = this.r[3];
      const mainFrame = this.r[4];
      const runInMainFrame = decodeNullableBoolean(Math.floor(mainFrame / 10) % 10);
      const runInSubFrame = decodeNullableBoolean(mainFrame % 10);
      if (runInMainFrame !== void 0) {
        runContext.main = runInMainFrame;
      }
      if (runInSubFrame !== void 0) {
        runContext.frame = runInSubFrame;
      }
      if (urlPattern !== "") {
        runContext.urlPattern = urlPattern;
      }
      return runContext;
    }
    get prehideSelectors() {
      return this.r[5].map((i) => this.s[i].toString());
    }
    get detectCmp() {
      return this.r[6].map(this._decodeRuleStep.bind(this));
    }
    get detectPopup() {
      return this.r[7].map(this._decodeRuleStep.bind(this));
    }
    get optOut() {
      return this.r[8].map(this._decodeRuleStep.bind(this));
    }
    get test() {
      return this.r[9].map(this._decodeRuleStep.bind(this));
    }
  };
  function clearUnusedStrings(ruleset, ignoreBeforeIndex = 0) {
    const { v, s, r } = ruleset;
    const usedStringIds = /* @__PURE__ */ new Set();
    function addStringIdsFromRuleSteps(steps) {
      steps.forEach((step) => {
        for (const [, shortKey] of compactedRuleSteps) {
          if (step[shortKey] !== void 0) {
            usedStringIds.add(step[shortKey]);
          }
        }
        if (step.if) {
          addStringIdsFromRuleSteps([step.if]);
        }
        if (step.then) {
          addStringIdsFromRuleSteps(step.then);
        }
        if (step.else) {
          addStringIdsFromRuleSteps(step.else);
        }
        if (step.any) {
          addStringIdsFromRuleSteps(step.any);
        }
      });
    }
    ruleset.r.forEach((rule) => {
      addStringIdsFromRuleSteps(rule[6]);
      addStringIdsFromRuleSteps(rule[7]);
      addStringIdsFromRuleSteps(rule[8]);
      addStringIdsFromRuleSteps(rule[9]);
      rule[5].forEach((id) => usedStringIds.add(id));
    });
    return {
      v,
      r,
      s: s.slice(0, Math.max(...usedStringIds) + 1).map((str, idx) => {
        if (idx < ignoreBeforeIndex || usedStringIds.has(idx)) {
          return str;
        }
        return "";
      })
    };
  }
  function shouldRunRuleInContext(rule, mainFrame, url) {
    const runContext = rule[4];
    if (mainFrame && runContext === 1) {
      return false;
    }
    if (!mainFrame && [20, 22, 10, 12].includes(runContext)) {
      return false;
    }
    const urlPattern = rule[3];
    if (urlPattern && urlPattern !== "" && url.match(urlPattern) === null) {
      return false;
    }
    return true;
  }
  function filterCompactRules(rules, context) {
    const { v, s, r, index: index2 } = rules;
    const { url, mainFrame } = context;
    const shouldRunInContext = (rule) => shouldRunRuleInContext(rule, mainFrame, url);
    if (!mainFrame) {
      const ruleset = {
        v,
        s: s.slice(0, index2.frameStringEnd),
        r: r.slice(index2.frameRuleRange[0], index2.frameRuleRange[1]).filter(shouldRunInContext)
      };
      return clearUnusedStrings(ruleset);
    }
    const genericRules = r.slice(index2.genericRuleRange[0], index2.genericRuleRange[1]);
    const specificRules = r.slice(index2.specificRuleRange[0], index2.specificRuleRange[1]).filter(shouldRunInContext);
    if (specificRules.length > 0) {
      const ruleset = {
        v,
        s,
        r: [...genericRules, ...specificRules]
      };
      return clearUnusedStrings(ruleset);
    }
    return {
      v,
      s: s.slice(0, index2.genericStringEnd),
      r: genericRules
    };
  }

  // lib/web.ts
  function filterCMPs(rules, config) {
    return rules.filter((cmp) => {
      return (!config.disabledCmps || !config.disabledCmps.includes(cmp.name)) && // CMP is not disabled
      (config.enableCosmeticRules || !cmp.isCosmetic) && // CMP is not cosmetic or cosmetic rules are enabled
      (config.enableGeneratedRules || !cmp.name.startsWith("auto_"));
    });
  }
  var _config;
  var AutoConsent = class {
    constructor(sendContentMessage, config = null, declarativeRules = null) {
      this.id = getRandomID();
      this.rules = [];
      __privateAdd(this, _config);
      this.state = {
        lifecycle: "loading",
        prehideOn: false,
        findCmpAttempts: 0,
        detectedCmps: [],
        detectedPopups: [],
        heuristicPatterns: [],
        heuristicSnippets: [],
        selfTest: null,
        clicks: 0,
        startTime: 0,
        endTime: 0
      };
      evalState.sendContentMessage = sendContentMessage;
      this.sendContentMessage = sendContentMessage;
      this.rules = [];
      this.updateState({ lifecycle: "loading" });
      this.addDynamicRules();
      if (config) {
        this.initialize(config, declarativeRules);
      } else {
        if (declarativeRules) {
          this.parseDeclarativeRules(declarativeRules);
        }
        const initMsg = {
          type: "init",
          url: window.location.href
        };
        sendContentMessage(initMsg);
        this.updateState({ lifecycle: "waitingForInitResponse" });
      }
      this.domActions = new DomActions(this);
    }
    get config() {
      if (!__privateGet(this, _config)) {
        throw new Error("AutoConsent is not initialized yet");
      }
      return __privateGet(this, _config);
    }
    initialize(config, declarativeRules) {
      const normalizedConfig = normalizeConfig(config);
      normalizedConfig.logs.lifecycle && console.log("autoconsent init", window.location.href);
      __privateSet(this, _config, normalizedConfig);
      if (!normalizedConfig.enabled) {
        normalizedConfig.logs.lifecycle && console.log("autoconsent is disabled");
        return;
      }
      if (declarativeRules) {
        this.parseDeclarativeRules(declarativeRules);
      }
      this.rules = filterCMPs(this.rules, normalizedConfig);
      if (this.shouldPrehide) {
        if (document.documentElement) {
          this.prehideElements();
        } else {
          const delayedPrehide = () => {
            window.removeEventListener("DOMContentLoaded", delayedPrehide);
            this.prehideElements();
          };
          window.addEventListener("DOMContentLoaded", delayedPrehide);
        }
      }
      if (document.readyState === "loading") {
        const onReady = () => {
          window.removeEventListener("DOMContentLoaded", onReady);
          this.start();
        };
        window.addEventListener("DOMContentLoaded", onReady);
      } else {
        this.start();
      }
      this.updateState({ lifecycle: "initialized" });
    }
    get shouldPrehide() {
      return this.config.enablePrehide && !this.config.visualTest;
    }
    saveFocus() {
      this.focusedElement = document.activeElement;
      if (this.focusedElement) {
        this.config.logs.lifecycle && console.log("saving focus", this.focusedElement, location.href);
      }
    }
    restoreFocus() {
      if (this.focusedElement) {
        this.config.logs.lifecycle && console.log("restoring focus", this.focusedElement, location.href);
        try {
          this.focusedElement.focus({ preventScroll: true });
        } catch (e) {
          this.config.logs.errors && console.warn("error restoring focus", e);
        }
        this.focusedElement = void 0;
      }
    }
    addDynamicRules() {
      dynamicCMPs.forEach((Cmp) => {
        this.rules.push(new Cmp(this));
      });
    }
    parseDeclarativeRules(declarativeRules) {
      const perfEnabled = __privateGet(this, _config)?.performanceLoggingEnabled;
      perfEnabled && performance.mark("parseDeclarativeRulesStart");
      if (declarativeRules.autoconsent) {
        declarativeRules.autoconsent.forEach((ruleset) => {
          this.addDeclarativeCMP(ruleset);
        });
      }
      if (declarativeRules.compact) {
        try {
          const rules = decodeRules(declarativeRules.compact);
          rules.forEach(this.addDeclarativeCMP.bind(this));
        } catch (e) {
          __privateGet(this, _config)?.logs.errors && console.error(e);
        }
      }
      perfEnabled && performance.mark("parseDeclarativeRulesEnd");
      perfEnabled && performance.measure("parseDeclarativeRules", "parseDeclarativeRulesStart", "parseDeclarativeRulesEnd");
    }
    addDeclarativeCMP(ruleset) {
      if ((ruleset.minimumRuleStepVersion || 1) <= SUPPORTED_RULE_STEP_VERSION) {
        this.rules.push(new AutoConsentCMP(ruleset, this));
      }
    }
    // start the detection process, possibly with a delay
    start() {
      scheduleWhenIdle(() => this._start());
    }
    async _start() {
      const logsConfig = this.config.logs;
      logsConfig.lifecycle && console.log(`Detecting CMPs on ${window.location.href}`);
      this.updateState({ lifecycle: "started" });
      const foundCmps = await this.findCmp(this.config.detectRetries);
      this.updateState({ detectedCmps: foundCmps.map((c) => c.name) });
      if (this.config.performanceLoggingEnabled) {
        this.updateState({ performance: this.measurePerformance() });
      }
      if (foundCmps.length === 0) {
        logsConfig.lifecycle && console.log("no CMP found", location.href);
        if (this.shouldPrehide) {
          this.undoPrehide();
        }
        this.updateState({ lifecycle: "nothingDetected" });
        return false;
      }
      this.updateState({ lifecycle: "cmpDetected" });
      const staticCmps = [];
      const cosmeticCmps = [];
      for (const cmp of foundCmps) {
        if (cmp.isCosmetic) {
          cosmeticCmps.push(cmp);
        } else {
          staticCmps.push(cmp);
        }
      }
      let result = false;
      let foundPopups = await this.detectPopups(staticCmps, async (cmp) => {
        result = await this.handlePopup(cmp);
      });
      if (foundPopups.length === 0) {
        foundPopups = await this.detectPopups(cosmeticCmps, async (cmp) => {
          result = await this.handlePopup(cmp);
        });
      }
      if (foundPopups.length === 0) {
        logsConfig.lifecycle && console.log("no popup found");
        if (this.shouldPrehide) {
          this.undoPrehide();
        }
        return false;
      }
      if (foundPopups.length > 1) {
        const errorDetails = {
          msg: `Found multiple CMPs, check the detection rules.`,
          cmps: foundPopups.map((cmp) => cmp.name)
        };
        logsConfig.errors && console.warn(errorDetails.msg, errorDetails.cmps);
        this.sendContentMessage({
          type: "autoconsentError",
          details: errorDetails
        });
      }
      return result;
    }
    async findCmp(retries) {
      const logsConfig = this.config.logs;
      this.updateState({ findCmpAttempts: this.state.findCmpAttempts + 1 });
      const foundCMPs = [];
      const isTop = isTopFrame();
      const siteSpecificRules = [];
      const genericRules = [];
      this.rules.forEach((cmp) => {
        if (cmp.checkFrameContext(isTop)) {
          const isSiteSpecific = !!cmp.runContext.urlPattern;
          if (cmp.hasMatchingUrlPattern()) {
            siteSpecificRules.push(cmp);
          } else if (!isSiteSpecific) {
            genericRules.push(cmp);
          }
        }
      });
      const heuristicEnabled = isTop && this.config.heuristicMode !== "off";
      const heuristicRules = heuristicEnabled && this.state.findCmpAttempts % 2 === 0 ? [new AutoConsentHeuristicCMP(this, this.config.heuristicMode)] : [];
      const rulesPriorityStages = [
        ["site-specific", siteSpecificRules],
        ["generic", genericRules],
        ["heuristic", heuristicRules]
      ];
      const runDetectCmp = async (cmp) => {
        try {
          const result = await cmp.detectCmp();
          if (result) {
            logsConfig.lifecycle && console.log(`Found CMP: ${cmp.name} ${window.location.href}`);
            this.sendContentMessage({
              type: "cmpDetected",
              url: location.href,
              cmp: cmp.name
            });
            foundCMPs.push(cmp);
          }
        } catch (e) {
          logsConfig.errors && console.warn(`error detecting ${cmp.name}`, e);
        }
      };
      const mutationObserver = this.domActions.waitForMutation("html");
      mutationObserver.catch(() => {
      });
      for (const [stageName, ruleGroup] of rulesPriorityStages) {
        logsConfig.lifecycle && ruleGroup.length > 0 && console.log(
          `Trying ${stageName} rules`,
          ruleGroup.map((r) => r.name)
        );
        this.config.performanceLoggingEnabled && performance.mark(`findCmpStage_${stageName}`);
        await Promise.all(ruleGroup.map(runDetectCmp));
        this.config.performanceLoggingEnabled && performance.mark(`findCmpStageEnd_${stageName}`);
        this.config.performanceLoggingEnabled && performance.measure(`findCmp_${stageName}`, `findCmpStage_${stageName}`, `findCmpStageEnd_${stageName}`);
        if (foundCMPs.length > 0) {
          break;
        }
      }
      this.detectHeuristics();
      if (foundCMPs.length === 0 && retries > 0) {
        const waitFor2 = [this.domActions.wait(500)];
        const heuristicSkipped = heuristicEnabled && heuristicRules.length === 0;
        if (this.state.findCmpAttempts > 1 && !heuristicSkipped) {
          waitFor2.push(mutationObserver);
        }
        try {
          await Promise.all(waitFor2);
        } catch (e) {
          return [];
        }
        return this.findCmp(retries - 1);
      }
      return foundCMPs;
    }
    detectHeuristics() {
      if (this.config.enableHeuristicDetection) {
        this.config.performanceLoggingEnabled && performance.mark("detectHeuristicsStart");
        const { patterns, snippets: snippets2 } = checkHeuristicPatterns(document.documentElement?.innerText || "", "page");
        if (patterns.length > 0 && (patterns.length !== this.state.heuristicPatterns.length || this.state.heuristicPatterns.some((p, i) => p !== patterns[i]))) {
          this.config.logs.lifecycle && console.log("Heuristic patterns found", patterns, snippets2);
          this.updateState({ heuristicPatterns: patterns, heuristicSnippets: snippets2 });
        }
        this.config.performanceLoggingEnabled && performance.mark("detectHeuristicsEnd");
        this.config.performanceLoggingEnabled && performance.measure("detectHeuristics", "detectHeuristicsStart", "detectHeuristicsEnd");
      }
    }
    /**
     * Detect if a CMP has a popup open. Fullfils with the CMP if a popup is open, otherwise rejects.
     */
    async detectPopup(cmp) {
      const isOpen = await this.waitForPopup(cmp).catch((error) => {
        this.config.logs.errors && console.warn(`error waiting for a popup for ${cmp.name}`, error);
        return false;
      });
      if (isOpen) {
        this.updateState({ detectedPopups: this.state.detectedPopups.concat([cmp.name]) });
        this.sendContentMessage({
          type: "popupFound",
          cmp: cmp.name,
          url: location.href
        });
        return cmp;
      }
      throw new Error("Popup is not shown");
    }
    /**
     * Detect if any of the CMPs has a popup open. Returns a list of CMPs with open popups.
     */
    async detectPopups(cmps, onFirstPopupAppears) {
      const tasks = cmps.map((cmp) => this.detectPopup(cmp));
      await Promise.any(tasks).then((cmp) => {
        this.detectHeuristics();
        onFirstPopupAppears(cmp);
      }).catch(() => {
      });
      const results = await Promise.allSettled(tasks);
      const popups = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          popups.push(result.value);
        }
      }
      return popups;
    }
    async handlePopup(cmp) {
      this.updateState({ lifecycle: "openPopupDetected", startTime: Date.now() });
      if (this.shouldPrehide && !this.state.prehideOn) {
        this.prehideElements();
      }
      this.foundCmp = cmp;
      if (this.config.autoAction === "optOut") {
        return await this.doOptOut();
      } else if (this.config.autoAction === "optIn") {
        return await this.doOptIn();
      } else {
        this.config.logs.lifecycle && console.log("waiting for opt-out signal...", location.href);
        return true;
      }
    }
    async doOptOut() {
      const logsConfig = this.config.logs;
      this.updateState({ lifecycle: "runningOptOut" });
      this.saveFocus();
      let optOutResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to opt out");
        optOutResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: opt out on ${window.location.href}`);
        optOutResult = await this.foundCmp.optOut();
        logsConfig.lifecycle && console.log(`${this.foundCmp.name}: opt out result ${optOutResult}`);
      }
      if (this.shouldPrehide) {
        this.undoPrehide();
      }
      this.sendContentMessage({
        type: "optOutResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: optOutResult,
        scheduleSelfTest: Boolean(this.foundCmp && this.foundCmp.hasSelfTest),
        url: location.href
      });
      if (optOutResult && this.foundCmp && !this.foundCmp.isIntermediate) {
        this.state.endTime = Date.now();
        logsConfig.lifecycle && console.log(
          `${this.foundCmp.name}: done in ${this.state.endTime - this.state.startTime}ms with ${this.state.clicks} clicks`
        );
        this.sendContentMessage({
          type: "autoconsentDone",
          cmp: this.foundCmp?.name,
          isCosmetic: this.foundCmp?.isCosmetic,
          url: location.href,
          duration: this.state.endTime - this.state.startTime,
          totalClicks: this.state.clicks
        });
        this.updateState({ lifecycle: "done" });
      } else {
        this.updateState({ lifecycle: optOutResult ? "optOutSucceeded" : "optOutFailed" });
      }
      this.restoreFocus();
      return optOutResult;
    }
    async doOptIn() {
      const logsConfig = this.config.logs;
      this.updateState({ lifecycle: "runningOptIn" });
      this.saveFocus();
      let optInResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to opt in");
        optInResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: opt in on ${window.location.href}`);
        optInResult = await this.foundCmp.optIn();
        logsConfig.lifecycle && console.log(`${this.foundCmp.name}: opt in result ${optInResult}`);
      }
      if (this.shouldPrehide) {
        this.undoPrehide();
      }
      this.sendContentMessage({
        type: "optInResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: optInResult,
        scheduleSelfTest: false,
        // self-tests are only for opt-out at the moment
        url: location.href
      });
      if (optInResult && this.foundCmp && !this.foundCmp.isIntermediate) {
        this.state.endTime = Date.now();
        logsConfig.lifecycle && console.log(
          `${this.foundCmp.name}: done in ${this.state.endTime - this.state.startTime}ms with ${this.state.clicks} clicks`
        );
        this.sendContentMessage({
          type: "autoconsentDone",
          cmp: this.foundCmp.name,
          isCosmetic: this.foundCmp.isCosmetic,
          url: location.href,
          duration: this.state.endTime - this.state.startTime,
          totalClicks: this.state.clicks
        });
        this.updateState({ lifecycle: "done" });
      } else {
        this.updateState({ lifecycle: optInResult ? "optInSucceeded" : "optInFailed" });
      }
      this.restoreFocus();
      return optInResult;
    }
    async doSelfTest() {
      const logsConfig = this.config.logs;
      let selfTestResult;
      if (!this.foundCmp) {
        logsConfig.errors && console.log("no CMP to self test");
        selfTestResult = false;
      } else {
        logsConfig.lifecycle && console.log(`CMP ${this.foundCmp.name}: self-test on ${window.location.href}`);
        selfTestResult = await this.foundCmp.test();
      }
      this.sendContentMessage({
        type: "selfTestResult",
        cmp: this.foundCmp ? this.foundCmp.name : "none",
        result: selfTestResult,
        url: location.href
      });
      this.updateState({ selfTest: selfTestResult });
      return selfTestResult;
    }
    async waitForPopup(cmp, retries = 10, interval = 500) {
      const logsConfig = this.config.logs;
      logsConfig.lifecycle && console.log("checking if popup is open...", cmp.name);
      let mutationObserver = null;
      if (this.config.enablePopupMutationObserver) {
        mutationObserver = this.domActions.waitForMutation("html", 1e4);
        mutationObserver.catch(() => {
        });
      }
      const isOpen = await cmp.detectPopup().catch((e) => {
        logsConfig.errors && console.warn(`error detecting popup for ${cmp.name}`, e);
        return false;
      });
      if (!isOpen && retries > 0) {
        if (mutationObserver) {
          try {
            await Promise.all([this.domActions.wait(interval), mutationObserver]);
          } catch (e) {
            logsConfig.lifecycle && console.log(cmp.name, "popup detection timed out waiting for DOM mutation");
          }
        } else {
          await this.domActions.wait(interval);
        }
        return this.waitForPopup(cmp, retries - 1, interval);
      }
      logsConfig.lifecycle && console.log(cmp.name, `popup is ${isOpen ? "open" : "not open"}`);
      return isOpen;
    }
    prehideElements() {
      const logsConfig = this.config.logs;
      const globalHidden = [
        "#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium"
      ];
      const selectors = this.rules.filter((rule) => rule.prehideSelectors && rule.checkRunContext()).reduce((selectorList, rule) => [...selectorList || [], ...rule.prehideSelectors || []], globalHidden);
      this.updateState({ prehideOn: true });
      setTimeout(() => {
        if (this.shouldPrehide && this.state.prehideOn && !["runningOptOut", "runningOptIn"].includes(this.state.lifecycle)) {
          logsConfig.lifecycle && console.log("Process is taking too long, unhiding elements");
          this.undoPrehide();
        }
      }, this.config.prehideTimeout || 2e3);
      return this.domActions.prehide(selectors.join(","));
    }
    undoPrehide() {
      this.updateState({ prehideOn: false });
      this.domActions.undoPrehide();
    }
    updateState(change) {
      Object.assign(this.state, change);
      this.sendContentMessage({
        type: "report",
        instanceId: this.id,
        url: window.location.href,
        mainFrame: isTopFrame(),
        state: this.state
      });
    }
    async receiveMessageCallback(message) {
      const logsConfig = __privateGet(this, _config)?.logs;
      if (logsConfig?.messages) {
        console.log("received from background", message, window.location.href);
      }
      switch (message.type) {
        case "initResp":
          this.initialize(message.config, message.rules);
          break;
        case "optIn":
          await this.doOptIn();
          break;
        case "optOut":
          await this.doOptOut();
          break;
        case "selfTest":
          await this.doSelfTest();
          break;
        case "evalResp":
          resolveEval(message.id, message.result);
          break;
        case "measurePerformance":
          this.updateState({ performance: this.measurePerformance() });
          break;
      }
    }
    measurePerformance() {
      const getRoundedPerformanceEntries = (name) => performance.getEntriesByName(name).map((m) => Number(m.duration.toFixed(3)));
      return {
        detectHeuristics: getRoundedPerformanceEntries("detectHeuristics"),
        heuristicDetector: getRoundedPerformanceEntries("heuristicDetector"),
        findCmpSiteSpecific: getRoundedPerformanceEntries("findCmp_site-specific"),
        findCmpGeneric: getRoundedPerformanceEntries("findCmp_generic"),
        findCmpHeuristic: getRoundedPerformanceEntries("findCmp_heuristic"),
        parseDeclarativeRules: getRoundedPerformanceEntries("parseDeclarativeRules")
      };
    }
  };
  _config = new WeakMap();

  // rules/compact-rules.json
  var compact_rules_default = { v: 1, s: [".c-simple-popup:has(.c-cookie-popup)", ".c-cookie-popup [data-role=refuse-cookies]", ".c-cookie-popup", '#cookie_box:has(a[href="https://1fichier.com/cgu.html"])', '#cookie_box a[href="https://1fichier.com/cgu.html"] ~ a.cookie_box_close', "#cookie_box", 'div:has(> div > a[href*="law.2gis."][href*="/privacy/cookie"])', 'div:has(> div > a[href*="law.2gis."][href*="/privacy/cookie"]) > div:last-child', "dialog.cookie-consent", "dialog.cookie-consent form.cookie-consent__form", "dialog.cookie-consent form.cookie-consent__form button[value=no]", "dialog.cookie-consent form.cookie-consent__form button.cookie-consent__options-toggle", 'dialog.cookie-consent form.cookie-consent__form button[value="save_options"]', "#abe-gdpr-banner #gdpr-banner-component", "#abe-gdpr-banner #gdpr-banner-component-decline-btn", "#gdpr-banner-component", "#gdpr-banner-component-decline-btn", "abeconsent=%221%3A1%2C2%3A0%2C3%3A0%2C4%3A0%22", 'div[id$="_cookie_box"]:has(a[onclick^="accept_"][onclick*="_cookie_box()"])', 'div[id$="_cookie_box"] a[onclick^="accept_"][onclick*="_cookie_box()"]', "#acceptricsCookieBanner", "#acceptricsRejectAllBtn", "#acconsento-click .acconsento-click-overlay-dialog", "#acconsento-click .acconsento-click-consent-banner", "#acconsento-click-button-necessary-only [role=button]", "#acconsento-click .acconsento-click-consent-banner .el-acconsento-dialog__headerbtn", "acconsento-clicked=1", "tracking%3D0%26marketing%3D0", '.bc-content-modal:has([class*="_cookieFooter_"])', '.bc-content-modal [class*="_cookieFooter_"]', '.bc-content-modal [class*="_cookieFooter_"] button:first-child', "%222%22%3Afalse", "div.acris-cookie-consent", "[data-acris-cookie-consent]", ".acris-cookie-consent.is--modal", "#ccAcceptOnlyFunctional", ".bg-modal:has(.preferences-modal)", ".bg-modal .preferences-modal .content button.btn-ghost.is-neutral", ".bg-modal .preferences-modal", ".preferences-modal .content button.btn-ghost.is-neutral", "cookie_consent_v2_0_marketing_third_party=0", "#__cmp_overlay", "#__cmp_body", "#__cmp_body .cmpButtonLink", "#__cmp_body .cmpLayer", "#__cmp_body .cmpLayer .vue-js-switch", "#__cmp_body .vue-js-switch.toggled .v-switch-input", "#__cmp_body .manageLink:not(.buttonDisabled)", "#__cmp_body .manageLink", "#__cmp_body .rejectLink", ".adn-window.adn-message", ".adn-window.adn-message .adn-footer button[onclick*='saveAll(false)']", "#cookie-banner", "#adopt-controller-button", "#adopt-reject-all-button", "#adroll_consent_container", "#adroll_consent_reject", "__adroll_fpc", "adstate-settings-component", ".cookie-consent-modal", ".cookie-consent-modal [data-cy=cookie-consent-accept-all-button]", ".cookie-consent-modal [data-cy=cookie-consent-reject-button]", ".cookie-consent-modal [data-cy=cookie-consent-manage-settings]", ".cookie-consent-modal [data-cy=cookie-consent-manage-settingsFR]", ".cookie-consent-modal [data-cy=cookie-consent-accept-selected-button]", ".cookie-consent-modal .cookie-selection.--full input[type=checkbox]:checked:not(:disabled)", "cookie_consent=00", "cookie_consent=10", ".alertaModal .msg.cookies", ".alertaModal .msg.cookies #rechazaCookies", "aceptaCookies=false", '.alert-bar[data-alert-api$="api/alertnotification"]:is(.alert-bar--notification, .alert-bar--cookie-message, #alert-COOKIES)', "#cookieConsent #cookiesButtomCustomize", "#cookieCustomizeWrap", "#cookieAnalyticsChk:checked", "#cookieAnalyticsChk", "#cookieConsent #cookiesButtomAccept[data-mode='custom']", "Analytics=no", ".cookies-info:has(.js-cookies-info-reject, .js-cookie-reject-all)", ".cookies-info .js-cookies-info-reject, .cookies-info .js-cookie-reject-all", ".amgdprcookie-bar-container", '.amgdprcookie-bar-container [data-amgdprcookie-js="accept"]:not([disabled])', '.amgdprcookie-bar-container [data-amgdprcookie-js="decline"]', '.amgdprcookie-bar-container [data-amgdprcookie-js="decline"]:not([disabled])', '.amgdprcookie-bar-container [data-amgdprcookie-js="settings"], .amgdprcookie-bar-container [data-amgdprcookie-js="custom_settings"]', ".amgdprcookie-settings-form", ".amgdprcookie-settings-form input.amgdprcookie-input:checked:not([disabled])", ".amgdprcookie-settings-form .amgdprcookie-done", '#am-cookie-bar [x-ref="am-cookie-bar"]', '#am-cookie-bar > [x-bind^="overlay"], #am-cookie-bar [data-dialog-ref-name="am-cookie-bar"]', '#am-cookie-bar[style*="translateY(100%)"]', '[x-ref="am-cookie-bar-settings"] :is([x-ref="ambar-settings-done"], button[\\@click*="cookiebar-action-accept"])', '#am-cookie-bar [x-ref="am-cookie-bar"] :is([data-dispatch-action="cookiebar-action-accept"]:not(.ambar-upgraded-btn-allow), .ambar-btn-decline, a[\\@click*="cookiebar-action-accept"])', '#am-cookie-bar [x-ref="am-cookie-bar"] .ambar-upgraded-btn-allow', '#am-cookie-bar [x-ref="am-cookie-bar"] .ambar-btn-settings', '#am-cookie-bar [x-ref="am-cookie-bar"] input.ambar-input-toggle:checked:not([disabled])', '#am-cookie-bar [x-ref="am-cookie-bar"] :is([data-dispatch-action="cookiebar-action-settings"], .ambar-btn-settings)', '[x-ref="am-cookie-bar-settings"] input[type="checkbox"]', '[x-ref="am-cookie-bar-settings"] input[type="checkbox"]:checked:not([disabled])', '#am-cookie-bar [x-ref="am-cookie-bar"] :is(button[\\@click="closeCookieBarHandler"], button[\\@click*="close-cookie-bar"])', ".amgdprcookie-modal-container #amgdprcookie-form-sidebar", ".amgdprcookie-modal-container._show", '.amgdprcookie-modal-container._show [data-amgdprcookie-js="decline"]', '.amgdprcookie-modal-container._show [data-amgdprcookie-js="decline"]:not([disabled])', ".amgdprcookie-modal-container._show input.amgdprcookie-input:checked:not([disabled])", '.amgdprcookie-modal-container._show [data-amgdprcookie-js="accept"]:not([disabled])', '[data-test-id="consentModal"] [data-test-id="consentBtn"]', '[data-test-id="consentModal"] button[aria-label="Continue without accepting cookies"]', '[data-test-id="consentModal"] button[aria-label="Close cookie consent card popup"]', '[data-test-id="consentModal"]', '#sp-cc-wrapper,[data-action=sp-cc],span[data-action="sp-cc"][data-sp-cc*="rejectAllAction"]', '#sp-cc-wrapper *,[data-action=sp-cc],span[data-action="sp-cc"][data-sp-cc*="rejectAllAction"]', "#sp-cc-rejectall-link", "#user-consent-management-granular-banner-overlay", "[data-testid=granular-banner-button-decline-all]", "#cookie_bar_container", "#cookie_bar_container #cookie_bar_agree_button", "#cookie_preferences_link", "#cookie_preferences_dialogue", "#cookie_preferences input[name=cookie_preference]:checked:not(:disabled)", "#save_preferences_button", "cookie_preferences_analytics=false", "cookie_preferences_marketing=false", "#BannerRegion > #Banner_consent_0", "#BannerRegion > #bannerOverlay", "#BannerRegion > #Banner_consent_0 #rejectAllBtn", ".ec-gtm-cookie-directive", ".ec-gtm-cookie-directive a.decline", ".ec-gtm-cookie-directive input[name='cookie[]']", ".ec-gtm-cookie-directive input[name='cookie[]']:checked", ".ec-gtm-cookie-directive a.accept", "cookieConsentGranted=", "cookieConsentMarketingGranted=1", "[data-testid='consent-banner']:has(a[href='https://www.anthropic.com/legal/cookies'])", "[data-testid='consent-banner'] button:is([data-testid='consent-reject'], [class*='_rejectButton'])", "anthropic-consent-preferences", "#cookiebanner #stat_cookies.checkbox_image", "#cookiebanner .button-auswahl, #cookiebanner .button-mehr-erfahren", "#stat_cookies", "#stat_cookies.checkbox_checked", "#cookiedetails .button-alles, #cookie-einstellungen-wrapper .button-zustimmen", "stat_cookies=NOK", "iframe[srcdoc*='cdn.appconsent.io/tcf2-clear/']", "script[src*='cdn.appconsent.io/tcf2-clear/'][src*='core.bundle.js']", "iframe[srcdoc*='frame-root']", "script[src*='cdn.appconsent.io/tcf2/'][src*='core.bundle.js']", "#consent-tracking", "#consent-tracking .decline.btn", ".modal-open bahf-cookie-disclaimer-dpl3", "bahf-cookie-disclaimer-dpl3", "bahf-cookie-disclaimer-dpl3:not([aria-hidden=true])", "cookie_consent=denied", ".Dialog:has(.ConsentManager)", ".ConsentManager[data-controller~='consent-manager']", ".ConsentManager button[data-action*='consent-manager#denyAll']", "arto-consent=signature", 'dialog[data-testid="cookie-message-modal"]', '[data-testid="cookie-message-bottom-sheet"]', '[data-testid="cookie-message-bottom-sheet-overlay"]', 'dialog[data-testid="cookie-message-modal"] button[data-testid="decline-all-cookies"], [data-testid="cookie-message-bottom-sheet"] button[data-testid="decline-all-cookies"]', 'dialog[data-testid="cookie-message-modal"], [data-testid="cookie-message-bottom-sheet"]', "#gdpr_area", "#gdpr_area .gdpr_area_inner", "#gdpr_area .gdpr_btn_agree, #gdpr_area #gdpr_btn_agree", "is_gdpr_agree=1", "#cookie_consent", "#cookie_consent_manage_rec", "#cookie_consent_manager_confirm", ".cookie_consent_manager_accept_req", "#cookie_consent_manage", "#cookie_consent_manager input[type=checkbox]:checked:not(:disabled)", "air_cookie_consent=", "false}", "#divCookieInfo", "#divCookieInfo #ctl00_CookieInfo_btnLinkNO", " - OFF - ", 'div[role="region"][aria-label="Cookie notice"][data-astro-cid-fzbxxtek]', 'div[role="region"][aria-label="Cookie notice"][data-astro-cid-fzbxxtek] > button[data-astro-cid-fzbxxtek]', "#cookie-policy-info,#cookie-policy-info-bg", "#cookie-policy-info button", "#cookie-policy-info .btn-reject", "#cookie-policy-info .btn-setting", "#cookie-policy-info .btn-ok", "div.nvcookies[data-nvcookies]", "div.nvcookies[data-nvcookies] .consent-reject", "div.nvcookies[data-nvcookies]:not(.nvcookies--hide)", '"wanted":false', "#RodoCookiesInfoFirst", "#RodoCookiesInit", '#RodoCookiesInfoFirst [data-type="disable-cookies-button"], #RodoCookiesInit [data-type="disable-cookies-button"], #RodoCookiesInfo [data-type="disable-cookies-button"]', "#RodoCookiesInfoFirst.in, #RodoCookiesInit.in, #RodoCookiesInfo.in", "#RodoCookiesInfoFirst.in", '#RodoCookiesInfoFirst [data-type="disable-cookies-button"]', "#RodoCookiesInit.in", '#RodoCookiesInit [data-type="disable-cookies-button"]', '#RodoCookiesInfo [data-type="disable-cookies-button"]', "AtomStore[MARKETING_COOKIES_ACCEPTED]=0", ".cookie-notice-container", "hra-consent-layer-ui", "hra-consent-layer-ui hra-cookie-buttons", 'hra-cookie-buttons [data-automation-id="consent-layer-accept-required"]', "div[data-popup-cookies][data-terms-cookies-popup-common]", 'div[data-popup-cookies][data-terms-cookies-popup-common] button[data-cookies="disallow_all_cookies"]', "all_marketing_cookies=denied", 'form[class*="a8c-cookie-banner"][method="post"]', 'form[class*="a8c-cookie-banner"] div[class*="simple-options"] a[class*="customize-button"]', "input[type=checkbox][checked]:not([disabled])", 'a[class*="accept-selection-button"]', "#as24-cmp-popup", '#as24-cmp-popup [data-testid="as24-cmp-container"]', '#as24-cmp-popup [data-testid="as24-cmp-decline-all-button"]', "%22consents%22%3A%5B%5D%7D%2C%22vendor%22", ".as-oil", ".AvacyBanner", ".as-oil, .AvacyBanner", ".as-oil .as-js-reject-all, .AvacyBanner .as-js-reject-all", ".as-oil .as-js-only-essentials", ".as-oil .as-js-close-banner, .AvacyBanner .as-js-close-banner", ".as-oil .as-js-advanced-settings", "#as-oil-cpc .as-js-optin", "#as-oil-cpc .as-js-btn-deactivate-all", ".Avada-CookiesBar__OuterWrapper .Avada-CookiesBar_Container", ".Avada-CookiesBar__OuterWrapper .Avada-CookiesBar_BtnDeny", ".Avada-CookiesBar-Preferences__PopUp .Avada-CookiesBar_BtnDeny", '"analytics":false,"marketing":false', ".fusion-privacy-bar", '.fusion-privacy-bar .fusion-privacy-bar-reject, .fusion-privacy-bar .fusion-privacy-choices input[type="checkbox"]:not(:disabled)', ".fusion-privacy-bar .fusion-privacy-bar-reject", '.fusion-privacy-bar .fusion-privacy-choices input[type="checkbox"]:checked:not(:disabled)', ".fusion-privacy-bar .fusion-privacy-bar-acceptance", "#avg-cookiebanner", "__avgAskUser=false", "#avg-cookiebanner:not(.state-close)", "#avg-cookiebanner .rejectAll", "#avg-cookiebanner .avg-cookie:checked", "#avg-cookiebanner .banner-panel .close", "#avg-cookiebanner .save", "#ACClayerBackground", "#ACClayerBackground #ACCsmallCookieLayer", "#ACCsmallCookieLayer, #ACCtabedCookieLayer", "#ACCsmallCookieLayer", "#ACCsmallCookieLayer .kkACCButtonLearnMore", "#ACCdetailsSaveButton", "#ACCtabedCookieLayer .kkACCSwitchLabel input:checked", "#ACCtabedCookieLayer .kkACCSwitchLabel:has(input:checked)", "=1000,", "#awsccc-cb-content", "#awsccc-cs-container", "#awsccc-cs-modalOverlay", "#awsccc-cs-container-inner", "button[data-id=awsccc-cb-btn-decline]", "button[data-id=awsccc-cb-btn-customize]", "input[aria-checked]", "input[aria-checked=true]", "button[data-id=awsccc-cs-btn-save]", ".axeptio_widget,.axeptio_mount", ".axeptio-widget--open", ".axeptio_mount .axeptio_widget", "%22$$completed%22:false", ".axeptio_mount .needsclick", "button#axeptio_btn_dismiss,button.ax-discardButton,.ax-widget-relifted [data-testid=widget-header] > button,button#axeptio_btn_close", "button#axeptio_btn_dismiss,button.ax-discardButton,.ax-widget-relifted [data-testid=widget-header] > button", "button#axeptio_btn_close", "axeptio_authorized_vendors=%2C%2C", "body > [style*='--ax-primary-color']", "script[src*='axept.io/tcf/']", "#cookie_consent_wrapper, #cookie_consent_min_wrapper, #manage_cookie_consent_modal", "#cookie_consent_wrapper:not(.hideConsent)", "#cookie_consent_wrapper #consent_accept_essential, #manage_cookie_consent_modal #modal_consent_accept_essential", "#cookie_consent_wrapper.non_cookie_consent_wrapper #js_cookieBannerCloseBtn", "#cookie_consent_wrapper #consent_accept_essential", "#cookie_consent_wrapper #js_cookieBannerCloseBtn", "#manage_cookie_consent_modal #modal_consent_accept_essential", "#cookie_consent_min_wrapper #close_minimized_banner", "cookieConsent=1", "cookieConsent=5", ".b-cookie.is-open", ".cookie-alert.t-dark", "#cookie-accept-necessary", ".cookie-alert .checkbox__input:checked:not(:disabled)", ".cookie-alert__button button", "#banner-privacy", "#banner-privacy #cb-RejectAll", "cookiepolicy=1-", ".bannerCookie:has(#decline-text)", '.bannerCookie #decline-text[onclick^="declineAllCookies"]', "||adv", '[id$="bathnes-cookie-consent-banner"] #cookie-banner', '[id$="bathnes-cookie-consent-banner"] #cookie-banner button[onclick^="rejectCookies"]', "#cookie.modal", "#cookie.modal #btn_cookie_submit", "#cookie.modal #cookie_stat:checked", "#cookie.modal #cookie_stat", "iabbb-cookies-message > section", "iabbb-cookies-message", "iabbb-cookies-message > section [name='allow-all']", "iabbb-cookies-message > section button.bds-button-unstyled", "iabbb-cookies-message dialog[open]", "iabbb-cookies-message dialog fieldset input[type=radio][value=false]:not(:checked)", "iabbb-cookies-message dialog button.bds-button", "iabbb-cookies-message > section button.bds-button:not([name])", ".cookiesgdpr__base:has(.cookiesgdpr__rejectbtn)", ".cookiesgdpr__base .cookiesgdpr__rejectbtn", ".cookiesgdpr__base .cookiesgdpr__wrapper", '"analitica":false', "#overlay-policy", "#overlay-policy #policy_pop_close .fa-times-circle", "#overlay-policy #policy_pop_close", "showpopuppolicy=No", "beetle-tracking-consent-modal", '"bt_marketing":false', ".cookie_info:has(#cookie_no.cookie_btn)", ".cookie_info #cookie_no.cookie_btn", "no_cookie=1", "#mfn-consent-mode", "#mfn-consent-mode #consent_deny", "body.mfn-cookies-open #mfn-consent-mode .mfn-cookies-popup", "%22analytics_storage%22%3A%22denied%22", "#cookie-banner[data-testid=cookie-banner]", "[data-testid=dialog-container-cookie-settings-modal]", "#cookie-banner[data-testid=cookie-banner] [data-testid=cookie-settings-button]", "[data-testid=dialog-container-cookie-settings-modal] [data-testid=cookie-settings-confirm]", "[data-testid=dialog-container-cookie-settings-modal] [data-testid=cookie-reject-all]", "[data-testid=dialog-container-cookie-settings-modal] input[type=checkbox]:checked", "C0002%3A0", "C0004%3A0", "#consent-manager", "#consent-manager button", "#consent-manager button:nth-child(2)", "tracking-preferences", "#bc-cmp-host", "#bc-cmp-host-auto", "#bigidcmp-banner-widget", "bigidcmp-consent-", "marketing=false", "#bnp_container", "#bnp_cookie_banner", "#bnp_btn_accept,#bnp_btn_reject", "#bnp_btn_reject", "AD=0", "#binogi_cookie_notice", "#binogi_cookie_notice #cnreject", "#cconsent-modal", "#cconsent-modal .ccm__footer .consent-givenone", "#cconsent-modal.ccm--visible .ccm__footer .consent-givenone", ".cookie-notification", "#blocksy-ext-cookies-consent-styles-css", ".cookie-notification .ct-cookies-decline-button", "blocksy_cookies_consent_accepted=no", "#cookieChoiceInfo.cookie-choices-info", "#cookieChoiceInfo.cookie-choices-info #cookieChoiceDismiss", "#cookieChoiceInfo #cookieChoiceDismiss", "displayCookieNotice=y", "#cookie_banner:has(#cookie_essential)", "#cookie_banner #cookie_buttons #cookie_essential", "#cookie_banner #cookie_essential", "#cookie_banner", "#CookieConsentContainer:has(#BtnCCPrefs) > .container", "#CookieConsentContainer #BtnCCPrefs", "#CookieConsentContainer #BtnCCAll", "#CookieConsentContainer #BtnCCNone", "#CookieConsentPanel #BtnCCSave", "#ConsentAnalytics:checked", "#ConsentAnalytics", "#ConsentThirdParty:checked", "#ConsentThirdParty", "-saved=true", "-analytics=true", "#cookie-consent-banner", "#ccpa-consent-banner", '#cookie-consent-banner [data-id="cookie-consent-banner-modal"]', "#cookie-consent-banner .banner-gdpr, #cookie-consent-banner #gdpr-modal", '#ccpa-consent-banner [data-id="btn-close-ccpa"]', '#cookie-consent-banner [data-id="btnGdprRejectAll"], #cookie-consent-banner [data-id="btn-contd-without-accpting"]', '#cookie-consent-banner [data-id="pre-banner-btn"]', '#cookie-consent-banner [data-id="cookie-consent-banner-modal"] input[type="checkbox"]:checked:not(:disabled)', '#cookie-consent-banner [data-id="btn-save-preference"]', ".bn_cookies:has(#bn_cookies__button-accept)", ".bn_cookies #bn_cookies__button-accept", "#BorlabsCookieBox", "#BorlabsCookieBox,._brlbs-block-content,.brlbs-cmpnt-dialog", "._brlbs-bar-wrap,._brlbs-box-wrap,.brlbs-cmpnt-dialog", '.brlbs-btn-accept-only-essential,a[data-cookie-refuse],.brlbs-btn-save,#CookieBoxSaveButton,.brlbs-cmpnt-close-button[data-borlabs-cookie-actions="close-button"],a[data-cookie-individual]', ".brlbs-btn-accept-only-essential,a[data-cookie-refuse]", ".brlbs-btn-save,#CookieBoxSaveButton", '.brlbs-cmpnt-close-button[data-borlabs-cookie-actions="close-button"]', "a[data-cookie-individual]", ".cookie-preference", "input[data-borlabs-cookie-checkbox]:checked", "#CookiePrefSave", "dock-privacy-settings", ".js-cookie-consent:has(.js-cookie-consent-reject)", ".js-cookie-consent .js-cookie-consent-reject", ".js-cookie-consent:not(.is-hidden) .js-cookie-consent-reject", "#cookie-panel-banner", "#cookie-panel-banner-reject-button", "no.bouvet.app.cookiepanel-cookie-control", "#boxprivacy", "#boxprivacy .closebox", "#cconsent-bar", "#cconsent-bar .consent-give", "#cconsent-bar:not(.ccb--hidden) .consent-give", "#cconsent-bar button.consent-decline", "#cconsent-bar .ccb__edit", "#ccm__footer__consent-modal-submit", '#cconsent-modal .ccm__switch-group[aria-checked="true"]', "#cconsent-modal input.category-onoff:checked:not(:disabled)", ".cookie-banner:has(.cookie-banner--content-basic)", ".cookie-banner .cookie-banner--content-basic", ".cookie-banner #btn-necessary-cookie", ".cookie-banner.active #btn-necessary-cookie", ".cookie-banner.active", ".cookie-banner #btn-customize-cookie", ".cookie-banner #btn-update-cookie-popup", "#bs-gdpr-cookies-modal", "#bs-gdpr-cookies-modal #bs-gdpr-cookies-modal-advanced-btn", "#bs-gdpr-cookies-modal #bs-gdpr-cookies-modal-accept-btn", "#bs-gdpr-cookies-modal-advanced-types", "#bs-gdpr-cookies-modal-advanced-types input[type=checkbox]:checked:not(:disabled)", "CookieShow=true", ".cookie-banner #accept_all", "#cookies_modal #third_party_cookies_toggle", "#third_party_cookies_toggle:checked", "#third_party_cookies_toggle", "#cookies_modal #save_button", ".cookie-banner:not(.d-none) #accept_all", "third_party_cookies_accepted=False", "cookie_banner_hidden=True", ".cookiebanner--tablist", "#cookiebanner[data-cookiebanner]", '.cookiebanner [data-consent="acceptSelection"]', '.cookiebanner input[type="checkbox"]:checked:not(:disabled)', '.cookiebanner input[type="checkbox"]:checked:not(:disabled) + label', ".bpa-cookie-banner", ".bpa-cookie-banner .bpa-module-full-hero", ".bpa-close-button", "cookie-allow-tracking=0", ".cookie-modal", "#notice-cookie-block", "#notice-cookie-block #cm-selectSpecific", "user_allowed_save_cookie=", "#html-body #notice-cookie-block", "#notice-cookie-block :is(#btn-cookie-decline, #btn-cookie-deny)", "#notice-cookie-block button[\\@click^='rejectAll']", "#btn-cookie-manage", "#notice-cookie-block input:checked", "#btn-cookie-save", "#html-body #notice-cookie-block, #notice-cookie", ".bwr-cookie.js-cookie", ".bwr-cookie.js-cookie .js-cookie-trigger", ".bwr-cookie.js-cookie .bwr-cookie__buttons", ".bwr-cookie.js-cookie input[data-cookie-option]:checked:not(:disabled)", "ZnVuY3Rpb25hbCI6ZmFsc2UsInBlcnNvbmFsaXphdGlvbiI6ZmFsc2V9", "#cookieconsent", "#cookieconsent .cookiechoices .rejectcookies", "ANALYTICALCONSENT=0", "MARKETINGCONSENT=0", "#ww_bzga_matomo_cookiebanner", "#ww_bzga_matomo_cookiebanner .button-deny", "#cookieBanner.c-banner", "#cookieBanner.c-banner button[data-allow-cookies=false]", "cookies_allow=false", "div.c-cookie-message.fixed", "div.c-cookie-message.fixed > div > button", ".c-cookies[data-cookies]:has(button[data-cookies-submit])", ".c-cookies[data-cookies] button[data-cookies-submit]", "[data-testid='cookie-banner-root'][class*='c15t-'], [data-testid='consent-banner-root'][class*='c15t-'], [data-testid='cookie-banner-overlay'][class*='c15t-'], [data-testid='consent-banner-overlay'][class*='c15t-']", "[data-testid='cookie-banner-root'][class*='c15t-'], [data-testid='consent-banner-root'][class*='c15t-']", "[data-testid='cookie-banner-reject-button'], [data-testid='consent-banner-reject-button']", "[data-testid='cookie-banner-customize-button'], [data-testid='consent-banner-customize-button']", "[data-testid='consent-widget-footer-save-button']", "[data-testid^='consent-widget-switch-'] input[type='checkbox']:checked:not(:disabled)", "c.necessary:1", "c15t=v=", "c.marketing:1", "mk=1.", ".captain-compliance-modal-container", '"status":"REJECTED"', "#cbgccp-cookies-banner", "#cbgccp-cookies-banner #cbg_ccp_cookie_refuse_optional_btn", "cbg_ccp=necessary", "#cookiesLayer", "#cookiesLayerInn .act-cook[data-cook='2']", "#cookiesLayerInn", "#cookiesLayerConfig #btn_no_cookies", "conf_cookies=2%3A2%3A2%3A2", ".js-cookies-policy-alert", '.js-cookies-policy-alert [class*="cookies-policy-alert-body"] [onclick*="js-cookies-policy-alert"]', '.js-cookies-policy-alert [class*="cookies-policy-alert-body"]', ".cassie-cookie-module", ".cassie-pre-banner", "#cassie_pre_banner_text", ".cassie-reject-all", ".cc_banner-wrapper", ".cc_banner", ".cc-banner[data-cc-banner]", ".cc-banner[data-cc-banner] button[data-cc-action=reject]", ".cc-banner[data-cc-banner] button[data-cc-action=preferences]", ".cc-preferences[data-cc-preferences]", ".cc-preferences[data-cc-preferences] input[type=radio][data-cc-action=toggle-category][value=off]", ".cc-preferences[data-cc-preferences] button[data-cc-action=reject]", ".cc-preferences[data-cc-preferences] button[data-cc-action=save]", ".ccConsentHolder", ".ccConsentHolder .ccConsent .cookieSettings", ".ccConsentHolder .ccConsent", ".ccConsent .cookieTextHolderExtended .cookieSettings", ".ccConsent .cookieTextHolder .cookieSettings", ".ccConsent .cookie_settings_row .cookieButton:not(.all)", ".ccConsent input.cookieswitch:not(:checked)", "analytics_storage%22%3A%22disable", "#cookie-consent-manager:has([data-ccm-dialog])", '#cookie-consent-manager [data-ccm-dialog] button[data-cookie-consent="submit"]', "#cookie-consent-manager [data-ccm-dialog]", "#cookie-consent-manager [data-ccm-dialog] input[data-ccm-checkbox]:checked", "cookie_consent_manager=", "ccm_statistics=", "#ccm-widget.ccm-show", "#ccm-widget", "script[src*='ccm19'][src*='/app.js?apiKey=']", "#ccm-widget .ccm--decline-cookies", "#ccm-widget [data-ccm-modal='ccm-control-panel']", "#ccm-control-panel .ccm--save-settings:not([data-full-consent='true'])", ".ccoo-cc-root", ".ccoo-cc-root #sn-b-save", ".ccoo-cc-root .ccoo-cc-dialog", ".ccoo-cc-root #sn-b-custom", ".ccoo-cc-root #adv-cookies-3", ".ccoo-cc-root #adv-cookies-3 input[type=checkbox]:checked", "config=0", "#js_cookie-consent-banner", "#js_cookie-consent-banner .js_cookie-consent-necessary", ".nesil-component-banner", "cerezgo-app", ".nesil-component-banner .nesil-banner", ".nesil-component-banner .banner__reject-button, .nesil-component-banner .bruce_banner__reject-button, .nesil-component-banner .nesil-link-reject", ".cfGdprCookieConsentPopup", ".cfGdprCookieConsentPopup #cfGdprCookieConsentPopupSettings", ".cfGdprCookieConsentPopup #cfGdprCookieConsentPopupSaveSettings", ".cfGdprCookieConsentPopup__settings input[type=checkbox]:checked", "CF_GDPR_COOKIE_CONSENT_PERFORMANCE=0", "CF_GDPR_COOKIE_CONSENT_SOCIAL=0", "CF_GDPR_COOKIE_CONSENT_MARKETING=0", ".cgov-cookiebanner", ".cgov-cookiebanner button[name=reject]", ".c24-cookie-consent-wrapper", ".c24-cookie-consent-wrapper .c24-cookie-consent-functional", ".c24-cookie-consent-notice", "[data-modal-content]:has([data-toggle-target^='cookie'])", "[data-toggle-target^='cookie']", "[data-cookie-dismiss-all]", ".chefcookie", ".chefcookie .chefcookie__buttons", ".chefcookie .chefcookie__box", '.chefcookie .chefcookie__buttons a[href="#chefcookie__decline"]', "hide_prompt=1", '.gdpr-modal:has(img[src*=".ciaopeople.it/"])', '.gdpr-modal .gdpr-modal__box-top-sx img[src*=".ciaopeople.it/"]', ".gdpr-modal .gdpr-modal__box", ".gdpr-modal__box-top-dx > button", 'section[role="alert"]:has(button[aria-label="close cookie message"])', 'section[role="alert"] button[aria-label="close cookie message"]', "#ccc-module,#ccc-overlay,#ccc", "#ccc-module,#ccc-notify", "#ccc", ".ccc-reject-button", "#ccc-notify .ccc-notify-buttons .ccc-notify-button:not(.ccc-accept-button):not(.ccc-reject-button)", "#ccc-module", "#ccc-dismiss-button", "#ccc-close", ".civic-govuk-cookiecontrol .cookie-banner", ".civic-govuk-cookiecontrol .cookie-banner--main .cookie-banner-button--reject", ".civic-govuk-cookiecontrol .cookie-banner-reject--hide", ".civic-govuk-cookiecontrol .cookie-banner--main", ".cc-individual-cookie-settings", ".cc-individual-cookie-settings #cookie-settings-reject-all", "ckies_cookielaw", "#cksModal", "#cksModal #cks .cksButtons", "#cksModal #cks", `#cks .cksLink[onclick*="setCksPrefs('0')"]`, "CookiePrefs=0", "#cl-consent", '#cl-consent [data-role="b_options"]', '.cl-consent-popup.cl-consent-visible [data-role="alloff"]', '[data-role="b_save"]', "__lxG__consent__v2_daisybit=", ".consent-modal[role=dialog]", ".consent-modal[role=dialog] #consent_agree", "#consent_reject", "#manage_cookie_preferences", "#cookie_consent_preferences input:checked", "#consent_save", "ctc_rejected=1", "#matomoConsentModal #matomoConsentReject", "mtm_consent_removed=1", "#cookie-notice:has(.cookie-notice-close[onclick^='closeCookieNotice'])", "#cookie-notice .cookie-notice-close[onclick^='closeCookieNotice']", "#cookieAlert.cookie-alert-overlay", "#cookieAlert.cookie-alert-overlay #saveCookieSettings", "#cookieAlert.cookie-alert-overlay.show", "#cookieAlert #changeCookieSettings", '#cookieAlert .cookie-category-switcher:checked:not([data-category="necessary"])', "#cookieAlert #saveCookieSettings", "%22marketing%22:false", "#cookieAlert.cookie-alert-overlay #cookieAccept", ".cf_modal_container", "#cm-wrapper:has(#cm-selectSpecific)", "#cookie-consent:has(#cm-selectSpecific)", "#cm-selectSpecific", "#cm-selectAllCheckboxes", "#cm-openSettings", ".cmCat-checkboxes:checked:not(:disabled)", "#cb-cookie-warning #cb-cookie-warning__button--decline", "#cb-cookie-warning", 'app-cookie-consent[data-component="site-base"]', 'app-cookie-consent[data-component="site-base"] .cookie-buttons .cookie-refuse', 'app-cookie-consent[data-component="site-base"] .cookie-buttons', 'app-cookie-consent[data-component="site-base"] .cookie-refuse', "#cookiesConsentBanner", "#cookiesParametersModal", "#cookiesConsentBanner .refuse-all-cookies", "#cookiesParametersModal .refuse-all-cookies", "cookiesConsentDone=true", "%22performanceCookies%22:false", "#coki61 .cok_but1", "#coki61", "coki61=2", "#cu-privacy-notice", "#cu-privacy-notice .cu-privacy-notice-close", "com-consent-layer", "#cmplz-cookiebanner-container", "#cmplz-cookiebanner-container .cmplz-cookiebanner", ".cmplz-cookiebanner .cmplz-deny", "cmplz_banner-status=dismissed", '.cc-type-categories[aria-describedby="cookieconsent:desc"]', '.cc-type-categories[aria-describedby="cookieconsent:desc"] .cc-dismiss', ".cc-dismiss", ".cc-type-categories input[type=checkbox]:not([disabled]):checked", ".cc-save", '.cc-type-info[aria-describedby="cookieconsent:desc"]', '.cc-type-info[aria-describedby="cookieconsent:desc"]:not(.cc-invisible) .cc-compliance .cc-btn', '.cc-type-info[aria-describedby="cookieconsent:desc"] .cc-compliance .cc-btn', ".cc-deny", '[aria-describedby="cookieconsent:desc"]', ".cc-blockingScreen", '[aria-describedby="cookieconsent:desc"].cc-type-opt-out', '[aria-describedby="cookieconsent:desc"].cc-type-opt-out:not(.cc-invisible)', ".cmp-pref-link", ".cmp-body .cmp-save-btn", ".cmp-body [id*=rejectAll]", '.cc-type-opt-in[aria-describedby="cookieconsent:desc"]', '.cc-type-opt-in[aria-describedby="cookieconsent:desc"]:not(.cc-invisible)', ".cc-settings", ".cc-settings-view", ".cc-settings-view input[type=checkbox]:not([disabled]):checked", ".cc-settings-view .cc-btn-accept-selected", '.cc-type-opt-in[aria-describedby="cookieconsent:desc"].cc-invisible', "#cookie-banner.cookie-banner", "#cookie-consent", "#cookie-button-settings-accept", "#cookie_consent_Necessary", "#cookie-button-settings", "#cookie_consent_Product:checked, #cookie_consent_Marketing:checked", "#cookieDisclaimer", "#cookieDisclaimer #_com_comundus_cookies_CookieBanner_cookieConsentForm", "#cookieDisclaimer #showCookieSettingsBtn", "#_com_comundus_cookies_CookieBanner_updateCookieConsentBtn", "#cookieDisclaimer input.banner-group-consent:not(.disabled):checked + label", ".cookie-consent-card:has([data-cy=cookie-customize])", ".cookie-consent-card [data-cy=cookie-customize]", "#cookie-preferences-dialog [data-cy=cookie-save-preferences]", "#cookie-preferences-dialog button[role=switch][aria-checked=true]:not([aria-disabled=true])", "_cookieConsent=%7B%22analytics%22%3Afalse%2C%22marketing%22%3Afalse", ".cookiebanner:has(> #cookieform .chooseCookies)", ".diffusion_layer:has(#cookieform)", ".cookiebanner #cookieform .chooseCookies", ".cookiebanner [onclick^='sendForm(0']", ".cookiebanner .chooseCookies input[type='checkbox']:checked:not([onclick])", ".cookiebanner [onclick^='sendForm(1']", "#ccc-notify.cookie-bar", `#ccc-notify.cookie-bar button[onclick^="manageCookies('disable')"], #ccc-notify.cookie-bar button[onclick^="manageCookies()"]`, '#ccc-notify.cookie-bar button[onclick^="manageSettings("]', '.cookie-modal button#ccc-close[onclick^="manageCookies()"]', "privacy_cookie_status=deny", ".consent-backdrop > .consent[role=dialog][aria-labelledby=consent-title]", ".consent-backdrop > .consent[role=dialog][aria-labelledby=consent-title] .consent__actions .consent__action--secondary", ".consent-backdrop .consent__groups input[type=checkbox]:checked:not(:disabled)", ".consent-backdrop .consent__actions .consent__action--secondary", "consent_", "._flo-consent-root", "._flo-consent-root ._flo-consent-modal-contextual ._flo-consent-button--accept-selected", "._flo-consent-root ._flo-consent-modal:not(._flo-consent-modal-contextual)", "._flo-consent-modal:not(._flo-consent-modal-contextual) ._flo-consent-button--reject", "._flo-consent-button--settings", "._flo-consent-modal-contextual ._flo-consent-button--accept-selected", "._flo-consent-modal-contextual ._flo-consent-checkbox:checked:not(._flo-consent-checkbox--necessary)", "._flo-consent-root._flo-consent-hide", ".consent-studio .cookie-banner", ".consent-studio .consent-banner", ".consent-studio [cs-role=consent-banner]", ".consent-studio [cs-role=consent-banner] [data-cs-button=reject_all]", ".consent-studio [cs-role=consent-banner] [cs-consent=reject]", ".consent-studio [cs-role=consent-banner] .cookie-banner__switch[aria-checked=true]:not([aria-disabled=true])", ".consent-studio [cs-role=consent-banner] [data-cs-button=save]", "consent-studio__storage=[%22functional%22]", "#consentaur-banner", "#consentaur-banner .consentaur-btn-reject", "%22marketing%22%3Afalse", ".otCookiesNotification #cookies-wrapper", ".otCookiesNotification #cookies-wrapper :is(#cookies-dismiss, #cookies-preferences)", ".otCookiesNotification #cookies-wrapper #cookies-dismiss", ".otCookiesNotification #cookies-wrapper #cookies-preferences", ".otCookiesNotification .cookies-btn.btn-select", ".otCookiesNotification .omgCookie-input-switch:checked:not(:disabled):not([data-id=necessary])", '"categoriesSelected":[', '"marketing"', ".otCookiesNotification #cookies-wrapper:not(:has(#cookies-dismiss, #cookies-preferences)) #cookies-submit", ".otCookiesNotification #opacityBackground", '.cs-info-bar[class*="cs-public-cookie-"] .cs_action_btn[data-cs_action="allow_all"]', '.cs-info-bar .cs_action_btn[data-cs_action="disable_all"]', ".cs-info-bar .options_btn", '.cs_settings_popup [data-cs_action="cs_confirm"]', ".cs_settings_popup input.cs_script_action:checked:not(:disabled)", "cs_viewed_cookie_policy=", "#ncmp__tool .ncmp__banner", "#ncmp__tool .ncmp__banner.ncmp__active", "ncmp=", "csm-cookie-consent", "#cookie-information-template-wrapper", "#cookie-information-template-wrapper :is(#coiOverlay, #ccb-coiOverlay, #coiConsentBanner, #CcpaWrapper)", "#CcpaWrapper", "CookieInformationConsent=", ".cookie.cookie--open", ".cookie .cookie__settings .cookie__save-settings", ".cookie .cookie__open-settings", ".cookie.cookie--open .cookie__open-settings", ".cookie .cookie__settings .cookie__decline-all", ".cookie .cookie__settings input.switch-toggler__checkbox:checked:not(:disabled)", ".cookie-consent:has(> .cookie-text + .cookie-agree:last-child)", ".cookie-consent > .cookie-text + .cookie-agree:last-child", "cookie-banner-element#ckb", "#cookieBanner.cookie-banner", "#cookieBanner.cookie-banner .cookie-actions button.btn-required-only", "cookie-analytics=0", "cookie-functional=0", "#cookie-bar", "#cookie-bar-prompt", "#cookie-bar > #cookie-bar-button", "#cookie-bar-prompt #cookiebar-save-customized", "#cookie-bar-button-customize", "#cookiebar-save-customized", "#cookiebar-tracking:checked", "#cookiebar-tracking", "#cookiebar-third-party:checked", "#cookiebar-third-party", "cookiebar=CookieCustomized", "cookiebar-tracking=false", "#cookie-bar .cookie-bar-frame #decline", "#cookie-bar .cookie-bar-frame", "cookies-state=decline", "#cookie-bar[data-excluded-urls]", "#cookie-bar.active .cookie-bar__preference .btn-cookie-accept", "#cookie-bar .cookie-bar__preference .btn-cookie-decline-all", "#cookie-bar .cookie-bar__preference input[type=checkbox]:checked:not(:disabled)", "#cookie-bar .cookie-bar__preference .btn-cookie-accept:not(.btn-cookie-accept-all):not(.btn-cookie-decline-all)", "xpath///div[contains(@class,'cookie-box__in')]//*[contains(concat(' ',normalize-space(@class),' '),' cookie-box__btn ')][normalize-space()='OK' or normalize-space()='\uFF2F\uFF2B' or normalize-space()='\u78BA\u8A8D\u3057\u307E\u3057\u305F' or normalize-space()='\u9589\u3058\u308B']", ".cookie-box__in.js-load--on:not(.js-load)", ".cookie-container:has(#cookie-button-basic)", ".cookie-container #cookie-button-basic", ".cookie-container.visible #cookie-button-basic", "[data-cookie-consent-root] [data-cookie-consent-banner]", "[data-cookie-consent-root] [data-cookie-consent-banner] [data-cookie-consent-open-manage]", "[data-cookie-consent-root] [data-cookie-consent-open-manage]", "[data-cookie-consent-root] [data-cookie-consent-save]", "[data-cookie-consent-root] input[data-cookie-consent-analytics]:checked", "[data-cookie-consent-root] input[data-cookie-consent-analytics]", "[data-cookie-consent-root] input[data-cookie-consent-marketing]:checked", "[data-cookie-consent-root] input[data-cookie-consent-marketing]", "%22analytics%22%3A0%2C%22marketing%22%3A0", 'body.cookieConsent--pending [class*="cookie-consent__modal"]', 'body.cookieConsent--pending [class*="cookie-consent__button--saveSettings"]', 'body.cookieConsent--pending [class*="cookie-consent__info"] [class*="cookie-consent__button--acceptAll"]', '[class*="cookie-consent__info"] [class*="cookie-consent__button--settings"]', '[class*="cookie-consent__button--saveSettings"]', '[class*="cookie-consent__selection"] input:checked:not(:disabled)', "cookieConsentClicked=true", "body.cookieConsent--pending", ".spicy-consent-wrapper", ".spicy-consent-bar", ".js-decline-all-cookies", ".cookie-disclaimer:has(> .cookie-close.accept-cookie)", ".cookie-disclaimer > .cookie-close.accept-cookie", ".cookie-disclaimer", "section.cookie-info", "section.cookie-info .js-cookie-info__decline", "section.cookie-info.is-visible:not(.is-hidden)", "accepted-cookies=functional", "accepted-cookies=functional%2C", "#cookie-law-info-bar, #cookie-law-bg, .cli-popupbar-overlay", "#cookie-law-info-bar", "cookielawinfo-checkbox-non-necessary=yes", "#cookie_note", "#cookie_note :is(.cookie_accept, #cookie_accept)", '#cookie_note :is([class*="cookie_reject"], [id*="cookie_reject"], [class*="cookie_decline"], [id*="cookie_decline"], [class*="cookie_deny"], [id*="cookie_deny"], [class*="cookie_refuse"], [id*="cookie_refuse"])', "#cookie-notice:has(#cookie-notice-accept.cookie-notice__accept--custom)", "#cookie-notice #cookie-notice-accept.cookie-notice__accept--custom", "#cookie-notice #cookie-notice-reject", "#cookie-notice input[type=checkbox]:not(#cookie-checkbox-mandatory, [data-is-mandatory], :disabled):checked", "#cookie-notice #cookie-notice-accept", ".cookie-notice-container:has(.cookie-notice-box #cookie-notice-ok-button)", ".cookie-notice-container .cookie-notice-box #cookie-notice-ok-button", ".cookie-notice-container .cookie-notice-box:has(#cookie-notice-ok-button)", "#cookie-popup", "#cookie-popup #close-cookies", "#cookie-popup #view-all", '#cookie-popup:not([class*="invisible"]) #close-cookies', '#cookie-popup[class*="invisible"]', "acceptedAnalytics=granted", '#cookie-popup:has([onclick*="cookieNo()"])', '#cookie-popup [onclick*="cookieNo()"]', '#cookie-popup:has([onclick*="cookieOk()"]):not(:has([onclick*="cookieNo()"]))', '#cookie-popup:not(:has([onclick*="cookieNo()"])) [onclick*="cookieOk()"]', "form.cookie-pref-form .cookie-bar", "form.cookie-pref-form .cookie-bar .cookie-bar--action", "form.cookie-pref-form .cookie-bar .cookie-bar--reject", "form.cookie-pref-form .show-cookie-pref", "form.cookie-pref-form .cookie-pref-save", "form.cookie-pref-form .cookie-pref-overlay input[type=checkbox]:checked:not(:disabled)", "#cookiescript_injected", ".cookiescript_banner_container [role=dialog]", "#cookiescript_injected, .cookiescript_banner_container", "#cookiescript_injected, .cookiescript_banner_container [role=dialog]", "#cookiescript_reject", "#cookiescript_manage", ".cookiescript_fsd_main, #cookiescript_save", ".cookiescript_fsd_main", "#cookiescript_save", "#cookiescript_injected input.cookiescript_checkbox_input:checked:not(:disabled), .cookiescript_banner_container input.cokiescript_checkbox:checked:not(:disabled)", "#cookiescript_close, .cookiescript_close_btn", ".cookie-use-notice", ".cookie-use-notice #decline-cookie", "-cookie=deny", "#cookieAcceptBar.cookieAcceptBar", "#cookieBanner a.btn-closecookie", "seenCookieNotification=1", "#cookiebar", "#cookiebar input[onclick='OCC()']", "cooki_ok", "#cbPopupWrap.cb-popup--open", "#cbPopupWrap #cbRefuseTrigger", "cbDataAccepted=1", "cookiecode-banner", 'script[src*="cdn.cookiecode.nl/dist/"]', "#cc--main #cc_div", "#cc_div:has(#s-cnt)", "#cc--main #cc_div, #cc_div #s-cnt", '#s-rall-bn, #cm #c-s-bn, #cm [data-cc="c-settings"], #s-bl input.c-tgl:not(:disabled)', "html.show--consent #cm, html.show--settings #s-cnt", "#s-all-bn", "#s-rall-bn", '#c-s-bn, #cm [data-cc="c-settings"]', "#s-bl input.c-tgl:checked:not(:disabled)", "#s-sv-bn", "cc_cookie=", "#cc_div", "#cc_div #cm_btns", "html.show--consent #cc_div #cm, html.lb-show-cookie-consent #cc_div #cm", "#cm_secondary_btn", "html.show--settings, html.lb-show-cookie-settings", "#cs_blocks input.c_toggle:checked:not(:disabled)", "#cs_save__btn", "lb_csc=", "#cc-main", "#cc-main .cm-wrapper", ".cm__btn[data-role=necessary]", ".cm__btn[data-role=show]", "#cc-main .pm__btn", "#cc-main .pm__btn[data-role=necessary]", "#cc-main .pm input.section__toggle:not([data-category]):not(:disabled):checked", "#cc-main .pm__btn[data-role=save]", ".cc-cookies", ".cc-cookies .cc-cookie-accept", ".cc-cookies:not(#cookies_declinedbar) .cc-cookie-accept", ".cc-cookies .cc-cookie-decline", "#cookiefirst-root,.cookiefirst-root,[aria-labelledby=cookie-preference-panel-title]", "#cookiefirst-root,.cookiefirst-root", "#cookiefirst-root button[data-cookiefirst-action],.cookiefirst-root button[data-cookiefirst-action],#btnAcceptAllCookies,#btnRejectAllCookies,#btnAdjustSettings,[aria-labelledby=cookie-preference-panel-title] button", "button[data-cookiefirst-action=reject]", "#btnRejectAllCookies", "button[data-cookiefirst-action=adjust]", "[data-cookiefirst-widget=modal]", "button[data-cookiefirst-action=save]", "#cookieFooter", "#cookieFooter .CookieButton[onclick*='toCookieOpen']", "#cookieBox", "#cookieBox input.Cookie:checked:not(:disabled)", "#cookieBox .CookieButton[onclick*='toCookieSave(1)']", ".ch2-container", ".ch2-dialog", ".ch2-open-settings-btn, .ch2-open-personal-data-btn", ".ch2-settings", ".ch2-deny-all-btn", ".ch2-settings input[type=checkbox]:not([disabled]):checked", ".ch2-save-settings-btn", "cookiehub=", ".cookieinfo", ".cookieinfo .cookieinfo-close", ".cookieinfo-close", ".JSWrapper:has(#cookieInfoZamknij)", "#cookieInfoZamknij", "js_on=1", ".cookiejs-banner-wrapper", ".cookiejs-banner-wrapper:not(.modal)", ".cookiejs-banner-wrapper button.cookiejs-button", ".cookiejs-banner-wrapper #reject-cookies-btn", "analytics_cookies=false", ".cookiejs-banner-wrapper.modal", ".cookiejs-banner-wrapper .cookiejs-banner-text", ".cookiejs-banner-wrapper .cookiejs-banner-li:nth-of-type(2) button", "cookiejs_preferences", "#cookie-legit-notice-container .cookie-legit-notice", "#cookie-legit-notice-container.notice .cookie-legit-notice", "#cookie-legit-notice-container .cookie-legit-deny-btn", "#cookie-legit-notice-container .cookie-legit-pref-btn", "#cookie-legit-notice-container .cookie-legit-save-pref-btn", "#cookie-legit-notice-container input[name=cl_tracking]:checked", "#cookie-legit-notice-container input[name=cl_marketing]:checked", "cl_tracking=false", "cl_marketing=false", "#cookieman-modal", "#cookieman-modal [data-cookieman-save]", "#cookieman-modal [data-cookieman-accept-none]", "#cookieman-modal [data-cookieman-accept-mandatory]", "#cookieman-modal [data-cookieman-form]", '#cookieman-modal [aria-controls~="cookieman-settings"]', '#cookieman-modal [data-cookieman-form] input[type="checkbox"]:checked:not(:disabled)', "#cookieman-modal [data-cookieman-save]:not([data-cookieman-accept-all]):not([data-cookieman-accept-none])", "CookieConsent=", "[data-co-banner]", "co_consent=", "%22analytics%22%3Atrue", "%22marketing%22%3Atrue", "%22personalization%22%3Atrue", "#cp-overlay", "#cp-overlay #cp-no a", "cookiepermission=no", "#eksCookiePrompt", "#eksCookiePrompt .cpDontAcceptBtn", "#eksCookieNo", "cookieOptOut=n", "#CookieReportsBanner", "#CookieReportsOverlay", "#CookieReportsPanel #CookieReportsBanner", ".modal-cacsp-position", ".modal-cacsp-backdrop", ".modal-cacsp-position .modal-cacsp-box-info", ".modal-cacsp-box-info.modal-cacsp-box-show", ".modal-cacsp-box-info .modal-cacsp-btn-refuse", ".modal-cacsp-box-info .modal-cacsp-btn-settings", ".modal-cacsp-box-settings.modal-cacsp-box-show .modal-cacsp-btn-save", "cookies_and_content_security_policy=[]", ".js-cookies-notification", ".js-cookies-notification .js-cookies-confirm", ".js-cookies-notification._active", ".js-cookies-notification._active .js-cookies-confirm", "cookies_notification=1", ".cookies-tip-v1-consent-container", ".cookies-tip-v1-consent-container [data-cky-tag=close-button]", "#cookiesBanner:has(#cookiesBannerPreference)", "#cookiesBanner #cookiesBannerPreference", "#cookiesBanner:not(.cookiesBannerHide) #cookiesBannerBox", "#cookiesBannerInfos button[onclick^='cookieSettingsShow']", "#cookiesBannerPreference", "#cookiesBannerChoices input:checked:not(:disabled)", "#cookiesBannerPreference button[onclick^='submitCookies()']", "#cookiesBanner.cookiesBannerHide", '"tracking":false', "#cookiesck", "#cookiesck_overlay", "#cookiesck #cookiesck_decline", "#cookiesck_decline", "#cookiesInfo #closeCookies", "#cookiesInfo", ".cookiesjsr-banner.active", ".cookiesjsr-banner--active", ".cookiesjsr-banner", ".cookiesjsr-banner.active, .cookiesjsr-banner--active", ".cookiesjsr-banner.active .denyAll, .cookiesjsr-banner--active .denyAll", ".cookiesjsr-banner.active .cookiesjsr-settings, .cookiesjsr-banner--active .cookiesjsr-settings", ".cookiesjsr-layer", ".cookiesjsr-layer .denyAll", ".cookiesjsr-layer .cookiesjsr-switch.active input, .cookiesjsr-layer .cookiesjsr-switch--active input", ".cookiesjsr-layer .save", "#cookiesModal .modal-footer #cookiesModalAcceptSelected", '#cookiesModal input[name="cookies_google"]', "#cookiesModal .modal-dialog", '#cookiesModal input[name="cookies_google"]:checked', "#cookiesModal #cookiesModalAcceptSelected", "cookiePolicy=sessions", "cookiePolicy=sessions%2Cgoogle", "#cookiesplus-modal-container", "#cookiesplus-overlay", "#cookiesplus-modal #cookiesplus-form", "#cookiesplus-modal", "#cookiesplus-modal .cookiesplus-reject", "#cookiesplus-modal .cookiesplus-more-information", "#cookiesplus-modal .cookiesplus-save", "C_P_DISPLAY_MODAL%22%3Afalse", "#CookieConsent dialog.cookie-popup", "#CookieConsent dialog.cookie-popup #cc-b-custom", "#CookieConsent .actions input[type=checkbox]:checked", "#CookieConsent #cc-b-custom", ".cky-overlay,.cky-consent-container", ".cky-consent-container", ".cky-consent-container [data-cky-tag=reject-button]", ".cky-consent-container [data-cky-tag=donotsell-button]", ".cky-modal [data-cky-tag=optout-option-toggle]", ".cky-modal [data-cky-tag=optout-option-toggle]:not(:checked)", ".cky-modal [data-cky-tag=optout-confirm-button]", ".cky-modal [data-cky-tag=optout-success]", ".cky-modal [data-cky-tag=optout-close]", ".cky-consent-container [data-cky-tag=settings-button]", ".cky-modal-open input[type=checkbox],.cky-consent-bar-expand input[type=checkbox],.cky-modal-open [data-cky-tag=detail-save-button],.cky-consent-bar-expand [data-cky-tag=detail-save-button]", ".cky-modal-open input[type=checkbox]:checked,.cky-consent-bar-expand input[type=checkbox]:checked", ".cky-modal [data-cky-tag=detail-save-button],.cky-consent-bar-expand [data-cky-tag=detail-save-button]", ".cky-consent-container,.cky-overlay,.cky-consent-bar-expand", "advertisement:no", "#cky-consent.cky-consent-bar", "#cky-consent #cky-btn-reject", "#cky-consent #cky-btn-settings", "#cky-btn-custom-accept", "input[id^=cky-checkbox-category]:checked:not(:disabled)", "cky-action=yes", "cky-consent=no", "cookieyes-analytics=no", ".elementor-popup-modal:has(.cookiez-footer)", ".cookiez-footer [data-cookiez-action]", '.cookiez-footer [data-cookiez-action="deny-all"]', "%22analytics%22%3Afalse", "dialog:has(#cookie-banner-2025-form)", "#cookie-banner-2025-form", 'button[form="cookie-banner-2025-form"][name="accept_cookie"]', 'button[form="cookie-banner-2025-form"][name="accept_cookie"][value="selection"]', ".c-cookie-banner.c-custom-sheet", '[id^="monetate_selectorHTML"] > .gdprCookieBanner', ".c-cookie-banner.c-custom-sheet .c-cookie-banner__close-button", '[id^="monetate_selectorHTML"] > .gdprCookieBanner .gdprCookieBannerCloseBtn', '.c-cookie-banner.c-custom-sheet, [id^="monetate_selectorHTML"] > .gdprCookieBanner', ".cookiealert", ".configurecookies", ".confirmcookies", "#gdprMessage button.gdpr-review", "[id^=div-transcend-cookie]", "#gdprMessage", "#btn-transcend-cookie-confirm, #btn-transcend-save", "#analyticsNo:not(:checked), #functionalNo:not(:checked), #targetingNo:not(:checked)", "#analyticsCookieCheckbox:checked, #preferenceCookieCheckbox:checked", "#elc-cookie-consent", "#elc-cookie-consent #elc-cookie-consent-form", "#elc-cookie-consent:not(.elc-hidden) #elc-cookie-consent-form", '#elc-cookie-consent-form input[type=checkbox][name^="group-"]:checked:not([disabled]):not([name$="-necessary"])', "#elc-deny-link", "#elc-accept-link", "#elc-detail-link", "#elc-save-link, #elc-accept-link", "#elc-save-link", "#elc-cookie-consent.elc-hidden", "#ct-ultimate-gdpr-cookie-popup", "#ct_ultimate-gdpr-cookie-reject a,#ct-ultimate-gdpr-cookie-reject", "#ct-ultimate-gdpr-cookie-change-settings", '#ct-ultimate-gdpr-cookie-modal-slider-form input[type=radio][value="1"], #ct-ultimate-gdpr-cookie-modal-slider-form input[type=radio][value="2"], .ct-ultimate-gdpr-cookie-modal-single input[type=radio][value="1"]', "#ct-ultimate-gdpr-cookie-modal-body .save", "ct-ultimate-gdpr-cookie=", "#cookiebar .cookiebar-content", "#cwarn-box", "#cwarn-box #cwarn-button", "#cwcis_panel", "#cwcis_panel #accept_all_cwcis", "#cwcis_panel #cwcis_preferences", "#cwcis_manage", "#cwcis_toggle:checked", "#cwcis_toggle", "#cwcis_panel #cwcis_cadw", "cwcis_panel=true", "cwcis_dewisiad=true", ".cookies-consent:has(.cookies-consent-accept-needed)", ".cookies-consent .cookies-consent-accept-needed", ".cookies-consent .cookies-inner", "cookiesConsentAllowedServices=", ']},{"type":', ".cookie-consent-banner:has(#FormCookieConsentAll)", ".cookie-consent-banner #FormCookieConsentAll", ".cookie-consent-banner .btn-cookie-consent-settings", ".modal-cookie-consent .btn-cookie-consent-modal-disallow-all", ".cookie-consent-banner", ".cookie-notice.js-cookie-modal", ".cookie-notice.js-cookie-modal .js-accept-minimal-cookies", "acceptCookiePolicy-marketing=false", 'div[class*="CookiePopup__desktopContainer"]:has(div[class*="CookiePopup"])', 'div[class*="CookiePopup__desktopContainer"]', "#CookiePolicy", "#CookiePolicy #cookie-policy-accept-button", "#CookiePolicy .cookie-policy-consents-area input[type=checkbox]:checked:not(:disabled)", "DDCookiePolicy-consent-tracking=false", "[data-module=cookie-consent-banner]", "[data-module=cookie-consent-banner] #button-accept-necessary[data-consent-set]", "[data-module=cookie-consent-banner] .cookie-consent-banner", "[data-module=cookie-consent-banner] #button-accept-necessary", "dbconsent=0.1.", ".dbayCookieSelect .cookieConsentMessage", ".dbayCookieSelect #cookieSelectForm", ".dbayCookieSelect .cookieSelectReject", "#cookieSelectForm input[type=checkbox]:checked:not([disabled])", ".dbayCookieSelect .cookieSelectAccept", ".dg-consent-banner", "datagrail_consent", "#datasign_cmp__host", "#__next > div.fixed.bottom-0.z-\\[70\\] div.flex.gap-2.shrink-0 > button:first-child + button.from-blue-500:last-child", "#__next > div.fixed.bottom-0.z-\\[70\\] div.flex.gap-2.shrink-0 > button.from-blue-500:last-child", "#__next > div.fixed.bottom-0.z-\\[70\\] div.flex.gap-2.shrink-0 > button:first-child", "[role='dialog'] button[role='switch']", "[role='dialog'] button[role='switch'][aria-checked='true']:not([disabled])", "[role='dialog']:has(button[role='switch']) div.justify-end > button.from-blue-500:last-child", "%22statistics%22:false%2C%22marketing%22:false", "#cookieconsent.cookie-overlay .cookie-buttons #cookie-deny", "ap-cookie-consent [data-bb=decline] button", '#cookieconsent.cookie-overlay[style*="visibility: visible"] #cookie-deny', "#cookieconsent.cookie-overlay #cookie-deny", "CLC_GDPR=AB%3A", '#cookie-banner .cookie-buttons [data-modal-content-id="cookie-modal"]', "#cookie-banner .cookie-buttons", "#js-modal #save-cookie-preferences", "#js-modal #choice-analytical-cookies:checked", "#js-modal #choice-analytical-cookies", "analytical%22:0", "#cookie-notice", "#cookie-notice :is(#cn-refuse-cookie, #cn-close-notice)", "#cookie-notice.cookie-notice-visible #cn-notice-buttons", "#cookie-notice #cn-refuse-cookie", "#cookie-notice #cn-close-notice", "#cookie-notice .cookie-notice-container", "cookie_notice_accepted=false", "#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium", "#didomi-host", '#didomi-popup, #didomi-notice, .didomi-popup-notice, .didomi-notice-banner, #didomi-host:not([aria-hidden="true"]):not(:empty)', "xpath///button[@id='didomi-notice-disagree-button'][contains(., '\u20AC') or contains(., '\xA3') or contains(., '$') or contains(., 'uscri') or contains(., 'ubscri') or contains(., 'bonn') or contains(., 'bbon')]", "#didomi-notice-disagree-button,.didomi-continue-without-agreeing", "#acceptationCMPWall", "#didomi-notice-learn-more-button", "#btn-toggle-disagree", "#diffuse-cookie-notice", "#diffuse-cookie-notice .dcn-bar", "#diffuse-cookie-notice .dcn-bar .diffuseCookieDenyAll", "#diffuse-cookie-notice .dcn-bar .diffuseCookieSettings", "#diffuse-cookie-notice .dcn-modal", "#diffuse-cookie-notice .dcn-modal .dcn-cbl-on:not(.dcn-cbl-locked)", "#diffuse-cookie-notice .dcn-modal .diffuseCookieAcceptSelection", "%3Atrue", "dnt-cookies", "CONSENT=OFF", "#cc_modal_dialog", "#cc_modal_window", "#cc_section_quick_info #cc_accept_all_cookies", "#cc_reject_all_cookies", "#cc_manage_cookies", "#cc_reject_all", "#cc_save_preferences", "#cc_section_quick_info", "cookie_consent=", 'script[src*="/style/dlibra/"]', ".cookies > p > button.cookies__button", "AcceptCookie=true", '[data-project="mol-fe-cmp"]', '[data-project="mol-fe-cmp"] [class*=footer]', '[data-project="mol-fe-cmp"] button[class*=basic]', '[data-project="mol-fe-cmp"] div[class*="tabContent"]', '[data-project="mol-fe-cmp"] div[class*="toggle"][class*="enabled"]', "#mol-ads-cmp-iframe, div.mol-ads-cmp > form > div", "div.mol-ads-cmp > form > div", "div.mol-ads-ccpa--message > u > a", ".mol-ads-cmp--modal-dialog", "a.mol-ads-cmp-footer-privacy", "button.mol-ads-cmp--btn-secondary", "#eufemia-portal-root .cookie-popup", ".cookie-popup #cookie-popup-strictlyNecessary", "consentData=sn", ".cookiebanner:has(> .cookiebanner-close)", ".cookiebanner > .cookiebanner-close", "#pg-dom-shadow-host", ".cmp-popup_popup", ".cmp-app_gdpr", ".cmp-popup_popup .cmp-intro_rejectAll", ".cmp-popup_popup .cmp-details_rejectAll", "lpubconsent=", "#rgpd-popup", "#rgpd-custom-popup", "#rgpd-popup #rgpd-continue-without-accepting", "#rgpd-continue-without-accepting", "consentLevel=none", "#drupalorg-crosssite-gdpr", ".no", '#d-notification-bar[data-rule-type="notification"]:not([data-rule])', '#d-notification-bar[data-rule-type="notification"]:not([data-rule]) .notification-dismiss', '.showing-message--shown > #d-notification-bar[data-rule-type="notification"][data-visible]:not([data-rule])', ".showing-message--shown > #d-notification-bar:not([data-rule]) .notification-dismiss", ".showing-message--shown > #d-notification-bar:not([data-rule])", "#cookiemodal", "#cookiemodal #cookie-accepted-form", "#cookiemodal #cookie-change-desc", "#cookiemodal .cookie-form input[type=checkbox]:checked:not(:disabled)", "analytics_storage=false", "ad_storage=false", ".cookieconsent form .hidden_accept_all", ".cookieconsent:not(.hidden) form input[type=submit]", "#cookie-consent-deny", ".cookieconsent form button.button--textual, #cookie-consent-button", ".cookieconsent .hidden_accept_all[value=no]", "#cookie_category_marketing:checked", "#cookie_category_marketing", ".cookieconsent form input[type=submit]", "cookie_category_marketing=on", "#eagerly-tools-cookie", "#eagerly-tools-cookie-overlay", "#eagerly-tools-cookie.active .cookie-fb-content", "#eagerly-tools-cookie .cookie-fb-scroller input[type=checkbox]:checked:not(:disabled)", "#eagerly-tools-cookie .cookie-fb-bottom :is(.js-btn-ok, .btn-ok)", "#easycookieinfo", "#cookieBox .block-cookie-consent", "#cookieBox #consentButton.block-cookie-consent--btn", "#econda-pp2-banner", "#econda-pp2-banner-modal", "#econda-pp2-banner, #econda-pp2-banner-modal", "#econda-pp2-banner-reject-all-channels-button", 'econda.privacy.protection={"profile":{"state":"DENY"', "#emCookieWrapper", "#emCookieWrapper #emCookieBanner", "#emCookieBanner", "#emCookieBtnConfigure", "#emCookieTool #emCookieBtnRejectAll", "#emCookieFrame", "EducaMadrid_LSSI_Cookies=0", ".cookieNoticeWrapper", ".cookieNoticeWrapper #cookieConsentFormAccept input[name^='ee:cookies_']", ".cookieNoticeWrapper #cookieConsentFormAccept", ".cookieNoticeWrapper #cookieConsentFormDecline button", ".cookieNoticeWrapper #cookieConsentFormAccept button", ".cookie-bar:has(> span.btn > i.fa-check)", ".cookie-bar > span.btn > i.fa-check", ".cookie-bar > span.btn", "div[role='dialog'][aria-modal='true']:has([data-qa='accept-all-button'])", "[data-qa='accept-all-button']", "[data-qa='reject-non-essential-button']", "#ensNotifyBanner", ".ensModal", "#ensNotifyBanner[style*=block]", "#ensModalWrapper[style*=block]", "#ensNotifyBanner #ensRejectAll,#ensNotifyBanner #ensRejectAllConsent,#ensNotifyBanner #rejectAll,#ensNotifyBanner #ensRejectBanner,#ensNotifyBanner .rejectAll,#ensNotifyBanner #bannerRejectButton,#ensNotifyBanner #ensRejectAds,#ensNotifyBanner #btn-accept-essential-cookies", "#ensOpenModal,#modalOpenButton,#bannerOpenModal", ".ensCheckbox:checked:not(:disabled)", "#ensSave,#modalSaveButton,#bannerSave", "#ensCloseBanner", "#ensModalWrapper #ensRejectAll", "#ez-cookie-notification", "#ez-cookie-notification__decline", "#notificationManagerLink", "#ez-reject-modal", "cookies-marketing=false", "wl-cookiewall [data-automation-id='cookiewall-reject']", "consentLevel=1", "epaas-consent-drawer-shell", "%22advertising%22%3A0", "#emgCookieConsentOverlay", "#emgCookieConsentInitialPopup", "#emgCookieConsentInitialPopup button.minimal", "#footer-cookies", "#footer-cookies [ng-click='closeCookiesAlert()']", "%22stats%22%3Afalse%2C%22ads%22%3Afalse", '#cookiebar[data-cookie-name="eset_cookie-bar"]', '#cookiebar[data-cookie-name="eset_cookie-bar"] #cc-accept', "#cookiebar #cc-decline", "#cookiebar #cc-manage", "#cookiebar #cc-accept2", "#cookiebar .cc-category input[type=checkbox]:checked:not(:disabled)", '"marketing":0', "#et-consent-overlay", "#et-consent-overlay-bg", "#et-consent-overlay button[data-editor=buttonDeny]", "et_allow_cookies=0", "#gdpr-single-choice-overlay", "#gdpr-privacy-settings", "button[data-gdpr-open-full-settings]", ".gdpr-overlay-body input", ".pea_cook_wrapper,.pea_cook_more_info_popover", ".pea_cook_wrapper", "euCookie", "body.eu-cookie-compliance-popup-open", ".eu-cookie-compliance-banner .decline-button, .eu-cookie-compliance-banner .accept-necessary, .eu-cookie-compliance-save-preferences-button", "cookie-agreed=2", "#sliding-popup .popup-content.info:not(.eu-cookie-compliance-content) #popup-buttons .agree-button", "#sliding-popup .decline-button", "#sliding-popup .popup-content.info", "#sliding-popup", ".eupopup-container", ".eupopup-container > .eupopup-closebutton", "#gdpr-consent.consent", "#gdpr-consent.consent #gdpr-consent__button.consent__close", "#gdpr-consent.consent #gdpr-consent__button", "exceedlms-gdpr-cookie-consent=1", "#ez-cookie-dialog-wrapper", "#ez-manage-settings", "#ez-cookie-dialog input[type=checkbox]", "#ez-cookie-dialog input[type=checkbox]:checked", "#ez-save-settings", "ez-consent-tcf", '[data-controller="cookie-message"]', '[data-controller="cookie-message"] [data-level="minimal"]', "cookies=nok", "cookies=minimal", ".aspire-banner.marketing-cookies-banner", '[data-trk-id="reject-marketing-cookies"]', "mktck=false", "#fast-cmp-root", "iframe#fast-cmp-iframe", "fastCMP-", "iframe.ck_if", "iframe.ck_if[title='Cookie center']", "html.ck_panel iframe.ck_if[style*='visibility: visible']", "html.ck_panel iframe.ck_if", ".cookies-container:has(.accept-necessary-only-btn)", ".cookies-container .cookies-banner-non-essential .accept-necessary-only-btn", ".cookies-container", ".cookies-container .accept-necessary-only-btn", ".cookies-container .accept-hide-message-btn", ".cookies-accepted-container #closeStatusPopUp", "_website_cookie_essentialCookies=essentialCookies", "_website_cookie_usageCookies=", 'astro-island[component-url*="CookiesBanner"] .cookies', 'astro-island[component-url*="CookiesBanner"] .cookies button.cookies__buttons--settings', 'astro-island[component-url*="CookiesBanner"] .cookies input[name="targeting"]:checked', 'astro-island[component-url*="CookiesBanner"] .cookies input[name="targeting"]', 'astro-island[component-url*="CookiesBanner"] .cookies button.cookies__buttons--accept', "cookiesPreferences=[%22necessary%22]", "#cookie-advice.fv-cookie-advice", "#cookie-advice .fv-cookie-advice__message a:not([href]), #cookie-advice .fv-cookie-advice__message button", ".fv-cookies-management", ':is(fv-cookies-management-sheet, .modal-content):has(.fv-cookies-management) button[class*="--primary"]', "fever_cookies_configuration", "#fides-overlay, #fides-overlay-wrapper", "#fides-overlay-wrapper #fides-banner", "#fides-overlay-wrapper .fides-banner-hidden", ".fides-banner-button", "#fides-banner .fides-reject-all-button", ".fides-banner:not(.fides-banner-hidden) .fides-reject-all-button", "#fides-banner .fides-manage-preferences-button", ".fides-modal-content .fides-reject-all-button", ".js-cookie-consent:has(.cookie-consent__accept-essential)", ".js-cookie-consent .cookie-consent__accept-essential", "[fs-consent-element=banner]", "[fs-consent-element=banner] [fs-consent-element=allow]", "[fs-consent-element=banner] [fs-consent-element=deny]", "[fs-consent-element=banner], [fs-consent-element=root]", "#first-visit.first-visit", "#first-visit.first-visit a.js-first", ".fp-cookie-modal", ".fp-cookie-modal .cookie-essentials", ".fp-cookie-modal a.cookie-essentials", "cookie_consent=essentials", ".flatsome-cookies", ".flatsome-cookies--active .flatsome-cookies__accept-btn", ".flatsome-cookies--active", '[class*="_cookieconsent-banner--open_"]', '[class*="_cookieconsent-banner_"] [class*="_cookieconsent__button-container_"]', '[class*="_cookieconsent-banner--open_"] [class*="_cookieconsent--initial_"]', '[class*="_cookieconsent--initial_"] [class*="_cookieconsent__button-container_"] > button:nth-child(2)', "%22analyticsConsent%22%3Afalse%2C%22thirdPartyConsent%22%3Afalse%2C%22surveyConsent%22%3Afalse", "cookie-bar:not([hidden]) [data-action='decline-policy']", "cookie-bar [data-action='decline-policy']", "cookie-bar:not([hidden])", ".dse-cookie-disclaimer", ".dse-cookie-disclaimer .cta-decline-cookies", ".dse-cookie-disclaimer.cookie-visible:not(.cookie-hidden) .cta-decline-cookies", ".dse-cookie-disclaimer.cookie-hidden", "%22targeting%22%3Afalse", ".fstr-cookie-notice", ".fstr-cookie-notice :is(.button--settings, .button--reject)", ".fstr-cookie-notice .button--reject", ".fstr-cookie-notice .button--settings", ".fstr-cookie-notice__form", ".fstr-cookie-notice input[type=checkbox]:checked:not(:disabled)", ".fstr-cookie-notice .button--primary", "#fulmo-consent-overlay", "#fulmo-consent-overlay [data-act=reject]", "#fulmo-consent-overlay .fulmo-modal", "&a=0&", ".fc-consent-root,.fc-dialog-container,.fc-dialog-overlay,.fc-dialog-content", ".fc-consent-root", ".fc-dialog-container", ".fc-cta-do-not-consent,.fc-cta-manage-options", ".fc-li-only-placeholder", ".fc-preference-consent:checked,.fc-preference-legitimate-interest:checked", ".fc-confirm-choices", ".fd-consent-main:has(#fd-unCheckAll)", ".fd-consent-main #fd-unCheckAll", "fdConsentMarketing=false", "fdConsentAnalytics=false", '[class*="gcb-modal-overlay"]', "[data-gcb-modal-show-prefs]", "[data-gcb-modal-save]", "gcbcl=a3|m3", ".cookiebanner1", "script[src*='consent.gameforge.com/']", ".cookiebanner1 .cookiebanner4 > button.cookiebanner6", ".cookiebanner1 .cookiebanner2", ".cookiebanner1 .cookiebanner11", ".cookiebanner1 .cookiebanner11 > button:last-child", "gf-cookie-consent-", "=|0|", "#app-cookie-bar", "#app-cookie-bar .cookie-section .ion-toggle", "#app-cookie-bar .toast-modal button[onclick*='page-modal']", "#app-cookie-bar .page-modal", "#app-cookie-bar .cookie-section .ion-toggle.on:not(.disabled)", "#app-cookie-bar .page-modal button[onclick='saveCookieSettings()']", "script[src*='pagead2.googlesyndication.com/pagead/js/adsbygoogle.js']", ".fc-consent-root .fc-dialog-container", 'html[lang^="ja"] #gdpr:has(> button:only-of-type)', 'html[lang^="ja"] #gdpr > button:only-of-type', "#__pb-cookie", "#__pb #__pb-cookie", "#__pb-cookie.display", "#__pb-cookie .__pb-cookie_button_only_necessary", "#__pb-cookie .__pb-cookie_button_settings", "#__pb-settings", "#__pb-settings input.form-check-input:checked", "#__pb-settings .__pb-cookie_button_accept", "#cookieConsentWidgetDiv .cookie-banner", "#cookieConsentWidgetDiv #banner-cookie-consent-reject-all", "#banner-cookie-consent-reject-all", "g4m_cookie_consent=CONSENT_ESSENTIAL", '[data-test-id="cookie-banner-body"]', 'cookie-banner [data-test-id="cookie-banner-body"] [data-test-id="reject-button"]', '[data-test-id="cookie-banner-body"] [data-test-id="reject-button"]', "gov-core-cookies .cl-cookies", "gov-core-cookies .cl-cookies__bar", "gov-core-cookies .cl-cookies__bar gov-core-button:first-of-type button", "ngb-modal-window .modal-footer gov-core-button button", "gen_consent=", ".cdk-global-overlay-wrapper:has(pf-confirm-mat-modal a[href*='getproven.com/privacy'])", "pf-confirm-mat-modal a[href*='getproven.com/privacy']", "#cookie-container .navbar-cookies", "#cookie-container #accetta-cookie .cookie-container-setting", "#cookie-container", "#accetta-cookie input[type=checkbox]:checked:not(:disabled)", "#accetta-cookie .accept", "acconsenti-cookie=1", '#cookie-banner-lgpd .cookie-banner-lgpd_privacy-portal-link[href*="privacidade.globo.com"]', "#cookie-banner-lgpd", "#cookie-banner-lgpd .cookie-banner-lgpd_accept-button", "cookie-banner-consent-accepted=true", ".gmc-root", ".gmc-root[role=dialog] [data-gmc]", ".gmc-root[role=dialog]", ".gmc-root [data-gmc=custom]", ".gmc-root [data-gmc=save]", ".gmc-root [data-gmc=toggle]:checked", "gm_consent=denied", ".cookie-banner[data-available-cookies]", ".cookie-banner[data-available-cookies] .reject-cookies", "CookieConsent=[]", "#gtm_privacy", "pwinteraction=", "[data-aid=FOOTER_COOKIE_BANNER_RENDERED]", "[data-aid=FOOTER_COOKIE_BANNER_RENDERED] [data-aid=FOOTER_COOKIE_DECLINE_RENDERED]", "[data-aid=FOOTER_COOKIE_BANNER_RENDERED][style*=transform]", 'a[href^="https://policies.google.com/technologies/cookies"', 'form[action^="https://consent.google."][action$="/save"],form[action^="https://consent.youtube."][action$="/save"]', 'form[action^="https://consent.google."][action$="/save"]:has(input[name=set_eom][value=true]) button,form[action^="https://consent.youtube."][action$="/save"]:has(input[name=set_eom][value=true]) button', ".glue-cookie-notification-bar", ".glue-cookie-notification-bar__reject", ".HTjtHe#xe7COe", '.HTjtHe#xe7COe a[href^="https://policies.google.com/technologies/cookies"]', ".HTjtHe#xe7COe button#W0wltc", "SOCS=CAE", "#gotrust-cookie-banner", "#gotrust-cookie-banner > div", ".govuk-cookie-banner__message", ".govuk-cookie-banner__message .govuk-button", "#gravitoCMPRoot", "#gravitoCMPRoot [id^=gravito][id$=-layer1-accept-all]", "#gravitoCMPRoot [id^=gravito][id$=-layer1-reject-all]", "#gravitoCMPRoot [id^=gravito][id$=-layer1-settings]", "#gravitoCMPRoot [id^=gravito][id$=-layer2-reject-all]", "gravitoData", '[data-test="modal-cookie-bottom-bar"], [data-test="section-cookieModal"]', '[data-test="modal-cookie-bottom-bar"]', '[data-test="button-customizeCookie"]', '[data-test="modal-cookie-customize"]', '[data-test="modal-cookie-customize"] input[role="switch"]:checked:not([disabled])', '[data-test="modal-cookie-customize"] [data-test="button-submit"], dialog:has([data-test="modal-cookie-customize"]) [data-test="button-submit"]', '[data-test="section-cookieModal"] [data-test="button-customize"]', '[data-test="section-customizeModal"]', '[data-test="section-customizeModal"] input[data-ischecked="true"]:not([disabled])', '[data-test="section-customizeModal"] [data-test="button-save"]', "gpc_ad=0", "cp_advertisement=0", "#gr-consent-layer-area", "#gr-consent-layer", "#gr-btn-more-options", "#gr-btn-legitimate-partners", "#toggleLegitimateCheckbox", "#toggleLegitimateCheckbox:not(:checked)", "#gr-btn-save-exit-primary", ".bhh-cookie-banner", ".bhh-cookie-banner .bhh-cookie-banner__btn--close, .cookie-banner .cookie-banner__btn--close", ".bhh-cookie-banner__btn--close, .cookie-banner__btn--close", "#cookiebanner.c-banner--cookie", "#cookiebanner .js-close-banner", "#cookiebanner .js-close-banner.rejectAll", "#cookiebanner input[type=checkbox]:checked:not(:disabled)", "#cookiebanner .js-close-banner:not(.consentToAll)", "cookiebanner=closed", "matomoTracking=true", "#cookiebanner.cookiebanner__restrictive", "#c-cookiebanner.c-cookiebanner", ".js-banner__container .js-banner-button-confirm-selection", ".js-banner__container input.js-banner-control__element:checked:not(:disabled)", "gsbbanner=closed", "#guesty-be-root .cookies__block", "#guesty-be-root", "#guesty-be-root .cookies__block .cookies__btn--decline", "cookiePolicyAccepted=0", "div[class^='overlay-cookie-uuid-']", "div[class^='overlay-cookie-uuid-'] [class^='button-container-cookie-uuid-']", "div[class^='overlay-cookie-uuid-'] [class^='accordion-container-cookie-uuid-']", "div[class^='overlay-cookie-uuid-'] button[class*='btn-default-cookie-uuid-']", "div[class^='overlay-cookie-uuid-'] input[class^='cookie-uuid-'][id$='-legitimate-interest']", "div[class^='overlay-cookie-uuid-'] input[class^='cookie-uuid-'][type='checkbox']:checked", ".cookies-bar__close-button", "%22advertising%22:0", "allow_marketing=deny", "#preferences-box", "#preferences-box [data-js=open-settings]", "#preferences-box [data-js=select-preferences]", "#preferences-box [data-js=preferences-form] input[value=mandatory]", 'consent_status={"consent_all":"denied","consent_personalized":"denied"', "shb-cookie-consent", 'shb-cookie-consent [data-testid="CookieConsent_modal"]', 'shb-cookie-consent [data-testid="cookie_consent_accept_only_necessary_btn"]', "shb-cookies-consent=false", ".hds-cc__target", "#modal-host > div.no-hash > div.window-wrapper", "#modal-host > div.no-hash > div.window-wrapper, div[data-testid=qualtrics-container]", '#modal-host > div.no-hash > div.window-wrapper > div:last-child a[href="/privacy-settings"]', "div#__next", "#__next div:nth-child(1) > button:first-child", '.cookie-info:has(a[href*="close-policy.cfm"])', '.cookie-info a[href*="close-policy.cfm"]', "hg-privacy", "hg-privacy #Cookies_Decline", ".hkd-cookie-banner", ".hkd-cookie-banner .hkd-cookie-banner-button-group", "next-route-announcer", ".hkd-cookie-banner-button-group > button:nth-of-type(2)", "cookie-consent=essential", ".cookie-consent-popup", ".cookie-consent-popup #banner-accept-btn", ".cookie-consent-popup #banner-reject-btn", ".cookie-consent-popup #banner-cookie-setting-btn", ".settings-page #settings-only-required-btn", "groups=C0001:1,C0002:0,C0003:0,C0004:0", ".cbanner-govuk-cookie-banner", ".cbanner-govuk-cookie-banner button[value=reject]", ".cbanner-govuk-cookie-banner button:not([value])", "%22measurement%22:false", "dialog[data-cookie-consent]:has([data-cookie-accept])", "dialog[data-cookie-consent] [data-cookie-accept]", 'a[data-cookie-accept="functional"]', "#cookie-selector", '#cookie-selector [data-testid="CookiesCheckbox__DeclineNonEssential"]', "__mcons=false", "__acons=false", '[x-data^="App.CookieConsent"]', '[x-data^="App.CookieConsent"] button[x-on\\:click="saveSettings();"]', '[data-test="cookie-consent-notification"]', '[data-test="cookie-consent-notification"] [data-test="accept-button"]', '[data-test="cookie-consent-notification"] [data-test="dismiss-button"]', '[data-test="cookie-consent-notification"] [data-test="settings-button"]', '[data-test="cookie-consent-modal"] [data-test="accept-button"]', "#hu.hu-wrapper", "#hu.hu-visible", "#hu-cookies-save", "#hs-eu-cookie-confirmation", "#hs-eu-decline-button", "#hs-eu-close-button", "#JOISH987_bar_holder", "#JOISH987_bar_holder #JOISH987_bar", "#JOISH987_rejectBar_btn", "#JOISH987_inlineRejectBar_btn", "#c-cookie-banner:has(#c-cookie-min)", "#c-cookie-banner #c-cookie-min", "#c-cookie-banner", "datenschutz_notwendig=1", "#cookie-modal", "#cookie-modal #gdpr-customize-settings", "#cookie-modal #gdpr-reject-all", "#cookie-modal #gdpr-save-settings", "IB_PRIV_PREFS=1%7C1%7C1", "#icn_cookie_notice", "#icn_cookie_notice button", "#icn-cookie-notification__button-decline", "#icn-cookie-notification__button-decline-inline", ".icn-cookie-notification__information-info", "#ICN_anonymous", "#icn-cookie-notification__button-accept", "consent=anonymous", "body > #idxrcookies", "body > #idxrcookies #idxrcookiesKO", "#gdpr-cookie-message", "#gdpr-cookie-message #gdpr-cookie-advanced", "#gdpr-cookie-types", "#gdpr-cookie-types input[type=checkbox]:checked:not(:disabled)", "#gdpr-cookie-message #gdpr-cookie-accept2", "#gdpr-cookie-message #gdpr-cookie-accept", "#handlebars-cookie-confirm", "#gdpr-cookie-message #gdpr-cookie-accept-post", "cookieControl=true", "#toast-container.ck-tstr #ck_set", "#cmp_settings .cmp__button--reject", "cmp_ck=3", "body.page-ipublic #div-cookies", 'body.page-ipublic #div-cookies button[onclick="acceptCookies()"]', "#ipc_cookie_confirmation", "#ipc_cookie_confirmation .cookie_confirmed_and_close", "ipc_cookie=confirmed", ".base-footer > .cookie-policy", ".base-footer > .cookie-policy .btn-cookie", "[data-in2-modal-root-node]", "[data-in2-modal-root-node] .in2-modal-deny-button", "[data-in2-modal-root-node] .in2-modal-checkbox__input:checked:not(:disabled)", "[data-in2-modal-root-node] [data-in2-modal-save-button]", "in2cookiemodal-selection=[%22essential%22]", "cookie-consent-element", '"isSelected":false', '.q-notifications .q-notification:has(a[href="/cookie-policy"])', '.q-notifications .q-notification a[href="/cookie-policy"]', "module-rgpd-component", "cookieConsent=consent_1", ".accept-cookie", ".accept-cookie > .accept-cookie-inner", "xpath///*[contains(@class, 'accept-cookie')]//*[contains(text(), 'Decline')]", "cookie-pref=rejected", '[data-preact="cookie-banner/index"] .js-cookiebar', '[data-preact="cookie-banner/index"] .js-cookiebar .js-cookie-deny', ".gebaeck-notice", ".gebaeck-notice .gebaeck-notice__buttons", ".gebaeck-notice button.btn--privacy-notice-only-necessary", ".gebaeck-notice button.btn--gebaeck-notice-config, .gebaeck-notice button.btn--privacy-notice-config", ".gebaeck-notice-popup", ".gebaeck-notice-popup input[type=checkbox]:checked:not(:disabled)", ".gebaeck-notice-popup button.btn--gebaeck-notice, .gebaeck-notice-popup button.btn--privacy-notice", "privacy=", "form.rodo-popup", "form.rodo-popup button.rodo-popup-main-settings", "form.rodo-popup button.rodo-popup-reject", "#stopka-polityka", "#stopka-polityka #stopka-polityka-zamknij", "#stopka-polityka-zamknij", "prywatnosc=tak", ".cookie-banner[data-cookie-banner]", ".cookie-banner[data-cookie-banner] .cookie-banner__settings[data-cookie-settings] [data-cookie-deny]", ".cookie-banner[data-cookie-banner] .cookie-banner__card", ".cookie-banner[data-cookie-banner] [data-cookie-actions] [data-cookie-deny]", ".cookie-banner[data-cookie-banner] [data-cookie-open]", ".cookie-banner[data-cookie-banner] [data-cookie-settings] [data-cookie-deny]", '#elGuestTerms[data-role="guestTermsBar"]', "xpath///div[@id='elGuestTerms'][@data-role='guestTermsBar'][.//a[@data-action='dismissTerms']][not(.//form)][count(.//a[contains(@class,'ipsButton')] | .//button) <= 1][contains(translate(., 'COKIE', 'cokie'), 'cookie')]", ".privacy-consent--backdrop", ".privacy-consent--modal", ".privacy-consent--modal [data-testid='confirm-selection']", ".privacy-consent--modal #confirmSelection", '.m-cookie-banner[data-id="cookie-banner"]', '.m-cookie-banner[data-id="cookie-banner"] [data-id="cookie-manage"]', "#ccc-icon", "#ccc-module .ccc-reject-button", '"optionalCookies":{', '"revoked"', ".isn__cookie-consent", ".isn__cookie-consent .isn__cookie-consent__choice.required", ".isn__cookie-consent__choice.required", "#iubenda-cs-banner", ".iubenda-cs-accept-btn", "#iubenda-cs-banner .iubenda-ccpa-opt-out", "#ameConsentUI", "body.cp-banner-visible", ".iubenda-cs-reject-btn", ".iubenda-cs-customize-btn", ".iub-btn-reject", "#iubFooterBtn", "#iubenda-alert .iubenda-button-confirm", "#iubenda-cs-banner .iubenda-cs-close-btn", "uspString%22%3A%221YY-", "#cookieprompt", "#cookieprompt #cookieAllow", '#cookiepromptinner a[href*="changeCookieSettings"]', '.jqibuttons button[value="false"], .ixoprompt-buttons button[data-value="false"]', "allowAllCookies=no", ".js-jcookie", ".js-jcookie .js-jcookie-allow", ".js-jcookie.active", ".widget_eu_cookie_law_widget", "#jix-cookie-consent-modal", "#jix-cookie-consent-modal input.jix-cookie-consent-selection:checked:not(:disabled)", "#jix-cookie-consent-accept-selected", "#cookiesAlertMsg.cookies-alert", "#cookiesAlertMsg.cookies-alert #cookies_alert_btn", '[data-testid="jkl-cookie-consent-godta"]', '[data-testid="jkl-cookie-consent-nekt"]', '[id^="jkl-cookie-modal"] input[type="checkbox"]:checked', '"statistics":"denied"', ".js-cookie-consent:has(.cookie-consent__settings-save)", ".js-cookie-consent .cookie-consent__settings-save", ".js-cookie-consent.cookie-consent--open .cookie-consent__button--secondary", ".js-cookie-consent .cookie-consent__button--secondary", ".js-cookie-consent .cookie-consent__option-checkbox:checked", ".js-cookie-consent.cookie-consent--open", ".consent-banner:has(.consent-close-icon-wrapper)", '.consent-banner a.consent-close-icon-wrapper[data-pt-name="consent-closed"]', "cbc=true", ".js-cp-box", ".js-cp-box .js-cp-accept-all-button", ".js-cp-box .js-cp-reject-all-button", ".js-cp-box .js-cp-settings-button", ".js-cp-box .js-cp-settings-box", ".js-cp-box .new-cp-content-settings-options-one-cookie.on:not(.disabled)", ".js-cp-box .js-cp-accept-selected-button", "cookiepolicyinfo_new", ".cookie-bar", ".cookie-bar .cookie-bar__message,.cookie-bar .cookie-bar__buttons", "cookies-state=accepted", "#consent-manager #consent-banner #consent-banner-btn-close", "#consent-manager #consent-banner", "#consent-manager #consent-banner-btn-close", "#modal-lgpd.pat-cookies", "#modal-lgpd.pat-cookies.cookies--ativo .btn--rejeitar", "#modal-lgpd.pat-cookies.cookies--ativo", "#modal-lgpd.pat-cookies .btn--rejeitar", "#modal-lgpd.pat-cookies.cookies--desabilitado", "#t4s-popup__cookies-law", "#t4s-popup__cookies-law.on--show", "#t4s-popup__cookies-law .t4s-pp_cookies__decline-btn", '.ui-dialog[aria-describedby="cookies"]', "#cookies > #cookies-info #btnCookiesAll", "#cookies-info #btnCookiesReject", "#cookies-info #btnCookiesOptions", "#cookies-options #btnCookiesSelected", '#cookies-options input[type="checkbox"]:checked', ".gdprPopup:has(> .gdprPopupContainer > .gdprButton)", "script#kasp-cookie-alert-js", ".gdprPopup > .gdprPopupContainer > .gdprButton", ".gdprPopup", "#lanyard_root div[role='dialog']", "#ketch-banner", "#ketch-modal", "#lanyard_root [class*='ketch-fixed']", "#lanyard_root button[aria-label^='Reject' i], #ketch-banner button[aria-label^='Reject' i]", "#lanyard_root [aria-describedby=preference-description], #lanyard_root [aria-describedby=modal-description], #ketch-modal, #ketch-purposes-modal, #ketch-preferences", "#lanyard_root button[class*=confirmButton], #lanyard_root div[class*=actions_] > button:nth-child(1), #lanyard_root button[class*=actionButton], #ketch-modal button[aria-label='Confirm'], #ketch-purposes-modal button[aria-label='Confirm'], #ketch-modal button[aria-label='Save Settings'], #ketch-purposes-modal button[aria-label='Save Settings']", "#ketch-banner-button-tertiary", "#lanyard_root [aria-describedby=banner-description]", "#lanyard_root div[class*=buttons] > button[class*=secondaryButton], #lanyard_root button[class*=buttons-secondary], #ketch-banner-button-secondary", "#lanyard_root [id^='ketch-banner-buttons-container'] > button:only-child", "#lanyard_root [aria-describedby=preference-description],#lanyard_root [aria-describedby=modal-description], #ketch-preferences, #ketch-purposes-modal", "#lanyard_root button[class*=rejectButton], #lanyard_root button[class*=rejectAllButton], #ketch-modal button[aria-label='Reject All'], #ketch-purposes-modal button[aria-label='Reject All']", "#lanyard_root input[type=checkbox][role=switch][aria-checked=true]:not(:disabled)", "_ketch_consent_v1_", "#kixell_st .kstoverlay", "#kixell_st .kstp", "#kixell_st .kstp .stno", ".cc-container.cc-noselect", ".cc-container .cc-box .cc-section-landing .cc-btn-reject", ".cc-container.displayed .cc-section-landing", ".cc-container .cc-section-landing .cc-btn-reject", 'cookie_consent={"status":"rejected"', "#xp-cookie-banner-root dialog.xp-cookie-banner", "#xp-cookie-banner-root dialog.xp-cookie-banner[open]", '.xp-cookie-banner .xp-cookie-wrapper--buttons button[data-button="secondary_cta"]', "klp-marketing-consent=false", '[data-cy="kn-consent-sheet"]', '[data-cy="kn-consent-sheet"] button[data-cy="accept-all"]', '[data-cy="kn-consent-sheet"] button[data-cy="accept-all"] + button', 'body.kolibri [data-testid="cookie-widget"]', 'body.kolibri [data-testid="cookie-widget"] button.k-button--primary + button.k-button--tertiary', "%22advertising%22%3Afalse%2C%22hasConsented%22%3Atrue", ".consentForm__container", ".consentForm__root .consentForm__acceptButton[data-accept-action=selected]", ".consentForm__root", ".consentForm__optOutItem input:checked", ".consentForm__acceptButton[data-accept-action=selected] button", "optOutAccepted=true", 'modal-box[data-options*="cookies"] .modal-object--cookie', ".modal-object--cookie [data-js-cookies-decline]", "#kit-ccm", "#kmcc-cookie-bar", "#kmcc-cookie-bar.kmcc-cookie-bar--visible", '#kmcc-cookie-bar .js-kmcc-extended-modal-button[data-url$="cookie_preferences"]', "#kmcc-accept-some-cookies", ".js-kmcc-btn-toggle:checked", "analyzing_cookie%22%3A%22false%22%2C%22marketing_cookie%22%3A%22false", ".cookie-settings-message", ".cookie-settings-background", ".cookie-settings-message #frmCookiesBanner", ".cookie-settings-message .cookie-settings-message-close-link", ".cookie-settings-message .cookie-settings-manage", "#frmCookiesBanner", "#frmCookiesBanner input[type=checkbox]:checked", ".cookie-settings-message .cookie-settings-message-save-link", "#_evh-ric", "#_evh-ric #btn_donotaccept", "__cpmtAccept=false", "#lab-consent", "#lab-consent .lab-consent-reject", "lab_analytics_consent=denied", ".privacy-notification[data-cookie-name]", ".privacy-notification[data-cookie-name] #js-privacy-notification-ok", "#js-privacy-notification-ok", ".cookie-consent.cc-banner", '#cc-settings-form input[name="cookie_consent_types[]"]', 'input[type=hidden][name="cookie_consent_types[]"] ~ div > button[type=submit]', 'input[type=hidden][name="cookie_consent_types[]"] ~ div > button[type=button]', "#cc-settings-form button[type=submit]", "#cc-settings-form input[type=checkbox]:checked:not(:disabled)", ".lcc-modal.js-lcc-modal-alert", ".lcc-modal.js-lcc-modal-alert .js-lcc-settings-toggle", ".lcc-modal.js-lcc-modal-settings", ".lcc-modal.js-lcc-modal-settings input[type=checkbox]:checked:not(:disabled)", ".lcc-modal.js-lcc-modal-settings .js-lcc-settings-save", "__cookie_consent=false", '.eu-popup:has(form[action$="/saveTheCookie"])', '.eu-popup form[action$="/saveTheCookie"] input[type=checkbox]', '.eu-popup:has(form[action$="/saveTheCookie"]) #rejectAllButton', '.eu-popup form[action$="/saveTheCookie"] input[type=checkbox]:checked:not(:disabled)', '.eu-popup:has(form[action$="/saveTheCookie"]) #saveButton', "#lw-widget-root #lw-banner", "#lw-widget-root #lw-banner.lw-banner-visible", "#lw-banner.lw-banner-visible .lw-consent-reject", "#lw-banner.lw-banner-visible", '"marketing":{"wanted":false}', "#jmdCookieConsentWrapper", "[data-cc-window] [data-cc-popup]", "[data-cc-window] [data-cc-popup] [data-cc-action=allow]", "[data-cc-window] [data-cc-popup] button[data-cc-action=dismiss]", "[data-cc-window] [data-cc-popup] [data-cc-action=close-popup]", "cookieconsent_status=dismiss", ".lia-cookie-banner-alert", ".lia-cookie-banner-alert .AjaxFeedback", ".lia-cookie-banner-alert a.lia-cookie-banner-alert-reject", "#p_p_id_com_liferay_cookies_banner_web_portlet_CookiesBannerPortlet_", 'script[src*="otSDKStub"]', "#_com_liferay_cookies_banner_web_portlet_CookiesBannerPortlet_declineAllButton", "CONSENT_TYPE_PERFORMANCE=false", ".wsa-cookielaw", ".wsa-cookielaw a[href*='/cookielaw/optOut']", "COOKIELAW=optout", "#lgcookieslaw_banner,#lgcookieslaw_modal,#lgcookieslaw-modal,.lgcookieslaw-overlay,.lgcookieslaw_overlay", ".lgcookieslaw-reject-button-enabled,#lgcookieslaw-overlay,.lgcookieslaw-overlay", ".lgcookieslaw-reject-button-enabled .lgcookieslaw-reject-button", ".lgcookieslaw-reject-button-enabled", ".artdeco-global-alert[type=COOKIE_CONSENT]", ".artdeco-global-alert[type=COOKIE_CONSENT] button[action-type=DENY]", "#cookie-notice.fixed:has(#accept-cookies)", "#cookie-notice.fixed #accept-cookies", "#lta-cookies-banner", "#js-lta-cookie-modal-trigger", "#lta-cookies-modal", "#lta-cookies-form input[type=radio][id^=decline-]", "#js-lta-cookie-modal-set", "%22perf%22:false", "#macaron_cookie_box", "#macaron_cookie_box .macaronbtn", ".macaronbtn.refuse", ".macaronbtn.letmechoose", ".macaronbtn.letmechoose.open", "#cookie_description .paragraph", "#cookie_description input[type=checkbox]:checked:not(:disabled)", ".macaronbtn.confirmselection", "_deCookiesConsent", "dialog.mf-cookie-modal-container", "dialog.mf-cookie-modal-container .mf-decline", "mf_cookie_consent=0", ".cookie-consent-banner #cookieBanner .manage-cookies", "#manage-cookie-modal #cookie_settings_form", ".cookie-consent-banner #cookieBanner", ".cookie-consent-banner .manage-cookies", "#cookie_settings_form input.cookie-selector:checked", "#cookie_settings_form button[type=submit]", "#notice-popup", "#notice-popup #close-btn-notice, #notice-popup #close-btn-universal", "#notice-popup .notice.show", "#close-btn-universal", "#close-btn-notice", "#notice-popup .notice", ".cookies-prompt__banner", ".cookies-prompt__wrapper .cookies-prompt__banner", ".cookies-prompt__banner_preview", ".cookies-prompt__banner_preview .cookies-prompt__actions-btn.btn-secondary", ".cookies-prompt__actions-wrap_details", ".cookies-prompt__banner_details .switch input:checked:not([disabled])", ".cookies-prompt__actions-wrap_details .cookies-prompt__actions-btn.btn-secondary", "cookies_consent=", ".mco-consent-pop-up", ".mco-consent-slide-up", ".mco-consent-slide-up__backdrop", ".mco-overlay:has(.mco-consent)", "#mco-consent", '[class*="mco-consent-"][class*="__button-decline"]', '"acceptedAll":false', "div[aria-labelledby=pwa-consent-layer-title]", "div[class^=StyledConsentLayerWrapper-]", "div[aria-labelledby^=pwa-consent-layer-title]", "button[data-test^=pwa-consent-layer-deny-all]", "form[data-test=pwa-consent-layer] [role=switch][aria-checked=true]", "button[data-test^=pwa-consent-layer-save-settings]", "|comfort:0", ".cookie-consent-simple-dialog", ".cookie-consent-simple-dialog .oo-ui-processDialog-actions-other a", ".cookie-consent-simple-dialog .oo-ui-processDialog-actions-other .oo-ui-buttonWidget:not(.oo-ui-flaggedElement-progressive) a", ".cookie-consent-detailed-dialog .oo-ui-processDialog-actions-primary a", ".cookie-consent-detailed-dialog input[type=checkbox]:checked:not(:disabled)", "cookieconsent_dialog_dismissed=dismissed", "#mensajeCookies", "#divConfigCookies", "#mensajeCookies .cajaCookies #btnAcceptAll", "#mensajeCookies #btnAcceptNoAllCookies", "#divConfigCookies #btnAcceptNoCookies", "#mensajeCookies .cajaCookies", "#mensajeCookies #btnConfigCookies", ".cookie-consent-banner-opt-out", ".cookie-consent-banner-opt-out__action--key-customize", ".cookie-consent-banner-opt-out__action--key-save", ".cookie-consent-banner-opt-out__modal", "%22advertising%22%3Afalse", "%22traceability%22%3Afalse", "cmm-cookie-banner", "#cookies-disclaimer-modal", "#cookies-disclaimer-modal #cookies-disclaimer-modal-settings", "#cookies-disclaimer-modal #cookies-disclaimer-modal-accept", "#cookies-disclaimer-modal-settings", "#cookies-settings-modal-header", "#cookies-settings-modal-statistics-switch:checked", "#cookies-settings-modal-confirm", '"googleAnalytics":false', '[data-testid="cookie-policy-dialog"]', '[data-testid="cookie-policy-manage-dialog"]', '[data-testid="cookie-policy-dialog"] [data-cookiebanner="accept_only_essential_button"], [data-testid="cookie-policy-manage-dialog"] [data-cookiebanner="accept_only_essential_button"]', '[data-cookiebanner="accept_only_essential_button"]', ".float-vertical-panel > .float-vertical-panel__cross", '.float-vertical-panel a[href*="cookies"]', ".float-vertical-panel", "cookie_accept=1", ".cmp_gdpr .fondo-cmp", ".cmp_gdpr #btn-gdpr-accept", ".cmp_gdpr #btn-gdpr-configure", ".cmp_gdpr .bt-final.footer button.bt-izq-m", "cmp-cl=AA", "#wcpConsentBannerCtrl", "#msCookieBanner", "#msCookieBanner.msCookieBanner", "#cookie-consent.cookie-consent-container .consent-modal", "#cookie-consent button[name^='tx_mindshapecookieconsent_consent[consent]']", "#cookie-consent:not([style*='display: none']):not([style*='visibility: hidden']) .consent-modal", "cookie_consent=%7B", "#cookie-consent button[name='tx_mindshapecookieconsent_consent[consent][deny]']", "#cookie-consent .consent-modal input.option:checked", "#cookie-consent .consent-modal .cookieoptions input[type='checkbox']:checked", "#cookie-consent button[name='tx_mindshapecookieconsent_consent[consent][selectAll]'][value='0']", "cookie_consent=%7B%22consent%22:true,%22options%22:%5B%5D", ".bottom-cookie-wrap:has(.js-bottom-cookie-close)", ".bottom-cookie-wrap .js-bottom-cookie-close", "#gdprCookieBar", "#gdprCookieBarOverlay", ".mst-gdpr__cookie-bar-wrapper", ".mst-gdpr__cookie-bar-overlay", ".mst-gdpr__cookie-bar .mst-gdpr__buttons,.mst-gdpr-cookie-bar-wrapper .mst-gdpr-buttons", ".mst-gdpr__buttons [data-trigger-settings=decline],.mst-gdpr__buttons button[\\@click=handleDecline],.mst-gdpr-cookie-bar-wrapper button[\\@click=handleDecline]", ".mst-gdpr__buttons [data-trigger-settings=decline]", ".mst-gdpr__buttons button[\\@click=handleDecline]", ".mst-gdpr-cookie-bar-wrapper button[\\@click=handleDecline]", ".mst-gdpr__buttons [data-trigger-settings=trigger]", ".mst-gdpr__buttons button[\\@click=openSettings]", "[data-mst-gdpr-settings-apply],.mst-gdpr__cookie-settings--success-btn,[x-on\\:click=save]", "input.checkbox[data-group-id]:not([disabled]):checked", "[data-mst-gdpr-settings-apply]", ".mst-gdpr__cookie-settings--success-btn", "[x-on\\:click=save]", "gdpr_cookie_consent=", "#cookies.modal:has(.aceptar-cookies)", "#configuracion-cookies.modal", '#cookies.modal button[data-bs-target="#configuracion-cookies"]', "#cookies.modal .aceptar-cookies", "#configuracion-cookies .aceptar-cookies", "#configuracion-cookies input[value=analytics-cookies]:checked", "#configuracion-cookies input[value=analytics-cookies]", 'div[role="dialog"]:has(button#necessary[role="switch"]):has(button#marketing[role="switch"]) [role="tablist"]', 'div[role="dialog"]:has(button#necessary[role="switch"]):has(button#marketing[role="switch"])', 'div[role="dialog"]:has(button#necessary[role="switch"]) div:not([role="tablist"]) > button:nth-child(3):last-child', "decided=true", "#__consent .md-consent__inner", "#__consent .md-consent__overlay", "#__consent form[name='consent'] .md-consent__settings input[type='checkbox']", "#__consent:not([hidden]) .md-consent__inner", "#__consent .md-consent__settings input[type='checkbox']:checked", "#__consent .md-consent__controls button.md-button--primary", "#cookiesdirective", "#cookiesdirective #explicitreject", 'dialog[data-testid="modal-dialog"]:has([data-testid="uc-button-decline"])', 'dialog[data-testid="modal-dialog"] [data-testid="uc-button-decline"]', "dialog[data-testid=accept-our-cookies-dialog]", "#banner-manage", "#pc-confirm", "#moove_gdpr_cookie_info_bar", "#moove_gdpr_cookie_info_bar:not(.moove-gdpr-info-bar-hidden)", ".moove-gdpr-infobar-reject-btn", "#moove_gdpr_cookie_info_bar .change-settings-button", "#moove_gdpr_cookie_modal", ".moove-gdpr-modal-save-settings", "#msg-cookie:has(#hide-msg-cookie)", "#msg-cookie #hide-msg-cookie", "#msg-cookie", ".cookies-policy.optional:has(.cookies-options a.cancel)", ".cookies-policy.optional .cookies-options a.cancel", ".cookies-policy.optional.show .cookies-options a.cancel", ".cookies-policy.optional .cookies-options", '"marketing":false,"analytic":false,"saved":true', "#cookie_consent_wrapper #cookie_consent.privacy_headsup", "#cookie_consent_wrapper #submit_privacy_consent1", "#cookie_consent #cookie_only_necessary2", "#cookiesDashboard,#cookieConsent.tc-privacy-override", "#cookiesDashboard #preferences_consent_top_modal,#cookieConsent #cookie_top_setting_btn", "#cookiesDashboard,#cookieConsent", "#modalWindowContainer #save_consent_main_modal", "#modalWindowContainer .toggle-custom:checked + label", "#cookiesDashboard", "consent:false", "#cookieConsent,#modalWindowContainer", ".PrivacyNotice:has(.PrivacyAccept)", ".PrivacyNotice .PrivacyContent .PrivacyAccept", "#gCookieConfirmToast", "#gCookieConfirmDimmed", "#gCookieConfirmToast .g-cookie-btn-deny", "applyCookie=%7B%22typeArr%22%3A%5B%22NECESSARY%22%5D", ".tx-netl-gdpr #netl-gdpr-allowAllCookies", ".tx-netl-gdpr .cookie-optin", "#netl-gdpr-decline", "#netl-gdpr-allowOnlyEssential-modal", "#netl-gdpr-allowOnlyEssential", "input[id^='netl-gdpr-cookie-']:checked:not(:disabled)", "#netl-gdpr-update", "netl_gdpr_", "#nhsuk-cookie-banner", "#nhsuk-cookie-banner__link_accept", "[is=tracking-consent] form.tc-banner", "[is=tracking-consent] button[name=tracking_command][value=deny_all]", ".bpPrivacy", ".bpPrivacy .bpPrivacy_button-close", ".govpl.cookie-bar-container", ".govpl.cookie-bar-container .cookiebar-close", ".govpl.cookie-bar-container:not(.cookie-bar-hide) .cookiebar-close", "cookie-message-bar=true", 'div.fixed.rounded-2xl.bg-background-secondary:has(> div.flex > button[class*="btn--skin-secondary___"] + button[class*="btn--skin-primary___"])', 'div.fixed.rounded-2xl.bg-background-secondary > div.flex > button[class*="btn--skin-secondary___"]:first-child', "r_consents=%7B%22required%22%3Atrue%2C%22analytics%22%3Afalse", ".js-ne-piwik-cookies", ".js-ne-piwik-cookies-overlay", ".js-ne-piwik-cookies .ne-piwik-cookies__btn-manage", ".js-ne-piwik-cookies .ne-piwik-cookies", ".ne-piwik-cookies__btn-manage", ".ne-piwik-modal__btn-check-choosen", ".ne-piwik-modal input.ne-piwik-modal__checkbox-input:checked:not(:disabled)", "ppms_privacy_", "%22analytics%22:{%22status%22:0", "ccm-notification", ".cookie-manager .modal-mask", ".cookie-manager .modal-mask .accept-cookie-settings", ".cookie-manager .modal-mask .decline-cookie-settings", '.cookie-manager .modal-mask input[type="checkbox"]:checked:not(:disabled)', ".cookie-manager .modal-mask .save-cookie-settings", "#privacy-banner.nyuuninav--privacy-banner", ".nyuuninav--privacy-banner .nyuuninav--privacy-banner__accept-button", ".nyuuninav--privacy-banner:not(.nyuuninav--privacy-banner--hide)", ".nyuuninav--privacy-banner__accept-button", "privacy_banner=", ".js-occ-gdrp-modal", ".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings", ".js-occ-gdrp-modal.is-visible .js-occ-gdrp-modal__btn-modal-gdpr-settings", ".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings:not(.settings-active)", ".js-occ-gdrp-modal .js-occ-gdrp-modal__btn-modal-gdpr-settings.settings-active", ".js-occ-gdrp-modal .js-cookie-category:checked", "occ_gdpr_settings", '[data-testid="cookies-overlay__container"]', '[data-testid="cookies-overlay__container"] [data-testid="dismiss-cookies-banner"]', "cookieBarSeenV2=true", ".tx-om-cookie-consent", ".om-cookie-panel[data-omcookie-panel]", ".active[data-omcookie-panel]", "[data-omcookie-panel-save=min]", "input[data-omcookie-panel-grp]:checked:not(:disabled)", "[data-omcookie-panel-save=save]", "#oc_cb_wrapper", "#oc_cb_wrapper #oc_cb_btn", "#ocm-container.ocm-container--banner", "#ocm-container.ocm-container--banner .ocm-button--continue", "#ocm-container .ocm-button--continue", "anoConsent=%7B%22categories%22%3A%5B1%2C0%2C0%2C0%5D", "#google-consent-mode", "#google-consent-mode #consent-window-accept", "#google-consent-mode #google-consent-mode-window", "#google-consent-mode #consent-window-reject", "#google-consent-mode #consent-window-customise", "#google-consent-mode-window-customise input[type=checkbox]:checked:not(:disabled)", "google_consent_mode_v2=reject", "analytics_storage=denied", "#o5-legal-banner-container", "#o5-legal-banner-container .o5-legal-banner-container__close", ".orejime-NoticePortal", ".orejime-BannerWrapper", ".orejime-banner-portal", ".orejime-Notice, .orejime-Banner, .orejime-banner-portal .fr-consent-banner, .orejime-ModalWrapper", ".orejime-Notice-declineButton, .orejime-Banner-declineButton, .orejime-banner-portal .fr-consent-banner", ".orejime-Notice-declineButton, .orejime-Banner-declineButton, .orejime-banner-portal .fr-consent-banner__buttons li:nth-child(2) button", ".orejime-ModalWrapper .orejime-AppToggles-disableAll, .orejime-ModalWrapper .orejime-PurposeToggles-disableAll", ".orejime-ModalWrapper .orejime-Modal-saveButton", "#CookieBanner.cookie-banner.drawer", "#CookieBanner.cookie-banner.drawer.opened", ".osano-cm-window,.osano-cm-dialog", ".osano-cm-window", ".osano-cm-dialog:not(.osano-cm-dialog--hidden)", ".osano-cm-denyAll,.osano-cm-deny", ".osano-cm-dialog--type_bar .osano-cm-dialog__close", ".oax_cookie_consent_modal", ".oax_cookie_consent_modal .oax-cookie-consent-select-necessary", ".cookie-banner:has([data-ol-cookie-banner-set-consent])", "[data-ol-cookie-banner-set-consent]", "[data-ol-cookie-banner-set-consent=essential]", "oa", ".cc-window-wrapper:has(> .pd-cookie-banner-window)", "pandectes-cmp", ".cc-window-wrapper > .pd-cookie-banner-window", ".pd-cookie-banner-window .cc-deny", ".pd-cookie-banner-window .cc-settings", ".pd-cp-ui-save", ".pd-cp-ui-rejectAll", ".cookie-opt-in[data-cookie-role='cookie-message']", "[data-cookie-role='cookie-message'] [data-cookie-role='close-and-disallow']", "[data-cookie-role='cookie-message']", "[data-cookie-role='cookie-choice'] [data-cookie-role='manage-settings']", "[data-cookie-role='cookie-settings'] [data-cookie-role='close-and-disallow']", "cookies_disallowed=true", "#passle-cookie-control-container #cookie-control", "#passle-cookie-control-container", "#passle-cookie-control-container.cookie-control_state--open #cookie-control", "#cookie-control .cookie-control--decline", "passleCookieControl={%22Accepted%22:false", "#ccpaCookieContent_wrapper", "#ccpaCookieBanner", "#bannerDeclineButton", "type%3Dexplicit", "#gdprCookieBanner", "#gdprCookieContent_wrapper", "#overlay > .gdprBackgound", "#overlay > .gdprBackgound > .gdprTitle", "#overlay > .gdprBackgound > span[onclick]", "pxCookie=Y", "pe-cookies", "TC_PRIVACY=1%40", ".consent__bar:has([data-cookie-consent-accept-necessary-btn])", ".c-consent__bar:has([data-cookie-consent-accept-necessary-btn])", "[data-cookie-consent-accept-necessary-btn]", ".personalization-request[data-controller='consent']", ".personalization-request [data-action='consent#manage']", "#personalization-settings [data-action='consent#save']", "#personalization-settings input[type=checkbox]:checked:not([disabled])", "consent=essential", ".pieeye-consent-container", '"pieeye-category-targeting-analytics":0', '#consent_block[widget="CookieTracker"]', '#consent_block [widget-attachpoint="basicAgree"]', ".cookie-wrapper .cookie-tip", ".cookie-wrapper .cookie-tip__container", ".cookie-wrapper .cookie-tip__text", ".cookie-wrapper .cookie-tip__button > .button", ".el-dialog.cookie-dialog", ".el-dialog.cookie-dialog .el-switch.is-checked", ".el-dialog.cookie-dialog .el-dialog__footer button.el-button--primary", "allow_analysis=%22false%22", "allow_analysis=false", "#PiwikPROConsentForm-container", ".PiwikPROConsentForm-overlay", "#ppms_cm_popup_overlay", "#PiwikPROConsentForm-container, #ppms_cm_popup_overlay #ppms_cm_reject-all, #ppms_cm_popup_overlay #ppms_cm_disagree", "#PiwikPROConsentForm-container, #ppms_cm_popup_wrapper, #ppms_cm_popup_overlay #ppms_cm_popup", "#ppms_cm_reject-all, #ppms_cm_disagree", "#ppms_consent_form_success_note_button", "#PiwikPROConsentForm-reject-all", "#PiwikPROConsentForm-toggle-details", "#PiwikPROConsentForm-consents", "button.PiwikPROConsentForm-consent-checkbox[aria-checked=true]:not([aria-required=true]), input.PiwikPROConsentForm-consent-checkbox:checked:not(:disabled)", "#PiwikPROConsentForm-save", "%22status%22:0", "#cookies:has(> button.close > span.visuallyhidden)", "#cookies > button.close > span.visuallyhidden", "#cookies", "#cookieBanner", "#cookieBanner #openCookieBannerSettings", "#cookieBannerSettings #CookieBannerSettingsRejectAll", "#cookieBannerSettings", "hpa=true", "[data-cookie-bar]", '[data-cookie-bar] [data-cb="acceptAll"]', '[data-cookie-bar] [data-cb="declineAll"],[data-cookie-bar] [data-cb="saveNecessary"]', '[data-cookie-bar] [data-cb="declineAll"]', '[data-cookie-bar] [data-cb="saveNecessary"]', "plenty-shop-cookie=", "#pr-cookie-notice #btn-cookie-allow", ".pr-cookie-modal:not(._show) #pr-cookie-notice", "#pr-cookie-notice #btn-cookie-decline", "#pr-cookie-notice .pr-cookie-setting-btn", "#pr-cookie-setting-bar .pr-actions-buttons button.decline", "pr-cookie-consent=%5B%5D", "#pmc-pp-tou--notice", 'aside[aria-labelledby="pmc-privacy-banner-heading"], aside[class*="PrivacyPolicyBannerstyles__PrivacyBannerRoot"]', "#onetrust-consent-sdk", "#onetrust-banner-sdk", 'aside[aria-labelledby="pmc-privacy-banner-heading"] button, aside[class*="PrivacyPolicyBannerstyles__PrivacyBannerRoot"] button', "#js-consent-banner", "#js-consent-banner #js-cookie-reject-button", "#js-consent-banner #js-cookie-dismiss-button", "cookie-consent=", "#cookie-consent.c-cookie-banner", "#cookie-consent.c-cookie-banner .c-cookie-banner__quickform", "#cookie-consent .c-cookie-banner__quickform input[name='Purpose.Statistics'][value='False'] ~ input[type='submit']", "%22statistics%22%3Afalse", "#spopupCont", "#spopupCont #poper #cookie-btn.spopupbtnok", "#spopupCont #poper", ".cookiesBanner", ".cookiesBanner .wrapper-cookies", "#acb-banner", "#acb-banner #acb-accept-all-button", "#acb-banner #acb-deny-all-button", "#acb-banner input.acbCheckbox:checked:not([disabled])", "#acb-banner #acb-close-button", "PrestaShop-49722c247d445ea6ad5f50ec8153945a=0", ".gdpr-wrapper", ".gdpr-wrapper .gdpr-cookie-wrapper", "#cookie-bar .cb-enable,#cookie-bar .cb-disable,#cookie-bar .cb-policy", "#cookie-bar .cb-disable", "cb-enabled=accepted", ".azpp-cookie-consent", '"status":"reject_all"', '"status":"do_not_sell"', ".privacyArea", ".privacyArea .privacyTrigger.acceptAll", "#modulePrivacy .privacyTrigger.acceptCustom", ".privacyArea .privacyTrigger.rejectOptional", "#modulePrivacy input[type=checkbox]:checked", 'privacy={"necessary":"ok"}', ".privacy_policy_pop:has(> #closeGdpr, > #agreepolicy)", ".privacy_policy_pop > #closeGdpr, .privacy_policy_pop > #agreepolicy", ".privacy_policy_pop", ".c-cookie-banner-main.c-consent-window", ".c-cookie-banner .c-cookie-banner-main.c-consent-window", '.c-cookie-banner-main.c-consent-window[style*="visibility: visible"]', ".c-cookie-banner-main .c-cookie-banner-header-refuse-btn", 'elmo_vc={"purposes":["necessary"]', "#pro_euclp_cookies_box", "#pro_euclp_cookies_box .pro_euclp_accept", '[class*="notifycation_notifycation__"]', '[class*="notifycation_notifycation__"] button[class*="notifycation_notifycationBtn__"]', "#euCookiesZone .european-union-cookies-agreement", "body[data-page-initialized=true]", "#euCookiesZone [data-testid=cookieBannerDismiss]", "EUCookieOff=t", "#pubtech-cmp", "#pubtech-cmp #pt-actions", "#pubtech-cmp #pt-close", '#pubtech-cmp a[href*="pubtech_action_reject_all"]', "#cookieConsentContainer", '#cookieConsentContainer [onclick^="purecookieDismiss"], script[src*="purecookie"]', ".ReactModalPortal:has([data-testid='CookieNotice-main-wrapper'])", "[data-testid='CookieNotice-main-wrapper'] [data-testid='reject-cookies-pvh-button']", "[data-testid='CookieNotice-main-wrapper']", "PVH_COOKIES_GDPR_ANALYTICS=Reject", "xpath///div[@id='qtip-growl-container']/div[contains(@class,'qtip-jgrowl')][.//div[contains(@class,'qtip-title')][contains(., 'ookie')]]", "xpath///div[@id='qtip-growl-container']/div[contains(@class,'qtip-jgrowl')][.//div[contains(@class,'qtip-title')][contains(., 'ookie')]]//a[contains(@class,'qtip-close')]", "#qc-cmp2-main,#qc-cmp2-container", "#qc-cmp2-container", "#qc-cmp2-ui,#qc-cmp2-usp", "#qc-cmp2-usp", "#qc-cmp2-usp .qc-cmp2-list-item-header,#qc-cmp2-usp .qc-cmp2-toggle-switch", "#qc-cmp2-usp .qc-cmp2-list-item:not(:has(.qc-cmp2-toggle-switch)) > .qc-cmp2-list-item-header", "#qc-cmp2-usp .qc-cmp2-toggle-switch", '#qc-cmp2-usp .qc-cmp2-toggle-switch > button[aria-checked="false"]', '#qc-cmp2-usp .qc-usp-ui-form-content button[mode="primary"]', "#qc-cmp2-mspa-success-modal button", "#disagree-btn", "#disagree-btn:not([disabled])", '.qc-cmp2-summary-buttons button[mode="secondary"]', '.qc-cmp2-summary-buttons button[mode="secondary"]:nth-of-type(2)', '.qc-cmp2-summary-buttons button[mode="secondary"]:nth-of-type(1)', "#qc-cmp2-ui .qc-cmp2-consent-info", '.qc-cmp2-toggle-switch > button[aria-checked="true"]', "#qc-cmp2-ui", ".qc-cmp2-buttons-desktop > button[mode=primary]", ".cookieconsent-popup:has(.ui-icon-wrench)", ".cookieconsent-popup .cookieconsent-button-wrap button:has(.ui-icon-wrench)", ".cookieconsent-edit-settings .cookieconsent-level-changer", ".cookieconsent-level-changer > a:nth-of-type(2).activated", ".cookieconsent-level-changer > a:first-of-type", ".cookieconsent-edit-settings .cookieconsent-dialog-close-btn", ".cookieconsent-edit-settings .cookieconsent-dialog-close", "cookie_consent_level=", "cookie_consent_level=tracking", "cookie_consent_level=targeting", "cookie_consent_level=functional", "#cookie-consent .qcmp-modal", "#cookie-consent .qcmp-modal__content", "#qcmp-options-toggle", "#qcmp-options .qcmp-options__save button", '#qcmp-options .qcmp-toggle__button[aria-checked="true"]', "#consent_iframe", "_svs=%7B%22v%22%3A1%2C%22c%22%3A%7B%221%22%3Atrue%2C%222%22%3Afalse%2C%223%22%3Afalse", "#r42CookieBar", "#r42CookieBar .cw-deny", "#r42CookieBar[open] .cw-deny", "#st_popup #st_popup_declineButton", "#st_popup", "feature-modular-cookiebanner-variant-one .cookiebanner-container", "#modular-cookiebanner-variant-one-consent-level-button-1", "feature-modular-cookiebanner-variant-one .cookiebanner-default-consent-button", "RABO_PSL=1", "[data-component=RADCookieOverlay] .CookieOverlay", "[data-component=RADCookieOverlay] .CookieOverlay_Buttons", "[data-component=RADCookieOverlay] .CookieOverlay_ButtonGroup > button:nth-child(2)", "cookie=False", "#js-legal-disclaimer.g-alert-cookie, #js-legal-disclaimer.cookie-consent-banner, #info-shell-legal-disclaimer, #oh-shell-legal-disclaimer", ".radish-cookie-bar", ".radish-cookie-bar .cookie-bar-settings .cookie-approve", ".radish-cookie-bar .cookie-bar-footer > .cookie-bar-buttons .cookie-settings-toggle", ".radish-cookie-bar .cookie-bar-settings", ".radish-cookie-bar .rcc-allow-cookie-type:checked:not(:disabled):not([data-cookietype='functional'])", "#raksha-consent-banner", "#raksha-consent-overlay", "#raksha-decline", "#raksha-manage", "#raksha-btn-reject", "#cookie-policy-notification.r-sdk__policy-notification", "#cookie-policy-notification .r-sdk__button", "terms-notification=true", "#_cpmt-iframe", ".rct-cookies-modal-trigger > div", ".rct-cookies-modal-trigger .mt-4 > button:first-child", ".rct-cookies-modal-trigger ul input[type=checkbox]", "isCookiesBannerDismissed=true", "#concentBanner", "#concentPopup", "#concentBanner .rdc-save-preferences, #concentPopup .rdc-save-preferences", "#concentBanner, #concentPopup", "#rcc-decline-button", "*:has(> * > #rcc-confirm-button):not(:has(#rcc-decline-button))", "#rcc-confirm-button", "*:has(> * > #rcc-confirm-button) button:not(#rcc-confirm-button)", "*:has(> * > #rcc-confirm-button)", '*:has(> * > * > #rcc-confirm-button)[style*="position: fixed"][style*="height: 100%"]', 'div[consent-skip-blocker="1"][id][data-bg]', 'div[consent-skip-blocker="1"][id][data-bg] > dialog > div > div > div > div > div > a[role=button][id]', "xpath///div[@consent-skip-blocker='1'][@id][@data-bg]/dialog//a[@role='button'][not(@id)][contains(., ' ohne ') or contains(., 'without') or contains(., 'blehnen') or contains(., 'notwendig') or contains(., 'ssenziell') or contains(., 'ssential') or contains(., 'eject') or contains(., 'ecline') or contains(., 'Deny') or contains(., 'Afvis') or contains(., 'Avvis') or contains(., 'Refuse') or contains(., 'Weiger') or contains(., 'Rifiut') or contains(., 'Rechaz')]", '#cookie:has(a.remove_cookie[onclick*="/cookie/close"])', "xpath///div[@id='cookie']//a[contains(@class,'remove_cookie') and contains(@onclick,'/cookie/close') and (normalize-space(.)='OK' or normalize-space(.)='x' or normalize-space(.)='\xD7')]", '#cookie a.remove_cookie[onclick*="/cookie/close"]', "#cookie", '#notification-bar:has(> #close-notification[aria-label="Sluit de cookiebanner"])', '#notification-bar > #close-notification[aria-label="Sluit de cookiebanner"]', "#notification-bar", "#notification-bar > #close-notification", "cookie_notification_shown=true", ".consent-banner .consent--manage", ".consent-banner .consent-banner-copy", ".consent-modal .consent-bucket", ".consent-modal input[type=checkbox]:checked", ".consent-modal .consent-save", "cookie-consent-dialog", ".rws-app > .cookie-modal", "xpath///div[contains(@class, 'rws-app')]/div[contains(@class, 'cookie-modal')]//div[contains(@class, 'buttons')]//button[contains(normalize-space(.), 'n\xF6dv\xE4ndiga')]", "cookiesApproved=%5B%22REQUIRED%22%5D", "#xcm-bar.xcm-bar", "#xcm-bar.xcm-bar #xcm-btn", "#xcm-bar.xcm-bar:not(.xcm-bar-hide)", "#xcm-bar #xcm-btn", "#xcm-bar.xcm-bar-hide", "#mode-cookie-tip", "#mode-cookie-tip .cookie-tip-close", "cookie_tip_close=1", "#consent-wrapper", "#consent-wrapper > .button-container > button.close", "cookie_consent_status=", "#fg-consent-banner", "#ff-consent-banner", '[id$="-consent-banner"] .consent-checkbox[data-key="ad_storage"]', '[id$="-consent-banner"] #consent-reject-all', '[id$="-consent-banner"]', "dialog[aria-labelledby='cookie-dialog-title']:has(#deny-consent-button)", "dialog[aria-labelledby='cookie-dialog-title'] #deny-consent-button", "dialog[aria-labelledby='cookie-dialog-title'][open]", ".sv-cookie-management__banner", ".sv-cookie-management__banner.sv--visible", ".sv-cookie-management__banner .sv-manage-cookies", ".sv-cookie-management__modal--visible", "#functional-cookies:checked", "label[for='functional-cookies']", "#tracking-cookies:checked", "label[for='tracking-cookies']", ".sv-cookie-management__modal--visible .sv-save-close", "#scCookieBanner:has(.sc-cookie-reject)", "#scCookieBanner .sc-cookie-reject", "#scCookieBanner", "_consent=denied", '[data-module="ds-cookie-notification"]', '[data-module="ds-cookie-notification"] .js-accept-essential-cookies', "cookiePermissions=eyJuZWNlc3NhcnkiOnRydWUsInByZWZlcmVuY2VzIjpmYWxzZSwic3RhdGlzdGljcyI6ZmFsc2UsImNhbXBhaWducyI6ZmFsc2UsIm1hcmtldGluZyI6ZmFsc2V9", "scriptex-consent-banner", ".f-cmp-flyout-wrapper .f-gpc-banner", ".f-cmp-flyout-wrapper .f-gpc-banner .f-banner-close-btn", ".cc-window", ".f-gpc-banner .f-banner-close-btn", ".f-gpc-banner", '.cc-type-hybrid[aria-describedby="cookieconsent:desc"]', '.cc-type-hybrid[aria-describedby="cookieconsent:desc"]:not(.cc-invisible) .cmp-pref-link', '.cc-type-hybrid[aria-describedby="cookieconsent:desc"]:not(.cc-invisible)', '.cc-type-hybrid[aria-describedby="cookieconsent:desc"]:not(.cc-invisible) .cc-deny', ".cmp-body input[type=checkbox]:checked:not(:disabled)", "#gdpr-cookie", "#gdpr-cookie .js-allow-required", "gdpr-cookie=eyJwcmVmZXJlbmNlIjpmYWxzZSwic3RhdGlzdGljIjpmYWxzZSwibWFya2V0aW5nIjpmYWxzZX0", "div.cookie-banner[role=alert] input#marketing-cookies", "div.cookie-banner[role=alert]", "div.cookie-banner[role=alert] input.form-check-input:checked:not([disabled])", "div.cookie-banner[role=alert] button[aria-label='Nur ausgew\xE4hlte Cookies erlauben']", ".cookies-pdpa.fixed-bottom", ".cookies-pdpa.fixed-bottom .btn-submit-pdpa", ".stpd_cmp_wrapper", ".stpd_cmp_wrapper .stpd_cmp_form", '.stpd_cmp_wrapper .stpd_flexed_btns button[type="submit"]', '.stpd_cmp_wrapper .stpd_flexed_btns button[type="button"]:not(.withdraw_consent)', ".stpd_cmp_wrapper .stpd_purposes_list", '.stpd_cmp_wrapper input[type="checkbox"]:checked', "euconsent-v2=", "#SgCookieOptin", "#SgCookieOptin .sg-cookie-optin-banner-button-accept-essential, #SgCookieOptin .sg-cookie-optin-box-button-accept-essential", "cookie_optin=", "#sg-cookiesBar #cookies-bar", "#sg-cookiesBar", "#sg-cookiesBar .btn-disable-all, #sg-cookiesBar .cookies-decline-all, #sg-cookiesBar #cookies-manage-save-modal", "#sg-cookiesBar #cookies-bar .btn-disable-all", "#sg-cookiesBar .cookies-decline-all", "#sg-cookiesBar input[type=checkbox][id$=-modal]:checked:not(:disabled)", "#sg-cookiesBar #cookies-manage-save-modal", "sg-cookies-", "-consent=1", ".cookie-pop-up-wrapper", ".cookie-pop-up-wrapper #let-me-choose-content #cookie-confirm-choices", ".cookie-pop-up-wrapper #cookie-pop-up-content", ".cookie-pop-up-wrapper #let-me-choose", "#let-me-choose-content", "#let-me-choose-content input.cookie-checkbox:checked:not(:disabled)", "#let-me-choose-content #cookie-confirm-choices", "optout=", ".consents-modal", ".consents-modal__footer consents-accept-necessary", "#InfoCookieTlo", "#CookieOknoUstawien", "#InfoCookie.DolnaInformacjaCookie, #InfoCookieIntegracje.DolnaInformacjaCookie", "#InfoCookieIntegracje", "xpath///div[@id='InfoCookie']//span[@id='InfoAkcept'][contains(., 'Nie pokazuj')]", "#InfoTylkoNiezbedneIntegracje", "#InfoUstawieniaIntegracje", "#CookieOknoUstawien input[type=checkbox]:checked:not(:disabled)", "#CookieOknoUstawien .GotoweCookieOkno span", "akceptCookie=tak", "#shopify-pc__banner", "#shopify-pc__banner__btn-decline", "#dux-privacy", '#dux-privacy [data-component-name="reject"]', '#dux-privacy:not([style*="opacity: 0"]) [data-component-name="reject"]', '#dux-privacy[style*="opacity: 0"]', ".cookie-permission-container[data-cookie-permission]", ".cookie-permission-container[data-cookie-permission] .js-cookie-configuration-button", ".cookie-permission-container .js-cookie-permission-button", ".cookie-permission-container .js-cookie-permission-button button", ".cookie-permission-container .js-cookie-configuration-button button", ".js-offcanvas-cookie-submit", "cookie-preference=1", ".page-wrap--cookie-permission[data-cookie-permission]:not(.spx-cookie-wrapper)", ".page-wrap--cookie-permission[data-cookie-permission]:not(.spx-cookie-wrapper) .cookie-permission--decline-button", ".page-wrap--cookie-permission[data-cookie-permission]:not(.spx-cookie-wrapper) .cookie-permission--configure-button[data-openconsentmanager]", ".page-wrap--cookie-permission[data-cookie-permission]", ".js--modal.cookiePermissions", ".page-wrap--cookie-permission .cookie-permission--decline-button", ".js--modal.cookiePermissions .cookie-permission--configure-button, .page-wrap--cookie-permission:not(.is--hidden) .cookie-permission--configure-button", ".cookie-consent--save-button", "#cookie-consent.is--open .cookie-consent--close", ".page-wrap--cookie-permission[data-cookie-permission], .js--modal.cookiePermissions", "cookieDeclined=1", '"active":false', ".page-wrap--cookie-permission.spx-cookie-wrapper", ".page-wrap--cookie-permission.spx-cookie-wrapper:not(.is--hidden) .cookie-permission--configure-button", ".page-wrap--cookie-permission.spx-cookie-wrapper .cookie-permission--configure-button", ".js--overlay.is--open", ".off-canvas.is--open #js-spx-cookie-decline-button", "footer.pageFooter #cookieBanner.cookieBanner", "footer.pageFooter #cookieBanner.cookieBanner.visible", ".js-top-modal-window-container", ".js-top-modal-window-container .modal-link[href*='shueisha.co.jp/privacy']", ".js-top-modal-window-container .js-top-modal-content", ".js-top-modal-window-container button.close-modal.js-top-modal-close-button", ":is(#cookieBanner, .fixed_cookie_banner):has(a[href*='shueisha.co.jp/privacy'])", ":is(#cookieBanner, .fixed_cookie_banner):has(a[href*='shueisha.co.jp/privacy']) :is(#cookieBannerCloseButton, .cookieBannerCloseButton)", "#sicredi-cookies-root .banner-container", "#sicredi-cookies-root", '#sicredi-cookies-root [data-testid="banner"]', '#sicredi-cookies-root [data-testid="management-cookies-button"]', '#sicredi-cookies-root [data-testid="reject-config-button"]', "#silktide-banner", "#silktide-backdrop", "#silktide-banner .reject-all", "#silktide-banner .preferences", "#silktide-modal .preferences-reject-all", ".contentRender_name_plugins_common_cookie_banner", ".contentRender_name_plugins_common_gdpr_banner", ".contentRender_name_plugins_common_cookie_banner [data-sv-close-banner], .contentRender_name_plugins_common_gdpr_banner [data-sv-close-banner]", ".contentRender_name_plugins_common_cookie_banner > :has([data-sv-close-banner]), .contentRender_name_plugins_common_gdpr_banner > :has([data-sv-close-banner])", ".contentRender_name_plugins_common_cookie_banner, .contentRender_name_plugins_common_gdpr_banner", "#sd-cmp", "#sd-cmp [role='dialog']", "#sd-cmp [role='button'][title='Close']", '[data-t="site-notifications"] [data-notice-key="cookie_usage"]', ".privacy-warning.permisive", ".privacy-warning.permisive .close", ".privacy-warning.permisive .close a, .privacy-warning.permisive .close button", ".SP-CookieUsageNotification", "xpath///button[contains(@class,'SP-CookieUsageNotification__ok')][normalize-space(.)='OK' or normalize-space(.)='Ok' or normalize-space(.)='Okay']", ".SP-CookieUsageNotification[data-sp-cookie-usage-notification-bootstrapped]", ".SP-CookieUsageNotification__ok", ".sv-cookie-consent-banner", '.sv-cookie-consent-banner form:has(input[name="necessary"]):not(:has(input[name="analytics"])) button[type="submit"]', '.sv-cookie-consent-banner button[type="button"]', '.sv-cookie-consent-banner button[type="submit"][form]', '.sv-cookie-consent-banner form input[type="checkbox"]:checked:not(:disabled)', ".sv-cookie-consent-modal", ".sv-cookie-consent-modal form:has(input[name=necessary]):not(:has(input[name=analytics])) button[type=submit]", ".sv-cookie-consent-modal .env-dialog__controls > button[type=button]", ".sv-cookie-consent-modal button[type=submit][form]", ".sv-cookie-consent-modal form input[type=checkbox]:checked:not(:disabled)", ".sv-iw-cookie #cookie-banner", ".sv-iw-cookie #cookie-banner button:nth-of-type(3)", ".sv-iw-cookie #cookie-banner button:nth-of-type(2)", ".sv-iw-cookie #cookie-banner button:first-of-type", ".sv-iw-cookie #cookie-modal", ".sv-iw-cookie #cookie-modal input[type=checkbox]:checked:not(:disabled)", ".sv-iw-cookie #cookie-modal > div > button:first-of-type", "#cookieBannerModal #cookie_consent_manage_accept_modal", "#cookieBannerModal.is-open .cc-dialog", "#cookieBannerModal [data-cc-open=cookieConsentModal]", "#cookieConsentModal.is-shown .cc-dialog", "#cookieConsentModal input[type=checkbox]:checked:not(:disabled)", "#cookieConsentModal #cookie_consent_manager_confirm_top, #cookieConsentModal #cookie_consent_manager_confirm", "consent_set=true", "consent_marketing=false", "consent_analytics=false", ".block-cookie:has(.cookiebtns #cookie-required)", ".block-cookie .cookiebtns #cookie-required", "cookie-disclaimer=0", "cookie-disclaimer=0%2C", ".cookiePopup:has(#cookies .cookieWrapper)", ".cookiePopup #cookies .cookie-actions .cookie-btn.deny", ".cookiePopup #cookies .cookieWrapper", ".cookiePopup #cookies .cookie-btn.deny span", ".cookiePopup", "%22marketingOnOff%22%3Afalse", ".js-message.skrppp", ".js-message.skrppp #accept-essential", "policy_level=%7B%22essential%22%3A%22true%22%2C%22performance%22%3A%22false%22%2C%22preference%22%3A%22false%22%2C%22targeting%22%3A%22false%22%7D", "#cookie-manager-window", "#cookie-manager-window #cookie-manager-consent", "#cookie-manager-consent input.form-check-input[type=checkbox]:checked:not([disabled])", "#cookie-manager-window #accept-selected", "%22AllowAnalytics%22%3Afalse", ".w-cookie", ".w-cookie-modal .w-cookie-actions button[name=accept]", ".w-cookie-modal .w-cookie-form", ".w-cookie-modal .w-cookie-option input[type=checkbox]:checked:not([disabled])", "cookie_consent=REQUIRED", ".snigel-cmp-framework", "#sn-b-custom", "#sn-b-save", "snconsent", "#cookie_modal", "#cookie_modal #id_cookies_necessary", "#cookie_modal #id_cookies_all", "#cookiebar-tra", "#cookiebar-tra #cb-RejectAll, #cookiebar #cb-RejectAll", "#cb-RejectAll", "cookieConsent=", ".sol-cookie-message", ".sol-cookie-message .sol-cookie-ok", ".cookies-banner .cookies-banner__button-group .cookies-banner__reject", ".cookies-banner .cookies-banner__reject", "_SC_analytics=reject", "#cookies_message", "#cookies-message-modal", "#cookies-close-deny, #cookies_frame > #cookies_close", "#cookies-close-deny", "#cookies_frame > #cookies_close", "cookies_message_bar_hidden=true", "cookies_google_targeting=false", "cookies_message_hidden=true", "body > div[id^='sp_message_container_']", ".cookiebar:has(.cookiebar-ko)", ".cookiebar .cookiebar-buttons .cookiebar-ko", "#opt-in .optin", "#opt-in .optin #optin--acceptAll", "#opt-in #optin--rejectAll, #opt-in #optin--onlyNeeded", ".popup-box.popup-cookie:has(.popup-default-box [data-accept])", ".popup-box.popup-cookie .popup-default-box [data-accept]", ".popup-box.popup-cookie", ".popup-box.popup-cookie .popup-close", "dialog.modal-overlay:has(.kaiserschmarn-banner)", ".kaiserschmarn-banner", ".kaiserschmarn-banner button.light-green", ".kaiserschmarn-banner .checkbox-option", ".kaiserschmarn-banner .checkbox-option input:checked:not([disabled])", "acceptSpusuCookies=necessary", ".cookie-banner-mount-point", ".cookie-banner-mount-point section.gdpr-cookie-banner :is(button.decline, button.manage)", ".cookie-banner-mount-point section.gdpr-cookie-banner", ".cookie-banner-mount-point button.decline", ".cookie-banner-mount-point button.manage", ".cookie-banner-manager .manage-cookies-overlay", ".cookie-banner-manager .manage-cookies-overlay label.sqs-toggle--on input", ".cookie-banner-manager .manage-cookies-overlay button.save", ".cookie-banner-mount-point section[aria-label='Cookie banner'] button.accept", ".cookie-banner-mount-point section[aria-label='Cookie banner'] :is(button.decline, button.manage)", ".cookie-banner-mount-point section[aria-label='Cookie banner']", "#cookie-consent-banner #accept-cdp-cookie", "#reject-cdp-cookie", "squiz.cdp.consent", "[x-data='consentBanner'] button[\\@click*='consentBanner.acceptAll']", "[x-data='consentBanner']", "[x-data='consentBanner'] button[\\@click*='consentBanner.rejectAll']", "[x-data='consentBanner'] button[\\@click*='expanded = true']", "[x-data='consentBanner'] input[type='checkbox'][x-model]:checked:not(:disabled)", "[x-data='consentBanner'] button[\\@click*='consentBanner.saveConsent']", ".cookiepreferences_popup", "#rejectAllButton", "#_psaihm_main_div", "#_psaihm_overlay", "#_psaihm_main_div #_psaihm_id_accept_all_btn", "#_psaihm_refuse_all", "#_psaihm_button_param_accept", "#_psaihm_table_container input._psaihm_consentbox:checked", "#_psaihm_continue_without_accepting", "_psac_gdpr_consent_given=1", "_psac_gdpr_consent_purposes=;", "#GDPRConsentManagerContainer", "#GDPRConsentManagerContainer [data-atx-component='cookieConsent']", "#GDPRConsentManagerContainer #explicit_consent", "#GDPRConsentManagerContainer #ccmgt_explicit_preferences", "#GDPRConsentManagerContainer #ccmgt_preferences_reject", "CONSENTMGR=c1:0%7Cc2:0%7Cc3:0", ".js-cookie-banner.cookie-banner", ".js-cookie-banner.cookie-banner #cookie-banner__settings .js-cookie-settings__form", ".js-cookie-banner.cookie-banner .cookie-banner__actions .js-cookie-banner-settings-btn", "#cookie-banner__settings .js-cookie-settings__form", "#cookie-banner__settings .js-cookie-settings__checkbox:checked:not(:disabled)", "#cookie-banner__settings .cookie-settings__submit-btn", "-consent-necessary=1", "#controlled_banner-cookie_consent-consent_banner", "#controlled_banner-cookie_consent-privacy_setting_banner", "#controlled_banner-cookie_consent-consent_banner [data-search-key-button=reject_all_text]", "#controlled_submit-cookie_consent-consent_banner-privacy_setting_banner_link", "#controlled_banner-cookie_consent-privacy_setting_banner [data-search-key-button=reject_all_text]", "#controlled_banner-cookie_consent-privacy_setting_banner [role=checkbox][aria-checked=true]", "#controlled_banner-cookie_consent-privacy_setting_banner [data-search-key-button=save_settings_text]", '#cookie_banner.cookie-banner:has(> a#cookie_banner_accept[href*="/accept_cookie/"]), #page > div.busi:has(> a[href*="/accept_cookie/"])', '#cookie_banner.cookie-banner > a#cookie_banner_accept[href*="/accept_cookie/"], #page > div.busi > a[href*="/accept_cookie/"]', '#cookie_banner.cookie-banner, #page > div.busi:has(> a[href*="/accept_cookie/"])', '[data-testid="CookiesReminder"]', '[data-testid="CookiesReminder"] [data-testid="CookiesManage"]', "body:not(.disable-transition)", "dialog[open] .cookies-select-modal", "dialog[open] .cookies-select-modal .cookies-select-modal__buttons .ds-btn-apply-2-ds", " c=%7B%22essential", '.cc-window.cc-type-opt-change[aria-describedby="cookieconsent:desc"]', '.cc-window.cc-type-opt-change[aria-describedby="cookieconsent:desc"]:not(.cc-invisible)', ".cc-window.cc-type-opt-change .cc-deny", ".cc-window.cc-type-opt-change", "div[class*=cookieBanner].pencraft", "hideCookieBanner=", "#CookieConsentBannerPlaceholder", "#CookieConsentBannerPlaceholder .cookies-banner-container", "#consCookie.popup-overlay", "#consCookie.popup-overlay .cajaSetting", "#consCookie.popup-overlay .contenedorCookies", "#consCookie a.setting:not(.preferencias)", "#consCookie a.setting.preferencias", "#consCookie .cajaSetting input[type=checkbox]:checked:not(:disabled)", "CONS=100", "CONS=000", "ui-cookie-consent .ui-cookie-consent__decline-button", "#cookie-bar.cookie-bar", "#cookie-bar #cookie-settings__save-settings, #cookie-bar #cookie-bar__settings-open", "#cookie-bar:not(.cookie-bar--hidden)", "#cookie-bar__settings-open", "#cookie-settings #cookie-settings__save-settings", "input[name='swis-avg-allow-stats']:checked", "input[name='swis-avg-allow-tracking']:checked", "#cookie-settings__save-settings", "SWIS_AVG_ALLOW_STATS=false", "SWIS_AVG_ALLOW_TRACKING=false", ".js-consent-modal", ".js-consent-modal #validate_cookie_btn, .js-consent-modal #validate_cookie_foreign_btn", ".js-consent-modal .modal-content", ".js-consent-modal #validate_cookie_foreign_btn", ".js-consent-modal #unfold_cookie_btn", ".js-consent-modal .cookie-selection", ".js-consent-modal .cookie-selection input[type=checkbox]:checked:not(:disabled)", ".js-consent-modal #validate_cookie_btn", "_gtm_consent_prod=", ".syno_cookie_element", ".syno_cookie_element .btn_option", ".syno_cookie_element .scb_dialog_body", ".syno_cookie_element.scb_dialog input[type=checkbox]:checked:not(:disabled):not([readonly])", ".syno_cookie_element.scb_dialog .scb_btn_save", "syno_confirm_v5_answer", '"targeting":false', 'div:has(> div:has(> a[aria-label="learn more about cookies"]) + div.t-cookie-bar)', 'div:has(> a[aria-label="learn more about cookies"]) + div.t-cookie-bar', "div.t-cookie-bar", "#consent-banner-main", "#consent-banner-modal", '#consent-banner-modal a[href="#reject"]', '#consent-banner-modal a[href="#settings"]', "#consent-banner-settings", '#consent-banner-settings a[href="#reject"]', '#consent-banner-settings input[type="checkbox"]:checked:not(:disabled)', '#consent-banner-settings a[href="#save"]', "#consent-banner-modal, #consent-banner-settings", "#cms-web-consent-modal", "#cms-web-consent-root #cms-web-consent-modal", "#cms-web-consent-modal [data-cy=consent-agree-necessary]", "tlnk_cwc=necessary_cookies=true", "marketing_cookies=true", "#tarteaucitronRoot", "#tarteaucitronAllDenied2", "#tarteaucitronCloseAlert", ".dsgvoaio-checkbox", ".dsgvoaio-checkbox > input:checked", "#tarteaucitronPersonalize", "#tarteaucitronAllDenied", "#tarteaucitronClosePanel", "#taunton-user-consent__overlay", "#taunton-user-consent__overlay:not([aria-hidden=true])", "#taunton-user-consent__toolbar input[type=checkbox]:checked", "#taunton-user-consent__toolbar button[type=submit]", "taunton_user_consent_submitted=true", "#tccCmpAlert", "xpath///span[contains(.,'Accetta solo cookie necessari')]", "#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs,#__tealiumImplicitmodal,#consent-layer", "#__tealiumGDPRecModal *,#__tealiumGDPRcpPrefs *,#__tealiumImplicitmodal *", "#__tealiumGDPRecModal #rejectAll,#__tealiumGDPRcpPrefs #preferences_prompt_reject_all_submit", "#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs,#__tealiumImplicitmodal", "#cm-acceptNone,.js-accept-essential-cookies,#continueWithoutAccepting,#no_consent,#consent_prompt_decline,#teal-decline-consent,#deny_full_submit_1", "#__tealiumGDPRecModal,#__tealiumGDPRcpPrefs > *", "div[data-cookie-consent]:has(> button[data-cookie-consent-close])", "div[data-cookie-consent] > button[data-cookie-consent-close]", "#termly-code-snippet-support", "#termly-code-snippet-support div", '[data-tid="banner-decline"]', '.t-preference-button,[data-testid="preferences-link"]', ".t-declineAllButton", ".t-preference-modal input[type=checkbox][checked]:not([disabled])", ".t-saveButton", ".termsfeed-com---nb", ".freeprivacypolicy-com---nb", ".privacypolicies-com---nb", ".iwt-com---nb", ".termsfeed-com---nb,.freeprivacypolicy-com---nb,.privacypolicies-com---nb,.iwt-com---nb", ".cc-nb-reject", ".cc-nb-changep", 'input[cookie_consent_toggler="true"]', 'input[cookie_consent_toggler="true"]:checked', ".cc-cp-foot-save", ".cc_dialog.cc_css_reboot,.cc_overlay_lock", ".cc_dialog.cc_css_reboot", ".cc_dialog.cc_css_reboot button.cc_b_cp:last-of-type", ".cookie-consent-preferences-dialog .cc_cp_f_save button", "#reject-all", "#privacy-test-page-cmp-test", "#privacy-test-page-cmp-test-prehide", "#privacy-test-page-cmp-test-banner", "#tiGDPRecModal,#tiGDPRcpPrefs", "#tiGDPRecModal #consent_pref_center", "#tiGDPRecModal .privacy_prompt", "#consent_pref_center", "#tiGDPRcpPrefs .privacy_prompt", "#tiGDPRcpPrefs input.cookie-custom-checkbox:checked", "#preferences_prompt_submit", "c1:0%7Cc3:0%7Cc6:0%7Cc7:0", "#tinycookie-wrapper", "#tinycookie-wrapper .tinycookie-button:not(.tinycookie-accept-all)", "#tinycookie-wrapper .tinycookie-main-buttons > .tinycookie-button:not(.tinycookie-accept-all)", "#tinycookie-wrapper .tinycookie-buttons > .tinycookie-button:not(.tinycookie-accept-all)", "#tinycookie-preferences-wrapper", "#tinycookie-preferences-wrapper .tinycookie-preferences-required", "#tinycookie-preferences-wrapper .tinycookie-preferences-preference-checkbox:checked:not([disabled])", "#tinycookie-preferences-wrapper .tinycookie-preferences-save", "tinycookie_acc=req", "tinycookie_acc=req,", ".tna-cookie-banner", '.tna-cookie-banner button[value="reject"]', '.tna-cookie-banner__message--prompt button[value="reject"]', '.tna-cookie-banner__message--rejected button[value="close"]', "cookie_preferences_set=true", "%22usage%22%3Afalse", "#cookie-banner.visible", "#cookie-banner .cookie-banner__container [data-cookie-preferences-button]", "#cookie-banner.visible .cookie-banner__container", "#ensModalWrapper", "#cookie-banner.visible [data-cookie-preferences-button]", "#ensModalWrapper #ensSave", "#consentModalOverlay", "#ensModalWrapper[tabindex]", "#ensModalWrapper .ensCheckbox:checked:not(:disabled):not(#EssentialCookiesSlide)", "ENSIGHTEN_PRIVACY_TargetingCookies=0", ".tp-dialog.cookie-dialog", ".tp-cookie-banner", ".tp-dialog.cookie-dialog, :not(.tp-cookie-banner-tpl) > .tp-cookie-banner .show-cookie-dialog, #tp-cookie-banner > .tp-cookie-banner + .el-dialog__wrapper", ".tp-dialog.cookie-dialog button", ":not(.tp-cookie-banner-tpl) > .tp-cookie-banner .show-cookie-dialog", "#tp-cookie-banner > .tp-cookie-banner .tp-cookie-button-box", "#tp-cookie-banner > .tp-cookie-banner .tp-cookie-button-box .el-button--default", "#tp-cookie-banner > .el-dialog__wrapper", "#tp-cookie-banner > .el-dialog__wrapper .el-dialog__footer", "#tp-cookie-banner > .el-dialog__wrapper .el-dialog__footer button.is-plain:first-child", ".tp-dialog.cookie-dialog .tp-dialog-box", ".tp-dialog-box .tp-cookie-opt-out", ".tp-dialog-box .checkbox.clickable.checked", ".tp-dialog-box .tp-cookie-save", "_privacy_base=1", "_privacy_marketing=1", ".my-cookie-wrapper.cc-window", '.my-cookie-wrapper [aria-describedby="cookieconsent:desc"] .cc-reject-all', '.my-cookie-wrapper:not(.cc-invisible) [aria-describedby="cookieconsent:desc"] .cc-reject-all', "cookieconsent_dismissed1=reject_all", 'div.aem-page > div[class^="CookiesAlert_cookiesAlert__"]', "#transcend-consent-manager", 'dialog [data-testid="cookieBannerV2"]', '[data-testid="cookieBannerV2.rejectLink"]', "cookieConsentChoices=functional:true|analytics:false|marketing:false", '[class^="app_gdpr--"] button', '[class^="app_gdpr--"] div > button:first-of-type:nth-last-of-type(2)', '[class^="app_gdpr--"] div > button:nth-of-type(2):nth-last-of-type(2)', "tt_cons_addtl=", "pubConsent=", ".trillian-cookie-consent-banner", ".trillian-cookie-consent-banner .tpc2-reject-all", "t_privacy_confirmed=true", "#truendo_container .tru_cookie-dialog_wrapper", ".tru_cookie-dialog_accept-only", ".tru_cookie-dialog_accept-only .tru_cookie-dialog_message a[href='']", ".tru_cookie-dialog_wrapper [data-cy=banner-options-btn], .tru_cookie-dialog_wrapper [data-cy=optionsBtn], .tru_cookie-dialog_wrapper #tru_options_btn", "#truendo_container [data-cy=action-button-necessary]", '"adsPermitted":false', ".T360PurposeOverviewBanner", ".T360PurposeOverviewBanner :is(.T360_Banner_Reject, .T360Banner_Reject)", "_trust360_=", ".truste_popframe.trustarc_newcm_container", "notice_preferences=0:", "#tc-privacy-wrapper", "#tc-privacy-wrapper > [id$=_tc_privacy]", "#truyo-consent-module", "#truyo-cookieBarContent", "button#declineAllCookieButton", ".react-cookie-policy", ".react-cookie-policy #cookie-policy", "xpath///div[@class='react-cookie-policy']//button[contains(., 'Cookie settings')]", "button[role='switch']", "xpath///li[contains(., 'Tracking')]//button[@role='switch'][@aria-checked='true']", "xpath///li[contains(., 'Advertising')]//button[@role='switch'][@aria-checked='true']", "xpath///button[contains(., 'Save and close')]", "trybe_cookies_consent_tracking=false", "#cookie-onetrust-show-info", "#cookie-onetrust-only-necessary", "#onetrust-pc-sdk", "#onetrust-pc-sdk .ot-pc-refuse-all-handler", "#onetrust-pc-sdk input.category-switch-handler:checked", "#onetrust-pc-sdk .save-preference-btn-handler", "OptanonAlertBoxClosed", ".box-cookieterms", ".box-cookieterms[data-cookieterms-cookie]", "body:not(.cookieterms-hidden) .box-cookieterms", ".box-cookieterms [data-cookieterms-customize]", ".box-cookieterms-settings", ".box-cookieterms input[data-cookieterms-group]:checked:not([disabled])", ".box-cookieterms [data-cookieterms-save]", ".box-cookieterms [data-cookieterms-decline]", '"analytics":false', "iframe.tmblr-iframe--gdpr-banner", "[x-data^='cookieNotice('] > .fixed", "[x-data^='cookieNotice('][x-data*='tv2reg_cookie_consent']", "[x-data^='cookieNotice('] button[\\@click='acceptNecessary'], [x-data^='cookieNotice('] button[x-on\\:click='acceptNecessary']", '"handle":"marketing","value":false', "#twcc__mechanism", "#twcc__mechanism .twcc__notice", "#twcc__decline-button", "twCookieConsent=", '.cookie-notify:has(a[href*="cookies_policy"]) > button.btn, .cookies-policy-block:has(a[href*="cookies_policy"]) > button.btn, .header__cookie:has(a[href*="cookies_policy"]) > button.btn', "#js-cookieconsent", "#js-cookieconsent [data-cookieconsent-accept-none]", "CookieConsent=mandatory", "#cookieBanner #manage[data-bs-target='#cookieModalSettings']", "#cookieBanner .modal-content", "#cookieBanner #manage", "#cookieModalSettings form button[type=submit]", "#cookieModalSettings form input[type=checkbox]:checked", "#cookieModalSettings .modal-content", ".u-cookie-frame, .modal:has([data-attr='btn-reject-cookies'])", ".u-cookie-frame [data-attr='btn-reject-cookies'], .modal [data-attr='btn-reject-cookies']", "dialog.cookie-policy", "dialog.cookie-policy header", 'xpath///*[@id="modal"]/div/header', "dialog header", "button.js-manage", 'xpath///*[@id="cookie-policy-content"]/p[4]/button[2]', "dialog.cookie-policy .p-switch__input:checked", "dialog.cookie-policy .js-save-preferences", 'xpath///*[@id="modal"]/div/button', "_cookies_accepted=essential", "#notice-cookie-block.notice-cookie", "#notice-cookie-block .notice-cookie-actions.reject button", "#ucookie-container", "#ucookie-container #ucookie-decline-button", "#politique_confidentialite", "#politique_confidentialite #cookies_settings", "#cookie_settings a.refuse", "UFT_cookie_notice_accepted=%5B%5D", "#catapult-cookie-bar", ".has-cookie-bar #catapult-cookie-bar", "catAccCookies", ".cookie-manager > #cookiebanner", "#p-cookie-banner", ".cookie-manager #cookiebanner #rejectall, #p-cookie-banner #p-cookie-banner__button--reject", ".cookie-manager > #cookiebanner, #p-cookie-banner", "uk-parliament.cookie-policy=eyJhbmFseXRpY3MiOmZhbHNl", ".cookie-notice-advanced", ".cookie-notice-advanced .cookie-bar #cookie-save", ".cookie-notice-advanced .cookie-bar", ".cookie-notice-advanced input:is(#social-cookies, #advertisement-cookies):checked", ".cookie-notice-advanced #cookie-save", "#avisoCookie.msgCookies", ".modal #chRendimiento", '#avisoCookie a[data-target^="#"], #avisoCookie a.modal-trigger', '.modal-footer button[onclick*="chRendimiento"]', ".modal #chRendimiento:checked", "aceptarCookies=true", "aceptarGoogleAnalytics=true", "#cookieControlWrapper", "#cookieControlWrapper #cookieControlBannerManage", "#cookieControlWrapper #cookieControlBanner", "#cookieControlBannerContent a[onclick*=unicityCookiesRejectAll]", "#cookieControlBannerContent a[onclick*=unicityCookiesManage]", "#cookieControlBannerManage", "#cookieControlBannerManage input[type=checkbox]:checked:not(:disabled)", "#cookieControlBannerManage a[onclick*=unicityCookiesSave]", "uni_cookies=0,0,0,0", "#cookieDisclaimer.cookieDisc", "#cpra_banner_wrapper", `#cookieDisclaimer a[onclick*="handleUSPrivacyAction('reject')"], #cpra_banner_wrapper #cpra_btn_reject, #userConsentForAdsPopup #allowButton, #gdprPopup #consent_dialog_allow`, "#cookieDisclaimer, #cpra_banner_wrapper, #userConsentForAdsPopup", "#gdprPopup-popup.ui-popup-active", "#cookieDisclaimer, #cpra_banner_wrapper", `#cookieDisclaimer a[onclick*="handleUSPrivacyAction('reject')"], #cpra_banner_wrapper #cpra_btn_reject`, "#userConsentForAdsPopup", '#gdprPopup a[data-rel="back"]', "usprivacy=1YYN", ".upcc-cookie-widget", ".upcc-cookie-widget .upcc-cookie-reject-all", ".upcc-cookie-widget .js-upcc-view-upcc-cookie-options", ".upcc-cookie-modal-container .upcc-cookie-reject-all", ".upcc-cookie-widget, .upcc-cookie-modal-container", "up-cookie-consent=true", 'up-cookie-consent-options=["strictly_necessary"]', "#usercentrics-root,#usercentrics-cmp-ui", "#usercentrics-cmp-ui", "#usercentrics-root", '#cookieconsent-window[aria-describedby="cookieconsent-desc"]', '#cookieconsent-window[aria-describedby="cookieconsent-desc"] #cookieconsent-dismiss', "#cookieconsent-window", "ux-cookie-layer", "%22optional%22:false", "#cookie-banner[data-once~='vdg-cookies-block']", "#cookie-banner__config", "#cookie-banner__reject", "%22analytics%22:false", '#cookie-bar-modal[x-data^="initCookieBar"]', ".cookie-bar-wrapper:has(.allow-only-functional-cookie)", ':is([x-data^="initCookieBar"], .cookie-bar-wrapper) .allow-only-functional-cookie, [x-data^="initCookieBar"] #cookie-bar-customize', ':is([x-data^="initCookieBar"], .cookie-bar-wrapper.active) .allow-only-functional-cookie, [x-data^="initCookieBar"] #cookie-bar-customize', ':is([x-data^="initCookieBar"], .cookie-bar-wrapper) .allow-only-functional-cookie', '[x-data^="initCookieBar"] #cookie-bar-customize', '[x-data^="initCookieBar"] #cookie-allow-selection', '[x-data^="initCookieBar"] input[data-cookie-code]:checked:not(:disabled)', ':is([x-data^="initCookieBar"], .cookie-bar-wrapper.active) .allow-only-functional-cookie, [x-data^="initCookieBar"] :is(#cookie-bar-customize, #cookie-allow-selection)', "#cookie_consent:has(#cookie_consent_details)", "#cookie_consent #cookie_consent_details :is(#functional-cookie-accept, .functional-button)", "#cookie_consent #cookie_consent_summary", "#cookie_consent_details :is(#functional-cookie-accept, .functional-button)", "cookieconsent_status=accept_functional", ".js-simple-accept-view .js-accept-basic", '#form-purposes input[name="CookiePurposes"]', ".js-simple-accept-view .js-show-purposes", "#form-purposes .js-save", '#form-purposes input[name="CookiePurposes"]:checked:not([disabled])', "#cookie_alert_container", "#cookie_alert #cookie_alert_accept", "html:not(.no-js)", "#cookie_alert_decline", "#cookie_alert_manage", "#cookie_prefs_decline", "cookie_policy=rejected", '[data-slot="dialog-content"] a[href*="vivenu.com/dataprivacy"]', '[data-slot="dialog-content"]:has(a[href*="vivenu.com/dataprivacy"]) button:nth-of-type(2)', "#vcm-v-banner-sdk", "#vcm-v-mask-sdk", "#vcm-v-consent-sdk #vcm-v-banner-sdk", "#vcm-v-group-reject", "#vcm-v-close-btn", ".consent-overlay", "div.consent[role=dialog]", "div.consent[role=dialog] .consent-main-buttons .consent-decline-all", "PrivacyPolicyOptOut", "UsageAnalysisConsent=yes", "#bottom-cookies", "#bottom-cookies.bottom-cookies-modal #openCookiesSettings", "#openCookiesSettings", "#cookiesModal #saveSelectedCookies", "#cookiesForm input[type=checkbox]:checked", ".cookie.cookie__floating", ".cookie.cookie__bar", ".cookie__floating__buttons__button--accept, .cookie__bar__buttons__button--accept", ".cookie.cookie__floating, .cookie.cookie__bar", ".cookie__floating__buttons__button--decline, .cookie__bar__buttons__button--decline", ".Cookie:has(> .Cookie__content + .Cookie__buttons)", ".Cookie > .Cookie__content + .Cookie__buttons", ".Cookie > .Cookie__buttons > button.Cookie__button--decline", "#cookie-statement", "#cookie-statement [onclick*=turnOffCookieStatement]", "turn_off_cookie_statement=1", ".warning.warning--active:has(.warning__apply)", ".warning:has(.warning__text) .warning__apply", "#cookie-notice:has(.btn-configure)", "#cookie-notice .btn-configure", "#modal_cookie-consent", "#modal_cookie-consent input.cookie-toggle:checked:not(:disabled)", ".cookie_preferences .modal-footer button.fill-primary", "%22ConsentAnalytical%22%3Afalse", "%22ConsentAdvertising%22%3Afalse", "#modal-test-id-consent-modal .consent-description-container", "#modal-test-id-consent-modal .modal-buttons button:nth-of-type(2)", "#modal-test-id-consent-modal .modal-buttons", "#modal-test-id-consent-modal .modal-buttons button:nth-of-type(3)", "#modal-test-id-consent-modal .consent-description-container button:nth-of-type(2)", "#modal-test-id-consent-modal", "anonymousConsentElections=", 'dialog#ltp-dialog, [id="id/ltp"]', 'iframe[id^="ngxFrame"][data-src]', 'dialog#ltp-dialog[open], [id="id/ltp/banner"]', "dialog#ltp-dialog", '[id="id/ltp"]', "#gdpr.reveal.gdpr", "#gdpr.reveal #recommendedSettingsSubmit", "#gdpr #reviewCookiesTrigger", "#gdpr input[name='cookiesSwitches']:checked + label", "#gdpr #customSettingsSubmit", "#gdpr #confirmCookiesTrigger", "#gdpr.reveal", "CookieNotice.Analytics=0", "statistics=0", ".fs-cc-components,[fs-cc=banner]", 'script[src*="@finsweet/cookie-consent"]', ".fs-cc-components,[fs-cc=banner] [fs-cc=allow]", "[fs-cc=banner] [fs-cc=deny]", "[fs-cc=banner]", "fs-cc", "#wl-cc-box", "#wl-cc-backdrop", "#wl-cc-box #wl-cc-reject", "#wl-cc-cats:not(.wl-cc-exp)", "wl_cc_consent=%7B%22necessary%22%3Atrue%2C%22analytics%22%3Afalse%2C%22marketing%22%3Afalse", "#cookieNotice", "#cookieNotice #cookieNoticeDeclineCloser", "#cookieNotice #cookiesTracking:checked", "#cookieNotice #cookiesTracking", "#cookieNotice #loadExternRessources:checked", "#cookieNotice #loadExternRessources", "#cookieNoticeDeclineCloser", "allowTracking=0", "#cookie-banner:has(#js-config-cookies)", "#cookie-banner #js-config-cookies", "#cookie-container #js-save-cookies", "#cookie-container input.switch-input:checked", "analytics=blocked", ".ws_useragreement4alls", "[onclick^='ws_agreementcookies_set'], [onclick*='wsConsentDefault']", ":has(> .ws_useragreement4alls)", "[class*='ws_useragreementcgc_']:checked", "[class*='ws_useragreement_optin_']:checked", "[onclick*='wsConsentDefault']", "[onclick^='ws_agreementcookies_set']", "websale_useragreement=", ".wcc-overlay,.wcc-consent-container", ".wcc-consent-container", ".wcc-consent-container [data-tag=reject-button]", ".wcc-consent-container [data-tag=donotsell-button]", ".wcc-modal-open [data-tag=optout-option-toggle]", ".wcc-modal-open [data-tag=optout-option-toggle]:not(:checked)", ".wcc-modal-open [data-tag=optout-confirm-button]", ".wcc-consent-container [data-tag=settings-button]", ".wcc-modal-open [data-tag=detail-save-button],.wcc-consent-bar-expand [data-tag=detail-save-button]", ".wcc-modal-open [data-tag=detail-category-toggle] input:checked,.wcc-consent-bar-expand [data-tag=detail-category-toggle] input:checked", "action:yes", "#cookies-policy form[data-cookie-action='accept.all']", "#cookies-policy form[data-cookie-action='accept.all'] button", "#cookies-policy form[data-cookie-action='accept.essentials'] button", "#cookies-policy .cookies__btn--customize", "#cookies-policy form.cookies__customize .cookiesBtn__link", "#cookies-policy form.cookies__customize input[type='checkbox']:checked:not([value='essentials'])", "[data-global-privacy-control-banner]", "[data-global-privacy-control-banner] > button", ".mw-cookiewarning-container", "[data-gtm-consent-modal]", "[data-gtm-consent-modal].gtm-consent__modal--show", "[data-gtm-consent-modal] [data-gtm-consent-close]", "[data-gtm-consent-modal] [data-gtm-consent-toggle]", "[data-gtm-consent-modal] [data-gtm-consent-details-section]", "[data-gtm-consent-modal] [data-gtm-consent-types-form] input[type=checkbox]:checked:not(:disabled)", "[data-gtm-consent-modal] [data-gtm-consent-submit]", '"analytics_storage":false', '"ad_storage":false', "div[role=dialog][aria-modal=true][aria-label*='WP']", "[data-comp-type=cookie-banner-root-wix],[data-hook=ccsu-banner-wrapper],[data-comp-type=cookie-banner-root-uou]", "[data-comp-type=cookie-banner-root-uou]", "[data-hook=consent-banner-decline-all-button]", "[data-hook=consent-banner-settings-button]", "[data-hook=consent-banner-settings-save-button]", "[data-hook=consent-banner-section-toggle-input]:checked:not(:disabled)", "[data-hook=ccsu-banner-decline-all]", "[data-hook=ccsu-banner-wrapper]", 'form[action="/v1/gdpr-preferences/"] [data-qa-selector="gdpr-banner-accept-all-button"]', '[data-qa-selector="gdpr-banner-configuration-button"]', '[data-qa-selector="gdpr-banner-accept-selected-button"]', 'input[data-qa-selector^="gdpr-banner-check-box-"]:not([value="essential"]):checked', "gdpr_consent=categories_denied", ".wccom-comp-privacy-banner .wccom-privacy-banner", ".wccom-privacy-banner__content-buttons button.is-style-secondary:has(+ button.is-style-secondary)", ".wccom-privacy-banner__content-buttons button.is-style-secondary:not([disabled]):has(+ button.is-style-secondary)", ".wccom-privacy-banner__content-buttons button.is-style-secondary:not([disabled]):has(+ button.is-style-primary)", ".wccom-modal__footer button.is-style-primary", ".wccom-customize-privacy-checkbox input[type=checkbox]:checked:not([disabled])", ".wccom-modal__footer button.is-style-primary:not([disabled])", "wccom_cookie_consent_analytics=denied", "#cmp-app-container", "#cmp-app-container iframe", '[data-automation-id="legalNotice"]', '[data-automation-id="legalNoticeDeclineButton"]', "enablePrivacyTracking=false", "#cookieconsentpopup.lp__cookie_tooltip", ".privacy-widget:has(> button.accept-consent)", "#cookieconsentpopup.lp__cookie_tooltip, .privacy-widget > button.accept-consent", "#cookieconsentpopup.lp__cookie_tooltip, .privacy-widget:has(> button.accept-consent)", "#cookieconsentpopup .accept-consent, .privacy-widget > button.accept-consent", "consent_cookie=1", "#gdpr-cookie-consent-bar", "#gdpr-cookie-consent-bar #cookie_action_reject", "wpl_viewed_cookie=no", ".sp-dsgvo", ".sp-dsgvo.sp-dsgvo-popup-overlay", ".sp-dsgvo-popup-overlay .sp-dsgvo-privacy-btn-accept-nothing", ".sp-dsgvo-popup-overlay .sp-dsgvo-popup-close", "integrations%22%3A%5B%5D", ".wpcc-container", ".wpcc-container .wpcc-message", "#wpconsent-root", "#wpconsent-container", "wpconsent_preferences=", "#cookieBara", "#cookieBara [data-cookie-bar=simple]", "#cookieBara [data-cookie-bar=reject]", "#cookieBara [data-cookie-bar=details]", "#cookieBara [data-cookie-bar=custom]:not([data-cookie-custom])", "cookie-bar=0", "#cookie-consent-banner[data-testid=cookie-consent-banner]", "#cookie-consent-banner [data-testid=cookie-consent-banner-confirm-button][onclick^=onCookieConsentClear]", "#cookie-consent-banner [data-testid=cookie-consent-banner-confirm-button]", "accepts-cookies=true", "#consent-container", "#consent_modal_backdrop", "#consent-container #consent-buttonConfirm", "#consent-container #consent-linkCustomConsent", "#consent-container #consent-buttonReject", "#consent-container #consent-buttonSaveChoices", "#consent-container input.consent-checkbox:checked:not(:disabled)", '#modal-privacy-settings button[data-grant="selected"]', '#modal-privacy-settings input[name="analytics"]:checked, #modal-privacy-settings input[name="ad"]:checked', "ad_storage=denied:analytics_storage=denied", ".notice--cookieAdvanced", ".js-notice.notice--cookieAdvanced #cookieConsentConfig", ".js-notice.notice--cookieAdvanced", '.notice--cookieAdvanced a[href*="reject=1"]', '.notice--cookieAdvanced [data-xf-click="toggle"][data-target="#cookieConsentConfig"]:not(.is-active)', '#cookieConsentConfig button[type="submit"]', '#cookieConsentConfig input[name^="consent["]:checked', "_consent=%5B%5D", ".cookie_warn", ".cookie_warn .cookie_warn_inner", "#cookies-use-alert", ".disclaimer-opened #disclaimer-reject_cookies", ".disclaimer-opened #disclaimer-cookies", "#disclaimer-reject_cookies", "#gdpr-popup-v3-button-mandatory", "#yle-consent-sdk-container .ycd-banner", "#yle-consent-sdk-container button[name=accept-necessary-consents]", "tp-yt-iron-overlay-backdrop.opened", "ytd-consent-bump-v2-lightbox", "ytd-consent-bump-v2-lightbox tp-yt-paper-dialog", 'ytd-consent-bump-v2-lightbox tp-yt-paper-dialog a[href^="https://consent.youtube.com/"]', "ytd-consent-bump-v2-lightbox .eom-buttons .eom-button-row:first-child ytd-button-renderer:first-child #button,ytd-consent-bump-v2-lightbox .eom-buttons .eom-button-row:first-child ytd-button-renderer:first-child button", ".consent-bump-v2-lightbox", "ytm-consent-bump-v2-renderer", "ytm-consent-bump-v2-renderer .privacy-terms + .one-col-dialog-buttons c3-material-button:nth-child(2) button, ytm-consent-bump-v2-renderer .privacy-terms + .one-col-dialog-buttons ytm-button-renderer:nth-child(2) button", ".ycc-notice", ".ycc-notice-backdrop", ".ycc-notice #ycc_consent_save", ".ycc-notice #ycc_consent_modify", "#ycc_consent_options", "#ycc_analytics:checked", "#ycc_analytics", "#ycc_advertisements:checked", "#ycc_advertisements", '"advertisements":false', ".zbottom-cp-container", ".zbottom-cp-container .zbc-cta-accept", ".zbottom-cp-container .zbc-cta-ignore button", ".zbottom-cp-container .zbc-manage-cta", ".zbc-main .zbc-cta-se", ".zbc-main .ctog-container.ctog-active:not(.ctog-no)", ".cookiewarning:has(> button.cookiewarning_yes.close-button)", ".cookiewarning > button.cookiewarning_yes.close-button", ".cookiewarning", ".c-cookies-notification-banner", ".c-cookies-notification-banner .c-notification-banner__close-button button", ".c-cookies-notification-banner .c-notification-banner--open", "_acceptCookies=true", "body > div#iubenda-cs-banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(5):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#ds-cookie-consent-banner > div:not([id]) > div:not([id]) > button:nth-child(4)#reject_optional_cookies", "body > div#banner-0 > div:nth-child(1)#grouped-pageload-Banner > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(4):not([id]) > button#cookie_all_reject", "body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie_all_reject", "body#moneyinvesting > div#top > div#content > div:nth-child(4):not([id]) > a:nth-child(11):not([id])", "body > div#app > div#app > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(1):not([id]) > div:not([id])", "#CybotCookiebotDialog", "#CybotCookiebotDialog #CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyButtonDecline", "marketing:false", "#clym-app-layout #handle-reject", "#ccpa_consent_banner #decline_cookies_button", ".ecoPrivacyMain .ecoPrivacyButton", ".ecoPrivacyMain .ecoPrivacyButton:not([disabled])", "#dashboard #decline-text", "#app > div[role=alertdialog]", "#react-root div[role=alertdialog]", "#app > div[role=alertdialog] button .btn-text, #react-root div[role=alertdialog] button .btn-text", "#app > div[role=alertdialog], #react-root div[role=alertdialog]", "div[role=alertdialog] button:has(.btn-text) + button:has(.btn-text), div[role=alertdialog] > button:has(.btn-text)", "pref=%7B%22t%22%3A%22", "%22m%22%3Afalse%7D", "#overlay.cmp", "#overlay[role=dialog]", "#deny", "#edit-purpose-settings", "#save-purpose-settings", "ui_cid=OPTOUT", ".pp-cookies-item-switch .andes-ui-switch", ".pp-cookies-item-switch .andes-ui-switch:not(.andes-ui-switch--disabled)", ".pp-cookies-item-switch .andes-ui-switch[data-andes-state=checked]:not(.andes-ui-switch--disabled)", "#consentui #buttons .btn.amber", "#consentui #buttons .btn.red", "#consentui.screen_2 #filters", "#consentui #filters input[type=checkbox]:checked", "#consentui.screen_2 #buttons .btn.green", "#consentManagerButtons .entryPage .settings", "#consentManagerEntryPage", "#consentManagerButtons .entryPage .declineAll", "#consentManagerSettingsPage", "#consentManagerButtons .otherPages .declineAll", "#consent #btn-accept-necessary", "#consent-dialog #btn-accept-necessary", "#save-all-pur", "#reminder", ".wd-cookie-banner.x-cookie-open", ".wd-cookie-banner", ".wd-cookie-banner.x-cookie-open .wd-cookie-banner__header__close", ".cookie-disclaimer a[href*='cprefs=change'], #myModal #cookieprefs", ".cookie-disclaimer, #myModal #cookieprefs", "#myModal #cookieprefs", "#cookieprefs input[type=checkbox]:checked", "#cookieprefs input[type=submit]", ".cookie-disclaimer a[href*='cprefs=change']", "#app > [class^='cookieContainer']", "#app > [class^='cookieContainer'] [class*='acceptAndCloseButton']", "[class^='cookieContainer'] [class*='toggleSettingsButton']", "[class^='cookieContainer'] div[class^='settings'] button", "[class^='cookieContainer'] div[class^='settings'] button[class*='active']:not([disabled])", "[class^='cookieContainer'] [class*='acceptAndCloseButton']", "[class^='cookieContainer'] [class*='closeButton'], [class^='cookieContainer'] [class*='acceptAndCloseButton']", "adc-cookie-banner", "cookie_banner=closed", '[data-testid="cookies_reject"]', "#__next > div:has(> p > a[href*='cookie-policy'])", "xpath///div[@id='__next']/div[h2[normalize-space(.)='Cookies on this website']]", "xpath///div[@id='__next']/div[h2[normalize-space(.)='Cookies on this website']]//button[contains(., 'do not use analytics cookies')]", "#cookie-consent-banner #cookie-consent-accept", "#cookie-consent-accept", "cookie-consent=1", "form.cookieprompt", "#cookiebar .cookies-settings, form.cookieprompt .cookies-settings", "form.cookieprompt .cookies-settings", "form.cookiepage .cookies-save", "form.cookiepage input.tracking-cookies:checked", "form.cookiepage input.tracking-cookies", "#cookiebar .cookies-settings", "#cookiebar .cookies-save", "#cookiebar input.tracking-cookies:checked", "#cookiebar input.tracking-cookies", "eyeo-ga-opt-out=true", ".overlay-footer", ".overlay-footer .btn-area-footer", ".fullpageCover", ".fullpageCover a[href*='/go/page/privacy.html']", ".fullpageCover div.rounded-full:nth-child(2)", "#cookie-agreement", "#cookie-agreement .agreement-button input", "#popup_cookies", "#popup_cookies .boton_cookies", "#cookies_consent_div", "#popup_content.cookies_consent_div .config_cookies", "#popup_content #configurar_cookies", "#popup_content .cookie_button:not(.cookies_tecnicas) input[type=checkbox]:checked", "#popup_content .not_explanation.aceptar_cokies", '.cc-window[aria-describedby="cookieconsent:desc"]', 'script[src*="/js/cookieconsent.min.js"]', '.cc-type-info[aria-describedby="cookieconsent:desc"]:not(.cc-invisible) .cc-dismiss', "#cookiebar .cookiebar-confirm[data-accept=cookiebar]", '[data-testid="main-cookies-banner-container"]', '[data-testid="main-cookies-banner-container"] section > div > div:nth-child(2) > div:nth-child(2) > button', "#cookieBarRGPDPop", "#cookieBarRGPDOverlay", "#cookieBarRGPDPop a[href*='loadParam']", "#cookieBarRGPDPopContent [data-cookiebarrgpd='0']", "#cookieBarRGPDPop a[href*='valideChoix']", 'cookieBarRGPDpublicite":0', "#gdpr-new-container", "#gdpr-new-container,#voyager-gdpr > div,#voyager-gdpr-2025 > div > div > button", "#voyager-gdpr > div", "#voyager-gdpr > div > div > button:nth-child(2)", "#voyager-gdpr-2025 > div > div > button", "#voyager-gdpr-2025 > div > div > button:nth-of-type(3)", "#voyager-gdpr-2025 > div > div > button:nth-of-type(2)", "#voyager-gdpr-2025 > div > div > button:last-of-type", "#voyager-gdpr-2025 > div > div > div > button:last-of-type", "#gdpr-new-container button:nth-of-type(3)", "#gdpr-new-container button:nth-of-type(2)", "#gdpr-new-container button:first-of-type", "#voyager-gdpr-2025", "#voyager-gdpr-2025 button:last-of-type", ".cookie-message", ".cookie-message .cookie-agree", ".consent-dialog-positioner", '[data-test="consent-bar"] [data-test="consent-bar-necessary"]', '[data-test="consent-bar"]', "#kvkk", "#kvkk a.onayliyor", "#banner", "#banner #bannerFooter music-button", "#banner #bannerFooter", ".cookie-menu.js-cookie-banner", ".cookie-menu.js-cookie-banner .js-cookie-banner-close", "apaycnst-mktg=true", "#cookie-agreement .dismiss", "#a69-cookie-banner", "#a69-cookie-banner #a69-cookie-manage", "#a69-cookie-manage", "#a69-cookie-modal", "#a69-cookie-analytics:checked", "#a69-cookie-save", "a69_cookie_preferences=%7B%22analytics%22%3Afalse", ".privacy-popup", ".privacy-popup .privacy-popup__toolbar", ".privacy-popup__toolbar button:last-child", ".cookie:has(> .cookie-head > .icon-cookie)", ".cookie > .cookie-head > .icon-cookie", "#arb-cookie-banner-section", "#arb-cookie-banner-section button", "#arb-cookie-banner-section button:first-of-type", "xpath///div[@role='dialog'][.//h2[normalize-space(.)='This website uses cookies']]", "xpath///div[@role='dialog'][.//h2[normalize-space(.)='This website uses cookies']]//button[normalize-space(.)='Manage Cookies']", "[role='dialog'] button[role='switch']#advertising", "[role='dialog'] button[role='switch'][aria-checked='true']", "xpath///div[@role='dialog'][.//button[@role='switch']]//button[normalize-space(.)='Save Preferences']", '"advertising":false', ".c-mp > .c-mp-n", ".c-mp > .c-mp-n .cn-buttons > .cm-btn-secondary", ".c-mp .cm-klaro .cm-footer-buttons .cn-buttons > .cm-btn-secondary:first-child", "%22google-ads%22%3Afalse", ".cookie-banner", ".cookie-banner .cookie-banner__button-column", ".cookie-banner.cookie-banner--visible", ".cookie-banner__button-column > div.cursor-pointer", "xpath///div[contains(@class, 'cookie-dialogue')]//footer//button[normalize-space()='Reject cookies']", "cookieconsent_preferences_v5={%22analytics%22:false%2C%22marketing%22:false}", "#cookiePolicy", "#cookiePolicy #cookiebar-btn", "cookie policy accepted=", "#AcceptCookies2 #MrktConfirm", "#AcceptCookies", "#AcceptCookies input[onclick*=AcceptCookies2]", "#AcceptCookies2", "#AcceptCookies2 input[type=checkbox]:checked", "#AcceptCookies2 input[onclick*=SetCookie]", "MrktConfirm=false", "#footer-container ~ div", "#footer-container > div", "#gpc-banner-container", '"consent":"d"', "form.test-cookie-consent", 'form.test-cookie-consent [data-cookie-consent-target="screen1"]', 'form.test-cookie-consent [data-action="cookie-consent#showSettings"]', 'form.test-cookie-consent [data-cookie-consent-target="screen2"] [data-action="cookie-consent#rejectAll"]', "%22ad_storage%22%3Afalse", "body > div#shopify-section-popups > div:nth-child(1):not([id]) > modal-box#modal-popups-0 > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div#cookieNotice > span:not([id])", "body > div#cookieAreaBase > div#cookieArea > p:nth-child(1):not([id]) > a:nth-child(3):not([id])", "body > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:not([id]) > span:nth-child(1):not([id]) > div:nth-child(5):not([id]) > button:nth-child(2):not([id])", 'body > div#cookie-banner-deezer > div#gdpr-dir-tag > div:not([id])[data-testid="cookie-banner"] > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button#gdpr-btn-refuse-all[data-testid="gdpr-btn-refuse-all"]', "body:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "#cookiesPortletDiv", "#cookiesPortletDiv .cookie-buttons", "#cookiesPortletDiv button[aria-label='Only Mandatory']", "body > div#portal-cookie-banner > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2)#portal-cookie-banner__wrapper > aside#portal-cookie-banner__content > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#messages > div:nth-child(1)#shopify-section-cookie-banner > section#shopify-section-cookie-banner > div:nth-child(1):not([id]) > button:nth-child(2):not([id])", "body > form#trackingConsent > button:nth-child(2):not([id])", "body:not([id]) > div#cookieConsent > div:nth-child(2):not([id]) > a:nth-child(3):not([id])", "body > div#___gatsby > div:nth-child(1)#gatsby-focus-wrapper > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])", "body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div#c-cookiebanner > section:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > p:nth-child(1):not([id]) > button:not([id])", "body > div#frame-modals > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#message-banner > div:not([id]) > div:nth-child(2):not([id]) > button:not([id])", "body > div#cookiemodal > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(5)#footer-cookie-buttons > a:nth-child(2)#footer-cookie-close", "body > main:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(2):not([id])", "body:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])", "body > hathi-cookie-consent-banner:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#root > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(1):not([id]) > button:not([id])", "body > div#wrapwrap > div:nth-child(5)#website_cookies_bar > div:not([id]) > div:not([id]) > div:not([id]) > section:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(1)#cookie-banner-essential", "body > aside:not([id]) > div:nth-child(2)#cookie-consent-modal > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body:not([id]) > div#cookieConsentBanner > div#cookieConsentContent > button:nth-child(4)#closeConsentBanner", "body:not([id]) > div#cookies-modal > div:nth-child(2)#consent-modal > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(1):not([id]) > span#consent-modal-refuse", "body > div#tna-cookie-prompt-banner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#reject-cookie", "body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:not([id])", "body > div:not([id]) > aside#cmp-banner > form:not([id]) > div:nth-child(4):not([id]) > section:not([id]) > div:not([id]) > button:nth-child(1)#cmp-deny-all", "body > div#consent_manager-background > div:nth-child(1)#consent_manager-wrapper > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#consent_manager-accept-none", "body > div#ampsandConsentElement > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])", "body > section#cookie-consent > div:not([id]) > form:nth-child(3):not([id]) > div:nth-child(5):not([id]) > button:nth-child(1):not([id])", "body > div:not([id]) > div#cookie-banner > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-banner-reject", "body > privacy-banner:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id]) > span:not([id])", "body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#cookieconsent > div#cookieconsent-bar > div:nth-child(3):not([id]) > a:nth-child(2)#decline", 'body > header#header > div:nth-child(1)#CookiesConsent > div:not([id]) > div:nth-child(2):not([id]) > form:nth-child(2):not([id]) > div:nth-child(5):not([id]) > button:not([id])[data-testid="AcceptRequiredCookies"]', "body > section#cookie-policy > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#__next > div:nth-child(3):not([id]) > dialog:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#cookies-banner > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", 'body > div:not([id]) > div:nth-child(1):not([id])[data-testid="privacy-banner"] > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2)#react-aria491930105-\\:r29\\:[data-testid="privacy-banner-decline-all-btn-desktop"]', "body > footer:not([id]) > div:nth-child(2):not([id]) > cookie-notice:nth-child(1):not([id]) > div#cookie-notice > div:not([id]) > div#cookie-notice-inner > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(1):not([id]) > button#cookie-notice-decline", "body > div:not([id]) > div:nth-child(1)#consent-manager > footer:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#tc-privacy-wrapper > div#footer_tc_privacy > div:nth-child(2)#footer_tc_privacy_container_button > button:nth-child(2)#footer_tc_privacy_button_2", "body > div#c-pop > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#ctl07_declinebtn", "body > div#gdrp-cookieoverlay > div:nth-child(3)#cs2gdpr-cookiebanner > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#btn-accept-required-banner", "body > div#cookieman-modal > div:not([id]) > div:not([id]) > div:not([id]) > button:nth-child(6):not([id])", "body > div#c20343 > div:nth-child(1)#ikanos-privacy-cookielayer > div:nth-child(2):not([id]) > form:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id])", "body > dialog#ai-hinweis > div:nth-child(1):not([id]) > div:nth-child(3):not([id]) > div:nth-child(3):not([id]) > center:not([id]) > button:nth-child(1)#policy_notwendig", "body > aside:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div#cookiebanner-body > div:nth-child(1)#cookiebanner > div:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:not([id])", "body > div#app > div:nth-child(1)#header > div:nth-child(2)#cookie_banner > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#__nuxt > div#__layout > div#app > div:nth-child(6):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(1):not([id])", "body > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(1):not([id]) > div:not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > p:nth-child(2):not([id]) > a:not([id])", "body > div#modal-wrap > section#modal-content > div:not([id]) > div:nth-child(2)#cookie-banner > div:not([id]) > div:nth-child(1)#s1 > p:nth-child(5):not([id]) > a:nth-child(4)#button_reject", "body > div#cookie-consent-banner > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3)#btn-reject-all", "body > div#cc-button > div#cc-text > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#page > main:nth-child(2)#index > div:nth-child(3)#cookie-settings-modal > div:not([id]) > div#cookie-settings > div:nth-child(4):not([id]) > button:nth-child(3):not([id])", '[data-testid="consentManager"]', '[data-testid="privacyBanner-rejectAll"]', "body > div#_evidon-barrier-wrapper > div:nth-child(2)#_evidon-banner > div:nth-child(1)#_evidon-banner-content > div:nth-child(5):not([id]) > button:nth-child(2)#_evidon-barrier-declinebutton", "body > div:not([id]) > div:nth-child(1)#matomoCookieNotification > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button#disallowMatomoCookieNotification", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > span:nth-child(1):not([id]) > button:not([id])", "body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(1):not([id])", "body > div:not([id]) > div#cpnb > div#w357_cpnb_outer > div:not([id]) > div:nth-child(2):not([id]) > span:nth-child(2)#cpnb-decline-btn", "body > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#a-page > div:nth-child(5)#sc-content-container > div:nth-child(1):not([id]) > div:nth-child(12):not([id]) > div:nth-child(1) > div:nth-child(2)#cookie-consent-window > div:not([id]) > div:nth-child(2) > div:nth-child(1)#cookie-consent-continue > div:not([id]) > a:not([id])", "body > div#acris--page-wrap--cookie-permission > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-permission--accept-only-functional-button", "body > div#cookieConsentBanner > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#consentMinimal", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id])", "body > div#cookiebar > div:not([id]) > span:nth-child(3)#declineCookie > button:not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])", "body > div#root > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookieRefuse", "body > div:not([id]) > div:not([id]) > div:not([id]) > div#P0-0 > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])", "body > div#cookie > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > a:nth-child(2):not([id]) > span:not([id]) > span:not([id])", "body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#main > div:nth-child(11)#cookbar_overlay > div#cookbar > span:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > a:nth-child(3):not([id])", "body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(1)#popin_tc_privacy_button", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > form:nth-child(4):not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button#cookie_consent_use_only_functional_cookies", "body > div#orejime > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > ul:nth-child(2):not([id]) > li:nth-child(2):not([id]) > button:not([id])", "body > app-root:not([id]) > div:not([id]) > app-cookie-banner:nth-child(3):not([id]) > div:nth-child(1):not([id]) > div:nth-child(2)#reject-cookie-link > button#reject-cookie", "body > div#tc-privacy-wrapper > div#popin_tc_privacy > div:nth-child(2)#popin_tc_privacy_container_button > button:nth-child(2)#popin_tc_privacy_button_2", "body > div#consent > user-consent:nth-child(1):not([id]) > consent-dialog:not([id]) > consent-content:not([id]) > consent-message:nth-child(1):not([id]) > button:nth-child(1):not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(2):not([id])", "body > div#privacy-banner > div:nth-child(3):not([id]) > button:nth-child(1)#privacy-rejected", "body > div#cookie > div:not([id]) > div:nth-child(2)#Buttondivanalytic > button:nth-child(2):not([id])", "body > div#cookie-law > div:not([id]) > div:nth-child(1):not([id]) > button:nth-child(12):not([id])", "body:not([id]) > dialog:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:not([id])", "body:not([id]) > section:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body:not([id]) > div#cc--main > div#cc_div > div:nth-child(1)#cm > div#c-inr > div:nth-child(2)#c-bns > button:nth-child(1)#c-s-bn", "body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > a:nth-child(3):not([id])", "body > div#sliding-popup > div#cookiepopup > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body:not([id]) > div#consent-box > p:not([id]) > span:not([id]) > button:nth-child(2)#decline-cookies", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > a:nth-child(3):not([id])", "body:not([id]) > section:not([id]).privacy-banner > div:not([id]).privacy-banner__wrap > div:not([id]).privacy-content > div:not([id]).privacy-banner__grid-wrap > div:not([id]).privacy-banner__grid-col.privacy-banner__inner > div:nth-child(3):not([id]).privacy-banner__actions.privacy-banner__set.privacy-banner__btn-wrapper--stacked > button:nth-child(2):not([id]).privacy-banner__btn.privacy-banner__btn--secondary.privacy-banner__reject", "body#hgcBody > div#cookies-banner > a:nth-child(6)#btnCookieBannerNo", "body > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#__nuxt > div#__layout > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "[data-testid='reject-button']", "body > section:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body:not([id]) > div#__next > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(2):not([id]) > button:not([id])", "body > div#cookie-consent-popup > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#cookie-reject", "body > div#modal-cookiesettings > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > button:nth-child(3):not([id])", "body > div:not([id]) > div:nth-child(1)#react-content > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id]) > span:not([id])", "body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", 'div[data-test-consent-banner-popup] button[aria-label="Niet accepteren"]', "body > div#consent-modal > div:not([id]) > div:nth-child(1)#consent-intro > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button#consent-deny-all", "body > div:not([id]) > div:nth-child(5):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#cookielaw_banner > div:nth-child(2):not([id]) > a:nth-child(2)#cookielaw_reject", "body > div:not([id]) > div:nth-child(1):not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#radix-_r_0_ > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(3):not([id])", "body > div#nimbu-consent > div:not([id]) > div:not([id]) > div:not([id]) > p:nth-child(2):not([id]) > button:nth-child(2):not([id])", '.ind-cbar[data-testid="ind-cbar"]', '.ind-cbar[data-testid="ind-cbar"] button[save-cookie][data-value="0"]', "body > div#wpca-lay-out-wrapper > div:nth-child(1)#wpca-bar > div:nth-child(2)#wpca-bar-meta > button:nth-child(3):not([id])", 'body > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(1)#cookiebanner-decline[data-testid="button-cookie-decline"]', "body > div:not([id]) > div:nth-child(4):not([id]) > div:not([id]) > a:nth-child(4):not([id])", "body > div#wrapper > footer:nth-child(3):not([id]) > div#footer > div:not([id]) > div:nth-child(3):not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(4):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2):not([id])", "body > div#cc-card > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > a:nth-child(2)#cc-dismiss-btn", "body > div#__nuxt > div:not([id]) > div:nth-child(3):not([id]) > section#modal > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div#cookie-bar > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:not([id])", "body > div#CNID_4eb59999-7a35-450d-a08f-1661b81e5bc4 > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#refuseAll", "body > div#siteWrapper > div:nth-child(1):not([id]) > section:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(4):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(1):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2)#bcSubmitConsentToNone", "body > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(3):not([id])", "body > div:not([id]) > div:not([id]) > button:nth-child(4):not([id])", "body > shn-dialog#firstTimeVisitorCookieDialog > dialog:not([id]) > div:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > section#cc-window-overlay > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(1):not([id]) > button:nth-child(1):not([id])", "body > div#cookie-notice > div:not([id]) > span:nth-child(2)#cn-notice-buttons > button:nth-child(2)#cn-refuse-cookie", "body > ticketswap-portal:not([id]) > ul:not([id]) > div:not([id]) > div:not([id]) > span:nth-child(2):not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(2)#ez-cookie-notification > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > button:nth-child(2)#ez-cookie-notification__decline", "body > div#__nuxt > div:nth-child(2)#__layout > div:not([id]) > div:nth-child(3):not([id]) > div:nth-child(2):not([id]) > div:nth-child(2)#cookie-consent > div:not([id]) > dialog:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > div#cookie-consent-modal-description > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(2):not([id]) > span:not([id])", "body > main#maincontent > div:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(2):not([id])", "body > div#svid10_17c33ae315e94c3ae6647bf > div:nth-child(1)#svid12_3f29801717d5618f8df9bf4 > div:nth-child(2):not([id]) > div:not([id]) > button:nth-child(4)#afCookieDecline", "body > aza-app:not([id]) > aza-shell:not([id]) > div:nth-child(2):not([id]) > aza-cookie-message:nth-child(1):not([id]) > div:not([id]) > div:not([id]) > div:nth-child(3):not([id]) > button:nth-child(2):not([id]) > span:not([id])", "body > div:not([id]) > form:not([id]) > div:nth-child(1):not([id]) > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", "body > div#cookie-consent-modal > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:not([id]) > div:nth-child(2):not([id]) > button:nth-child(4):not([id])", "body > section#component-cookie-banner > div:nth-child(1):not([id]) > footer:nth-child(4):not([id]) > div:nth-child(1):not([id]) > button:nth-child(2)#cookie-banner-accept-essentials", "body > form#cookieConsentForm > div#cookie-consent-modal > div:not([id]) > div#cookie-consent-modal-content > div:nth-child(3):not([id]) > button:nth-child(2):not([id])", "body > div#cookie_banner > div:not([id]) > button:nth-child(2):not([id])", "body > div:not([id]) > div:nth-child(2):not([id]) > div:nth-child(3):not([id]) > container:nth-child(2):not([id]) > div:not([id]) > div:not([id]) > div#versionized-cookie-banner > div:nth-child(2):not([id]) > ul:not([id]) > li:nth-child(2):not([id]) > button#btn-reject-cookies", "body:not([id]) > div#seers-cmp-cookie-data-hol > div:nth-child(2)#SeersCMPBannerMainBar > div:nth-child(2):not([id]) > a:nth-child(2):not([id])", "body > div[class][tabindex] > div > div > div:nth-child(2) > div:nth-child(2) > button:nth-child(2)", "body > div:not([id]) > div:not([id]) > div#ch2-dialog > div:nth-child(2):not([id]) > button:nth-child(1):not([id])", 'button[data-qa-selector="cookie-consent-configure"]', 'label[data-qa-selector="input-box"][data-qa-selector-value="MARKETING"]', 'label[data-qa-selector="input-box"][data-qa-value="true"]:not(.input-box__disabled) input', "consent=0", ".cookiefirst-root", "#cmpwrapper", "script[src*='consent.cookiefirst.com'],.cookiefirst-root,#cmpwrapper", ".cookiefirst-root button[data-cookiefirst-action=adjust]", "button[data-cookiefirst-action=reject_second]", "#cookieBanner [class*='b-cookie-notice-banner__']", "#cookieBanner [class*='e-buttons__'] button[class*='m-outline__']", "[class*='b-settings__'] [class*='e-button-container__'] button", "[class*='b-settings__'] [class*='e-checkbox__']:not([class*='m-unchecked__'])", "%22AdConsentGiven%22%3Afalse", 'div:has(> div > [data-test-id="accept-cookies-button"])', 'div:has(> [data-test-id="accept-cookies-button"]) a[data-test-id="link"]:not([href])', '[data-test-id="accept-cookies-button"]', '[data-test-id="modal_base"] form input[name="marketing"]', '[data-test-id="modal_base"] form input[type="checkbox"]:checked:not([disabled])', '[data-test-id="modal_base"] button[type="submit"]', "#popup-cookies", "#popup-cookies .cancelar-popup", "disclaimerCookies=12=false&14=false&15=false", '#cookie-consent[style*="max-height"] #cookie-status-reject', "#b1ng-cc", "#b1ng-cc .b1ng-cc-no", ".fc-cta-do-not-consent,.fc-cta-manage-options,.fc-li-only-placeholder", "b1ng_consent=n", '[data-react-class="CookieNotice"]', '[data-react-class="CookieNotice"] button', '.cc-window[aria-describedby="cookieconsent:desc"] .cc-dismiss', ".cookie-notice-layout .cookie-notice-dismiss", ".ui-alert.bottom-fixed a[data-href*='cookie-policy']", ".ui-alert.bottom-fixed", ".ui-alert.bottom-fixed button.close", "cmp-cookie-bar", "cmp-cookie-bar.initialized", "Cookie-Control=", "Cookie-Control=notified", "body.enable-cookie-control", ".cookie-dialog-initial", ".cookie-dialog-initial button.g-button.outline", "cookie_preferences=%7B%22allow%22%3A%5B%5D", "#cookie_modal_placeholder dialog.bm-modal--cookie", "Analytics_consent=2", "Marketing_consent=2", '.MuiDialog-root:has([data-uit="accept-all"], [data-uit="store-changes"])', '[role="dialog"] #approveAllCookies[data-uit="accept-all"]', '[role="dialog"] [data-uit="show-details"]', '[role="dialog"] [data-uit="store-changes"]', '[role="dialog"] input[role="switch"]:checked', '[role="dialog"] [data-uit="accept-all"], [role="dialog"] [data-uit="store-changes"]', ".cookie-alert", ".cookie-alert .inner-cookie-alert .consent-actions", ".cookie-alert-v2", ".cookie-alert-v2 .consent-actions button:nth-of-type(2)", ".cookie-alert .consent-actions button.btn-outline-light", ".cookie-alert .consent-settings", '.cookie-alert .consent-settings input[type="checkbox"]:not([disabled]):checked', '.cookie-alert .consent-settings button[type="submit"]', "__consent=1", ".modCookieBar button[onclick*='declineMatomoConsent']", ".modCookieBar", '*[aria-labelledby="consent-banner-title"]', "#bbccookies-prompt:has(#bbccookies-reject-button)", "#consent-banner-title", "#bbccookies-reject-button", 'button[data-testid="reject-button"]', "ckns_explicit=1", "#cookiePrompt:has(#bbccookies-continue-button)", "#bbccookies-continue-button", "#bbccookies-prompt", "#note .cpref", "#note .cpref #cPrefToggle", "#cPrefToggle", '#cPrefModal label[for="tab-4r"]', "#cPrefSave", "section.cookie", "section.cookie .cookie__container .cookie__close", "section.cookie.show .cookie__container", "section.cookie.show .cookie__close", "#cmp-deny-all", ".rcc-f", ".rcc-61 > button.rcc-3", ".rcc-61", ".cookies-document-change-alert", ".cookies-document-change-alert button.close", ".q-dialog:has(.cookiePopup)", ".cookiePopup .cookiePopupStepOne", ".cookiePopupStepOne button.sbButton.secondary", ".cookiePopupStepTwo", '.cookiePopupStepTwo [role="checkbox"][aria-checked="true"]:not([aria-disabled="true"])', ".cookiePopupStepTwo button.sbButton.primary", 'div.fixed.bottom-0.z-50:has(> span > a[href="/privacy-policy"])', 'div.fixed.bottom-0.z-50:has(> span > a[href="/privacy-policy"]) > button', "betway-cookie-policy=true", '.cc-window[aria-describedby="cookieheading"]', ".cc-window .dp--cookie-check", ".cc-window:not(.cc-invisible) .cc-compliance", ".cc-window .cc-settings", ".cc-window .dp--check-box:checked:not(:disabled)", ".cc-window .cc-allow", '"dp--cookie-marketing":false', ".cookies-box", ".cookies-box #btn-accept-cookies", ".modalwindow-container.bar .modalwindow", "#bibliotheek-nl-page", ".modalwindow-container.bar .modalwindow button.button.primary.notok", "#b_notificationContainer.bnp_ttc", "#b_notificationContainer.bnp_ttc #bnp_ttc_close", "#bnp_ttc_close", '#thp_notf_div:has(a.hpn_top_link[href*="linkid=521839"], a.hpn_top_link[href*="bGlua2lkPTUyMTgzOQ"])', ".authorize", ".authorize .lnk-disagree", "save_open_time=ok", ".message-accept-container", ".message-accept-container[style*='flex'] .message-x", ".message-accept-container .message-x", "#cookie-content.box-cookie-wrapper", "#cookie-content.box-cookie-wrapper #btn-cookie-reject-all", "#cookie-content #btn-cookie-reject-all", "_bn_mfc=-1", ".sygnal24-gdpr-modal-wrap", ".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-modal", ".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-options input:checked:not([disabled])", ".sygnal24-gdpr-modal-wrap .sygnal24-gdpr-accept-choice", 'gdpr-consent=["necessary"]', "#cookies .alert [data-dismiss=alert]", "#cookies .alert", "cookies=ok", "#cookies.c-modal-cookies", "#cookies.c-modal-cookies .o-modal__footer", "#cookies.c-modal-cookies .o-modal__footer .c-button--secondary", "#cookies-settings.c-modal-cookies-settings .o-modal__footer", "#cookies-settings .o-list-bare__item:not(.disabled) .o-input-switch input:checked:not(:disabled)", "#cookies-settings.c-modal-cookies-settings .o-modal__footer .c-button--secondary", "cookies_consent=strictly_necessary", "[role=dialog] [data-cy=allowCookiesButton]", '[role=dialog] [data-cy=allowCookiesButton] ~ a[href="/articles/cookies"]', ".container > h3 ~ button", ".container > h3 > input[type=checkbox]:checked:not([disabled])", "BokadirektCookiePreferencesMP=Mandatory", "#cookiemodal #cookie-donottrack", "#cookiemodal:not(.cookiemodal--hidden) #cookie-donottrack", "BokioDNT=DoNotTrack", '[data-testid="C75-alerts"] .bom-form-alert:has(a[href="/privacy"]) button', '[data-testid="C75-alerts"] .bom-form-alert:has(a[href="/privacy"])', "div.cookiePolicy", "div.cookiePolicy > span[href='#']", "cookiePol=1", "[role='dialog'][aria-label='Cookie preferences']", "xpath///div[@role='dialog' and @aria-label='Cookie preferences']//button[normalize-space(.)='Configure']", "xpath///div[@role='dialog' and @aria-label='Cookie preferences']//button[normalize-space(.)='Reject all']", "bf_consent=1.000.", ".cookiebanner-container", ".cookiebanner-container [data-test=adjust-cookies]", ".cookiebanner-container .checkbox-container", ".cookiebanner-container .checkbox-container input[type=checkbox]:checked:not(:disabled)", ".cookiebanner-container .buttons-container button:not([data-test=adjust-cookies])", "cookies-accepted=false", ".c-consent-modal__container", ".c-consent-modal__reject-link-container button", ".c-consent-modal__consent-preference-container", ".c-consent-modal__consent-preference-container .c-consent-modal__switch input:checked", ".c-consent-modal__consent-preference-container .c-consent-modal__accept-button-container button", "COOKIE_CONSENT_MODAL=completed", ".keks-privacy-layer", ".keks-privacy-layer #cube-cmp-reject-all", ".keks-privacy-layer[open]", "acceptedCategories%22%3A%5B%22REQRD%22%5D", ".blp-necessary-cookies-banner", ".blp-necessary-cookies-banner__button", "has-dismissed-necessary-cookies-banner=true", "#banner-terms-dismiss", '"haveConsent":true', "#banner-terms", "dismissedTermsNotice", ".consent-banner", ".consent-banner .manage-cookies-btn", ".config-banner .config-banner_section", ".config-banner input[type=checkbox]:checked:not(:disabled)", ".config-banner .accept-btn", "x-bsw-consentCookie", "#js-cookie-alert #cookie", "#js-cookie-alert.show #cookie", "#js-cookie-alert #cookie button.closeAlert", ".cookieHolder", ".cookieHolder .cookie-link", "GeneralCookieState=cookiestate", ".cookie-consent", ".cookie-consent .cookie-consent__customize", ".cookie-consent .cookie-consent__details", "#consent-analytics:checked", "#consent-analytics", ".cookie-consent .cookie-consent__save", "#cc-banner", "#cc-banner #cc-reject", '[role="dialog"][aria-modal="false"]:has(a[data-anchor-id="cookie-policy"])', '[role="dialog"][aria-modal="false"]:has(a[data-anchor-id="cookie-policy"]) button:last-child', 'div:has(> h3):has(> p a[data-anchor-id="cookie-policy"]) + div > button:last-child', 'div:has(> h3):has(> p a[data-anchor-id="cookie-policy"]) ~ div:last-child > button:only-child', "CTC=", "div.modal.cookiesModal.is-open", 'div.cookiesModal__buttonWrapper > button[data-closecause="close-by-manage-cookies"]', "button#js-manage-data-privacy-save-button", "#privacy-banner-lh .lh-close-button", "lh-warning-test=manual-no", "#cu-cookie-alert", "#cu-cookie-alert #accept-cookie-message", ".cc-cookies .main", ".cc-cookies .main .btn-cookies-config button", ".cc-cookies .main[style*='display: block'] .btn-cookies-config button", "#modalConfigCookies #acceptAdditionalCookies", "#modalConfigCookies #acceptAdditionalCookies:checked", "#btnConfigCookies button", "cookie-agreed=false", "#cookie-notification", "#cookie-notification .cookie_pref_wrapper .pref-opt.refuse", "#cookie_banner #myModal", "#cookie_banner #myModal #popupCross", "#myModal #popupCross", ".incentive-banner", "#cookie-compliance", "#cookie-compliance [data-cookie-accept]", "#js-cookie-banner", "#js-cookie-banner .js-cookie-settings-btn", "#js-cookie-banner .cookie-banner-content", "#js-cookie-banner-modal .cookie-settings", "#js-cookie-banner-modal .js-cookie-setting-switch.btn-toggle-on", "#js-cookie-banner-modal .js-done-btn", "rac=1", ".cookie-popup.js-cookie-popup", ".js-cookie-popup .js-cookie-popup-close", ".js-cookie-popup", ".cookie-banner .all4-cc-primary-button", '.cookie-banner button[aria-label="Reject non-essential cookies and continue."]', "C4_CC=eyJ2ZXJzaW9uIjoxLCJjb25zZW50ZWQiOnRydWUs", "#cookie-banner #cookie-see-more", "#cookie-banner .cookie-banner.visible #cookie-see-more", "#cookie-choices-modal .reject-cookies", "#cookie-banner .cookie-banner.visible", "dialog[data-cookie-consent]:not([aria-modal]):has(form[data-privacy-consent-form])", 'dialog[data-cookie-consent] form[data-privacy-consent-form] button[name="action"][value="reject"]', "dialog[data-cookie-consent]:has(form[data-privacy-consent-form])", "dialog[data-cookie-consent]", "#usecookie", "#usecookie #usercookie_close", ".cookie-banner .cookie-banner__button-wrap", ".cookie-banner__button-wrap button.-interaction", ".cookie-banner-consent-modal__button", ".cookie-banner-consent-modal input[type=checkbox]:checked:not(:disabled)", '"analytics_storage":"denied"', 'div[role="dialog"][aria-label="Cookie settings"]', 'xpath///div[@role="dialog"][@aria-label="Cookie settings"]//button[normalize-space()="Cookie settings"]', 'xpath///div[@role="dialog"][@aria-label="Cookie settings"]//button[normalize-space()="Do not accept"]', ".cookiesInfo .closeCookiesInfo", ".cookiesInfo", ".wt-consent-layer-intro", ".js-consent-accept-required", ".js-consent-settings", ".wt-consent-manager .wt-consent-manager-save", ".js-cookie-banner", "#js-cookie-banner__button-reject", "#js-cookie-banner__button-hide", "#csr-cookie-message", "#csr-cookie-message #accept_essential_cookies_button", "cookies_accepted=essential", ".cookie-bar-backdrop", "#js-cookie-notification .js-reject-cookie", "#js-cookie-notification.opened", "#js-cookie-notification.opened .js-reject-cookie", "cookie-notification=REJECTED", "#gdpr-banner", "#gdpr-banner #gdpr-essential-btn", "xpath///div[contains(@class, 'c-site-notification ')][contains(., 'cookies')]", "xpath///div[contains(@class, 'c-site-notification ')][contains(., 'cookies')]//div[contains(@class, 'c-site-notification__close')]/button", "doca_site_notification_", ".cookieNotificationContainer", "#cookie-banner #manage-cookies", "#cookie-modal #save-preferences", "#cookie-modal .toggle:checked", "#cookie-modal .reject-all", "%22analytics_storage%22%3Afalse", "#cookiesjsr #cookiesSize.cookiesjsr-banner", "#cookiesjsr", "#cookiesSize.cookiesjsr-banner.active", "#cookiesSize .cookiesjsr-banner--action .cookiesjsr-btn:not(.important)", "#cookie-banner [data-clickid=cookiepopup_managecookies]", "[data-cy=acceptSelected]", "input[data-widget=hdPreferenceToggle]:checked", "consentPreference=essential", "#CookieNotification", "#CookieNotification .gap-4 > :first-child", "#CookieNotification .gap-4", "#CookieNotification dialog #marketing-checkbox", "#CookieNotification dialog input[type=checkbox]:checked:not(:disabled)", "#CookieNotification dialog footer .justify-between > :first-child", "__cl_no_analytics=true", "__cl_no_marketing=true", "#consent-banner", "#consent-banner #truste-consent-track", "#truste-consent-required", "cmapi_cookie_privacy=permit_1_required", "#cookie-banner #customizeCookies", "#cookie-settings #saveCookies", "#analytics-cookies:checked", "#analytics-cookies", "#marketing-cookies:checked", "#marketing-cookies", "#cookie-settings", ".cookieconsent[data-init=cookieConsent]", ".cookieconsent.cookieconsent--active", ".cookieconsent [data-cookieconsent=button]", "acceptCookies=true", ".cookie-prompt-container", ".cookie-prompt-container #custom-cookie-banner-container", ".cookie-prompt-container #analytic-cookie:checked", ".cookie-prompt-container #analytic-cookie", ".cookie-prompt-container .confirm-cookies", "cookie_policy=false", "gsc-cookie-banner", "[data-consent-button][data-value=accept_partial]", '[role=dialog]:has(img[src*="/assets/Cookies.svg"])', '[role=dialog]:has(img[src*="/assets/Cookies.svg"]) button', "gdprcm=true", 'div.fixed.z-50.rounded-xl:has(> p > a[href*="privac"]):has(> button.button-primary)', '#costco-consent-manager [data-testid="Popup"]', '#costco-consent-manager [data-testid="Popup"], script[src*="/consent-ui/costco-consent-manager"]', "#costco-consent-manager", '.cookie-banner-alerts > div:has(button[aria-label="Accept"])', '.cookie-banner-alerts button[aria-label="Accept"]', "crc-main-cookie-consent", "crc-m-cookie-consent", 'crc-main-cookie-consent [data-cy="cookie"], crc-m-cookie-consent [data-cy="main"]', "crc-main-cookie-consent, crc-m-cookie-consent", "div:has(> div > #rcc-confirm-button)", "xpath///div[div/button[@id='rcc-confirm-button']]//button[normalize-space()='Cookie settings']", "xpath///div[div/button[@id='rcc-confirm-button']]//button[normalize-space()='Save preferences']", "CrosswaterCookiePreferences=", "analytics%22:false", "marketing%22:false", "#cookie-config-panel", "#cookie-banner #configure-cookies", "#cookie-config-panel #reject-cookies", "cookiesRejected=1", "#CookiesWindow", "#CookiesWindow .rodo-window", "#cookie-disclaimer", "#cookiesel", ".box-cookie", ".box-cookie .box-cookie__inner", ".box-cookie .btn-normal.is-small", "disney_cc=ok", '#cuvva-app-injection-site button[data-testid="accept-cookies"]', "cuvva.app.website.cookie-policy.consent.v2=", '#cuvva-app-injection-site button[aria-label="Reject all"]', "cuvva.app.website.cookie-policy.consent.v2={%22preferences%22:{%22functional%22:true%2C%22analytics%22:false%2C%22marketing%22:false", '[class*="PrivacyBar_gdprAgreement"] [class*="PrivacyBar_managePrefsBtn"]', '[class*="PrivacyBar_gdprAgreement"]', '[class*="CookieManagementModal_confirmBtn"]', '[class*="CookieManagementModal_dropdownHeader"] [class*="SwitchButton_toggleSwitch"] input:checked', "%22targeting%22:false", "gdpr-consent-popup", '[data-rum="cookie-consent"]', '[data-rum="cookie-consent"] [data-rum="cookie-consent-text"]', '[data-rum="cookie-consent"] [data-rum="cookie-consent-text"] + div > button:first-of-type', '[data-rum="cookie-consent"] div.grid input[type="checkbox"]', '[data-rum="cookie-consent"] div.grid:has(input[type="checkbox"]:checked:not([disabled]))', '[data-rum="cookie-consent"] div.grid ~ div > button:last-of-type', "cookie_consent=necessary", "#notice-cookie-block .reject-cookies-button", "DDM2_cookie_management=%7B%22statistics%22%3A0%2C%22comfort%22%3A0", 'div[role="dialog"][class*="CustomCookieBanner"]', "#onetrust-consent-sdk .ot-pc-refuse-all-handler", "#cookies-modal", '[data-qa="CookieBar"]', '[data-qa="CookieBar"] > button:last-of-type', 'xpath///*[@data-qa="CookieTypesSelector"]/following::button[1]', ".public-map-notices .cookie-consent", ".public-map-notices .cookie-consent .cookie-opt-out", ".public-map-notices .cookie-consent .cookie-dismiss", "dialog.js-cookie-bar", "dialog.js-cookie-bar .js-reject-all", "CookieLevel=Functional", '.MuiDialog-root [role=dialog] button[aria-label^="Odrzu\u0107 wszystkie i zamknij popup"]', ".custom-cookiebar", ".custom-cookiebar .custom-cookiebar__link", "#cookie-banner.CookieBanner [data-action='show-settings']", "#cookie-banner.CookieBanner", "#cookie-banner .CookieBanner__Notice [data-action='show-settings']", "#cookie-banner .CookieBanner__Settings .Button--secondary[data-action='close-modal']", ".cc-window.cc-visible", ".cc-window .cc-dialog", ".cc-window.cc-visible .cc-consent-require-only", "dji_consentmanager", ".privacy_policy_sec", ".privacy_policy_sec .cookieinfocustom", "#cookiemodal .refuse_all_cookie", "#cookiemodal .acceptchoices", "_cookie_ads=0", ".c-notice + .cursor-pointer", "EU_COOKIES_CONSENT=true", "#cookiebanner.cookieAcceptBar", "#cookiebanner.cookieAcceptBar #cookiebot-container", "#cookiebot-container div.manage-preferences", "#cookiePreferencesModal-card", "#cookiePreferencesModal-card input[type=checkbox][data-type]:checked", "#cookiePreferencesModal-card #cookieModalButton", "marketing%3Afalse", 'div[class*="cookie-banner-"]', 'div[class*="cookie-banner-"] [class*="cookie-footer-"]', 'div[class*="cookie-banner-"] [class*="cookie-footer-"] > button:not([data-testid="cookie_banner_notice"])', "#ari-nw-x", "#ari-nw-x .ari-nw-btn", "#ari-nw-x button.ari-opx-btn[data-key='consent:set']", "#ss-su #ss-ck-a0", "#ss-su #ss-ck-f0", "#ss-su #ss-ck-s0", "#ss-su #ss-rl-f1-btn", "#ss-ck-f0.ari-h1", "#ss-ck-s0.ari-h1", "#ss-ck-a0.ari-h1", "cookie-wall.popup-cookies", "cookie-wall.popup-cookies .cookie-next_btn", "cookie-wall.popup-cookies .cookie-step_two", "cookie-wall.popup-cookies .cookie-step_two input.cookie-consent:checked:not(:disabled)", "cookie-wall.popup-cookies .cookie-step_two .save_btn", "%22ad_storage%22%3A%22denied%22", ".js-overlay .js-consent .js-consent-selected", ".js-consent .js-consent-option.is-selected[data-value=stat]", ".js-consent .js-consent-selected", "cks=req", "stat", ".gdpr-modal .gdpr-modal__button--confirm", ".gdpr-modal", ".gdpr-modal .js-show-other__button", ".gdpr-modal .js-gdpr-switch[aria-checked=true]", "duunitori_gdpr_terms_accepted=true", '.cc-type-info[aria-describedby="cookieconsent:desc"] .cc-dismiss', "#cookiePopup [data-trigger=launchCookieDetails]", "#cookiesModal [data-trigger=saveCookiePrefs]", "cookiePrefs=", "#cookiePopup", "#cookiesModal", "#cookiesModal #functionalCookies:checked", "#cookiesModal #functionalCookies", "#cookiesModal #advertisingCookies:checked", "#cookiesModal #advertisingCookies", "#gdpr-banner-decline", ".cookie-wrapper", ".cookie-wrapper > .cookie-notice", "[data-test-id=cookie-notice-reject]", "#cookieBanner button[data-fragment=button]", "#cookieBanner button[data-fragment=button]:last-of-type", "[role=dialog][data-smtype=Dialog_alert] button[data-fragment=button]", "[role=dialog][data-smtype=Dialog_alert] [data-fragment=switch] input:not([disabled])[value=true]", "[role=dialog][data-smtype=Dialog_alert] button[data-fragment=button]:last-of-type", "cookies_analytics=false", "#edp-cookies-banner", "#edp-cookies-banner .edp-cookies-refuse", "edp_cookie_agree=0", "app-aviso-cookies .c-aviso-cookies", "app-aviso-cookies .c-aviso-cookies__btn", "#educacentrosPrivacyPolicyLayer", "#cookie-message #close-cookie-message", "#cookie-message", "#__next button.button-yes + button.button-no", "#huk_cookie_prefernce_panel", "#huk_cookie_prefernce_panel #EU_OPIN_REJECT", "EKD_OPTIN=1", ".cookie-bar__wrapper:has(.cookie-bar__message--top)", ".cookie-bar__wrapper .cookie-bar__message--top", ".cookie-bar__wrapper .cookie-bar__container", '[data-testid="cookie-banner"]', '[data-testid="accept-all-cookies-button"] ~ [data-testid="cookie-settings-button"]', '[data-testid="reject-all-cookies-button"]', '[data-testid="cookie-settings-button"]', '[data-testid="accept-all-cookies-button"]', ".modal:has(> .modal-content > .cookie-consent)", ".cookie-consent #cookieDisagree", "#consent-cookie-modal", "#consent-cookie-modal #cookie-selection-button", "#consent-cookie-modal input[type=checkbox]:checked:not(:disabled)", "EMR-CookieConsent-Advertising=0", "#block-eh-default-cookiebannerfixedblock", "#block-eh-default-cookiebannerfixedblock .js-cookie-alert", "#block-eh-default-cookiebannerfixedblock .js-cookie-alert .alert-close", "#gdprBanner", "#gdprBanner .js-close-btn", '#app > div:has(a[href*="business.safety.google"])', '#app > div:has(a[href*="business.safety.google"]) p + div > button', '#app > div:has(a[href*="business.safety.google"]) p + div > button:last-child', "[role=dialog] form input#MARKETING", "[role=dialog] form input[type=checkbox]:checked", "[role=dialog] form button[type=submit]", "cconsent=1000", "div:has(> div > #rcc-confirm-button) > div > button.btn-outline", "main .offset-sub-text > button.btn-outline", "CookieConsent=false", ".cookie-banner-container", ".cookie-banner-container button.preferences", "#ccc-optional-categories .checkbox-toggle-input:checked", '"analytics":"revoked"', ".global-cookie.js-cookie-banner", ".global-cookie.js-cookie-banner .global-cookie__button", ".global-cookie.js-cookie-banner:not(.global-cookie__hidden)", "_consent_banner_read=true", "#clb.clb-container", "#clb.clb-container #moreSettings", "#clb #moreSettings", "#clb #clb-panel-2", "#clb #switch2[data-active=true]", "#clb #saveSettings", "dws01-level=1", "#es-cookie-banner", "#es-cookie-banner #es-consent-settings-btn", "#es-consent-settings-btn", "#onetrust-consent-sdk input.category-switch-handler:checked", "#rgpd", "#rgpd #rgpd_refus", "#rgpd_refus", "_ecdg=assistance_O#audience_N#targeting_N", 'xpath///div[h2[normalize-space()="Ustawienia prywatno\u015Bci i cookies"]][.//button[normalize-space()="Zgadzam si\u0119"]]', 'xpath///div[h2[normalize-space()="Ustawienia prywatno\u015Bci i cookies"]]//button[normalize-space()="Zmie\u0144 ustawienia"]', 'xpath///div[h2[normalize-space()="Ustawienia prywatno\u015Bci i cookies"]]//button[normalize-space()="Zezw\xF3l na wybrane"]', ".cookies-line", '.cookies-line a[href="/cookies-policy"]', ".cookies-line.show", "#cookie-information", "#cookie-information button.close", "[data-cookie-hint]", "[data-cookie-hint] [data-cookie-hint-save-settings]", "[data-cookie-hint] [data-cookie-first]", "[data-cookie-hint] [data-cookie-hint-settings]", "[data-cookie-settings] #cookie-setting-1", "cookieHint=1", "cookieAllowed=1", "div#klaro", "xpath///div[contains(@class,'pointer-events-none')]//button[normalize-space()='Accept all' or normalize-space()='Tout accepter']", "xpath///button[normalize-space()='Customize' or normalize-space()='Personnaliser']", "xpath///button[normalize-space()='Decline' or normalize-space()='Refuser']", "escaparium_cookie_consent_decided=1", '[data-cy="cookies-dialog"]', '[data-cy="cookies-dialog"] [data-cy="personalize-cookies-button"]', '#personalize-menu [data-cy="accept-essentials-button"]', ".cdk-overlay-container", ".cdk-overlay-container app-esaa-cookie-component", ".btn-cookie-refuser", "#cookie-consent-banner .wt-cck--container", '.wt-cck--actions-button[href="#refuse"]', "%22cm%22%3Atrue%2C%22all1st%22%3Afalse", "#tf-modal-container:has(.cookie-modal__footer)", "#tf-modal-container .cookie-modal__footer .js-nl-modal-decline", "#tf-modal-container .cookie-modal__footer", "efrg_v1_tracking_full=0", "common-tracking-optin", "common-tracking-optin p.opt-in__text-item:nth-of-type(2) > a:last-of-type", ".privacy-bar", ".privacy-bar #close-rgpd-notice", "#close-rgpd-notice", "#show-cookie-settings", "#cookieBanner.extra-cookie-banner", ".c_extra-cookie-preference-popup", "#cookieBanner #js-cookie-preferences", ".c_extra-cookie-preference-popup #saveCookiePreference", ".c_extra-cookie-preference-popup .js-cookie-checkbox:checked", '[role="dialog"]:has(a[href*="/policies/cookies/"]) div[aria-hidden="true"] + div[role="button"][tabindex="0"]', '[role="dialog"]:has(a[href*="/policies/cookies/"])', '[data-testid="cookie-policy-manage-dialog-decline-button"]', "#cookie_notice", '#cookie_notice [onclick="_cookieAccept()"]', "#cookie-wall-short", "#cw-controls #cwc-accept", "#cw-controls #cwc-reject", "#cookie-wall-short #cwc-accept", "#cw-controls", "#cookie-bar #cookieBarClose", '#cookie-bar[aria-hidden="false"]', "#cookie-bar #cookieBarClose .cookie-bar-close", "FSE-COOKIEBAR=hide", "#gdpr_cookie_info_bar-wr .gdpr-close-button", "#gdpr_cookie_info_bar-wr:not(.d-none) .gdpr-close-button", 'div:has(> div > div > button[name="gdpr_agree_btn"])', 'button[name="gdpr_agree_btn"]', "a[href='/?cookie=1'] > img[title*='cookies']", "a[href='/?cookie=1']", ".c-cookie-notice.js-cookie-bar", ".c-cookie-notice.js-cookie-bar .c-cookie-notice__button", ".c-cookie-notice.js-cookie-bar.show .c-cookie-notice__button", "#avisoCookies", "#avisoCookies .cerrarAvisoCookies", ".fancybox-wrap:has(#cookiemanager-popup)", "#cookiemanager-popup #cookie-modal-close", 'cookieConsent={"cookie":"rejected","cookieThird":"rejected"}', ".dx-cookie-banner:has(.dx-cookie-banner-close)", ".dx-cookie-banner .dx-cookie-banner-close", "CookiePolicy=OK", "#gdpr_notification_container #gdpr_reject_button", ".popup-container:has(.cookie-links #js-cookie-reject)", ".cookie-links #js-cookie-reject", '"marketing":false', "#cookie #cookies-marketing", "#cookie .accept-all", "#cookie a.settings", "#cookie .cookie-settings button.close", "allow_necessary=true", ".cookieCheckContainer", ".cookieCheckContainer .closeBtn", "ACP=1", "[role='dialog'] input[name='cookieConsent']", "[role='dialog'] button[type='submit']", "[role='dialog'] button[role='checkbox'][data-state='checked']:not([data-disabled])", "#cookie-mask", "#cookie-mask #cookieContainer", "#cookieContainer #btn-cookie-accept-edit", "#cookier-page-2 #btn-cookie-accept-nothing", 'cookie_accepted={"nothing": 1}', 'gf-notifications .notification:has(a[href^="https://policies.google.com/technologies/cookies"])', 'gf-notifications .notification a[href^="https://policies.google.com/technologies/cookies"]', 'gf-notifications .notification:has(a[href^="https://policies.google.com/technologies/cookies"]) button.notification__close', ".cookie-banner .cookie-banner__manage", "form.fsa-cookie-consent-form #reject-all-cookies", "cookieconsent_dismissed=yes", '"analytics":"no"', ".message--cookie", ".message--cookie .message__close", ".message--cookie:not(.message--closed)", "accepted_cookies=true", ".fk-cookie-warning", ".fk-cookie-warning .cookie-warning-content", ".fk-cookie-warning .cookie-warning-content button:nth-of-type(2)", "fk_hide_cookie_warning=true", ".cmp__consent .cmp__preferences-button", ".cmp__consent", ".cmp__service-groups__buttons button:not(.button--primary)", "C0002:0,C0003:0,C0004:0", "#nee_fpl_cookie_policy_banner", "#fpl_cookie_policy_banner_close", '.cc-window[aria-describedby="cookieconsent:desc"] .cc-deny', '.cc-window[aria-describedby="cookieconsent:desc"]:not(.cc-invisible)', "cookieconsent_status=deny", "#cookie-banner .btn-close-cookie", "aside[role='dialog'][aria-label='This website uses cookies']", "xpath///aside[@role='dialog']//button[normalize-space()='Preferences']", "xpath///aside[@role='dialog']//button[normalize-space()='Decline All']", "aside[role='dialog']", ".banner-cookie-consent", ".banner-cookie-consent .cc-options", ".modal-cookie-consent .cc-save", ".modal-cookie-consent input[name='cc-option-analytics']:checked", "cookie_prefs=0", ".cookies-block", ".cookies-block button", "fuqer-allow-cookies=1", "#consent-banner #cookie-banner-text", "#consent-banner #cookie-banner-text button", "#do-not-sell-master", '#do-not-sell-master[aria-checked="true"]', "#cookies-tab", "#cookies-panel", '#cookies-panel button[role="switch"][aria-checked="true"]', "#pixel-tab", "#fdc-pixel", '#fdc-pixel[aria-checked="true"]', '[data-testid="closeQuickView"]', '#consent-banner button[aria-label="Dismiss banner"]', ".cm-custom-cookie-line", ".cm-custom-cookie-line a[onclick*='fn_show_cookie_popup']", "#cookie_popup form[name=cookie_settings]", "#cookie_popup input.consent-checkbox:checked:not([disabled])", "#cookie_popup input[type=submit][name*='save_settings']", "consent_cookie=%7B%22ad_storage%22%3A%22denied%22", "#privacy_modal", '.gfu-floating-notification-box--fixed:has([data-qa^="cookie-policy-box"])', '[data-qa^="cookie-policy-box"] [data-qa="cookie-policy-button:AcceptAll"]', '[data-qa^="cookie-policy-box"]', "#modalCookies", "#modalCookies #ck_marketing", '#modalCookies a[data-action="preferencias"]', "#modalCookies .preferencias", "#modalCookies .preferencias input[type=checkbox]:checked:not([disabled])", '#modalCookies a[data-action="aceptar"]', "gc-cookie=%7B%22estadisticas%22%3A0%2C%22marketing%22%3A0%7D", ".modal-cookie", ".cookie-consent-popup .cookie-consent-popup__decline-button", "cookie_consent_acquired=false", ".push-banner-consent", ".push-banner-consent button.close", '[class*="CookieConsentBanner_banner"]', '[class*="CookieConsentBanner_customizeButton"]', '[class*="CookiePreferencesModal_rejectButton"]', "gk-cookie-consent=%7B%22necessary%22%3Atrue%2C%22analytics%22%3Afalse%2C%22marketing%22%3Afalse%2C%22functional%22%3Afalse%7D", "#editconsent", "#gu-cookie-control", "#gu_analytics_switch_off", "#gu_ads_switch_off", "#gu-consent-confirm", "gu_consent_set=true", "gu_analytics=false", "gu_remarketing=false", ".cookies-modal", ".show-cookies-modal .cookies-modal #cookies-accept", ".show-cookies-modal .cookies-modal #cookies-reject", ".cookie-label", ".cookie-label .js-cookies-hide", ".cookie-label .close-btn", "saved_agree=1", "#banner-cookie", "#banner-cookie #banner-cookie-button", "body.with-banner-cookie #banner-cookie", "#banner-cookie-button .btn", "#cookiesConfirmDiv", "#cookiesConfirmDiv span[onclick]", "#cookieBanner a[href*='cookies_agreed=']", "#cookieBanner span[onclick*='cookieBanner']", ".cookie-consent-modal.active", ".cookie-consent-modal #checkbox_analiticas", ".cookie-consent-modal button.config", ".cookie-consent-modal #checkbox_analiticas:checked", ".cookie-consent-modal .btn.accept", "cookies_allowed=true", "#cookies-info", "#cookies-info > .main-container > button", "#cookies-info.active", "#privacy-banner", "#privacy-banner #privacy-banner-close", "gs_privacy_accepted=true", "dialog#consent-modal button.btn-invisible", "dialog#consent-modal", "xpath///div[@role='dialog']//h2[normalize-space(.)='We value your privacy']", "xpath///div[@role='dialog'][.//h2[normalize-space(.)='We value your privacy']]//button[normalize-space(.)='Manage Cookies']", "#perfModal", "#perfModal #refuseCookies", "#perfModal #refuseCookies:not(.perfModal__btn__frozen)", "OptanonAlertBoxClosed=", "[data-target='consent-wrapper']", "[data-target='consent-wrapper'] [data-action='cookies-aanpassen']", "[data-target='consent-wrapper'] .consent:not(.hidden)", "[data-target='cookies-aanpassen'] [data-action='save-cookies']", "[data-target='cookies-aanpassen'] input[type=checkbox]:checked:not(:disabled)", "cookies_consent=1", "#cookie_consent_model", "#analyticsCookieToggle:checked, #prefernceCookieToggle:checked, #marketingCookieToggle:checked", "#customize_cookies", "%22analytics%22%3Afalse%2C%22preference%22%3Afalse%2C%22marketing%22%3Afalse", "div.fixed.inset-0.drop-shadow-2xl", 'div.fixed.inset-0.drop-shadow-2xl button[aria-haspopup="dialog"]', 'div[role="dialog"] button[type="submit"]', "cookieConsent=true", ".cookie-banner .closeme", '.notices--bottom_fixer .js-notice[data-notice-id="1"]', '.notices--bottom_fixer .js-notice[data-notice-id="1"] .js-noticeDismiss', "#injected_cookie_notice", "#injected_cookie_notice #reject_cookies", "#injected_cookie_notice #cook", "#cookie_popup", "#cookie_popup .cookie_buttons", "#cookie_popup a[onclick*='cookie_popup_settings']", "#cookie_popup .cookie_settings", "#cookie_popup .cookie_content_div input[type=checkbox]:checked", "#cookie_popup button[onclick*='cookie_settings_update']", "cookieok_ad_storage=no", 'div[role="dialog"][aria-label^="Privacy Disclosure"]', ".cookie-policy[role=dialog]", ".cookie-policy[role=dialog][aria-labelledby=cookie-policy-heading]", ".cookie-policy[role=dialog] button.clear", ".cookie-policy[role=dialog] [data-ref=marketing]", ".cookie-policy[role=dialog] .cookie-checkmark.checkable.checked", ".cookie-policy[role=dialog] button.orange", '"cookie_consent_beste_ervaring":false', "aside[data-consent-card]", "xpath///aside[@data-consent-card]//button[normalize-space()='Essential only']", "helvy_consent=reject", ".popup-background[data-popup='consent']", ".popup-background[data-popup='consent'] .popup-manage-consent .save-settings", ".popup-background[data-popup='consent']:not(.hidden) .popup-consent", ".popup-background[data-popup='consent'] .popup-consent .manage-cookies", ".popup-background[data-popup='consent'] .popup-manage-consent input[type=checkbox]:checked:not(:disabled)", "hemsol-consent-marketing=false", "[aria-labelledby=cookieModalTitle]:has(.cookie-bar-buttons)", "[aria-labelledby=cookieModalTitle] .cookie-bar-buttons", "[aria-labelledby=cookieModalTitle] .cookie-bar-buttons > div:first-child > button", "[aria-labelledby=cookieModalTitle] label[for=tracking]", "[aria-labelledby=cookieModalTitle] #tracking:checked", "section.gdpr-wrapper .gdpr-button-accept", "section.gdpr-wrapper .gdpr-button-reject", "section.gdpr-wrapper", "paper-dialog.cookie-dialog", "section.cookie a[href*='t=cookiest&cookiev=4']", '.notification-banner:has(a[href*="/cookie-policy/"])', '.notification-banner a[href*="/cookie-policy/"]', '.notification-banner:has(a[href*="/cookie-policy/"]) button.close-notification-banner', ".huawei-bootom-cookie", ".huawei-bootom-cookie .huawei-cookie-close", "app-cookie-message .cookie-message-box", "app-cookie-message .cookie-message-box__close-button button", ".modal-overlay:has(.cookie-consent-initial)", ".cookie-consent-initial", ".modal:has(.cookie-consent-initial) .modal-btn-secondary", ".cookie-consent-preferences", ".cookie-consent-preferences .toggle-control:checked:not(:disabled)", ".modal:has(.cookie-consent-preferences) .modal-btn-secondary", "ho_cookie_consent=essential", ".uccb", ".uccb .uccb__accept-selection", ".uccb .uccb__wrapper", '"statistics":false', '"personalise":false', "#consent-container #consent", "#consent button[data-bs-target='#cookieSettings']", "#cookieSettings .modal-footer", "#grantAdStorageCookies:checked", "#cookieSettings button[onclick*='saveCookieSettings(false)']", "#consent-container #consent,#cookieSettings", "#header-gdpr", "#header-gdpr #header-gdpr-in-btn button", "#header-gdpr.is-active", "gdprCookieData=ok", "#cookie.view:has(.agree .btn)", "#cookie .agree .btn", "#cookie.view", "#modal-cookies", "#modal-cookies-options", "#modal-cookies .cookies-settings-link", "#cookieMarketingSwitch:checked", "#cookieMarketingSwitch", "#modal-cookies-options a[href*='confermaImpostazioni']", "#capa_galleta", "#capa_galleta #acepto_galleta", "#cookie-banner [data-action=decline-cookies]", "site_cookie_consent_declined=1", "#notifica-cookies", "#notifica-cookies .btn-chiudi", "[data-testid=consent-banner]", "[data-testid=consent-banner] [data-testid=reject-button]", "aside[data-testid=cookie-consent-wrapper]", "aside[data-testid=cookie-consent-wrapper] [data-testid=cookie-consent-reject]", "aside[data-testid=cookie-consent-wrapper] :is([data-testid=cookie-consent-right], [data-testid=cookie-consent-settings-link])", "incogni-consent-state=a:0|m:0", "COOKIE_PREF=ANL_0|PSN_0|PRTN_0", `xpath///div[contains(., "Vill du till\xE5ta anv\xE4ndningen av cookies fr\xE5n Instagram i den h\xE4r webbl\xE4saren?") or contains(., "Allow the use of cookies from Instagram on this browser?") or contains(., "Povolit v prohl\xED\u017Ee\u010Di pou\u017Eit\xED soubor\u016F cookie z Instagramu?") or contains(., "Dopustiti upotrebu kola\u010Di\u0107a s Instagrama na ovom pregledniku?") or contains(., "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435 \u0444\u0430\u0439\u043B\u043E\u0432 cookie \u043E\u0442 Instagram \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435?") or contains(., "Vuoi consentire l'uso dei cookie di Instagram su questo browser?") or contains(., "Povoli\u0165 pou\u017E\xEDvanie cookies zo slu\u017Eby Instagram v tomto prehliada\u010Di?") or contains(., "Die Verwendung von Cookies durch Instagram in diesem Browser erlauben?") or contains(., "Sallitaanko Instagramin ev\xE4steiden k\xE4ytt\xF6 t\xE4ll\xE4 selaimella?") or contains(., "Enged\xE9lyezed az Instagram cookie-jainak haszn\xE1lat\xE1t ebben a b\xF6ng\xE9sz\u0151ben?") or contains(., "Het gebruik van cookies van Instagram toestaan in deze browser?") or contains(., "Bu taray\u0131c\u0131da Instagram'dan \xE7erez kullan\u0131m\u0131na izin verilsin mi?") or contains(., "Permitir o uso de cookies do Instagram neste navegador?") or contains(., "Permi\u0163i folosirea modulelor cookie de la Instagram \xEEn acest browser?") or contains(., "Autoriser l\u2019utilisation des cookies d\u2019Instagram sur ce navigateur ?") or contains(., "\xBFPermitir el uso de cookies de Instagram en este navegador?") or contains(., "Zezwoli\u0107 na u\u017Cycie plik\xF3w cookie z Instagramu w tej przegl\u0105darce?") or contains(., "\u039D\u03B1 \u03B5\u03C0\u03B9\u03C4\u03C1\u03AD\u03C0\u03B5\u03C4\u03B1\u03B9 \u03B7 \u03C7\u03C1\u03AE\u03C3\u03B7 cookies \u03B1\u03C0\u03CC \u03C4o Instagram \u03C3\u03B5 \u03B1\u03C5\u03C4\u03CC \u03C4\u03BF \u03C0\u03C1\u03CC\u03B3\u03C1\u03B1\u03BC\u03BC\u03B1 \u03C0\u03B5\u03C1\u03B9\u03AE\u03B3\u03B7\u03C3\u03B7\u03C2;") or contains(., "\u0420\u0430\u0437\u0440\u0435\u0448\u0430\u0432\u0430\u0442\u0435 \u043B\u0438 \u0438\u0437\u043F\u043E\u043B\u0437\u0432\u0430\u043D\u0435\u0442\u043E \u043D\u0430 \u0431\u0438\u0441\u043A\u0432\u0438\u0442\u043A\u0438 \u043E\u0442 Instagram \u043D\u0430 \u0442\u043E\u0437\u0438 \u0431\u0440\u0430\u0443\u0437\u044A\u0440?") or contains(., "Vil du tillade brugen af cookies fra Instagram i denne browser?") or contains(., "Vil du tillate bruk av informasjonskapsler fra Instagram i denne nettleseren?")]`, "xpath///button[contains(., '\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C \u043D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B cookie') or contains(., 'Decline optional cookies') or contains(., 'Refuser les cookies optionnels') or contains(., 'Hylk\xE4\xE4 valinnaiset ev\xE4steet') or contains(., 'Afvis valgfrie cookies') or contains(., 'Odmietnu\u0165 nepovinn\xE9 cookies') or contains(., '\u0391\u03C0\u03CC\u03C1\u03C1\u03B9\u03C8\u03B7 \u03C0\u03C1\u03BF\u03B1\u03B9\u03C1\u03B5\u03C4\u03B9\u03BA\u03CE\u03BD cookies') or contains(., 'Neka valfria cookies') or contains(., 'Optionale Cookies ablehnen') or contains(., 'Rifiuta cookie facoltativi') or contains(., 'Odbij neobavezne kola\u010Di\u0107e') or contains(., 'Avvis valgfrie informasjonskapsler') or contains(., '\u0130ste\u011Fe ba\u011Fl\u0131 \xE7erezleri reddet') or contains(., 'Recusar cookies opcionais') or contains(., 'Optionele cookies afwijzen') or contains(., 'Rechazar cookies opcionales') or contains(., 'Odrzu\u0107 opcjonalne pliki cookie') or contains(., '\u041E\u0442\u0445\u0432\u044A\u0440\u043B\u044F\u043D\u0435 \u043D\u0430 \u0431\u0438\u0441\u043A\u0432\u0438\u0442\u043A\u0438\u0442\u0435 \u043F\u043E \u0438\u0437\u0431\u043E\u0440') or contains(., 'Odm\xEDtnout voliteln\xE9 soubory cookie') or contains(., 'Refuz\u0103 modulele cookie op\u0163ionale') or contains(., 'A nem k\xF6telez\u0151 cookie-k elutas\xEDt\xE1sa')]", '[role="dialog"][aria-modal="true"]:has(a[href*="/1896641480634370"]) div[aria-hidden="true"] + div[role="button"][tabindex="0"]', '[role="dialog"][aria-modal="true"]:has(a[href*="/1896641480634370"]) input[role="switch"]', '[role="dialog"][aria-modal="true"]:has(a[href*="/1896641480634370"]) input[role="switch"][aria-checked="true"]', '[role="dialog"][aria-modal="true"]:has(a[href*="/1896641480634370"]) div[role="button"][tabindex="0"]:not([aria-haspopup]):not([aria-hidden="true"] *)', '[role="dialog"][aria-modal="true"]:has(a[href*="/1896641480634370"])', ".js-cookie-message", ".js-cookie-message #cookie-chiudi", "ISP_Cookie=1.1", "IntesaSanpaoloTracciatura=1", "#cookiebox", "#cookiebox a.close", "#layout div:has(> div > div > span > button[title='EXT_COOKIE_POLICY'])", "#layout div:has(> span > button[title='EXT_COOKIE_POLICY']) + div button", "pkobp-cookie-policy=true", '.overlayContent a[onclick^="optin"]', ".overlayBG", "#cookie-law-info-bar, #cookie-law-bg, .cli-popupbar-overlay, #ez-cookie-dialog-wrapper", "#cookie-law-info-bar, #ez-cookie-dialog-wrapper", ".header-slideout-overlay-cookie", "#cookieConsent", "#cookieConsent [data-cc-save]", "#cookieConsent .cookie-consent", "#cookieConsent [data-cc-switch][aria-checked='true']", "is_consent=v1", ".pop-cookie", "#rti-privacy-open-modal-btn-id", "#rti-privacy-close-btn-id", "#iworks_cookie_notice", "iWorks_Footer_Notice_close=hide", "body.loaded", "#iworks-footer-notice-button-close", "#cp-wrapper", "#cp-wrapper #cp-small", "#cp-small button[onclick*='cp-large']", "#cp-large", "#cp-large input[type=checkbox]:checked:not([disabled])", "#cp-large form > input[type=button]:not([onclick*='setConsentAll'])", "#cookies.cookies-box", "#cookies.cookies-box button[onclick*=jnecookies]", ".MuiDialog-root:has([role=dialog] form a[href*='/compliance'])", ".MuiDialog-root [role=dialog] form a[href*='/compliance']", ".MuiDialog-root [role=dialog] form:has(a[href*='/compliance']) button[type=button]", ".MuiDialog-root [role=dialog] form input[id^='cookie-consent-']", ".MuiDialog-root [role=dialog] form input[id^='cookie-consent-']:checked", ".MuiDialog-root [role=dialog] form:has(input[id^='cookie-consent-']) button[type=submit]", "[data-testid=modal_cookie-consent]", "[data-testid=modal_cookie-consent] .modal-bottom button.jt-btn-outline", "[data-testid=modal_cookie-consent] #marketingConsent", "[data-testid=modal_cookie-consent] input[type=checkbox]:checked:not([disabled])", "[data-testid=modal_cookie-consent-accept]", "jt-cookie-consent-extended=%7B%22ad_storage%22%3Afalse%2C%22analytics_storage%22%3Afalse", "div[class^=pecr-cookie-banner-]", "div[class^=pecr-cookie-banner-] button[data-test=reject-all]", "JOHNLEWIS_ENSIGHTEN_PRIVACY_Advertising=0", "div.fixed:has(#marketingCookies)", "#marketingCookies", '#statisticCookies[aria-checked="true"], #marketingCookies[aria-checked="true"]', "xpath///div[.//button[@id='marketingCookies']]//button[normalize-space()='Auswahl best\xE4tigen']", "cookieChoiceDone=true", "acceptMarketing=false", "acceptStatistic=false", "#cookiebanner-popup", "#jg-chrome-header", "#cookiebanner-popup #accept-essential-Cookies", "necessary:true%2Cpreferences:false", ".consent-banner .consent-banner__actions button.basic-button", ".consent-banner__actions button.basic-button.secondary", ".consent-modal__footer button.basic-button.secondary", ".consent-modal .base-modal__body a", "label.consent-switch input[type=checkbox]:checked", ".consent-modal__footer button.basic-button.primary", ".s_box_avvisocookie", ".s_box_avvisocookie a[onclick*=juzaphoto_refuse_all_cookies]", "juzaphoto_refuse_all_cookies=ok", "#cookie-pop-bn", "xpath///div[@data-nosnippet][contains(., 'uses cookies from Google')]", "xpath///div[@data-nosnippet][contains(., 'uses cookies from Google')]/following-sibling::div/div[contains(., 'Got it')]", "ACCEPTED_COOKIES=true", "#lawcookie", "#lawcookie .lc-close", "#lawcookie.lc-show", ".content-container.gdpr-banner, .content-container.non-gdpr-banner", ".gdpr-banner .customize-button", ".non-gdpr-banner .privacy-text-content button", "[role=dialog] .confirm-choices", "[role=dialog] input.toggle-switch[aria-labelledby=performance]:checked", "[role=dialog] input.toggle-switch[aria-labelledby=research]:checked", "[role=dialog] input.toggle-switch[aria-labelledby=remarketing]:checked", '#root > .chakra-stack:has(> div > p > a[href="/cookies"])', 'button[aria-label^="Tilpass informasjonskap"]', 'xpath///button[contains(., "Lagre val")]', '.kvib-switch__root[data-state="checked"]', "#cookie_monster [onclick*='CookieMonster.denyAll']", "#cookie_monster.is-show [onclick*='CookieMonster.denyAll']", "#cookie_monster.is-show", "#kela-cookie-banner", "#kela-cookie-banner [role=group] button:nth-child(2)", "KelafiCookies=false", ".cookie-alert:has(> .cookie-alert-container)", ".cookie-alert .cookie-alert-container .accept-cookies", ".cookie-alert.show .accept-cookies", ".cookie-alert .accept-cookies", "acceptedCookies=true", "#cookies-banner", "#cookies-banner > button", "script[src*='/utag.v.js']", "#b14cookieconsent", "#b14cookieconsent-dialog", "#b14cookieconsent .b14cookieconsent__checkbox:checked:not([disabled])", "#b14cookieconsent .b14cookieconsent__button[data-action=selected]", "b14cookieconsent=necessary%2C1", "#react-consent-modal", "#react-consent-modal .flex.flex-column", "#react-consent-modal .flex.flex-row.justify-between button:first-child", ".cookie:has(.cookie__inner .cookie__button)", ".cookie > .cookie__inner > .cookie__button > a", "#loader.is--show", ".cookie", "cookiesubmit=1", "#cookie_consent #cookies_accept", "#cookie_consent [role=dialog]", "#cookie_consent [data-test=ModalCloseButton]", "__kwc_agreed=false", "#ccpa-request-consent", "#ccpa-request-consent .settings button", "#ccpa-request-consent.ccpa-banner--visible .settings button", ".ReactModal__Content:has(.toggle-grid) .modal__footer button.button--vibrant--filled", ".ReactModal__Content:has(.toggle-grid)", "#ccpa-request-consent button.close", "#cookie-notice #close-notice", "notice=true", "kb-cookie-consent-dialog", "sb1-optin-v3=", ".bandeau-cookies", ".bandeau-cookies .bandeau-cookies-choix", ".bandeau-cookies-choix > .bandeau-cookies-bouton:first-child", "krillion_cookies=v1.m0.p0", "#cookie-notice-full-consent", "#cookie-notice-full-consent .cn-accept-all-cookies", '#__next div:has(> div > div > div > p > a[href="/polisa-o-postovanju-privatnosti"]):has(button[aria-label="Prihvatam"]), #__next section[class*="_consentHolder"]', ".cookieconsent .cc_banner-wrapper", ".cookieconsent .cc_banner-wrapper [onclick*='refuseAllCookiesPreferences']", ".cookieconsent .cc_banner", ".cc_banner [onclick*='refuseAllCookiesPreferences']", "_cprefs=%7B%22stats%22%3A1%2C%22fct%22%3A1%2C%22mkt%22%3A1%7D", "#qc-cmp2-ui, #qc-cmp2-usp", '#qc-cmp2-usp .qc-usp-ui-content button[mode="primary"]', "#qc-cmp2-mspa-success-modal-button-footer-container button", "#qc-cmp2-container button.qc-cmp2-link-inline", "#reject-all-btn", "#save-and-exit", "#js-cookie-section", "#js-cookie-section #js-cookie-consent-deny", "#js-cookie-section.show", "cookieConsent=false", "[data-controller=cookie-bar]", "[data-controller=cookie-bar].show", "[data-controller=cookie-bar] [data-action='click->cookie-bar#customize']", "[data-controller=cookie-bar] [data-cookie-bar-target=consentOptions]", "[data-cookie-bar-target=analytics]:checked,[data-cookie-bar-target=preferences]:checked,[data-cookie-bar-target=marketing]:checked", "[data-controller=cookie-bar] [data-action='click->cookie-bar#acceptSelection']", "#bannerCookies #cookieBanner", "#cookieModal #rejectCustomizationsBtn", "ad_storage=denied", "#gdpr", "#gdpr #gdpr-button", "div.fixed.bottom-4:has(> div > button > img[alt='close-black'])", "xpath///div[contains(@class,'fixed')][.//img[@alt='close-black']][.//button[contains(., 'Manage settings')]]", "xpath///div[contains(@class,'fixed')][.//img[@alt='close-black']]//button[contains(., 'Manage settings')]", "xpath///div[contains(@class,'fixed')][.//img[@alt='close-black']]//button[contains(., 'Reject cookies')]", "%22advertisement%22%3Afalse", ".vpXfb2ak", '.vpXfb2ak button[name="gdpr_agree_btn"]', "#showcookie", "#showcookie #acceptCookie", "div:has(> div > a[href*='/privacy-policy'])", '[data-testid="CookieModal"], .klaro > .cookie-modal', '[data-testid="CookieModal-ConsentRefuse-Button"]', "LeetchiRGPDCookie=%7B%22security%22%3Atrue%2C%22analytics%22%3Afalse%2C%22marketing%22%3Afalse", ".cookie-preferences-banner", ".cookie-preferences-banner .reject-all-cookies", ".cookie-preferences-banner .dismiss-banner", "analytics%22%3Afalse", '[class*="ConsentModal_consent-modal__modal-overlay"]', '[data-test="cookie-necessary-button"]', '[data-test="age-gate-overlay"]', "AGE_GATE=", "%22key%22%3A%22analytics%22%2C%22value%22%3Afalse", 'section[aria-label="Cookie banner"]', 'section[aria-label="Cookie banner"] button[aria-haspopup="dialog"]', '[role="dialog"] button[class*="_secondary_"]', "#cookie-modal [class*='CookieModal_changeCookies']", "#cookie-modal [class*='CookieModal_popup']", "form[class*='CookieBlock_form'] button", "form[class*='CookieBlock_form'] input:checked:not([disabled])", "cookiePreferences-13_04_2022=[]", ".consent-banner .cookie-decline", "tracking_consentv2=declined", "#cookieNotice > a.btncookieNoticesettings", "section.consent-banner", "section.consent-banner button.hide-consent", "#cookiebar.mod_cookiebar", ".cookieBar-filler", "#cookiebar[data-component='bw.bnl.tracking']", "#cookiebar.noticeActive .modalwindow-container.bar", "#cookiebar button.notok", "trackingapprovedv3=false", "#cookie-consent-popup", "#cookie-consent-popup #cookie-consent-accept-selected", "#cookie-consent-popup input[type=checkbox]:checked:not(:disabled)", "analytics_cookies=false!personalizationAndMarketing_cookies=false", ".consent-categories-modal-wrapper", "#consent-categories-modal [data-modal-consent-open-settings]", "#edit-consent-app input[name=consent-category][value=nc]:checked", "#edit-consent-app input[name=consent-category]:checked:not(:disabled)", "#consent-categories-settings [data-modal-submit]", "#consent-categories-modal", "#cookie-notice:has(.cookie-btn[onclick])", "#cookie-notice .cookie-btn[onclick]", "#cookie-notice[style*='visibility: visible'] .cookie-btn[onclick]", "accepts=Y", "div:has(> form[action$='/api/enable-cookie-consent'])", "form[action$='/api/enable-cookie-consent'] button[name='accept-gdpr']", "form[action$='/api/enable-cookie-consent'] button[name='accept-gdpr'][value='false']", "gdpr-consent=eyJnZHByQ29uc2VudCI6ZmFsc2", "#consent_modal .over-18__manage-cookies-link, #legalAgreementModal [data-test-id='manage-cookies']", "#consent_modal .over-18__manage-cookies-link, #legalAgreementModal.open [data-test-id='manage-cookies']", "#consent_modal .over-18__manage-cookies-link", "[data-testid='PrivacyPreferenceCenterWithConsentCookieContent']", "[data-testid='PrivacyPreferenceCenterWithConsentCookieContent'] input[data-testid='PrivacyPreferenceCenterWithConsentCookieSwitch']:checked", "xpath/(//*[@data-testid='PrivacyPreferenceCenterWithConsentCookieContent']//button[@data-testid='ButtonStyledButton'])[last()]", "#legalAgreementModal [data-test-id='manage-cookies']", "#ManageCookies [data-test-id='confirm-my-choices']", "#ManageCookies input[type='checkbox']:checked:not([disabled])", "[data-testid='PrivacyPreferenceCenterWithConsentCookieContent'], #legalAgreementModal.open, #ManageCookies [data-test-id='confirm-my-choices']", "[data-testid=cookies-container]", "[data-testid=cookie-bar] [data-testid=cookie-button-personalize]", "[data-testid=cookie-modal-container] [data-testid=option-cards]", "[data-testid=option-cards] [data-testid=div_Switch]:has(input[data-testid^=option-card-switch]:checked)", "[data-testid=Modal_ModalContent]:has([data-testid=cookie-modal-container]) [data-testid=div_Modal_Footer] button", 'livelo_share_cookies={"essentials":true,"performance":false,"publicity":false}', "#cookie-banner #cookie-consent-settings", "#cookie-banner #cookie-consent-view", "#cookie-banner #cookie-settings-view", "#cookie-form input[type=checkbox]:checked:not(:disabled)", "#cookie-banner #cookie-settings-save", "analytic%3A0", "#accept_cookies_modal", "#accept_cookies_modal #edit_cookies_btn", "#accept_cookies_modal.show", "#accept_cookies_modal #cookie_customize", "#cookie_customize input[type=checkbox]:checked:not(:disabled)", "#accept_cookies_modal #save_cookies_btn", "#cookieChoice", "#cookieChoice a[href='#modalCookieChoice']", "#modalCookieChoice", "#modalCookieChoice input[type=checkbox]:checked", "#modalCookieChoice button[onclick*=cookie_statistici]", "loeschertechcookieadv=1", ".cookie-overlay", "#cookiePopup .reject-cookie", "_site_acceptance=0", "div:has(> #notice-cookie-block)", '[data-dialog-ref-name="cookie-text-popup"]', "#notice-cookie-block #btn-manage-cookie", "#btn-manage-cookie-save-preferences", '#cookie-text-popup input[type="checkbox"]:checked', "%22marketing%22%3Afalse%2C%22analytic%22%3Afalse", "app-cookie-modal .top-info-cookie", "app-cookie-modal .top-info-cookie .close-x", "PatientPortalCookieMonit=1", ".cookies-notice-container", ".cookies-notice-container .cookies-notice-button", "cookies_notice_accepted=1", ".js-gdpr-banner-top-hide", ".js-gdpr-banner .js-gdpr-banner-top-hide", ".js-gdpr-banner-top-hide .js-gdpr-banner-disagree", "cookie_banner=false", 'div.pos_fixed:has(> button[aria-label="Concordar e fechar"])', 'div.pos_fixed > button[aria-label="Concordar e fechar"]', '.popuppanel4 a[href*="/info/cookie/"]', ".popuppanel4 .js-popupclose", ".popuppanel4", ".c-cookie-modal", ".c-cookie-modal #cookieModal", '.c-cookie-modal__buttons--container button[aria-label="Settings"]', ".c-cookie-modal__options", '.c-cookie-modal__options input[role="switch"]:checked:not([disabled])', '.c-cookie-modal__buttons--container button[aria-label="Save Cookie Settings"]', ".cookiesModalOuterWrapper", ".cookiesModalOuterWrapper [data-cy=ManageButton]", "[data-cy=settingsModal] [data-cy=saveSettingsCta]", "[data-cy=settingsModal] input.switch-checkbox:checked", "[data-cy=settingsModal] input.switch-checkbox:checked + label", "[data-cy=settingsModal]", "GDPR_C=11", ".makita-footer-warning", ".makita-footer-warning .js-makita-modal[data-src*='privacysettings']", ".about-cookies a[data-post*='allowcookie=false']", ".cookies-notification-wrapper .cookie-accept-all-cta", ".cookies-notification-wrapper .customise-cookies-cta button", ".cookies-notification-wrapper .cookie-details-section", ".cookies-notification-wrapper .cookie-details-section input[type=checkbox]:checked:not(:disabled)", ".cookies-notification-wrapper .cookies-notification-bottom div:not(.hideCookiesPreferenceBtn) > button", '#cookies-banner [class*="CookiesFooter-module"]', '#cookies-banner [class*="CookiesFooter-module"] > button:nth-child(2):not([id])', '#cookies-banner [class*="CookiesFooter-module"] > button:first-child:not([id])', '#cookies-banner [class*="CookiesSettings-module"][class*="buttonsWrapper"] > button:nth-child(2)', '"targeting":"DENIED"', "#Modal:has(.DlgCGU)", ".DlgCGU .DlgCGUBtn", ".DlgCGU .DlgCGUBtn button.Red", "UserAgreement=0", ".navbar-privacy", "nav.navbar-privacy .privacy-continue", "#generic-modal .privacy-accept", "nav.navbar-privacy", '.cookie-banner[data-block-name="cookie-banner"]', '.cookie-banner[data-block-name="cookie-banner"] .alert-close', ".cookie_info", ".cookie_info > span.cookie_ok", 'section[aria-label="Cookie preferences"]', 'xpath///section[@aria-label="Cookie preferences"]//button[normalize-space()="Cookie Settings"]', 'div[role="dialog"][aria-labelledby="consent-settings-title"]', 'xpath///label[contains(., "Necessary and functional cookies")]//input[@name="cookie-tier"]', 'div[role="dialog"][aria-labelledby="consent-settings-title"] button:not([aria-label])', "#app div:has(> div > img[src*='/illustrations/cookie.'])", "xpath///div[@id='app']//div[div/img[contains(@src, '/illustrations/cookie.')]]", "xpath///div[@id='app']//div[div/img[contains(@src, '/illustrations/cookie.')]]//button[normalize-space(.)='Mina val']", "input[name='privacySettings']", "input[name='privacySettings']:checked", "xpath///div[@id='app']//div[div/img[contains(@src, '/illustrations/cookie.')]]//button[normalize-space(.)='Jag godk\xE4nner']", ".privacy-license-bar", ".privacy-license-bar .privacy-btn-wrapper", ".cookie-container:has(#cookieSaveBtn)", ".cookie-container #cookieSaveBtn", ".cookie-container .cookie-option input:checked:not(:disabled)", ".cookie-container", 'div:has(> div > div > div[role=alert] > a[href^="https://policy.medium.com/medium-privacy-policy-"])', ".GDPRPanel-module-root", ".GDPRPanel-module-root .GDPRPanel-module-dismiss", "dialog.cookie-banner", "dialog.cookie-banner .customise-cookie", "dialog.cookie-banner button.reject", "dialog.cookie-dialog button.save", "dialog.cookie-dialog .toggle-control.on:not(.disabled)", "div.z-notification:has(a[href*='mentimeter.com/cookie-policy'])", "div.z-notification a[href*='mentimeter.com/cookie-policy']", "div.z-notification:has(a[href*='mentimeter.com/cookie-policy']) > button", "has_approved_cookie_policy", "div[role=region][aria-label='Cookie consent']", "div[role=region][aria-label='Cookie consent'] button", "nia_consent_seen=1", ".cookie-consent-banner-opt-out__modal:defined", ".cookie-consent-banner-opt-out__modal iframe", "dialog.consent-dialog .consent-settings .consent-category input[data-category]", "dialog.consent-dialog", "dialog.consent-dialog .consent-wrapper > .consent-buttons > .consent-button-secondary", "dialog.consent-dialog .consent-settings.active", "dialog.consent-dialog .consent-category input[type=checkbox]:checked:not([disabled])", "dialog.consent-dialog .consent-settings .consent-buttons > .consent-button:not(.consent-button-secondary)", "xpath///div[@role='dialog' and @aria-modal='true']//div[following-sibling::div[@aria-hidden='true'][.//div[@role='button' and @aria-disabled='true']]]/div[@role='button' and @tabindex='0']", "#missatge_cookie", "#missatge_cookie #rebutjar", "avis=false", '[data-component-id="cookie"]', '[data-component-id="cookie"] [data-id="refuse"]', "select_cookie=1", "cookie_control=0|0|0", 'div[aria-label="Cookie Policy Banner"]', "dialog.cookieconsent__dialog", '.cookieconsent__base[data-component="cookieconsent"]', ".cookieconsent__buttonAcceptNecessary", "consent_choice=", ".cookie-modal.open", ".cookie-modal.open .cookie-box", ".cookie-modal.open .btn-box .simple-btn.cancel", ".infoBarCookies .cookieSpan", ".infoBarCookies", ".infoBarCookies img", ".cookie-consent-banner__backdrop", ".cookie-consent-banner .cookie-consent-banner__btn", ".cookie-consent-banner, .cookie-consent-banner__backdrop", "#avisoUsoCookies", "#avisoUsoCookies .configurar-cookies", "#cookies-modal .cookies-btn-guardar", "#cookies-modal input[id^=check-]:checked:not(:disabled)", "TRABAJO_POLICYv2=true", "TRABAJO_GA=", "#cookie-overlay", "#cookie-bar #cookieButtonSome", "mrvdk_cookies_ads=false", "#consent-tracking .btn-necessary", '"marketingCookie":false', "#mde-consent-modal-container", "#mde-consent-modal-dialog", "#mde-consent-modal-dialog .mde-consent-decline-btn", "mdeConsentData=", "[role='region'][aria-label='Cookie consent']", "xpath///div[@role='region'][@aria-label='Cookie consent']//button[normalize-space(.)='Reject']", "[role='dialog'][data-diagnostic-boundary='modal-shell'] button[aria-label='Close']", "#cookie-confirm", "#cookie-confirm a[href*='cookieConfirmClose2']", "#cookie-banner-wrapper", "#cookie-banner-wrapper #cookie_banner_save", "#cookie-banner-wrapper input[type=checkbox]:checked:not(:disabled)", "analytical_cookie_consent=0", "third_party_cookie_consent=0", "#cookieDialog", "dialog#cookieDialog #cookieSettings", "dialog#cookieDialog[open]", "#cookieDialog #ccWeiger", "#cookieDialog [data-cc='toggle-settings']", "#cookieSettings", "#cookieSettings input[type=checkbox]:checked:not(:disabled)", "#cookieSettings [data-cc='save']", "cookieConsent=%7B%22analytics%22%3Afalse%2C%22marketing%22%3Afalse", ".cookie-consent__container", ".cookie-consent__container .cookie-consent__button-container", ".cookie-consent__container .cookie-consent__button-container .button--ghost", ".cookie-consent__container .cookie-consent__consent-switch", ".cookie-consent__cookie-information:not(:last-child) .cookie-consent__consent-switch input:checked", ".cookie-consent__scroll-on-mobile ~ .cookie-consent__button-container .button--ghost", "_cookieConsent=none", ".cookies:has(> #agreeButton)", ".cookies > #agreeButton", "mq-alert-cookies", ".v-cookie-bar", ".v-cookie-bar__initial-state .c-button.--secondary", ".v-cookie-bar__settings", ".v-cookie-bar__settings input[type=checkbox]:checked:not(:disabled)", ".v-cookie-bar__settings .u-text-center .c-button", "#cmp-banner-sdk", ".cmp-sdk-container", "#cmp-reject-all-handler", ".js-cookie-consent", ".js-cookie-consent #customize", ".js-cookie-consent #rejected", "laravel_cookie_consent=rejected", ".cookie-banner button.btn-dismiss-cookie-banner", ".cookies-policy .cookies-policy-close", ".cookies-policy", ".cookie-new-bg", "#cookie-popup-short", "#cookie-popup-short .manage-cookies", "#cookie-popup-detailed .save-settings", "#cookie-popup-detailed input.cookie-toggle:checked", "xpath///div[@role='dialog'][.//h2[normalize-space()='Cookie Settings']]", "xpath///div[@role='dialog'][.//h2[normalize-space()='Cookie Settings']]//button[normalize-space()='Allow All']", "xpath///div[@role='dialog'][.//h2[normalize-space()='Cookie Settings']]//button[normalize-space()='Customise']", "xpath///div[@role='dialog'][.//h2[normalize-space()='Cookie Settings']]//button[normalize-space()='Necessary Only']", "_consent=essential", ".cookie-consent [data-cookie-allow-all]", ".cookie-consent [data-cookie-popup]", "#modal-cookie [data-cookie-deny]", "Nvc.CookieControl=1000", ".privacy-confirmation", ".privacy-confirmation .pc-buttons", ".privacy-confirmation [data-cy=accept-core-button], .privacy-confirmation .pc-buttons > button.ui-parts-button-fill:not([data-cy])", 'dialog[data-test="common-consent"]', "#nlportal-cookie-consent .modal", 'dialog[data-test="common-consent"] [data-test="consent-reject-all"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons > button', 'dialog[data-test="common-consent"] [data-test="consent-reject-all"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons > button:nth-child(2)', 'dialog[data-test="common-consent"], #nlportal-cookie-consent .cookie-consent-modal-static-buttons', "#__next div.fixed.inset-0.bg-slate-700", "xpath///div[@id='__next']//div[contains(@class, 'inset-0')]//button[normalize-space(.)='Cookie Settings']", "xpath///div[@id='__next']//div[contains(@class, 'inset-0')]//div[normalize-space(.)='Manage Cookies']", "xpath///div[@id='__next']//div[contains(@class, 'inset-0')]//button[normalize-space(.)='Allow Selection']", "localConsent=true", ".cookie-policy-wrapper .cookie-policy-content", ".cookie-policy-wrapper #declineCookies", "cookies_policy=analyticsCookies%3Doff%26functionalityCookies%3Doff", "div#cookieWarning", "a#btnCookiesDenyAll", "#cookie-banner a[onclick^=cookieSettings]", "#cookie-message .save-settings", "#cookie-message input[type=checkbox]:checked:not([disabled])", "_nnco_cookiesettings=functional", "_nnco_cookiesettings=functionalperformance", "_nnco_cookiesettings=functionaltargeting", "button[aria-label='Close cookie banner']", "cookie-banner", "body[class*='nfl-is-'] #onetrust-banner-sdk", "#onetrust-reject-all-handler", '[data-show-cookie-banner="true"]', '[data-show-cookie-banner-overlay="true"]', '[data-show-cookie-banner="true"], [data-show-cookie-banner-overlay="true"]', "[class*=ConsentManager]", "[class*=ConsentManager_cookieBar]", 'xpath///button[contains(@class, "ConsentManager_cookieBarButton") and contains(., "weigeren")]', "#cookie-banner #reject-cookies", "#cookie-banner.nhsuk-cookie-banner", '#cookie-banner [data-qa="cookie-banner-close"]', '#cookie-banner [data-qa="cookie-banner"]', ".cookies:has(.closecookies)", ".cookies .closecookies", "div.fixed.opacity-100 button[aria-label='Toggle Essential cookies']", "div.fixed.opacity-100:has(button[aria-label='Toggle Essential cookies']) button[aria-label='Close']", '[class*="_wrapper_"]:has(> [class*="_expandedContent_"] #essential-cookie)', '[class*="_bannerContent_"] [class*="_buttonCtr_"] button[class*="_secondary_"]', '[class*="_expandedContent_"]:has(#performance-cookie)', "#performance-cookie:checked, #functional-cookie:checked, #advertising-cookie:checked", 'button[class*="_saveButton_"]', "#cookiebar #acceptallpolicies", "form input[name=cookiepolicy][value=THIRDPARTY]", "form input[name=cookiepolicy]:checked:not(:disabled)", "form:has(input[name=cookiepolicy]) button[type=submit]", "#cookiebar a[href*='Privacy_en_cookies/Cookies']", "#CookieReportsPanel #CookieReportsBanner .wscrOk2", "#CookieReportsBanner .wscrSwitch input[type=checkbox]:checked:not([disabled]) + label", "#CookieReportsBanner .wscrOk2", "wscrCookieConsentShared=1=true&2=false&3=false&4=false&5=false", "[role=dialog] #cookie-accept-all-secondary", "[role=dialog] #cookie-accept-all-secondary + button", "consent_cookie=necessary", "nwhlit-gdpr-banner", ".ntv-user-notification-container", ".ntv-user-notification-container .ntv-lgpd-consent-accept", "#consent.container-banner-cookie .consentOk", "consent=", ".cookie-control", '.cookie-control [data-cc-capture] button[name="save"]', ".cookie-control .cc-capture__message", ".cookie-control [data-expandable-trigger]", '.cookie-control input[name="cookie_control_optin_level[]"]:checked', "cookie_control_optin_level=0", ".bar-inner", ".bar-inner > button", "isPolicyCookieForAllPage=1", ".nutri-consent-dialog", "xpath///div[contains(@class, 'nutri-consent-dialog') and not(ancestor::*[@id='nutri-consent-shell'])]", "xpath///div[contains(@class, 'nutri-consent-dialog') and not(ancestor::*[@id='nutri-consent-shell'])]/div/button[1]", "xpath///div[@role='dialog' and .//button[@role='switch']]/div[last()]/div/button[1]", "nutri_consent_v1=", "[class^='cookies_cookies__']", "[class^='cookies_cookies__'] [class^='cookies_close__']", "xpath///button[contains(., 'Imposta le tue preferenze')]", "input[data-part='checkbox-input'][name='analytics']", "input[data-part='checkbox-input'][name='analytics']:checked", "input[data-part='checkbox-input'][name='marketing']:checked", "input[data-part='checkbox-input'][name='marketing']", "xpath///button[contains(., 'Salva le mie impostazioni')]", "cookie_consent=a%3D0%26m%3D0", "#policy-cookies-banner", "#policy-cookies-banner [onclick*='acceptLGPD']", "LGPD-ACCEPTED=", ".cookie-modal__overlay", "#cookie-banner #cookie-banner-open-modal", ".cookie-modal__content #cookie-modal-reject", ".cookie-banner:has(.cookie-banner__close)", ".cookie-banner .cookie-banner__close", ".cookies-agreement-notification,.modal-new:has([data-module=SetupCookies])", ".cookies-agreement-notification", ".cookies-agreement-notification .cb_setup", "[data-module=SetupCookies]", "[data-module=SetupCookies] input[type=checkbox]:checked:not(:disabled)", "[name=button_save_choice]", "#cookiePolicy > menu", "aside:has(#featureSwitch_necessary)", "#featureSwitch_necessary", "xpath///aside[.//*[@id='featureSwitch_necessary']]//button[contains(., 'Dostosuj')]", "#featureSwitch_marketing", "#featureSwitch_marketing[data-state='checked']", "xpath///aside[.//*[@id='featureSwitch_necessary']]//button[contains(., 'Potwierd\u017A wyb\xF3r')]", "privacy2=necessary", "#gdpr-selection-screen", "#gdpr-selection-screen #gdpr-permissionlevel-1", "#gdpr-selection-screen #gdpr-screen-content", "#gdpr-selection-screen .button-container button", "MascGdrpPermission=1", "section.cookie-note[role=region] > button", "section.cookie-note[role=region]", ".fn-cookiewall-container, .fn-cookiewall-banner-container", ".fn-cookiewall-container", ".fn-cookiewall-container .cookiewall--reject-btn", ".fn-cookiewall-container .cookiewall--pre-submit-btn", ".fn-cookiewall-container .cookiewall--submit-btn", ".fn-cookiewall-banner-container", ".fn-cookiewall-banner-container .cookiewall-banner-close", ".modal--cookie-consent", ".modal--cookie-consent #cookies-tracking", ".modal--cookie-consent #cookies-tracking:checked", ".modal--cookie-consent button.btn-gray", "oc_allow_tracking=0", "#alert_cookies", "#alert_cookies #alert_cookies_close", "div.b-cookies-informer", "div.b-cookies-informer__nav > button:nth-child(1)", "div.b-cookies-informer__switchers", "div.b-cookies-informer__switchers input:not([disabled])", "div.b-cookies-informer__nav > button", ".cookie-popup", ".cookie-popup .cookie-popup__button", "[aria-labelledby=cookieConsentTitle]", "[aria-labelledby=cookieConsentTitle] button[aria-haspopup=dialog] + button", "consent=rejected", "#cookie-consent .cookie-all__btn", "#cookie-consent .cookie-consent__switch.active:not(.always_on)", "#cookie-consent .cookie-selection__btn", "cookie_consent_essential=true", "cookie_consent_marketing=true", '.o5-dynamic-alerts__container:has(a[href*="privacy-policy"])', '.o5-dynamic-alerts__container:has(a[href*="privacy-policy"]) .o5-dynamic-alerts__close', "#id01.w3-modal", `#id01.w3-modal button[onclick*="setCookie('polityka'"]`, "#orbys-cookies", "#orbys-cookies .occ-btn", "#consent-manager-modal", "#consent-manager-modal #cookies-consent", "#consent-manager-modal [role=dialog]", "#cookies-consent label[role=checkbox]:has(input:checked)", "#consent-manager-modal [class*=modal_buttons] button[type=submit]", "#cookie a.close", "osf-cookie-consent-banner", "osf-cookie-consent-banner p-message", "#footerCurtainCookie", "#footerCurtainCookie .footerCookieLink", "SL_cookie=NO", ".cookie-manager", ".cookie-manager .cookie-notice.open", ".cookie-notice button.owid-btn--outline-dark-blue.cookie-notice__button", "#ConsentModalControl_divModal", "#ConsentModalControl_divModal #ConsentModalControl_lbtnSaveSelection", "#ConsentModalControl_divModal .toggle:not(.off):not([disabled])", "#ConsentModalControl_lbtnSaveSelection", '[class*="GpcBanner_gpcBanner"]', '[class*="CookieSettingsModal_cookieSettingsModal"], [class*="GpcBanner_gpcBanner"]', '[class*="CookieSettingsModal_cookieSettingsModal"]', '[class*="CookieSettingsModal_cookieSettingsModal"] input[type=checkbox]:checked', '[class*="CookieSettingsModal_cookieSettingsModal"] button.primary', '[class*="GpcBanner_gpcBanner"] button[class*="GpcBanner_close"]', "od_track=0", ".js-data-prefs-dialog", ".js-data-prefs-dialog #data-prefs-form", "#data-prefs-form button[type=submit][value=save]", "#data-prefs-form input.toggle:checked + label.toggle-label", "allowed_cookies_analytics=0", "allowed_cookies_functional=0", "allowed_cookies_targeting=0", "#ccpm", "html.show--consent #ccpm .cm__btn[data-role=all]", "#ccpm .cm__btn[data-role=show]", "#ccpm .pm__btn[data-role=save]", "#ccpm .pm input.section__toggle:checked:not(:disabled)", "#cookie-consent ~ .banner-shadow", '#cookie-consent .cc-window[aria-describedby="cookieconsent:desc"]', "#cookie-consent, #cookie-consent ~ .banner-shadow", ".pt-snackbar--policy", ".pt-snackbar--policy .pt-action-policy button", "[data-testid='cookie-consent-banner-notice'], [data-testid='cookie-consent-banner-eea']", "[data-testid='cookie-consent-banner-eea']", "[data-testid='cookie-consent-banner-eea'] [data-testid='cookie-consent-decline']", "[data-testid='cookie-consent-banner-notice'] [data-testid='close-cookie-banner']", "consent_cookie=false", "hideCookiesBanner=true", "footer .ccpabanner", "#bandeaucookie", "#bandeaucookie #cookieOk", ".cookie-consent-wrapper", ".cookie-consent-wrapper a[color=transparent]", "input[name=ga-cookies]", "input[name=ga-cookies]:checked, input[name=fbq-cookies]:checked", "[class*=CookieConsentModal__ButtonContainer] a:not(.cancel-btn)", "cookieconsent=0", ".cc-policy-overlay", ".cc-policy", ".cc-policy .cc-settings", "consent=S.false-T.false", ".systemmessages .cookieconsent", ".systemmessages .cookieconsent button.dismiss", "pekao-cookies", "pekao-cookies .cookies-wrapper", "pekao-cookies .cookies-button button", "np24Cookies=", "[data-ui-test=pm-cookie-banner]", "[data-ui-test=pm-cookie-banner-decline-button]", "pm_cookie_consent_level=1", ".consent-dialog-root", ".consent-dialog-root .allow-selection-btn", ".consent-dialog-root .p-inputswitch:not(.p-disabled) input:checked", '[data-id="consent-cookies"]', '[data-id="consent-cookies"] button:not([data-id])', "xpath///div[@role='dialog']//button[contains(., 'Essentials Only')]", "%22analytics_storage%22:%22denied%22", "#cookies-info .btn-cookie-close", "cookieInfoSZG=true", ".cookie-consent-popup .cookie-consent-accept", ".cookie-consent-popup .cookie-consent-accept .elementor-button", "cookie_consent=accepted", ".BusinessCookieConsent", ".BusinessCookieConsent [data-id=cookie-consent-banner-buttons]", "[data-id=cookie-consent-banner-buttons] > div:nth-child(2) button", "#cookieMessage[data-cookie-boundary]", ".cookie-bg", ".cookie-bg .cookie-inner .cookie-btn--accept", ".cookie-bg .cookie-inner", ".cookie-bg .personalise-btn", ".cookie-bg form .cookie-list", ".cookie-bg form .cookie-item input[type=checkbox]:checked:not([disabled])", ".cookie-bg form button[type=submit]", "gdpr-ga=false", "gdpr-fbp=false", "div.cookies > .grid-container > span.icon-cross", "div.cookies.active", "div.cookies span.icon-cross", "cookies=cookies", ".notifications .notification-root:has(a[href*='aboutcookies.org'])", ".notifications .notification-root:has(a[href*='aboutcookies.org']) .notification-action button", "cookiesPolicyAccepted", "#cookies-consent", "#cookies-consent .cookies-consent-banner", "#cookies-consent .cookies-consent-banner__link[onclick*=openConfiguration]", "#cookies-consent .cookies-consent-configuration__reject", "[data-testid=cookieBar]", ".notification-bar.cookie-consent", ".notification-bar-mobile.cookie-consent", "[data-testid=adConsentModal]", "[data-testid=adConsentDisagreeButton]", "[data-testid=cookieBarRejectButton]", ".notification-bar-mobile.cookie-consent.remodal-is-opened .cookie-consent-reject", "[data-testid=cookieBarRejectButton], .notification-bar.cookie-consent .cookie-consent-reject", "plex_tv_cookie_consent=2", "#cookie-consent button", "#cookie-consent input[type=checkbox]:checked:not(:disabled)", "plosCookieConsentStatus=false", "#cookieConsentPanel", "#cookieConsentPanel #acceptCookiesButton", "[data-testid=cookie-consent-bar-desktop], [data-testid=cookie-consent-bar-mobile]", "[data-testid=manage-cookies-button-desktop]", "[data-testid=manage-cookies-button-mobile]", "[data-testid=cookie-consent-modal]", "[data-testid=cookie-consent-modal] input[type=checkbox]:checked", "[data-testid=cookie-consent-save-button]", "pmo_c_acc=true", "pmo_c_mark=true", "#notification-stack > div:has(> header > [style*='ui-icons-lock.svg'] ~ button)", "#notification-stack header:has([style*='ui-icons-lock.svg']) button", "#notification-stack header:has([style*='ui-icons-lock.svg'])", "#cookieBanner.cbShort", "#cookieBanner.cbShort .cbCloseButton", "#cookieBanner #cookieBannerContent", "#cookieBanner #cookieBannerContent, #globalCookieBanner", "#globalCookieBanner .js-customizeGlobalCookies", "#cookieBanner [data-label=accept_essential]", "#cookieBanner button.cbSecondaryCTA", "#cookie-form", "#cookie-form .reject", "_cookieNoticeSettings=%7B%22performance%22%3Afalse%2C%22targeting%22%3Afalse%2C%22analytic%22%3Afalse%7D", "xpath///li[contains(@class, 'ToastRoot')][contains(., 'cookie banner')]", "xpath///li[contains(@class, 'ToastRoot')][contains(., 'cookie banner')]//button[@data-radix-toast-announce-alt='Close']", "xpath///li[contains(@class,'ToastRoot')][contains(., 'cookie banner')]", "xpath///li[contains(@class,'ToastRoot')][contains(., 'cookie banner')]//button", "pnl-cookie-wall-widget", "CookiePermissionInfo", ".alert .accept-cookies,form.js-cookies", ".alert:has(.accept-cookies)", "form.js-cookies button", "form.js-cookies input[type=checkbox]", "form.js-cookies input[type=checkbox]:checked:not(:disabled)", "form.js-cookies button[type=submit]", ".alert:has(.accept-cookies) a[href='/account/cookies']", "#cookiesPopup", "#cookiesPopup button.MuiButton-outlined", "#cookiesPopup .MuiSwitch-root", "#cookiesPopup button", "#tc-banner", "#tc-consent #tc-banner", "#tc-banner .tc-accept-btn", ".tc-checkbox:checked:not([disabled])", 'UserConsentedToTastyCookies=["nodvandiga"]', "#cookies_banner", "#cookies_banner #save-cookies", "#save-cookies", "#open-cookies", "#cookies_banner .cookie-check:checked:not(:disabled)", "marketing_cookies=0", "#consentManager .privacy-toast-holder", "#consentManager .privacy-toast-message", "#consentManager .privacy-toast-message__button.outline", "xpath///footer[contains(@class, 'cookie-preferences__footer')]/button[contains(., 'Reject all')]", ".cookie-preferences-dialog", '.cc-window.cc-type-info[aria-describedby="cookieconsent:desc"] .cookieconsent__dismiss', '.cc-window[aria-describedby="cookieconsent:desc"] .cookieconsent__dismiss', "div.cookie:has(a.cookie-okay-button)", "div.cookie a.cookie-okay-button", "#pfm-consent", "#pfm-consent[data-pfm-consent-root]", "#pfm-consent [data-pfm-consent-main-actions]", "#pfm-consent [data-pfm-consent-main-actions] [data-pfm-consent-reject]", ".fc-dialog-container .fc-cta-do-not-consent,.fc-dialog-container .fc-cta-manage-options", ".fc-dialog-container .fc-confirm-choices", ".consent:has(> .consent-body .consent-buttons)", ".consent > .consent-body .consent-buttons > .btn-outline-secondary", ".consent > .consent-body .consent-buttons", ".ReactModalPortal", ".consent-settings-modal .consent-switchers", ".consent-settings-modal .consent-switchers input[type=checkbox]:checked:not([disabled]) + label", ".consent-settings-modal .consent-settings-modal-content > .consent-buttons > .btn-primary", '[data-testid="cookie-consent-sticky-footer"]', '[data-testid="cookie-consent-sticky-footer"][aria-hidden="false"]', '[data-testid="cookie-consent-sticky-footer"] button[aria-label]:first-child', '[data-testid="_cookie_modal_test"]', '[data-testid="_cookie_modal_test"] label:has(input[type="checkbox"]:checked)', '[data-testid="_cookie_modal_test"] button[aria-label="button-pmui"]', ".cookies .cookies__container", ".cookies .cookies__close button.cookies__button", "cookieAgreements=true", "#popup.cookie-popup", "#popup.cookie-popup #close-popup", ".gdpr[data-gdprservice]", ".gdpr[data-gdprservice]:not(.hide)", "xpath///div[contains(@class,'popmechanic-js-form')][contains(., 'cookie')]//button[@data-popmechanic-close][contains(., '\u041E\u0442\u043A\u0430\u0437\u0430\u0442\u044C\u0441\u044F')]", "#cookie-banner #cookie-banner-statistics", "#cookie-banner-preferences:checked", "#cookie-banner-preferences", "#cookie-banner-statistics:checked", "#cookie-banner-statistics", `#cookie-banner button[onclick*="'selected'"]`, "RDOPRIVACY=%5Btrue%2Cfalse%2Cfalse%5D", "#__rptl-cookiebanner #__rptl-cookiebanner-reject", "#accept_cookie_banner .btnAcceptCookie", "#accept_cookie_banner", "#accept_cookie_banner > span.cursorPointer", ".DialogHandlerContainer.visible:has(.cookie-dialog)", "#cookiesStrip:has([data-testid='accept-cookies'])", ".DialogHandlerContainer.visible:has(.cookie-dialog), #cookiesStrip:has([data-testid='accept-cookies'])", "#cookiesStrip [data-testid='skip-cookies']", "span.cookie-option-large>div>span.link-no-decoration.gui-text", ".cookie-dialog form .CookieConsentOption input[type='checkbox']:not([name='permanent']):checked", ".cookie-dialog button[type='submit']", "#coPo", "#coPo #settingsButton", "#coSe", "#coSe input[type=checkbox]:checked:not(:disabled)", "#coSe #saveSettings", "cookieConsent=necessary", ".r-cookie", "#cookies .cookies-pop-up", "#cookies .cookies-options-btn-item[data-options], .r-cookie #btnHideCookie", "#cookies .cookies-pop-up.show, .r-cookie", "#cookies .cookies-pop-up.show", "#cookies .cookies-options-btn-item[data-options='1']", ".r-cookie #btnHideCookie", "[bundlename=reddit_cookie_banner]", "#data-protection-consent-dialog rpl-modal-card > button.button-primary", "#data-protection-consent-dialog rpl-modal-card > button.button-secondary", "eu_cookie={%22opted%22:true%2C%22nonessential%22:false}", "#cookiebanner", "#cookiebanner #acceptNecessaryCookiesBtn", "refbConsent={%22categories%22:[%22necessary%22]%2C", "%22consent_date%22:1", "#cb_wrapper-std #overlay-std", "#cb_wrapper-std #cookieApiData", "#cb_wrapper-std #overlay-std #userSelect", "#cb_wrapper-std #userSelect", "#footer > .container > .d-flex > button.btn-outline-primary", "div.fixed:has(input#marketing):has(input#statistics)", "div.fixed:has(input#marketing):has(input#statistics) input#marketing:checked", "div.fixed:has(input#marketing):has(input#statistics) input#marketing", "div.fixed:has(input#marketing):has(input#statistics) input#statistics:checked", "div.fixed:has(input#marketing):has(input#statistics) input#statistics", "div.fixed:has(input#marketing):has(input#statistics) > div:last-child > button:last-child", "%22marketingConsent%22%3Afalse%2C%22statisticsConsent%22%3Afalse", "div:has(> button#cookieBar-button)", "#cookieBar-button", "#cookie-consent-container[style*='visibility'] #cookie-banner", "#cookie-banner .cookie-banner-preferences-btn", "#cookie-consent-detail", "#cookie-consent-detail .modal-content-agree-to-preference-btn", "#clawackdiv", "#clawackdiv > img[src*='iconClose']", ".cookiebar", ".cookiebar .cookiebar__button", ".cookiebar .cookiebar__link", ".cookiebar .cookiebar__form input[type=checkbox]", ".cookiebar .cookiebar__form input[type=checkbox]:checked:not(:disabled)", "cookie_consent_video=no", ".rc-notice:has(a[href$='/cookies-policy'])", ".rc-notice a[href$='/cookies-policy']", ".rc-notice:has(a[href$='/cookies-policy']) .rc-notice__actions button[data-slot=secondary]", ".rc-notice:has(a[href$='/cookies-policy']) .rc-notice__description button", ".rc-modal input[name=adData]", ".rc-modal input.rc-checkbox__input:checked", ".rc-modal:has(input[name=adData]) .rc-modal__footer button[data-slot=primary]", "third_party_ad_storage_consent%22%3Afalse", "privacy_settings=", ".gdpr-alert .gdpr-alert__close", ".gdpr-alert .gdpr-alert__overview", "#cookiePopUp", "#manageCookieSettingsPopUp", "#cookiePopUp[data-control=cookies]", "#cookiePopUp [data-bs-target='#manageCookieSettingsPopUp']", "#decline-cookies-button", "cookie_consents=", ".gdpr-wrapper > .gdpr", ".gdpr-wrapper > .gdpr .button-icon.close button", ".gdpr-wrapper > .gdpr .button-icon:not(.close) button", ".gdpr-wrapper > .gdpr .container-select", ".gdpr-wrapper > .gdpr input[name=gdprType][value=byAnalitic]:checked", ".gdpr-wrapper > .gdpr input[name=gdprType][value=byAnalitic] + label", ".gdpr-wrapper > .gdpr input[name=gdprType][value=byMarketing]:checked", ".gdpr-wrapper > .gdpr input[name=gdprType][value=byMarketing] + label", ".gdpr-wrapper > .gdpr .container-select ~ .structure-row .button-main button", "gdpr=[]", "#cookie_container", "#cookie_container #accept_cookies_btn", ".cookie-overlay .cookie-consent .cc-controls", ".cookie-consent .cc-controls .custom-button.--secondary-option + .custom-button.--secondary-option", "rittalCC=1", ".cookie-banner-wrapper", ".cookie-banner-wrapper .cookie-banner", ".cookie-banner-wrapper button.btn-secondary-lg", "RBXcb", '.MuiDrawer-paperAnchorBottom a[href*="/info/privacy"]', '.MuiDrawer-paperAnchorBottom [class*="-Grid-root-buttons"] button.MuiButton-outlined', "GoogleAnalytics=false", "#cookie-policy-info", 'div.cookie-btn-box > div[aria-label="Reject"]', '.cookie-policy-lightbox-bottom > div[aria-label="Save Settings"]', "#cookie-agree", "#cookie-agree .cookie-intro-container", "#cookie-agree .button-intro-container button.gray", "#cookie-agree .cookie-container label.checkbox:not(.disabled)", "#cookie-agree .cookie-container label.checkbox.checked:not(.disabled) input", "#cookie-agree .button-container button.black", "#gdpr-notification", "#gdpr-notification #banner-link-preferences", "#banner-link-preferences", "#cookie-modal .cookie-modal-content", "#cookie-modal-input:checked", "#cookie-modal-input", "#cookie-modal-dismiss", "gdpr_accepts_cookies=false", "[role=dialog] form #cookie_consent_accept_all_button", "[role=dialog] form:has(#cookie_consent_accept_all_button) button[type=button]", "[role=dialog] form input#analytical", "[role=dialog] form input#analytical:checked", "[role=dialog] form:has(input#analytical) button[type=submit]:not(#cookie_consent_accept_all_button)", '#__next > div[class*="styles_container__"]:has(a[href="/pages/privacy_policy"])', ".cookie-consent .cookie-close", ".cookie-consent.is-show .cookie-close", "cookie=true", "rspb-cookie-banner", "rspb-cookie-banner .buttons button.btn-light", 'rspb-cookie-banner [data-testid="options"]', 'rspb-cookie-banner button[label="Save settings"]', "RSPB.AllowMarketingCookies=No", ".cookies-banner-shown", "#ConsentBar", '#ConsentBar [data-js--cookie="cookies-accept-functional"]', "#gdprconsent.gdprcontainer", "#gdprconsent .gdprbutton a", "gdpr-consent=0", "script[src*='consent.cookiebot.com/uc.js']", "#cookiebanner #DeclineAll", "statistics:false%2Cmarketing:false", "#cookie-container #cookie-confirm-btn", "cookies-confirm=true", "#cookie-popup-with-overlay", "#cookie-popup-with-overlay [data-ref='cookie.no-thanks']", "RY_COOKIE_CONSENT", '.MuiDrawer-root:has(a[href*="/policies/cookie"])', '.MuiDrawer-root:has(a[href*="/policies/cookie"]) button[data-log-id="close"]', "sa_enable=on", "div.cookie-bar", ".cookie:has(.js-cookie-close)", "html.show-cookie .cookie .js-cookie-close", "cookieAgree=1", ".ConsentBanner", ".ConsentBanner .buttonGroup button.setting", ".ConsentBanner .buttonGroup", ".CookieSetting .CookieSettingFooter .saveBtn", ".CookieSetting .switchBtn.active:not([disabled])", "ads_optout=1", "sa_optout=1", "dc_optout=1", "#cookie-window", "#cookie-window #cookie-preview-accept", "#cookie-window, #cookie-message", "#popup-notice", "#popup-notice .popup__close", "saturdaysnyc-notice=1", "#kakrutan", "#kakrutan scb-button[value='inget']", '.cc-window.cc-type-info[aria-describedby="cookieconsent:desc"] .cc-dismiss', "body.cookie-overlay", ".MuiDialog-root:has([class*='CookieBar__DialogContent'])", "[class*='CookieBar__DialogContent']", "[class*='CookieBar__ButtonsWrapper'] [class*='SecondaryButton__Button']", "[class*='CookieBar__OptionsContainer']", "[class*='CookieBar__OptionsContainer'] button:not([disabled]):has([class*='CheckBoxButton__CheckBoxIcon'])", "[class*='CookieBar__OptionsContainer'] ~ [class*='CookieBar__ButtonsWrapper'] [class*='PrimaryButton__Button']", "xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]", "xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]//button[normalize-space(.)='Reject Optional']", "xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Your Privacy Matters to Us')]]//button[contains(normalize-space(.), 'MANAGE PREFERENCES')]", "xpath///div[contains(@class, 'MuiBackdrop-root')][.//h1[contains(., 'Manage Preferences')]]//button[normalize-space(.)='Save Preferences']", '"functional":false', '"performance":false', '"personalization":false', ".js-cookie-modal", '.js-cookie-modal [data-cookie-button-type="rejectCookies"]', ".js-cookie-modal.show-modal", '.js-cookie-modal [data-cookie-button-type="configureCookies"]', "useMarketingCookies=false", '[data-qa="GDPRBanner-Container"]', '[data-qa="GDPRBanner-Container"] [data-qa="GDPRBanner-Button"]', "#panelAsk", "#panelAsk #btnAcceptAllCookies", "#content-alert-cookie", "#content-alert-cookie #truste-consent-required2", "cookie_pi_accept=permit 1", "cookie_pi_accept=permit 1,2", "#cookieContainer #cookies", "#cookieContainer #cookies .cookies_inner button[onclick*='Rechazar']", "%7E%7Cparcial", ".cookies a[id$=btnCookieClose]", "cookiesAck=1", "#cookie-info", "#cookie-info .button-row button.btn-secondary", "#cookie-info #no-ad-cookies", "#cookie-info form button.save-button", ".sw-cookie=1", ".l-cookie.js-cookie", ".l-cookie.js-cookie button", ".l-cookie.js-cookie.is-show", ".cookie-consent[data-cookieconsent], .gdpr-tab", ".cookie-consent[data-cookieconsent], .gdpr-tab #gdpr_tab_content", "__hs_opt_out=", "__hs_opt_out=yes", '[class*="cookie-consent-required"]', 'html[data-cookie-consent-required] [data-testid="accept-all-cookie-button"]', '[data-testid="accept-all-cookie-button"]', "body[data-scroll-locked]", '[data-testid="customize-cookie-button"]', '[data-testid="confirm-settings-cookie-button"]', ".lgpd-tooltip", ".lgpd-tooltip .lgpd-tooltip__button", '[data-testid="cookie-banner"] button:has(+ button)', 'dialog[open]:has(input[name^="cookiesetting."])', 'dialog[open] input[name^="cookiesetting."]:checked:not([disabled])', 'dialog[open]:has(input[name^="cookiesetting."]) > div > div.p-4 > button', "body > div[class*=_shein_privacy]", "body > div[class*=_shein_privacy_agreement] .cmp_c_1102 > .cmp_c_1", "body > div[class*=_shein_privacy_agreement] .cmp_c_1102 > .cmp_c_3", "body > div[class*=_shein_privacy_preference] .cmp_c_1204", "body > div[class*=_shein_privacy_preference] .cmp_c_1204 > .cmp_c_3", "body > div[class*=_shein_privacy_preference] label:has(> input:checked) > .slider", "body > div[class*=_shein_privacy_preference] .cmp_c_1204 > .cmp_c_5", "body > div[class*=_shein_privacy] .cmp_c_1102 > .cmp_c_1", ".cmp-cookies-notification", ".cmp-cookies-notification .cmp-cookies-notification__btn-cookie-accept", '#cookie-bar .cb-enable,[class^="app_gdpr--"] button', "#pnlCookieAcceptance", "#pnlCookieAcceptance #divCookiesManage", 'aside[x-data="cookieConsent"]', '#shopify-pc__banner, aside[x-data="cookieConsent"] > div.opacity-100', "#popinCookies .panelSimple", "#cookieWrapper #popinCookies", "#popinCookies #disagree_button, #cookieWrapper #popinCookies > [onclick*='refuse_all']", "#popinCookies.fadeInDown #disagree_button, #cookieWrapper #popinCookies > [onclick*='refuse_all']", "rgpd_cookies=1,0,0", ".cookie-bar .accept-btn", "section.cookie-banner", "section.cookie-banner .cookie-content > .btn-toolbar", "xpath///body/div[span/a[contains(@href, 'cookie-policy')]]/button", "xpath///body/div[span/a[contains(@href, 'cookie-policy')]]/button[normalize-space(.)='Endast n\xF6dv\xE4ndiga']", "cookieconsent_dismissed=dismissed", "custom-cookie-consent#cookieBubble.banner-show", "custom-cookie-consent#cookieBubble #configureBtn", "custom-cookie-consent#cookieBubble.banner-show #configureBtn", ".custom-cookie-modal #acceptNecessaryBtn", ".cookie-consent[role=dialog]", ".cookie-consent[role=dialog] button[class*=cta--button_tertiary]", "dg-category-functional:0", "dg-category-marketing:0", "dg-category-performance:0", '[data-testid="cookie-wall"]', '[data-testid="cookie-wall"] .cookie-bar__footer button[data-id="0"]', "acceptCookies=0", "skv-cookie-banner", "SKVCookieAllow=strictlyNecessary", "#cookieBannerV2", "[data-testid=banner-cookies-v2-modal]", "[data-testid=banner-cookies-v2-manage-button]", "[data-testid=banner-cookies-v2-manager-reject-link]", "privacy_cookie=1", "[data-test-id=cookie-consent-banner]", "[data-test-id=cookie-consent-banner] #accept-necessary-cookies-button", "cookie-accept-necessary=accepted", "#app > div:has(> div:last-child > button:first-child + button:last-child)", "#app > div:not(:has(input[role=switch])) > div:last-child > button:last-child:not(:first-child)", "#app > div:has(input[role=switch]) > div:last-child > button:first-child", "#app > div:has(input[role=switch]) input[role=switch][aria-checked=true]:not([disabled])", "_s.cookie_consent=marketing=0:analytics=0", "[class*='style_floatingWrapper'] img[alt='floating-cookie']", "[class*='style_floatingWrapper']", "[class*='style_floatingWrapper'] button[class*='style_buttonClose']", ".sm-alert[data-cookie^='cookie.disclaimer']", ".sm-alert.is-visible[data-cookie^='cookie.disclaimer'] .sm-alert__button", "disclaimer=closed", ".m-gdpr-banner", ".o-overlay--gdpr", ".m-gdpr-banner .js-m-gdpr-banner__button-manage", ".m-gdpr-banner.state-m-gdpr-banner--visible", ".m-gdpr-settings .js-m-gdpr-settings__button-custom", ".m-gdpr-settings input:checked:not(:disabled)", "#cookiesModal #cookiesModalCloseBtn", "#cookiesModalCloseBtn", "#cookie-consent[data-testid=cookie-consent-banner]", "#cookie-consent button[\\@click*=setEssentialCookie]", "#cookie-consent-root #cookie-overlay", "#cookie-consent-root #cookie-banner", "#cookie-consent-root #cookie-banner #cc-manage", "#cookie-banner #cc-manage", "#cookie-modal .cc-pref-footer #cc-reject-all", "cookie_consent=1|0|0", "#cookie-consent-message", "#cookie-consent-message #cookie-consent-reject", "#cookie-consent-reject", "cookieconsent_status=0", ".plug-gdpr-wrapper.js-gdpr-wrapper", ".plug-gdpr-wrapper.js-gdpr-wrapper .js-gdpr-button", ".plug-gdpr-wrapper--show.js-gdpr-wrapper", '[aria-describedby="cookieconsent:desc"], .cc_overlay_bg', "#cookies-law-info-bar", "#cookies-law-info-bar #cookies-law-info-content button", "#js-cookie-notification", ".bootbox.modal:has(#btnCookiesAcceptSelected)", "#btnCookiesAcceptSelected", "#chkCookiesStatistics:checked, #chkCookiesSettings:checked", "cookies_allowed=required", 'div[x-data*="hide-gdpr-banner"] > div', 'div[x-data*="hide-gdpr-banner"]', "#cookie_confirm_dv", ".app__misc-cookie__consent", ".app__misc-cookie__consent-background", ".app__misc-cookie__consent button.settings", ".app__misc-cookie__consent-outer__shell-button__container button.settings", ".app__modal-cookie__settings button.confirm", ".app__modal-cookie__settings label.app__switch:not(.is__locked) input:checked", '"active":true', '#modal button[aria-label="Reject all non-essential cookies"]', "div.fixed.inset-0:has(.lucide-cookie)", "xpath///div[contains(@class, 'inset-0')]//button[contains(., 'Refuser tous')]", "#cookie_initial_modal", "#cookie_initial_modal #jss_open_settings_modal", "#cookie_settings_modal", "#cookie_settings_modal input.check-all:checked", "#cookie_settings_modal #jss_consent_checked", "#cookie_initial_modal, #cookie_settings_modal", "#askToAcceptCookies", "#askToAcceptCookies #askToAcceptCookiesClose", "#askToAcceptCookiesClose", "si_acceptedCookies=true", 'dialog[class*="CookieModal-module"]', 'dialog[class*="CookieModal-module"] button[class*="__secondaryButton"]', '[role="dialog"] [class*="SettingsModal-module"]', '[role="dialog"] [class*="SettingsModal-module"] input[type="checkbox"]:checked', '[role="dialog"]:has([class*="SettingsModal-module"]) [class*="__footer"] button', "targTK=false", "#cookiesPermission", "#cookiesPermission #cookiesClose", "#TermsSelector", "#TermsSelector .TermsOk", "#TermsSelector .openTermsContainer .TermsOk, #TermsSelector .sticky-wrapper:not(.MobileContainer) .TermsOk", "#banniere_cookies", "#banniere_cookies span[onclick]", "[data-test=cookie-consent-modal]", "[data-test=cookie-consent-modal] [data-test=cookie-consent-decline-all]", "[data-test=cookie-consent-modal] [data-test=cookie-consent-preferences]", "[data-test=cookie-consent-settings-decline-all]", "surfshark-consent-state=a:0|m:0", ".CookieConsent__root", ".CookieConsent__root .CookieConsent__modal", ".CookieConsent__root button[data-consent-action=reject-all], #CookieConsent_reject_all", '"improved_experience":false,"partners":false', "section[data-testid='cookie-consent-banner']", "section[data-testid='cookie-consent-banner'] button[data-nav-close]", "#cookie.alert--cookie", "#cookie.alert--cookie[sy-alert]", "#cookie.alert--cookie.alert--active", "#cookie.alert--cookie button.alert-close", "synergy.alert.cookie=true", ".cookie-bar .cookie-box", ".cookie-bar .cookie-box .cookie-bar-buttons", ".cookie-bar .cookie-box .refuse-all", ".cookie-bar .cookie-box .cookie-bar-close", "#cookieChoiceInfo", "#cookieChoiceInfo #cookieChoiceLearnMore", "[id$='_ManageCookiesContent'] input[name$='BtnConfirmChoices']", "[id$='_ManageCookiesContent'] input[type=checkbox]:checked", "analyticsCookieConsent=n", ".cookies-drawer-wrapper", ".cookies-drawer-wrapper .btn-config", ".cookies-config-consent-modal .btn-reject", "#coiOverlay", "#coiOverlay #declineButton", "#coiOverlay.coi-visible", "ts_cookie_choice=", "%22consents_denied%22%3A%5B%22cookie_cat_functional", ".telcel-banner-aviso-cookies", ".telcel-banner-aviso-cookies #acepto-cookies", "#myModal.showmodal", "#myModal.showmodal .showmodal-close", 'div:has([href="cookiePrivacyLink"]) + div:has(> [role=button][aria-label])', 'div:has([href="cookiePrivacyLink"]) + div:has(> [role=button][aria-label]) > [role=button][aria-label]:nth-child(2)', "privacy_setting_detail=%7B%22adsChoice%22%3A%220", "[aria-label=consent-banner]", "xpath///button[contains(., 'Reject all')]", "interactionCount=1", "#tsla-reject-cookie", "tsla-cookie-consent=rejected", '[data-testid="cookies-banner"]', '[data-testid="cookies-banner"] .cookies-banner__close-icon-wrapper', '[data-testid="cookies-banner"] .cookies-banner__description', '[data-testid="desktop-close-button"]', '[data-testid="cookies-banner"] .d-none-desktop .cookies-banner__close-icon-wrapper', "#cb-cookieoverlay", '#cb-cookieoverlay, script[src*="consent.cookiebot.com/uc.js"]', "#cb-cookieoverlay #CybotCookiebotDialogBodyButtonDecline", ".cookie-popups__container", ".cookie-popups__first-consent-popup", '[data-test-id="cookie-manage-settings-button"]', ".cookie-popups__preferences-popup", ".cookie-popups__advertising-toggle:checked", '[data-test-id="cookie-advertising-slider"]', '[data-test-id="cookie-save-preferences-button"]', "lts-cookie-consent=1", "#user-consent", "#user-consent .page.main button.manage", "#user-consent .page.main", "#user-consent .page.secondary", "#user-consent .page.secondary input[type=checkbox]:checked:not([disabled])", "#user-consent .page.secondary button.save", '"marketing":"denied"', "#consent-banner button[data-testid='close-button']", '[data-callback="accounts/hide-banner/CookiesBanner"]', '[data-callback="accounts/hide-banner/CookiesBanner"] button[class*="ManageLink"]', '[data-testid="modal-body-content"] [class*="IndividualBox"] input[type="checkbox"]', '[data-testid="modal-body-content"] [class*="IndividualBox"] input[type="checkbox"][aria-disabled="false"]:checked', '[data-testid="modal-body-content"] [class*="Footer"] button', ".optanon-alert-box-wrapper", ".optanon-alert-box-wrapper .optanon-toggle-display", "#optanon-popup-wrapper", "#optanon-menu li.menu-item-on:is(.menu-item-performance,.menu-item-functional,.menu-item-advertising,.menu-item-social) button", "#optanon-popup-more-info-bar .optanon-status-editable .optanon-status-on label", "#optanon-popup-bottom .optanon-save-settings-button button", "%2C2%3A0%2C3%3A0%2C4%3A0", "[role=dialog][aria-labelledby=cookie-banner-title]", "xpath///div[@role='dialog'][@aria-labelledby='cookie-banner-title']//button[normalize-space()='Manage preferences']", "xpath///div[@role='dialog'][.//input[@id='consent-toggle-analytics']]//button[normalize-space()='Reject all']", "#consent-toggle-analytics:not(:checked)", "xpath///div[@role='dialog'][.//input[@id='consent-toggle-analytics']]//button[normalize-space()='Save preferences']", "aside:has([data-gtm-cookie-types])", "aside button[data-gtm-cookie-types]", "aside button[data-gtm-cookie-types] + button", "aside label:has(> input[type=radio][value=functional])", "aside div:has(> fieldset[role=radiogroup]) + div > button", "ConsentName=FunctionalConsent", "#cookie-notification #accept-cookie", "#cookie-notification:not(.hide)", "cookies-accepted=true", "div[role=alertdialog][data-nosnippet][aria-describedby]", "div[role=alertdialog][data-nosnippet][aria-describedby] > div > div:last-child > div:last-child > button", "div[role=dialog][data-nosnippet][aria-labelledby] > div > div:last-of-type > div > div:nth-child(2) > button", '[data-test="cookie-banner"]', "#CookieNotice", "#CookieNotice > div[onclick]", "Notice=yes", "#tkConsentmanager", "#tkConsentmanager .g-consentmanager__confirm-selection", "tkConsentWirtschaftlicherWerbeeinsatz=0", "#cookie-consent #cookie-consent-btn-customise", "#cookie-consent #cookie-consent-btn-accept-some", "#cookie-consent-btn-customise", "#consent-marketing:checked", "#consent-marketing", "#cookie-consent-btn-accept-some", "%22analytics%22%3Afalse%2C%22marketing%22%3Afalse", "#cookie-compliant", "#cookie-compliant #saveAndAcceptCookies", "#cookie-compliant #cookies-config", "#cookie-compliant #cookie_b:checked", "#cookie-compliant #cookie_b", "#cookie-compliant #cookie_c:checked", "#cookie-compliant #cookie_c", "ALLOW_COOKIES=a", "ALLOW_COOKIES=a-", "xpath///div[contains(@class, 'fixed') and contains(., 'Cookie\u3092\u30D6\u30ED\u30C3\u30AF') and .//button[normalize-space()='Cookie\u306E\u8A2D\u5B9A']]", "xpath///div[contains(@class, 'fixed') and contains(., 'Cookie\u3092\u30D6\u30ED\u30C3\u30AF')]//button[normalize-space()='Cookie\u306E\u8A2D\u5B9A']", "xpath///button[normalize-space()='\u8A2D\u5B9A\u3092\u4FDD\u5B58\u3059\u308B']", ".optIn", ".optIn .js-optin-cookie-settings", 'label[for="TAB-02"]', 'label[for="TAB-02"] + .tab-content .toggleSwitch__circle', 'label[for="TAB-03"]', 'label[for="TAB-03"] + .tab-content .toggleSwitch__circle', ".js-modal-save-settings", "__performanceCookieFlag__=0", "__targetingCookieFlag__=0", "#cookies-banner #closeCookiesBanner", ".banner-setting-cookie", ".banner-setting-cookie.show", ".banner-setting-cookie .btn-setting", ".menu-setting-cookie.show", "#performance_cookie_off", "#social_cookie_off", ".menu-setting-cookie.show .btn-confirm-selection", "div[role=dialog][aria-labelledby=privacy-notice-title]", "div[aria-labelledby=privacy-notice-title] button[role=switch][aria-checked=true]", "div[aria-labelledby=privacy-notice-title] button[role=switch][aria-checked=false]", "div[aria-labelledby=privacy-notice-title] button:not([role=switch]):last-child", ".fixed.bottom-0:has(#cookie-banner-heading)", ".fixed.bottom-0 [aria-labelledby=cookie-banner-heading]", "#cookie-modal-window button[name=save-cookies]", "#cookie-modal-window.show button[name=save-cookies]", "#cookie-modal-window #check-usability:checked", "#cookie-modal-window #check-usability", "#cookie-modal-window #check-statistics:checked", "#cookie-modal-window #check-statistics", "statistics", ".cm-Cookie.js-Cookie", ".cm-Cookie.js-Cookie .js-CookieBtn", '[class*="cookie-warning-wrapper"]', '[class*="cookie-warning-wrapper"] #notAllowCookiesButton', "#notAllowCookiesButton", "COOKIE_WARNING_REJECTED=true", "#pp .cookiesnoticev2", "#pp .cookiesnoticev2 #reject_all", '"analiticas": {"All":false', "#tse-consent", "#tse-consent .tse-more", "#tse-consent .tse-opts .tse-no", "#tse-consent .tse-t-ga:checked", "#tse-consent .tse-no", '[data-ti="disclaimer_wrapper"]', ".tvp-cookie-overlay", ".tvp-cookie-overlay .tvp-covl", ".tvp-covl .tvp-covl__sb", ".tvp-covl .tvp-covl__save", ".tvp-covl input.iabd:not(:checked)", ".tvp-covl input.iabd", "TVPtcs22=", '[data-a-target="consent-banner"],.ReactModalPortal:has([data-a-target=consent-modal-save])', '[data-a-target="consent-banner"]', '[data-a-target="consent-banner-accept"]', '[data-a-target="consent-banner"] button:not([data-a-target])', 'button[data-a-target="consent-banner-manage-preferences"]', "input[type=checkbox][data-a-target=tw-checkbox]:not([disabled])", "input[type=checkbox][data-a-target=tw-checkbox]:not(:checked):not([disabled])", "[data-a-target=consent-modal-save]", ".ReactModalPortal:has([data-a-target=consent-modal-save])", "#splash .subcolumns .subcr a[href='#']", "#splash .subcolumns", "#splash .subcr a[href='#']", 'huubShowInfo="false"', "#footer_tc_privacy", "#privacy__modal__close, #footer_tc_privacy #privacy__links__center", "#privacy__modal__close, #footer_tc_privacy", "#privacy__modal__close", "#footer_tc_privacy #privacy__links__center", "#privacy_options #options_tc_privacy_button", "UBI_PRIVACY_POLICY_VIEWED=true", "UBI_PRIVACY_ADS_OPTOUT=true", ".cookie-alert .cookies-manager__btn-open", ".cookie-alert button.cookies-manager__btn-open", ".cookies-manager__window", ".cookies-manager input.toggle:checked:not(:disabled)", ".cookies-manager__btn-save", "udgCookiesPreferences=set", ".toasterAlert .toaster", ".toasterAlert .toaster-content a[href*='/npp/OSPP-']", ".toasterAlert .toaster-close", '[class*="CookieNotice_cookieModal"] [class*="CookieNotice_amgdprcookie-buttons-block"]', '[class*="CookieNotice_cookieModal"] button[class*="CookieNotice_amgdprcookie-button"]:not([class*="CookieNotice_accept"]):not([class*="CookieNotice_settings"])', '[class*="CookieNotice_cookieModal"] [class*="CookieNotice_amgdprcookie-groups-container"]', '[class*="CookieNotice_cookieModal"] [class*="CookieNotice_amgdprcookie-groups-container"] input[type="checkbox"]:checked:not([disabled])', '[class*="CookieNotice_cookieModal"] button[class*="CookieNotice_accept"]', "#langModal .lang-modal__text", "#langModal .lang-modal__content > .lang-modal__close", "div[role='presentation']:has(p[data-sentry-source-file='CookieBanner.tsx'])", "p[data-sentry-source-file='CookieBanner.tsx']", "div[role='presentation']:has(p[data-sentry-source-file='CookieBanner.tsx']) button[data-sentry-element='UCButton']:nth-of-type(2)", "UCAcceptCookie=3", ".js-cookie-preferences", ".js-cookie-preferences .js-manage-cta", ".js-cookie-preferences.is-active", ".js-cookie-preferences .js-manage-panel button[type=submit]", "label[for=performace-no]", "label[for=targeted-advertising-no]", "advertisingCookies=false", "performanceAnalyticsCookies=false", "#__tealiumGDPRcpPrefs #consent-container", "#__tealiumGDPRcpPrefs #consent-container #consent-modal-settings", "#no-consent-popup-close-modal", "#cookieModal", '#cookieModal [onclick*="cookiesPolicy.selDefAndloadScript"]', "unive.it=1", "noiframe=checked", "socialpix=checked", "#acceptCookies", "#acceptCookies button", "app-cookie-consent > .cookie-banner", "app-cookie-consent .cookie-banner", "app-cookie-consent .cookie-banner > div > button:nth-of-type(2)", "#modal-consent-banner", "#modal-consent-banner #btn-edit-cookie-consent", "#cookie-consent-banner #btn-edit-cookie-consent", "#cookie-consent-dialog #btn-accept-some", "#consent-ad:checked", "#consent-ad", "#cookie-consent-dialog", ".ucb", ".ucb-banner", ".ucb-banner .ucb-btn-save", "#cookie-blur", "#cookie-notice #cookie_notice_manage", "COOKIES_ADVERTISING=0", "#js-pw-consent-wrapper bgl-modal[test-id='cookie-modal']", "#js-pw-consent-wrapper [data-ta-id='pw-consent-rejectAllButton']", "div.fixed:has(#modal-title) button.btn-cta", "div.fixed:has(#modal-title) p button", "label[for=cookies-functional]", "div.fixed:has(#cookies-functional:checked) button.btn-cta", "xsarusCookieSettings=disabled", "app-cookiewindow", "app-cookiewindow #accept-choice", "app-cookiewindow input.cookie-checkbox:checked:not([disabled])", "cookie-consent=%5B%5D", ".alert-cookie #dismiss-cookie-banner-button", "vd_cookie_warning=1", ".gdpr_container", ".gdpr_modal_container", ".gdpr .gdpr_manage_cookies_button", ".gdpr .gdpr_container", ".gdpr_modal .gdpr_modal_button_reject", 'vg_consent={"functionality":false,"performance":false,"targeting":false}', ".CookieBanner", ".CookieBanner #Cookie_Selected", ".CookieBanner:not(.out) #Cookie_Selected", ".CookieBanner input[type=checkbox]:checked", "CookieConsent=required", "CookieConsent=required,", ".bcp-contenedor-aviso.mostrar", ".bcp-politica-uso-cookie-adobe .bcp-btn-configurar", ".bcp-contenedor-aviso.mostrar .bcp-btn-configurar", ".bcp-configuracion-politica-cookie.mostrar .bcp-guardar-preferencia", "politica_privacidad_marketing_analitica=false", "politica_privacidad_personalizacion=false", ".cookie-notice", ".cookie-notice #accept-use-cookie", "#accept-use-cookie", "ACCEPT_USE_COOKIE=1", 'div.fixed.bottom-0:has(svg[data-icon="cookie-bite"])', 'div.fixed.bottom-0:has(svg[data-icon="cookie-bite"]) button', ".component-lightbox-gdpr", ".component-lightbox-gdpr .gdpr_cookie_settings_accept_cookies", ".gdpr_cookie_settings_accept_cookies__button-container__button.button--solid--secondary", ".gdpr_cookie_settings_cookie_settings", ".gdpr_cookie_settings_cookie_settings .component-toggle-button[toggle_selected=True]", ".gdpr_cookie_settings_cookie_settings__main-section__button-container__button", "_vinnova_gdpr=0", "wc-consent-modal", "acceptEssentialCookies=true", "[class*='_cookies-root_']", "[data-testid='cookie-consent-accept-all']", "[data-testid='cookie-consent-open-settings-button'], [class*='_vxcc__settings-trigger_']", "[data-testid='cookie-consent-settings-reject-all-button']", "cc_cookie=%7B%22level%22%3A%5B%22necessary%22%5D", ".cookie-policy-modal", ".manage-cookies-modal", ".cookie-policy-modal .cookie-policy-details button.manage", ".manage-cookies-modal .manage-cookies-footer button.btn-outline-primary", ".dip-consent,.dip-consent-container", ".dip-consent-container", ".dip-consent-content", '.dip-consent-btn[tabindex="2"]', "dialog.cm-banner", "dialog.cm-banner .cm-actions", "dialog.cm-banner[open]", "dialog.cm-banner .cm-actions .cm-btn--outline", "xpath///dialog[contains(@class,'cm-banner')]//div[contains(@class,'cm-actions')]/button[normalize-space()='Weiger alles']", "cm_consent_v3=necessary|", "cookie-banner#cookie-banner-host", "C3%3A0", "C4%3A0", ".footer-signup:has(consent-scheduler > .cookie-consent-js:not(.hidden))", "consent-scheduler > .cookie-consent-js", ".footer-signup.active consent-scheduler > .cookie-consent-js:not(.hidden)", ".vsco-cookie[data-cookie=banner]", ".vsco-cookie_buttons [data-cookie=close-btn]", ".footer_legal .ot-sdk-show-settings-vsco", "#band-cookies", "#band-cookies-close", "#cookie-banner [class*='manage-preferences']", "[class*='cookies-modal'] form", "[class*='cookies-modal'] form input[type=checkbox]:checked", "[class*='cookies-modal'] .form-group-btn a", "marketing_storage=denied", "performance_storage=denied", 'a[href="https://www.walmartcanada.ca/cookie-notice"]', 'button[data-dca-intent="open"][role="link"]', "#advertisingCookies", "#personalizationCookies:checked, #advertisingCookies:checked", "xpath///button[contains(., 'Save settings') or contains(., 'Enregistrer les param\xE8tres')]", "&p13n=false&ads=false&", '.MuiDialog-root [role=dialog] img[src*="portalCKM-cookie-dialog"]', ".MuiDialog-root [role=dialog] button.MuiButton-outlined", ".MuiDialog-root [role=dialog] .MuiFormGroup-root button.MuiButton-outlined", ".MuiDialog-root [role=dialog] .MuiFormGroup-root input[type=checkbox]:checked:not(:disabled)", ".MuiDialog-root [role=dialog]", ".cookie-banner .btn-accept-selected", ".cookie-banner .toggle-switch[aria-pressed='true']", ".gdpr-popup", ".gdpr-popup #gdpr-popup__show-preferences", ".gdpr-popup.gdpr-popup--show", "#gdpr-popup__show-preferences", "#gdpr-popup__preferences button[data-gdpr=button][value=save]", "#gdpr-popup__preferences button[data-gdpr=switch][aria-checked=true]", "%22interactedWith%22:true", "%22marketing%22:%22revoked%22", "[role=dialog] [data-testid=view-preferences], .CookieNotice-Dialog [data-testid=Preferences]", "[role=dialog] [data-testid=view-preferences]", "[role=dialog] [data-testid=save-preferences]", ".CookieNotice-Dialog [data-testid=Preferences]", ".CookieNotice-Dialog [data-testid=UpdateAndClose]", "%22analytics%22:false%2C%22marketing%22:false", "[data-testid='consent-banner']", "[data-testid='consent-banner'] [data-testid='consent-banner-essential-only']", "[data-testid='consent-banner-essential-only']", "wn_consent=%7B%22groups%22%3A%5B%22ESSENTIAL%22%5D", ".shopify-section.cookies:has(.accept-cookies)", ".shopify-section.cookies .accept-cookies", "#wmf-consent-banner", "#wmf-consent-banner [data-consent=reject]", "#cookiePolicy:has(#cookiePolicyClose)", "#cookiePolicy #cookiePolicyWrap #cookiePolicyClose", "section.cb[data-consent]", "section.cb[data-consent] [data-consent-decline]", 'dialog[aria-labelledby="consent-title"]', "div.animate-slideFromLeft.fixed.bottom-0.z-50", 'dialog[aria-labelledby="consent-title"], div.animate-slideFromLeft.fixed.bottom-0.z-50', 'dialog[aria-labelledby="consent-title"] button.border-xe-primary-500, div.animate-slideFromLeft button.border-xe-primary-500', '[data-testid="performance-toggle"]', 'dialog[aria-labelledby="consent-title"] button.bg-xe-primary-500, div.animate-slideFromLeft button.bg-xe-primary-500', "xeConsentState={%22performance%22:false%2C%22marketing%22:false", '[data-role="cookies-modal"]', '[data-role="cookies-modal"] [data-opt-hydration="cookies-dialog-eu"]', '[data-role="cookies-modal"] [class*=experimentalButtons] button:nth-of-type(2)', '[data-role="cookies-modal"] [class*=container]', "[class*=cookiesAnnounce]", "[class*=cookiesAnnounce] [class*=announceText]", "form#consent-dialog button[data-testid=give-consent-button]", "form#consent-dialog", "form#consent-dialog button[name=read-more]", "form#consent-dialog fieldset", "form#consent-dialog fieldset input[type=checkbox]:checked:not([disabled])", "cookies_marketing_ok=false", "#cookieBar", "#cookieBar .js-cookies-btn", "#cookieBar [data-event=cookies-show-settings]", "#cookiesPopup .js-save-settings", "#cookiesPopup .js-switch.active:not(.is-required)", '"ad_storage":"denied"', "div.cookie.flex.flex-wrap", "xpath///div[contains(@class,'cookie')]//button[normalize-space()='Deny']", "#consent-page", "#consent-page button[value=reject]", "article:has(a[href*='shueisha.co.jp/privacy'])", "article:has(a[href*='shueisha.co.jp/privacy']) > div", "article:has(a[href*='shueisha.co.jp/privacy']) > div > div:last-child", "section.cookie-banner[aria-labelledby=cookieHeading]", "section.cookie-banner .controls button.btn-outline-primary", "#cookieModal .modal-footer button.btn-outline-primary", "#cookieModal .modal-body input[type=checkbox]:checked:not([disabled])", "#colorbox.colorbox-cookie-consent", "#cboxOverlay.colorbox-cookie-consent", "#cookie-consent form.cookie-consent", "#colorbox input.cookie-consent-reject-all", "ConsentMarketing=False", ".cookies-box .cookies-btn-customize", ".manage-consent-preferences-dialog, .el-dialog[aria-label='Manage Consent Preferences']", ".manage-consent-preferences-dialog .van-checkbox__icon--checked, .el-dialog[aria-label='Manage Consent Preferences'] .el-checkbox.is-checked", ".manage-consent-preferences-dialog .van-dialog__confirm, .el-dialog[aria-label='Manage Consent Preferences'] .el-dialog__footer button", "yuntrackAccept=agree", "#gdvdl-cookie-consent-dialog-content-button-auswahl-button", "#gdvdl-cookie-consent-dialog-tracking-cookies-checkbox-checkbox-input:checked", "#consent-init", "#consent-init #consent-configure", "#consent-update #consent-configuration-save", "zinio-cookie-consent", ".cookies.main-class .customize-btn", ".cookies.main-class .cookies-container .customize-btn", ".cookies.main-class .cookies-hidden .el-switch", ".cookies-hidden .el-switch.is-checked:not(.is-disabled)", ".cookies.main-class .cookies-hidden .accept-btn", "validCookies=general--", "#rgpd-banner", "#rgpd-banner .gdrp-required", "cookie_consent_ads=off", "cookie_consent=1", "zz-cookie-banner", "user.consent=true", "consent.analytics=false", "[class*='CookieDisclaimerContainer']", "[class*='CookieDisclaimerContainer'] [class*='CookieDisclaimerClose']"], r: [[1, "123inkt", 2, "", 22, [0], [{ e: 1 }], [{ check: "any", v: 2 }], [{ c: 1 }], [], {}], [1, "1fichier", 1, "", 22, [3], [{ e: 4 }], [{ v: 5 }], [{ h: 5 }], [], {}], [1, "2gis", 2, "", 22, [6], [{ e: 6 }], [{ v: 6 }], [{ c: 7 }], [{ check: "none", timeout: 1e3, wv: 6 }], {}], [1, "abconcerts.be", 2, "", 22, [8], [{ e: 9 }], [{ v: 9 }], [{ if: { e: 10 }, then: [{ k: 10 }], else: [{ k: 11 }, { c: 12 }] }], [], { intermediate: false }], [1, "abebooks", 2, "", 22, [13], [{ e: 14 }], [{ v: 15 }], [{ c: 16 }, { check: "none", timeout: 2e3, optional: true, wv: 15 }], [{ cc: 17 }], {}], [1, "accept-cookie-box", 1, "", 22, [18], [{ e: 19 }], [{ v: 18 }], [{ h: 18 }], [], {}], [1, "acceptrics", 2, "", 22, [20], [{ e: 20 }], [{ v: 20 }], [{ c: 21 }], [{ eval: "EVAL_ACCEPTRICS_TEST" }], {}], [1, "acconsento", 2, "", 22, [22], [{ e: 23 }], [{ v: 23 }], [{ if: { e: 24 }, then: [{ c: 24 }], else: [{ c: 25 }] }], [{ cc: 26 }, { cc: 27 }], {}], [1, "acos-cms", 2, "", 22, [28], [{ e: 29 }], [{ v: 29 }], [{ c: 30 }, { check: "none", wv: 29 }], [{ cc: 31 }], { intermediate: false }], [1, "acris", 2, "", 22, [32], [{ e: 33 }], [{ v: 34 }], [{ check: "any", wv: 35 }, { wait: 500 }, { c: 35 }], [], {}], [1, "adaptivemedia", 2, "", 22, [36], [{ e: 37 }], [{ v: 38 }], [{ c: 39 }], [{ cc: 40 }], {}], [1, "admetricspro", 0, "", 22, [41, 42], [{ e: 43 }], [{ v: 44 }], [{ if: { e: 45 }, then: [{ all: true, optional: true, k: 46 }, { c: 47 }], else: [{ c: 48 }, { c: 49 }] }], [{ check: "none", timeout: 3e3, wv: 44 }], {}], [1, "adnuntius", 2, "", 22, [50], [{ e: 51 }], [{ v: 50 }], [{ c: 51 }], [{ check: "none", v: 50 }], {}], [1, "adopt", 2, "", 22, [52], [{ e: 53 }], [{ v: 52 }], [{ c: 54 }], [{ eval: "EVAL_ADOPT_TEST" }], {}], [1, "Adroll", 2, "", 22, [55], [{ e: 55 }], [{ v: 55 }], [{ c: 56 }], [{ negated: true, cc: 57 }], {}], [1, "adstate", 2, "", 22, [58], [{ exists: ["adstate-settings-component app-wrapper", "#cookie-pop-up-only-necessary"] }], [{ visible: ["adstate-settings-component app-wrapper", "app-cookie-pop-up"] }], [{ waitForThenClick: ["adstate-settings-component app-wrapper", "#cookie-pop-up-only-necessary"] }], [{ waitForVisible: ["adstate-settings-component app-wrapper", "app-cookie-pop-up"], check: "none", timeout: 2e3 }], {}], [1, "albelli-photobox", 0, "", 22, [59], [{ e: 60 }], [{ v: 60 }], [{ if: { v: 61 }, then: [{ c: 61 }], else: [{ if: { v: 62 }, then: [{ c: 62 }], else: [{ c: 63 }] }, { wv: 64 }, { all: true, optional: true, k: 65 }, { c: 64 }] }], [{ any: [{ cc: 66 }, { cc: 67 }] }], {}], [1, "alertamodal-cookies", 2, "", 22, [68], [{ e: 69 }], [{ v: 69 }], [{ c: 69 }], [{ cc: 70 }], {}], [1, "alertnotification-alert-bar", 1, "", 22, [71], [{ e: 71 }], [{ v: 71 }], [{ h: 71 }], [], {}], [1, "altamar-cookieconsent", 2, "", 22, [], [{ e: 72 }], [{ v: 72 }], [{ c: 72 }, { wv: 73 }, { if: { e: 74 }, then: [{ k: 75 }] }, { c: 76 }], [{ cc: 77 }], {}], [1, "alza-cookies-info", 2, "", 22, [78], [{ e: 79 }], [{ v: 79 }], [{ retry: 10, retryInterval: 1e3, c: 79 }], [{ timeout: 2e3, check: "none", wv: 79 }], {}], [1, "amasty-gdpr", 0, "", 22, [], [{ e: 80 }], [{ v: 80 }], [{ timeout: 1e4, w: 81 }, { if: { v: 82 }, then: [{ c: 83 }], else: [{ k: 84 }, { wv: 85 }, { all: true, optional: true, k: 86 }, { retry: 3, retryInterval: 500, c: 87 }] }], [{ check: "none", timeout: 5e3, wv: 80 }], {}], [1, "amasty-gdpr-hyva", 0, "", 22, [], [{ e: 88 }], [{ v: 89 }, { negated: true, e: 90 }], [{ check: "none", timeout: 5e3, wv: 91 }, { if: { e: 92 }, then: [{ c: 92 }, { check: "none", timeout: 3e3, optional: true, wv: 89 }, { if: { v: 89 }, then: [{ k: 92 }] }], else: [{ if: { e: 93 }, then: [{ c: 94 }, { wv: 93 }, { all: true, optional: true, k: 95 }, { k: 93 }], else: [{ c: 96 }, { timeout: 2e3, optional: true, wv: 91 }, { if: { v: 91 }, then: [], else: [{ k: 96 }] }, { wv: 91 }, { timeout: 5e3, wv: 97 }, { all: true, optional: true, k: 98 }, { c: 91 }, { check: "none", timeout: 1e4, optional: true, wv: 91 }, { check: "none", timeout: 1e3, optional: true, wv: 89 }, { if: { v: 89 }, then: [{ optional: true, k: 99 }] }] }] }], [{ any: [{ e: 90 }, { check: "none", timeout: 5e3, wv: 89 }] }], {}], [1, "amasty-gdpr-sidebar", 0, "", 22, [], [{ e: 100 }, { negated: true, e: 80 }], [{ v: 101 }], [{ if: { v: 102 }, then: [{ timeout: 1e4, retry: 5, retryInterval: 1e3, c: 103 }], else: [{ all: true, optional: true, k: 104 }, { timeout: 1e4, retry: 5, retryInterval: 1e3, c: 105 }] }], [{ check: "none", timeout: 5e3, wv: 101 }], {}], [1, "amazon-hiring", 2, "", 22, [], [{ e: 106 }], [{ v: 106 }], [{ k: 107 }, { check: "none", timeout: 2e3, wv: 106 }, { if: { e: 108 }, then: [{ k: 108 }] }, { check: "none", timeout: 2e3, wv: 109 }], [], {}], [1, "amazon.com", 2, "", 22, [110], [{ e: 110 }], [{ check: "any", v: 111 }], [{ wv: 112 }, { retry: 5, retryInterval: 1e3, c: 112 }], [], {}], [1, "amex", 0, "", 22, [113], [{ e: 113 }], [{ v: 113 }], [{ c: 114 }], [], {}], [1, "amgueddfa-cms", 2, "", 22, [115], [{ e: 116 }], [{ v: 115 }], [{ c: 117 }, { wv: 118 }, { all: true, optional: true, k: 119 }, { k: 120 }], [{ wait: 1e3 }, { cc: 121 }, { cc: 122 }], {}], [1, "ancestry", 2, "", 22, [123, 124], [{ e: 125 }], [{ v: 125 }], [{ retry: 3, c: 125 }], [{ timeout: 1e3, check: "none", wv: 125 }], {}], [1, "anowave-gtm", 2, "", 22, [126], [{ e: 126 }], [{ v: 126 }], [{ if: { e: 127 }, then: [{ k: 127 }], else: [{ e: 128 }, { all: true, optional: true, k: 129 }, { k: 130 }] }, { check: "none", timeout: 5e3, wv: 126 }], [{ cc: 131 }, { negated: true, cc: 132 }], {}], [1, "anthropic", 2, "", 22, [], [{ e: 133 }], [{ v: 133 }], [{ c: 134 }], [{ cc: 135 }], {}], [1, "anwalt-suchservice", 2, "", 22, [], [{ e: 136 }, { e: 137 }], [{ v: 137 }], [{ c: 137 }, { wv: 138 }, { optional: true, k: 139 }, { c: 140 }], [{ cc: 141 }], {}], [1, "AppConsent", 2, "", 22, [142], [{ e: 143 }], [{ v: 142 }], [{ waitFor: ["iframe[srcdoc*='cdn.appconsent.io/tcf2-clear/']", ".button__refuseAll, .button__skip"] }, { if: { exists: ["iframe[srcdoc*='cdn.appconsent.io/tcf2-clear/']", ".button__refuseAll"] }, then: [{ click: ["iframe[srcdoc*='cdn.appconsent.io/tcf2-clear/']", ".button__refuseAll"] }], else: [{ click: ["iframe[srcdoc*='cdn.appconsent.io/tcf2-clear/']", ".button__skip"] }] }], [{ timeout: 1e3, check: "none", wv: 142 }], {}], [1, "AppConsent legacy", 2, "", 22, [144], [{ e: 145 }], [{ v: 144 }], [{ waitFor: ["iframe[srcdoc*='frame-root']", ".button__skip, .button__openPrivacyCenter"] }, { if: { exists: ["iframe[srcdoc*='frame-root']", ".button__skip"] }, then: [{ click: ["iframe[srcdoc*='frame-root']", ".button__skip"] }], else: [{ click: ["iframe[srcdoc*='frame-root']", ".button__openPrivacyCenter"] }, { waitForThenClick: ["iframe[srcdoc*='frame-root']", ".button__refuseAll"] }, { waitForThenClick: ["iframe[srcdoc*='frame-root']", ".button__save"] }] }], [{ timeout: 1e3, check: "none", wv: 144 }], {}], [1, "aquasana.com", 2, "", 22, [146], [{ v: 146 }], [{ v: 146 }], [{ if: { e: 147 }, then: [{ k: 147 }], else: [{ h: 146 }] }], [], {}], [1, "arbeitsagentur", 2, "", 22, [148], [{ e: 149 }], [{ e: 150 }], [{ waitForThenClick: ["bahf-cookie-disclaimer-dpl3", "#bahf-cookie-disclaimer-modal .ba-btn-contrast"] }], [{ cc: 151 }], {}], [1, "arto", 0, "", 22, [152], [{ e: 153 }], [{ v: 154 }], [{ c: 154 }], [{ cc: 155 }], {}], [1, "as-adventure", 2, "", 22, [156, 157, 158], [{ e: 159 }], [{ check: "any", v: 160 }], [{ all: true, retry: 10, retryInterval: 500, c: 159 }], [{ timeout: 2e3, check: "none", wv: 160 }], {}], [1, "asahi-interactive", 2, "", 22, [161], [{ e: 162 }], [{ v: 161 }], [{ c: 163 }], [{ cc: 164 }], {}], [1, "askas", 2, "", 22, [165], [{ e: 165 }, { e: 166 }, { e: 167 }], [{ v: 165 }], [{ if: { e: 168 }, then: [{ if: { check: "none", v: 168 }, then: [{ k: 169 }, { timeout: 2e3, optional: true, wv: 168 }] }, { k: 168 }], else: [{ if: { check: "none", v: 167 }, then: [{ k: 169 }, { timeout: 2e3, wv: 167 }] }, { all: true, optional: true, k: 170 }, { k: 167 }] }], [{ cc: 171 }, { cc: 172 }], {}], [1, "aspnet-cookieinfo", 0, "", 22, [173], [{ e: 174 }], [{ v: 173 }], [{ c: 174 }], [{ cc: 175 }], {}], [1, "astro-cookie-notice-fzbxxtek", 1, "", 22, [176], [{ e: 177 }], [{ v: 176 }], [{ h: 176 }], [], {}], [1, "asus", 2, "", 22, [178], [{ e: 179 }], [{ v: 179 }], [{ if: { e: 180 }, then: [{ k: 180 }], else: [{ c: 181 }, { c: 182 }] }], [], {}], [1, "atcom-cookiemon", 2, "", 22, [183], [{ e: 184 }], [{ v: 185 }], [{ c: 184 }], [{ timeout: 1e3, check: "none", wv: 185 }, { cc: 186 }], {}], [1, "atomstore", 0, "", 10, [187, 188], [{ e: 189 }], [{ check: "any", v: 190 }], [{ if: { e: 191 }, then: [{ c: 192 }], else: [{ if: { e: 193 }, then: [{ c: 194 }], else: [{ c: 195 }] }] }, { check: "none", wv: 190 }], [{ cc: 196 }], {}], [1, "atruvia-consent-layer", 2, "", 22, [197], [{ e: 198 }], [{ v: 199 }], [{ c: 200 }], [{ timeout: 2e3, check: "none", wv: 199 }], {}], [1, "autodoc", 2, "", 22, [201], [{ e: 202 }], [{ v: 202 }], [{ c: 202 }], [{ wait: 2e3 }, { cc: 203 }], {}], [1, "automattic-cmp-optout", 2, "", 22, [204], [{ e: 204 }], [{ v: 204 }], [{ k: 205 }, { all: true, c: 206 }, { k: 207 }], [], {}], [1, "autoscout24", 2, "", 22, [208], [{ e: 209 }], [{ v: 209 }], [{ c: 210 }, { timeout: 1e3, optional: true, c: 210 }], [{ wait: 500 }, { cc: 211 }], {}], [1, "avacy", 2, "", 22, [212, 213], [{ e: 214 }], [{ check: "any", v: 214 }], [{ if: { check: "any", v: 215 }, then: [{ c: 215 }], else: [{ if: { check: "any", v: 216 }, then: [{ k: 216 }], else: [{ if: { e: 217 }, then: [{ c: 217 }], else: [{ c: 218 }, { wv: 219 }, { if: { v: 220 }, then: [{ k: 220 }] }, { k: 219 }] }] }] }], [], {}], [1, "avada-cookie-consent", 2, "", 22, [221], [{ e: 222 }], [{ check: "any", v: 222 }], [{ c: 222 }, { any: [{ check: "none", timeout: 1e3, wv: 221 }, { c: 223 }] }], [{ cc: 224 }], {}], [1, "avada-privacy-bar", 2, "", 22, [225], [{ e: 226 }], [{ check: "any", v: 225 }], [{ if: { e: 227 }, then: [{ all: true, k: 227 }], else: [{ all: true, optional: true, k: 228 }, { all: true, k: 229 }] }], [{ check: "none", timeout: 1e3, wv: 225 }], {}], [1, "avada-privacy-bar-cosmetic", 1, "", 22, [225], [{ e: 229 }], [{ check: "any", v: 225 }], [{ h: 225 }], [], {}], [1, "avg-cookiebanner", 2, "", 22, [230], [{ e: 230 }], [{ negated: true, cc: 231 }, { v: 232 }], [{ if: { e: 233 }, then: [{ c: 233 }], else: [{ all: true, optional: true, k: 234 }, { if: { e: 235 }, then: [{ retry: 3, c: 235 }], else: [{ retry: 3, c: 236 }] }] }], [{ cc: 231 }], {}], [1, "avvio", 2, "", 22, [237], [{ e: 238 }], [{ check: "any", v: 239 }], [{ if: { v: 240 }, then: [{ c: 241 }] }, { wv: 242 }, { if: { e: 243 }, then: [{ all: true, k: 244 }] }, { k: 242 }, { check: "none", wv: 237 }], [{ cc: 245 }], {}], [1, "aws.amazon.com", 2, "", 22, [246, 247, 248, 249], [{ e: 246 }], [{ v: 246 }], [{ if: { e: 250 }, then: [{ k: 250 }], else: [{ k: 251 }, { w: 252 }, { all: true, optional: true, k: 253 }, { k: 254 }] }], [], {}], [1, "axeptio", 2, "", 22, [255], [{ e: 255 }], [{ any: [{ e: 256 }, { v: 257 }, { visible: [".axeptio_mount .needsclick", ".axeptio_widget"] }, { cc: 258 }] }], [{ if: { e: 259 }, then: [{ waitForVisible: [".axeptio_mount .needsclick", "button#axeptio_btn_dismiss,button.ax-discardButton,.ax-widget-relifted [data-testid=widget-header] > button,button#axeptio_btn_close"] }, { wait: 300 }, { if: { exists: [".axeptio_mount .needsclick", "button#axeptio_btn_dismiss,button.ax-discardButton,.ax-widget-relifted [data-testid=widget-header] > button"] }, then: [{ click: [".axeptio_mount .needsclick", "button#axeptio_btn_dismiss,button.ax-discardButton,.ax-widget-relifted [data-testid=widget-header] > button"] }], else: [{ click: [".axeptio_mount .needsclick", "button#axeptio_btn_close"] }] }], else: [{ wv: 260 }, { wait: 300 }, { if: { e: 261 }, then: [{ k: 261 }], else: [{ k: 262 }] }] }], [{ cc: 263 }], {}], [1, "axeptio-tcf", 2, "", 22, [264], [{ any: [{ e: 265 }, { exists: ["body > [style*='--ax-primary-color']", "[id^='axeptio_btn_']"] }] }], [{ visible: ["body > [style*='--ax-primary-color']", ".modal.show"] }], [{ waitForVisible: ["body > [style*='--ax-primary-color']", "#axeptio_btn_dismiss, .modal-continue a"] }, { if: { exists: ["body > [style*='--ax-primary-color']", "#axeptio_btn_dismiss"] }, then: [{ click: ["body > [style*='--ax-primary-color']", "#axeptio_btn_dismiss"] }], else: [{ click: ["body > [style*='--ax-primary-color']", ".modal-continue a"] }] }], [], {}], [1, "aylo-cookie-banner", 2, "", 22, [266], [{ e: 267 }, { e: 268 }], [{ v: 267 }, { any: [{ v: 269 }, { eval: "EVAL_AYLO_COOKIE_MANAGER_READY" }] }], [{ if: { v: 270 }, then: [{ c: 270 }], else: [{ if: { v: 271 }, then: [{ wait: 8e3 }, { c: 271 }], else: [{ c: 272 }] }] }, { optional: true, c: 273 }], [{ any: [{ cc: 274 }, { cc: 275 }] }], {}], [1, "b-cookie", 1, "", 22, [276], [{ e: 276 }], [{ v: 276 }], [{ h: 276 }], [], {}], [1, "baden-wuerttemberg.de", 2, "", 22, [277], [{ e: 277 }], [{ v: 277 }], [{ if: { e: 278 }, then: [{ k: 278 }], else: [{ all: true, optional: true, k: 279 }, { k: 280 }] }], [], {}], [1, "bancaditalia", 2, "", 22, [281], [{ e: 282 }], [{ v: 281 }], [{ c: 282 }], [{ cc: 283 }], {}], [1, "bannercookie-dashboard", 2, "", 22, [284], [{ e: 285 }], [{ v: 285 }], [{ c: 285 }], [{ cc: 286 }], {}], [1, "bathnes-cookie-banner", 2, "", 22, [287], [{ e: 287 }], [{ v: 288 }], [{ c: 288 }], [{ check: "none", timeout: 1e3, wv: 287 }], {}], [1, "bayern-stmas", 2, "", 22, [289], [{ e: 290 }], [{ v: 290 }], [{ if: { e: 291 }, then: [{ k: 292 }] }, { retry: 3, retryInterval: 500, c: 290 }, { check: "none", timeout: 2e3, optional: true, wv: 289 }], [{ check: "none", timeout: 2e3, wv: 289 }], {}], [1, "bbb.org", 0, "", 22, [293], [{ e: 294 }], [{ v: 295 }], [{ wv: 296 }, { wait: 500 }, { k: 296 }, { w: 297 }, { all: true, optional: true, k: 298 }, { k: 299 }, { c: 300 }], [], {}], [1, "bbva", 2, "", 22, [301], [{ e: 302 }], [{ v: 302 }], [{ c: 302 }, { check: "none", wv: 303 }], [{ cc: 304 }], {}], [1, "bdirect-booking-engine", 2, "", 22, [305], [{ e: 306 }], [{ v: 306 }], [{ retry: 2, c: 307 }], [{ cc: 308 }], { intermediate: false }], [1, "beetle-tracking", 2, "", 22, [309], [{ exists: ["beetle-tracking-consent-modal", ".consent"] }], [{ visible: ["beetle-tracking-consent-modal", ".consent__dialog-wrapper"] }], [{ waitForThenClick: ["beetle-tracking-consent-modal", ".consent__button-decline-all"], retry: 10, retryInterval: 500 }], [{ cc: 310 }], {}], [1, "belarus-cookie-info", 2, "", 10, [311], [{ e: 312 }], [{ v: 312 }], [{ c: 312 }], [{ cc: 313 }], {}], [1, "betheme", 2, "", 22, [314], [{ e: 315 }], [{ v: 316 }], [{ c: 315 }], [{ cc: 317 }], {}], [1, "betterhelp", 0, "", 22, [318, 319], [{ any: [{ e: 320 }, { e: 321 }] }], [{ any: [{ check: "any", v: 320 }, { check: "any", v: 321 }] }], [{ if: { check: "any", v: 322 }, then: [{ k: 322 }], else: [{ if: { check: "any", v: 320 }, then: [{ k: 320 }, { timeout: 2e3, optional: true, check: "any", wv: 321 }, { if: { check: "none", v: 321 }, then: [{ k: 320 }] }] }, { check: "any", wv: 321 }, { all: true, optional: true, k: 323 }, { k: 321 }] }], [{ cc: 324 }, { cc: 325 }], {}], [1, "bigcommerce-consent-manager", 0, "", 22, [326], [{ v: 326 }, { eval: "EVAL_BIGCOMMERCE_CONSENT_MANAGER_DETECT" }], [{ check: "any", v: 327 }], [{ c: 328 }], [{ cc: 329 }], {}], [1, "bigcrunch", 2, "", 10, [330, 331], [{ exists: ["#bc-cmp-host, #bc-cmp-host-auto", "#bc-cmp-banner"] }], [{ visible: ["#bc-cmp-host, #bc-cmp-host-auto", '#bc-cmp-banner-container:not([style*="display: none"]) #bc-cmp-banner'] }], [{ waitForThenClick: ["#bc-cmp-host, #bc-cmp-host-auto", "#bc-cmp-banner [data-action=reject-all]"] }], [{ waitForVisible: ["#bc-cmp-host, #bc-cmp-host-auto", '#bc-cmp-banner-container:not([style*="display: none"]) #bc-cmp-banner'], timeout: 2e3, check: "none" }], {}], [1, "bigid", 2, "", 22, [332], [{ e: 332 }], [{ visible: ["#bigidcmp-banner-widget", "#cmp-accept-all"] }], [{ if: { exists: ["#bigidcmp-banner-widget", "#cmp-reject-all"] }, then: [{ waitForThenClick: ["#bigidcmp-banner-widget", "#cmp-reject-all"] }], else: [{ if: { exists: ["#bigidcmp-banner-widget", "#cmp-custom-permissions"] }, then: [{ waitForThenClick: ["#bigidcmp-banner-widget", "#cmp-custom-permissions"] }, { waitForVisible: ["#bigidcmp-banner-widget", "#cmp-submit"] }, { click: ["#bigidcmp-banner-widget", 'button[role="switch"]:not([disabled]) > span[class*="translate-x-[1.1rem]"]'], all: true, optional: true }, { waitForThenClick: ["#bigidcmp-banner-widget", "#cmp-submit"] }], else: [{ waitForThenClick: ["#bigidcmp-banner-widget", 'div[tabindex="0"]:has(> svg #times-solid)'] }] }] }], [{ cc: 333 }, { cc: 334 }], {}], [1, "bing.com", 2, "", 22, [335], [{ e: 336 }], [{ v: 336 }, { v: 337 }], [{ wait: 500 }, { c: 338 }], [{ cc: 339 }], {}], [1, "binogi", 2, "", 22, [340], [{ e: 341 }], [{ v: 340 }], [{ retry: 3, c: 341 }], [{ check: "none", v: 340 }], {}], [1, "bleau-cookiecontrol", 2, "", 22, [342], [{ e: 343 }], [{ v: 344 }], [{ c: 343 }], [{ check: "none", wv: 342 }, { cc: 186 }], {}], [1, "blocksy", 0, "", 10, [345], [{ e: 346 }], [{ v: 345 }], [{ c: 347 }], [{ cc: 348 }], { intermediate: false }], [1, "blogger-cookie-notice", 2, "", 22, [349], [{ e: 350 }], [{ v: 349 }], [{ c: 351 }], [{ cc: 352 }], {}], [1, "bluepark", 2, "", 22, [353], [{ e: 354 }], [{ v: 355 }], [{ c: 355 }], [{ check: "none", timeout: 3e3, wv: 356 }], {}], [1, "bnes-cc", 2, "", 22, [357], [{ e: 358 }], [{ v: 359 }], [{ if: { e: 360 }, then: [{ c: 360 }], else: [{ c: 358 }, { wv: 361 }, { if: { e: 362 }, then: [{ k: 363 }] }, { if: { e: 364 }, then: [{ k: 365 }] }, { k: 361 }] }], [{ cc: 366 }, { negated: true, cc: 367 }], {}], [1, "bold-cookie-consent", 0, "", 22, [368, 369], [{ e: 370 }], [{ if: { v: 369 }, then: [{ v: 369 }], else: [{ v: 368 }, { check: "any", v: 371 }] }], [{ if: { v: 369 }, then: [{ k: 372 }, { check: "none", timeout: 3e3, optional: true, wv: 369 }], else: [{ if: { check: "any", v: 373 }, then: [{ k: 373 }], else: [{ k: 374 }, { wv: 370 }, { all: true, optional: true, k: 375 }, { k: 376 }] }, { check: "none", timeout: 3e3, optional: true, wv: 368 }] }], [{ if: { e: 369 }, then: [{ check: "none", v: 369 }], else: [{ check: "none", v: 368 }] }], {}], [1, "booknet", 1, "", 22, [377], [{ e: 378 }], [{ v: 377 }], [{ h: 377 }], [], {}], [1, "borlabs", 2, "", 22, [379], [{ e: 380 }], [{ v: 381 }], [{ timeout: 3e3, optional: true, w: 382 }, { if: { e: 383 }, then: [{ k: 383 }], else: [{ if: { e: 384 }, then: [{ k: 384 }], else: [{ if: { e: 385 }, then: [{ k: 385 }], else: [{ if: { e: 386 }, then: [{ k: 386 }, { wv: 387 }, { all: true, optional: true, k: 388 }, { k: 389 }, { wait: 500 }] }] }] }] }], [{ eval: "EVAL_BORLABS_0" }], {}], [1, "bosch-dock-privacy-settings", 2, "", 22, [390], [{ e: 390 }], [{ visible: ["dock-privacy-settings", "#decline-all-modal-dialog button"] }], [{ waitForThenClick: ["dock-privacy-settings", "#decline-all-modal-dialog button"] }], [{ waitForVisible: ["dock-privacy-settings", "#decline-all-modal-dialog button"], timeout: 1e3, check: "none" }], {}], [1, "botble-cookie-consent", 2, "", 22, [391], [{ e: 392 }], [{ v: 393 }], [{ retry: 5, retryInterval: 500, c: 393 }], [{ check: "none", v: 393 }], {}], [1, "bouvet-cookiepanel", 2, "", 22, [394], [{ e: 394 }], [{ v: 394 }], [{ c: 395 }], [{ cc: 396 }], {}], [1, "boxprivacy", 2, "", 22, [397], [{ e: 398 }], [{ v: 397 }], [{ c: 398 }], [{ check: "none", timeout: 1e3, wv: 397 }], {}], [1, "brainsum-cookieconsent", 2, "", 22, [399], [{ e: 400 }], [{ v: 401 }], [{ if: { v: 402 }, then: [{ k: 402 }], else: [{ k: 403 }, { wv: 404 }, { all: true, optional: true, k: 405 }, { all: true, optional: true, k: 406 }, { k: 404 }] }], [{ check: "none", wv: 401 }, { cc: 186 }], {}], [1, "bristan-group", 2, "", 22, [407], [{ e: 408 }, { e: 409 }], [{ v: 410 }], [{ c: 409 }, { check: "none", timeout: 1e3, optional: true, wv: 411 }, { if: { e: 411 }, then: [{ c: 412 }, { c: 413 }] }, { check: "none", wv: 411 }], [{ check: "none", v: 411 }], {}], [1, "bsgdprcookies", 2, "", 22, [414], [{ e: 415 }], [{ v: 416 }], [{ c: 415 }, { wv: 417 }, { all: true, optional: true, k: 418 }, { k: 416 }, { check: "none", timeout: 2e3, optional: true, wv: 414 }], [{ cc: 419 }], {}], [1, "bullionbypost", 2, "", 22, [], [{ e: 420 }, { e: 421 }], [{ v: 420 }], [{ if: { e: 422 }, then: [{ k: 423 }] }, { c: 424 }, { if: { e: 425 }, then: [{ wait: 1e3 }, { k: 424 }] }, { if: { e: 425 }, then: [{ wait: 1e3 }, { k: 424 }] }, { if: { e: 425 }, then: [{ wait: 1e3 }, { k: 424 }] }, { if: { e: 425 }, then: [{ wait: 1e3 }, { k: 424 }] }, { if: { e: 425 }, then: [{ wait: 1e3 }, { k: 424 }] }], [{ cc: 426 }, { cc: 427 }], {}], [1, "bundesarchiv-cookiebanner", 2, "", 22, [428, 429], [{ e: 430 }], [{ v: 430 }], [{ if: { e: 431 }, then: [{ all: true, k: 432 }] }, { c: 430 }], [{ timeout: 2e3, check: "none", wv: 430 }], {}], [1, "bundesregierung.de", 2, "", 22, [433], [{ e: 433 }], [{ v: 434 }], [{ wait: 500 }, { c: 435 }], [{ cc: 436 }], {}], [2, "burpee.com", 2, "", 22, [437, 438], [{ e: 438 }, { negated: true, e: 439 }, { any: [{ v: 438 }, { negated: true, cc: 440 }] }], [{ v: 441 }], [{ if: { e: 442 }, then: [{ c: 442 }], else: [{ if: { e: 443 }, then: [{ c: 443 }], else: [{ if: { e: 444 }, then: [{ c: 444 }, { all: true, k: 445 }, { k: 446 }], else: [{ h: 447 }, { removeClass: "cookie-notification-active", selector: "body", optional: true }] }] }] }], [], {}], [1, "bwr-cookie", 2, "", 22, [448], [{ e: 449 }], [{ v: 450 }], [{ all: true, optional: true, k: 451 }, { c: 449 }, { check: "none", timeout: 2e3, optional: true, wv: 448 }], [{ cc: 452 }], {}], [1, "bynder", 2, "", 22, [453], [{ e: 454 }], [{ v: 454 }], [{ c: 454 }], [{ cc: 455 }, { cc: 456 }], {}], [1, "bzga-matomo", 2, "", 22, [457], [{ e: 458 }], [{ v: 458 }], [{ c: 458 }], [{ timeout: 2e3, check: "none", wv: 458 }], {}], [1, "c-banner-allow-cookies", 0, "", 10, [459], [{ e: 460 }], [{ v: 459 }], [{ c: 460 }, { check: "none", wv: 459 }], [{ cc: 461 }], {}], [1, "c-cookie-message", 1, "", 22, [462], [{ e: 463 }], [{ v: 463 }], [{ h: 462 }], [], {}], [1, "c-cookies-submit", 1, "", 22, [464], [{ e: 465 }], [{ v: 464 }], [{ h: 464 }], [], {}], [1, "c15t", 0, "", 22, [466], [{ e: 467 }], [{ v: 467 }], [{ if: { e: 468 }, then: [{ k: 468 }], else: [{ k: 469 }, { timeout: 2e3, wv: 470 }, { all: true, optional: true, k: 471 }, { k: 470 }] }], [{ any: [{ cc: 472 }, { cc: 473 }] }, { negated: true, cc: 474 }, { negated: true, cc: 475 }], {}], [1, "captain-compliance", 2, "", 22, [476], [{ exists: [".captain-compliance-modal-container", "#cc-modal-cookies-banner"] }], [{ visible: [".captain-compliance-modal-container", "#cc-modal-cookies-banner"] }], [{ waitForThenClick: [".captain-compliance-modal-container", "#cc-modal-reject-all"] }], [{ cc: 477 }], {}], [1, "carlsberg-group", 2, "", 22, [478], [{ e: 478 }], [{ v: 479 }], [{ c: 479 }], [{ cc: 480 }], {}], [1, "casasrurales", 0, "", 22, [481], [{ e: 482 }], [{ v: 483 }], [{ c: 482 }, { c: 484 }, { check: "none", timeout: 3e3, optional: true, wv: 481 }], [{ cc: 485 }], {}], [1, "casino-guru", 1, "", 22, [486], [{ e: 487 }], [{ v: 488 }], [{ h: 486 }], [], {}], [1, "cassie", 0, "", 10, [489], [{ e: 490 }], [{ v: 491 }], [{ c: 492 }], [], {}], [1, "cc_banner", 1, "", 22, [493], [{ e: 493 }], [{ v: 494 }], [{ h: 493 }], [], {}], [1, "cc-banner-springer", 2, "", 22, [495], [{ e: 495 }], [{ v: 495 }], [{ if: { e: 496 }, then: [{ k: 496 }], else: [{ c: 497 }, { w: 498 }, { all: true, optional: true, k: 499 }, { if: { e: 500 }, then: [{ k: 500 }], else: [{ k: 501 }] }] }], [{ eval: "EVAL_CC_BANNER2_0" }], {}], [1, "ccconsent-holder", 2, "", 22, [502], [{ e: 503 }], [{ v: 504 }], [{ if: { v: 505 }, then: [{ k: 505 }], else: [{ c: 506 }] }, { wv: 507 }, { all: true, optional: true, k: 508 }, { k: 507 }], [{ wait: 1e3 }, { cc: 509 }], {}], [1, "ccm-dialog", 2, "", 22, [510], [{ e: 511 }], [{ v: 512 }], [{ if: { e: 513 }, then: [{ all: true, k: 513 }] }, { retry: 10, retryInterval: 500, c: 511 }], [{ cc: 514 }, { negated: true, cc: 515 }], {}], [1, "ccm19", 2, "", 22, [516], [{ any: [{ e: 517 }, { e: 518 }] }], [{ v: 516 }], [{ if: { e: 519 }, then: [{ c: 519 }], else: [{ c: 520 }, { c: 521 }] }], [{ timeout: 2e3, check: "none", wv: 516 }], {}], [1, "ccoo", 2, "", 22, [522], [{ e: 523 }], [{ v: 524 }], [{ c: 525 }, { wv: 526 }, { all: true, optional: true, k: 527 }, { c: 523 }], [{ cc: 528 }], {}], [1, "ceneo", 2, "", 22, [529], [{ e: 530 }], [{ v: 530 }], [{ c: 530 }], [{ timeout: 1e3, check: "none", wv: 529 }], {}], [1, "cerezgo", 2, "", 22, [531, 532], [{ any: [{ e: 533 }, { exists: ["cerezgo-app", "dialog.cerezgo-consent-dialog"] }] }], [{ any: [{ v: 533 }, { visible: ["cerezgo-app", "dialog.cerezgo-consent-dialog"] }] }], [{ if: { exists: ["cerezgo-app", "dialog.cerezgo-consent-dialog"] }, then: [{ waitForThenClick: ["cerezgo-app", "dialog.cerezgo-consent-dialog button[value=reject], dialog.cerezgo-consent-dialog .cerezgo-reject-consent-trigger, dialog.cerezgo-consent-dialog .nesil-link-reject"] }], else: [{ c: 534 }] }], [{ waitForVisible: [".nesil-component-banner .nesil-banner"], check: "none", timeout: 2e3 }, { waitForVisible: ["cerezgo-app", "dialog.cerezgo-consent-dialog"], check: "none", timeout: 2e3 }], {}], [1, "cf-gdpr-cookie-consent", 2, "", 22, [535], [{ e: 536 }], [{ v: 536 }], [{ c: 536 }, { wv: 537 }, { if: { e: 538 }, then: [{ all: true, k: 538 }] }, { k: 537 }, { check: "none", wv: 535 }], [{ cc: 539 }, { cc: 540 }, { cc: 541 }], {}], [1, "cgov-cookiebanner", 2, "", 22, [542], [{ e: 543 }], [{ v: 542 }], [{ c: 543 }], [{ check: "none", timeout: 2e3, wv: 542 }], {}], [1, "check24", 2, "", 22, [544], [{ e: 545 }], [{ v: 546 }], [{ c: 545 }], [{ check: "none", v: 544 }], {}], [1, "check24-partnerprogramm-de", 2, "", 22, [547], [{ e: 548 }], [{ check: "any", v: 548 }], [{ c: 549 }], [], {}], [1, "chefcookie", 2, "", 22, [550], [{ e: 551 }], [{ v: 552 }], [{ c: 553 }], [{ cc: 554 }], {}], [1, "ciaopeople.it", 2, "", 22, [555], [{ e: 556 }], [{ v: 557 }], [{ c: 558 }], [{ check: "none", timeout: 5e3, wv: 557 }], {}], [1, "cinemaplus", 2, "", 22, [559], [{ e: 560 }], [{ v: 560 }], [{ c: 560 }], [{ check: "none", v: 560 }], {}], [1, "civic-cookie-control", 2, "", 22, [561], [{ e: 562 }], [{ v: 563 }, { v: 562 }], [{ if: { v: 564 }, then: [{ c: 564 }], else: [{ if: { e: 565 }, then: [{ c: 565 }, { wv: 566 }] }, { if: { v: 564 }, then: [{ c: 564 }], else: [{ if: { e: 567 }, then: [{ c: 567 }], else: [{ c: 568 }] }] }] }], [], {}], [1, "civic-govuk-cookiecontrol", 2, "", 22, [569], [{ e: 570 }], [{ v: 570 }], [{ c: 570 }, { timeout: 2e3, optional: true, c: 571 }], [{ check: "none", v: 572 }], {}], [1, "ckies", 2, "", 22, [573], [{ e: 574 }], [{ v: 573 }], [{ c: 574 }], [{ cc: 575 }], {}], [1, "cksmodal", 2, "", 22, [576], [{ e: 577 }], [{ v: 578 }], [{ c: 579 }, { check: "none", wv: 576 }], [{ cc: 580 }], {}], [1, "click.io", 2, "", 22, [581], [{ e: 581 }], [{ v: 581 }], [{ w: 582 }, { wait: 500 }, { k: 582 }, { w: 583 }, { all: true, k: 583 }, { k: 584 }], [{ cc: 585 }], {}], [1, "clinch", 2, "", 10, [586], [{ e: 587 }], [{ v: 586 }], [{ if: { e: 588 }, then: [{ k: 588 }], else: [{ k: 589 }, { all: true, optional: true, k: 590 }, { k: 591 }] }], [{ cc: 592 }], { intermediate: false }], [1, "clio-online-matomo", 2, "", 22, [], [{ e: 593 }], [{ v: 593 }], [{ c: 593 }], [{ cc: 594 }], {}], [1, "close-cookie-notice-snippet", 1, "", 22, [595], [{ e: 596 }], [{ v: 595 }], [{ h: 595 }], [], {}], [1, "cloudcms-cookie-alert", 2, "", 22, [597], [{ e: 598 }], [{ v: 599 }], [{ c: 600 }, { all: true, optional: true, k: 601 }, { c: 602 }], [{ cc: 603 }], {}], [1, "cloudcms-cookie-alert-notice", 1, "", 22, [597], [{ e: 604 }, { negated: true, e: 602 }], [{ v: 599 }], [{ h: 597 }], [], {}], [1, "cloudflare-zaraz", 2, "", 22, [605], [{ exists: [".cf_modal_container", ".cf_consent-buttons"] }], [{ visible: [".cf_modal_container", ".cf_consent-buttons"] }], [{ waitForThenClick: [".cf_modal_container", ".cf_consent-buttons #cf_consent-buttons__reject-all"] }], [], {}], [1, "cm-cookie-manager", 2, "", 22, [606, 607], [{ e: 608 }, { e: 609 }], [{ v: 609 }], [{ if: { v: 610 }, then: [{ k: 610 }] }, { wv: 608 }, { if: { e: 611 }, then: [{ all: true, k: 611 }] }, { k: 608 }], [{ check: "none", v: 609 }], {}], [1, "cmsbox", 2, "", 22, [], [{ e: 612 }], [{ v: 612 }], [{ c: 612 }], [{ timeout: 2e3, check: "none", wv: 613 }], {}], [1, "codalt-cookie-consent", 2, "", 22, [614], [{ e: 615 }], [{ v: 616 }], [{ c: 617 }], [], {}], [1, "code3-cookies-consent", 2, "", 22, [618], [{ e: 618 }, { e: 619 }], [{ v: 618 }], [{ if: { v: 620 }, then: [{ k: 620 }], else: [{ k: 621 }] }], [{ cc: 622 }, { cc: 623 }], {}], [1, "coki61", 2, "", 22, [], [{ e: 624 }], [{ v: 625 }], [{ c: 624 }], [{ cc: 626 }], {}], [1, "columbia-privacy-notice", 1, "", 22, [627], [{ e: 628 }], [{ v: 627 }], [{ h: 627 }], [{ check: "none", v: 627 }], {}], [1, "com-consent-layer", 2, "", 22, [629], [{ exists: ["com-consent-layer", "dialog"] }], [{ visible: ["com-consent-layer", "dialog[open]"] }], [{ waitForThenClick: ["com-consent-layer", "#cmpDenyAll"] }], [{ waitForVisible: ["com-consent-layer", "dialog[open]"], timeout: 1e3, check: "none" }], {}], [1, "Complianz banner", 2, "", 22, [630], [{ e: 631 }], [{ check: "any", v: 631 }], [{ c: 632 }], [{ cc: 633 }], {}], [1, "Complianz categories", 2, "", 22, [634], [{ e: 634 }], [{ v: 634 }], [{ if: { e: 635 }, then: [{ k: 636 }], else: [{ all: true, optional: true, k: 637 }, { k: 638 }] }], [], {}], [1, "Complianz notice", 1, "", 22, [639], [{ e: 640 }], [{ check: "any", v: 641 }], [{ if: { e: 642 }, then: [{ k: 642 }], else: [{ h: 643 }, { optional: true, h: 644 }] }], [], {}], [1, "Complianz opt-out", 2, "", 22, [645], [{ e: 645 }], [{ v: 645 }], [{ timeout: 2e3, optional: true, w: 646 }, { if: { e: 642 }, then: [{ k: 642 }], else: [{ if: { e: 647 }, then: [{ k: 647 }, { wv: 648 }, { optional: true, k: 649 }, { k: 648 }] }] }], [], {}], [1, "Complianz optin", 2, "", 22, [650], [{ e: 650 }], [{ v: 651 }], [{ if: { v: 642 }, then: [{ k: 642 }], else: [{ if: { v: 652 }, then: [{ c: 652 }, { wv: 653 }, { all: true, optional: true, k: 654 }, { k: 655 }], else: [{ if: { e: 636 }, then: [{ k: 636 }], else: [{ k: 647 }, { c: 649 }, { c: 648 }] }] }] }, { optional: true, h: 656 }], [], {}], [1, "compricer", 2, "", 22, [657, 658], [{ e: 659 }, { e: 660 }], [{ v: 661 }], [{ c: 661 }, { wv: 659 }, { all: true, optional: true, k: 662 }, { k: 659 }, { check: "none", optional: true, wv: 659 }], [{ check: "none", timeout: 2e3, wv: 661 }, { negated: true, e: 662 }], {}], [1, "comundus-cookie-banner", 2, "", 22, [663], [{ e: 664 }], [{ v: 663 }], [{ if: { v: 665 }, then: [{ k: 665 }, { timeout: 2e3, wv: 666 }] }, { all: true, optional: true, k: 667 }, { c: 666 }], [], {}], [1, "concept3d", 2, "", 22, [668], [{ e: 669 }], [{ v: 669 }], [{ c: 669 }, { wv: 670 }, { all: true, optional: true, k: 671 }, { c: 670 }], [{ cc: 672 }], {}], [1, "conextra", 2, "", 22, [673, 674], [{ e: 675 }], [{ v: 675 }], [{ if: { e: 676 }, then: [{ c: 676 }], else: [{ all: true, optional: true, k: 677 }, { c: 678 }] }], [{ timeout: 1e3, check: "none", wv: 675 }], {}], [1, "conscious-solutions", 2, "", 22, [679], [{ e: 679 }], [{ v: 679 }], [{ if: { e: 680 }, then: [{ c: 680 }], else: [{ c: 681 }, { c: 682 }] }], [{ cc: 683 }], {}], [1, "consent-backdrop", 2, "", 22, [684], [{ e: 685 }], [{ v: 684 }], [{ all: true, optional: true, k: 686 }, { c: 687 }], [{ cc: 688 }], {}], [1, "consent-flo", 2, "", 22, [689], [{ e: 690 }], [{ v: 691 }], [{ if: { e: 692 }, then: [{ c: 692 }], else: [{ c: 693 }, { wv: 694 }, { all: true, optional: true, k: 695 }, { c: 694 }] }], [{ e: 696 }], {}], [1, "consent-studio", 0, "", 10, [697, 698], [{ e: 699 }], [{ v: 699 }], [{ if: { v: 700 }, then: [{ k: 700 }], else: [{ if: { check: "any", v: 701 }, then: [{ k: 701 }], else: [{ if: { e: 702 }, then: [{ all: true, k: 702 }] }, { c: 703 }] }] }, { check: "none", wv: 699 }], [{ wait: 500 }, { cc: 704 }], {}], [1, "consentaur", 2, "", 22, [705], [{ e: 705 }], [{ v: 706 }], [{ c: 706 }], [{ cc: 707 }], {}], [1, "consentik", 2, "", 22, [708], [{ e: 709 }], [{ v: 708 }], [{ if: { e: 710 }, then: [{ c: 710 }], else: [{ k: 711 }, { check: "any", wv: 712 }, { all: true, optional: true, k: 713 }, { k: 712 }] }], [{ cc: 714 }, { negated: true, cc: 715 }], {}], [1, "consentik-notice", 1, "", 22, [708], [{ e: 716 }], [{ v: 708 }], [{ h: 708 }, { optional: true, h: 717 }], [], {}], [1, "consentmagic", 0, "", 10, [], [{ v: 718 }], [{ v: 718 }], [{ if: { e: 719 }, then: [{ retry: 5, retryInterval: 500, c: 719 }], else: [{ c: 720 }, { wv: 721 }, { all: true, optional: true, k: 722 }, { c: 721 }] }], [{ cc: 723 }], {}], [1, "consentmanager-ncmp", 2, "", 22, [724], [{ e: 725 }], [{ check: "any", v: 725 }], [{ wait: 500 }, { eval: "EVAL_CONSENTMANAGER_NCMP_REJECT" }], [{ cc: 726 }], {}], [1, "consentmo", 2, "", 22, [727], [{ exists: ["csm-cookie-consent", ".csm-wrapper"] }], [{ visible: ["csm-cookie-consent", ".csm-wrapper button"] }], [{ if: { exists: ["csm-cookie-consent", ".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='reject']"] }, then: [{ waitForThenClick: ["csm-cookie-consent", ".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='reject']"] }], else: [{ if: { exists: ["csm-cookie-consent", ".csm-wrapper [data-csm-button-type='do_not_sell']"] }, then: [{ waitForThenClick: ["csm-cookie-consent", ".csm-wrapper [data-csm-button-type='do_not_sell']"] }, { waitForThenClick: ["csm-cookie-consent", ".csm-wrapper [data-csm-button-type='dismiss']"], timeout: 2e3, optional: true }], else: [{ waitForThenClick: ["csm-cookie-consent", ".csm-wrapper .cc-settings, .csm-wrapper [data-csm-button-type='preferences']"] }, { waitForVisible: ["csm-cookie-consent", ".csm-wrapper .cc-deny, .csm-wrapper [data-csm-button-type='accept_selected'], .csm-wrapper [data-preferences-csm-button-type='accept_selected']"] }, { if: { exists: ["csm-cookie-consent", ".csm-wrapper .cc-deny"] }, then: [{ click: ["csm-cookie-consent", ".csm-wrapper .cc-deny"] }], else: [{ click: ["csm-cookie-consent", ".csm-wrapper [data-csm-button-type='accept_selected'], .csm-wrapper [data-preferences-csm-button-type='accept_selected']"] }] }] }] }], [{ waitForVisible: ["csm-cookie-consent", ".csm-wrapper button"], timeout: 1e3, check: "none" }], {}], [1, "Cookie Information Banner", 2, "", 22, [728], [{ e: 728 }], [{ check: "any", v: 729 }], [{ eval: "EVAL_COOKIEINFORMATION_0" }, { wait: 1e3 }, { if: { v: 730 }, then: [{ h: 728 }] }], [{ cc: 731 }], {}], [1, "cookie-accordion-settings", 2, "", 22, [732], [{ e: 733 }, { e: 734 }], [{ v: 735 }], [{ c: 735 }, { wv: 733 }, { if: { v: 736 }, then: [{ k: 736 }], else: [{ all: true, optional: true, k: 737 }, { k: 733 }] }, { check: "none", timeout: 3e3, wv: 734 }], [], {}], [1, "cookie-agree-banner", 1, "", 22, [738], [{ e: 739 }], [{ v: 739 }], [{ h: 738 }], [], {}], [1, "cookie-banner-element", 2, "", 22, [740], [{ e: 740 }], [{ visible: ["cookie-banner-element#ckb", '#ckb[role="dialog"]'] }], [{ waitForThenClick: ["cookie-banner-element#ckb", "#ckn"] }], [], {}], [1, "cookie-banner-required-only", 0, "", 10, [741], [{ e: 742 }], [{ v: 741 }], [{ c: 742 }, { check: "none", wv: 741 }], [{ cc: 743 }, { cc: 744 }], {}], [1, "cookie-bar-eu", 2, "", 22, [745, 746], [{ e: 747 }, { e: 748 }], [{ v: 745 }], [{ if: { v: 749 }, then: [{ k: 749 }, { timeout: 2e3, optional: true, wv: 750 }] }, { if: { e: 751 }, then: [{ k: 752 }] }, { if: { e: 753 }, then: [{ k: 754 }] }, { k: 750 }], [{ cc: 755 }, { cc: 756 }], {}], [1, "cookie-bar-frame", 2, "", 22, [745], [{ e: 757 }], [{ v: 758 }], [{ c: 757 }], [{ cc: 759 }], {}], [1, "cookie-bar-preference", 2, "", 22, [760], [{ e: 761 }], [{ v: 761 }], [{ if: { e: 762 }, then: [{ c: 762 }], else: [{ all: true, optional: true, k: 763 }, { c: 764 }] }], [{ wait: 500 }, { check: "none", v: 761 }], {}], [1, "cookie-box-notice", 2, "", 22, [], [{ e: 765 }], [{ v: 765 }, { negated: true, e: 766 }], [{ c: 765 }], [{ any: [{ e: 766 }, { check: "none", timeout: 2e3, wv: 765 }] }], {}], [1, "cookie-button-basic", 2, "", 22, [767], [{ e: 768 }], [{ v: 769 }], [{ c: 768 }], [{ check: "none", timeout: 2e3, wv: 769 }], {}], [1, "cookie-consent-root", 2, "", 22, [770], [{ e: 771 }], [{ v: 770 }], [{ c: 772 }, { wv: 773 }, { if: { e: 774 }, then: [{ k: 775 }] }, { if: { e: 776 }, then: [{ k: 777 }] }, { k: 773 }], [{ cc: 778 }], {}], [1, "cookie-consent-save-settings", 2, "", 22, [779], [{ e: 780 }], [{ v: 781 }], [{ c: 782 }, { wv: 783 }, { if: { e: 784 }, then: [{ all: true, k: 784 }] }, { k: 783 }], [{ cc: 785 }, { check: "none", v: 786 }], {}], [1, "cookie-consent-spice", 0, "", 10, [787, 788], [{ e: 788 }], [{ v: 788 }], [{ c: 789 }], [], {}], [1, "cookie-disclaimer-close", 2, "", 22, [790], [{ e: 791 }], [{ v: 791 }], [{ c: 791 }, { check: "none", timeout: 2e3, wv: 792 }], [{ check: "none", v: 792 }], {}], [1, "cookie-info-banner", 2, "", 22, [793], [{ e: 794 }], [{ v: 795 }], [{ c: 794 }], [{ cc: 796 }, { negated: true, cc: 797 }], {}], [1, "cookie-law-info", 2, "", 22, [798], [{ e: 799 }, { eval: "EVAL_COOKIE_LAW_INFO_DETECT" }], [{ v: 799 }], [{ h: 798 }, { eval: "EVAL_COOKIE_LAW_INFO_0" }], [{ negated: true, cc: 800 }], {}], [1, "cookie-note-cosmetic", 1, "", 22, [801], [{ e: 802 }, { negated: true, e: 803 }], [{ v: 801 }], [{ h: 801 }], [{ check: "none", v: 801 }], {}], [1, "cookie-notice-checkboxes", 2, "", 22, [804], [{ e: 805 }], [{ v: 805 }], [{ if: { e: 806 }, then: [{ c: 806 }], else: [{ if: { e: 807 }, then: [{ all: true, k: 807 }] }, { c: 808 }] }], [{ check: "none", v: 808 }], {}], [1, "cookie-notice-container", 1, "", 22, [809], [{ e: 810 }], [{ v: 811 }], [{ h: 809 }], [], {}], [1, "cookie-popup-close-cookies", 2, "", 22, [812], [{ e: 813 }, { e: 814 }], [{ e: 815 }], [{ eval: "EVAL_COOKIE_POPUP_CLOSE" }, { timeout: 2e3, w: 816 }], [{ negated: true, cc: 817 }], {}], [1, "cookie-popup-cookieno", 2, "", 22, [818], [{ e: 819 }], [{ v: 812 }], [{ c: 819 }, { check: "none", timeout: 3e3, wv: 812 }], [], {}], [1, "cookie-popup-cookieok", 1, "", 22, [820], [{ e: 821 }], [{ v: 812 }], [{ h: 812 }], [], {}], [1, "cookie-pref-form", 2, "", 22, [822], [{ e: 823 }], [{ v: 822 }], [{ if: { e: 824 }, then: [{ c: 824 }], else: [{ c: 825 }, { wv: 826 }, { all: true, optional: true, k: 827 }, { c: 826 }] }], [], {}], [1, "cookie-script", 2, "", 22, [828, 829], [{ e: 830 }], [{ v: 831 }], [{ if: { e: 832 }, then: [{ wait: 100 }, { k: 832 }], else: [{ if: { e: 833 }, then: [{ k: 833 }, { timeout: 3e3, optional: true, wv: 834 }, { if: { e: 835 }, then: [{ c: 832 }], else: [{ if: { v: 836 }, then: [{ if: { e: 837 }, then: [{ all: true, k: 837 }] }, { retry: 6, retryInterval: 1e3, c: 836 }], else: [{ k: 838 }] }] }], else: [{ if: { e: 836 }, then: [{ all: true, optional: true, k: 837 }, { k: 836 }], else: [{ k: 838 }] }] }] }], [], {}], [1, "cookie-use-notice", 2, "", 22, [839], [{ e: 840 }], [{ v: 840 }], [{ c: 840 }, { check: "none", timeout: 2e3, wv: 839 }], [{ cc: 841 }], {}], [1, "cookieacceptbar", 1, "", 22, [842], [{ e: 842 }], [{ v: 842 }], [{ h: 842 }], [], {}], [1, "cookiebanner-closecookie", 2, "", 22, [], [{ e: 843 }], [{ v: 843 }], [{ c: 843 }], [{ cc: 844 }], {}], [1, "cookiebar-occ", 2, "", 22, [845], [{ e: 846 }], [{ v: 845 }], [{ c: 846 }], [{ cc: 847 }], {}], [1, "cookiebot.be", 2, "", 22, [848], [{ e: 849 }], [{ v: 848 }], [{ c: 849 }], [{ cc: 850 }], {}], [1, "cookiecode", 2, "", 22, [851], [{ any: [{ e: 852 }, { e: 851 }] }], [{ visible: ["cookiecode-banner", ".cc_root > div"] }], [{ waitForThenClick: ["cookiecode-banner", ".cc_button_rejectall"] }, { waitForVisible: ["cookiecode-banner", ".cc_root > div"], check: "none", timeout: 2e3 }], [{ visible: ["cookiecode-banner", ".cc_root > div"], check: "none" }], {}], [1, "cookieconsent2", 2, "", 22, [853, 854], [{ e: 855 }, { e: 856 }], [{ e: 857 }, { e: 858 }], [{ if: { e: 859 }, then: [{ c: 859 }], else: [{ c: 860 }, { wait: 500 }, { all: true, optional: true, k: 861 }, { c: 862 }] }], [{ cc: 863 }], {}], [1, "cookieconsent2-legacy", 2, "", 22, [864], [{ e: 865 }], [{ e: 866 }], [{ c: 867 }, { timeout: 1e3, optional: true, w: 868 }, { if: { e: 868 }, then: [{ all: true, optional: true, k: 869 }, { c: 870 }] }], [{ any: [{ cc: 863 }, { cc: 871 }] }], {}], [1, "cookieconsent3", 2, "", 22, [872], [{ e: 873 }], [{ v: 873 }], [{ if: { e: 874 }, then: [{ c: 874 }], else: [{ c: 875 }, { w: 876 }, { if: { e: 877 }, then: [{ k: 877 }], else: [{ all: true, optional: true, k: 878 }, { c: 879 }] }] }], [{ cc: 863 }], {}], [1, "cookiecuttr", 0, "", 10, [880], [{ e: 881 }], [{ check: "any", v: 882 }], [{ if: { e: 883 }, then: [{ k: 883 }], else: [{ h: 880 }] }], [], {}], [1, "cookiefirst.com", 2, "", 22, [884], [{ e: 885 }], [{ check: "any", v: 886 }], [{ if: { e: 887 }, then: [{ k: 887 }], else: [{ if: { e: 888 }, then: [{ timeout: 5e3, wv: 888 }, { k: 888 }, { wait: 1500 }], else: [{ if: { e: 889 }, then: [{ k: 889 }, { timeout: 1e3, wv: 890 }, { eval: "EVAL_COOKIEFIRST_1" }, { wait: 1e3 }, { k: 891 }], else: [{ k: 887 }] }] }] }], [{ eval: "EVAL_COOKIEFIRST_0" }], {}], [1, "cookiefooter-tocookiesave", 2, "", 22, [892], [{ e: 893 }], [{ v: 892 }], [{ c: 893 }, { wv: 894 }, { all: true, optional: true, k: 895 }, { c: 896 }], [], {}], [1, "cookiehub", 2, "", 22, [897], [{ e: 898 }], [{ v: 898 }], [{ if: { e: 899 }, then: [{ k: 899 }, { wv: 900 }, { if: { e: 901 }, then: [{ k: 901 }], else: [{ all: true, optional: true, k: 902 }, { k: 903 }] }], else: [{ h: 897 }] }], [{ cc: 904 }], {}], [1, "cookieinfo", 1, "", 22, [905], [{ e: 906 }], [{ v: 905 }], [{ c: 907 }], [], {}], [1, "cookieinfo-zamknij", 2, "", 22, [908], [{ e: 909 }], [{ v: 909 }], [{ c: 909 }], [{ cc: 910 }], {}], [1, "cookiejs-banner", 2, "", 22, [911], [{ e: 912 }], [{ v: 913 }], [{ c: 914 }], [{ cc: 915 }], {}], [1, "cookiejs-modal", 2, "", 22, [911], [{ e: 916 }], [{ v: 917 }], [{ c: 918 }], [{ cc: 919 }], {}], [1, "cookielegit", 2, "", 22, [920], [{ e: 920 }], [{ v: 921 }], [{ if: { e: 922 }, then: [{ c: 922 }], else: [{ c: 923 }, { wv: 924 }, { optional: true, k: 925 }, { optional: true, k: 926 }, { k: 924 }] }], [{ cc: 927 }, { cc: 928 }], {}], [1, "cookieman", 2, "", 10, [929], [{ e: 930 }], [{ check: "any", v: 930 }], [{ if: { e: 931 }, then: [{ retry: 3, retryInterval: 500, c: 931 }], else: [{ if: { check: "any", v: 932 }, then: [{ retry: 3, retryInterval: 500, c: 932 }], else: [{ if: { check: "none", v: 933 }, then: [{ c: 934 }] }, { timeout: 2e3, optional: true, wv: 933 }, { all: true, optional: true, k: 935 }, { retry: 3, retryInterval: 500, c: 936 }] }] }], [{ cc: 937 }, { timeout: 2e3, check: "none", wv: 930 }], {}], [1, "cookieofficer", 2, "", 22, [938], [{ e: 938 }], [{ visible: ["[data-co-banner]", ".co-btns"] }], [{ if: { exists: ["[data-co-banner]", ".co-btns button[data-co-action='reject']"] }, then: [{ click: ["[data-co-banner]", ".co-btns button[data-co-action='reject']"] }], else: [{ if: { exists: ["[data-co-banner]", ".co-switch"] }, then: [{ click: ["[data-co-banner]", ".co-btns button[data-co-action='manage']"] }], else: [{ click: ["[data-co-banner]", ".co-btns button[data-co-action='manage']"] }, { waitFor: ["[data-co-banner]", ".co-switch"], timeout: 2e3 }, { click: ["[data-co-banner]", ".co-btns button[data-co-action='manage']"] }] }] }], [{ cc: 939 }, { negated: true, cc: 940 }, { negated: true, cc: 941 }, { negated: true, cc: 942 }], {}], [1, "cookiepermission-cp-overlay", 0, "", 10, [943], [{ e: 944 }], [{ v: 943 }], [{ c: 944 }, { check: "none", wv: 943 }], [{ cc: 945 }], {}], [1, "cookieprompter", 0, "", 10, [946], [{ e: 946 }], [{ v: 946 }], [{ if: { e: 947 }, then: [{ k: 947 }], else: [{ c: 948 }] }, { check: "none", wv: 946 }], [{ cc: 949 }], {}], [1, "cookiereports", 2, "", 22, [950, 951], [{ e: 952 }], [{ v: 950 }], [{ eval: "EVAL_COOKIEREPORTS_OPT_OUT" }], [{ eval: "EVAL_COOKIEREPORTS_TEST" }], {}], [1, "cookies-and-content-security-policy", 2, "", 22, [953, 954], [{ e: 955 }], [{ v: 956 }], [{ if: { e: 957 }, then: [{ c: 957 }], else: [{ c: 958 }, { c: 959 }] }], [{ cc: 960 }], {}], [1, "cookies-info", 2, "", 22, [78], [{ e: 79 }], [{ check: "any", v: 79 }], [{ c: 79 }, { check: "none", timeout: 5e3, wv: 79 }], [], {}], [1, "cookies-notification-progress", 2, "", 22, [961], [{ e: 962 }], [{ v: 963 }], [{ c: 964 }], [{ cc: 965 }], {}], [1, "cookies-tip-v1", 2, "", 22, [966], [{ e: 967 }], [{ v: 966 }], [{ c: 967 }], [{ timeout: 1e3, check: "none", wv: 966 }], {}], [1, "cookiesbanner-preference", 2, "", 22, [968], [{ e: 969 }], [{ v: 970 }], [{ c: 971 }, { wv: 972 }, { all: true, optional: true, k: 973 }, { c: 974 }], [{ w: 975 }, { cc: 976 }], {}], [1, "cookiesck", 2, "", 22, [977, 978], [{ e: 979 }], [{ v: 977 }], [{ c: 980 }], [{ check: "none", v: 977 }], {}], [1, "cookiesinfo-closecookies", 2, "", 22, [], [{ e: 981 }], [{ v: 981 }], [{ c: 981 }], [{ check: "none", timeout: 2e3, wv: 982 }], {}], [1, "cookiesjsr", 2, "", 22, [983, 984], [{ e: 985 }], [{ v: 986 }], [{ if: { v: 987 }, then: [{ k: 987 }], else: [{ c: 988 }, { wv: 989 }, { if: { v: 990 }, then: [{ k: 990 }], else: [{ all: true, optional: true, k: 991 }, { c: 992 }] }] }, { timeout: 2e3, check: "none", wv: 986 }], [], {}], [1, "cookiesmodal-pl", 2, "", 22, [], [{ e: 993 }, { e: 994 }], [{ v: 995 }], [{ if: { e: 996 }, then: [{ k: 994 }] }, { retry: 3, retryInterval: 600, c: 997 }], [{ cc: 998 }, { negated: true, cc: 999 }], {}], [1, "cookiesplus", 2, "", 22, [1e3, 1001], [{ e: 1002 }], [{ v: 1003 }], [{ if: { check: "any", v: 1004 }, then: [{ k: 1004 }], else: [{ k: 1005 }, { c: 1006 }] }, { check: "none", timeout: 5e3, wv: 1003 }], [{ cc: 1007 }], {}], [1, "cookietractor", 2, "", 22, [1008], [{ e: 1009 }], [{ v: 1009 }], [{ all: true, optional: true, k: 1010 }, { c: 1011 }], [{ timeout: 1e3, check: "none", wv: 1009 }], {}], [1, "cookieyes", 2, "", 22, [1012], [{ e: 1013 }], [{ v: 1013 }], [{ if: { e: 1014 }, then: [{ c: 1014 }], else: [{ if: { e: 1015 }, then: [{ c: 1015 }, { w: 1016 }, { all: true, optional: true, k: 1017 }, { c: 1018 }, { optional: true, wv: 1019 }, { optional: true, c: 1020 }], else: [{ if: { e: 1021 }, then: [{ k: 1021 }, { w: 1022 }, { all: true, optional: true, k: 1023 }, { c: 1024 }], else: [{ h: 1025 }] }] }] }], [{ cc: 1026 }], {}], [1, "cookieyes-legacy", 2, "", 22, [1027], [{ e: 1027 }], [{ v: 1027 }], [{ if: { v: 1028 }, then: [{ c: 1028 }], else: [{ if: { e: 1029 }, then: [{ c: 1029 }, { wv: 1030 }, { all: true, optional: true, k: 1031 }, { k: 1030 }], else: [{ h: 1027 }] }] }], [{ cc: 1032 }, { any: [{ cc: 1033 }, { cc: 1034 }] }], {}], [1, "cookiez", 2, "", 22, [1035], [{ e: 1036 }], [{ v: 1037 }], [{ c: 1037 }], [{ wait: 1e3 }, { cc: 1038 }], {}], [1, "coolblue", 0, "", 10, [1039], [{ e: 1040 }], [{ v: 1041 }], [{ c: 1042 }], [], {}], [1, "cornerstone-brands", 2, "", 22, [1043, 1044], [{ any: [{ e: 1045 }, { e: 1046 }] }], [{ any: [{ v: 1043 }, { v: 1044 }] }], [{ timeout: 5e3, optional: true, c: 1045 }, { timeout: 6e3, optional: true, c: 1046 }], [{ check: "none", timeout: 2e3, wv: 1047 }], {}], [1, "corona-in-zahlen.de", 2, "", 22, [1048], [{ e: 1048 }], [{ v: 1048 }], [{ k: 1049 }, { k: 1050 }], [], {}], [1, "costco-travel", 2, "", 22, [], [{ e: 1051 }, { e: 1052 }], [{ v: 1053 }], [{ c: 1051 }, { wv: 1054 }, { all: true, optional: true, k: 1055 }, { all: true, optional: true, k: 1056 }, { k: 1054 }], [], {}], [1, "craft-cookie-consent", 2, "", 22, [1057], [{ e: 1058 }], [{ v: 1059 }], [{ all: true, optional: true, k: 1060 }, { if: { v: 1061 }, then: [{ retry: 10, retryInterval: 1e3, c: 1061 }], else: [{ if: { v: 1062 }, then: [{ k: 1062 }], else: [{ k: 1063 }, { wv: 1064 }, { if: { v: 1065 }, then: [{ k: 1065 }], else: [{ k: 1062 }] }] }] }], [{ w: 1066 }], {}], [1, "ct-ultimate-gdpr", 2, "", 22, [1067], [{ e: 1067 }], [{ timeout: 3e4, wv: 1067 }], [{ if: { v: 1068 }, then: [{ k: 1068 }], else: [{ if: { v: 1069 }, then: [{ k: 1069 }, { c: 1070 }, { k: 1071 }], else: [{ h: 1067 }] }] }], [{ wait: 500 }, { cc: 1072 }], {}], [1, "curseforge", 1, "", 22, [845], [{ e: 1073 }], [{ v: 1073 }], [{ h: 845 }], [], {}], [1, "cwarn", 1, "", 22, [1074], [{ e: 1075 }], [{ v: 1074 }], [{ h: 1074 }], [], {}], [1, "cwcis-panel", 2, "", 22, [1076], [{ e: 1077 }], [{ v: 1076 }], [{ c: 1078 }, { wv: 1079 }, { if: { e: 1080 }, then: [{ k: 1081 }] }, { k: 1082 }], [{ cc: 1083 }, { negated: true, cc: 1084 }], {}], [1, "cz-eshop-cookies-consent", 2, "", 22, [1085], [{ e: 1086 }], [{ v: 1087 }], [{ retry: 10, retryInterval: 500, c: 1086 }], [{ cc: 1088 }, { negated: true, cc: 1089 }], {}], [1, "dack365", 2, "", 22, [1090], [{ e: 1091 }], [{ v: 1092 }], [{ c: 1092 }, { c: 1093 }], [{ check: "none", timeout: 5e3, wv: 1094 }], {}], [1, "daikin", 2, "", 22, [1095], [{ e: 1096 }], [{ v: 1095 }], [{ c: 1096 }], [{ cc: 1097 }], {}], [1, "dailymotion-us", 1, "", 22, [1098], [{ e: 1099 }], [{ v: 1099 }], [{ h: 1099 }], [], {}], [1, "dandomain", 0, "", 22, [1100], [{ e: 1101 }], [{ v: 1100 }], [{ wait: 500 }, { all: true, optional: true, k: 1102 }, { c: 1101 }], [{ cc: 1103 }], {}], [1, "danskebank", 0, "", 10, [1104], [{ e: 1105 }], [{ v: 1106 }], [{ c: 1107 }, { check: "none", wv: 1106 }], [{ cc: 1108 }], {}], [1, "databay-cookieselect", 2, "", 22, [1109], [{ e: 1110 }], [{ v: 1109 }], [{ if: { e: 1111 }, then: [{ c: 1111 }], else: [{ all: true, optional: true, k: 1112 }, { c: 1113 }] }], [{ cc: 274 }], {}], [1, "datagrail", 2, "", 22, [1114], [{ e: 1114 }, { exists: [".dg-consent-banner", ".dg-app"] }], [{ v: 1114 }], [{ if: { exists: [".dg-consent-banner", "button.dg-button.reject_all, button.dg-button.accept_some"] }, then: [{ waitForThenClick: [".dg-consent-banner", "button.dg-button.reject_all, button.dg-button.accept_some"] }], else: [{ if: { exists: [".dg-consent-banner", ".dg-browser-signal-notice"] }, then: [{ if: { exists: [".dg-consent-banner", "button.dg-button.open_layer"] }, then: [{ waitForThenClick: [".dg-consent-banner", "button.dg-button.open_layer"] }, { waitForThenClick: [".dg-consent-banner", "button.dg-button.reject_all, button.dg-button.accept_some, button.dg-button.essential_only, button.dg-button.custom"] }], else: [{ waitForThenClick: [".dg-consent-banner", "button.dg-header-close"] }] }], else: [{ waitForThenClick: [".dg-consent-banner", "button.dg-button.open_layer"] }, { waitForThenClick: [".dg-consent-banner", "button.dg-button.reject_all, button.dg-button.accept_some, button.dg-button.essential_only"] }] }] }], [{ any: [{ cc: 1115 }, { exists: [".dg-consent-banner", ".dg-browser-signal-notice"] }] }], {}], [1, "datasign", 0, "", 22, [], [{ e: 1116 }], [{ visible: ["#datasign_cmp__host", "#datasign_cmp__cmp_summary"] }], [{ if: { exists: ["#datasign_cmp__host", "#datasign_cmp__cmp_content input[type=checkbox]:not([disabled])"] }, then: [{ waitForThenClick: ["#datasign_cmp__host", "#datasign_cmp__config-button, #datasign_cmp__cmp_summary [aria-controls=datasign_cmp__cmp_content]"] }, { waitForVisible: ["#datasign_cmp__host", "#datasign_cmp__cmp_content_apply-button"] }, { click: ["#datasign_cmp__host", "#datasign_cmp__cmp_content input[type=checkbox]:checked:not([disabled])"], all: true, optional: true }, { click: ["#datasign_cmp__host", "#datasign_cmp__cmp_content_apply-button"] }], else: [{ click: ["#datasign_cmp__host", "#datasign_cmp__cmp_summary .datasign__dialogCloseButton--index-module"] }] }], [{ waitForVisible: ["#datasign_cmp__host", "#datasign_cmp__cmp_summary"], check: "none", timeout: 3e3 }], {}], [1, "dating-whitelabel-nextjs", 2, "", 22, [], [{ e: 1117 }], [{ v: 1118 }], [{ c: 1119 }, { wv: 1120 }, { all: true, optional: true, k: 1121 }, { c: 1122 }], [{ cc: 1123 }], {}], [1, "de-volksbank", 2, "", 22, [], [{ any: [{ e: 1124 }, { e: 1125 }] }], [{ any: [{ e: 1126 }, { v: 1125 }] }], [{ if: { e: 1125 }, then: [{ c: 1125 }], else: [{ c: 1127 }] }], [{ cc: 1128 }], {}], [1, "derby-council", 0, "", 22, [], [{ e: 1129 }], [{ v: 1130 }], [{ c: 1129 }, { wv: 1131 }, { if: { e: 1132 }, then: [{ k: 1133 }] }, { k: 1131 }], [{ cc: 1134 }], {}], [1, "dfactory-cookie-notice", 2, "", 22, [1135], [{ e: 1136 }], [{ v: 1137 }], [{ if: { e: 1138 }, then: [{ c: 1138 }], else: [{ c: 1139 }] }, { check: "none", timeout: 1e3, optional: true, wv: 1140 }, { if: { v: 1140 }, then: [{ h: 1140 }] }], [{ cc: 1141 }], {}], [1, "didomi", 2, "", 22, [1142], [{ e: 1143 }], [{ check: "any", v: 1144 }, { negated: true, e: 1145 }], [{ if: { e: 1146 }, then: [{ c: 1146 }], else: [{ if: { e: 1147 }, then: [{ c: 1148 }, { c: 1149 }], else: [{ eval: "EVAL_DIDOMI_OPT_OUT" }] }] }], [{ eval: "EVAL_DIDOMI_TEST" }], {}], [1, "diffuse-cookie-notice", 2, "", 22, [1150], [{ e: 1151 }], [{ v: 1151 }], [{ if: { e: 1152 }, then: [{ k: 1152 }], else: [{ k: 1153 }, { wv: 1154 }, { all: true, optional: true, k: 1155 }, { c: 1156 }] }], [{ negated: true, cc: 1157 }], {}], [1, "dintel", 2, "", 22, [1158], [{ exists: ["dnt-cookies", ".dnt-cookies__footer"] }], [{ visible: ["dnt-cookies", ".dnt-cookies--is-open"] }], [{ waitForThenClick: ["dnt-cookies", ".dnt-cookies__footer dnt-button[type^=secondary]"] }, { waitForVisible: ["dnt-cookies", ".dnt-cookies--is-open"], check: "none", timeout: 2e3, optional: true }], [{ cc: 1159 }], {}], [1, "django-gdpr-cookie-consent", 2, "", 22, [1160, 1161], [{ e: 1162 }], [{ v: 1162 }], [{ if: { e: 1163 }, then: [{ c: 1163 }], else: [{ c: 1164 }, { c: 1165 }, { k: 1166 }] }, { check: "none", timeout: 1e4, wv: 1167 }], [{ cc: 1168 }], {}], [1, "dlibra", 2, "", 22, [], [{ e: 1169 }, { e: 1170 }], [{ v: 1170 }], [{ c: 1170 }], [{ cc: 1171 }], {}], [1, "dmgmedia", 2, "", 22, [1172], [{ e: 1173 }], [{ v: 1173 }], [{ c: 1174 }, { wv: 1175 }, { all: true, c: 1176 }, { waitForThenClick: ['[data-project="mol-fe-cmp"] [class*=footer]', "xpath///button[contains(., 'Save & Exit')]"] }], [], {}], [1, "dmgmedia-us", 2, "", 22, [1177], [{ e: 1178 }], [{ wv: 1178 }], [{ c: 1179 }, { wv: 1180 }, { c: 1181 }, { c: 1182 }], [], {}], [1, "dnb", 2, "", 22, [1183], [{ e: 1184 }], [{ v: 1184 }], [{ c: 1184 }], [{ cc: 1185 }], {}], [1, "dobarkod-cookiebanner", 2, "", 22, [1186], [{ e: 1187 }], [{ v: 1187 }], [{ c: 1187 }], [{ check: "none", timeout: 1e3, wv: 1187 }], {}], [1, "dpgmedia-nl", 2, "", 22, [1188], [{ e: 1188 }], [{ visible: ["#pg-dom-shadow-host", "#pg-modal"] }], [{ if: { visible: ["#pg-dom-shadow-host", "#pg-reject-btn"] }, then: [{ click: ["#pg-dom-shadow-host", "#pg-reject-btn"] }], else: [{ waitForThenClick: ["#pg-dom-shadow-host", "#pg-configure-btn"] }, { waitForThenClick: ["#pg-dom-shadow-host", "#pg-reject-btn"] }] }], [], {}], [1, "dreamlab-cmp", 2, "", 22, [1189], [{ e: 1190 }], [{ v: 1189 }], [{ c: 1191 }, { c: 1192 }], [{ cc: 1193 }], {}], [1, "drouot-rgpd", 2, "", 22, [1194, 1195], [{ e: 1196 }], [{ v: 1194 }], [{ c: 1197 }], [{ cc: 1198 }], {}], [1, "Drupal", 2, "", 22, [], [{ e: 1199 }], [{ v: 1199 }], [{ k: 1200 }], [], {}], [1, "duda-cookie-notification", 0, "", 10, [1201], [{ e: 1202 }], [{ v: 1203 }], [{ retry: 3, retryInterval: 500, c: 1204 }], [{ check: "none", v: 1205 }], { intermediate: false }], [1, "e-file", 2, "", 22, [1206], [{ e: 1207 }], [{ v: 1208 }], [{ c: 1208 }, { wv: 1207 }, { all: true, optional: true, k: 1209 }, { k: 1207 }], [{ cc: 1210 }, { cc: 1211 }], {}], [1, "e-grip", 2, "", 22, [], [{ e: 1212 }], [{ v: 1213 }], [{ if: { e: 1214 }, then: [{ c: 1214 }], else: [{ c: 1215 }, { timeout: 2e3, w: 1216 }, { if: { e: 1217 }, then: [{ k: 1218 }] }, { k: 1219 }] }], [{ cc: 1168 }, { negated: true, cc: 1220 }], {}], [1, "eagerly-tools-cookie", 2, "", 22, [1221, 1222], [{ e: 1221 }], [{ v: 1223 }], [{ all: true, optional: true, k: 1224 }, { c: 1225 }], [{ check: "none", wv: 1223 }], {}], [1, "easy-cookie-info", 1, "", 22, [1226], [{ e: 1226 }], [{ v: 1226 }], [{ h: 1226 }], [], {}], [1, "ecbeing", 1, "", 22, [1227], [{ e: 1228 }], [{ v: 894 }], [{ h: 894 }], [], {}], [1, "eccmm", 2, "", 22, [], [{ exists: ["#eccm-shadow-host", ".eccmm"] }], [{ visible: ["#eccm-shadow-host", ".eccmm-dialog.eccmm-visible"] }], [{ waitForThenClick: ["#eccm-shadow-host", ".eccmm-dialog .eccmm-deny-all-btn--footer"] }], [{ waitForVisible: ["#eccm-shadow-host", ".eccmm-dialog"], check: "none", timeout: 2e3 }], {}], [1, "econda-pp2", 0, "", 22, [1229, 1230], [{ e: 1231 }], [{ check: "any", v: 1232 }], [{ c: 1232 }], [{ cc: 1233 }], {}], [1, "educamadrid", 2, "", 22, [1234], [{ e: 1235 }], [{ v: 1236 }], [{ c: 1237 }, { c: 1238 }], [{ timeout: 3e3, w: 1239 }, { cc: 1240 }], {}], [1, "ee-consent-notice", 2, "", 22, [1241], [{ e: 1242 }], [{ v: 1243 }], [{ if: { e: 1244 }, then: [{ c: 1244 }], else: [{ eval: "EVAL_EE_CONSENT_DECLINE_0" }, { c: 1245 }] }], [], {}], [1, "egotec-cookie-bar", 1, "", 22, [1246], [{ e: 1247 }], [{ v: 1248 }], [{ h: 1246 }], [{ check: "none", v: 1248 }], {}], [1, "elsevier-pure", 2, "", 22, [1249], [{ e: 1250 }], [{ v: 1250 }], [{ c: 1251 }], [{ timeout: 1e3, check: "none", wv: 1250 }], {}], [1, "Ensighten", 2, "", 22, [1252, 1253], [{ any: [{ v: 1254 }, { v: 1255 }] }], [{ any: [{ v: 1254 }, { v: 1255 }] }], [{ wait: 500 }, { if: { v: 1254 }, then: [{ if: { check: "any", v: 1256 }, then: [{ c: 1256 }], else: [{ if: { check: "any", v: 1257 }, then: [{ c: 1257 }, { timeout: 1e3, w: 1255 }, { all: true, optional: true, k: 1258 }, { c: 1259 }], else: [{ if: { v: 1260 }, then: [{ k: 1260 }], else: [{ if: { e: 1256 }, then: [{ k: 1256 }], else: [{ if: { e: 1261 }, then: [{ k: 1261 }, { h: 1252 }], else: [{ c: 1260 }] }] }] }] }] }], else: [{ all: true, optional: true, k: 1258 }, { c: 1259 }] }], [], {}], [1, "enzuzo", 2, "", 22, [1262], [{ e: 1262 }], [{ v: 1262 }], [{ if: { v: 1263 }, then: [{ k: 1263 }], else: [{ k: 1264 }, { c: 1265 }] }], [{ wait: 500 }, { cc: 1266 }], {}], [1, "eon-nl-cookiewall", 2, "", 22, [], [{ e: 1267 }], [{ visible: ["wl-cookiewall crnt-dialog", "dialog"] }], [{ c: 1267 }], [{ cc: 1268 }], {}], [1, "epaas", 2, "", 22, [1269], [{ e: 1269 }], [{ visible: ["epaas-consent-drawer-shell", "section.consentDrawer"] }], [{ if: { exists: ["epaas-consent-drawer-shell", "button.reject-button"] }, then: [{ waitForThenClick: ["epaas-consent-drawer-shell", "button.reject-button"] }], else: [{ waitForThenClick: ["epaas-consent-drawer-shell", "button.personalize-button"] }, { waitFor: ["epaas-consent-drawer-shell", "epaas-policy-page-shell"] }, { waitFor: ["epaas-consent-drawer-shell", "epaas-policy-page-shell", "label[class*='category-header__switch']"], optional: true }, { click: ["epaas-consent-drawer-shell", "epaas-policy-page-shell", "label.category-header__switch--on input"], all: true, optional: true }, { waitFor: ["epaas-consent-drawer-shell", "section.consentDrawer.layered button.accept-button"] }, { if: { exists: ["epaas-consent-drawer-shell", "button.save-button"] }, then: [{ click: ["epaas-consent-drawer-shell", "button.save-button"] }], else: [{ waitFor: ["epaas-consent-drawer-shell", "epaas-policy-page-shell", "label.category-header__switch--off"] }, { click: ["epaas-consent-drawer-shell", "button.accept-button"] }] }] }], [{ cc: 1270 }], {}], [1, "erdee-media", 2, "", 22, [1271], [{ e: 1271 }], [{ v: 1272 }], [{ c: 1273 }], [], {}], [1, "ernesto", 2, "", 22, [1274], [{ e: 1275 }], [{ v: 1274 }], [{ c: 1275 }], [{ cc: 1276 }], {}], [1, "eset", 0, "", 22, [1277], [{ e: 1278 }], [{ v: 1278 }], [{ if: { v: 1279 }, then: [{ k: 1279 }], else: [{ k: 1280 }, { wv: 1281 }, { all: true, optional: true, k: 1282 }, { k: 1281 }] }], [{ wait: 2e3 }, { cc: 1283 }], {}], [1, "etracker", 2, "", 22, [1284, 1285], [{ e: 1286 }], [{ v: 1286 }], [{ c: 1286 }], [{ timeout: 3e3, check: "none", wv: 1284 }, { cc: 1287 }], {}], [1, "etsy", 2, "", 22, [1288, 1289], [{ e: 1288 }], [{ v: 1288 }], [{ k: 1290 }, { timeout: 3e3, wv: 1291 }, { wait: 1e3 }, { eval: "EVAL_ETSY_0" }, { eval: "EVAL_ETSY_1" }], [], {}], [1, "EU Cookie Law", 1, "", 22, [1292], [{ e: 1293 }], [{ wait: 500 }, { v: 1293 }], [{ h: 1293 }], [{ negated: true, cc: 1294 }], {}], [1, "eu-cookie-compliance-banner", 2, "", 22, [], [{ e: 1295 }], [{ e: 1295 }], [{ k: 1296 }], [{ negated: true, cc: 1297 }], {}], [1, "eu-cookie-compliance-legacy", 1, "", 22, [], [{ e: 1298 }, { negated: true, e: 1299 }, { negated: true, e: 1295 }], [{ v: 1300 }], [{ h: 1301 }], [{ check: "none", v: 1301 }], {}], [1, "eu-cookie-law-popup", 2, "", 22, [1302], [{ e: 1303 }], [{ check: "any", v: 1303 }], [{ c: 1303 }], [{ check: "none", timeout: 2e3, wv: 1303 }], {}], [1, "exceed-lms", 2, "", 22, [1304], [{ e: 1305 }], [{ v: 1304 }], [{ c: 1306 }], [{ cc: 1307 }], {}], [1, "EZoic", 2, "", 22, [1308], [{ e: 1308 }], [{ v: 1308 }], [{ wait: 500 }, { k: 1309 }, { w: 1310 }, { all: true, optional: true, k: 1311 }, { c: 1312 }], [{ cc: 1313 }], {}], [1, "fabrique-cookie-message", 2, "", 22, [1314], [{ e: 1315 }], [{ v: 1315 }], [{ c: 1315 }], [{ any: [{ cc: 1316 }, { cc: 1317 }] }], {}], [1, "fanatics", 2, "", 22, [1318], [{ e: 1318 }], [{ v: 1318 }], [{ c: 1319 }], [{ cc: 1320 }], {}], [1, "fastcmp", 0, "", 22, [1321], [{ e: 1322 }], [{ v: 1322 }], [{ waitForThenClick: ["iframe#fast-cmp-iframe", ".fast-cmp-home-refuse button"] }], [{ cc: 1323 }], {}], [1, "fastweb-cookie-center", 2, "", 22, [1324], [{ e: 1325 }], [{ v: 1326 }], [{ waitForThenClick: ["iframe.ck_if", "#Main > .close img"] }, { check: "none", timeout: 5e3, wv: 1324 }], [{ check: "none", v: 1327 }], {}], [1, "fera-cookies", 2, "", 22, [1328], [{ e: 1329 }], [{ v: 1330 }], [{ if: { v: 1331 }, then: [{ k: 1331 }], else: [{ c: 1332 }] }, { timeout: 2e3, optional: true, c: 1333 }], [{ cc: 1334 }, { negated: true, cc: 1335 }], {}], [1, "fever", 2, "", 22, [1336], [{ e: 1337 }], [{ v: 1336 }], [{ c: 1337 }, { if: { e: 1338 }, then: [{ k: 1339 }] }, { c: 1340 }], [{ cc: 1341 }], {}], [1, "fever-cookie-advice", 2, "", 22, [1342], [{ e: 1342 }], [{ v: 1342 }], [{ c: 1343 }, { wv: 1344 }, { c: 1345 }], [{ wait: 500 }, { cc: 1346 }], {}], [1, "fides", 2, "", 22, [1347], [{ e: 1348 }], [{ v: 1348 }, { check: "none", v: 1349 }, { eval: "EVAL_FIDES_DETECT_POPUP" }], [{ w: 1350 }, { if: { v: 1351 }, then: [{ retry: 5, retryInterval: 500, c: 1352 }], else: [{ k: 1353 }, { retry: 5, retryInterval: 500, c: 1354 }] }], [], {}], [1, "finna", 2, "", 22, [1355], [{ e: 1356 }], [{ v: 1356 }], [{ retry: 10, retryInterval: 500, c: 1356 }], [], {}], [1, "finsweet", 0, "", 22, [1357], [{ any: [{ e: 1357 }, { exists: ["[fs-consent-element=root]", "[fs-consent-element=banner]"] }] }], [{ any: [{ v: 1358 }, { visible: ["[fs-consent-element=root]", "[fs-consent-element=banner] [fs-consent-element=allow]"] }] }], [{ wait: 500 }, { if: { e: 1359 }, then: [{ k: 1359 }], else: [{ if: { exists: ["[fs-consent-element=root]", "[fs-consent-element=banner] [fs-consent-element=deny]"] }, then: [{ click: ["[fs-consent-element=root]", "[fs-consent-element=banner] [fs-consent-element=deny]"] }], else: [{ h: 1360 }] }] }], [], {}], [1, "first-visit-notice", 1, "", 22, [1361], [{ e: 1362 }], [{ v: 1361 }], [{ h: 1361 }], [], {}], [1, "fixpart", 2, "", 22, [1363], [{ e: 1364 }], [{ v: 1363 }], [{ c: 1365 }], [{ cc: 1366 }], {}], [1, "flatsome-cookies", 1, "", 22, [1367], [{ e: 1368 }], [{ v: 1369 }], [{ h: 1367 }], [], {}], [1, "fnsp-cookieconsent", 2, "", 22, [1370], [{ e: 1371 }], [{ v: 1372 }], [{ c: 1373 }], [{ cc: 1374 }], {}], [1, "focal-cookie-bar", 2, "", 22, [], [{ e: 1375 }], [{ v: 1375 }], [{ c: 1376 }], [{ timeout: 2e3, check: "none", wv: 1377 }], {}], [1, "ford-dse", 2, "", 22, [1378], [{ e: 1379 }], [{ v: 1380 }], [{ c: 1379 }, { w: 1381 }], [{ cc: 1382 }], {}], [1, "foster-cookie-notice", 0, "", 22, [1383], [{ e: 1384 }], [{ v: 1383 }], [{ if: { e: 1385 }, then: [{ k: 1385 }], else: [{ k: 1386 }, { timeout: 2e3, w: 1387 }, { wait: 500 }, { all: true, optional: true, k: 1388 }, { k: 1389 }] }], [{ check: "none", v: 1383 }], {}], [1, "fullertonhotels.com", 0, "", 10, [], [{ exists: ["#ifrmCookieBanner", "#sp-decline, .evSpRejectBtn"] }], [{ any: [{ visible: ["#ifrmCookieBanner", "#sp-decline, .evSpRejectBtn"] }, { visible: ["#ifrmCookieBanner", "#sp-customize"] }] }], [{ wait: 500 }, { if: { visible: ["#ifrmCookieBanner", "#sp-decline, .evSpRejectBtn"] }, then: [{ waitForThenClick: ["#ifrmCookieBanner", "#sp-decline, .evSpRejectBtn"] }], else: [{ click: ["#ifrmCookieBanner", "#sp-customize"] }, { waitForVisible: ["#ifrmPrivacyBanner", "button[data-sp-onclick*=saveSelected]"] }, { if: { visible: ["#ifrmPrivacyBanner", "button[data-sp-onclick*=declineAll]"] }, then: [{ click: ["#ifrmPrivacyBanner", "button[data-sp-onclick*=declineAll]"] }], else: [{ click: ["#ifrmPrivacyBanner", "input[data-tw-binding^='category:']:checked:not(:disabled)"], all: true, optional: true }, { click: ["#ifrmPrivacyBanner", "button[data-sp-onclick*=saveSelected]"] }] }] }], [], {}], [1, "fulmo", 2, "", 22, [1390], [{ e: 1391 }], [{ v: 1392 }], [{ c: 1391 }], [{ cc: 1393 }], {}], [1, "funding-choices", 2, "", 22, [1394], [{ e: 1395 }], [{ e: 1396 }], [{ if: { e: 1397 }, then: [{ k: 1397 }], else: [{ e: 1398 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }], [], {}], [1, "fusedeck", 2, "", 22, [1401], [{ e: 1402 }], [{ v: 1402 }], [{ c: 1402 }], [{ timeout: 1e3, check: "none", wv: 1402 }, { cc: 1403 }, { cc: 1404 }], {}], [1, "gallup", 2, "", 22, [1405], [{ e: 1406 }], [{ v: 1406 }], [{ c: 1406 }, { wait: 500 }, { c: 1407 }], [{ cc: 1408 }], {}], [1, "gameforge", 2, "", 22, [1409], [{ e: 1410 }, { e: 1411 }], [{ v: 1412 }], [{ c: 1411 }, { wv: 1413 }, { c: 1414 }], [{ cc: 1415 }, { cc: 1416 }], {}], [1, "gastro-digital", 2, "", 22, [1417], [{ e: 1418 }], [{ v: 1417 }], [{ c: 1419 }, { wv: 1420 }, { if: { e: 1421 }, then: [{ all: true, k: 1421 }] }, { c: 1422 }, { if: { e: 1423 }, then: [{ timeout: 8e3, optional: true, w: 1424 }, { if: { e: 1424 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }], else: [{ optional: true, e: 1398 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }] }], [{ check: "none", v: 1417 }, { check: "none", timeout: 2e3, wv: 1424 }], {}], [1, "gdpr-jp-notice", 1, "", 22, [1425], [{ e: 1426 }], [{ v: 1425 }], [{ h: 1425 }], [], {}], [1, "gdpsystem", 2, "", 22, [1427], [{ e: 1428 }], [{ v: 1429 }], [{ if: { e: 1430 }, then: [{ c: 1430 }], else: [{ c: 1431 }, { wv: 1432 }, { all: true, optional: true, k: 1433 }, { c: 1434 }] }], [{ check: "none", wv: 1429 }], {}], [1, "gear4music", 2, "", 10, [1435], [{ e: 1436 }], [{ v: 1435 }], [{ c: 1437 }, { check: "none", timeout: 2e3, wv: 1435 }], [{ wait: 1e3 }, { cc: 1438 }], {}], [1, "gemini.google.com", 2, "", 22, [1439], [{ e: 1440 }], [{ v: 1439 }], [{ c: 1441 }], [], {}], [1, "generalitat-catalunya", 2, "", 22, [1442], [{ e: 1443 }], [{ v: 1443 }], [{ c: 1444 }, { c: 1445 }], [{ cc: 1446 }], {}], [2, "getproven", 1, "", 22, [1447], [{ e: 1448 }], [{ v: 1448 }], [{ h: 1447 }, { removeClass: "cdk-global-scrollblock", selector: "html", optional: true }], [], {}], [1, "giustizia-it", 2, "", 22, [1449], [{ e: 1450 }], [{ v: 1451 }], [{ all: true, optional: true, k: 1452 }, { c: 1453 }], [{ cc: 1454 }], {}], [1, "globo-lgpd", 2, "", 22, [], [{ e: 1455 }], [{ v: 1456 }], [{ c: 1457 }], [{ cc: 1458 }], {}], [1, "gm-consent", 2, "", 22, [1459], [{ e: 1460 }], [{ v: 1461 }], [{ if: { e: 1462 }, then: [{ k: 1462 }] }, { wv: 1463 }, { if: { e: 1464 }, then: [{ k: 1464 }] }, { k: 1463 }], [{ cc: 1465 }], {}], [1, "gobasic", 2, "", 22, [1466], [{ e: 1467 }], [{ v: 1467 }], [{ c: 1467 }], [{ cc: 1468 }], {}], [1, "godaddy-privacy-widget", 2, "", 22, [1469], [{ exists: ["#gtm_privacy", "#privacy_widget"] }], [{ visible: ["#gtm_privacy", "#privacy_widget"] }], [{ waitForThenClick: ["#gtm_privacy", "#pw_decline"] }], [{ cc: 1470 }], {}], [1, "godaddy-website-builder", 2, "", 22, [1471], [{ e: 1472 }], [{ v: 1473 }], [{ c: 1472 }], [], {}], [1, "godaddy-website-builder-cosmetic", 1, "", 22, [1471], [{ e: 1471 }, { negated: true, e: 1472 }], [{ v: 1473 }], [{ h: 1471 }], [], {}], [1, "google-consent-standalone", 2, "", 22, [], [{ e: 1474 }, { e: 1475 }], [{ v: 1474 }], [{ c: 1476 }], [], {}], [1, "google-cookiebar", 0, "", 22, [1477], [{ e: 1477 }], [{ v: 1477 }], [{ if: { e: 1478 }, then: [{ k: 1478 }], else: [{ h: 1477 }] }], [], {}], [1, "google.com", 2, "", 22, [1479], [{ e: 1479 }, { e: 1480 }], [{ v: 1481 }], [{ c: 1481 }], [{ cc: 1482 }], {}], [1, "gotrust", 2, "", 22, [1483], [{ e: 1484 }], [{ visible: ["#gotrust-cookie-banner > div", "[class*='cookieFooterBanner__']"] }], [{ if: { exists: ["#gotrust-cookie-banner > div", "button[data-tr-btn='deny']"] }, then: [{ click: ["#gotrust-cookie-banner > div", "button[data-tr-btn='deny']"] }], else: [{ if: { exists: ["#gotrust-cookie-banner > div", "[class*='cookieFooterBanner__'] button[data-tr-btn='allowSelection']"] }, then: [{ click: ["#gotrust-cookie-banner > div", "[class*='cookieFooterBanner__'] button[data-tr-btn='allowSelection']"] }, { waitForVisible: ["#gotrust-cookie-banner > div", "[class*='trPrefDialog__'] [role='switch']"] }, { click: ["#gotrust-cookie-banner > div", "[role='switch'][data-tr-checked='true'][data-tr-disabled='false']:not([id^='service-'])"], all: true, optional: true }, { click: ["#gotrust-cookie-banner > div", "[role='switch'][data-tr-checked='true'][data-tr-disabled='false']"], all: true, optional: true }, { waitForThenClick: ["#gotrust-cookie-banner > div", "[class*='trPrefDialog__'] button[data-tr-btn='allowSelection']"] }], else: [{ waitForThenClick: ["#gotrust-cookie-banner > div", "[class*='cookieFooterBanner__']", "xpath/.//button[starts-with(normalize-space(.), 'Reject')]"] }] }] }], [], {}], [1, "gov.uk", 2, "", 22, [], [{ e: 1485 }], [{ check: "any", v: 1486 }], [{ wait: 300 }, { if: { visible: [".govuk-cookie-banner__message", "xpath///button[contains(., 'Reject')] | //a[contains(., 'Reject')] | //input[contains(@value, 'Reject')] | //button[contains(., 'do not use analytics cookies')]"] }, then: [{ click: [".govuk-cookie-banner__message", "xpath///button[contains(., 'Reject')] | //a[contains(., 'Reject')] | //input[contains(@value, 'Reject')] | //button[contains(., 'do not use analytics cookies')]"] }] }, { waitForVisible: [".govuk-cookie-banner__message", "xpath///button[contains(., 'Hide')] | //a[contains(., 'Hide')] | //input[contains(@value, 'Hide')]"] }, { click: [".govuk-cookie-banner__message", "xpath///button[contains(., 'Hide')] | //a[contains(., 'Hide')] | //input[contains(@value, 'Hide')]"] }], [], {}], [1, "gravito", 2, "", 22, [1487], [{ e: 1488 }], [{ v: 1488 }], [{ if: { v: 1489 }, then: [{ k: 1489 }], else: [{ c: 1490 }, { c: 1491 }] }, { check: "none", timeout: 2e3, optional: true, wv: 1488 }], [{ cc: 1492 }], {}], [1, "grrr-cookie-consent", 2, "", 22, [], [{ exists: ["wookie-consent, cookie-consent", "aside.js-cookie-bar form button"] }], [{ visible: ["wookie-consent, cookie-consent", "aside.js-cookie-bar[aria-hidden=false]"] }], [{ click: ["wookie-consent, cookie-consent", "aside.js-cookie-bar input[type=checkbox]:checked:not([disabled])"], all: true, optional: true }, { waitForThenClick: ["wookie-consent, cookie-consent", "aside.js-cookie-bar form button"], retry: 2 }], [{ exists: ["wookie-consent, cookie-consent", "aside.js-cookie-bar[aria-hidden=true]"] }], {}], [1, "grupa-pracuj", 0, "", 22, [], [{ e: 1493 }], [{ check: "any", v: 1493 }], [{ if: { e: 1494 }, then: [{ c: 1495 }, { wv: 1496 }, { all: true, optional: true, k: 1497 }, { c: 1498 }], else: [{ c: 1499 }, { wv: 1500 }, { all: true, optional: true, k: 1501 }, { c: 1502 }] }], [{ any: [{ cc: 1503 }, { cc: 1504 }] }], {}], [1, "grupa-rmf", 2, "", 22, [1505], [{ e: 1506 }], [{ v: 1505 }], [{ wv: 1507 }, { k: 1507 }, { wv: 1508 }, { k: 1508 }, { wv: 1509 }, { if: { e: 1510 }, then: [{ k: 1509 }] }, { wv: 1511 }, { k: 1511 }, { check: "none", wv: 1505 }], [], {}], [1, "gsb-cookie-banner", 2, "", 22, [1512], [{ e: 1513 }], [{ check: "any", v: 1514 }], [{ c: 1514 }], [{ cc: 436 }], {}], [1, "gsb-cookiebanner-close", 2, "", 22, [1515], [{ e: 1516 }], [{ check: "any", v: 1516 }], [{ if: { e: 1517 }, then: [{ c: 1517 }], else: [{ all: true, optional: true, k: 1518 }, { c: 1519 }] }], [{ cc: 1520 }, { negated: true, cc: 1521 }], {}], [1, "gsb-cookiebanner-selection", 2, "", 22, [1522, 1523], [{ e: 1524 }], [{ v: 1524 }], [{ all: true, optional: true, k: 1525 }, { c: 1524 }], [{ cc: 1526 }], {}], [1, "guesty", 0, "", 22, [1527], [{ e: 1528 }], [{ v: 1527 }], [{ c: 1529 }], [{ cc: 1530 }], {}], [1, "gwo", 2, "", 22, [1531], [{ e: 1531 }], [{ v: 1532 }], [{ if: { e: 1533 }, then: [], else: [{ c: 1534 }] }, { w: 1535 }, { all: true, optional: true, k: 1536 }, { optional: true, k: 1537 }, { k: 1534 }], [{ cc: 1538 }], {}], [1, "hacon-next-gen", 2, "", 22, [], [{ exists: ["next-gen-map-based-route", "next-gen-cookie-dialog"] }], [{ visible: ["next-gen-map-based-route", "next-gen-cookie-dialog next-gen-page.cookie-dialog"] }], [{ if: { exists: ["next-gen-map-based-route", "next-gen-cookie-dialog input[type=checkbox]:checked"] }, then: [{ click: ["next-gen-map-based-route", "next-gen-cookie-dialog input[type=checkbox]:checked"], all: true }] }, { waitForThenClick: ["next-gen-map-based-route", "next-gen-cookie-dialog next-gen-page-footer button[variant=secondary]"] }], [{ cc: 1539 }], {}], [1, "hallmark", 2, "", 22, [1540], [{ e: 1541 }], [{ v: 1540 }], [{ c: 1541 }, { wv: 1542 }, { k: 1543 }, { k: 1542 }, { check: "none", timeout: 3e3, optional: true, wv: 1540 }], [{ cc: 1544 }], {}], [1, "handelsbanken", 2, "", 22, [1545], [{ e: 1546 }], [{ v: 1546 }], [{ c: 1547 }], [{ cc: 1548 }], {}], [1, "hds-cookie-consent", 2, "", 22, [1549], [{ exists: [".hds-cc__target", "#hds-cc.hds-cc--banner"] }], [{ visible: [".hds-cc__target", "#hds-cc.hds-cc--banner"] }], [{ waitForThenClick: [".hds-cc__target", '#hds-cc.hds-cc--banner button[data-approved="required"]'] }], [{ visible: [".hds-cc__target", "#hds-cc.hds-cc--banner"], check: "none" }], {}], [1, "healthline-media", 2, "", 22, [1550], [{ e: 1551 }], [{ e: 1551 }], [{ if: { e: 1552 }, then: [{ k: 1552 }], else: [{ wv: 1553 }, { k: 1554 }] }], [], {}], [1, "help-ch", 2, "", 22, [1555], [{ e: 1556 }], [{ v: 1556 }], [{ c: 1556 }], [], {}], [1, "hg-privacy", 2, "", 22, [1557], [{ e: 1558 }], [{ v: 1558 }], [{ c: 1558 }], [{ check: "none", timeout: 2e3, wv: 1558 }], {}], [1, "hkdir", 2, "", 22, [1559], [{ e: 1560 }, { e: 1561 }], [{ v: 1559 }], [{ c: 1562 }], [{ cc: 1563 }], {}], [1, "hmgroup-turbocookie", 2, "", 22, [1564], [{ e: 1565 }], [{ v: 1564 }], [{ if: { e: 1566 }, then: [{ c: 1566 }], else: [{ c: 1567 }, { c: 1568 }] }], [{ wait: 500 }, { cc: 1569 }], {}], [1, "hmrc-tracking-consent", 2, "", 22, [1570], [{ e: 1571 }], [{ v: 1571 }], [{ c: 1571 }, { timeout: 3e3, optional: true, c: 1572 }], [{ cc: 1573 }], {}], [1, "holidaymedia", 2, "", 22, [1574], [{ e: 1575 }], [{ v: 1574 }], [{ timeout: 2e3, c: 1576 }], [], {}], [1, "holidu", 2, "", 22, [1577], [{ e: 1578 }], [{ v: 1577 }], [{ c: 1578 }], [{ cc: 1579 }, { cc: 1580 }], {}], [1, "holland-watch-group", 2, "", 22, [1581], [{ e: 1582 }], [{ v: 1582 }], [{ c: 1582 }, { check: "none", wv: 1581 }], [], {}], [1, "hometogo", 2, "", 22, [1583], [{ e: 1584 }], [{ v: 1583 }], [{ if: { e: 1585 }, then: [{ c: 1585 }], else: [{ c: 1586 }, { c: 1587 }] }], [{ cc: 1168 }], {}], [1, "hu-manity", 2, "", 22, [1588], [{ e: 1589 }], [{ v: 1589 }], [{ c: 1590 }], [], {}], [1, "hubspot", 2, "", 22, [], [{ e: 1591 }, { any: [{ e: 1592 }, { v: 1593 }] }], [{ v: 1591 }], [{ if: { e: 1592 }, then: [{ k: 1592 }], else: [{ v: 1593 }, { k: 1593 }] }], [], {}], [1, "hubspot-cosmetic", 1, "", 22, [], [{ e: 1591 }, { negated: true, e: 1592 }, { check: "none", v: 1593 }], [{ v: 1591 }], [{ h: 1591 }], [], {}], [1, "hurra-consent", 2, "", 22, [1594], [{ e: 1595 }], [{ v: 1594 }], [{ if: { v: 1596 }, then: [{ k: 1596 }], else: [{ c: 1597 }] }], [{ timeout: 2e3, check: "none", wv: 1594 }], {}], [1, "hutshopping", 2, "", 22, [1598], [{ e: 1599 }], [{ v: 1600 }], [{ c: 1599 }], [{ cc: 1601 }], {}], [1, "ibkr", 2, "", 22, [1602], [{ e: 1603 }], [{ v: 1602 }], [{ if: { v: 1604 }, then: [{ k: 1604 }], else: [{ k: 1603 }, { c: 1605 }] }], [{ cc: 1606 }], {}], [1, "icn-cookie-notice", 2, "", 22, [1607], [{ e: 1607 }], [{ check: "any", v: 1608 }], [{ if: { e: 1609 }, then: [{ k: 1609 }], else: [{ if: { e: 1610 }, then: [{ k: 1610 }], else: [{ if: { v: 1611 }, then: [{ k: 1611 }] }, { c: 1612 }, { k: 1613 }] }] }], [{ check: "none", timeout: 3e3, wv: 1608 }, { cc: 1614 }], {}], [1, "idxrcookies", 2, "", 22, [1615], [{ e: 1616 }], [{ v: 1616 }], [{ c: 1616 }], [], {}], [1, "ihavecookies", 2, "", 22, [1617], [{ e: 1618 }], [{ v: 1617 }], [{ c: 1618 }, { wv: 1619 }, { all: true, optional: true, k: 1620 }, { if: { v: 1621 }, then: [{ k: 1621 }], else: [{ k: 1622 }] }, { check: "none", timeout: 2e3, optional: true, wv: 1617 }, { if: { e: 1623 }, then: [{ timeout: 5e3, optional: true, c: 1624 }] }], [{ cc: 1625 }], {}], [1, "ilovepdf", 2, "", 22, [], [{ e: 1626 }], [{ v: 1626 }], [{ c: 1626 }, { c: 1627 }], [{ cc: 1628 }], {}], [1, "imarina", 1, "", 22, [1629], [{ e: 1630 }], [{ v: 1629 }], [{ h: 1629 }], [], {}], [1, "impress-co-jp", 2, "", 22, [1631], [{ e: 1632 }], [{ v: 1632 }], [{ c: 1632 }], [{ cc: 1633 }], {}], [1, "imyfone", 1, "", 22, [1634], [{ e: 1635 }], [{ v: 1634 }], [{ h: 1634 }], [], {}], [1, "in2cookiemodal", 2, "", 22, [1636], [{ e: 1636 }], [{ v: 1636 }], [{ if: { v: 1637 }, then: [{ k: 1637 }], else: [{ all: true, optional: true, k: 1638 }, { c: 1639 }] }, { check: "none", timeout: 2e3, optional: true, wv: 1636 }], [{ cc: 1640 }], {}], [1, "incomit", 2, "", 22, [1641], [{ exists: ["cookie-consent-element", ".incom-cookie-module"] }], [{ visible: ["cookie-consent-element", ".incom-cookie-module #main-cookie-view"] }], [{ waitForThenClick: ["cookie-consent-element", "#main-cookie-view nav button.btn:not(#cookie-accept-all)"] }], [{ cc: 1642 }], {}], [1, "indy-systems", 1, "", 22, [1643], [{ e: 1644 }], [{ v: 1643 }], [{ h: 1643 }], [], {}], [1, "infomaniak-rgpd", 2, "", 22, [1645], [{ e: 1645 }], [{ visible: ["module-rgpd-component", ".modal"] }], [{ waitForThenClick: ["module-rgpd-component", ".buttons > button:nth-of-type(2)"], retry: 3 }], [{ cc: 1646 }], {}], [1, "inmobi", 2, "", 22, [1647], [{ e: 1648 }], [{ v: 1648 }], [{ c: 1649 }], [{ cc: 1650 }], {}], [1, "insided", 0, "", 10, [1651], [{ e: 1652 }], [{ v: 1652 }], [{ c: 1652 }], [{ check: "none", v: 1652 }], {}], [1, "interface-medien-gebaeck", 2, "", 22, [1653], [{ e: 1654 }], [{ v: 1654 }], [{ if: { e: 1655 }, then: [{ k: 1655 }], else: [{ k: 1656 }, { timeout: 3e3, wv: 1657 }, { all: true, optional: true, k: 1658 }, { k: 1659 }] }], [{ timeout: 2e3, check: "none", wv: 1653 }, { cc: 1660 }], {}], [1, "interia", 2, "", 22, [1661], [{ e: 1662 }], [{ v: 1661 }], [{ c: 1662 }, { c: 1663 }], [{ check: "none", timeout: 3e3, wv: 1661 }], {}], [1, "intermedia-cms-fsi", 2, "", 22, [1664], [{ e: 1665 }], [{ v: 1664 }], [{ c: 1666 }], [{ cc: 1667 }], {}], [1, "internetvergelijk", 2, "", 22, [1668], [{ e: 1669 }], [{ v: 1670 }], [{ if: { v: 1671 }, then: [{ k: 1671 }], else: [{ c: 1672 }, { c: 1673 }] }], [{ check: "none", timeout: 2e3, wv: 1670 }], {}], [1, "invision-guest-terms", 1, "", 22, [1674], [{ e: 1675 }], [{ v: 1674 }], [{ h: 1674 }], [], {}], [1, "ionos.de", 2, "", 22, [1676, 1677], [{ e: 1677 }], [{ v: 1677 }], [{ if: { v: 1678 }, then: [{ c: 1678 }], else: [{ c: 1679 }] }], [{ check: "none", timeout: 2e3, wv: 1677 }], {}], [1, "islington-council", 2, "", 22, [1680], [{ e: 1681 }], [{ v: 1680 }], [{ timeout: 1e4, w: 1682 }, { c: 1681 }, { c: 1683 }], [{ cc: 1684 }, { cc: 1685 }], {}], [1, "isn-cookie-consent", 2, "", 22, [1686], [{ e: 1687 }], [{ v: 1686 }], [{ c: 1688 }], [{ check: "none", timeout: 1e3, wv: 1686 }], {}], [1, "iubenda", 2, "", 22, [1689], [{ e: 1689 }], [{ any: [{ v: 1690 }, { v: 1691 }] }], [{ if: { e: 1692 }, then: [{ timeout: 2e3, optional: true, w: 1693 }] }, { if: { e: 1694 }, then: [{ k: 1694 }], else: [{ if: { e: 1695 }, then: [{ c: 1695 }, { c: 1696 }, { c: 1697 }], else: [{ if: { e: 1691 }, then: [{ k: 1691 }, { c: 1698 }, { timeout: 2e3, optional: true, c: 1699 }], else: [{ h: 1689 }] }] }] }], [{ any: [{ eval: "EVAL_IUBENDA_1" }, { cc: 1700 }] }], {}], [1, "ixo-cookie-prompt", 2, "", 22, [1701], [{ e: 1702 }], [{ v: 1701 }], [{ c: 1703 }, { c: 1704 }], [{ cc: 1705 }], {}], [1, "jcookie", 1, "", 22, [1706], [{ e: 1707 }], [{ v: 1708 }], [{ h: 1706 }], [], {}], [1, "jetpack-eu-cookie-law", 1, "", 22, [1709], [{ e: 1709 }], [{ v: 1709 }], [{ h: 1709 }], [], {}], [1, "jobindex", 2, "", 22, [1710], [{ e: 1710 }], [{ v: 1710 }], [{ if: { e: 1711 }, then: [{ all: true, k: 1711 }] }, { c: 1712 }], [{ cc: 707 }], {}], [1, "jobmount", 1, "", 22, [1713], [{ e: 1714 }], [{ v: 1713 }], [{ h: 1713 }], [], {}], [1, "jokul-cookie-consent", 2, "", 22, [], [{ e: 1715 }], [{ v: 1715 }], [{ if: { e: 1716 }, then: [{ c: 1716 }], else: [{ if: { e: 1717 }, then: [{ all: true, k: 1717 }] }, { c: 1715 }] }], [{ cc: 1718 }], {}], [1, "jollyroom", 2, "", 22, [1719], [{ e: 1720 }], [{ v: 1721 }], [{ c: 1722 }, { if: { e: 1723 }, then: [{ all: true, k: 1723 }] }, { retry: 5, retryInterval: 500, c: 1720 }], [{ check: "none", v: 1724 }], {}], [1, "jpmorgan-chase", 2, "", 22, [1725], [{ e: 1726 }], [{ v: 1726 }], [{ c: 1726 }], [{ cc: 1727 }], {}], [1, "jquery-cookiepolicy", 0, "", 10, [1728], [{ e: 1729 }], [{ v: 1728 }], [{ if: { e: 1730 }, then: [{ c: 1730 }], else: [{ k: 1731 }, { wv: 1732 }, { all: true, optional: true, k: 1733 }, { c: 1734 }] }], [{ cc: 1735 }], {}], [1, "jquery.cookieBar", 1, "", 22, [1736], [{ e: 1737 }], [{ check: "any", v: 1737 }], [{ h: 1736 }], [{ check: "none", v: 1737 }, { negated: true, cc: 1738 }], {}], [1, "jtl-consent-manager", 2, "", 22, [], [{ e: 1739 }], [{ v: 1740 }], [{ c: 1741 }], [{ timeout: 2e3, check: "none", wv: 1740 }], {}], [1, "justica-eleitoral", 2, "", 22, [1742], [{ e: 1743 }], [{ v: 1744 }], [{ c: 1745 }], [{ w: 1746 }], {}], [1, "kalles-theme", 2, "", 22, [1747], [{ e: 1747 }], [{ v: 1748 }], [{ c: 1749 }], [{ eval: "EVAL_KALLES_THEME_TEST" }], {}], [1, "kamsoft-cookiesmanager", 2, "", 22, [1750], [{ e: 1751 }], [{ v: 1751 }], [{ if: { e: 1752 }, then: [{ c: 1752 }], else: [{ c: 1753 }, { wv: 1754 }, { all: true, optional: true, k: 1755 }, { k: 1754 }] }], [], {}], [1, "kaspersky-cookies-notification", 1, "", 22, [1756], [{ e: 1757 }, { e: 1758 }], [{ v: 1758 }], [{ h: 1759 }], [], {}], [1, "ketch", 2, "", 10, [1760, 1761, 1762], [{ any: [{ e: 1760 }, { e: 1761 }, { e: 1762 }, { e: 1763 }] }], [{ any: [{ v: 1760 }, { v: 1761 }, { v: 1762 }] }], [{ if: { e: 1764 }, then: [{ c: 1764 }, { if: { v: 1765 }, then: [{ k: 1766 }] }], else: [{ if: { e: 1767 }, then: [{ c: 1767 }], else: [{ if: { e: 1768 }, then: [{ if: { e: 1769 }, then: [{ c: 1769 }], else: [{ if: { e: 1770 }, then: [{ k: 1770 }] }] }] }] }] }, { timeout: 1e3, optional: true, w: 1771 }, { if: { e: 1771 }, then: [{ if: { e: 1772 }, then: [{ c: 1772 }], else: [{ all: true, optional: true, k: 1773 }] }, { k: 1766 }] }], [{ cc: 1774 }], { intermediate: false }], [1, "kixell", 2, "", 22, [1775, 1776], [{ e: 1777 }], [{ v: 1777 }], [{ c: 1777 }], [{ timeout: 2e3, check: "none", wv: 1776 }], {}], [1, "klaxit-cookie-consent", 2, "", 22, [1778], [{ e: 1779 }], [{ v: 1780 }], [{ c: 1781 }], [{ cc: 1782 }], {}], [1, "klp-cookie-banner", 2, "", 22, [1783], [{ e: 1783 }], [{ v: 1784 }], [{ c: 1785 }], [{ wait: 500 }, { cc: 1786 }], {}], [1, "knowunity", 2, "", 22, [1787], [{ e: 1788 }], [{ v: 1787 }], [{ c: 1789 }], [{ check: "none", timeout: 1e3, wv: 1787 }], {}], [1, "kolibri-cookie-widget", 2, "", 22, [1790], [{ e: 1790 }], [{ v: 1790 }], [{ c: 1791 }, { check: "none", timeout: 5e3, wv: 1790 }], [{ cc: 1792 }], {}], [1, "krieger-consent-form", 2, "", 22, [1793], [{ e: 1794 }], [{ v: 1795 }], [{ all: true, optional: true, k: 1796 }, { c: 1797 }], [{ cc: 1798 }], {}], [1, "krown-cookie-banner", 0, "", 22, [1799], [{ e: 1800 }], [{ v: 1800 }], [{ c: 1800 }], [{ wait: 500 }, { eval: "EVAL_KROWN_COOKIE_BANNER_TEST" }], {}], [1, "kulturit-ccm", 0, "", 22, [1801], [{ exists: ["#kit-ccm", ".ccm-container dialog"] }], [{ visible: ["#kit-ccm", ".ccm-container dialog[open] .action-buttons"] }], [{ waitForThenClick: ["#kit-ccm", "dialog[open] .action-buttons button:not(.accept-selected):last-of-type"] }], [{ waitForVisible: ["#kit-ccm", ".ccm-container dialog .action-buttons"], check: "none", timeout: 2e3 }], {}], [1, "kunstmaan-cookie-bar", 2, "", 22, [1802], [{ e: 1802 }], [{ v: 1803 }], [{ c: 1804 }, { wv: 1805 }, { if: { e: 1806 }, then: [{ all: true, k: 1806 }] }, { k: 1805 }], [{ wait: 1e3 }, { cc: 1807 }], {}], [1, "kwik-fit", 0, "", 22, [1808, 1809], [{ e: 1810 }], [{ v: 1811 }], [{ c: 1812 }, { wv: 1813 }, { all: true, optional: true, k: 1814 }, { c: 1815 }, { check: "none", wv: 1808 }], [], {}], [1, "la7-cmp", 2, "", 22, [1816], [{ e: 1817 }], [{ v: 1817 }], [{ c: 1817 }], [{ cc: 1818 }], {}], [1, "lab-network-consent", 2, "", 22, [1819], [{ e: 1820 }], [{ v: 1819 }], [{ c: 1820 }], [{ cc: 1821 }], {}], [1, "landgate", 2, "", 22, [1822], [{ e: 1823 }], [{ v: 1822 }], [{ c: 1824 }], [{ check: "none", timeout: 1e3, wv: 1822 }], {}], [1, "laravel-cc-banner", 2, "", 22, [1825], [{ e: 1826 }], [{ v: 1827 }], [{ c: 1828 }, { wv: 1829 }, { all: true, optional: true, k: 1830 }, { k: 1829 }], [], {}], [1, "laravel-cookie-consent", 2, "", 22, [1831], [{ e: 1831 }], [{ v: 1831 }], [{ c: 1832 }, { wv: 1833 }, { all: true, optional: true, k: 1834 }, { c: 1835 }, { check: "none", wv: 1831 }], [{ cc: 1836 }], {}], [1, "laravel-eu-cookie-consent", 2, "", 22, [1837], [{ e: 1838 }], [{ v: 1837 }], [{ if: { v: 1839 }, then: [{ k: 1839 }], else: [{ all: true, optional: true, k: 1840 }, { c: 1841 }] }], [], {}], [1, "lawwwing", 2, "", 22, [1842], [{ e: 1842 }], [{ v: 1843 }], [{ c: 1844 }, { check: "none", timeout: 2e3, wv: 1845 }], [{ cc: 1846 }], {}], [1, "legally-ok", 2, "", 22, [1847], [{ exists: ["#jmdCookieConsentWrapper", "#cookieConsent"] }], [{ visible: ["#jmdCookieConsentWrapper", "#cookieConsent"] }], [{ waitForThenClick: ["#jmdCookieConsentWrapper", "#cookieConsent .js-select-none"] }], [{ cc: 224 }], {}], [1, "lg-cookiecontrol", 2, "", 22, [1848], [{ e: 1849 }], [{ v: 1848 }], [{ if: { e: 1850 }, then: [{ k: 1850 }], else: [{ c: 1851 }] }], [{ cc: 1852 }], {}], [1, "lia", 2, "", 22, [1853], [{ e: 1853 }], [{ e: 1854 }, { v: 1853 }], [{ c: 1855 }], [], {}], [1, "liferay-cookies-banner", 2, "", 22, [1856], [{ e: 1856 }, { negated: true, e: 1857 }], [{ v: 1856 }], [{ c: 1858 }], [{ cc: 1859 }], {}], [1, "lightspeed-cookielaw", 2, "", 22, [1860], [{ e: 1861 }], [{ v: 1860 }], [{ c: 1861 }], [{ cc: 1862 }], {}], [1, "lineagrafica", 1, "", 22, [1863], [{ e: 1863 }], [{ e: 1863 }], [{ h: 1863 }], [], {}], [1, "lineagrafica-reject", 2, "", 22, [1864], [{ e: 1865 }], [{ v: 1865 }], [{ c: 1865 }], [{ check: "none", timeout: 2e3, wv: 1866 }], {}], [1, "linkedin.com", 2, "", 22, [1867], [{ e: 1867 }], [{ v: 1867 }], [{ wv: 1868 }, { retry: 3, retryInterval: 1e3, c: 1868 }], [{ check: "none", wv: 1867 }], {}], [1, "localbiz-cookie-notice", 1, "", 22, [1869], [{ e: 1870 }], [{ v: 1869 }], [{ h: 1869 }], [], {}], [1, "lta", 0, "", 10, [1871], [{ e: 1871 }], [{ v: 1871 }], [{ c: 1872 }, { wv: 1873 }, { all: true, optional: true, k: 1874 }, { k: 1875 }], [{ cc: 1876 }], {}], [1, "macaron", 2, "", 22, [1877], [{ e: 1877 }], [{ v: 1878 }], [{ if: { e: 1879 }, then: [{ k: 1879 }], else: [{ c: 1880 }, { w: 1881 }, { wv: 1882 }, { all: true, optional: true, c: 1883 }, { c: 1884 }] }], [{ cc: 1885 }], {}], [1, "magefan", 2, "", 22, [1886], [{ e: 1887 }], [{ v: 1886 }], [{ c: 1887 }], [{ cc: 1888 }], {}], [1, "manage-cookie-modal", 2, "", 22, [1094], [{ e: 1889 }, { e: 1890 }], [{ v: 1891 }], [{ retry: 5, retryInterval: 500, c: 1892 }, { wv: 1890 }, { if: { e: 1893 }, then: [{ all: true, k: 1893 }] }, { k: 1894 }], [{ check: "none", v: 1891 }], {}], [1, "marriott-notice", 2, "", 22, [1895], [{ e: 1896 }], [{ check: "any", v: 1897 }], [{ if: { v: 1898 }, then: [{ k: 1898 }] }, { if: { v: 1899 }, then: [{ k: 1899 }] }], [{ check: "none", timeout: 2e3, wv: 1900 }], {}], [1, "mars-cookies-prompt", 2, "", 22, [1901], [{ e: 1902 }], [{ v: 1902 }], [{ if: { e: 1903 }, then: [{ k: 1904 }] }, { wv: 1905 }, { if: { e: 1906 }, then: [{ all: true, k: 1906 }] }, { k: 1907 }], [{ cc: 1908 }], {}], [1, "mco-consent", 2, "", 22, [1909, 1910, 1911, 1912], [{ e: 1913 }], [{ v: 1914 }], [{ c: 1914 }], [{ cc: 1915 }], {}], [1, "mediamarkt.de", 2, "", 22, [1916, 1917], [{ e: 1918 }], [{ e: 1918 }], [{ if: { e: 1919 }, then: [{ k: 1919 }], else: [{ all: true, optional: true, k: 1920 }, { c: 1921 }] }], [{ wait: 1e3 }, { cc: 1922 }], {}], [1, "mediawiki-cookieconsent", 2, "", 22, [1923], [{ e: 1923 }], [{ v: 1924 }], [{ c: 1925 }, { wv: 1926 }, { all: true, optional: true, k: 1927 }, { k: 1926 }], [{ cc: 1928 }], {}], [1, "mensaje-cookies", 2, "", 22, [1929, 1930], [{ e: 1931 }, { any: [{ e: 1932 }, { e: 1933 }] }], [{ v: 1934 }], [{ if: { e: 1932 }, then: [{ c: 1932 }], else: [{ c: 1935 }, { c: 1933 }] }, { check: "none", timeout: 3e3, wv: 1934 }], [{ check: "none", v: 1934 }], {}], [1, "mercadolibre", 0, "", 22, [1936], [{ e: 1936 }], [{ v: 1936 }], [{ retry: 20, retryInterval: 1e3, c: 1937 }, { waitFor: [".cookie-consent-banner-opt-out__modal iframe", ".pp-cookies-item-switch .andes-ui-switch:not(.andes-ui-switch--disabled) input"], timeout: 3e4 }, { click: [".cookie-consent-banner-opt-out__modal iframe", ".pp-cookies-item-switch .andes-ui-switch:not(.andes-ui-switch--disabled) input:checked"], all: true }, { c: 1938 }, { check: "none", timeout: 5e3, optional: true, wv: 1939 }], [{ cc: 1940 }, { cc: 1941 }], {}], [1, "mercedes-benz-cmm", 2, "", 22, [1942], [{ exists: ["cmm-cookie-banner", ".cmm-cookie-banner__wrapper"] }], [{ visible: ["cmm-cookie-banner", ".cmm-cookie-banner__wrapper.visible"] }], [{ if: { exists: ["cmm-cookie-banner", "wb7-button[data-test=handle-deny-button]"] }, then: [{ waitForThenClick: ["cmm-cookie-banner", "wb7-button[data-test=handle-deny-button]"] }], else: [{ waitForThenClick: ["cmm-cookie-banner", "wb7-button[data-test=toggle-cookie-details]"] }, { waitForVisible: ["cmm-cookie-banner", "wb7-button[data-test=handle-confirm-selection-button]"] }, { click: ["cmm-cookie-banner", "input[data-test=handle-category-change]:checked:not([disabled])"], all: true, optional: true }, { waitForThenClick: ["cmm-cookie-banner", "wb7-button[data-test=handle-confirm-selection-button]"] }] }], [{ waitForVisible: ["cmm-cookie-banner", ".cmm-cookie-banner__wrapper.visible"], timeout: 2e3, check: "none" }], {}], [1, "meridiancu", 2, "", 22, [1943], [{ e: 1944 }], [{ v: 1945 }], [{ c: 1946 }, { wv: 1947 }, { optional: true, k: 1948 }, { c: 1949 }], [{ cc: 1950 }], {}], [1, "meta-cookie-dialog", 2, "", 22, [1951, 1952], [{ e: 1953 }], [{ v: 1953 }], [{ retry: 3, retryInterval: 500, c: 1954 }, { check: "none", wv: 1954 }], [], {}], [1, "metaquotes", 0, "", 10, [], [{ e: 1955 }, { e: 1956 }], [{ v: 1957 }], [{ c: 1955 }, { check: "none", timeout: 2e3, wv: 1957 }], [{ cc: 1958 }], {}], [1, "meteored", 2, "", 22, [1959], [{ e: 1960 }], [{ v: 1960 }], [{ c: 1961 }, { retry: 5, retryInterval: 500, c: 1962 }], [{ timeout: 1e3, check: "none", wv: 1959 }, { cc: 1963 }], {}], [1, "microsoft.com", 2, "", 22, [1964], [{ e: 1964 }], [{ e: 1964 }], [{ eval: "EVAL_MICROSOFT_0" }], [{ eval: "EVAL_MICROSOFT_2" }], {}], [2, "milestone-internet", 1, "", 22, [1965], [{ e: 1966 }], [{ v: 1966 }], [{ h: 1965 }, { removeClass: "pushItDown", selector: ".pushItDown", optional: true }], [], {}], [1, "mindshape-cookie-consent", 2, "", 10, [1967], [{ e: 1968 }], [{ v: 1969 }, { negated: true, cc: 1970 }], [{ if: { e: 1971 }, then: [{ c: 1971 }], else: [{ all: true, optional: true, k: 1972 }, { all: true, optional: true, k: 1973 }, { c: 1974 }] }], [{ cc: 1975 }], {}], [1, "minitool", 1, "", 22, [1976], [{ e: 1977 }], [{ v: 1976 }], [{ h: 1976 }], [{ check: "none", v: 1976 }], {}], [1, "mirasvit-gdpr", 2, "", 22, [1978, 1979, 1980, 1981], [{ e: 1982 }], [{ check: "any", v: 1982 }], [{ if: { check: "any", v: 1983 }, then: [{ any: [{ k: 1984 }, { k: 1985 }, { k: 1986 }] }], else: [{ any: [{ k: 1987 }, { k: 1988 }] }, { check: "any", timeout: 5e3, wv: 1989 }, { all: true, timeout: 2e3, optional: true, c: 1990 }, { any: [{ k: 1991 }, { k: 1992 }, { k: 1993 }] }] }, { check: "none", timeout: 1e4, wv: 1982 }], [{ cc: 1994 }, { check: "none", v: 1982 }], {}], [1, "miteco", 2, "", 22, [1995, 1996], [{ e: 1997 }], [{ v: 1998 }], [{ c: 1997 }, { wv: 1999 }, { if: { e: 2e3 }, then: [{ k: 2001 }] }, { k: 1999 }], [], {}], [1, "mittanbud", 0, "", 22, [], [{ e: 2002 }], [{ v: 2003 }], [{ c: 2004 }], [{ cc: 2005 }, { cc: 334 }], {}], [1, "mkdocs-material", 2, "", 22, [2006, 2007], [{ e: 2008 }], [{ v: 2009 }], [{ all: true, optional: true, k: 2010 }, { c: 2011 }], [], {}], [1, "mobirise-cookies-alert", 2, "", 22, [2012], [{ e: 2013 }], [{ v: 2012 }], [{ retry: 3, retryInterval: 1500, c: 2013 }], [{ check: "none", timeout: 4e3, wv: 2012 }], {}], [1, "mobirise-cookies-alert-cosmetic", 1, "", 22, [2012], [{ e: 2012 }, { negated: true, e: 2013 }], [{ v: 2012 }], [{ h: 2012 }], [], {}], [1, "moebel-de-group", 2, "", 22, [2014], [{ e: 2015 }], [{ v: 2015 }], [{ retry: 2, retryInterval: 3500, c: 2015 }], [{ timeout: 4e3, check: "none", wv: 2015 }], {}], [1, "moneysavingexpert.com", 2, "", 22, [], [{ e: 2016 }], [{ v: 2016 }], [{ k: 2017 }, { k: 2018 }], [], {}], [1, "Moove", 2, "", 22, [2019], [{ e: 2019 }], [{ v: 2020 }], [{ if: { e: 2021 }, then: [{ k: 2021 }], else: [{ if: { e: 2022 }, then: [{ k: 2022 }, { wv: 2023 }, { eval: "EVAL_MOOVE_0" }, { k: 2024 }], else: [{ h: 2019 }] }] }], [{ check: "none", v: 2019 }], {}], [1, "msg-cookie", 1, "", 22, [2025], [{ e: 2026 }], [{ v: 2026 }], [{ h: 2027 }], [], {}], [1, "multy-policy", 2, "", 22, [2028], [{ e: 2029 }], [{ v: 2030 }], [{ c: 2029 }], [{ check: "none", wv: 2031 }, { cc: 2032 }], {}], [1, "musti", 2, "", 22, [2033], [{ e: 2034 }], [{ v: 2033 }], [{ c: 2035 }], [{ check: "none", timeout: 2e3, wv: 2033 }], {}], [1, "natural-intelligence", 2, "", 22, [2036], [{ e: 2037 }], [{ check: "any", v: 2038 }], [{ c: 2037 }, { wv: 2039 }, { all: true, optional: true, k: 2040 }, { c: 2039 }], [{ if: { e: 2041 }, then: [{ cc: 2042 }], else: [{ check: "none", timeout: 2e3, wv: 2043 }] }], {}], [1, "naturalnews", 2, "", 22, [2044], [{ e: 2045 }], [{ v: 2045 }], [{ c: 2045 }], [{ check: "none", timeout: 2e3, wv: 2045 }], {}], [1, "ncsoft-cookie-toast", 2, "", 22, [2046, 2047], [{ e: 2046 }], [{ v: 2048 }], [{ c: 2048 }], [{ cc: 2049 }], {}], [1, "netl-gdpr", 2, "", 22, [], [{ e: 2050 }], [{ v: 2051 }], [{ if: { v: 2052 }, then: [{ k: 2052 }], else: [{ if: { v: 2053 }, then: [{ k: 2053 }], else: [{ if: { v: 2054 }, then: [{ k: 2054 }], else: [{ all: true, optional: true, k: 2055 }, { k: 2056 }] }] }] }], [{ cc: 2057 }], {}], [1, "nhs.uk", 2, "", 22, [2058], [{ e: 2058 }], [{ e: 2058 }], [{ k: 2059 }], [], {}], [1, "niceshops", 2, "", 22, [2060], [{ e: 2060 }], [{ v: 2060 }], [{ c: 2061 }], [], {}], [1, "nikkeibp", 2, "", 22, [2062], [{ e: 2063 }], [{ v: 2063 }], [{ c: 2063 }], [{ timeout: 1e3, check: "none", wv: 2062 }], {}], [1, "nnk-theme-cookie-bar", 2, "", 22, [2064], [{ e: 2065 }], [{ v: 2066 }], [{ c: 2065 }], [{ cc: 2067 }], {}], [1, "no-transit-consent", 2, "", 22, [2068], [{ e: 2068 }], [{ v: 2068 }], [{ c: 2069 }], [{ cc: 2070 }], {}], [1, "nowaera", 2, "", 22, [2071, 2072], [{ e: 2073 }], [{ v: 2074 }], [{ c: 2075 }, { wv: 2076 }, { all: true, optional: true, k: 2077 }, { k: 2076 }], [{ cc: 2078 }, { cc: 2079 }], {}], [1, "npo-ccm", 2, "", 22, [2080], [{ any: [{ exists: ["ccm-notification", "#ccm_notification .ccm_btn--save"] }, { exists: ["ccm-notification", "#ccm_notification #ccm_close"] }] }], [{ visible: ["ccm-notification", "#ccm_notification"] }], [{ if: { exists: ["ccm-notification", "#ccm_notification .ccm_btn--deny-all"] }, then: [{ click: ["ccm-notification", "#ccm_notification .ccm_btn--deny-all"] }], else: [{ if: { exists: ["ccm-notification", "#ccm_notification .ccm_btn--save"] }, then: [{ click: ["ccm-notification", "#ccm_notification input[type='radio'][value='false']"], all: true, optional: true }, { waitForThenClick: ["ccm-notification", "#ccm_notification .ccm_btn--save:not(.ccm_btn_disabled)"] }], else: [{ waitForThenClick: ["ccm-notification", "#ccm_notification #ccm_close"] }] }] }], [], {}], [1, "nuxt-cookie-manager", 2, "", 22, [2081], [{ e: 2082 }], [{ v: 2081 }], [{ if: { e: 2083 }, then: [{ c: 2083 }], else: [{ all: true, optional: true, k: 2084 }, { c: 2085 }] }], [{ check: "none", timeout: 2e3, wv: 2081 }], {}], [1, "nyu-langone", 2, "", 22, [2086], [{ e: 2087 }], [{ v: 2088 }], [{ c: 2089 }], [{ cc: 2090 }], {}], [1, "occ-gdpr", 2, "", 22, [2091], [{ e: 2092 }], [{ v: 2093 }], [{ c: 2094 }, { wv: 2095 }, { if: { e: 2096 }, then: [{ all: true, k: 2096 }] }, { k: 2095 }], [{ cc: 2097 }], {}], [1, "olx-cookie-notice", 2, "", 22, [2098], [{ e: 2099 }], [{ v: 2098 }], [{ c: 2099 }], [{ cc: 2100 }], {}], [1, "om", 2, "", 22, [2101, 2102], [{ e: 2103 }], [{ e: 2103 }], [{ if: { e: 2104 }, then: [{ c: 2104 }], else: [{ all: true, optional: true, k: 2105 }, { c: 2106 }] }], [], {}], [1, "onecom-cookie-banner", 1, "", 22, [2107], [{ e: 2108 }], [{ v: 2107 }], [{ h: 2107 }], [], {}], [1, "op-consent-manager", 0, "", 10, [2109], [{ e: 2110 }], [{ v: 2109 }], [{ c: 2111 }, { check: "none", wv: 2109 }], [{ cc: 2112 }], {}], [1, "opencart-google-consent-v2", 2, "", 22, [2113], [{ e: 2114 }], [{ v: 2115 }], [{ if: { v: 2116 }, then: [{ k: 2116 }], else: [{ optional: true, k: 2117 }, { all: true, optional: true, k: 2118 }, { k: 2114 }] }], [{ any: [{ cc: 2119 }, { cc: 2120 }] }], {}], [1, "opencmp", 2, "", 22, [], [{ exists: [".cmp-root-container", "#cmp_consentDialog .cmp_ui .cmp_mainButtons"] }], [{ visible: [".cmp-root-container", "#cmp_consentDialog .cmp_ui"] }], [{ if: { exists: [".cmp-root-container", ".cmp_ui .cmp_mainButtons .cmp_button:not(.cmp-button-accept-all)"] }, then: [{ click: [".cmp-root-container", ".cmp_ui .cmp_mainButtons .cmp_button:not(.cmp-button-accept-all)"] }], else: [{ click: [".cmp-root-container", ".cmp_ui .cmp_mainButtons .cmp_saveLink a"] }, { waitFor: [".cmp-root-container", ".cmp_ui .cmp_level1Container"], timeout: 3e3 }, { click: [".cmp-root-container", ".cmp_ui .cmp_activateAll button:nth-child(2)"], all: true, optional: true }, { click: [".cmp-root-container", ".cmp_ui .cmp_level1Container .cmp_levelItem:nth-child(2) > div"], optional: true }, { waitFor: [".cmp-root-container", ".cmp_ui .cmp_level1Container .cmp_levelItem.cmp_active:nth-child(2)"], timeout: 2e3, optional: true }, { click: [".cmp-root-container", ".cmp_ui .cmp_activateAll button:nth-child(2)"], all: true, optional: true }, { click: [".cmp-root-container", ".cmp_ui .cmp_mainButtons .cmp_saveLink a"] }] }], [{ waitForVisible: [".cmp-root-container", "#cmp_consentDialog .cmp_ui"], timeout: 2e3, check: "none" }], {}], [1, "optum-legal-banner", 2, "", 22, [2121], [{ e: 2122 }], [{ v: 2121 }], [{ c: 2122 }], [{ check: "none", timeout: 2e3, wv: 2121 }], {}], [1, "orejime", 2, "", 22, [2123, 2124, 2125], [{ e: 2126 }], [{ v: 2126 }], [{ if: { e: 2127 }, then: [{ c: 2128 }], else: [{ optional: true, timeout: 1e3, c: 2129 }, { c: 2130 }] }], [{ check: "none", timeout: 2e3, wv: 2126 }], {}], [2, "orw-cookie-banner", 1, "", 22, [2131], [{ e: 2131 }], [{ v: 2132 }], [{ h: 2131 }, { removeClass: "cookie-not-accepted", selector: "body", optional: true }, { removeClass: "drawer-opt", selector: "body", optional: true }, { removeClass: "show-overlay", selector: "body", optional: true }], [], {}], [1, "osano", 2, "", 22, [2133], [{ e: 2134 }], [{ eval: "EVAL_OSANO_DETECT" }, { v: 2135 }], [{ if: { e: 2136 }, then: [{ k: 2136 }], else: [{ if: { v: 2137 }, then: [{ k: 2137 }], else: [{ h: 2133 }] }] }], [], {}], [1, "outdooractive", 2, "", 22, [2138], [{ e: 2139 }], [{ v: 2139 }], [{ retry: 5, retryInterval: 500, c: 2139 }], [{ timeout: 2e3, check: "none", wv: 2139 }], {}], [1, "overleaf", 2, "", 22, [2140], [{ e: 2141 }], [{ v: 2141 }], [{ c: 2142 }], [{ cc: 2143 }], {}], [1, "pandectes", 2, "", 22, [2144, 2145], [{ any: [{ e: 2146 }, { exists: ["pandectes-cmp", "dialog.notice, dialog.preferences"] }] }], [{ any: [{ v: 2144 }, { visible: ["pandectes-cmp", "dialog.notice, dialog.preferences"], check: "any" }] }], [{ if: { e: 2146 }, then: [{ if: { v: 2147 }, then: [{ c: 2147 }], else: [{ c: 2148 }, { wv: 2149 }, { k: 2150 }, { k: 2149 }] }, { optional: true, h: 2144 }], else: [{ if: { visible: ["pandectes-cmp", "dialog.notice button.deny"] }, then: [{ waitForThenClick: ["pandectes-cmp", "dialog.notice button.deny"] }], else: [{ if: { exists: ["pandectes-cmp", "dialog.notice"] }, then: [{ waitForThenClick: ["pandectes-cmp", "dialog.notice button.preferences"] }] }, { waitForVisible: ["pandectes-cmp", "dialog.preferences"] }, { if: { exists: ["pandectes-cmp", "dialog.preferences button.deny"] }, then: [{ click: ["pandectes-cmp", "dialog.preferences button.deny"] }], else: [{ click: ["pandectes-cmp", "dialog.preferences button[role=switch][aria-checked=true]:not([disabled])"], all: true, optional: true }, { click: ["pandectes-cmp", "dialog.preferences button.custom"] }] }] }] }], [{ wait: 500 }, { eval: "EVAL_PANDECTES_TEST" }], {}], [1, "passenger-cookie-opt-in", 2, "", 22, [2151], [{ e: 2152 }], [{ v: 2153 }], [{ c: 2154 }, { c: 2155 }], [{ cc: 2156 }], {}], [1, "passle", 2, "", 22, [2157], [{ e: 2158 }], [{ v: 2159 }], [{ c: 2160 }], [{ wait: 1e3 }, { cc: 2161 }], {}], [1, "paypal-us", 2, "", 22, [2162], [{ e: 2163 }], [{ v: 2163 }], [{ if: { e: 2164 }, then: [{ retry: 10, retryInterval: 500, c: 2164 }], else: [{ h: 2163 }] }], [{ wait: 1e3 }, { cc: 2165 }], {}], [1, "paypal.com", 2, "", 22, [2166], [{ e: 2166 }], [{ v: 2167 }], [{ retry: 10, retryInterval: 500, c: 2164 }], [{ wait: 500 }, { cc: 2165 }], {}], [1, "paytronix", 2, "", 22, [2168], [{ e: 2169 }], [{ v: 2168 }], [{ c: 2170 }], [{ cc: 2171 }], {}], [1, "pe-cookies", 2, "", 22, [2172], [{ exists: ["pe-cookies", "#pecookies-continue-btn"] }], [{ visible: ["pe-cookies", ".pecookies__modal"] }], [{ waitForThenClick: ["pe-cookies", "#pecookies-continue-btn"] }], [{ cc: 2173 }], {}], [1, "perplex-cookie-consent", 2, "", 22, [2174, 2175], [{ e: 2176 }], [{ v: 2176 }], [{ retry: 20, retryInterval: 1e3, c: 2176 }], [{ check: "none", timeout: 2e3, wv: 2176 }], {}], [1, "personalization-request", 2, "", 22, [2177], [{ e: 2178 }], [{ v: 2178 }], [{ c: 2178 }, { wv: 2179 }, { all: true, optional: true, k: 2180 }, { k: 2179 }], [{ cc: 2181 }], {}], [1, "pieeye", 2, "", 22, [2182], [{ exists: [".pieeye-consent-container iframe", ".allow-all-button"] }], [{ visible: [".pieeye-consent-container iframe", ".allow-all-button"] }], [{ if: { exists: [".pieeye-consent-container iframe", ".necessary-only-button"] }, then: [{ waitForThenClick: [".pieeye-consent-container iframe", ".necessary-only-button"] }], else: [{ waitForThenClick: [".pieeye-consent-container iframe", ".preferences-button"] }, { waitFor: [".pieeye-consent-container iframe", "[class*='CookieDetails_BannerCheck'] input"], timeout: 2e3 }, { click: [".pieeye-consent-container iframe", "[class*='CookieDetails_BannerCheck'] input:checked:not([disabled])"], all: true, optional: true }, { waitForThenClick: [".pieeye-consent-container iframe", ".allow-selection-button"] }] }], [{ wait: 500 }, { cc: 2183 }], {}], [1, "pigu", 2, "", 22, [], [{ e: 2184 }], [{ v: 2185 }], [{ retry: 10, retryInterval: 500, c: 2185 }], [{ check: "none", timeout: 2e3, wv: 2185 }], {}], [1, "pikpak", 2, "", 22, [2186], [{ e: 2187 }], [{ v: 2188 }], [{ c: 2189 }, { wv: 2190 }, { all: true, optional: true, k: 2191 }, { c: 2192 }], [{ any: [{ cc: 2193 }, { cc: 2194 }] }], {}], [1, "piwik-pro", 2, "", 22, [2195, 2196, 2197], [{ e: 2198 }], [{ check: "any", v: 2199 }], [{ if: { e: 2200 }, then: [{ c: 2200 }, { timeout: 1e3, optional: true, c: 2201 }], else: [{ if: { v: 2202 }, then: [{ k: 2202 }], else: [{ c: 2203 }, { timeout: 2e3, wv: 2204 }, { if: { v: 2202 }, then: [{ k: 2202 }], else: [{ all: true, optional: true, k: 2205 }, { if: { v: 2206 }, then: [{ k: 2206 }], else: [{ k: 2203 }] }] }] }] }], [{ cc: 2078 }, { cc: 2207 }], {}], [1, "pl-bip-cookies", 1, "", 22, [2208], [{ e: 2209 }], [{ v: 2210 }], [{ h: 2210 }], [], {}], [1, "planned-parenthood", 2, "", 22, [2211], [{ e: 2212 }, { e: 2213 }], [{ v: 2211 }], [{ c: 2212 }, { wv: 2214 }, { c: 2213 }], [{ cc: 2215 }], {}], [1, "plentyshop", 2, "", 22, [2216], [{ e: 2217 }], [{ check: "any", v: 2218 }], [{ if: { e: 2219 }, then: [{ c: 2219 }], else: [{ c: 2220 }] }], [{ check: "none", v: 2218 }, { cc: 2221 }], {}], [1, "plumrocket-cookie-consent", 2, "", 22, [], [{ e: 2222 }], [{ v: 2222 }, { negated: true, e: 2223 }], [{ if: { e: 2224 }, then: [{ c: 2224 }], else: [{ c: 2225 }, { c: 2226 }] }], [{ cc: 2227 }], {}], [1, "pmc", 1, "", 22, [2228], [{ e: 2228 }], [{ v: 2228 }], [{ h: 2228 }], [], {}], [1, "pmc-privacy-banner", 2, "", 22, [2229], [{ e: 2229 }, { e: 2230 }, { negated: true, e: 2231 }], [{ v: 2229 }, { negated: true, e: 2231 }], [{ c: 2232 }], [{ check: "none", v: 2229 }], {}], [1, "police-uk", 2, "", 22, [2233], [{ e: 2234 }], [{ v: 2234 }], [{ c: 2234 }, { timeout: 5e3, optional: true, wv: 2235 }, { optional: true, k: 2235 }], [{ cc: 2236 }], {}], [1, "polisen-se", 0, "", 10, [2237], [{ e: 2238 }], [{ v: 2237 }], [{ c: 2239 }], [{ check: "none", timeout: 3e3, optional: true, wv: 2237 }, { cc: 2240 }], {}], [1, "popupsmart-cookie-notice", 1, "", 22, [2241], [{ e: 2242 }], [{ v: 2243 }], [{ h: 2241 }], [], {}], [1, "pornhat", 1, "", 22, [2244], [{ v: 2245 }], [{ v: 2245 }], [{ h: 2244 }], [], {}], [1, "prestashop-advanced-cookie-banner", 2, "", 22, [2246], [{ e: 2247 }], [{ check: "any", v: 2246 }], [{ if: { check: "any", v: 2248 }, then: [{ c: 2248 }], else: [{ all: true, optional: true, k: 2249 }, { c: 2250 }] }], [{ cc: 2251 }], {}], [1, "pride.com", 1, "", 22, [2252], [{ e: 2253 }], [{ v: 2253 }], [{ h: 2252 }], [], {}], [1, "PrimeBox CookieBar", 2, "", 22, [745], [{ e: 2254 }], [{ check: "any", v: 2254 }], [{ optional: true, k: 2255 }, { h: 745 }], [{ negated: true, cc: 2256 }], {}], [1, "primeconsent", 2, "", 22, [2257], [{ exists: [".azpp-cookie-consent", ".banner-main"] }], [{ visible: [".azpp-cookie-consent", ".banner-main .button-group > button"] }], [{ waitForThenClick: [".azpp-cookie-consent", ".banner-main .button-group > button:nth-of-type(2):nth-last-of-type(2)"] }], [{ any: [{ cc: 2258 }, { cc: 2259 }] }], {}], [1, "privacy-area", 0, "", 22, [2260], [{ e: 2261 }, { e: 2262 }], [{ v: 2260 }], [{ if: { e: 2263 }, then: [{ k: 2263 }], else: [{ all: true, optional: true, k: 2264 }, { k: 2262 }] }, { check: "none", timeout: 3e3, wv: 2260 }], [{ cc: 2265 }], {}], [1, "privacy-policy-pop", 1, "", 22, [2266], [{ e: 2267 }], [{ v: 2268 }], [{ h: 2268 }], [], {}], [1, "privacylab-elmo", 2, "", 22, [2269], [{ e: 2270 }], [{ v: 2271 }], [{ c: 2272 }], [{ wait: 500 }, { cc: 2273 }], {}], [1, "pro-euclp-cookies-box", 1, "", 22, [2274], [{ e: 2275 }], [{ v: 2274 }], [{ h: 2274 }], [{ check: "none", v: 2274 }], {}], [1, "progorod", 1, "", 22, [2276], [{ e: 2277 }], [{ v: 2276 }], [{ h: 2276 }], [{ check: "none", v: 2276 }], {}], [1, "pubfactory", 0, "", 22, [2278], [{ e: 2278 }], [{ v: 2278 }], [{ timeout: 2e4, optional: true, w: 2279 }, { c: 2280 }, { check: "none", wv: 2278 }], [{ cc: 2281 }], {}], [1, "pubtech", 2, "", 22, [2282], [{ e: 2282 }], [{ v: 2283 }], [{ if: { e: 2284 }, then: [{ k: 2284 }], else: [{ k: 2285 }] }], [{ eval: "EVAL_PUBTECH_0" }], {}], [1, "purecookie-cosmetic", 1, "", 22, [2286], [{ e: 2287 }], [{ v: 2286 }], [{ h: 2286 }], [{ check: "none", v: 2286 }], {}], [1, "pvh", 2, "", 22, [2288], [{ e: 2289 }], [{ v: 2290 }], [{ c: 2289 }], [{ cc: 2291 }], {}], [1, "qtip-jgrowl-cookies", 2, "", 22, [], [{ e: 2292 }], [{ v: 2292 }], [{ c: 2293 }], [{ check: "none", timeout: 2e3, wv: 2292 }], {}], [1, "quantcast", 2, "", 22, [2294], [{ e: 2295 }], [{ v: 2296 }], [{ if: { e: 2297 }, then: [{ timeout: 2e3, optional: true, w: 2298 }, { all: true, optional: true, k: 2299 }, { timeout: 2e3, optional: true, w: 2300 }, { all: true, optional: true, k: 2301 }, { timeout: 2e3, c: 2302 }, { timeout: 2e3, optional: true, c: 2303 }], else: [{ if: { e: 2304 }, then: [{ timeout: 5e3, c: 2305 }], else: [{ timeout: 2e3, w: 2306 }, { if: { e: 2307 }, then: [{ k: 2307 }], else: [{ k: 2308 }, { wv: 2309 }, { all: true, optional: true, k: 2310 }, { click: [".qc-cmp2-main", "xpath///button[contains(., 'REJECT ALL') or contains(., 'ALLE VERWERPEN') or contains(., '\u0391\u03A0\u039F\u03A1\u03A1\u0399\u03A0\u03A4\u03A9 \u03A4\u0391 \u03A0\u0391\u039D\u03A4\u0391') or contains(., 'RESPINGERE TOTAL\u0102') or contains(., 'ALLE ABLEHNEN') or contains(., 'ODRZUCENIE') or contains(., 'BLOQUEAR TODO') or contains(., 'REJEITAR TODOS') or contains(., 'RIFIUTA TUTTO') or contains(., 'TOUT REFUSER') or contains(., '\u041E\u0422\u041A\u041B\u041E\u041D\u0418\u0422\u042C \u0412\u0421\u0415\u0425')]"], optional: true }, { check: "none", timeout: 1e3, optional: true, wv: 2311 }, { if: { v: 2311 }, then: [{ if: { e: 2312 }, then: [{ k: 2312 }], else: [{ waitForThenClick: [".qc-cmp2-main", "xpath///button[contains(.,'SAVE & EXIT') or contains(.,'SALVA ED ESCI') or contains(.,'GUARDAR Y SALIR') or contains(.,'SPEICHERN & VERLASSEN')"], timeout: 5e3 }] }] }] }] }] }], [], {}], [1, "quick-cookie-consent", 2, "", 22, [2313], [{ e: 2314 }], [{ v: 2314 }], [{ c: 2314 }, { wv: 2315 }, { if: { e: 2316 }, then: [{ k: 2317 }] }, { if: { e: 2318 }, then: [{ k: 2318 }], else: [{ k: 2319 }] }], [{ cc: 2320 }, { negated: true, cc: 2321 }, { negated: true, cc: 2322 }, { negated: true, cc: 2323 }], {}], [1, "quorn", 0, "", 22, [], [{ e: 2324 }], [{ v: 2325 }], [{ c: 2326 }, { wv: 2327 }, { all: true, optional: true, k: 2328 }, { k: 2327 }, { check: "none", timeout: 2e3, optional: true, wv: 2324 }], [{ check: "none", v: 2324 }], {}], [1, "r42-consent-iframe", 0, "", 10, [], [{ exists: ["#consent_iframe", ".stsp__cookie-container #declineButton"] }], [{ v: 2329 }, { visible: ["#consent_iframe", ".stsp__cookie-container #declineButton"] }], [{ waitForThenClick: ["#consent_iframe", ".stsp__cookie-container #declineButton"] }], [{ cc: 2330 }], {}], [1, "r42-cookiebar", 0, "", 10, [2331], [{ e: 2332 }], [{ v: 2333 }], [{ c: 2332 }], [{ timeout: 1e3, check: "none", wv: 2332 }], {}], [1, "r42-st-popup", 0, "", 10, [], [{ e: 2334 }], [{ v: 2334 }], [{ c: 2334 }], [{ timeout: 1e3, check: "none", wv: 2335 }], {}], [1, "rabobank", 2, "", 22, [2336], [{ e: 2336 }], [{ v: 2336 }], [{ if: { e: 2337 }, then: [{ retry: 10, retryInterval: 500, c: 2337 }], else: [{ retry: 10, retryInterval: 500, c: 2338 }] }], [{ cc: 2339 }], {}], [1, "radboud-cookie-overlay", 2, "", 22, [], [{ e: 2340 }], [{ v: 2341 }], [{ c: 2342 }], [{ cc: 2343 }], {}], [1, "radio-canada", 1, "", 22, [2344], [{ e: 2344 }], [{ check: "any", v: 2344 }], [{ h: 2344 }], [], {}], [1, "radish-cookie-consent", 2, "", 22, [2345], [{ e: 2346 }], [{ v: 2345 }], [{ c: 2347 }, { wv: 2348 }, { all: true, optional: true, k: 2349 }, { c: 2346 }], [], {}], [2, "rakshaos", 0, "", 22, [2350, 2351], [{ e: 2350 }], [{ v: 2350 }], [{ if: { e: 2352 }, then: [{ c: 2352 }], else: [{ c: 2353 }, { c: 2354 }, { addStyle: "display: none !important", selector: "#raksha-consent-banner" }] }], [], {}], [1, "rambler", 2, "", 22, [2355], [{ e: 2355 }], [{ v: 2355 }], [{ c: 2356 }], [{ cc: 2357 }], {}], [1, "rcs-cpmt", 2, "", 22, [2358], [{ exists: ["#_cpmt-iframe", "#_cpmt"] }], [{ v: 2358 }, { visible: ["#_cpmt-iframe", "#_cpmt"] }], [{ waitForThenClick: ["#_cpmt-iframe", "#_cpmt-reject"] }], [], {}], [1, "rct-cookies-modal", 2, "", 22, [2359], [{ e: 2359 }], [{ v: 2359 }], [{ c: 2360 }, { w: 2361 }, { c: 2360 }], [{ cc: 2362 }], {}], [1, "rdc-concents", 2, "", 22, [2363, 2364], [{ e: 2365 }], [{ v: 2365 }], [{ c: 2365 }], [{ negated: true, e: 2366 }], {}], [1, "react-cookie-consent", 2, "", 22, [], [{ e: 2367 }], [{ v: 2367 }], [{ c: 2367 }], [{ timeout: 1e3, check: "none", wv: 2367 }], {}], [1, "react-cookie-consent-cosmetic", 1, "", 22, [2368], [{ v: 2369 }, { negated: true, e: 2367 }, { negated: true, e: 2370 }], [{ v: 2369 }], [{ h: 2371 }, { optional: true, h: 2372 }], [], {}], [1, "real-cookie-banner", 0, "", 10, [2373], [{ e: 2374 }], [{ v: 2374 }], [{ retry: 10, retryInterval: 500, c: 2375 }], [{ timeout: 1e3, check: "none", wv: 2374 }], {}], [1, "remove-cookie-notice", 2, "", 22, [2376], [{ e: 2377 }], [{ v: 2378 }], [{ c: 2377 }, { check: "none", timeout: 2e3, wv: 2379 }], [{ check: "none", v: 2379 }], {}], [1, "reviq", 2, "", 22, [], [{ exists: ["[data-reviq-cmp=host]", "[data-reviq-cmp=banner]"] }], [{ visible: ["[data-reviq-cmp=host]", "[data-reviq-cmp=first-layer] [data-reviq-cmp=banner]"] }], [{ if: { visible: ["[data-reviq-cmp=host]", "[data-reviq-cmp=banner] [data-cmp-action=reject]"] }, then: [{ click: ["[data-reviq-cmp=host]", "[data-reviq-cmp=banner] [data-cmp-action=reject]"] }], else: [{ click: ["[data-reviq-cmp=host]", "[data-reviq-cmp=banner] [data-cmp-action=customize]"] }, { waitForThenClick: ["[data-reviq-cmp=host]", "[data-reviq-cmp=overlay] [data-cmp-action=reject]"] }] }], [{ waitForVisible: ["[data-reviq-cmp=host]", "[data-reviq-cmp=first-layer] [data-reviq-cmp=banner]"], check: "none", timeout: 2e3 }], {}], [1, "rijksoverheid-notification-bar", 0, "", 10, [2380], [{ e: 2381 }], [{ v: 2382 }], [{ c: 2383 }], [{ cc: 2384 }], {}], [1, "ring", 2, "", 22, [], [{ e: 2385 }], [{ v: 2386 }], [{ c: 2385 }, { wv: 2387 }, { all: true, optional: true, k: 2388 }, { c: 2389 }], [], {}], [1, "rocket-cookie-consent-dialog", 1, "", 22, [2390], [{ exists: ["cookie-consent-dialog", "#cookie-consent-dialog-description"] }], [{ visible: ["cookie-consent-dialog", "[role=dialog][aria-labelledby=cookie-consent-dialog-description]"] }], [{ h: 2390 }], [], {}], [1, "rws-app", 2, "", 22, [2391], [{ e: 2391 }], [{ v: 2391 }], [{ c: 2392 }], [{ cc: 2393 }], {}], [1, "sachsen-cookiebar", 2, "", 22, [2394], [{ e: 2395 }], [{ v: 2396 }], [{ c: 2397 }], [{ e: 2398 }], {}], [1, "sandstudio-cookie-tip", 2, "", 22, [2399], [{ e: 2400 }], [{ v: 2399 }], [{ c: 2400 }], [{ cc: 2401 }], {}], [1, "sankei-digital", 0, "", 10, [2402], [{ e: 2403 }], [{ v: 2403 }], [{ c: 2403 }], [{ cc: 2404 }], {}], [1, "sarmady", 0, "", 22, [2405, 2406], [{ e: 2407 }, { e: 2408 }], [{ v: 2408 }], [{ c: 2408 }], [{ check: "none", timeout: 2e3, wv: 2409 }], {}], [1, "sas", 2, "", 22, [2410], [{ e: 2411 }], [{ v: 2412 }], [{ c: 2411 }], [{ cc: 707 }], {}], [1, "savills", 2, "", 22, [2413], [{ e: 2413 }], [{ v: 2414 }], [{ c: 2415 }, { wv: 2416 }, { if: { e: 2417 }, then: [{ k: 2418 }] }, { if: { e: 2419 }, then: [{ k: 2420 }] }, { k: 2421 }], [{ cc: 976 }], {}], [1, "sc-cookie-banner", 2, "", 22, [2422], [{ e: 2423 }], [{ v: 2424 }], [{ c: 2423 }], [{ cc: 2425 }], {}], [1, "scottish-government-design-system", 2, "", 22, [2426], [{ e: 2427 }], [{ v: 2427 }], [{ c: 2427 }], [{ cc: 2428 }], {}], [1, "scriptex", 0, "", 22, [2429], [{ exists: ["scriptex-consent-banner", "#scriptexConsentBannerBox"] }], [{ visible: ["scriptex-consent-banner", "#scriptexConsentBannerBox"] }], [{ waitForThenClick: ["scriptex-consent-banner", "#scriptexConsentDeny"] }], [{ check: "none", v: 2429 }], {}], [1, "securiti-gpc-flyout", 2, "", 22, [2430], [{ e: 2431 }], [{ v: 2430 }, { negated: true, e: 2432 }], [{ retry: 2, c: 2433 }], [{ check: "none", v: 2434 }], {}], [1, "securiti-hybrid", 2, "", 22, [2435], [{ e: 2436 }], [{ v: 2437 }], [{ if: { v: 2438 }, then: [{ k: 2438 }], else: [{ k: 2436 }, { wv: 648 }, { if: { v: 649 }, then: [{ k: 649 }], else: [{ all: true, optional: true, k: 2439 }] }, { k: 648 }] }], [], {}], [1, "sedlak-gdpr-cookie", 2, "", 22, [2440], [{ e: 2441 }], [{ v: 2441 }], [{ c: 2441 }], [{ cc: 2442 }], {}], [1, "selection-cookie-banner", 0, "", 22, [], [{ e: 2443 }], [{ v: 2444 }], [{ all: true, optional: true, k: 2445 }, { c: 2446 }], [{ cc: 603 }], {}], [1, "set-group-pdpa", 1, "", 22, [2447], [{ e: 2448 }], [{ v: 2447 }], [{ h: 2447 }], [{ check: "none", v: 2447 }], {}], [1, "setupad", 2, "", 22, [2449], [{ e: 2450 }], [{ v: 2450 }], [{ if: { e: 2451 }, then: [{ c: 2451 }], else: [{ c: 2452 }, { wv: 2453 }, { all: true, optional: true, k: 2454 }, { c: 2451 }] }, { check: "none", wv: 2449 }], [{ cc: 2455 }], {}], [1, "sg-cookie-optin", 2, "", 22, [], [{ e: 2456 }], [{ check: "any", v: 2457 }], [{ c: 2457 }], [{ cc: 2458 }], {}], [1, "sg-cookies", 2, "", 22, [2459], [{ e: 2459 }], [{ v: 2460 }, { v: 2459 }, { e: 2461 }], [{ if: { e: 2462 }, then: [{ c: 2462 }, { check: "none", timeout: 2e3, wv: 2459 }], else: [{ if: { e: 2463 }, then: [{ k: 2463 }, { check: "none", timeout: 2e3, wv: 2459 }], else: [{ all: true, optional: true, k: 2464 }, { k: 2465 }] }] }], [{ cc: 2466 }, { cc: 2467 }], {}], [1, "shopblocks", 2, "", 22, [2468], [{ e: 2469 }], [{ v: 2470 }], [{ c: 2471 }, { wv: 2472 }, { all: true, optional: true, k: 2473 }, { c: 2474 }], [{ cc: 2475 }], {}], [1, "shoper", 2, "", 22, [2476], [{ e: 2477 }], [{ v: 2477 }], [{ c: 2477 }], [{ check: "none", timeout: 1e3, wv: 2477 }], {}], [1, "shopgold", 2, "", 22, [2478, 2479], [{ e: 2480 }], [{ any: [{ v: 2481 }, { v: 2482 }] }], [{ if: { v: 2481 }, then: [{ if: { e: 2483 }, then: [{ c: 2483 }], else: [{ k: 2484 }, { wv: 2479 }, { all: true, optional: true, k: 2485 }, { k: 2486 }] }], else: [{ c: 2482 }] }], [{ cc: 2487 }], {}], [1, "shopify", 0, "", 22, [2488], [{ e: 2488 }], [{ v: 2488 }], [{ c: 2489 }], [{ eval: "EVAL_SHOPIFY_TEST" }], {}], [1, "shopify-dux", 0, "", 22, [2490], [{ e: 2491 }], [{ v: 2492 }], [{ c: 2491 }], [{ timeout: 2e3, w: 2493 }], {}], [1, "shopware", 2, "", 22, [2494], [{ e: 2495 }], [{ v: 2494 }], [{ if: { e: 2496 }, then: [{ c: 2497 }], else: [{ c: 2498 }, { c: 2499 }] }], [{ timeout: 2e3, check: "none", wv: 2494 }, { wait: 500 }, { cc: 2500 }], {}], [1, "shopware5", 2, "", 22, [2501], [{ any: [{ e: 2502 }, { e: 2503 }] }], [{ any: [{ v: 2504 }, { v: 2505 }] }], [{ if: { v: 2506 }, then: [{ c: 2506 }], else: [{ c: 2507 }, { c: 2508 }, { if: { v: 2509 }, then: [{ k: 2509 }] }] }], [{ timeout: 2e3, check: "none", wv: 2510 }, { any: [{ cc: 2511 }, { cc: 2512 }] }], {}], [1, "shopware5-spx", 2, "", 22, [2513], [{ e: 2514 }], [{ v: 2513 }], [{ c: 2515 }, { timeout: 3e3, wv: 2516 }, { c: 2517 }], [{ cc: 2511 }], {}], [1, "shouldianswer", 1, "", 10, [2518], [{ e: 2518 }], [{ v: 2519 }], [{ h: 2518 }], [], {}], [1, "shueisha-gigaviewer", 2, "", 22, [2520], [{ e: 2521 }], [{ v: 2522 }], [{ c: 2523 }], [{ timeout: 1e3, check: "none", wv: 2520 }], {}], [1, "shueisha-hpplus", 2, "", 22, [2524], [{ e: 2525 }], [{ check: "any", v: 2524 }], [{ c: 2525 }], [{ timeout: 2e3, check: "none", wv: 2524 }], {}], [1, "sicredi", 2, "", 22, [2526], [{ e: 2527 }], [{ v: 2528 }], [{ c: 2529 }, { c: 2530 }], [], {}], [1, "silktide", 2, "", 22, [2531, 2532], [{ e: 2531 }], [{ v: 2531 }], [{ if: { e: 2533 }, then: [{ k: 2533 }], else: [{ k: 2534 }, { c: 2535 }] }], [{ check: "none", timeout: 2e3, wv: 2531 }], {}], [1, "simpleview-cookie-banner", 1, "", 22, [2536, 2537], [{ e: 2538 }], [{ check: "any", v: 2539 }], [{ h: 2540 }], [], {}], [1, "Sirdata", 0, "", 22, [2541], [{ e: 2541 }], [{ check: "any", v: 2542 }], [{ if: { exists: ["#sd-cmp", "xpath///button[contains(., 'Do not accept') or contains(., 'Acceptera inte') or contains(., 'No aceptar') or contains(., 'Ikke acceptere') or contains(., 'Nicht akzeptieren') or contains(., '\u041D\u0435 \u043F\u0440\u0438\u0435\u043C\u0430\u043C') or contains(., '\u039D\u03B1 \u03BC\u03B7\u03BD \u03B3\u03AF\u03BD\u03B5\u03B9 \u03B1\u03C0\u03BF\u03B4\u03BF\u03C7\u03AE') or contains(., 'Niet accepteren') or contains(., 'Nep\u0159ij\xEDmat') or contains(., 'Nie akceptuj') or contains(., 'Nu accepta\u021Bi') or contains(., 'N\xE3o aceitar') or contains(., 'Continuer sans accepter') or contains(., 'Non accettare') or contains(., 'Nem fogad el')]"] }, then: [{ waitForThenClick: ["#sd-cmp", "xpath///button[contains(., 'Do not accept') or contains(., 'Acceptera inte') or contains(., 'No aceptar') or contains(., 'Ikke acceptere') or contains(., 'Nicht akzeptieren') or contains(., '\u041D\u0435 \u043F\u0440\u0438\u0435\u043C\u0430\u043C') or contains(., '\u039D\u03B1 \u03BC\u03B7\u03BD \u03B3\u03AF\u03BD\u03B5\u03B9 \u03B1\u03C0\u03BF\u03B4\u03BF\u03C7\u03AE') or contains(., 'Niet accepteren') or contains(., 'Nep\u0159ij\xEDmat') or contains(., 'Nie akceptuj') or contains(., 'Nu accepta\u021Bi') or contains(., 'N\xE3o aceitar') or contains(., 'Continuer sans accepter') or contains(., 'Non accettare') or contains(., 'Nem fogad el')]"] }], else: [{ if: { exists: ["#sd-cmp", "xpath///span[contains(., '\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0432\u0430\u0448\u0438\u0442\u0435 \u0438\u0437\u0431\u043E\u0440\u0438') or contains(., 'Nastavit va\u0161e volby') or contains(., 'Angiv dine valg') or contains(., 'Ihre Auswahl treffen') or contains(., '\u039F\u03C1\u03AF\u03C3\u03C4\u03B5 \u03C4\u03B9\u03C2 \u03B5\u03C0\u03B9\u03BB\u03BF\u03B3\u03AD\u03C2 \u03C3\u03B1\u03C2') or contains(., 'Set your choices') or contains(., 'Establecer preferencias') or contains(., 'Param\xE9trer vos choix') or contains(., 'V\xE1lassza ki a be\xE1ll\xEDt\xE1sokat') or contains(., 'Imposta le tue scelte') or contains(., 'Stel uw keuzes in') or contains(., 'Ustaw swoje wybory') or contains(., 'Definir suas escolhas') or contains(., 'Seta\u021Bi-v\u0103 op\u021Biunile') or contains(., 'St\xE4ll in dina val')]"] }, then: [{ waitForThenClick: ["#sd-cmp", "xpath///span[contains(., '\u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u0432\u0430\u0448\u0438\u0442\u0435 \u0438\u0437\u0431\u043E\u0440\u0438') or contains(., 'Nastavit va\u0161e volby') or contains(., 'Angiv dine valg') or contains(., 'Ihre Auswahl treffen') or contains(., '\u039F\u03C1\u03AF\u03C3\u03C4\u03B5 \u03C4\u03B9\u03C2 \u03B5\u03C0\u03B9\u03BB\u03BF\u03B3\u03AD\u03C2 \u03C3\u03B1\u03C2') or contains(., 'Set your choices') or contains(., 'Establecer preferencias') or contains(., 'Param\xE9trer vos choix') or contains(., 'V\xE1lassza ki a be\xE1ll\xEDt\xE1sokat') or contains(., 'Imposta le tue scelte') or contains(., 'Stel uw keuzes in') or contains(., 'Ustaw swoje wybory') or contains(., 'Definir suas escolhas') or contains(., 'Seta\u021Bi-v\u0103 op\u021Biunile') or contains(., 'St\xE4ll in dina val')]"] }, { waitForThenClick: ["#sd-cmp", "xpath///span[contains(., '\u041E\u0442\u0445\u0432\u044A\u0440\u043B\u044F\u043C \u0432\u0441\u0438\u0447\u043A\u043E') or contains(., 'Odm\xEDtnout v\u0161e') or contains(., 'Afvis alt') or contains(., 'Alle ablehnen') or contains(., '\u0391\u03C0\u03CC\u03C1\u03C1\u03B9\u03C8\u03B7 \u03CC\u03BB\u03C9\u03BD') or contains(., 'Reject all') or contains(., 'Rechazar todo') or contains(., 'Tout refuser') or contains(., 'Mind elutas\xEDt\xE1sa') or contains(., 'Rifiuta tutto') or contains(., 'Alles weigeren') or contains(., 'Odrzu\u0107 wszystkie') or contains(., 'Rejeitar todos') or contains(., 'Respinge\u021Bi toate') or contains(., 'Avvisa allt')]"] }], else: [{ check: "any", wv: 2543 }, { k: 2543 }] }] }], [], {}], [1, "site-notifications-cookie-usage", 1, "", 22, [2544], [{ e: 2544 }], [{ v: 2544 }], [{ h: 2544 }], [], {}], [1, "sitecore-privacy-warning", 2, "", 22, [2545], [{ e: 2546 }], [{ v: 2545 }], [{ c: 2547 }], [{ check: "none", timeout: 1e3, wv: 2545 }], {}], [1, "sitepark-sitekit", 2, "", 22, [2548], [{ e: 2548 }], [{ v: 2548 }], [{ if: { e: 2549 }, then: [{ timeout: 5e3, optional: true, w: 2550 }, { retry: 5, retryInterval: 500, c: 2551 }], else: [{ h: 2548 }] }], [], {}], [1, "sitevision", 2, "", 22, [2552], [{ e: 2552 }], [{ v: 2552 }], [{ if: { e: 2553 }, then: [{ k: 2553 }], else: [{ k: 2554 }, { wv: 2555 }, { all: true, optional: true, k: 2556 }, { k: 2555 }] }], [{ check: "none", timeout: 2e3, wv: 2552 }], {}], [1, "sitevision-cookie-consent", 2, "", 22, [2557], [{ e: 2557 }], [{ v: 2557 }], [{ if: { e: 2558 }, then: [{ k: 2558 }], else: [{ k: 2559 }, { wv: 2560 }, { all: true, optional: true, k: 2561 }, { k: 2560 }] }], [], {}], [1, "sitevision-iw-cookie", 2, "", 22, [2562], [{ e: 2562 }], [{ v: 2562 }], [{ if: { e: 2563 }, then: [{ k: 2564 }], else: [{ k: 2565 }, { wv: 2566 }, { all: true, optional: true, k: 2567 }, { k: 2568 }] }], [], {}], [1, "skisport", 0, "", 22, [], [{ e: 2569 }], [{ v: 2570 }], [{ c: 2571 }, { wv: 2572 }, { all: true, optional: true, k: 2573 }, { c: 2574 }], [{ cc: 2575 }, { cc: 2576 }, { cc: 2577 }], {}], [1, "skogforsk", 2, "", 22, [2578], [{ e: 2579 }], [{ v: 2579 }], [{ c: 2579 }], [{ cc: 2580 }, { negated: true, cc: 2581 }], {}], [1, "skovborghogh-cookies", 0, "", 10, [2582], [{ e: 2583 }], [{ v: 2584 }], [{ c: 2585 }, { check: "none", timeout: 3e3, optional: true, wv: 2586 }], [{ cc: 2587 }], {}], [1, "skroutz", 2, "", 22, [2588], [{ e: 2589 }], [{ v: 2589 }], [{ c: 2589 }], [{ wait: 500 }, { cc: 2590 }], {}], [1, "smartstore", 2, "", 22, [2591], [{ e: 2592 }], [{ v: 2591 }], [{ all: true, optional: true, k: 2593 }, { c: 2594 }, { check: "none", timeout: 5e3, wv: 2591 }], [{ cc: 2595 }], {}], [1, "smartweb", 0, "", 10, [2596], [{ e: 2597 }], [{ v: 2598 }], [{ all: true, optional: true, k: 2599 }, { c: 2597 }], [{ cc: 2600 }], {}], [1, "snigel", 2, "", 22, [], [{ e: 2601 }], [{ v: 2601 }], [{ k: 2602 }, { k: 2603 }], [{ cc: 2604 }], {}], [1, "socialfunders", 2, "", 22, [2605], [{ e: 2606 }, { e: 2607 }], [{ v: 2605 }], [{ c: 2606 }], [], {}], [1, "sogei-cookiebar", 0, "", 22, [2608], [{ e: 2609 }], [{ v: 2609 }], [{ c: 2610 }], [{ cc: 2611 }], {}], [1, "soleil-sitevision-cookie-message", 2, "", 22, [2612], [{ e: 2613 }], [{ v: 2613 }], [{ c: 2613 }], [{ check: "none", v: 2612 }], {}], [1, "somerset-council", 0, "", 10, [], [{ e: 2614 }], [{ v: 2615 }], [{ c: 2615 }], [{ cc: 2616 }], {}], [1, "soteshop", 2, "", 22, [2617, 2618], [{ e: 2619 }], [{ check: "any", v: 2619 }], [{ if: { e: 2620 }, then: [{ c: 2620 }], else: [{ k: 2621 }] }, { check: "none", wv: 2619 }], [{ if: { e: 2620 }, then: [{ cc: 2622 }, { cc: 2623 }], else: [{ cc: 2624 }] }], {}], [3, "sourcepoint-top", 2, "", 10, [2625], [{ e: 2625 }], [{ v: 2625 }], [{ stylesheet: "body > div[id^='sp_message_container_'] { visibility: hidden !important; z-index: -1 !important; pointer-events: none !important; }", stylesheetId: "sourcepoint-top-hide" }, { stylesheet: "html.sp-message-open { height: auto !important; width: auto !important; } html.sp-message-open body { position: relative !important; overflow: auto !important; margin-top: 0 !important; top: auto !important; left: auto !important; right: auto !important; }", stylesheetId: "sourcepoint-top-scroll-unlock" }, { removeClass: "sp-message-open", selector: "html", optional: true }, { eval: "EVAL_SOURCEPOINT_RESTORE_SCROLL", optional: true }], [], {}], [1, "spaggiari-pvw", 0, "", 10, [2626], [{ e: 2627 }], [{ v: 2627 }], [{ c: 2627 }], [], {}], [1, "sparebank1-optin", 2, "", 22, [2628], [{ e: 2629 }], [{ v: 2628 }], [{ c: 2630 }], [{ check: "none", timeout: 2e3, wv: 2628 }], {}], [1, "sport7-popup-cookie", 2, "", 22, [2631], [{ e: 2632 }], [{ v: 2633 }], [{ retry: 5, retryInterval: 500, c: 2634 }], [{ check: "none", timeout: 2e3, wv: 2633 }], {}], [1, "spusu", 2, "", 22, [2635], [{ e: 2636 }], [{ v: 2636 }], [{ c: 2637 }, { w: 2638 }, { if: { e: 2639 }, then: [{ all: true, k: 2639 }] }, { c: 2637 }], [{ cc: 2640 }], {}], [1, "squarespace-cookie-banner", 2, "", 22, [2641], [{ e: 2642 }], [{ v: 2643 }], [{ if: { e: 2644 }, then: [{ c: 2644 }], else: [{ c: 2645 }, { wv: 2646 }, { all: true, optional: true, k: 2647 }, { c: 2648 }] }], [{ timeout: 1e3, check: "none", wv: 2643 }], {}], [1, "squarespace-cookie-notice", 1, "", 22, [2641], [{ e: 2649 }, { negated: true, e: 2650 }], [{ v: 2651 }], [{ h: 2641 }], [], {}], [1, "squiz", 0, "", 10, [368], [{ e: 2652 }], [{ v: 2652 }], [{ c: 2653 }], [{ wait: 500 }, { cc: 2654 }], {}], [1, "statamic-peak", 2, "", 22, [], [{ e: 2655 }], [{ v: 2656 }], [{ if: { e: 2657 }, then: [{ if: { v: 2658 }, then: [{ k: 2658 }] }, { c: 2657 }], else: [{ all: true, optional: true, k: 2659 }, { c: 2660 }] }], [{ timeout: 2e3, check: "none", wv: 2656 }], {}], [1, "steampowered.com", 2, "", 22, [], [{ e: 2661 }, { v: 2661 }], [{ v: 2661 }], [{ k: 2662 }], [{ wait: 1e3 }, { eval: "EVAL_STEAMPOWERED_0" }], {}], [1, "stellantis-psa", 2, "", 22, [2663, 2664], [{ e: 2665 }], [{ v: 2665 }], [{ if: { e: 2666 }, then: [{ c: 2666 }], else: [{ if: { v: 2667 }, then: [{ all: true, optional: true, k: 2668 }, { c: 2667 }], else: [{ c: 2669 }] }] }, { check: "none", timeout: 3e3, wv: 2663 }], [{ cc: 2670 }, { cc: 2671 }], {}], [1, "stepstone-ccm", 2, "", 22, [2672], [{ e: 2673 }], [{ v: 2674 }], [{ c: 2675 }, { timeout: 2e3, optional: true, c: 2676 }], [{ cc: 2677 }], {}], [1, "stockholm-stad", 2, "", 22, [2678], [{ e: 2679 }], [{ v: 2678 }], [{ c: 2680 }, { timeout: 2e3, wv: 2681 }, { all: true, optional: true, k: 2682 }, { k: 2683 }], [{ cc: 2684 }], {}], [1, "stright", 2, "", 22, [2685, 2686], [{ e: 2685 }], [{ v: 2685 }], [{ if: { v: 2687 }, then: [{ c: 2687 }], else: [{ c: 2688 }, { wv: 2686 }, { if: { e: 2689 }, then: [{ c: 2689 }], else: [{ all: true, optional: true, k: 2690 }, { c: 2691 }] }] }, { check: "none", wv: 2685 }], [{ check: "none", v: 2685 }], {}], [1, "strip2-usersporn", 1, "", 22, [2692], [{ e: 2693 }], [{ check: "any", v: 2694 }], [{ h: 2694 }], [], {}], [1, "stripchat.com", 0, "", 22, [2695], [{ v: 2696 }], [{ v: 2695 }], [{ timeout: 5e3, optional: true, w: 2697 }, { c: 2696 }, { timeout: 1500, optional: true, wv: 2698 }, { if: { check: "none", v: 2698 }, then: [{ k: 2696 }] }, { c: 2699 }], [{ wait: 500 }, { cc: 2700 }], {}], [1, "studioibizz-cookieconsent", 2, "", 22, [2701], [{ e: 2701 }], [{ v: 2702 }], [{ if: { e: 2703 }, then: [{ c: 2703 }], else: [{ h: 2704 }] }], [], {}], [1, "substack", 0, "", 12, [], [{ e: 2705 }], [{ v: 2705 }], [{ waitForThenClick: [".pencraft", "xpath///button[contains(., 'Only Necessary') or contains(., 'Reject')]"] }], [{ cc: 2706 }], {}], [1, "summitracing", 1, "", 10, [2707], [{ e: 2708 }], [{ v: 2708 }], [{ h: 2707 }], [], {}], [1, "supercontable", 2, "", 22, [2709], [{ e: 2710 }], [{ v: 2711 }], [{ c: 2712 }, { wv: 2713 }, { if: { e: 2714 }, then: [{ all: true, k: 2714 }] }, { k: 2713 }, { check: "none", wv: 2709 }], [{ wait: 500 }, { any: [{ cc: 2715 }, { cc: 2716 }] }], {}], [1, "swedbank-ui-cookie-consent", 2, "", 22, [], [{ e: 2717 }], [{ v: 2717 }], [{ c: 2717 }], [{ timeout: 1e3, check: "none", wv: 2717 }], {}], [1, "swis-avg", 2, "", 22, [2718], [{ e: 2719 }], [{ v: 2720 }], [{ if: { e: 2721 }, then: [{ k: 2721 }, { wv: 2722 }] }, { if: { e: 2723 }, then: [{ k: 2723 }] }, { if: { e: 2724 }, then: [{ k: 2724 }] }, { c: 2725 }], [{ cc: 2726 }, { cc: 2727 }], {}], [1, "swisscom-ecare", 2, "", 22, [2728], [{ e: 2729 }], [{ v: 2730 }], [{ if: { v: 2731 }, then: [{ retry: 3, retryInterval: 500, c: 2731 }], else: [{ k: 2732 }, { wv: 2733 }, { all: true, optional: true, k: 2734 }, { retry: 3, retryInterval: 500, c: 2735 }] }, { check: "none", wv: 2730 }], [{ cc: 2736 }], {}], [1, "synology", 0, "", 22, [2737], [{ e: 2737 }], [{ v: 2737 }], [{ c: 2738 }, { wv: 2739 }, { all: true, optional: true, k: 2740 }, { c: 2741 }], [{ cc: 2742 }, { cc: 2743 }], {}], [1, "t-cookie-bar", 2, "", 22, [2744], [{ e: 2745 }], [{ v: 2745 }], [{ c: 2745 }, { timeout: 8e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ check: "none", timeout: 1e3, wv: 2746 }, { check: "none", timeout: 2e3, wv: 1424 }], {}], [1, "tagconcierge", 2, "", 22, [2747], [{ e: 2747 }], [{ v: 2748 }], [{ if: { v: 2749 }, then: [{ k: 2749 }], else: [{ c: 2750 }, { wv: 2751 }, { if: { e: 2752 }, then: [{ k: 2752 }], else: [{ all: true, optional: true, k: 2753 }, { c: 2754 }] }] }], [{ any: [{ check: "none", v: 2747 }, { check: "none", v: 2755 }] }], {}], [1, "tallink", 2, "", 22, [2756], [{ e: 2757 }], [{ v: 2756 }], [{ c: 2758 }, { check: "none", timeout: 2e3, optional: true, wv: 2756 }], [{ cc: 2759 }, { negated: true, cc: 2760 }], {}], [1, "tarteaucitron deny", 2, "", 22, [2761], [{ e: 2761 }], [{ v: 2762 }], [{ wait: 500 }, { k: 2762 }], [{ eval: "EVAL_TARTEAUCITRON_2" }], {}], [1, "tarteaucitron.js", 2, "", 22, [2761], [{ e: 2761 }], [{ v: 2763 }, { negated: true, e: 2762 }], [{ if: { e: 2764 }, then: [{ all: true, optional: true, k: 2765 }, { k: 2763 }], else: [{ k: 2766 }, { c: 2767 }, { k: 2768 }] }], [{ eval: "EVAL_TARTEAUCITRON_2" }], {}], [1, "taunton", 2, "", 22, [2769], [{ e: 2769 }], [{ e: 2770 }], [{ optional: true, all: true, k: 2771 }, { k: 2772 }], [{ cc: 2773 }], {}], [1, "tccCmpAlert", 2, "", 22, [2774], [{ e: 2774 }], [{ v: 2774 }], [{ c: 2775 }], [], {}], [1, "Tealium", 2, "", 22, [2776], [{ e: 2777 }, { eval: "EVAL_TEALIUM_0" }], [{ check: "any", v: 2777 }, { eval: "EVAL_TEALIUM_NO_DECISION" }], [{ eval: "EVAL_TEALIUM_1" }, { eval: "EVAL_TEALIUM_DONOTSELL" }, { if: { e: 2778 }, then: [{ c: 2778 }], else: [{ h: 2779 }, { timeout: 1e3, optional: true, c: 2780 }] }], [{ eval: "EVAL_TEALIUM_3" }, { eval: "EVAL_TEALIUM_DONOTSELL_CHECK" }, { check: "none", v: 2781 }], {}], [1, "tempest-cookie-notice", 1, "", 22, [2782], [{ e: 2783 }], [{ v: 2782 }], [{ h: 2782 }], [], {}], [1, "Termly", 2, "", 22, [2784], [{ e: 2784 }], [{ v: 2785 }], [{ if: { e: 2786 }, then: [{ k: 2786 }], else: [{ c: 2787 }, { timeout: 700, w: 2788 }, { if: { e: 2788 }, then: [{ k: 2788 }], else: [{ all: true, c: 2789 }, { c: 2790 }] }] }], [], {}], [1, "termsfeed", 2, "", 22, [2791, 2792, 2793, 2794], [{ e: 2795 }], [{ v: 2795 }], [{ if: { e: 2796 }, then: [{ c: 2796 }], else: [{ c: 2797 }, { w: 2798 }, { all: true, optional: true, k: 2799 }, { k: 2800 }] }], [], {}], [1, "termsfeed3", 2, "", 22, [2801], [{ e: 2802 }], [{ v: 2802 }], [{ if: { e: 2803 }, then: [{ k: 2803 }, { wv: 2804 }, { c: 2804 }], else: [{ h: 2801 }] }], [], {}], [1, "Test page CMP", 2, "", 22, [2805], [{ e: 2806 }], [{ v: 2806 }], [{ w: 2805 }, { eval: "EVAL_TESTCMP_STEP" }, { k: 2805 }], [{ eval: "EVAL_TESTCMP_0" }], {}], [1, "Test page cosmetic CMP", 1, "", 22, [2807], [{ e: 2808 }], [{ v: 2808 }], [{ h: 2808 }], [{ wait: 500 }, { eval: "EVAL_TESTCMP_COSMETIC_0" }], {}], [1, "texas-instruments", 2, "", 22, [2809], [{ e: 2810 }], [{ v: 2811 }], [{ k: 2812 }, { wv: 2813 }, { if: { e: 2814 }, then: [{ all: true, k: 2814 }] }, { c: 2815 }], [{ cc: 2816 }], {}], [1, "tinycookie", 2, "", 22, [2817], [{ e: 2817 }], [{ v: 2817 }, { e: 2818 }], [{ if: { e: 2819 }, then: [{ k: 2819 }], else: [{ k: 2820 }, { timeout: 2e3, wv: 2821 }, { if: { e: 2822 }, then: [{ k: 2822 }], else: [{ all: true, optional: true, k: 2823 }, { k: 2824 }] }] }], [{ cc: 2825 }, { negated: true, cc: 2826 }], {}], [1, "tna-cookie-banner", 2, "", 22, [2827], [{ e: 2828 }], [{ v: 2829 }], [{ c: 2829 }, { timeout: 1e3, optional: true, c: 2830 }], [{ cc: 2831 }, { cc: 2832 }], {}], [1, "toyota", 0, "", 10, [2833], [{ e: 2834 }], [{ v: 2835 }], [{ timeout: 5e3, w: 2836 }, { c: 2837 }, { wv: 2838 }, { if: { e: 2839 }, then: [{ timeout: 2e3, optional: true, w: 2840 }] }, { all: true, optional: true, k: 2841 }, { c: 2838 }], [{ cc: 2842 }], {}], [1, "tplink", 0, "", 22, [2843, 2844], [{ e: 2845 }], [{ any: [{ v: 2846 }, { v: 2847 }, { v: 2848 }] }], [{ if: { v: 2847 }, then: [{ k: 2847 }] }, { if: { v: 2849 }, then: [{ k: 2849 }] }, { if: { e: 2850 }, then: [{ wv: 2851 }, { c: 2852 }], else: [{ wv: 2853 }, { if: { e: 2854 }, then: [{ c: 2854 }], else: [{ all: true, optional: true, k: 2855 }, { c: 2856 }] }] }], [{ cc: 2857 }, { negated: true, cc: 2858 }], {}], [1, "tracsis-delay-repay", 0, "", 22, [2859], [{ e: 2860 }], [{ v: 2860 }], [{ retry: 2, c: 2861 }], [{ cc: 2862 }], {}], [1, "trader-joes-com", 1, "", 22, [2863], [{ e: 2863 }], [{ v: 2863 }], [{ h: 2863 }], [], {}], [2, "transcend", 1, "", 22, [2864], [{ e: 2864 }], [{ v: 2864 }], [{ setStyle: "display: none !important; z-index: -1 !important; pointer-events: none !important;", selector: "#transcend-consent-manager" }], [], {}], [1, "travix", 0, "", 10, [], [{ e: 2865 }], [{ v: 2865 }], [{ c: 2866 }], [{ cc: 2867 }], {}], [1, "tri-table", 2, "", 22, [], [{ e: 2868 }], [{ v: 2868 }], [{ retry: 2, retryInterval: 500, c: 2869 }, { if: { e: 2870 }, then: [{ k: 2870 }], else: [{ optional: true, k: 2869 }] }, { check: "none", wv: 2868 }], [{ any: [{ cc: 2871 }, { cc: 2872 }] }], {}], [1, "trillian", 2, "", 22, [2873], [{ e: 2874 }], [{ v: 2873 }], [{ c: 2874 }], [{ cc: 2875 }], {}], [1, "truendo", 2, "", 22, [2876], [{ e: 2876 }], [{ v: 2876 }], [{ if: { e: 2877 }, then: [{ k: 2878 }], else: [{ k: 2879 }] }, { timeout: 2e3, optional: true, wv: 2880 }, { if: { v: 2880 }, then: [{ k: 2880 }] }], [{ cc: 707 }], {}], [1, "truevault-polaris", 0, "", 22, [], [{ exists: ["#polaris-css-lockdown-container", "#polaris-consent-widgets .polaris-consent-widget"] }], [{ visible: ["#polaris-css-lockdown-container", "#polaris-consent-widgets .polaris-consent-widget"] }], [{ if: { exists: ["#polaris-css-lockdown-container", ".polaris-consent-widget__actions button:nth-child(2):not(:last-child)"] }, then: [{ click: ["#polaris-css-lockdown-container", ".polaris-consent-widget__actions button:nth-child(2):not(:last-child)"] }], else: [{ click: ["#polaris-css-lockdown-container", ".polaris-consent-widget__actions button:first-child"] }, { waitFor: ["#polaris-css-lockdown-container", ".polaris-preferences-widget__save_button"], timeout: 2e3 }, { click: ["#polaris-css-lockdown-container", ".polaris-preferences-widget input[type=checkbox]:checked:not([disabled])"], all: true, optional: true }, { click: ["#polaris-css-lockdown-container", ".polaris-preferences-widget input[type=checkbox]:checked:not([disabled])"], all: true, optional: true }, { click: ["#polaris-css-lockdown-container", ".polaris-preferences-widget__save_button"] }] }], [{ waitForVisible: ["#polaris-css-lockdown-container", "#polaris-consent-widgets .polaris-consent-widget"], check: "none", timeout: 2e3 }, { cc: 2881 }], {}], [1, "trust360", 2, "", 22, [2882], [{ e: 2882 }], [{ v: 2882 }], [{ c: 2883 }], [{ cc: 2884 }], {}], [1, "TrustArc-newcm", 2, "", 22, [2885], [{ exists: [".truste_popframe.trustarc_newcm_container", "a.required, a.call, button.required, button.call, button.trustarc-declineall-btn"] }], [{ visible: [".truste_popframe.trustarc_newcm_container", "a.required, a.call, button.required, button.call, button.trustarc-declineall-btn, button.trustarc-primary-btn.submit"], check: "any" }], [{ if: { exists: [".truste_popframe.trustarc_newcm_container", "a.required, button.required"] }, then: [{ waitForThenClick: [".truste_popframe.trustarc_newcm_container", "a.required, button.required"] }], else: [{ waitForThenClick: [".truste_popframe.trustarc_newcm_container", "button.trustarc-declineall-btn"] }] }], [{ cc: 2886 }], {}], [1, "trustcommander", 2, "", 22, [2887], [{ e: 2888 }, { eval: "EVAL_TRUSTCOMMANDER_BANNER_SHOWN" }], [{ check: "any", v: 2888 }], [{ eval: "EVAL_TRUSTCOMMANDER_OPTOUT" }, { check: "none", timeout: 2e3, wv: 2888 }], [], {}], [1, "truyo", 2, "", 22, [2889], [{ e: 2890 }], [{ v: 2889 }], [{ k: 2891 }], [], {}], [1, "trybe", 0, "", 22, [2892], [{ e: 2892 }], [{ v: 2893 }], [{ c: 2894 }, { w: 2895 }, { optional: true, k: 2896 }, { optional: true, k: 2897 }, { c: 2898 }], [{ wait: 500 }, { cc: 2899 }], {}], [1, "tti-cookie-popup", 2, "", 22, [], [{ e: 2900 }], [{ v: 2900 }], [{ if: { v: 2901 }, then: [{ k: 2901 }], else: [{ k: 2900 }, { timeout: 1e4, wv: 2902 }, { if: { v: 2903 }, then: [{ k: 2903 }], else: [{ all: true, optional: true, k: 2904 }, { c: 2905 }] }] }, { timeout: 1e4, check: "none", wv: 2900 }], [{ cc: 2906 }], {}], [1, "tuki-cookieterms", 2, "", 22, [2907], [{ e: 2908 }], [{ v: 2909 }], [{ if: { e: 2910 }, then: [{ k: 2910 }, { wv: 2911 }, { all: true, optional: true, k: 2912 }, { k: 2913 }], else: [{ c: 2914 }] }], [{ cc: 2915 }], {}], [1, "tumblr-custom-domain-gdpr-banner", 1, "", 22, [2916], [{ e: 2916 }], [{ v: 2916 }], [{ h: 2916 }], [{ check: "none", v: 2916 }], {}], [1, "tv2reg-cookie-notice", 2, "", 22, [2917], [{ e: 2918 }, { e: 2919 }], [{ check: "any", v: 2919 }], [{ c: 2919 }, { check: "none", timeout: 2e3, optional: true, wv: 2919 }], [{ cc: 2920 }], {}], [1, "twcc", 0, "", 10, [2921], [{ e: 2922 }], [{ v: 2922 }], [{ c: 2923 }], [{ cc: 2924 }], {}], [1, "txxx-network", 0, "", 22, [], [{ e: 2925 }], [{ v: 2925 }], [{ c: 2925 }], [{ check: "none", v: 2925 }], {}], [1, "typo3-cookieconsent", 2, "", 22, [2926], [{ e: 2927 }], [{ v: 2926 }], [{ c: 2927 }], [{ cc: 2928 }], {}], [1, "tyreseeker", 0, "", 22, [], [{ e: 2929 }], [{ v: 2930 }], [{ c: 2931 }, { wv: 2932 }, { wait: 500 }, { all: true, optional: true, k: 2933 }, { k: 2932 }, { check: "none", wv: 2934 }], [], {}], [1, "u-cookie-consent", 2, "", 22, [2935], [{ e: 2936 }], [{ v: 2936 }], [{ c: 2936 }], [{ check: "none", timeout: 2e3, wv: 2936 }], {}], [1, "ubuntu.com", 2, "", 22, [2937], [{ any: [{ e: 2938 }, { e: 2939 }] }], [{ any: [{ v: 2940 }, { v: 2939 }] }], [{ any: [{ c: 2941 }, { c: 2942 }] }, { optional: true, all: true, timeout: 500, c: 2943 }, { any: [{ c: 2944 }, { c: 2945 }] }], [{ cc: 2946 }], {}], [1, "ubuy", 2, "", 22, [2947], [{ e: 2948 }], [{ v: 438 }], [{ c: 2948 }], [{ timeout: 1e3, check: "none", wv: 438 }], {}], [1, "ucookie", 0, "", 22, [2949], [{ e: 2949 }], [{ v: 2949 }], [{ retry: 5, retryInterval: 500, c: 2950 }, { check: "none", timeout: 5e3, wv: 2949 }], [{ check: "none", v: 2949 }], {}], [1, "uft-cookie-notice", 2, "", 22, [2951], [{ e: 2952 }], [{ v: 2951 }], [{ k: 2952 }, { c: 2953 }, { check: "none", wv: 2951 }], [{ wait: 1e3 }, { cc: 2954 }], { intermediate: false }], [1, "UK Cookie Consent", 1, "", 22, [2955], [{ e: 2955 }], [{ e: 2956 }], [{ h: 2955 }], [{ negated: true, cc: 2957 }], {}], [1, "uk-parliament", 2, "", 22, [2958, 2959], [{ e: 2960 }], [{ v: 2961 }], [{ c: 2960 }, { optional: true, h: 2959 }], [{ cc: 2962 }], {}], [1, "umcg", 2, "", 22, [2963], [{ e: 2964 }], [{ v: 2965 }], [{ all: true, optional: true, k: 2966 }, { c: 2967 }], [], {}], [1, "uned-barbastro", 2, "", 22, [2968], [{ e: 2968 }, { e: 2969 }], [{ v: 2968 }], [{ c: 2970 }, { wv: 2971 }, { if: { e: 2972 }, then: [{ k: 2972 }] }, { k: 2971 }, { check: "none", timeout: 2e3, optional: true, wv: 2968 }], [{ cc: 2973 }, { negated: true, cc: 2974 }], {}], [1, "unicity", 2, "", 22, [2975], [{ e: 2976 }], [{ v: 2977 }], [{ if: { e: 2978 }, then: [{ k: 2978 }], else: [{ k: 2979 }, { wv: 2980 }, { all: true, optional: true, k: 2981 }, { k: 2982 }] }, { check: "none", timeout: 2e3, optional: true, wv: 2975 }], [{ cc: 2983 }], {}], [1, "united-online", 2, "", 22, [2984, 2985], [{ e: 2986 }], [{ any: [{ check: "any", v: 2987 }, { e: 2988 }] }], [{ if: { check: "any", v: 2989 }, then: [{ c: 2990 }] }, { if: { v: 2991 }, then: [{ h: 2991 }] }, { if: { e: 2988 }, then: [{ k: 2992 }] }], [{ cc: 2993 }], {}], [1, "up-cookie-consent", 2, "", 22, [2994], [{ e: 2994 }], [{ v: 2994 }], [{ if: { e: 2995 }, then: [{ c: 2995 }], else: [{ c: 2996 }, { c: 2997 }] }, { check: "none", timeout: 1e4, wv: 2998 }], [{ cc: 2999 }, { cc: 3e3 }], {}], [1, "usercentrics-api", 2, "", 22, [], [{ e: 3001 }], [{ eval: "EVAL_USERCENTRICS_API_0" }, { if: { e: 3002 }, then: [{ timeout: 2e3, wv: 3002 }], else: [{ exists: ["#usercentrics-root", "[data-testid=uc-container]"] }, { timeout: 2e3, wv: 3003 }] }], [{ if: { exists: ["#usercentrics-root", "[data-testid=uc-deny-all-button]"] }, then: [{ click: ["#usercentrics-root", "[data-testid=uc-deny-all-button]"] }], else: [{ if: { exists: ["#usercentrics-cmp-ui", "[data-action-type=deny]"] }, then: [{ click: ["#usercentrics-cmp-ui", "[data-action-type=deny]"] }], else: [{ eval: "EVAL_USERCENTRICS_API_1" }, { eval: "EVAL_USERCENTRICS_API_2" }] }] }, { removeClass: "overflowHidden", selector: "body", optional: true }], [{ eval: "EVAL_USERCENTRICS_API_6" }], {}], [1, "uw-madison-cookieconsent", 1, "", 22, [3004], [{ e: 3005 }], [{ v: 3004 }], [{ h: 3006 }], [], {}], [1, "ux-cookie-layer", 2, "", 22, [3007], [{ exists: ["ux-cookie-layer", "ux-cookie-layer-modal"] }], [{ visible: ["ux-cookie-layer", "ux-cookie-layer-modal[opened]"] }], [{ waitForThenClick: ["ux-cookie-layer", "a[data-ux-cookie-layer=accept-required]"] }], [{ cc: 3008 }], {}], [1, "vdg-cookies", 2, "", 22, [3009], [{ e: 3009 }], [{ v: 3009 }], [{ c: 3010 }, { c: 3011 }, { check: "none", wv: 3009 }], [{ cc: 3012 }], {}], [1, "vendic-cookiebar", 0, "", 22, [3013, 3014], [{ e: 3015 }], [{ v: 3016 }], [{ if: { e: 3017 }, then: [{ c: 3017 }], else: [{ c: 3018 }, { wv: 3019 }, { all: true, optional: true, k: 3020 }, { c: 3019 }] }], [{ check: "none", timeout: 3e3, wv: 3021 }], {}], [1, "vergelijkgroep", 0, "", 10, [3022], [{ e: 3023 }], [{ v: 3024 }], [{ c: 3025 }], [{ cc: 3026 }], {}], [1, "visualreality", 2, "", 22, [], [{ e: 3027 }, { e: 3028 }], [{ v: 3029 }], [{ c: 3029 }, { wv: 3030 }, { all: true, optional: true, k: 3031 }, { k: 3030 }], [], {}], [1, "visualsoft", 2, "", 22, [3032], [{ e: 3033 }], [{ v: 3032 }], [{ timeout: 1e4, optional: true, w: 3034 }, { if: { e: 3035 }, then: [{ retry: 2, c: 3035 }], else: [{ c: 3036 }, { timeout: 5e3, c: 3037 }] }], [{ timeout: 2e3, check: "none", wv: 3032 }, { cc: 3038 }], {}], [1, "vivenu", 2, "", 22, [], [{ e: 3039 }], [{ v: 3039 }], [{ c: 3040 }], [{ check: "none", v: 3039 }], {}], [1, "vivo-vcm", 2, "", 22, [3041, 3042], [{ e: 3043 }], [{ v: 3041 }], [{ if: { e: 3044 }, then: [{ c: 3044 }], else: [{ c: 3045 }] }], [{ check: "none", timeout: 1e3, wv: 3041 }], {}], [1, "vortex-consent", 2, "", 22, [3046, 3047], [{ e: 3048 }], [{ v: 3048 }], [{ c: 3048 }], [{ cc: 3049 }, { negated: true, cc: 3050 }], {}], [1, "vrg-bottom-cookies", 2, "", 22, [3051], [{ e: 3052 }], [{ v: 3051 }], [{ c: 3053 }, { timeout: 1e4, wv: 3054 }, { if: { e: 3055 }, then: [{ all: true, k: 3055 }] }, { retry: 2, retryInterval: 1e3, c: 3054 }], [{ check: "none", timeout: 5e3, wv: 3051 }], {}], [1, "vue-cookie-accept-decline", 0, "", 10, [3056, 3057], [{ e: 3058 }], [{ v: 3059 }], [{ if: { e: 3060 }, then: [{ c: 3060 }], else: [{ h: 3059 }] }], [], {}], [1, "vue-cookie-law", 0, "", 10, [3061], [{ e: 3062 }], [{ v: 3061 }], [{ if: { e: 3063 }, then: [{ c: 3063 }], else: [{ h: 3061 }] }], [], {}], [1, "waplog", 2, "", 22, [3064], [{ e: 3065 }], [{ v: 3064 }], [{ c: 3065 }], [{ cc: 3066 }], {}], [1, "warning-cookie-notice", 1, "", 22, [3067], [{ e: 3068 }], [{ v: 3067 }], [{ h: 3067 }], [], {}], [1, "watchfinder", 0, "", 22, [3069], [{ e: 3070 }, { e: 3071 }], [{ v: 3070 }], [{ c: 3070 }, { wv: 3071 }, { all: true, optional: true, k: 3072 }, { c: 3073 }], [{ cc: 3074 }, { cc: 3075 }], {}], [1, "wbd-consent-modal", 2, "", 22, [], [{ e: 3076 }, { e: 3077 }], [{ v: 3078 }], [{ if: { e: 3079 }, then: [{ k: 3077 }], else: [{ k: 3077 }, { c: 3080 }] }, { check: "none", timeout: 5e3, optional: true, wv: 3081 }], [{ cc: 3082 }], {}], [3, "wbd-legal-terms", 1, "", 22, [], [{ e: 3083 }, { negated: true, e: 3084 }], [{ check: "any", v: 3085 }], [{ if: { e: 3086 }, then: [{ eval: "EVAL_WBD_LTP_CLOSE" }, { removeClass: "is-NoScroll", selector: "body", optional: true }], else: [{ h: 3087 }, { stylesheet: 'body:has([id="id/ltp"]) { overflow: auto !important; }', stylesheetId: "wbd-legal-terms-scroll-unlock" }] }], [], {}], [1, "web-labs-cookie-consent", 2, "", 22, [3088], [{ e: 3089 }], [{ v: 3089 }], [{ if: { e: 3090 }, then: [{ c: 3090 }] }, { all: true, optional: true, k: 3091 }, { if: { e: 3092 }, then: [{ c: 3092 }], else: [{ c: 3093 }] }, { check: "none", timeout: 2e3, optional: true, wv: 3094 }], [{ any: [{ cc: 3095 }, { cc: 3096 }] }], {}], [1, "webflow", 2, "", 22, [3097], [{ any: [{ v: 3097 }, { e: 3098 }] }], [{ v: 3097 }, { v: 3099 }], [{ if: { e: 3100 }, then: [{ wait: 500 }, { c: 3100 }], else: [{ h: 3101 }] }], [{ cc: 3102 }], {}], [1, "weblegal", 2, "", 22, [3103, 3104], [{ e: 3105 }], [{ v: 3103 }, { e: 3106 }], [{ c: 3105 }], [{ cc: 3107 }], {}], [1, "weblication", 2, "", 22, [3108], [{ e: 3109 }], [{ v: 3108 }], [{ if: { e: 3110 }, then: [{ k: 3111 }] }, { if: { e: 3112 }, then: [{ k: 3113 }] }, { c: 3114 }], [{ cc: 3115 }], {}], [1, "webnetism", 2, "", 22, [3116], [{ e: 3117 }], [{ v: 3117 }], [{ c: 3117 }, { timeout: 3e3, w: 3118 }, { all: true, optional: true, k: 3119 }, { c: 3118 }], [{ cc: 3120 }], {}], [1, "websale", 2, "", 22, [], [{ e: 3121 }, { e: 3122 }], [{ check: "any", v: 3123 }], [{ all: true, optional: true, k: 3124 }, { all: true, optional: true, k: 3125 }, { if: { e: 3126 }, then: [{ retry: 3, retryInterval: 500, c: 3126 }], else: [{ c: 3127 }] }], [{ cc: 3128 }], {}], [1, "webtoffee-cookie-consent", 2, "", 22, [3129], [{ e: 3130 }], [{ v: 3130 }], [{ if: { e: 3131 }, then: [{ c: 3131 }], else: [{ if: { e: 3132 }, then: [{ c: 3132 }, { wv: 3133 }, { optional: true, k: 3134 }, { c: 3135 }], else: [{ c: 3136 }, { wv: 3137 }, { all: true, optional: true, k: 3138 }, { c: 3137 }] }] }], [{ cc: 3139 }], {}], [1, "whitecube-cookie-consent", 2, "", 22, [], [{ e: 3140 }], [{ v: 3141 }], [{ if: { v: 3142 }, then: [{ retry: 5, retryInterval: 1e3, c: 3142 }], else: [{ c: 3143 }, { wv: 3144 }, { all: true, optional: true, k: 3145 }, { retry: 10, retryInterval: 1e3, c: 3144 }] }, { check: "none", timeout: 5e3, wv: 3141 }], [{ timeout: 2e3, check: "none", wv: 3141 }], {}], [1, "whitepages-gpc-banner", 2, "", 22, [3146], [{ e: 3147 }], [{ v: 3146 }], [{ c: 3147 }], [{ check: "none", v: 3146 }], {}], [1, "wiki.gg", 1, "", 22, [3148], [{ v: 3148 }], [{ v: 3148 }], [{ h: 3148 }], [], {}], [1, "wimc-gtm-consent", 2, "", 22, [3149], [{ e: 3149 }], [{ v: 3150 }], [{ if: { e: 3151 }, then: [{ c: 3151 }], else: [{ c: 3152 }, { timeout: 2e3, wv: 3153 }, { all: true, optional: true, k: 3154 }, { c: 3155 }] }, { check: "none", timeout: 2e3, wv: 3150 }], [{ cc: 3156 }, { cc: 3157 }], {}], [1, "wirtualna-polska", 2, "", 22, [3158], [{ exists: ["div[role=dialog][aria-modal=true][aria-label*='WP']", "xpath/.//button[normalize-space(.)='Ustawienia zaawansowane' or normalize-space(.)='Advanced settings' or normalize-space(.)='Erweiterte einstellungen' or normalize-space(.)='Pokro\u010Dil\xE1 nastaven\xED' or normalize-space(.)='Roz\u0161\xEDren\xE9 nastavenia' or normalize-space(.)='I\u0161pl\u0117stiniai nustatymai']"] }], [{ v: 3158 }], [{ waitForThenClick: ["div[role=dialog][aria-modal=true][aria-label*='WP']", "xpath/.//button[normalize-space(.)='Ustawienia zaawansowane' or normalize-space(.)='Advanced settings' or normalize-space(.)='Erweiterte einstellungen' or normalize-space(.)='Pokro\u010Dil\xE1 nastaven\xED' or normalize-space(.)='Roz\u0161\xEDren\xE9 nastavenia' or normalize-space(.)='I\u0161pl\u0117stiniai nustatymai']"] }, { waitForThenClick: ["div[role=dialog][aria-modal=true][aria-label*='WP']", "xpath/.//button[normalize-space(.)='Zapisz' or normalize-space(.)='Save' or normalize-space(.)='Speichern' or normalize-space(.)='Ulo\u017Eit' or normalize-space(.)='Ulo\u017Ei\u0165' or normalize-space(.)='I\u0161saugoti']"] }, { check: "none", timeout: 5e3, optional: true, wv: 3158 }], [], {}], [1, "wix", 0, "", 22, [], [{ e: 3159 }], [{ v: 3159 }], [{ if: { e: 3160 }, then: [{ wait: 1e3 }, { if: { e: 3161 }, then: [{ k: 3161 }], else: [{ k: 3162 }, { wv: 3163 }, { all: true, optional: true, k: 3164 }, { k: 3163 }] }, { any: [{ check: "none", timeout: 2e3, wv: 3160 }, { h: 3160 }] }], else: [{ if: { e: 3165 }, then: [{ k: 3165 }], else: [{ h: 3166 }] }] }], [], {}], [1, "wkda", 2, "", 22, [], [{ e: 3167 }], [{ v: 3167 }], [{ if: { e: 3168 }, then: [{ k: 3168 }] }, { wv: 3169 }, { all: true, optional: true, k: 3170 }, { k: 3169 }], [{ cc: 3171 }], {}], [1, "woo-commerce-com", 2, "", 22, [3172], [{ e: 3172 }], [{ v: 3172 }], [{ if: { e: 3173 }, then: [{ c: 3174 }], else: [{ c: 3175 }, { wv: 3176 }, { all: true, optional: true, k: 3177 }, { c: 3178 }] }], [{ cc: 3179 }], {}], [1, "wordpress-wordads", 2, "", 22, [3180], [{ exists: ["#cmp-app-container iframe", ".cmp__notice, .cmp__dialog"] }], [{ visible: ["#cmp-app-container iframe", ".cmp__notice, .cmp__dialog"], check: "any" }], [{ if: { exists: ["#cmp-app-container iframe", ".cmp__notice-buttons .is-secondary"] }, then: [{ click: ["#cmp-app-container iframe", ".cmp__notice-buttons .is-secondary"] }] }, { waitForThenClick: ["#cmp-app-container iframe", ".cmp__dialog-footer-buttons .is-secondary"], timeout: 5e3 }], [{ check: "none", timeout: 3e3, wv: 3181 }], {}], [1, "workday", 2, "", 22, [3182], [{ e: 3183 }], [{ v: 3182 }], [{ c: 3183 }], [{ cc: 3184 }], {}], [1, "worldbank", 2, "", 22, [3185, 3186], [{ e: 3187 }], [{ v: 3188 }], [{ c: 3189 }], [{ cc: 3190 }], {}], [1, "WP Cookie Notice for GDPR", 2, "", 22, [3191], [{ v: 3191 }], [{ v: 3191 }], [{ c: 3192 }], [{ cc: 3193 }], {}], [1, "WP DSGVO Tools", 2, "", 22, [3194], [{ e: 3195 }], [{ check: "any", v: 3195 }], [{ if: { e: 3196 }, then: [{ c: 3196 }], else: [{ c: 3197 }] }], [{ cc: 3198 }], {}], [1, "wpcc", 1, "", 22, [3199], [{ e: 3199 }], [{ e: 3200 }], [{ h: 3199 }], [], {}], [1, "WPConsent", 2, "", 22, [3201], [{ e: 3202 }], [{ visible: ["#wpconsent-container", "#wpconsent-banner-holder.wpconsent-banner-visible"] }], [{ waitForThenClick: ["#wpconsent-container", "#wpconsent-banner-holder .wpconsent-cancel-all"] }], [{ cc: 3203 }], {}], [1, "wpj-cookiebar", 2, "", 22, [3204], [{ e: 3205 }], [{ v: 3205 }], [{ if: { e: 3206 }, then: [{ c: 3206 }], else: [{ c: 3207 }, { c: 3208 }] }], [{ cc: 3209 }], {}], [1, "wso2-identity-server", 2, "", 22, [3210], [{ e: 3211 }], [{ v: 3210 }], [{ c: 3212 }], [{ cc: 3213 }], {}], [1, "wuerth", 2, "", 22, [3214, 3215], [{ e: 3216 }, { e: 3217 }], [{ v: 3216 }], [{ if: { v: 3218 }, then: [{ k: 3218 }], else: [{ c: 3217 }, { timeout: 2e3, wv: 3219 }, { all: true, optional: true, k: 3220 }, { k: 3219 }] }], [{ cc: 2079 }], {}], [1, "x28-privacy-settings", 0, "", 22, [], [{ e: 3221 }], [{ v: 3221 }], [{ all: true, optional: true, k: 3222 }, { retry: 3, retryInterval: 1e3, c: 3221 }], [{ cc: 3223 }], {}], [1, "xenforo-cookie-consent", 2, "", 22, [3224], [{ e: 3225 }], [{ v: 3226 }], [{ if: { e: 3227 }, then: [{ k: 3227 }], else: [{ timeout: 2e3, retry: 10, retryInterval: 500, c: 3228 }, { timeout: 2e3, wv: 3229 }, { all: true, optional: true, k: 3230 }, { k: 3229 }] }], [{ timeout: 2e3, check: "none", wv: 3224 }, { cc: 3231 }], {}], [1, "xgroovy", 1, "", 22, [3232], [{ e: 3233 }], [{ v: 3233 }], [{ h: 3232 }], [], {}], [1, "xnxx-com", 1, "", 22, [3234], [{ any: [{ e: 3234 }, { e: 3235 }] }], [{ any: [{ v: 3234 }, { v: 3236 }] }], [{ if: { v: 3236 }, then: [{ c: 3237 }], else: [{ h: 3234 }] }], [], {}], [1, "yandex", 2, "", 22, [], [{ e: 3238 }], [{ v: 3238 }], [{ c: 3238 }], [{ timeout: 2e3, check: "none", wv: 3238 }], {}], [1, "yle-consent-sdk", 2, "", 22, [3239], [{ e: 3240 }], [{ v: 3239 }], [{ c: 3240 }, { timeout: 2e3, check: "none", wv: 3239 }], [], {}], [1, "youtube-desktop", 2, "", 22, [3241, 3242], [{ e: 3243 }, { e: 3244 }], [{ v: 3243 }], [{ c: 3245 }, { wait: 500 }], [{ wait: 500 }, { cc: 1482 }], {}], [1, "youtube-mobile", 2, "", 22, [3246], [{ e: 3247 }], [{ v: 3247 }], [{ wait: 500 }, { c: 3248 }, { wait: 500 }], [{ wait: 500 }, { cc: 1482 }], {}], [1, "yunders", 2, "", 22, [3249, 3250], [{ e: 3251 }, { v: 3249 }], [{ v: 3249 }], [{ c: 3252 }, { wv: 3253 }, { if: { e: 3254 }, then: [{ k: 3255 }] }, { if: { e: 3256 }, then: [{ k: 3257 }] }, { k: 3251 }], [{ cc: 2915 }, { cc: 3258 }], {}], [1, "zoho", 0, "", 22, [3259], [{ e: 3260 }], [{ v: 3259 }], [{ if: { v: 3261 }, then: [{ k: 3261 }], else: [{ k: 3262 }, { wv: 3263 }, { all: true, optional: true, k: 3264 }, { k: 3263 }] }, { check: "none", timeout: 2e3, wv: 3259 }], [{ eval: "EVAL_ZOHO_TEST" }], {}], [1, "zorginstituut-cookiewarning", 0, "", 22, [3265], [{ e: 3266 }], [{ v: 3266 }], [{ c: 3266 }], [{ check: "none", timeout: 2e3, wv: 3267 }], {}], [1, "zurich-cookies-notification-banner", 0, "", 10, [3268], [{ e: 3269 }], [{ v: 3270 }], [{ c: 3269 }], [{ cc: 3271 }], {}], [1, "auto_CA_epihunter.eu_hd4", 0, "^https?://(www\\.)?combell\\.com/", 1, [], [{ e: 3272 }], [{ v: 3272 }], [{ wait: 500 }, { c: 3272 }], [{ timeout: 1e3, check: "none", wv: 3272 }], {}], [1, "auto_CA_nationalarchives.gov.uk_rx0", 0, "^https?://(www\\.)?webarchive\\.nationalarchives\\.gov\\.uk/", 1, [], [{ e: 3273 }], [{ v: 3273 }], [{ wait: 500 }, { c: 3273 }], [{ timeout: 1e3, check: "none", wv: 3273 }], {}], [1, "auto_CH_swisscare.com_arx", 0, "^https?://(www\\.)?swisscare\\.com/", 1, [], [{ e: 3274 }], [{ v: 3274 }], [{ wait: 500 }, { c: 3274 }], [{ timeout: 1e3, check: "none", wv: 3274 }], {}], [1, "auto_DE_huss-licht-ton.de_jj0", 0, "^https?://(www\\.)?huss-licht-ton\\.de/", 1, [], [{ e: 3275 }], [{ v: 3275 }], [{ wait: 500 }, { c: 3275 }], [{ timeout: 1e3, check: "none", wv: 3275 }], {}], [1, "auto_DE_modellbau-berlinski.de_8vm", 0, "^https?://(www\\.)?modellbau-berlinski\\.de/", 1, [], [{ e: 3276 }], [{ v: 3276 }], [{ wait: 500 }, { c: 3276 }], [{ timeout: 1e3, check: "none", wv: 3276 }], {}], [1, "auto_GB_investing.thisismoney.co.uk_0", 0, "^https?://(www\\.)?thisismoney\\.co\\.uk/", 1, [], [{ e: 3277 }], [{ v: 3277 }], [{ c: 3277 }], [], {}], [1, "auto_NL_flitsmeister.nl_ws8", 0, "^https?://(www\\.)?cookies\\.flitsmeister\\.com/", 1, [], [{ e: 3278 }], [{ v: 3278 }], [{ wait: 500 }, { c: 3278 }], [{ timeout: 1e3, check: "none", wv: 3278 }], {}], [1, "bmedonline.es", 0, "^https?://(www\\.)?bmedonline\\.es/", 11, [3279], [{ e: 3280 }], [{ v: 3279 }], [{ c: 3281 }], [{ wait: 500 }, { cc: 3282 }], {}], [1, "clym-tcf-frame", 2, "^https://cf\\.clym-widget\\.net/latest/", 1, [], [{ e: 3283 }], [{ v: 3283 }], [{ c: 3283 }], [], {}], [1, "dropbox", 2, "^https://www\\.dropbox\\.com/", 1, [], [{ e: 3284 }], [{ v: 3284 }, { eval: "EVAL_IFRAME_SHOWN" }], [{ c: 3284 }, { wait: 1e3 }, { if: { v: 3284 }, then: [{ k: 3284 }] }], [], {}], [1, "ecoprivacy", 2, "^https://ecoprivacy\\.ecocerved\\.it/", 1, [], [{ e: 3285 }], [{ v: 3285 }], [{ wv: 3286 }, { wait: 500 }, { k: 3285 }], [], {}], [1, "fca-cookielaw", 2, "^https://cookielaw\\.emea\\.fcagroup\\.com/", 1, [], [{ e: 3287 }], [{ v: 3287 }, { eval: "EVAL_IFRAME_SHOWN" }], [{ c: 3287 }], [], {}], [1, "figma", 2, "^https://([a-z0-9-]+\\.)*figma\\.com/", 11, [3288, 3289], [{ e: 3290 }], [{ v: 3291 }], [{ c: 3292 }], [{ cc: 3293 }, { cc: 3294 }], {}], [1, "gmx-permission", 2, "^https://plus\\.gmx\\.com/lt(?:[?#]|$)", 1, [3295], [{ e: 3295 }], [{ v: 3296 }], [{ if: { e: 3297 }, then: [{ c: 3297 }], else: [{ if: { e: 3298 }, then: [{ c: 3298 }, { wv: 3299 }, { c: 3299 }], else: [{ c: 3299 }] }] }], [{ cc: 3300 }], {}], [1, "mercadolibre-frame", 0, "^https://www\\.mercado(libre|livre|pago)\\.[a-z.]+/", 1, [], [{ e: 3301 }, { eval: "EVAL_MERCADOLIBRE_CROSS_ORIGIN_PARENT" }], [{ v: 3302 }], [{ timeout: 1e4, w: 3302 }, { if: { e: 3303 }, then: [{ all: true, retry: 5, retryInterval: 500, c: 3303 }] }, { check: "none", timeout: 3e3, wv: 3303 }, { eval: "EVAL_MERCADOLIBRE_SAVE" }], [], { intermediate: true }], [1, "nojazz", 2, "^https://nojazz\\.eu/", 1, [], [{ e: 3304 }], [{ v: 3304 }], [{ if: { v: 3305 }, then: [{ k: 3305 }], else: [{ k: 3304 }, { w: 3306 }, { all: true, optional: true, k: 3307 }, { c: 3308 }] }], [], {}], [1, "pdf24", 2, "^https://consent\\.pdf24\\.org/", 1, [], [{ e: 3309 }], [{ v: 3310 }], [{ if: { v: 3311 }, then: [{ k: 3311 }], else: [{ k: 3309 }, { wv: 3312 }, { c: 3313 }] }], [], {}], [1, "sicredi-frame", 2, "^https?://(\\w+\\.)?sicredi\\.com\\.br/", 1, [2526], [{ e: 2527 }], [{ v: 2528 }], [{ c: 2529 }, { c: 2530 }], [], {}], [1, "truecaller", 2, "^https://cookies\\.truecaller\\.com/consent/", 1, [], [{ e: 3314 }], [{ v: 3315 }], [{ c: 3315 }], [], {}], [1, "tumblr-com", 2, "^https://(www\\.)?tumblr\\.com/", 21, [3180], [{ e: 3180 }], [{ check: "any", v: 3180 }], [{ waitForThenClick: ["#cmp-app-container iframe", ".cmp-components-button.is-secondary"], timeout: 5e3 }], [], {}], [1, "web.de", 2, "^https://([a-z]*\\.)?web\\.de/|^https://([a-z]*\\.)?gmx\\.net/", 1, [], [{ e: 3316 }, { e: 3317 }], [{ v: 3317 }], [{ c: 3317 }], [], {}], [1, "widiba", 0, "^https?://(www\\.)?widiba\\.it/", 11, [3318], [{ e: 3319 }], [{ v: 3318 }], [{ c: 3320 }], [{ check: "none", timeout: 2e3, wv: 3318 }], {}], [1, "1pmobile.com", 2, "^https?://(\\w+\\.)?1pmobile\\.com/", 22, [792], [{ e: 3321 }], [{ v: 3322 }], [{ if: { e: 3323 }, then: [{ all: true, optional: true, k: 3324 }, { c: 3325 }], else: [{ c: 3326 }] }], [], {}], [1, "7plus", 2, "^https?://(\\w+\\.)?7plus\\.com\\.au/", 22, [3327], [{ e: 3328 }], [{ v: 3328 }], [{ if: { e: 3329 }, then: [{ k: 3329 }, { wv: 3330 }, { all: true, optional: true, k: 3331 }, { c: 3332 }], else: [{ c: 3333 }] }], [], {}], [1, "aa-cookie-banner", 2, "^https://(www\\.)?(envoyair|psaairlines)\\.com/", 22, [3334], [{ exists: ["adc-cookie-banner", "#cookie-banner"] }], [{ visible: ["adc-cookie-banner", "#cookie-banner"] }], [{ waitForThenClick: ["adc-cookie-banner", "#toast-dismiss-button"] }], [{ cc: 3335 }], {}], [1, "abcacupuncture1", 2, "^https?://(www\\.)?abcacupuncture1\\.com/", 22, [1012], [{ any: [{ e: 1013 }, { e: 1395 }] }], [{ any: [{ v: 1013 }, { v: 1424 }] }], [{ if: { v: 1014 }, then: [{ k: 1014 }] }, { timeout: 4e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }, { if: { v: 1014 }, then: [{ c: 1014 }] }], [{ cc: 1026 }], {}], [1, "abetterrouteplanner", 2, "^https?://(www\\.)?abetterrouteplanner\\.com/", 22, [], [{ e: 3336 }], [{ v: 3336 }], [{ c: 3336 }], [{ negated: true, e: 3336 }], {}], [1, "accurx", 2, "^https://(accurx\\.nhs\\.uk|patient\\.accurx\\.com)/", 22, [3337], [{ e: 3338 }], [{ v: 3338 }], [{ c: 3339 }], [{ check: "none", timeout: 2e3, wv: 3338 }], {}], [1, "aceodds.com", 2, "^https?://(www\\.)?aceodds\\.com/", 22, [368], [{ e: 3340 }], [{ v: 368 }], [{ retry: 10, retryInterval: 500, c: 3341 }, { check: "none", wv: 368 }], [{ cc: 3342 }], {}], [1, "adblockplus", 0, "^https?://(\\w+\\.)?adblockplus\\.org/", 10, [845, 3343], [{ e: 3344 }], [{ check: "any", v: 3344 }], [{ if: { v: 3345 }, then: [{ c: 3345 }, { wv: 3346 }, { if: { e: 3347 }, then: [{ k: 3348 }] }, { k: 3346 }], else: [{ c: 3349 }, { wv: 3350 }, { if: { e: 3351 }, then: [{ k: 3352 }] }, { k: 3350 }] }], [{ cc: 3353 }], {}], [1, "adeac-jp", 1, "^https?://(www\\.)?adeac\\.jp/", 22, [3354], [{ e: 3355 }], [{ v: 3354 }], [{ h: 3354 }], [], {}], [1, "adultfriendfinder", 2, "^https://(www\\.)?adultfriendfinder\\.com/", 22, [3356], [{ e: 3357 }], [{ v: 3357 }], [{ c: 3358 }], [{ eval: "EVAL_ADULTFRIENDFINDER_TEST" }], {}], [1, "adv-gr-jp", 1, "^https?://(\\w+\\.)?adv\\.gr\\.jp/", 22, [3359], [{ e: 3360 }], [{ v: 3359 }], [{ h: 3359 }], [], {}], [1, "aemet", 1, "^https?://(www\\.)?aemet\\.es/", 22, [3361], [{ e: 3362 }], [{ v: 3361 }], [{ h: 3361 }], [{ check: "none", v: 3361 }], {}], [1, "aeolservice", 2, "^https?://cloud\\.aeolservice\\.es/", 22, [], [{ e: 3363 }], [{ v: 3364 }], [{ c: 3364 }, { wv: 3365 }, { all: true, optional: true, k: 3366 }, { c: 3367 }], [], {}], [1, "agentii.getsbet.ro", 2, "^https?://(\\w+\\.)?agentii\\.getsbet\\.ro/", 22, [3368], [{ e: 3369 }], [{ v: 3370 }], [{ c: 3370 }], [{ cc: 1852 }], {}], [1, "agenziaentrate-geoportale", 1, "^https?://geoportale\\.cartografia\\.agenziaentrate\\.gov\\.it/", 22, [845], [{ e: 3371 }], [{ v: 845 }], [{ h: 845 }], [{ check: "none", v: 845 }], {}], [1, "airbnb", 2, "^https?://(www\\.)?airbnb\\.[a-z.]+/", 22, [3372], [{ e: 3373 }], [{ v: 3373 }], [{ retry: 5, retryInterval: 500, c: 3373 }], [{ timeout: 1e3, check: "none", wv: 3373 }], {}], [1, "aliasdmc", 2, "^https?://([\\w-]+\\.)?aliasdmc\\.fr/", 22, [3374, 3375], [{ e: 3374 }], [{ v: 3374 }], [{ c: 3376 }, { wv: 3377 }, { all: true, k: 3377 }, { c: 3378 }, { check: "none", wv: 3374 }], [{ cc: 3379 }], {}], [1, "aliexpress", 2, "^https://([a-z]*\\.)?aliexpress\\.com/", 22, [3380], [{ e: 3381 }], [{ check: "any", v: 3381 }], [{ if: { e: 3382 }, then: [{ c: 3383 }], else: [{ if: { e: 3384 }, then: [{ if: { e: 3385 }, then: [{ c: 3386 }], else: [{ c: 3387 }, { timeout: 5e3, c: 3388 }] }], else: [{ if: { e: 3389 }, then: [{ c: 3390 }], else: [{ c: 3391 }, { timeout: 5e3, wv: 3392 }, { c: 3393 }] }] }] }], [], {}], [1, "allabout-japan", 2, "^https?://(\\w+\\.)?allabout-japan\\.com/", 22, [3394], [{ e: 3395 }], [{ v: 3395 }], [{ h: 3394 }, { timeout: 8e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [], {}], [1, "allwyn.cz", 2, "^https?://(\\w+\\.)?allwyn\\.cz/", 22, [3396], [{ e: 3397 }], [{ v: 3397 }], [{ c: 3397 }, { check: "none", timeout: 2e3, wv: 3398 }], [], {}], [1, "altin.in", 1, "^https?://(\\w+\\.)?altin\\.in/", 22, [3399], [{ e: 3400 }], [{ v: 3399 }], [{ h: 3399 }], [{ check: "none", v: 3399 }], {}], [1, "amazon-music", 2, "^https?://music\\.amazon\\.[a-z.]+/", 22, [3401], [{ e: 3402 }], [{ v: 3403 }], [{ waitForThenClick: ["#bannerFooter music-button[variant=outline]", "button"] }], [{ check: "none", timeout: 2e3, wv: 3403 }], {}], [1, "amazon-pay", 2, "^https?://pay\\.amazon\\.", 22, [3404], [{ e: 3405 }], [{ v: 3404 }], [{ k: 3405 }], [{ cc: 3406 }], {}], [1, "amazonforum", 2, "^https?://(\\w+\\.)?amazonforum\\.com/", 10, [], [{ exists: ["c-cookie-consent", ".cookiecon-footer-container-fixed button.cookie_reject_btn"] }], [{ visible: ["c-cookie-consent", ".cookiecon-footer-container-fixed"] }], [{ waitForThenClick: ["c-cookie-consent", ".cookiecon-footer-container-fixed button.cookie_reject_btn"] }, { waitFor: ["c-cookie-consent", "section.azCookieCustomise li lightning-input", "lightning-primitive-input-toggle", "input"] }, { if: { exists: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(1) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }, then: [{ click: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(1) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }] }, { if: { exists: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(2) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }, then: [{ click: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(2) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }] }, { if: { exists: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(3) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }, then: [{ click: ["c-cookie-consent", "section.azCookieCustomise li:nth-child(3) lightning-input", "lightning-primitive-input-toggle", "input:checked"] }] }, { click: ["c-cookie-consent", "section.azCookieCustomise footer .cookiecon-desktop-section lightning-button.focusStyleButton", "button"] }], [{ waitForVisible: ["c-cookie-consent", ".cookiecon-footer-container-fixed"], timeout: 2e3, check: "none" }], {}], [1, "animatetimes", 2, "^https?://(www\\.)?animatetimes\\.com/", 22, [3359], [{ e: 3359 }], [{ v: 3359 }], [{ c: 3407 }], [{ check: "none", v: 3359 }], {}], [1, "annunci69.it", 2, "^https?://(www\\.)?annunci69\\.it/", 22, [3408], [{ e: 3409 }], [{ v: 3408 }], [{ c: 3410 }, { wv: 3411 }, { optional: true, k: 3412 }, { k: 3413 }, { check: "none", wv: 3408 }], [{ cc: 3414 }], {}], [1, "aoc.com", 2, "^https?://(www\\.)?aoc\\.com/", 22, [3415], [{ e: 3416 }], [{ v: 3416 }], [{ c: 3417 }], [{ check: "none", v: 3415 }], {}], [1, "apteka911-ua", 1, "^https?://(www\\.)?apteka911\\.ua/", 22, [3418], [{ e: 3419 }], [{ v: 3418 }], [{ h: 3418 }], [], {}], [1, "arbeidsplassen-nav-no", 2, "^https?://arbeidsplassen\\.nav\\.no/", 22, [3420], [{ e: 3421 }], [{ v: 3420 }], [{ c: 3422 }], [{ cc: 1038 }], {}], [1, "arena.ai", 2, "^https?://(\\w+\\.)?arena\\.ai/", 22, [], [{ e: 3423 }], [{ v: 3423 }], [{ c: 3424 }, { wv: 3425 }, { all: true, optional: true, k: 3426 }, { c: 3427 }], [{ cc: 3428 }], {}], [1, "arena.pl", 2, "^https?://(\\w+\\.)?arena\\.pl/", 22, [], [{ e: 3429 }], [{ v: 3429 }], [{ c: 3430 }, { c: 3431 }], [{ cc: 3432 }], {}], [1, "artfund.org", 2, "^https?://(\\w+\\.)?artfund\\.org/", 22, [3433], [{ e: 3434 }], [{ v: 3435 }], [{ c: 3436 }, { c: 3437 }, { check: "none", timeout: 2e3, optional: true, wv: 3435 }], [{ cc: 3438 }], {}], [1, "aslroma1-it", 2, "^https?://(\\w+\\.)?aslroma1\\.it/", 22, [3439], [{ e: 3440 }], [{ v: 3439 }], [{ c: 3440 }, { check: "none", wv: 3439 }], [{ cc: 3441 }], {}], [1, "asrock", 2, "^https?://(\\w+\\.)?asrock\\.com/", 22, [], [{ e: 3442 }], [{ v: 3443 }], [{ c: 3444 }, { wv: 3445 }, { all: true, optional: true, k: 3446 }, { k: 3447 }], [{ cc: 3448 }], {}], [1, "athlinks-com", 1, "^https://(www\\.)?athlinks\\.com/", 22, [3449], [{ e: 3449 }], [{ v: 3450 }], [{ h: 3449 }], [], {}], [1, "att", 2, "^https://([a-z0-9-]+\\.)*att\\.com/", 22, [3451], [{ exists: ["#gpc-banner-container", "#declineSave"] }], [{ visible: ["#gpc-banner-container", "#declineSave"] }], [{ waitForThenClick: ["#gpc-banner-container", "#declineSave"] }], [{ wait: 1e3 }, { cc: 3452 }], {}], [1, "auctionet", 2, "^https?://(www\\.)?auctionet\\.(com|se)/", 22, [3453], [{ e: 3454 }], [{ v: 3454 }], [{ c: 3455 }, { c: 3456 }], [{ wait: 500 }, { cc: 3457 }], {}], [1, "auto_AU_acetool.com_n0w", 0, "^https?://(www\\.)?acetool\\.com/", 10, [], [{ e: 3458 }], [{ v: 3458 }], [{ wait: 500 }, { c: 3458 }], [{ timeout: 1e3, check: "none", wv: 3458 }], {}], [1, "auto_AU_aelfie.com_chb", 0, "^https?://(www\\.)?aelfie\\.com/", 10, [], [{ e: 3459 }], [{ v: 3459 }], [{ wait: 500 }, { c: 3459 }], [{ timeout: 1e3, check: "none", wv: 3459 }], {}], [1, "auto_AU_cam.start.canon_3x5", 0, "^https?://(www\\.)?cam\\.start\\.canon/", 10, [], [{ e: 3460 }], [{ v: 3460 }], [{ wait: 500 }, { c: 3460 }], [{ timeout: 1e3, check: "none", wv: 3460 }], {}], [1, "auto_AU_capitoltrades.com_ak9", 0, "^https?://(www\\.)?capitoltrades\\.com/", 10, [], [{ e: 3461 }], [{ v: 3461 }], [{ wait: 500 }, { c: 3461 }], [{ timeout: 1e3, check: "none", wv: 3461 }], {}], [1, "auto_AU_conference-board.org_dce", 0, "^https?://(www\\.)?conference-board\\.org/", 10, [], [{ e: 3462 }], [{ v: 3462 }], [{ wait: 500 }, { c: 3462 }], [{ timeout: 1e3, check: "none", wv: 3462 }], {}], [1, "auto_AU_deezer.com_tmf", 0, "^https?://(www\\.)?deezer\\.com/", 10, [], [{ e: 3463 }], [{ v: 3463 }], [{ wait: 500 }, { c: 3463 }], [{ timeout: 1e3, check: "none", wv: 3463 }], {}], [1, "auto_AU_docs.portainer.io_hn5", 0, "^https?://(www\\.)?docs\\.portainer\\.io/", 10, [], [{ e: 3464 }], [{ v: 3464 }], [{ wait: 500 }, { c: 3464 }], [{ timeout: 1e3, check: "none", wv: 3464 }], {}], [1, "auto_AU_flysaa.com_qsm", 0, "^https?://(www\\.)?flysaa\\.com/", 10, [3465], [{ e: 3465 }], [{ v: 3466 }], [{ c: 3467 }], [{ timeout: 1e3, check: "none", wv: 3466 }], {}], [1, "auto_AU_lush.com_bdf", 0, "^https?://(www\\.)?lush\\.com/", 10, [], [{ e: 3468 }], [{ v: 3468 }], [{ wait: 500 }, { c: 3468 }], [{ timeout: 1e3, check: "none", wv: 3468 }], {}], [1, "auto_AU_newyork.doverstreetmarket.com_j5q", 0, "^https?://(www\\.)?newyork\\.doverstreetmarket\\.com/", 10, [], [{ e: 3469 }], [{ v: 3469 }], [{ wait: 500 }, { c: 3469 }], [{ timeout: 1e3, check: "none", wv: 3469 }], {}], [1, "auto_AU_niwaki.com_w41", 0, "^https?://(www\\.)?niwaki\\.com/", 10, [], [{ e: 3470 }], [{ v: 3470 }], [{ wait: 500 }, { c: 3470 }], [{ timeout: 1e3, check: "none", wv: 3470 }], {}], [1, "auto_AU_pichunter.com_zhf", 0, "^https?://(www\\.)?pichunter\\.com/", 10, [], [{ e: 3471 }], [{ v: 3471 }], [{ wait: 500 }, { c: 3471 }], [{ timeout: 1e3, check: "none", wv: 3471 }], {}], [1, "auto_AU_publicdomainreview.org_7fg", 0, "^https?://(www\\.)?publicdomainreview\\.org/", 10, [], [{ e: 3472 }], [{ v: 3472 }], [{ wait: 500 }, { c: 3472 }], [{ timeout: 1e3, check: "none", wv: 3472 }], {}], [1, "auto_AU_rki.de_tp5", 0, "^https?://(www\\.)?rki\\.de/", 10, [], [{ e: 3473 }], [{ v: 3473 }], [{ wait: 500 }, { c: 3473 }], [{ timeout: 1e3, check: "none", wv: 3473 }], {}], [1, "auto_AU_telekom.hu_4lu", 0, "^https?://(www\\.)?telekom\\.hu/", 10, [], [{ e: 3474 }], [{ v: 3474 }], [{ wait: 500 }, { c: 3474 }], [{ timeout: 1e3, check: "none", wv: 3474 }], {}], [1, "auto_AU_tourismnewbrunswick.ca_bjd", 0, "^https?://(www\\.)?tourismnewbrunswick\\.ca/", 10, [], [{ e: 3475 }], [{ v: 3475 }], [{ wait: 500 }, { c: 3475 }], [{ timeout: 1e3, check: "none", wv: 3475 }], {}], [1, "auto_AU_tripcentral.ca_v7v", 0, "^https?://(www\\.)?tripcentral\\.ca/", 10, [], [{ e: 3476 }], [{ v: 3476 }], [{ wait: 500 }, { c: 3476 }], [{ timeout: 1e3, check: "none", wv: 3476 }], {}], [1, "auto_CA_407etr.com_wrd", 0, "^https?://(www\\.)?407etr\\.com/", 10, [], [{ e: 3477 }], [{ v: 3477 }], [{ wait: 500 }, { c: 3477 }], [{ timeout: 1e3, check: "none", wv: 3477 }], {}], [1, "auto_CA_arte.tv_7nv", 0, "^https?://(www\\.)?arte\\.tv/", 10, [], [{ e: 3478 }], [{ v: 3478 }], [{ c: 3478 }], [], {}], [1, "auto_CA_babel.hathitrust.org_i6g", 0, "^https?://(www\\.)?babel\\.hathitrust\\.org/", 10, [], [{ e: 3479 }], [{ v: 3479 }], [{ wait: 500 }, { c: 3479 }], [{ timeout: 1e3, check: "none", wv: 3479 }], {}], [1, "auto_CA_bet365.bet.br_kkx", 0, "^https?://(www\\.)?bet365\\.bet\\.br/", 10, [], [{ e: 3480 }], [{ v: 3480 }], [{ wait: 500 }, { c: 3480 }], [{ timeout: 1e3, check: "none", wv: 3480 }], {}], [1, "auto_CA_brazzers.com_kik", 0, "^https?://(www\\.)?brazzers\\.com/", 10, [], [{ e: 3481 }], [{ v: 3481 }], [{ wait: 500 }, { c: 3481 }], [{ timeout: 1e3, check: "none", wv: 3481 }], {}], [1, "auto_CA_busbud.com_0sh", 0, "^https?://(www\\.)?busbud\\.com/", 10, [], [{ e: 3482 }], [{ v: 3482 }], [{ wait: 500 }, { c: 3482 }], [{ timeout: 1e3, check: "none", wv: 3482 }], {}], [1, "auto_CA_cfo.coop_edx", 0, "^https?://(www\\.)?cfo\\.coop/", 10, [], [{ e: 3483 }], [{ v: 3483 }], [{ wait: 500 }, { c: 3483 }], [{ timeout: 1e3, check: "none", wv: 3483 }], {}], [1, "auto_CA_chipolo.net_zo9", 0, "^https?://(www\\.)?chipolo\\.net/", 10, [], [{ e: 3484 }], [{ v: 3484 }], [{ wait: 500 }, { c: 3484 }], [{ timeout: 1e3, check: "none", wv: 3484 }], {}], [1, "auto_CA_golftown.com_zcn", 0, "^https?://(www\\.)?golftown\\.com/", 10, [], [{ e: 3485 }], [{ v: 3485 }], [{ wait: 500 }, { c: 3485 }], [{ timeout: 1e3, check: "none", wv: 3485 }], {}], [1, "auto_CA_intact.ca_gax", 0, "^https?://(www\\.)?intact\\.ca/", 10, [], [{ e: 3486 }], [{ v: 3486 }], [{ wait: 500 }, { c: 3486 }], [{ timeout: 1e3, check: "none", wv: 3486 }], {}], [1, "auto_CA_nationalarchives.gov.uk_vgx", 0, "^https?://(www\\.)?webarchive\\.nationalarchives\\.gov\\.uk/", 10, [], [{ e: 3487 }], [{ v: 3487 }], [{ wait: 500 }, { c: 3487 }], [{ timeout: 1e3, check: "none", wv: 3487 }], {}], [1, "auto_CA_ticketsource.com_kiv", 0, "^https?://(www\\.)?ticketsource\\.com/", 10, [], [{ e: 3488 }], [{ v: 3488 }], [{ wait: 500 }, { c: 3488 }], [{ timeout: 1e3, check: "none", wv: 3488 }], {}], [1, "auto_CH_android.bestsecret.com_m12_+1", 0, "^https?://(www\\.)?android\\.bestsecret\\.com/|^https?://(www\\.)?orders\\.bestsecret\\.com/", 10, [], [{ e: 3489 }], [{ v: 3489 }], [{ wait: 500 }, { c: 3489 }], [{ timeout: 1e3, check: "none", wv: 3489 }], {}], [1, "auto_CH_arttv.ch_2lm", 0, "^https?://(www\\.)?arttv\\.ch/", 10, [], [{ e: 3490 }], [{ v: 3490 }], [{ wait: 500 }, { c: 3490 }], [{ timeout: 1e3, check: "none", wv: 3490 }], {}], [1, "auto_CH_ascona.il-centro.ch_59k", 0, "^https?://(www\\.)?ascona\\.il-centro\\.ch/", 10, [], [{ e: 3491 }], [{ v: 3491 }], [{ wait: 500 }, { c: 3491 }], [{ timeout: 1e3, check: "none", wv: 3491 }], {}], [1, "auto_CH_astag.ch_1if", 0, "^https?://(www\\.)?astag\\.ch/", 10, [], [{ e: 3492 }], [{ v: 3492 }], [{ wait: 500 }, { c: 3492 }], [{ timeout: 1e3, check: "none", wv: 3492 }], {}], [1, "auto_CH_auto.swiss_z35", 0, "^https?://(www\\.)?auto\\.swiss/", 10, [], [{ e: 3493 }], [{ v: 3493 }], [{ wait: 500 }, { c: 3493 }], [{ timeout: 1e3, check: "none", wv: 3493 }], {}], [1, "auto_CH_bandlab.com_jul", 0, "^https?://(www\\.)?bandlab\\.com/", 10, [], [{ e: 3494 }], [{ v: 3494 }], [{ wait: 500 }, { c: 3494 }], [{ timeout: 1e3, check: "none", wv: 3494 }], {}], [1, "auto_CH_bitbox.swiss_w0n", 0, "^https?://(www\\.)?bitbox\\.swiss/", 10, [], [{ e: 3495 }], [{ v: 3495 }], [{ wait: 500 }, { c: 3495 }], [{ timeout: 1e3, check: "none", wv: 3495 }], {}], [1, "auto_CH_blutspendezurich.ch_s0f", 0, "^https?://(www\\.)?blutspendezurich\\.ch/", 10, [], [{ e: 3496 }], [{ v: 3496 }], [{ wait: 500 }, { c: 3496 }], [{ timeout: 1e3, check: "none", wv: 3496 }], {}], [1, "auto_CH_cardmarket.com_15t", 0, "^https?://(www\\.)?cardmarket\\.com/", 10, [], [{ e: 3497 }], [{ v: 3497 }], [{ wait: 500 }, { c: 3497 }], [{ timeout: 1e3, check: "none", wv: 3497 }], {}], [1, "auto_CH_europarl.europa.eu_y2d", 0, "^https?://(www\\.)?europarl\\.europa\\.eu/", 10, [], [{ e: 3498 }], [{ v: 3498 }], [{ wait: 500 }, { c: 3498 }], [{ timeout: 1e3, check: "none", wv: 3498 }], {}], [1, "auto_CH_galaxus.de_sqv_+1", 0, "^https?://(www\\.)?galaxus\\.de/|^https?://(www\\.)?galaxus\\.fr/", 10, [], [{ e: 3499 }], [{ v: 3499 }], [{ wait: 500 }, { c: 3499 }], [{ timeout: 1e3, check: "none", wv: 3499 }], {}], [1, "auto_CH_instant-gaming.com_8j3", 0, "^https?://(www\\.)?instant-gaming\\.com/", 10, [], [{ e: 3500 }], [{ v: 3500 }], [{ wait: 500 }, { c: 3500 }], [{ timeout: 1e3, check: "none", wv: 3500 }], {}], [1, "auto_CH_kobo.com_p4l", 0, "^https?://(www\\.)?kobo\\.com/", 10, [], [{ e: 3501 }], [{ v: 3501 }], [{ wait: 500 }, { c: 3501 }], [{ timeout: 1e3, check: "none", wv: 3501 }], {}], [1, "auto_CH_louis-moto.ch_5yk", 0, "^https?://(www\\.)?louis-moto\\.ch/", 10, [], [{ e: 3502 }], [{ v: 3502 }], [{ wait: 500 }, { c: 3502 }], [{ timeout: 1e3, check: "none", wv: 3502 }], {}], [1, "auto_CH_meintiptopf.ch_84l", 0, "^https?://(www\\.)?meintiptopf\\.ch/", 10, [], [{ e: 3503 }], [{ v: 3503 }], [{ wait: 500 }, { c: 3503 }], [{ timeout: 1e3, check: "none", wv: 3503 }], {}], [1, "auto_CH_mrporter.com_0nl_+1", 0, "^https?://(www\\.)?mrporter\\.com/|^https?://(www\\.)?net-a-porter\\.com/", 10, [], [{ e: 3504 }], [{ v: 3504 }], [{ wait: 500 }, { c: 3504 }], [{ timeout: 1e3, check: "none", wv: 3504 }], {}], [1, "auto_CH_pmphotomedia.ch_ume", 0, "^https?://(www\\.)?pmphotomedia\\.ch/", 10, [], [{ e: 3505 }], [{ v: 3505 }], [{ wait: 500 }, { c: 3505 }], [{ timeout: 1e3, check: "none", wv: 3505 }], {}], [1, "auto_CH_sac-uto.ch_3gu", 0, "^https?://(www\\.)?sac-uto\\.ch/", 10, [], [{ e: 3506 }], [{ v: 3506 }], [{ wait: 500 }, { c: 3506 }], [{ timeout: 1e3, check: "none", wv: 3506 }], {}], [1, "auto_CH_transn.ch_ygb", 0, "^https?://(www\\.)?transn\\.ch/", 10, [], [{ e: 3507 }], [{ v: 3507 }], [{ wait: 500 }, { c: 3507 }], [{ timeout: 1e3, check: "none", wv: 3507 }], {}], [1, "auto_CH_ubs-kidscup.ch_5oc", 0, "^https?://(www\\.)?ubs-kidscup\\.ch/", 10, [], [{ e: 3508 }], [{ v: 3508 }], [{ wait: 500 }, { c: 3508 }], [{ timeout: 1e3, check: "none", wv: 3508 }], {}], [1, "auto_DE_all-inkl.com_toh", 0, "^https?://(www\\.)?all-inkl\\.com/", 10, [], [{ e: 3509 }], [{ v: 3509 }], [{ wait: 500 }, { c: 3509 }], [{ timeout: 1e3, check: "none", wv: 3509 }], {}], [1, "auto_DE_bmz.de_nss", 0, "^https?://(www\\.)?bmz\\.de/", 10, [], [{ e: 3510 }], [{ v: 3510 }], [{ wait: 500 }, { c: 3510 }], [{ timeout: 1e3, check: "none", wv: 3510 }], {}], [1, "auto_DE_byak.de_dcj", 0, "^https?://(www\\.)?byak\\.de/", 10, [], [{ e: 3511 }], [{ v: 3511 }], [{ wait: 500 }, { c: 3511 }], [{ timeout: 1e3, check: "none", wv: 3511 }], {}], [1, "auto_DE_byte.fm_83l", 0, "^https?://(www\\.)?byte\\.fm/", 10, [], [{ e: 3512 }], [{ v: 3512 }], [{ wait: 500 }, { c: 3512 }], [{ timeout: 1e3, check: "none", wv: 3512 }], {}], [1, "auto_DE_club.auto-doc.at_6xj", 0, "^https?://(www\\.)?club\\.auto-doc\\.at/", 10, [], [{ e: 3513 }], [{ v: 3513 }], [{ wait: 500 }, { c: 3513 }], [{ timeout: 1e3, check: "none", wv: 3513 }], {}], [1, "auto_DE_das-ist-drin.de_e12", 0, "^https?://(www\\.)?das-ist-drin\\.de/", 10, [], [{ e: 3514 }], [{ v: 3514 }], [{ wait: 500 }, { c: 3514 }], [{ timeout: 1e3, check: "none", wv: 3514 }], {}], [1, "auto_DE_eezy.nrw_9aj", 0, "^https?://(www\\.)?eezy\\.nrw/", 10, [], [{ e: 3515 }], [{ v: 3515 }], [{ wait: 500 }, { c: 3515 }], [{ timeout: 1e3, check: "none", wv: 3515 }], {}], [1, "auto_DE_feierabend.de_kr4", 0, "^https?://(www\\.)?feierabend\\.de/", 10, [], [{ e: 3516 }], [{ v: 3516 }], [{ wait: 500 }, { c: 3516 }], [{ timeout: 1e3, check: "none", wv: 3516 }], {}], [1, "auto_DE_feser-graf.de_qz8", 0, "^https?://(www\\.)?feser-graf\\.de/", 10, [], [{ e: 3517 }], [{ v: 3517 }], [{ wait: 500 }, { c: 3517 }], [{ timeout: 1e3, check: "none", wv: 3517 }], {}], [1, "auto_DE_finanzpartner.de_13s", 0, "^https?://(www\\.)?finanzpartner\\.de/", 10, [], [{ e: 3518 }], [{ v: 3518 }], [{ wait: 500 }, { c: 3518 }], [{ timeout: 1e3, check: "none", wv: 3518 }], {}], [1, "auto_DE_gasometer.de_0xw", 0, "^https?://(www\\.)?gasometer\\.de/", 10, [], [{ e: 3519 }], [{ v: 3519 }], [{ wait: 500 }, { c: 3519 }], [{ timeout: 1e3, check: "none", wv: 3519 }], {}], [1, "auto_DE_immobilien.sparkasse.de_zj7", 0, "^https?://(www\\.)?immobilien\\.sparkasse\\.de/", 10, [2887], [{ e: 3520 }], [{ v: 3520 }], [{ c: 3521 }], [{ timeout: 1e3, check: "none", wv: 3520 }], {}], [1, "auto_DE_lenovo.com_xcv", 0, "^https?://(www\\.)?lenovo\\.com/", 10, [], [{ e: 3522 }], [{ v: 3522 }], [{ wait: 500 }, { c: 3522 }], [{ timeout: 1e3, check: "none", wv: 3522 }], {}], [1, "auto_DE_mitarbeiterservice.bayern.de_quh", 0, "^https?://(www\\.)?mitarbeiterservice\\.bayern\\.de/", 10, [], [{ e: 3523 }], [{ v: 3523 }], [{ wait: 500 }, { c: 3523 }], [{ timeout: 1e3, check: "none", wv: 3523 }], {}], [1, "auto_DE_originalteile.mercedes-benz.de_tce", 0, "^https?://(www\\.)?originalteile\\.mercedes-benz\\.de/", 10, [], [{ e: 3524 }], [{ v: 3524 }], [{ wait: 500 }, { c: 3524 }], [{ timeout: 1e3, check: "none", wv: 3524 }], {}], [1, "auto_DE_pflanzenhof-online.de_au2", 0, "^https?://(www\\.)?pflanzenhof-online\\.de/", 10, [], [{ e: 3525 }], [{ v: 3525 }], [{ wait: 500 }, { c: 3525 }], [{ timeout: 1e3, check: "none", wv: 3525 }], {}], [1, "auto_DE_schwabach.de_fjr", 0, "^https?://(www\\.)?schwabach\\.de/", 10, [], [{ e: 3526 }], [{ v: 3526 }], [{ wait: 500 }, { c: 3526 }], [{ timeout: 1e3, check: "none", wv: 3526 }], {}], [1, "auto_DE_schwaebisch-hall.de_0g1", 0, "^https?://(www\\.)?schwaebisch-hall\\.de/", 10, [], [{ e: 3527 }], [{ v: 3527 }], [{ wait: 500 }, { c: 3527 }], [{ timeout: 1e3, check: "none", wv: 3527 }], {}], [1, "auto_DE_sellercentral.amazon.de_xi0", 0, "^https?://(www\\.)?sellercentral\\.amazon\\.de/", 10, [], [{ e: 3528 }], [{ v: 3528 }], [{ wait: 500 }, { c: 3528 }], [{ timeout: 1e3, check: "none", wv: 3528 }], {}], [1, "auto_DE_sephora.de_exg", 0, "^https?://(www\\.)?sephora\\.de/", 10, [], [{ e: 3504 }], [{ v: 3504 }], [{ wait: 500 }, { c: 3504 }], [{ timeout: 1e3, check: "none", wv: 3504 }], {}], [1, "auto_DE_steeltoyz.de_i51", 0, "^https?://(www\\.)?steeltoyz\\.de/", 10, [], [{ e: 3529 }], [{ v: 3529 }], [{ wait: 500 }, { c: 3529 }], [{ timeout: 1e3, check: "none", wv: 3529 }], {}], [1, "auto_DE_survival-kompass.de_kv6", 0, "^https?://(www\\.)?survival-kompass\\.de/", 10, [], [{ e: 3530 }], [{ v: 3530 }], [{ wait: 500 }, { c: 3530 }], [{ timeout: 1e3, check: "none", wv: 3530 }], {}], [1, "auto_DE_uni-mannheim.de_omi", 0, "^https?://(www\\.)?uni-mannheim\\.de/", 10, [], [{ e: 3531 }], [{ v: 3531 }], [{ wait: 500 }, { c: 3531 }], [{ timeout: 1e3, check: "none", wv: 3531 }], {}], [1, "auto_DE_variete.de_6cc", 0, "^https?://(www\\.)?variete\\.de/", 10, [], [{ e: 3532 }], [{ v: 3532 }], [{ wait: 500 }, { c: 3532 }], [{ timeout: 1e3, check: "none", wv: 3532 }], {}], [1, "auto_DE_wolt.com_jyq", 0, "^https?://(www\\.)?wolt\\.com/", 10, [], [{ e: 3533 }], [{ v: 3533 }], [{ wait: 500 }, { c: 3533 }], [{ timeout: 1e3, check: "none", wv: 3533 }], {}], [1, "auto_FR_asp.gouv.fr_ytt", 0, "^https?://(www\\.)?asp\\.gouv\\.fr/", 10, [], [{ e: 3534 }], [{ v: 3534 }], [{ wait: 500 }, { c: 3534 }], [{ timeout: 1e3, check: "none", wv: 3534 }], {}], [1, "auto_FR_bobvoyeur.com_qm5", 0, "^https?://(www\\.)?bobvoyeur\\.com/", 10, [], [{ e: 3535 }], [{ v: 3535 }], [{ wait: 500 }, { c: 3535 }], [{ timeout: 1e3, check: "none", wv: 3535 }], {}], [1, "auto_FR_bpi.fr_l52", 0, "^https?://(www\\.)?bpi\\.fr/", 10, [], [{ e: 3536 }], [{ v: 3536 }], [{ wait: 500 }, { c: 3536 }], [{ timeout: 1e3, check: "none", wv: 3536 }], {}], [1, "auto_FR_chamrousse.com_i7u", 0, "^https?://(www\\.)?chamrousse\\.com/", 10, [], [{ e: 3537 }], [{ v: 3537 }], [{ wait: 500 }, { c: 3537 }], [{ timeout: 1e3, check: "none", wv: 3537 }], {}], [1, "auto_FR_cite-sciences.fr_kcx", 0, "^https?://(www\\.)?cite-sciences\\.fr/", 10, [], [{ e: 3538 }], [{ v: 3538 }], [{ wait: 500 }, { c: 3538 }], [{ timeout: 1e3, check: "none", wv: 3538 }], {}], [1, "auto_FR_coutellerie-tourangelle.com_rcf", 0, "^https?://(www\\.)?coutellerie-tourangelle\\.com/", 10, [], [{ e: 3539 }], [{ v: 3539 }], [{ wait: 500 }, { c: 3539 }], [{ timeout: 1e3, check: "none", wv: 3539 }], {}], [1, "auto_FR_euro-expos.com_tok", 0, "^https?://(www\\.)?euro-expos\\.com/", 10, [], [{ e: 3540 }], [{ v: 3540 }], [{ wait: 500 }, { c: 3540 }], [{ timeout: 1e3, check: "none", wv: 3540 }], {}], [1, "auto_FR_glamuse.com_n32", 0, "^https?://(www\\.)?glamuse\\.com/", 10, [], [{ e: 3541 }], [{ v: 3541 }], [{ wait: 500 }, { c: 3541 }], [{ timeout: 1e3, check: "none", wv: 3541 }], {}], [1, "auto_FR_gmf.fr_pxt", 0, "^https?://(www\\.)?gmf\\.fr/", 10, [], [{ e: 3542 }], [{ v: 3542 }], [{ wait: 500 }, { c: 3542 }], [{ timeout: 1e3, check: "none", wv: 3542 }], {}], [1, "auto_FR_gov.br_n2f", 0, "^https?://(www\\.)?gov\\.br/", 10, [], [{ e: 3543 }], [{ v: 3543 }], [{ wait: 500 }, { c: 3543 }], [{ timeout: 1e3, check: "none", wv: 3543 }], {}], [1, "auto_FR_lalibrairie.com_0lt", 0, "^https?://(www\\.)?lalibrairie\\.com/", 10, [], [{ e: 3544 }], [{ v: 3544 }], [{ wait: 500 }, { c: 3544 }], [{ timeout: 1e3, check: "none", wv: 3544 }], {}], [1, "auto_FR_lesprosdelapetiteenfance.fr_bng", 0, "^https?://(www\\.)?lesprosdelapetiteenfance\\.fr/", 10, [], [{ e: 3545 }], [{ v: 3545 }], [{ wait: 500 }, { c: 3545 }], [{ timeout: 1e3, check: "none", wv: 3545 }], {}], [1, "auto_FR_maboussoleaidants.fr_f8f", 0, "^https?://(www\\.)?maboussoleaidants\\.fr/", 10, [], [{ e: 3546 }], [{ v: 3546 }], [{ wait: 500 }, { c: 3546 }], [{ timeout: 1e3, check: "none", wv: 3546 }], {}], [1, "auto_FR_norauto.fr_mbi", 0, "^https?://(www\\.)?norauto\\.fr/", 10, [], [{ e: 3547 }], [{ v: 3547 }], [{ wait: 500 }, { c: 3547 }], [{ timeout: 1e3, check: "none", wv: 3547 }], {}], [1, "auto_FR_nouslib.com_1tl", 0, "^https?://(www\\.)?nouslib\\.com/", 10, [], [{ e: 3548 }], [{ v: 3548 }], [{ wait: 500 }, { c: 3548 }], [{ timeout: 1e3, check: "none", wv: 3548 }], {}], [1, "auto_FR_oceane.breizhgo.bzh_g7u", 0, "^https?://(www\\.)?oceane\\.breizhgo\\.bzh/", 10, [], [{ e: 3549 }], [{ v: 3549 }], [{ wait: 500 }, { c: 3549 }], [{ timeout: 1e3, check: "none", wv: 3549 }], {}], [1, "auto_FR_pointp.fr_2ft", 0, "^https?://(www\\.)?pointp\\.fr/", 10, [], [{ e: 3542 }], [{ v: 3542 }], [{ wait: 500 }, { c: 3542 }], [{ timeout: 1e3, check: "none", wv: 3542 }], {}], [1, "auto_FR_privateaser.com_uco", 0, "^https?://(www\\.)?privateaser\\.com/", 10, [], [{ e: 3550 }], [{ v: 3550 }], [{ wait: 500 }, { c: 3550 }], [{ timeout: 1e3, check: "none", wv: 3550 }], {}], [1, "auto_FR_proantic.com_oyg", 0, "^https?://(www\\.)?proantic\\.com/", 10, [], [{ e: 3551 }], [{ v: 3551 }], [{ wait: 500 }, { c: 3551 }], [{ timeout: 1e3, check: "none", wv: 3551 }], {}], [1, "auto_FR_sephora.fr_k3l", 0, "^https?://(www\\.)?sephora\\.fr/", 10, [], [{ e: 3504 }], [{ v: 3504 }], [{ wait: 500 }, { c: 3504 }], [{ timeout: 1e3, check: "none", wv: 3504 }], {}], [1, "auto_GB_brightondome.org_iz9", 0, "^https?://(www\\.)?brightondome\\.org/", 10, [], [{ e: 3552 }], [{ v: 3552 }], [{ wait: 500 }, { c: 3552 }], [{ timeout: 1e3, check: "none", wv: 3552 }], {}], [1, "auto_GB_cpfc.co.uk_0", 0, "^https?://(www\\.)?cpfc\\.co\\.uk/", 10, [], [{ e: 3553 }], [{ v: 3553 }], [{ c: 3553 }], [], {}], [1, "auto_GB_edinburghcastle.scot_h2e", 0, "^https?://(www\\.)?edinburghcastle\\.scot/", 10, [], [{ e: 3554 }], [{ v: 3554 }], [{ wait: 500 }, { c: 3554 }], [{ timeout: 1e3, check: "none", wv: 3554 }], {}], [1, "auto_GB_everysaving.co.uk_38t", 0, "^https?://(www\\.)?everysaving\\.co\\.uk/", 10, [], [{ e: 3555 }], [{ v: 3555 }], [{ c: 3555 }], [], {}], [1, "auto_GB_f6s.com_221", 0, "^https?://(www\\.)?f6s\\.com/", 10, [], [{ e: 3556 }], [{ v: 3556 }], [{ wait: 500 }, { c: 3556 }], [{ timeout: 1e3, check: "none", wv: 3556 }], {}], [1, "auto_GB_fca.org.uk_9p9", 0, "^https?://(www\\.)?fca\\.org\\.uk/", 10, [], [{ e: 3557 }], [{ v: 3557 }], [{ wait: 500 }, { c: 3557 }], [{ timeout: 1e3, check: "none", wv: 3557 }], {}], [1, "auto_GB_garden4less.co.uk_0", 0, "^https?://(www\\.)?garden4less\\.co\\.uk/", 10, [], [{ e: 3558 }], [{ v: 3558 }], [{ c: 3558 }], [], {}], [1, "auto_GB_golfbidder.co.uk_xs6", 0, "^https?://(www\\.)?golfbidder\\.co\\.uk/", 10, [], [{ e: 3559 }], [{ v: 3559 }], [{ wait: 500 }, { c: 3559 }], [{ timeout: 1e3, check: "none", wv: 3559 }], {}], [1, "auto_GB_historicenvironment.scot_0", 0, "^https?://(www\\.)?historicenvironment\\.scot/", 10, [], [{ e: 3560 }], [{ v: 3560 }], [{ c: 3560 }], [], {}], [1, "auto_GB_kirklees.gov.uk_0", 0, "^https?://(www\\.)?kirklees\\.gov\\.uk/", 10, [], [{ e: 3561 }], [{ v: 3561 }], [{ c: 3561 }], [], {}], [1, "auto_GB_outfox.energy_6ux", 0, "^https?://(www\\.)?outfox\\.energy/", 10, [], [{ e: 3562 }], [{ v: 3562 }], [{ wait: 500 }, { c: 3562 }], [{ timeout: 1e3, check: "none", wv: 3562 }], {}], [1, "auto_GB_reading.gov.uk_0", 0, "^https?://(www\\.)?reading\\.gov\\.uk/", 10, [], [{ e: 3563 }], [{ v: 3563 }], [{ wait: 500 }, { c: 3563 }], [{ timeout: 1e3, check: "none", wv: 3563 }], {}], [1, "auto_GB_supremecourt.uk_0", 0, "^https?://(www\\.)?supremecourt\\.uk/", 10, [], [{ e: 3564 }], [{ v: 3564 }], [{ c: 3564 }], [{ timeout: 1e3, check: "none", wv: 3564 }], {}], [1, "auto_GB_trove.scot_xtg", 0, "^https?://(www\\.)?trove\\.scot/", 10, [], [{ e: 3565 }], [{ v: 3565 }], [{ wait: 500 }, { c: 3565 }], [{ timeout: 1e3, check: "none", wv: 3565 }], {}], [1, "auto_GB_virgin.com_0", 0, "^https?://(www\\.)?virgin\\.com/", 10, [], [{ e: 3566 }], [{ v: 3566 }], [{ wait: 500 }, { c: 3566 }], [{ timeout: 1e3, check: "none", wv: 3566 }], {}], [1, "auto_GB_vrhump.com_pb5", 0, "^https?://(www\\.)?vrhump\\.com/", 10, [], [{ e: 3567 }], [{ v: 3567 }], [{ wait: 500 }, { c: 3567 }], [{ timeout: 1e3, check: "none", wv: 3567 }], {}], [1, "auto_NL_beekman.nl_f9e", 0, "^https?://(www\\.)?beekman\\.nl/", 10, [], [{ e: 3568 }], [{ v: 3568 }], [{ wait: 500 }, { c: 3568 }], [{ timeout: 1e3, check: "none", wv: 3568 }], {}], [1, "auto_NL_berivita.com_q3z", 0, "^https?://(www\\.)?berivita\\.com/", 10, [], [{ e: 3569 }], [{ v: 3569 }], [{ wait: 500 }, { c: 3569 }], [{ timeout: 1e3, check: "none", wv: 3569 }], {}], [1, "auto_NL_bibliotheekaanzet.nl_mh6", 0, "^https?://(www\\.)?bibliotheekaanzet\\.nl/", 10, [], [{ e: 3570 }], [{ v: 3570 }], [{ wait: 500 }, { c: 3570 }], [{ timeout: 1e3, check: "none", wv: 3570 }], {}], [1, "auto_NL_clinicaldiagnostics.nl_pmu", 0, "^https?://(www\\.)?clinicaldiagnostics\\.nl/", 10, [], [{ e: 3571 }], [{ v: 3571 }], [{ wait: 500 }, { c: 3571 }], [{ timeout: 1e3, check: "none", wv: 3571 }], {}], [1, "auto_NL_consumentenbond.nl_53g", 0, "^https?://(www\\.)?consumentenbond\\.nl/", 10, [], [{ e: 3572 }], [{ v: 3572 }], [{ wait: 500 }, { c: 3572 }], [{ timeout: 1e3, check: "none", wv: 3572 }], {}], [1, "auto_NL_discountoffice.nl_2fb", 0, "^https?://(www\\.)?discountoffice\\.nl/", 10, [], [{ e: 3573 }], [{ v: 3573 }], [{ wait: 500 }, { c: 3573 }], [{ timeout: 1e3, check: "none", wv: 3573 }], {}], [1, "auto_NL_ditjesendatjes.nl_0sa", 0, "^https?://(www\\.)?ditjesendatjes\\.nl/", 10, [], [{ e: 3574 }], [{ v: 3574 }], [{ wait: 500 }, { c: 3574 }], [{ timeout: 1e3, check: "none", wv: 3574 }], {}], [1, "auto_NL_duitslandinstituut.nl_d4q", 0, "^https?://(www\\.)?duitslandinstituut\\.nl/", 10, [], [{ e: 3575 }], [{ v: 3575 }], [{ wait: 500 }, { c: 3575 }], [{ timeout: 1e3, check: "none", wv: 3575 }], {}], [1, "auto_NL_fietsonderdelenoutlet.nl_x8u", 0, "^https?://(www\\.)?fietsonderdelenoutlet\\.nl/", 10, [], [{ e: 3576 }], [{ v: 3576 }], [{ wait: 500 }, { c: 3576 }], [{ timeout: 1e3, check: "none", wv: 3576 }], {}], [1, "auto_NL_frankenergie.nl_9xh", 0, "^https?://(www\\.)?frankenergie\\.nl/", 10, [], [{ e: 3577 }], [{ v: 3577 }], [{ wait: 500 }, { c: 3577 }], [{ timeout: 1e3, check: "none", wv: 3577 }], {}], [1, "auto_NL_gezondheidenwetenschap.be_zgi", 0, "^https?://(www\\.)?gezondheidenwetenschap\\.be/", 10, [], [{ e: 3578 }], [{ v: 3578 }], [{ wait: 500 }, { c: 3578 }], [{ timeout: 1e3, check: "none", wv: 3578 }], {}], [1, "auto_NL_independer.nl_ind", 0, "^https?://(www\\.)?independer\\.nl/", 10, [3579], [{ e: 3580 }], [{ v: 3580 }], [{ c: 3580 }], [{ check: "none", timeout: 2e3, wv: 3579 }], {}], [1, "auto_NL_isvw.nl_7x0", 0, "^https?://(www\\.)?isvw\\.nl/", 10, [], [{ e: 3581 }], [{ v: 3581 }], [{ wait: 500 }, { c: 3581 }], [{ timeout: 1e3, check: "none", wv: 3581 }], {}], [1, "auto_NL_kaartje2go.nl_ecw", 0, "^https?://(www\\.)?kaartje2go\\.nl/", 10, [], [{ e: 3582 }], [{ v: 3582 }], [{ wait: 500 }, { c: 3582 }], [{ timeout: 1e3, check: "none", wv: 3582 }], {}], [1, "auto_NL_lakenhal.nl_3go", 0, "^https?://(www\\.)?lakenhal\\.nl/", 10, [], [{ e: 3583 }], [{ v: 3583 }], [{ wait: 500 }, { c: 3583 }], [{ timeout: 1e3, check: "none", wv: 3583 }], {}], [1, "auto_NL_makro.nl_ror", 0, "^https?://(www\\.)?makro\\.nl/", 10, [], [{ e: 3584 }], [{ v: 3584 }], [{ wait: 500 }, { c: 3584 }], [{ timeout: 1e3, check: "none", wv: 3584 }], {}], [1, "auto_NL_matrassencheck.nl_cap", 0, "^https?://(www\\.)?matrassencheck\\.nl/", 10, [], [{ e: 3585 }], [{ v: 3585 }], [{ wait: 500 }, { c: 3585 }], [{ timeout: 1e3, check: "none", wv: 3585 }], {}], [1, "auto_NL_mijn.simyo.nl_xm9", 0, "^https?://(www\\.)?mijn\\.simyo\\.nl/", 10, [], [{ e: 3586 }], [{ v: 3586 }], [{ wait: 500 }, { c: 3586 }], [{ timeout: 1e3, check: "none", wv: 3586 }], {}], [1, "auto_NL_mijngelderland.nl_rkj", 0, "^https?://(www\\.)?mijngelderland\\.nl/", 10, [], [{ e: 3587 }], [{ v: 3587 }], [{ wait: 500 }, { c: 3587 }], [{ timeout: 1e3, check: "none", wv: 3587 }], {}], [1, "auto_NL_nec-nijmegen.nl_04y", 0, "^https?://(www\\.)?nec-nijmegen\\.nl/", 10, [], [{ e: 3588 }], [{ v: 3588 }], [{ wait: 500 }, { c: 3588 }], [{ timeout: 1e3, check: "none", wv: 3588 }], {}], [1, "auto_NL_planteenolijfboom.nl_pdo", 0, "^https?://(www\\.)?planteenolijfboom\\.nl/", 10, [], [{ e: 3589 }], [{ v: 3589 }], [{ wait: 500 }, { c: 3589 }], [{ timeout: 1e3, check: "none", wv: 3589 }], {}], [1, "auto_NL_psv.nl_2pt", 0, "^https?://(www\\.)?psv\\.nl/", 10, [], [{ e: 3590 }], [{ v: 3590 }], [{ wait: 500 }, { c: 3590 }], [{ timeout: 1e3, check: "none", wv: 3590 }], {}], [1, "auto_NL_schaapcitroen.nl_6v0", 0, "^https?://(www\\.)?schaapcitroen\\.nl/", 10, [], [{ e: 3591 }], [{ v: 3591 }], [{ wait: 500 }, { c: 3591 }], [{ timeout: 1e3, check: "none", wv: 3591 }], {}], [1, "auto_NL_scouting.nl_ue4", 0, "^https?://(www\\.)?scouting\\.nl/", 10, [], [{ e: 3592 }], [{ v: 3592 }], [{ wait: 500 }, { c: 3592 }], [{ timeout: 1e3, check: "none", wv: 3592 }], {}], [1, "auto_NL_slachtofferhulp.nl_4m4", 0, "^https?://(www\\.)?slachtofferhulp\\.nl/", 10, [], [{ e: 3593 }], [{ v: 3593 }], [{ wait: 500 }, { c: 3593 }], [{ timeout: 1e3, check: "none", wv: 3593 }], {}], [1, "auto_NL_stadsschouwburg-utrecht.nl_tcz", 0, "^https?://(www\\.)?stadsschouwburg-utrecht\\.nl/", 10, [], [{ e: 3594 }], [{ v: 3594 }], [{ wait: 500 }, { c: 3594 }], [{ timeout: 1e3, check: "none", wv: 3594 }], {}], [1, "auto_NL_stedelijkmuseumschiedam.nl_y6j", 0, "^https?://(www\\.)?stedelijkmuseumschiedam\\.nl/", 10, [], [{ e: 3595 }], [{ v: 3595 }], [{ wait: 500 }, { c: 3595 }], [{ timeout: 1e3, check: "none", wv: 3595 }], {}], [1, "auto_NL_ticketswap.com_d3j", 0, "^https?://(www\\.)?ticketswap\\.com/", 10, [], [{ e: 3596 }], [{ v: 3596 }], [{ wait: 500 }, { c: 3596 }], [{ timeout: 1e3, check: "none", wv: 3596 }], {}], [1, "auto_NL_uit.inapeldoorn.nl_gt5", 0, "^https?://(www\\.)?uit\\.inapeldoorn\\.nl/", 10, [], [{ e: 3597 }], [{ v: 3597 }], [{ wait: 500 }, { c: 3597 }], [{ timeout: 1e3, check: "none", wv: 3597 }], {}], [1, "auto_NL_vlaanderen.be_c8w", 0, "^https?://(www\\.)?vlaanderen\\.be/", 10, [], [{ e: 3598 }], [{ v: 3598 }], [{ wait: 500 }, { c: 3598 }], [{ timeout: 1e3, check: "none", wv: 3598 }], {}], [1, "auto_NL_zuidas.nl_abm", 0, "^https?://(www\\.)?zuidas\\.nl/", 10, [], [{ e: 3599 }], [{ v: 3599 }], [{ wait: 500 }, { c: 3599 }], [{ timeout: 1e3, check: "none", wv: 3599 }], {}], [1, "auto_NO_apxml.com_l6n", 0, "^https?://(www\\.)?apxml\\.com/", 10, [], [{ e: 3600 }], [{ v: 3600 }], [{ wait: 500 }, { c: 3600 }], [{ timeout: 1e3, check: "none", wv: 3600 }], {}], [1, "auto_NO_arbetsformedlingen.se_wxz", 0, "^https?://(www\\.)?arbetsformedlingen\\.se/", 10, [], [{ e: 3601 }], [{ v: 3601 }], [{ wait: 500 }, { c: 3601 }], [{ timeout: 1e3, check: "none", wv: 3601 }], {}], [1, "auto_NO_avanza.se_b5b", 0, "^https?://(www\\.)?avanza\\.se/", 10, [], [{ e: 3602 }], [{ v: 3602 }], [{ wait: 500 }, { c: 3602 }], [{ timeout: 1e3, check: "none", wv: 3602 }], {}], [1, "auto_NO_hotelfinse1222.no_zpm", 0, "^https?://(www\\.)?hotelfinse1222\\.no/", 10, [], [{ e: 3589 }], [{ v: 3589 }], [{ wait: 500 }, { c: 3589 }], [{ timeout: 1e3, check: "none", wv: 3589 }], {}], [1, "auto_NO_jaksta.com_own", 0, "^https?://(www\\.)?jaksta\\.com/", 10, [], [{ e: 3603 }], [{ v: 3603 }], [{ wait: 500 }, { c: 3603 }], [{ timeout: 1e3, check: "none", wv: 3603 }], {}], [1, "auto_NO_ledigajobb.se_tx3", 0, "^https?://(www\\.)?ledigajobb\\.se/", 10, [], [{ e: 3604 }], [{ v: 3604 }], [{ wait: 500 }, { c: 3604 }], [{ timeout: 1e3, check: "none", wv: 3604 }], {}], [1, "auto_NO_swedbank.se_63w", 0, "^https?://(www\\.)?swedbank\\.se/", 10, [], [{ e: 3605 }], [{ v: 3605 }], [{ wait: 500 }, { c: 3605 }], [{ timeout: 1e3, check: "none", wv: 3605 }], {}], [1, "auto_NO_tingstad.com_z23", 0, "^https?://(www\\.)?tingstad\\.com/", 10, [], [{ e: 3606 }], [{ v: 3606 }], [{ wait: 500 }, { c: 3606 }], [{ timeout: 1e3, check: "none", wv: 3606 }], {}], [1, "auto_NO_webank.it_6rx", 0, "^https?://(www\\.)?webank\\.it/", 10, [], [{ e: 3607 }], [{ v: 3607 }], [{ wait: 500 }, { c: 3607 }], [{ timeout: 1e3, check: "none", wv: 3607 }], {}], [1, "auto_US_amazon.jobs_0", 0, "^https?://(www\\.)?amazon\\.jobs/", 10, [], [{ e: 3608 }], [{ v: 3608 }], [{ wait: 500 }, { c: 3608 }], [{ timeout: 1e3, check: "none", wv: 3608 }], {}], [1, "auto_US_emagine-entertainment.com_0", 0, "^https?://(www\\.)?emagine-entertainment\\.com/", 10, [], [{ e: 3609 }], [{ v: 3609 }], [{ wait: 500 }, { c: 3609 }], [{ timeout: 1e3, check: "none", wv: 3609 }], {}], [1, "auto_US_forum.prusa3d.com_0", 0, "^https?://(www\\.)?forum\\.prusa3d\\.com/", 10, [], [{ e: 3610 }], [{ v: 3610 }], [{ text: "Reject All", c: 3610 }], [], {}], [1, "auto_US_musicnotes.com_0", 0, "^https?://(www\\.)?musicnotes\\.com/", 10, [], [{ exists: ["#polaris-css-lockdown-container", ".polaris-consent-widget"] }], [{ visible: ["#polaris-css-lockdown-container", ".polaris-consent-widget"] }], [{ if: { exists: ["#polaris-css-lockdown-container", "[data-testid='oneClickOptOutLink']"] }, then: [{ waitForThenClick: ["#polaris-css-lockdown-container", "[data-testid='oneClickOptOutLink']"] }], else: [{ hide: ["#polaris-css-lockdown-container", ".polaris-consent-widget"] }] }], [], {}], [1, "auto_US_semrush.com_0", 0, "^https?://(www\\.)?semrush\\.com/", 10, [], [{ e: 3611 }], [{ v: 3611 }], [{ wait: 500 }, { c: 3611 }], [{ timeout: 1e3, check: "none", wv: 3611 }], {}], [1, "autohero", 2, "^https?://(www\\.)?autohero\\.com/", 22, [], [{ e: 3612 }], [{ v: 3612 }], [{ c: 3612 }, { wv: 3613 }, { if: { e: 3614 }, then: [{ all: true, k: 3614 }] }, { c: 3612 }], [{ cc: 3615 }], {}], [1, "autokostencheck.de", 0, "^https?://(www\\.)?autokostencheck\\.de/", 10, [3616, 3617], [{ e: 3618 }], [{ any: [{ check: "any", v: 3619 }, { visible: ["#cmpwrapper", "#cmpbox .cmpmore"], check: "any" }] }], [{ waitForVisible: ["#cmpwrapper", "#cmpbox .cmpmore"], timeout: 2e3, check: "any", optional: true }, { if: { visible: ["#cmpwrapper", "#cmpbox .cmpmore"], check: "any" }, then: [{ eval: "EVAL_CONSENTMANAGER_3" }] }, { timeout: 2e3, check: "any", optional: true, wv: 3619 }, { if: { check: "any", v: 3619 }, then: [{ k: 3619 }, { c: 3620 }] }], [{ eval: "EVAL_CONSENTMANAGER_5" }, { eval: "EVAL_COOKIEFIRST_0" }], {}], [1, "autotrader-za", 2, "^https?://(\\w+\\.)?autotrader\\.co\\.za/", 22, [2211], [{ e: 3621 }], [{ v: 3621 }], [{ c: 3622 }, { wv: 3623 }, { if: { e: 3624 }, then: [{ all: true, k: 3624 }] }, { retry: 2, retryInterval: 1500, c: 3623 }], [{ cc: 3625 }], {}], [1, "aviasales", 2, "^https?://(www\\.)?aviasales\\.[a-z]+/", 22, [3626], [{ e: 3627 }], [{ v: 3628 }], [{ c: 3627 }, { timeout: 3e3, w: 3629 }, { all: true, optional: true, k: 3630 }, { c: 3631 }], [{ cc: 707 }], {}], [1, "aviasales-cosmetic", 1, "^https?://(www\\.)?aviasales\\.[a-z]+/", 22, [3626], [{ e: 3628 }, { negated: true, e: 3627 }], [{ v: 3628 }], [{ h: 3626 }], [{ check: "none", v: 3628 }], {}], [1, "axesor", 2, "^https?://([\\w-]+\\.)?axesor\\.es/", 22, [3632], [{ e: 3633 }], [{ v: 3633 }], [{ c: 3633 }], [{ cc: 3634 }], {}], [1, "aytm", 2, "^https?://(www\\.|)?aytm\\.com/", 22, [658], [{ e: 3635 }], [{ v: 3635 }], [{ c: 3635 }], [], {}], [1, "b1ng-cc", 2, "^https?://(www\\.)?(giorni-festivi\\.it|feiertag\\.co|dia-festivo\\.es)/", 22, [3636], [{ e: 3637 }], [{ v: 3637 }], [{ c: 3637 }, { timeout: 5e3, optional: true, w: 3638 }, { if: { e: 3638 }, then: [{ optional: true, k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ cc: 3639 }], {}], [1, "babylist", 2, "^https?://(www\\.)?babylist\\.com/", 22, [3640, 3368], [{ e: 3640 }], [{ v: 3641 }], [{ c: 3641 }, { timeout: 2e3, optional: true, c: 3642 }], [], {}], [1, "babylonbee", 2, "^https?://(www\\.)?(babylonbee|notthebee)\\.com/", 22, [], [{ e: 3643 }], [{ v: 3643 }], [{ retry: 3, c: 3643 }], [{ check: "none", v: 3643 }], {}], [1, "bahn-de", 0, "^https://([\\w-]+\\.)?bahn\\.de/", 10, [], [{ exists: ["body > div:first-child", "#consent-layer"] }], [{ visible: ["body > div:first-child", "#consent-layer"] }], [{ waitForThenClick: ["body > div:first-child", "#consent-layer .js-accept-essential-cookies"] }], [{ eval: "EVAL_BAHN_TEST" }], { intermediate: false }], [1, "bakeca", 2, "^https?://([\\w-]+\\.)?bakecaincontrii\\.com/", 22, [], [{ e: 3644 }], [{ v: 3645 }], [{ c: 3646 }], [{ check: "none", timeout: 2e3, wv: 3645 }], {}], [1, "banamex", 2, "^https?://(www\\.)?banamex\\.com/", 22, [3647], [{ e: 3648 }], [{ e: 3648 }, { negated: true, cc: 3649 }], [{ waitForThenClick: ["cmp-cookie-bar", "button.cmp-cookie-bar-close"] }], [{ cc: 3650 }], {}], [1, "bandcamp.com", 2, "^https://([a-z0-9-]+\\.)?bandcamp\\.com", 22, [], [{ e: 3651 }], [{ any: [{ v: 3652 }, { visible: ["menu-bar", ".cookie-dialog-initial"] }, { visible: ["page-footer", ".cookie-dialog-initial"] }] }], [{ any: [{ timeout: 500, c: 3653 }, { waitForThenClick: ["menu-bar", ".cookie-dialog-initial button.g-button.outline"], timeout: 500 }, { waitForThenClick: ["page-footer", ".cookie-dialog-initial button.g-button.outline"], timeout: 500 }] }], [{ wait: 500 }, { cc: 3654 }], {}], [1, "bankmillennium.pl", 2, "^https?://(www\\.)?bankmillennium\\.pl/", 22, [3655], [{ e: 3655 }], [{ v: 3655 }], [{ waitForThenClick: ["#cookie_modal_placeholder dialog.bm-modal--cookie", "xpath///button[contains(normalize-space(.), 'Odrzu')]"] }], [{ cc: 3656 }, { cc: 3657 }], {}], [1, "banknorwegian", 2, "^https?://(www\\.)?banknorwegian\\.(no|se|dk|fi|de|es)/", 22, [3658], [{ e: 3659 }], [{ v: 3660 }], [{ c: 3660 }, { wv: 3661 }, { all: true, optional: true, k: 3662 }, { k: 3661 }, { check: "none", timeout: 3e3, optional: true, wv: 3661 }], [{ check: "none", v: 3663 }], {}], [1, "batteriexperten.com", 2, "^https?://(\\w+\\.)?(batteriexperten\\.com|teknikdelar\\.se|teknikkdeler\\.no|teknikdele\\.dk|tekniikkaosat\\.fi)/", 22, [3664], [{ e: 3665 }], [{ v: 3665 }], [{ if: { e: 3666 }, then: [{ c: 3667 }], else: [{ c: 3668 }, { wv: 3669 }, { all: true, optional: true, k: 3670 }, { c: 3671 }] }, { check: "none", wv: 3665 }], [{ cc: 3672 }], {}], [1, "bayern-matomo", 2, "^https?://([\\w-]+\\.)*bayern\\.de/", 22, [], [{ e: 3673 }], [{ v: 3673 }], [{ c: 3673 }], [{ timeout: 2e3, check: "none", wv: 3674 }], {}], [1, "bbc.com", 2, "^https://(www\\.)?bbc\\.(com|co\\.uk)/", 22, [3675, 3676], [{ any: [{ e: 3677 }, { e: 3678 }] }], [{ any: [{ v: 3677 }, { v: 3678 }] }], [{ if: { e: 3678 }, then: [{ c: 3678 }], else: [{ c: 3679 }] }], [{ wait: 500 }, { cc: 3680 }], {}], [1, "bbc.com-orb-cosmetic", 1, "^https://(www\\.)?bbc\\.(com|co\\.uk)/", 22, [3681], [{ e: 3682 }], [{ v: 3682 }], [{ h: 3681 }], [{ check: "none", v: 3683 }], {}], [1, "bcferries.com", 2, "^https?://(\\w+\\.)?bcferries\\.com/", 22, [3684], [{ e: 3685 }], [{ v: 3684 }], [{ c: 3686 }, { c: 3687 }, { c: 3688 }], [], {}], [1, "berelax.com", 2, "^https://(www\\.)?berelax\\.com/", 22, [3689], [{ e: 3690 }], [{ v: 3691 }], [{ c: 3692 }, { check: "none", timeout: 2e3, wv: 3691 }], [], {}], [1, "bestsecret", 2, "^https?://(www\\.)?bestsecret\\.com/", 10, [], [{ e: 3693 }], [{ v: 3693 }], [{ c: 3693 }], [{ timeout: 2e3, check: "none", wv: 3693 }], {}], [1, "bet365", 2, "^https?://(www\\.)?bet365\\.[a-z.]+/", 22, [3694], [{ e: 3695 }], [{ v: 3695 }], [{ c: 3695 }], [{ timeout: 1e3, check: "none", wv: 3696 }], {}], [1, "betlive", 2, "^https?://(\\w+\\.)?betlive\\.com/", 22, [3697], [{ e: 3697 }], [{ v: 3697 }], [{ c: 3698 }], [{ check: "none", timeout: 1e3, wv: 3697 }], {}], [1, "betsson-fr", 2, "^https?://(\\w+\\.)?betsson\\.fr/", 22, [3699], [{ e: 3700 }], [{ v: 3700 }], [{ c: 3701 }, { wv: 3702 }, { all: true, optional: true, k: 3703 }, { c: 3704 }, { check: "none", wv: 2586 }], [], {}], [1, "betway-africa", 2, "^https?://(www\\.)?betway\\.(co\\.|com\\.)?[a-z]{2}/", 22, [3705], [{ e: 3706 }], [{ v: 3706 }], [{ c: 3706 }], [{ cc: 3707 }], {}], [1, "bgk.pl", 2, "^https?://(www\\.)?bgk\\.pl/", 22, [3708], [{ e: 3709 }], [{ v: 3710 }], [{ retry: 3, c: 3711 }, { wv: 3709 }, { all: true, optional: true, k: 3712 }, { c: 3713 }], [{ cc: 3714 }], {}], [1, "biblia-online.pl", 1, "^https?://(\\w+\\.)?biblia-online\\.pl/", 10, [3715], [{ e: 3716 }], [{ v: 3715 }], [{ h: 3715 }], [{ check: "none", v: 3715 }], {}], [1, "bibliotheek-nl", 0, "^https?://(?:www\\.)?(?:onlinebibliotheek|bibliotheek)\\.nl/", 10, [3717], [{ e: 3718 }], [{ v: 3717 }], [{ c: 3719 }], [], {}], [1, "bing.com-notice", 2, "^https?://(\\w+\\.)?bing\\.com/", 22, [3720], [{ e: 3721 }], [{ v: 3720 }], [{ wv: 3722 }, { eval: "EVAL_BING_NOTICE_CLOSE" }], [{ check: "none", v: 3720 }], {}], [2, "bing.com-notice-cosmetic", 1, "^https?://(\\w+\\.)?bing\\.com/", 22, [3723], [{ e: 3723 }], [{ v: 3723 }], [{ h: 3723 }, { addStyle: "top: 0 !important", selector: "header#hdr", optional: true }], [{ check: "none", v: 3723 }], {}], [1, "bitauto", 2, "^https?://(\\w+\\.)?bitauto\\.com/", 22, [3724], [{ e: 3725 }], [{ v: 3725 }], [{ c: 3725 }, { timeout: 4e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ cc: 3726 }], {}], [1, "bladehq", 2, "^https?://(www\\.)?bladehq\\.com/", 22, [3727], [{ e: 3728 }], [{ v: 3727 }], [{ retry: 5, retryInterval: 500, c: 3729 }, { check: "none", wv: 3727 }], [{ check: "none", v: 3727 }], {}], [1, "blastingnews", 2, "^https?://(\\w+\\.)?blastingnews\\.com/", 22, [3730], [{ e: 3731 }], [{ v: 3731 }], [{ c: 3732 }], [{ wait: 500 }, { cc: 3733 }], {}], [1, "blitzrechner", 2, "^https?://(www\\.)?blitzrechner\\.de/", 22, [3734], [{ e: 3734 }], [{ v: 3735 }], [{ all: true, optional: true, k: 3736 }, { c: 3737 }], [{ cc: 3738 }], {}], [1, "bn-org-pl", 2, "^https?://([a-z0-9-]+\\.)?bn\\.org\\.pl/", 22, [2210], [{ e: 3739 }], [{ v: 3740 }], [{ c: 3739 }, { check: "none", timeout: 2e3, wv: 3740 }], [{ cc: 3741 }], {}], [1, "bo3.gg", 2, "^https?://([a-z0-9-]+\\.)?bo3\\.gg/", 22, [3742], [{ e: 3742 }], [{ v: 3743 }], [{ c: 3744 }, { wv: 3745 }, { all: true, optional: true, k: 3746 }, { c: 3747 }], [{ cc: 3748 }], {}], [1, "bokadirekt.se", 2, "^https?://(\\w+\\.)?bokadirekt\\.se/", 22, [], [{ e: 3749 }], [{ v: 3749 }], [{ c: 3750 }, { wv: 3751 }, { if: { e: 3752 }, then: [{ all: true, k: 3752 }] }, { k: 3751 }], [{ cc: 3753 }], {}], [1, "bokio", 2, "^https?://(www\\.)?bokio\\.(se|co\\.uk)/", 22, [1206], [{ e: 3754 }], [{ v: 3755 }], [{ c: 3754 }], [{ cc: 3756 }], {}], [1, "bom-gov-au", 2, "^https?://(\\w+\\.)?bom\\.gov\\.au/", 22, [], [{ e: 3757 }], [{ v: 3758 }], [{ c: 3757 }], [{ check: "none", timeout: 2e3, wv: 3758 }], {}], [1, "brainshare", 2, "^https?://([\\w-]+\\.)?brainshare\\.pl/", 22, [3759], [{ e: 3760 }], [{ v: 3759 }], [{ c: 3760 }], [{ cc: 3761 }], {}], [1, "brandfetch", 2, "^https?://(\\w+\\.)?brandfetch\\.com/", 22, [], [{ e: 3762 }], [{ v: 3762 }], [{ c: 3763 }, { c: 3764 }], [{ cc: 3765 }], {}], [1, "brandsforstudents.ch", 2, "^https?://(www\\.)?brandsfor(students|employees)\\.ch/", 22, [3766], [{ e: 3767 }], [{ v: 3766 }], [{ c: 3767 }, { w: 3768 }, { all: true, optional: true, k: 3769 }, { c: 3770 }], [{ cc: 3771 }], {}], [1, "bravissimo", 2, "^https?://(www\\.)?bravissimo\\.com/", 22, [3772], [{ e: 3772 }], [{ v: 3772 }], [{ c: 3773 }, { wv: 3774 }, { all: true, optional: true, k: 3775 }, { k: 3776 }], [{ wait: 1e3 }, { cc: 3777 }], {}], [1, "breuninger", 2, "^https://(www\\.)?breuninger\\.com/", 22, [3778], [{ e: 3779 }], [{ v: 3780 }], [{ c: 3779 }], [{ cc: 3781 }], {}], [1, "bricklink", 2, "^https?://([a-z0-9-]+\\.)?bricklink\\.com/", 22, [3782], [{ e: 3782 }], [{ v: 3782 }], [{ c: 3783 }], [{ cc: 3784 }], {}], [1, "bringatrailer", 2, "^https?://(www\\.)?bringatrailer\\.com/", 22, [], [{ e: 3785 }, { cc: 3786 }], [{ v: 3787 }], [{ c: 3785 }], [{ cc: 3788 }], {}], [1, "bswhealth", 0, "^https?://(\\w+\\.)?bswhealth\\.com/", 22, [3789], [{ e: 3790 }], [{ v: 3790 }], [{ c: 3790 }, { wv: 3791 }, { all: true, optional: true, c: 3792 }, { c: 3793 }], [{ cc: 3794 }], {}], [1, "bt-com-au", 2, "^https?://(www\\.)?bt\\.com\\.au/", 22, [3795], [{ e: 3795 }], [{ v: 3796 }], [{ c: 3797 }], [{ check: "none", timeout: 1e3, wv: 3795 }], {}], [1, "buonmedico", 2, "^https?://(www\\.)?buonmedico\\.it/", 22, [3798], [{ e: 3799 }], [{ v: 3799 }], [{ c: 3799 }], [{ cc: 3800 }], {}], [1, "calclife.net", 2, "^https?://(www\\.)?calclife\\.net/", 22, [3801], [{ e: 3802 }], [{ v: 3802 }], [{ c: 3802 }, { wv: 3803 }, { if: { e: 3804 }, then: [{ k: 3805 }] }, { k: 3806 }], [], {}], [1, "calcolo.tools", 2, "^https?://(www\\.)?calcolo\\.tools/", 22, [3807], [{ v: 3808 }], [{ v: 3808 }], [{ c: 3808 }, { timeout: 5e3, optional: true, w: 3638 }, { if: { e: 3638 }, then: [{ optional: true, k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ check: "none", v: 3807 }], {}], [1, "canva", 2, "^https?://(www\\.)?canva\\.com/", 22, [3809], [{ e: 3809 }], [{ v: 3809 }], [{ c: 3810 }, { c: 3811 }, { c: 3812 }], [{ wait: 1e3 }, { cc: 3813 }], {}], [1, "canyon.com", 2, "^https://www\\.canyon\\.com/", 22, [3814], [{ e: 3814 }], [{ v: 3814 }], [{ k: 3815 }, { c: 3816 }], [], {}], [1, "capitalone-ca", 2, "^https://(www\\.)?capitalone\\.ca/", 22, [], [{ e: 3817 }], [{ v: 3817 }], [{ c: 3817 }], [{ cc: 3818 }], {}], [2, "cardiff-university", 1, "^https?://(\\w+\\.)?cardiff\\.ac\\.uk/", 22, [3819], [{ e: 3820 }], [{ v: 3819 }], [{ h: 3819 }, { removeClass: "with-cookie-banner", selector: "body", optional: true }], [], {}], [1, "carpetaciudadana", 2, "^https?://(\\w+\\.)?carpetaciudadana\\.gob\\.es/", 22, [3821], [{ e: 3822 }], [{ v: 3823 }], [{ c: 3822 }, { wv: 3824 }, { if: { e: 3825 }, then: [{ k: 3824 }] }, { retry: 2, retryInterval: 600, c: 3826 }], [{ cc: 3827 }], {}], [1, "carre.nl", 2, "^https?://(www\\.)?carre\\.nl/", 10, [3828], [{ e: 3829 }], [{ v: 3828 }], [{ c: 3829 }], [], {}], [1, "casier-judiciaire-justice-gouv-fr", 2, "^https?://casier-judiciaire\\.justice\\.gouv\\.fr/", 22, [3830], [{ e: 3831 }], [{ v: 3830 }], [{ c: 3832 }, { check: "none", timeout: 2e3, optional: true, wv: 3830 }], [{ check: "none", v: 3830 }], {}], [1, "ccm-net", 1, "^https?://([\\w-]+\\.)?ccm\\.net/", 22, [144, 3833], [{ any: [{ e: 145 }, { e: 3833 }] }], [{ any: [{ v: 144 }, { v: 3833 }] }], [{ h: 3833 }, { if: { v: 144 }, then: [{ waitForThenClick: ["iframe[srcdoc*='frame-root']", ".button__skip"] }] }], [], {}], [1, "cdu-edu-au", 1, "^https?://(\\w+\\.)?cdu\\.edu\\.au/", 22, [3834], [{ e: 3835 }], [{ v: 3834 }], [{ h: 3834 }], [], {}], [1, "chairish", 2, "^https?://(www\\.)?chairish\\.com/", 22, [3836], [{ e: 3837 }], [{ v: 3838 }], [{ c: 3837 }, { wv: 3839 }, { all: true, optional: true, k: 3840 }, { c: 3841 }], [{ cc: 3842 }], {}], [1, "championat", 2, "^https?://(\\w+\\.)?championat\\.com/", 22, [3843], [{ e: 3844 }], [{ v: 3845 }], [{ c: 3844 }], [{ check: "none", v: 3845 }], {}], [1, "channel4.com", 2, "^https?://(www\\.)?channel4\\.com/", 10, [368, 3433], [{ e: 3846 }], [{ v: 3846 }], [{ c: 3847 }], [{ cc: 3848 }], {}], [1, "charliehebdo", 2, "^https?://(www\\.)?charliehebdo\\.fr/", 10, [], [{ e: 3849 }], [{ v: 3850 }], [{ c: 3849 }, { any: [{ timeout: 2e3, wv: 3851 }, { k: 3849 }] }, { wv: 3851 }, { k: 3851 }], [{ timeout: 2e3, check: "none", wv: 3852 }], {}], [1, "chatgpt", 0, "^https?://(\\w+\\.)?chatgpt\\.com/", 10, [3853], [{ e: 3854 }], [{ v: 3855 }], [{ c: 3854 }], [{ timeout: 1e3, check: "none", wv: 3856 }], {}], [1, "chemicalbook", 1, "^https?://(\\w+\\.)?chemicalbook\\.com/", 22, [3857], [{ e: 3858 }], [{ v: 3857 }], [{ h: 3857 }], [], {}], [1, "chesskid", 2, "^https?://(\\w+\\.)?chesskid\\.com/", 22, [3433], [{ e: 3859 }], [{ v: 3859 }], [{ c: 3860 }, { wv: 3861 }, { all: true, optional: true, k: 3862 }, { k: 3861 }], [{ cc: 3863 }], {}], [1, "chimnie-co-uk", 2, "^https?://(\\w+\\.)?chimnie\\.co\\.uk/", 22, [3864], [{ e: 3864 }], [{ v: 3864 }], [{ c: 3865 }, { c: 3866 }], [{ check: "none", timeout: 2e3, wv: 3864 }], {}], [1, "chomikuj", 2, "^https?://(\\w+\\.)?chomikuj\\.pl/", 22, [], [{ e: 3867 }], [{ v: 3867 }], [{ c: 3867 }], [{ check: "none", timeout: 2e3, wv: 3868 }], {}], [1, "chrono24", 2, "^https?://(\\w+\\.)?chrono24\\.[a-z.]+/", 22, [], [{ e: 3869 }], [{ v: 3869 }], [{ if: { e: 3870 }, then: [{ retry: 5, retryInterval: 500, c: 3870 }], else: [{ retry: 5, retryInterval: 500, c: 3871 }, { timeout: 5e3, c: 3872 }] }], [{ timeout: 2e3, check: "none", wv: 3869 }], {}], [1, "citizensadvice", 2, "^https?://(\\w+\\.)?citizensadvice\\.org\\.uk/", 22, [3873], [{ e: 3874 }], [{ v: 3874 }], [{ c: 3874 }, { timeout: 2e3, optional: true, c: 3875 }], [{ cc: 1038 }], {}], [1, "civilservicejobs-service-gov-uk", 2, "^https?://(\\w+\\.)?civilservicejobs\\.service\\.gov\\.uk/", 22, [3876], [{ e: 3877 }], [{ v: 3877 }], [{ c: 3877 }, { check: "none", timeout: 2e3, optional: true, wv: 3876 }], [{ cc: 3878 }], {}], [1, "clasohlson.com", 2, "^https?://(www\\.)?clasohlson\\.com/", 22, [3879], [{ e: 3880 }], [{ v: 3881 }], [{ retry: 10, retryInterval: 500, c: 3882 }, { check: "none", wv: 3881 }], [{ cc: 3883 }], {}], [1, "classbento", 0, "^https?://(www\\.)?classbento\\.co\\.uk/", 10, [3884], [{ v: 3885 }], [{ v: 3884 }], [{ c: 3885 }], [{ check: "none", timeout: 2e3, wv: 3884 }], {}], [1, "classification.gov.au", 2, "^https?://(www\\.)?classification\\.gov\\.au/", 22, [], [{ e: 3886 }], [{ v: 3886 }], [{ c: 3887 }], [{ cc: 3888 }], {}], [1, "clicks.co.za", 2, "^https?://(\\w+\\.)?clicks\\.co\\.za/", 22, [3889], [{ e: 3890 }], [{ v: 3890 }], [{ c: 3890 }, { wv: 3891 }, { if: { e: 3892 }, then: [{ k: 3893 }] }, { c: 3891 }], [{ cc: 3894 }], {}], [1, "cnmc.gob.es", 2, "^https?://(\\w+\\.)?cnmc\\.gob\\.es/", 22, [3895], [{ e: 3895 }], [{ v: 3896 }, { e: 3897 }], [{ c: 3898 }, { timeout: 2e3, check: "none", wv: 3896 }], [], {}], [1, "collectingcars", 2, "^https?://(\\w+\\.)?collecting(cars)?\\.com/", 22, [52], [{ e: 3899 }], [{ v: 3899 }], [{ c: 3899 }, { wv: 3900 }, { all: true, optional: true, k: 3901 }, { c: 3900 }], [{ cc: 3902 }], {}], [1, "commonlit", 2, "^https?://(\\w+\\.)?commonlit\\.org/", 22, [3903], [{ e: 3904 }], [{ v: 3905 }], [{ c: 3904 }, { wv: 3906 }, { all: true, optional: true, k: 3907 }, { c: 3908 }], [{ cc: 3909 }, { cc: 3910 }], {}], [3, "community.screwfix.com", 2, "^https?://community\\.screwfix\\.com/", 10, [3911], [{ e: 3912 }], [{ v: 3912 }], [{ c: 3913 }, { stylesheet: "#consent-banner::before { display: none !important; }", stylesheetId: "screwfix-backdrop" }], [{ cc: 3914 }], {}], [1, "comparandonos", 2, "^https?://(www\\.)?comparandonos\\.com/", 10, [52], [{ e: 3915 }], [{ v: 52 }], [{ c: 3915 }, { wv: 3916 }, { if: { e: 3917 }, then: [{ k: 3918 }] }, { if: { e: 3919 }, then: [{ k: 3920 }] }, { k: 3916 }], [{ timeout: 1e3, check: "none", wv: 3921 }, { check: "none", v: 52 }], {}], [1, "concordia-ch", 2, "^https://(\\w+\\.)?concordia\\.(ch|li)/", 22, [3922], [{ e: 3922 }], [{ v: 3923 }], [{ c: 3924 }], [{ cc: 3925 }], {}], [1, "conjointly", 2, "^https://(www\\.)?conjointly\\.com/", 22, [3926], [{ e: 3927 }], [{ v: 3927 }], [{ if: { e: 3928 }, then: [{ k: 3929 }] }, { c: 3930 }], [{ cc: 3931 }], {}], [1, "consilium-europa-eu", 2, "^https://(www\\.)?consilium\\.europa\\.eu/", 22, [], [{ e: 3932 }], [{ visible: ["gsc-cookie-banner", "dialog[data-consent-banner]"] }], [{ waitForThenClick: ["gsc-cookie-banner", ".gsc-cookie-banner__actions gsc-button:first-child"] }], [{ waitForVisible: ["gsc-cookie-banner", "dialog[data-consent-banner]"], check: "none", timeout: 2e3 }], {}], [1, "controlgame", 2, "^https?://(www\\.)?controlgame\\.com/", 22, [], [{ e: 3933 }], [{ v: 3933 }], [{ retry: 10, retryInterval: 500, c: 3933 }], [{ cc: 1026 }], {}], [1, "copaair", 2, "^https?://(www\\.)?copaair\\.com/", 22, [3934], [{ e: 3934 }], [{ v: 3934 }], [{ c: 3935 }], [{ cc: 3936 }], {}], [1, "copaamerica", 1, "^https://(www\\.)?copaamerica\\.com/", 22, [3937], [{ e: 3937 }], [{ v: 3937 }], [{ h: 3937 }], [], {}], [1, "costco", 1, "^https?://([\\w-]+\\.)*costco(businesscentre|businessdelivery)?\\.(ca|com)/", 22, [3938], [{ e: 3939 }], [{ v: 3938 }], [{ h: 3940 }], [], {}], [1, "creditunionsa", 1, "^https?://(www\\.)?creditunionsa\\.com\\.au/", 22, [3941], [{ e: 3942 }], [{ v: 3941 }], [{ h: 3941 }], [], {}], [1, "crocobet", 1, "^https?://(\\w+\\.)?crocobet\\.com/", 22, [3943, 3944], [{ e: 3945 }], [{ v: 3945 }], [{ h: 3946 }], [{ check: "none", v: 3945 }], {}], [1, "crosswater.co.uk", 2, "^https?://(www\\.)?crosswater\\.co\\.uk/", 22, [3947], [{ e: 3948 }], [{ v: 3948 }], [{ c: 3948 }, { c: 3949 }], [{ cc: 3950 }, { cc: 3951 }, { cc: 3952 }], {}], [1, "crtm", 2, "^https?://(\\w+\\.)?crtm\\.es/", 22, [52, 3953], [{ e: 3954 }], [{ v: 52 }], [{ c: 3954 }, { c: 3955 }], [{ cc: 3956 }], {}], [1, "cstudios", 1, "^https?://(\\w+\\.)?cstudios\\.pl/", 22, [3957], [{ e: 3958 }], [{ v: 3958 }], [{ h: 3957 }], [{ check: "none", v: 3957 }], {}], [1, "csu-landtag-de", 2, "^https://(www\\.|)?csu-landtag\\.de", 22, [3959], [{ e: 3959 }], [{ v: 3959 }], [{ k: 3960 }], [], {}], [1, "ctv-disneyonice", 2, "^https://www\\.ctv\\.co\\.jp/disneyonice(?:/|[?#]|$)", 22, [3961], [{ e: 3962 }], [{ v: 3962 }], [{ c: 3963 }], [{ cc: 3964 }], {}], [1, "cuvva.com", 0, "^https://(www\\.)?cuvva\\.com/", 22, [], [{ e: 3965 }], [{ v: 3965 }, { negated: true, cc: 3966 }], [{ retry: 10, retryInterval: 500, c: 3967 }, { wait: 500 }, { if: { v: 3967 }, then: [{ retry: 10, retryInterval: 500, c: 3967 }] }], [{ cc: 3968 }], {}], [1, "dalecarnegie", 2, "^https?://(\\w+\\.)?dalecarnegie\\.com/", 22, [], [{ e: 3969 }], [{ v: 3970 }], [{ c: 3969 }, { wv: 3971 }, { all: true, optional: true, k: 3972 }, { k: 3971 }], [{ cc: 3973 }], {}], [1, "darkounity.com", 2, "^https://(www\\.)?darkounity\\.com/", 22, [3974], [{ exists: ["gdpr-consent-popup", "[data-action='necessary-only']"] }], [{ visible: ["gdpr-consent-popup", ".banner"] }], [{ waitForThenClick: ["gdpr-consent-popup", "[data-action='necessary-only']"] }], [{ waitForVisible: ["gdpr-consent-popup", ".banner"], timeout: 2e3, check: "none" }], {}], [1, "datezone", 2, "^https?://(\\w+\\.)?datezone\\.com/", 22, [3975], [{ e: 3976 }], [{ v: 3975 }], [{ c: 3977 }, { w: 3978 }, { all: true, optional: true, k: 3979 }, { c: 3980 }, { check: "none", timeout: 3e3, wv: 3975 }], [{ cc: 3981 }], {}], [1, "dedeman.ro", 2, "^https?://(www\\.)?dedeman\\.ro/", 22, [438], [{ e: 3982 }], [{ v: 438 }], [{ c: 3982 }], [{ cc: 3983 }], {}], [1, "deliveroo", 2, "^https?://(\\w+\\.)?deliveroo\\.(co\\.uk|\\w+)/", 22, [3984], [{ e: 3984 }], [{ v: 3984 }], [{ c: 3985 }, { check: "none", wv: 3984 }], [{ cc: 2906 }], {}], [2, "depop", 1, "^https://(www\\.)?depop\\.com/", 22, [2864, 3986], [{ e: 2864 }], [{ visible: ["#transcend-consent-manager", "#consentManagerMainDialog"] }], [{ h: 2864 }, { h: 3986 }, { timeout: 3e3, optional: true, w: 3986 }, { addStyle: "overflow: auto !important", selector: "body", optional: true }], [], {}], [1, "depositphotos.com", 2, "^https?://(\\w+\\.)?depositphotos\\.com/", 22, [3987], [{ e: 3987 }], [{ v: 3987 }], [{ c: 3988 }, { c: 3989 }], [], {}], [1, "detector-aero", 2, "^https?://(\\w+\\.)?detector-aero\\.ru/", 22, [3990], [{ e: 3990 }], [{ v: 3990 }], [{ timeout: 3e3, optional: true, wv: 3991 }, { if: { e: 3991 }, then: [{ c: 3991 }], else: [{ c: 3992 }] }, { check: "none", timeout: 2e3, wv: 3990 }], [{ check: "none", v: 3990 }], {}], [1, "dhbbank", 2, "^https?://(www\\.)?dhbbank\\.(com|nl|be|de)/", 22, [3993], [{ e: 3994 }], [{ v: 3994 }], [{ c: 3994 }], [{ check: "none", timeout: 3e3, wv: 3993 }, { cc: 3995 }], {}], [1, "diag.pl", 2, "^https?://(\\w+\\.)?diag\\.pl/", 22, [], [{ e: 3996 }], [{ v: 3996 }], [{ c: 3996 }], [{ check: "none", timeout: 3e3, wv: 3996 }], {}], [1, "dijklander", 2, "^https?://(www\\.)?dijklander\\.nl/", 22, [3997], [{ e: 3998 }], [{ v: 3997 }], [{ c: 3998 }], [{ check: "none", timeout: 2e3, wv: 3997 }], {}], [1, "disturbia", 2, "^https?://(\\w+\\.)?disturbia\\.co\\.uk/", 22, [52], [{ e: 3999 }], [{ v: 4e3 }], [{ c: 4001 }, { c: 4002 }], [{ timeout: 2e3, check: "none", wv: 4e3 }], {}], [1, "dji", 0, "^https://(\\w+\\.)+dji\\.com/", 22, [4003], [{ e: 4004 }], [{ e: 4003 }], [{ c: 4005 }], [{ cc: 4006 }], {}], [1, "doc-du-juriste", 2, "^https?://(www\\.)?doc-du-juriste\\.com/", 22, [4007], [{ e: 4008 }], [{ v: 4008 }], [{ c: 4008 }, { c: 4009 }, { c: 4010 }, { check: "none", optional: true, wv: 1206 }], [{ cc: 4011 }], {}], [1, "doc24-ch", 2, "^https?://(www\\.)?doc24\\.ch/", 22, [], [{ e: 4012 }], [{ v: 4012 }], [{ c: 4012 }], [{ cc: 4013 }], {}], [1, "doktorabc", 2, "^https?://(\\w+\\.)?doktorabc\\.com/", 22, [4014], [{ e: 4015 }], [{ v: 4015 }], [{ c: 4016 }, { wv: 4017 }, { all: true, optional: true, k: 4018 }, { c: 4019 }], [{ cc: 4020 }], {}], [1, "dola", 2, "^https?://(www\\.)?dola\\.com/", 22, [4021], [{ e: 4022 }], [{ v: 4022 }], [{ c: 4023 }], [{ timeout: 1e3, check: "none", wv: 4021 }], {}], [1, "dolphinfitness", 2, "^https?://(www\\.)?dolphinfitness\\.co\\.uk/", 22, [4024], [{ e: 4025 }], [{ v: 4025 }], [{ c: 4026 }, { wv: 4027 }, { k: 4028 }, { k: 4029 }, { k: 4027 }, { c: 4030 }], [{ e: 4031 }, { e: 4032 }, { e: 4033 }], {}], [1, "doz-pl", 2, "^https?://(www\\.)?doz\\.pl/", 10, [4034], [{ e: 4034 }], [{ v: 4034 }], [{ c: 4035 }, { wv: 4036 }, { all: true, optional: true, k: 4037 }, { c: 4038 }], [{ cc: 317 }, { cc: 4039 }], {}], [1, "dtu-findit", 2, "^https?://findit\\.dtu\\.dk/", 22, [], [{ e: 4040 }], [{ v: 4040 }], [{ if: { e: 4041 }, then: [{ k: 4041 }] }, { c: 4042 }], [{ cc: 4043 }, { negated: true, cc: 4044 }], {}], [1, "duunitori.fi", 2, "^https?://(\\w+\\.)?duunitori\\.fi/", 22, [], [{ e: 4045 }], [{ v: 4046 }], [{ c: 4047 }, { wv: 4045 }, { all: true, optional: true, k: 4048 }, { k: 4045 }], [{ cc: 4049 }], {}], [1, "dwaalzin.nu", 2, "^https?://(www\\.)?dwaalzin\\.nu/", 22, [639], [{ e: 4050 }], [{ v: 4050 }], [{ c: 4050 }], [{ cc: 1852 }], {}], [1, "eastlink", 2, "^https?://(www\\.)?eastlink\\.ca/", 22, [], [{ e: 4051 }], [{ e: 4052 }, { negated: true, cc: 4053 }], [{ timeout: 1e4, wv: 4054 }, { k: 4051 }, { wv: 4055 }, { if: { e: 4056 }, then: [{ k: 4057 }] }, { if: { e: 4058 }, then: [{ k: 4059 }] }, { k: 4052 }], [], {}], [1, "ebay", 0, "^https://(www\\.)?ebay\\.([.a-z]+)/", 10, [3884], [{ e: 3884 }], [{ v: 3884 }], [{ c: 4060 }, { check: "none", timeout: 2e3, optional: true, wv: 3884 }, { if: { v: 3884 }, then: [{ timeout: 2e3, c: 4060 }] }], [], {}], [1, "ecosia", 2, "^https://www\\.ecosia\\.org/", 22, [4061], [{ e: 4062 }], [{ v: 4062 }], [{ c: 4063 }], [], {}], [1, "edebe", 0, "^https?://plus\\.edebe\\.com/", 22, [2211], [{ e: 4064 }], [{ v: 4064 }], [{ c: 4065 }, { wv: 4066 }, { if: { e: 4067 }, then: [{ k: 4067 }] }, { c: 4068 }], [{ cc: 4069 }], {}], [1, "edpb-edps", 2, "^https://(www\\.)?(edpb|edps)\\.europa\\.eu/", 22, [4070], [{ e: 4071 }], [{ v: 4070 }], [{ c: 4071 }], [{ cc: 4072 }], {}], [1, "eduardolosilla.es", 2, "^https?://(www\\.)?eduardolosilla\\.es/", 22, [4073], [{ e: 4073 }], [{ v: 4073 }], [{ c: 4074 }], [{ check: "none", timeout: 1e3, wv: 4073 }], {}], [1, "educastur-alojaweb", 1, "^https?://alojaweb\\.educastur\\.es/", 22, [4075], [{ e: 4075 }], [{ v: 4075 }], [{ h: 4075 }], [], {}], [1, "edumoov", 2, "^https?://(www\\.)?edumoov\\.com/", 10, [], [{ e: 4076 }], [{ v: 4076 }], [{ retry: 10, retryInterval: 1e3, c: 4076 }], [{ timeout: 2e3, check: "none", wv: 4077 }], {}], [1, "effenaar", 2, "^https?://(www\\.)?effenaar\\.nl/", 10, [], [{ e: 4078 }], [{ v: 4078 }], [{ c: 4078 }], [{ timeout: 2e3, check: "none", wv: 4078 }], {}], [1, "ekd.de", 2, "^https?://(\\w+\\.)?ekd\\.de/", 22, [4079], [{ e: 4080 }], [{ v: 4079 }], [{ c: 4080 }], [{ cc: 4081 }], {}], [1, "elektro-material-ch", 1, "^https?://(www\\.)?elektro-material\\.ch/", 22, [4082], [{ e: 4083 }], [{ v: 4084 }], [{ h: 4082 }], [], {}], [1, "elsevier", 2, "^https?://(\\w+\\.)?elsevier\\.(com|support)/", 22, [4085], [{ e: 4086 }], [{ v: 4086 }], [{ if: { e: 4087 }, then: [{ retry: 3, retryInterval: 1e3, c: 4087 }], else: [{ retry: 3, retryInterval: 1e3, c: 4088 }, { timeout: 1e4, wv: 2902 }, { all: true, optional: true, c: 2904 }, { timeout: 5e3, c: 2905 }] }, { check: "none", timeout: 1e4, wv: 4089 }], [{ cc: 2906 }], {}], [1, "eltax-lta-go-jp", 2, "^https://(?:[^/]+\\.)?eltax\\.lta\\.go\\.jp/", 22, [4090], [{ e: 4091 }], [{ v: 4091 }], [{ c: 4091 }], [], {}], [1, "emr-ch", 2, "^https?://(www\\.)?(emr|emfeedback)\\.ch/", 22, [4092], [{ e: 4093 }], [{ v: 4092 }], [{ all: true, optional: true, k: 4094 }, { retry: 3, retryInterval: 500, c: 4093 }], [{ cc: 4095 }], {}], [1, "endeavorhealth", 2, "^https?://(www\\.)?endeavorhealth\\.org/", 22, [4096], [{ e: 4097 }], [{ v: 4097 }], [{ retry: 2, retryInterval: 1e3, c: 4098 }], [{ check: "none", timeout: 2e3, wv: 4097 }], {}], [1, "endocrine.org", 2, "^https?://(www\\.)?endocrine\\.org/", 22, [], [{ e: 4099 }], [{ v: 4100 }], [{ c: 4100 }], [{ timeout: 1e3, check: "none", wv: 4099 }], {}], [1, "eneba", 0, "^https?://(www\\.)?eneba\\.com/", 10, [4101], [{ e: 4102 }], [{ v: 4102 }], [{ c: 4103 }, { timeout: 2e3, optional: true, wv: 4104 }, { if: { check: "none", v: 4104 }, then: [{ k: 4103 }] }, { wv: 4104 }, { all: true, optional: true, k: 4105 }, { c: 4106 }], [{ wait: 500 }, { cc: 4107 }], {}], [1, "energydashboard.co.uk", 2, "^https?://(www\\.)?energydashboard\\.co\\.uk/", 22, [3947], [{ e: 4108 }], [{ v: 2369 }], [{ c: 4108 }, { c: 4109 }, { eval: "EVAL_POVR_GOBACK" }], [{ cc: 4110 }], {}], [1, "england.nhs.uk", 2, "^https?://(www\\.)?england\\.nhs\\.uk/", 22, [4111], [{ e: 4112 }], [{ v: 4111 }], [{ c: 4112 }, { wv: 566 }, { if: { e: 4113 }, then: [{ all: true, k: 4113 }] }, { c: 568 }], [{ cc: 4114 }], {}], [1, "ensembleartsphilly", 2, "^https?://(\\w+\\.)?ensembleartsphilly\\.org/", 22, [4115], [{ e: 4116 }], [{ v: 4117 }], [{ c: 4116 }], [{ cc: 4118 }], {}], [1, "eon.pl", 2, "^https?://(\\w+\\.)?eon\\.pl/", 22, [4119], [{ e: 4120 }], [{ v: 4119 }], [{ c: 4121 }, { wv: 4122 }, { optional: true, k: 4123 }, { k: 4124 }], [{ cc: 4125 }], {}], [1, "epidemicsound.com", 2, "^https?://(\\w+\\.)?epidemicsound\\.com/", 22, [4126], [{ e: 4127 }], [{ v: 4128 }], [{ w: 2905 }, { c: 4128 }, { wv: 2902 }, { all: true, optional: true, k: 4129 }, { c: 2905 }, { check: "none", wv: 4128 }], [{ cc: 2906 }], {}], [1, "eplaque", 2, "^https?://(www\\.)?eplaque\\.fr/", 22, [4130], [{ e: 4131 }], [{ v: 4130 }], [{ c: 4132 }], [{ cc: 4133 }], {}], [1, "erli-pl", 2, "^https?://(\\w+\\.)?erli\\.pl/", 22, [], [{ e: 4134 }], [{ v: 4134 }], [{ c: 4135 }, { c: 4136 }], [{ check: "none", timeout: 2e3, wv: 4134 }], {}], [1, "eroticiracconti-it", 1, "^https?://(www\\.)?eroticiracconti\\.it/", 22, [4137], [{ e: 4138 }], [{ v: 4139 }], [{ h: 4137 }], [], {}], [1, "ersatzteil-service.de", 2, "^https?://(www\\.)?ersatzteil-service\\.de/", 22, [4140], [{ e: 4141 }], [{ v: 4140 }], [{ c: 4141 }], [{ timeout: 1e3, check: "none", wv: 4140 }], {}], [1, "ersatzteile-24", 2, "^https?://(www\\.)?ersatzteile-24\\.com/", 22, [4142], [{ e: 4143 }], [{ v: 4144 }], [{ retry: 5, retryInterval: 1e3, c: 4145 }, { wv: 4146 }, { k: 4146 }, { k: 4143 }], [{ cc: 4147 }, { cc: 4148 }], {}], [1, "escaparium.ca", 2, "^https://(www\\.)?escaparium\\.ca/", 22, [], [{ e: 4149 }], [{ v: 4150 }], [{ c: 4151 }, { c: 4152 }], [{ cc: 4153 }], {}], [1, "escorteintime", 2, "^https?://(www\\.)?escorteintime\\.com/", 22, [4154], [{ e: 4154 }], [{ v: 4154 }], [{ c: 4155 }, { c: 4156 }], [{ check: "none", timeout: 2e3, wv: 4154 }], {}], [1, "espace-personnel.agirc-arrco.fr", 2, "^https://espace-personnel\\.agirc-arrco\\.fr/", 22, [4157], [{ e: 4158 }], [{ v: 4158 }], [{ c: 4159 }], [], {}], [1, "europa-eu", 2, "^https://([a-z0-9.-]*\\.)?europa\\.eu/", 22, [4160], [{ e: 4160 }], [{ v: 4160 }], [{ c: 4161 }], [{ cc: 4162 }], {}], [1, "eventfrog", 2, "^https?://(www\\.)?eventfrog\\.(ch|de|at)/", 22, [4163], [{ e: 4164 }], [{ v: 4165 }], [{ wv: 4164 }, { wait: 500 }, { k: 4164 }], [{ cc: 4166 }], {}], [1, "evium.de", 2, "^https://(www\\.)?evium\\.de/", 22, [4167], [{ e: 4167 }], [{ v: 4167 }], [{ c: 4168 }, { check: "none", timeout: 2e3, wv: 4167 }], [], {}], [1, "evozen.fr", 2, "^https?://(\\w+\\.)?evozen\\.fr/", 22, [4169], [{ e: 4170 }], [{ v: 4169 }], [{ c: 4171 }], [], {}], [1, "expressvpn", 2, "^https?://(\\w+\\.)?expressvpn\\.com/", 22, [], [{ exists: ["#shadowHost", "#app .first-layer-card"] }], [{ visible: ["#shadowHost", "#app .first-layer-card"] }], [{ if: { exists: ["#shadowHost", ".first-layer-card .v3-reject-btn"] }, then: [{ click: ["#shadowHost", ".first-layer-card .v3-reject-btn"] }], else: [{ c: 4172 }, { waitForVisible: ["#shadowHost", ".g-card-actions"] }, { click: ["#shadowHost", ".g-expansion-panel-header input[type=checkbox]:checked:not([disabled])"], all: true, optional: true }, { waitForThenClick: ["#shadowHost", ".g-card-actions #saveButton"] }] }], [{ cc: 707 }], {}], [1, "extra-com", 0, "^https://(www\\.)?extra\\.com/", 22, [4173, 4174], [{ e: 4173 }], [{ v: 4173 }], [{ c: 4175 }, { wv: 4176 }, { if: { e: 4177 }, then: [{ all: true, k: 4177 }] }, { k: 4176 }, { check: "none", timeout: 5e3, wv: 4173 }], [{ cc: 1940 }], {}], [1, "facebook", 2, "^https://(www\\.)?facebook\\.com/", 22, [], [{ e: 4178 }], [{ v: 4178 }], [{ wait: 500 }, { retry: 3, retryInterval: 500, c: 4178 }, { check: "none", wv: 4179 }], [], {}], [1, "facebook-mobile", 2, "^https://(m|mbasic)\\.facebook\\.com/", 22, [1952], [{ e: 1952 }], [{ v: 1952 }], [{ c: 4180 }, { check: "none", wv: 1952 }], [], {}], [1, "fanfiction", 1, "^https?://(\\w+\\.)?(fanfiction\\.net|fictionpress\\.com)/", 22, [4181], [{ e: 4182 }], [{ v: 4181 }], [{ h: 4181 }], [], {}], [1, "faphouse", 2, "^https://(\\w+\\.)?faphouse\\d*\\.com/", 22, [4183], [{ e: 4184 }], [{ v: 4184 }], [{ if: { e: 4185 }, then: [{ c: 4185 }], else: [{ c: 4186 }] }], [{ check: "none", v: 4187 }], {}], [1, "fascicolosanitario-lombardia", 0, "^https?://(\\w+\\.)?fascicolosanitario\\.regione\\.lombardia\\.it/", 22, [745], [{ e: 4188 }], [{ v: 4189 }], [{ c: 4190 }], [{ cc: 4191 }], {}], [1, "fawesome.tv", 2, "^https?://(www\\.)?fawesome\\.tv/", 22, [], [{ e: 4192 }], [{ check: "any", v: 4193 }], [{ c: 4192 }], [{ check: "none", v: 4192 }], {}], [1, "fc2", 1, "^https?://([\\w-]+\\.)?fc2\\.com/", 22, [4194], [{ e: 4195 }], [{ v: 4195 }], [{ h: 4194 }], [], {}], [1, "fellow.pl", 2, "^https?://(\\w+\\.)?(fellow|fll)\\.pl/", 22, [], [{ e: 4196 }], [{ v: 4196 }], [{ c: 4197 }], [], {}], [1, "fepblue.org", 2, "^https?://(www\\.)?fepblue\\.org/", 22, [4198], [{ e: 4199 }], [{ v: 4200 }], [{ c: 4199 }], [{ check: "none", timeout: 2e3, wv: 4199 }], {}], [1, "fictionexpress", 2, "^https?://(\\w+\\.)?fictionexpress\\.com/", 22, [4201], [{ e: 4202 }], [{ v: 4201 }], [{ c: 4202 }], [{ check: "none", wv: 4201 }], {}], [1, "fideuram", 2, "^https?://(www\\.)?fideuram\\.it/", 22, [4203], [{ e: 4204 }], [{ v: 4204 }], [{ c: 4204 }], [{ cc: 4205 }], {}], [1, "fis-data-exchange", 2, "^https://services\\.dataexchange\\.fiscloudservices\\.com/", 22, [4206], [{ e: 4207 }], [{ v: 4207 }], [{ c: 4207 }], [{ cc: 4208 }], {}], [1, "flinders-edu-au", 2, "^https?://(\\w+\\.)?flinders\\.edu\\.au/", 22, [], [{ e: 4209 }], [{ v: 4209 }], [{ c: 4209 }], [{ timeout: 2e3, check: "none", wv: 4209 }], {}], [1, "florisvanbommel", 2, "^https?://(\\w+\\.)?florisvanbommel\\.com/", 22, [4210], [{ e: 4211 }], [{ v: 4211 }], [{ c: 4211 }], [{ cc: 4212 }], {}], [1, "fn-se", 2, "^https?://(www\\.)?fn\\.se/", 22, [2379], [{ e: 4213 }], [{ v: 4214 }], [{ c: 4215 }, { wv: 4216 }, { k: 4216 }], [{ cc: 4217 }], {}], [1, "fod-fujitv", 2, "^https?://fod\\.fujitv\\.co\\.jp/", 22, [4218], [{ v: 4219 }], [{ v: 4218 }], [{ c: 4219 }], [{ cc: 4220 }], {}], [1, "fondationbeyeler", 2, "^https?://(www\\.)?fondationbeyeler\\.ch/", 10, [], [{ e: 4221 }], [{ v: 4222 }, { e: 4221 }], [{ all: true, optional: true, k: 4223 }, { c: 4222 }], [{ timeout: 2e3, check: "none", wv: 4221 }], {}], [1, "fondoest.it", 2, "^https?://(www\\.)?fondoest\\.it/", 22, [4224], [{ e: 4225 }], [{ v: 4226 }], [{ c: 4226 }, { c: 4227 }], [{ cc: 4228 }], {}], [1, "fonts.google.com", 2, "^https?://fonts\\.google\\.com/", 22, [4229], [{ e: 4230 }], [{ v: 4229 }], [{ c: 4231 }], [{ check: "none", timeout: 2e3, wv: 4229 }], {}], [1, "food-standards-agency", 0, "^https?://ratings\\.food\\.gov\\.uk/", 22, [], [{ e: 4232 }], [{ v: 4232 }], [{ h: 3433 }, { if: { e: 4233 }, then: [{ k: 4233 }], else: [{ k: 4232 }, { c: 4233 }, { eval: "EVAL_POVR_GOBACK" }] }], [{ cc: 4234 }, { cc: 4235 }], {}], [1, "fora.se", 2, "^https?://(\\w+\\.)?fora\\.se/", 22, [4236], [{ e: 4237 }], [{ v: 4238 }], [{ c: 4237 }], [{ cc: 4239 }], {}], [1, "forsakringskassan.se", 2, "^https?://(\\w+\\.)?forsakringskassan\\.se/", 22, [4240], [{ e: 4241 }], [{ v: 4241 }], [{ c: 4242 }], [{ cc: 4243 }], {}], [1, "foto-erhardt", 2, "^https?://(www\\.)?foto-erhardt\\.(de|com|fr)/", 22, [], [{ e: 4244 }], [{ v: 4245 }], [{ c: 4244 }, { c: 4246 }], [{ cc: 4247 }], {}], [1, "fpl-com", 2, "^https?://(www\\.)?(fpl|fplhome)\\.com/", 22, [4248], [{ e: 4248 }], [{ v: 4248 }], [{ c: 4249 }], [{ check: "none", v: 4248 }], {}], [1, "freak.no", 2, "^https?://(www\\.)?freak\\.no/", 22, [3368], [{ e: 4250 }], [{ v: 4251 }], [{ w: 4250 }, { k: 4250 }], [{ cc: 4252 }], {}], [1, "fuegodevida", 1, "^https?://(www\\.)?fuegodevida\\.com/", 22, [52], [{ e: 4253 }], [{ v: 52 }], [{ h: 52 }], [], {}], [1, "fundednext", 2, "^https?://(www\\.)?fundednext\\.com/", 22, [4254], [{ e: 4254 }], [{ v: 4254 }], [{ c: 4255 }, { c: 4256 }, { check: "none", timeout: 2e3, optional: true, wv: 4257 }], [], {}], [1, "funpay", 2, "^https?://(\\w+\\.)?funpay\\.com/", 10, [4258], [{ e: 4259 }], [{ v: 4258 }], [{ c: 4259 }, { wv: 4260 }, { if: { e: 4261 }, then: [{ k: 4261 }] }, { k: 4260 }], [{ wait: 500 }, { cc: 4262 }], {}], [1, "fuqer", 2, "^https?://(\\w+\\.)?fuqer\\.com/", 22, [4263], [{ e: 4264 }], [{ v: 4264 }], [{ retry: 10, retryInterval: 500, c: 4264 }], [{ cc: 4265 }], {}], [1, "furniture.com", 2, "^https?://(www\\.)?furniture\\.com/", 22, [3911], [{ e: 4266 }], [{ v: 4266 }], [{ c: 4267 }, { wv: 4268 }, { optional: true, k: 4269 }, { c: 4270 }, { wv: 4271 }, { all: true, optional: true, k: 4272 }, { c: 4273 }, { wv: 4274 }, { optional: true, k: 4275 }, { c: 4276 }, { c: 4277 }], [{ cc: 325 }], {}], [1, "futoncompany", 2, "^https?://(\\w+\\.)?futoncompany\\.co\\.uk/", 22, [4278], [{ e: 4278 }], [{ v: 4278 }], [{ c: 4279 }, { wv: 4280 }, { all: true, optional: true, k: 4281 }, { k: 4282 }], [{ wait: 1500 }, { cc: 4283 }], {}], [1, "futurabolzano.it", 1, "^https?://(www\\.)?futurabolzano\\.it/", 22, [4284], [{ e: 4284 }], [{ v: 4284 }], [{ h: 4284 }], [{ check: "none", v: 4284 }], {}], [1, "gamefound-com", 1, "^https://(www\\.)?gamefound\\.com/", 22, [4285], [{ e: 4286 }], [{ v: 4287 }], [{ h: 4285 }], [], {}], [1, "gays-cruising", 2, "^https?://([\\w-]+\\.)?gays-cruising\\.com/", 22, [4288], [{ e: 4289 }], [{ v: 4288 }], [{ c: 4290 }, { wv: 4291 }, { all: true, optional: true, k: 4292 }, { k: 4293 }], [{ cc: 4294 }], {}], [1, "geni.com", 1, "^https://(www\\.)?geni\\.com/", 22, [4295], [{ e: 4295 }], [{ v: 4295 }], [{ h: 4295 }], [], {}], [1, "ggzstandaarden.nl", 2, "^https?://(www\\.)?ggzstandaarden\\.nl/", 22, [1564], [{ e: 4296 }], [{ v: 4296 }], [{ c: 4296 }], [{ cc: 4297 }], {}], [1, "givedirectly", 2, "^https?://(www\\.)?givedirectly\\.org/", 22, [4298], [{ e: 4298 }], [{ v: 4298 }], [{ retry: 3, c: 4299 }], [{ check: "none", wv: 4298 }], {}], [1, "gjerrigknark", 2, "^https?://(\\w+\\.)?gjerrigknark\\.com/", 10, [4300], [{ e: 4300 }], [{ v: 4300 }], [{ c: 4301 }, { c: 4302 }], [{ cc: 4303 }], {}], [1, "gla.ac.uk", 2, "^https?://(\\w+\\.)?gla\\.ac\\.uk/", 22, [4304], [{ e: 4305 }], [{ v: 4305 }], [{ c: 4306 }, { k: 4307 }, { k: 4308 }], [{ cc: 4309 }, { cc: 4310 }, { cc: 4311 }], {}], [1, "glastonburyfestivals", 0, "^https://(\\w+\\.)?glastonburyfestivals\\.co\\.uk/", 22, [4312], [{ e: 4313 }], [{ v: 4313 }], [{ c: 4314 }], [], {}], [1, "glavcom.ua", 2, "^https?://(\\w+\\.)?glavcom\\.ua/", 22, [4315], [{ v: 4316 }], [{ v: 4315 }], [{ c: 4317 }], [{ cc: 4318 }], {}], [1, "gleeden", 2, "^https?://(\\w+\\.)?gleeden\\.com/", 22, [4319], [{ e: 4320 }], [{ v: 4321 }], [{ c: 4322 }, { check: "none", wv: 4321 }], [{ check: "none", v: 4321 }], {}], [1, "globes.co.il", 2, "^https?://(\\w+\\.)?globes\\.co\\.il/", 22, [4323], [{ any: [{ e: 4324 }, { e: 1395 }] }], [{ any: [{ v: 4324 }, { e: 1424 }] }], [{ if: { e: 1424 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }, { timeout: 5e3, optional: true, wv: 4324 }, { if: { v: 4324 }, then: [{ k: 4324 }] }], [{ check: "none", v: 4323 }], {}], [1, "gnoccaforum", 2, "^https?://(www\\.)?gnoccaforum\\.com/", 22, [2211], [{ e: 4325 }], [{ v: 2211 }], [{ c: 4326 }], [{ check: "none", timeout: 2e3, wv: 2211 }], {}], [1, "gobiernodecanarias", 2, "^https?://(\\w+\\.)?(gobiernodecanarias\\.org|gobcan\\.net)/", 22, [4327], [{ e: 4328 }], [{ v: 4327 }], [{ c: 4329 }, { wv: 4328 }, { optional: true, k: 4330 }, { c: 4331 }], [{ cc: 4332 }], {}], [1, "gov-pl-cookies-info", 1, "^https?://([\\w-]+\\.)*gov\\.pl/", 22, [4333], [{ e: 4334 }], [{ v: 4335 }], [{ h: 4333 }], [], {}], [1, "greatschools", 2, "^https?://(www\\.)?greatschools\\.org/", 22, [4336], [{ e: 4337 }], [{ v: 4336 }], [{ c: 4337 }], [{ cc: 4338 }], {}], [1, "greengo", 2, "^https?://(www\\.)?greengo\\.voyage/", 10, [], [{ e: 4339 }], [{ v: 4339 }], [{ c: 4339 }], [{ timeout: 2e3, check: "none", wv: 4340 }], {}], [1, "grocefully", 2, "^https?://(\\w+\\.)?grocefully\\.com/", 22, [], [{ e: 4341 }], [{ v: 4341 }], [{ c: 4342 }, { wv: 1120 }, { all: true, optional: true, k: 1121 }, { c: 3427 }], [], {}], [1, "groupama.fr", 2, "^https?://(www\\.)?groupama\\.fr/", 22, [4343], [{ e: 4344 }], [{ v: 4343 }], [{ timeout: 1e4, c: 4345 }], [{ cc: 4346 }], {}], [1, "gsmpunt.nl", 2, "^https?://(\\w+\\.)?gsmpunt\\.nl/", 22, [4347], [{ e: 4348 }], [{ v: 4349 }], [{ c: 4348 }, { wv: 4350 }, { all: true, optional: true, k: 4351 }, { k: 4350 }], [{ cc: 4352 }], {}], [1, "gujaratsamachar", 2, "^https://(\\w+\\.)?gujaratsamachar\\.com/", 22, [4353], [{ v: 4353 }], [{ v: 4353 }], [{ all: true, optional: true, k: 4354 }, { k: 4355 }, { check: "none", wv: 4353 }], [{ cc: 4356 }], {}], [1, "gundam-base-entry", 2, "^https://(www\\.)?gundam-base-entry\\.net/", 22, [4357], [{ e: 4358 }], [{ v: 4358 }], [{ c: 4358 }, { c: 4359 }, { check: "none", wv: 4357 }], [{ cc: 4360 }], {}], [1, "hamradio.com", 1, "^https?://(www\\.)?hamradio\\.com/", 22, [3433], [{ e: 4361 }], [{ v: 3433 }], [{ h: 3433 }], [], {}], [1, "head-fi", 2, "^https?://(www\\.)?head-fi\\.org/", 22, [4362], [{ e: 4363 }], [{ v: 4362 }], [{ c: 4363 }], [{ timeout: 1e3, check: "none", wv: 4362 }], {}], [1, "headfirstbristol", 2, "^https?://(\\w+\\.)?headfirstbristol\\.co\\.uk/", 22, [4364], [{ e: 4365 }], [{ v: 4366 }], [{ c: 4365 }], [{ check: "none", v: 4364 }], {}], [1, "healthysupplies", 2, "^https?://(www\\.)?healthysupplies\\.co\\.uk/", 22, [4367], [{ e: 4368 }], [{ v: 4368 }], [{ c: 4369 }, { wv: 4370 }, { all: true, optional: true, k: 4371 }, { retry: 5, retryInterval: 500, c: 4372 }], [{ wait: 1e3 }, { cc: 4373 }], {}], [1, "hearst-us", 1, "^https://(www\\.)?(menshealth|womenshealthmag|cosmopolitan|esquire|elle|elledecor|harpersbazaar|goodhousekeeping|popularmechanics|caranddriver|delish|veranda|roadandtrack|bestproducts|countryliving|housebeautiful|bicycling|biography|pitchfork|prevention|runnersworld|thepioneerwoman|townandcountrymag|seventeen|oprahdaily|womansday|redbookmag|autoweek)\\.com/", 10, [4374], [{ e: 4374 }], [{ check: "any", v: 4374 }], [{ h: 4374 }], [{ check: "none", v: 4374 }], {}], [1, "heerlijkehuisjes", 2, "^https?://(\\w+\\.)?heerlijkehuisjes\\.nl/", 22, [4375], [{ e: 4376 }], [{ v: 4376 }], [{ c: 4377 }, { wv: 4378 }, { all: true, optional: true, k: 4379 }, { c: 4380 }], [{ cc: 4381 }], {}], [1, "helvy.co.uk", 2, "^https?://(www\\.)?helvy\\.co\\.uk/", 22, [4382], [{ e: 4382 }], [{ v: 4382 }], [{ retry: 5, retryInterval: 1e3, c: 4383 }], [{ cc: 4384 }], {}], [1, "hemsol.se", 2, "^https?://(\\w+\\.)?hemsol\\.se/", 22, [4385], [{ e: 4386 }], [{ v: 4387 }], [{ c: 4388 }, { wv: 4386 }, { all: true, optional: true, k: 4389 }, { c: 4386 }], [{ cc: 4390 }], {}], [1, "hetgoed", 2, "^https?://(www\\.)?hetgoed\\.nl/", 22, [4391], [{ e: 4392 }], [{ v: 4392 }], [{ c: 4393 }, { wv: 4394 }, { if: { e: 4395 }, then: [{ k: 4394 }] }, { c: 4393 }], [], {}], [1, "hikvision.com", 1, "^https?://(\\w+\\.)?hikvision\\.com/", 10, [], [{ e: 4396 }, { negated: true, e: 4397 }], [{ v: 4398 }], [{ h: 4398 }], [], {}], [1, "historiskatlas.dk", 1, "^https?://(www\\.)?historiskatlas\\.dk/", 22, [4399], [{ e: 4399 }], [{ v: 4399 }], [{ h: 4399 }], [{ check: "none", v: 4399 }], {}], [1, "hmi-basen.dk", 2, "^https?://(www\\.)?hmi-basen\\.dk/", 22, [3689], [{ e: 4400 }], [{ v: 3689 }], [{ c: 4400 }], [], {}], [1, "hsbc-au", 2, "^https://(www\\.)?hsbc\\.com\\.au/", 22, [4401], [{ e: 4402 }], [{ v: 4402 }], [{ c: 4403 }], [{ check: "none", timeout: 3e3, wv: 4402 }], {}], [1, "huawei-cookie-notice", 2, "^https?://consumer\\.huawei\\.com/", 22, [4404], [{ e: 4405 }], [{ v: 4404 }], [{ c: 4405 }], [], {}], [1, "human-ua", 2, "^https?://([\\w-]+\\.)?human\\.ua/", 22, [], [{ e: 4406 }], [{ v: 4406 }], [{ c: 4407 }, { check: "none", wv: 4406 }], [], {}], [1, "hyperoptic", 2, "^https?://(\\w+\\.)?hyperoptic\\.com/", 22, [4408], [{ e: 4409 }], [{ v: 4409 }], [{ c: 4410 }, { wv: 4411 }, { all: true, optional: true, k: 4412 }, { c: 4413 }], [{ cc: 4414 }], {}], [1, "hypovereinsbank", 2, "^https://(www\\.)?hypovereinsbank\\.de/", 22, [4415], [{ e: 4416 }], [{ v: 4417 }], [{ c: 4416 }], [{ cc: 4418 }, { cc: 4212 }, { cc: 4419 }], {}], [1, "hyrabostad.se", 2, "^https?://(www\\.)?hyrabostad\\.se/", 22, [3214], [{ e: 4420 }], [{ v: 4420 }], [{ c: 4421 }, { wv: 4422 }, { if: { e: 4423 }, then: [{ k: 4423 }] }, { retry: 3, retryInterval: 400, c: 4424 }], [{ check: "none", v: 4425 }], {}], [1, "ibanez", 2, "^https?://www\\.ibanez\\.com/", 22, [4426], [{ e: 4427 }], [{ v: 4428 }], [{ c: 4427 }], [{ cc: 4429 }], {}], [1, "icom-co-jp", 1, "^https?://(www\\.)?icom\\.co\\.jp/", 22, [4430], [{ e: 4431 }], [{ v: 4432 }], [{ h: 2379 }], [{ check: "none", v: 2379 }], {}], [1, "idoctors.it", 2, "^https?://(www\\.)?idoctors\\.it/", 22, [4433, 4434], [{ e: 4433 }], [{ v: 4433 }], [{ c: 4435 }, { wv: 4434 }, { if: { e: 4436 }, then: [{ k: 4437 }] }, { retry: 3, retryInterval: 500, c: 4438 }], [{ cc: 4212 }], {}], [1, "ign.es", 1, "^https?://(www\\.)?ign\\.es/", 22, [4439], [{ e: 4440 }], [{ v: 4439 }], [{ h: 4439 }], [{ check: "none", v: 4439 }], {}], [1, "ihk-muenchen.de", 2, "^https?://(\\w+\\.)?ihk-muenchen\\.de/", 22, [52], [{ e: 4441 }], [{ v: 52 }], [{ c: 4441 }], [{ cc: 4442 }], {}], [1, "iisvaldagno", 1, "^https?://(www\\.)?iisvaldagno\\.it/", 22, [4443], [{ e: 4444 }], [{ v: 4443 }], [{ h: 4443 }], [{ check: "none", v: 4443 }], {}], [1, "imdb", 0, "^https://(www\\.)?(m\\.)?imdb.com/", 22, [4445], [{ e: 4445 }], [{ v: 4445 }], [{ c: 4446 }], [], {}], [1, "incogni", 2, "^https?://(\\w+\\.)?incogni\\.com/", 22, [4447], [{ e: 4447 }], [{ v: 4447 }], [{ if: { e: 4448 }, then: [{ k: 4448 }], else: [{ k: 4449 }, { c: 4448 }] }], [{ cc: 4450 }], {}], [1, "ing-de", 0, "^https://(\\w+\\.)?ing\\.de/", 10, [], [{ exists: ["ing-cc-manager", "ing-cc-dialog-level0"] }], [{ exists: ["ing-cc-manager[is-open]", "ing-cc-dialog-level0", ".cc-l0__button__more"] }], [{ waitForThenClick: ["ing-cc-manager", "ing-cc-dialog-level0", ".cc-l0__button__more"] }], [], {}], [1, "ing-nl", 2, "^https://([a-z0-9-]+\\.)?ing\\.nl/", 22, [], [{ exists: ["ing-app-open-page", "#cookieDialog", "ing-feat-cookie-dialog-nl"] }], [{ visible: ["ing-app-open-page", "#cookieDialog", "ing-feat-cookie-dialog-nl", "ing-feat-global-cookie-preference", "cookie-preference-main", "[data-testid=reject]"] }], [{ waitForThenClick: ["ing-app-open-page", "#cookieDialog", "ing-feat-cookie-dialog-nl", "ing-feat-global-cookie-preference", "cookie-preference-main", "[data-testid=reject]"] }], [{ cc: 4451 }], {}], [1, "instagram", 2, "^https://www\\.instagram\\.com/", 22, [], [{ e: 4452 }], [{ v: 4452 }], [{ c: 4453 }, { wait: 2e3 }], [], {}], [1, "instagram-help-center", 2, "^https://(help|about|privacycenter)\\.instagram\\.com/", 22, [], [{ e: 4454 }], [{ v: 4454 }], [{ c: 4454 }, { timeout: 5e3, w: 4455 }, { if: { e: 4456 }, then: [{ all: true, k: 4456 }] }, { c: 4457 }, { check: "none", wv: 4458 }], [], {}], [1, "intesasanpaolo", 2, "^https?://(\\w+\\.)?intesasanpaolo\\.com/", 22, [4459], [{ e: 4460 }], [{ v: 4460 }], [{ c: 4460 }], [{ cc: 4461 }, { negated: true, cc: 4462 }], {}], [1, "io.no", 0, "^https?://([a-z0-9-]+\\.)?io\\.no/", 22, [4463], [{ e: 4464 }], [{ v: 4463 }], [{ c: 4464 }], [{ check: "none", timeout: 1e3, wv: 4463 }], {}], [1, "ipkobiznes.pl", 2, "^https?://(www\\.)?ipkobiznes\\.pl/", 22, [4465], [{ e: 4465 }], [{ v: 4465 }], [{ c: 4466 }], [{ cc: 4467 }], {}], [1, "isidewith.com", 2, "^https?://(\\w+\\.)?isidewith\\.com/", 22, [], [{ e: 4468 }], [{ v: 4468 }], [{ c: 4469 }, { check: "none", timeout: 2e3, wv: 4468 }], [{ check: "none", v: 4468 }], {}], [1, "islamqa.org", 2, "^https?://(www\\.)?islamqa\\.org/", 22, [4470], [{ e: 4471 }], [{ check: "any", v: 4471 }], [{ h: 798 }, { eval: "EVAL_COOKIE_LAW_INFO_0", optional: true }, { timeout: 1e4, optional: true, wv: 1308 }, { if: { v: 1308 }, then: [{ wait: 500 }, { k: 1309 }, { w: 1310 }, { all: true, optional: true, k: 1311 }, { c: 1312 }] }], [{ negated: true, cc: 800 }], {}], [2, "istore.co.za", 1, "^https?://(www\\.)?istore(preowned)?\\.co\\.za/", 22, [438], [{ e: 438 }], [{ v: 438 }], [{ h: 438 }, { optional: true, h: 4472 }, { removeClass: "no-scroll", selector: "body", optional: true }], [], {}], [1, "itemsatis.com", 2, "^https?://(\\w+\\.)?itemsatis\\.com/", 22, [4473], [{ e: 4474 }], [{ v: 4475 }], [{ all: true, optional: true, k: 4476 }, { c: 4474 }], [{ cc: 4477 }, { negated: true, e: 4476 }], {}], [1, "itopvpn.com", 1, "^https://(www\\.)?itopvpn.com/", 22, [], [{ e: 4478 }], [{ e: 4478 }], [{ h: 4478 }], [], {}], [1, "iubenda-rti", 2, "^https?://([\\w-]+\\.)*(mediaset\\.it|meteo\\.it|wittytv\\.it|today\\.it|milanotoday\\.it|romatoday\\.it|padovaoggi\\.it|bolognatoday\\.it|torinotoday\\.it|genovatoday\\.it|trevisotoday\\.it)/", 10, [1689], [{ e: 4479 }], [{ v: 4479 }], [{ c: 4479 }, { c: 4480 }], [], {}], [1, "iworks-footer-notice", 2, "^https?://(www\\.)?prorankingi\\.pl/", 22, [4481], [{ e: 4481 }], [{ v: 4481 }, { negated: true, cc: 4482 }], [{ timeout: 15e3, optional: true, w: 4483 }, { retry: 3, retryInterval: 1e3, c: 4484 }], [{ cc: 4482 }], {}], [1, "jetpens", 2, "^https?://(www\\.)?jetpens\\.com/", 22, [4485], [{ e: 4486 }], [{ v: 4485 }], [{ c: 4487 }, { wv: 4488 }, { all: true, optional: true, k: 4489 }, { k: 4490 }, { check: "none", timeout: 2e3, wv: 4485 }], [], {}], [1, "jne-co-id", 1, "^https?://(www\\.)?jne\\.co\\.id/", 22, [4491], [{ e: 4492 }], [{ v: 4491 }], [{ h: 4491 }], [{ check: "none", v: 4491 }], {}], [1, "jobbland", 2, "^https?://(\\w+\\.)?(jobbland|jobbsafari)\\.se/", 22, [4493], [{ e: 4494 }], [{ v: 4494 }], [{ c: 4495 }, { w: 4496 }, { all: true, optional: true, k: 4497 }, { c: 4498 }], [{ check: "none", timeout: 2e3, wv: 4494 }], {}], [1, "jobtoday", 2, "^https?://(www\\.)?jobtoday\\.com/", 22, [], [{ e: 4499 }], [{ v: 4499 }], [{ c: 4500 }, { wv: 4501 }, { all: true, optional: true, k: 4502 }, { c: 4503 }], [{ cc: 4504 }], {}], [1, "johnlewis.com", 2, "^https?://(\\w+\\.)?johnlewis\\.com/", 22, [4505], [{ e: 4505 }], [{ v: 4505 }], [{ retry: 3, retryInterval: 500, c: 4506 }, { check: "none", timeout: 3e3, optional: true, wv: 4505 }], [{ cc: 4507 }], {}], [1, "jurahilfe-de", 2, "^https?://(\\w+\\.)?jurahilfe\\.de/", 22, [4508], [{ e: 4509 }], [{ v: 4509 }], [{ all: true, optional: true, k: 4510 }, { c: 4511 }], [{ cc: 4512 }, { cc: 4513 }, { cc: 4514 }], {}], [1, "justgiving.com", 2, "^https://(?:[a-z0-9-]+\\.)?justgiving\\.com/", 22, [4515], [{ any: [{ e: 4515 }, { e: 4516 }] }], [{ v: 4515 }, { e: 4517 }], [{ c: 4517 }], [{ wait: 500 }, { cc: 4518 }], {}], [1, "justwatch.com", 2, "^https?://(\\w+\\.)?justwatch\\.com/", 22, [3789], [{ e: 4519 }], [{ v: 4519 }], [{ k: 4520 }, { c: 4521 }, { all: true, c: 4522 }, { all: true, optional: true, k: 4523 }, { wv: 4524 }, { k: 4524 }], [], {}], [1, "juzaphoto", 2, "^https?://(\\w+\\.)?juzaphoto\\.com/", 22, [4525], [{ e: 4525 }], [{ v: 4525 }], [{ c: 4526 }], [{ cc: 4527 }], {}], [1, "kadokawa-ascii", 1, "^https?://(weekly\\.ascii|mobileascii)\\.jp/", 22, [4528], [{ e: 4528 }], [{ e: 4528 }], [{ h: 4528 }], [{ check: "none", v: 4528 }], {}], [1, "kaggle", 2, "^https?://(www\\.)?kaggle\\.com/", 22, [], [{ e: 4529 }], [{ v: 4529 }], [{ c: 4530 }], [{ cc: 4531 }], {}], [1, "kaluga-poisk-ru", 1, "^https?://(www\\.)?kaluga-poisk\\.ru/", 22, [4532], [{ e: 4533 }], [{ v: 4534 }], [{ h: 4532 }], [], {}], [1, "kanopy", 2, "^https?://(www\\.)?kanopy\\.com/", 22, [], [{ e: 4535 }], [{ v: 4535 }], [{ if: { e: 4536 }, then: [{ c: 4536 }], else: [{ c: 4537 }] }, { wv: 4538 }, { if: { e: 4539 }, then: [{ k: 4539 }] }, { if: { e: 4540 }, then: [{ k: 4540 }] }, { if: { e: 4541 }, then: [{ k: 4541 }] }, { k: 4538 }], [], {}], [1, "kartverket", 0, "^https?://([a-z0-9-]+\\.)?kartverket\\.no/", 22, [4542], [{ e: 4543 }], [{ v: 4543 }], [{ c: 4543 }, { wv: 4544 }, { optional: true, k: 4545 }, { k: 4544 }], [{ check: "none", timeout: 1e3, wv: 4544 }], {}], [1, "kathmandu-nl", 2, "^https?://(www\\.)?kathmandu\\.nl/", 10, [], [{ e: 4546 }], [{ v: 4547 }], [{ c: 4546 }], [{ timeout: 2e3, check: "none", wv: 4548 }], {}], [1, "kela.fi", 2, "^https?://(\\w+\\.)?kela\\.fi/", 22, [4549], [{ e: 4549 }], [{ v: 4549 }], [{ c: 4550 }], [{ cc: 4551 }], {}], [1, "kenstechtips", 2, "^https?://(\\w+\\.)?kenstechtips\\.com/", 22, [4552], [{ e: 4553 }], [{ v: 4554 }], [{ c: 4555 }], [{ cc: 4556 }], {}], [1, "keurig.com", 2, "^https?://(www\\.)?keurig\\.com/", 22, [4557], [{ e: 4557 }], [{ v: 4557 }], [{ c: 4558 }, { timeout: 5e3, optional: true, w: 4559 }, { eval: "EVAL_TEALIUM_1", optional: true }, { eval: "EVAL_TEALIUM_DONOTSELL", optional: true }], [{ check: "none", v: 4557 }], {}], [1, "kglakademi.dk", 2, "^https?://(\\w+\\.)?kglakademi\\.dk/", 22, [], [{ e: 4560 }], [{ v: 4561 }], [{ all: true, optional: true, k: 4562 }, { c: 4563 }], [{ cc: 4564 }], {}], [1, "kickstarter.com", 2, "^https?://(www\\.)?kickstarter\\.com/", 22, [4565], [{ e: 4566 }], [{ v: 4566 }], [{ c: 4567 }], [{ check: "none", v: 4566 }], {}], [1, "kingrecords-co-jp", 2, "^https?://(?:[^/]+\\.)?kingrecords\\.co\\.jp/", 22, [4568], [{ e: 4569 }], [{ v: 4569 }], [{ timeout: 1e4, optional: true, w: 4570 }, { c: 4569 }, { if: { v: 4571 }, then: [{ wait: 1e3 }, { k: 4569 }] }, { check: "none", timeout: 5e3, wv: 4571 }], [{ cc: 4572 }], {}], [1, "kiwi.com", 2, "^https?://(www\\.)?kiwi\\.com/", 10, [165], [{ e: 4573 }], [{ v: 4574 }], [{ retry: 5, retryInterval: 1e3, c: 4575 }], [{ check: "none", timeout: 3e3, wv: 4574 }, { cc: 4576 }], {}], [1, "kiwico", 2, "^https?://(www\\.)?kiwico\\.com/", 10, [4577], [{ e: 4578 }], [{ v: 4579 }], [{ c: 4578 }, { c: 4580 }, { check: "none", timeout: 3e3, wv: 4581 }, { c: 4582 }], [{ check: "none", timeout: 3e3, wv: 4577 }], {}], [1, "klimatabelle.com", 2, "^https?://(www\\.)?klimatabelle\\.com/", 22, [1135], [{ e: 4583 }], [{ v: 4583 }], [{ c: 4583 }], [{ cc: 4584 }], {}], [1, "kredittbanken", 2, "^https?://(www\\.)?kredittbanken\\.no/", 22, [4585], [{ exists: ["kb-cookie-consent-dialog", "#decline-all"] }], [{ visible: ["kb-cookie-consent-dialog", "dialog[open]"] }], [{ waitForThenClick: ["kb-cookie-consent-dialog", "#decline-all"], retry: 10, retryInterval: 500 }], [{ cc: 4586 }, { waitForVisible: ["kb-cookie-consent-dialog", "dialog"], check: "none", timeout: 2e3 }], {}], [1, "krillion.to", 2, "^https?://(www\\.)?krillion\\.to/", 22, [4587], [{ e: 4588 }], [{ v: 4587 }], [{ retry: 20, retryInterval: 500, c: 4589 }, { check: "none", wv: 4587 }], [{ cc: 4590 }], {}], [1, "kuendigung.org", 1, "^https?://(www\\.)?kuendigung\\.org/", 22, [4591], [{ e: 4592 }], [{ v: 4591 }], [{ h: 4591 }], [{ check: "none", v: 4591 }], {}], [1, "kupujemprodajem", 1, "^https?://(www\\.)?kupujemprodajem\\.com/", 22, [4593], [{ e: 4593 }], [{ v: 4593 }], [{ h: 4593 }], [], {}], [1, "la-becanerie", 2, "^https://(www\\.)?la-becanerie\\.com/", 22, [4594], [{ e: 4595 }], [{ v: 4596 }], [{ c: 4597 }], [{ cc: 4598 }], {}], [1, "lacoccinelle", 2, "^https?://(\\w+\\.)?lacoccinelle\\.net/", 22, [2295], [{ e: 2295 }], [{ check: "any", v: 4599 }], [{ if: { e: 2297 }, then: [{ all: true, retry: 3, c: 2301 }, { c: 4600 }, { timeout: 5e3, optional: true, c: 4601 }], else: [{ c: 4602 }, { c: 4603 }, { check: "none", timeout: 1500, optional: true, wv: 2311 }, { if: { check: "any", v: 4604 }, then: [{ all: true, k: 4604 }, { check: "none", timeout: 5e3, wv: 2311 }] }] }], [{ check: "none", v: 4599 }], {}], [1, "lantmateriet", 2, "^https?://(www\\.)?lantmateriet\\.se/", 22, [4605], [{ e: 4606 }], [{ v: 4607 }], [{ c: 4606 }], [{ cc: 4608 }], {}], [1, "lastdodo", 2, "^https?://(www\\.)?lastdodo\\.(nl|com|de|fr)/", 22, [], [{ e: 4609 }], [{ v: 4610 }], [{ c: 4611 }, { wv: 4612 }, { all: true, optional: true, k: 4613 }, { c: 4614 }], [], {}], [1, "latinka", 0, "^https?://(\\w+\\.)?latinka\\.com\\.pe/", 22, [4615], [{ e: 4615 }], [{ v: 4615 }], [{ c: 4616 }, { check: "none", wv: 4615 }], [{ cc: 4617 }], {}], [3, "latrobe.edu.au", 1, "^https?://(\\w+\\.)?latrobe\\.edu\\.au/", 10, [4618], [{ e: 4619 }], [{ v: 4618 }], [{ h: 4618 }, { stylesheet: "body.gdpr-on #header { top: 0 !important; } body.vi #header #gdpr ~ #global-search-button, body.vi #header #gdpr ~ #global-search-button + label { top: 1.25rem; bottom: auto; }", stylesheetId: "latrobe-gdpr-layout" }], [], {}], [1, "lawhive", 2, "^https?://(www\\.)?lawhive\\.co\\.uk/", 22, [4620], [{ e: 4621 }], [{ v: 4621 }], [{ c: 4622 }, { c: 4623 }], [{ cc: 4624 }], {}], [1, "laxd", 1, "^https?://(\\w+\\.)?laxd\\.com/", 22, [4625], [{ e: 4626 }], [{ v: 4625 }], [{ h: 4625 }], [], {}], [1, "le-livre.fr", 1, "^https?://(www\\.)?le-livre\\.fr/", 22, [4627], [{ e: 4628 }], [{ v: 4627 }], [{ h: 4627 }], [{ check: "none", v: 4627 }], {}], [1, "leafly", 1, "^https://(www\\.)?leafly\\.com/", 22, [], [{ e: 4629 }], [{ v: 4629 }], [{ h: 4629 }], [], {}], [1, "leetchi", 2, "^https?://(www\\.)?leetchi\\.com/", 22, [], [{ e: 4630 }], [{ v: 4631 }], [{ c: 4631 }, { timeout: 3e3, check: "none", wv: 4631 }], [{ cc: 4632 }], {}], [1, "legislation-gov-uk", 2, "^https?://(\\w+\\.)?legislation\\.gov\\.uk/", 22, [4633], [{ e: 4634 }], [{ v: 4634 }], [{ c: 4634 }, { timeout: 3e3, optional: true, c: 4635 }], [{ cc: 4636 }], {}], [1, "lego", 2, "^https?://(www\\.)?lego\\.com/", 22, [4637], [{ any: [{ e: 4638 }, { e: 4639 }] }], [{ any: [{ v: 4638 }, { v: 4639 }] }], [{ any: [{ cc: 4640 }, { timeout: 3e3, wv: 4639 }], optional: true }, { check: "none", timeout: 12e4, wv: 4639 }, { c: 4638 }, { any: [{ cc: 4640 }, { timeout: 3e3, wv: 4639 }], optional: true }, { if: { v: 4639 }, then: [{ check: "none", timeout: 12e4, wv: 4639 }, { timeout: 5e3, c: 4638 }], optional: true }], [{ cc: 4641 }], {}], [1, "lendable", 2, "^https?://([\\w-]+\\.)?lendable\\.co\\.uk/", 22, [4642], [{ e: 4643 }], [{ v: 4642 }], [{ c: 4643 }, { any: [{ timeout: 2e3, wv: 4644 }, { k: 4643 }] }, { c: 4644 }, { check: "none", wv: 4642 }], [{ cc: 707 }], {}], [1, "lenta.ru", 0, "^https?://(\\w+\\.)?lenta\\.ru/", 22, [961], [{ e: 962 }], [{ v: 964 }], [{ c: 962 }], [{ cc: 965 }], {}], [1, "lessonup", 2, "^https?://(www\\.)?lessonup\\.com/", 22, [1602], [{ e: 4645 }], [{ v: 4646 }], [{ c: 4645 }, { wv: 4647 }, { if: { e: 4648 }, then: [{ all: true, k: 4648 }] }, { k: 4647 }], [{ check: "none", timeout: 3e3, wv: 1602 }, { cc: 4649 }], {}], [1, "lethpolytech", 2, "^https?://(www\\.)?lethpolytech\\.ca/", 10, [], [{ e: 4650 }], [{ v: 4650 }], [{ wv: 4650 }, { eval: "EVAL_LETHPOLYTECH_DECLINE" }, { check: "none", timeout: 3e3, wv: 3789 }], [{ cc: 4651 }], {}], [1, "leukhuis-nl", 1, "^https?://(www\\.)?leukhuis\\.nl/", 22, [3108], [{ e: 4652 }], [{ v: 3108 }], [{ h: 3108 }], [{ check: "none", v: 3108 }], {}], [1, "lexbase.se", 1, "^https?://(www\\.)?lexbase\\.se/", 22, [4653], [{ e: 4654 }], [{ v: 4653 }], [{ h: 4653 }], [{ check: "none", v: 4653 }], {}], [1, "lezenvoordelijst.nl", 0, "^https?://(www\\.)?lezenvoordelijst\\.nl/", 10, [4655, 4656], [{ e: 4657 }], [{ v: 4658 }], [{ c: 4659 }], [{ cc: 4660 }], {}], [1, "libris.nl", 2, "^https?://(www\\.)?libris\\.nl/", 22, [4661], [{ e: 4662 }], [{ v: 4662 }], [{ if: { e: 4663 }, then: [{ all: true, k: 4663 }] }, { c: 4662 }], [{ cc: 4664 }], {}], [1, "librus", 2, "^https?://([a-z0-9-]+\\.)?librus\\.pl/", 22, [4665], [{ e: 4666 }], [{ v: 4666 }], [{ c: 4666 }, { w: 4667 }, { if: { e: 4668 }, then: [{ all: true, k: 4668 }] }, { c: 4669 }], [{ check: "none", timeout: 2e3, wv: 4670 }], {}], [1, "lieder.net", 2, "^https?://(www\\.)?lieder\\.net/", 22, [4671], [{ e: 4672 }], [{ v: 4673 }], [{ c: 4672 }], [{ cc: 4674 }], {}], [1, "ligonier", 2, "^https?://(\\w+\\.)?ligonier\\.org/", 22, [4675], [{ e: 4676 }], [{ v: 4676 }], [{ c: 4677 }], [{ cc: 4678 }], {}], [1, "livejasmin", 2, "^https?://(www\\.|m\\.)?livejasmin\\.com/", 10, [], [{ e: 4679 }], [{ check: "any", v: 4680 }], [{ if: { e: 4681 }, then: [{ retry: 10, retryInterval: 1e3, c: 4681 }, { wv: 4682 }, { all: true, optional: true, k: 4683 }, { c: 4684 }], else: [{ retry: 10, retryInterval: 1e3, c: 4685 }, { timeout: 1e4, wv: 4686 }, { all: true, optional: true, k: 4687 }, { c: 4686 }] }], [{ timeout: 2e3, check: "none", wv: 4688 }], {}], [1, "livelo", 2, "^https?://(www\\.)?livelo\\.com\\.br/", 22, [4689], [{ e: 4690 }], [{ v: 4690 }], [{ c: 4690 }, { wv: 4691 }, { all: true, optional: true, k: 4692 }, { c: 4693 }], [{ cc: 4694 }], {}], [1, "livsmedelsverket", 2, "^https?://(\\w+\\.)?livsmedelsverket\\.se/", 22, [52], [{ e: 4695 }], [{ v: 4696 }], [{ c: 4695 }, { wv: 4697 }, { all: true, optional: true, k: 4698 }, { k: 4699 }], [{ cc: 4700 }], {}], [1, "lobbes", 2, "^https?://(www\\.)?(lobbes\\.nl|lobbesspielzeug\\.de|lobbesjouet\\.fr)/", 22, [4701], [{ e: 4702 }], [{ v: 4703 }], [{ c: 4702 }, { wv: 4704 }, { all: true, optional: true, k: 4705 }, { c: 4706 }], [{ cc: 2120 }, { cc: 4617 }], {}], [1, "loescher", 2, "^https?://([a-z0-9-]+\\.)?loescher\\.it/", 22, [], [{ e: 4707 }], [{ v: 4707 }], [{ c: 4708 }, { wv: 4709 }, { all: true, optional: true, k: 4710 }, { k: 4711 }], [{ cc: 4712 }], {}], [1, "lucozade.com", 2, "^https://(www\\.)?lucozade\\.com/", 22, [4054, 4713], [{ e: 4054 }], [{ v: 4054 }], [{ c: 4714 }], [{ cc: 4715 }], {}], [1, "lucrin", 2, "^https?://(www\\.)?lucrin\\.(com|com\\.au|co\\.uk|ca|ch|de|es|fr|it)/", 22, [4716, 4717], [{ e: 4718 }], [{ v: 438 }], [{ c: 4718 }, { wv: 4719 }, { all: true, optional: true, k: 4720 }, { c: 4719 }], [{ cc: 4721 }], {}], [1, "luxmed", 2, "^https?://([a-z0-9-]+\\.)?luxmed\\.pl/", 22, [], [{ e: 4722 }], [{ v: 4722 }], [{ c: 4723 }], [{ cc: 4724 }], {}], [1, "maariv.co.il", 2, "^https?://(www\\.)?maariv\\.co\\.il/", 22, [4725], [{ e: 4726 }], [{ v: 4726 }], [{ c: 4726 }, { timeout: 4e3, optional: true, w: 1424 }, { if: { e: 1424 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ cc: 4727 }], {}], [1, "mackeeper", 0, "^https?://(\\w+\\.)?mackeeper\\.com/", 22, [4728], [{ e: 4729 }], [{ v: 4729 }], [{ c: 4730 }], [{ cc: 4731 }], {}], [1, "madeiramadeira", 1, "^https?://(\\w+\\.)?madeiramadeira\\.com\\.br/", 22, [4732], [{ e: 4733 }], [{ v: 4733 }], [{ h: 4732 }], [], {}], [1, "mainichi", 2, "^https?://(\\w+\\.)?mainichi\\.jp/", 22, [], [{ e: 4734 }, { negated: true, e: 1395 }], [{ v: 4734 }], [{ c: 4735 }], [{ check: "none", timeout: 2e3, wv: 4736 }], {}], [1, "mainlinemenswear", 2, "^https://(www\\.)?mainlinemenswear\\.co\\.uk/", 22, [4737], [{ e: 4738 }], [{ v: 4738 }], [{ c: 4739 }, { wv: 4740 }, { all: true, optional: true, k: 4741 }, { c: 4742 }], [], {}], [1, "makemytrip", 2, "^https://(www\\.)?makemytrip\\.(com|global)/", 22, [4743], [{ e: 4744 }], [{ v: 4743 }], [{ c: 4744 }, { wv: 4745 }, { if: { e: 4746 }, then: [{ all: true, k: 4747 }] }, { k: 4745 }, { check: "none", timeout: 3e3, optional: true, wv: 4748 }], [{ cc: 4749 }], {}], [1, "makitatools", 2, "^https://(www\\.)?makitatools\\.com/", 22, [4750], [{ e: 4750 }], [{ v: 4750 }], [{ c: 4751 }, { c: 4752 }, { check: "none", wv: 4750 }], [{ check: "none", v: 4750 }], {}], [1, "malaysiaairlines.com", 0, "^https?://(\\w+\\.)?malaysiaairlines\\.com/", 22, [], [{ e: 4753 }], [{ v: 4753 }], [{ c: 4754 }, { wv: 4755 }, { all: true, optional: true, k: 4756 }, { c: 4757 }], [], {}], [1, "mango", 2, "^https://(shop\\.mango|www\\.mangooutlet)\\.com/", 22, [4557], [{ e: 4758 }], [{ v: 4758 }], [{ if: { e: 4759 }, then: [{ retry: 5, retryInterval: 500, c: 4759 }], else: [{ retry: 5, retryInterval: 500, c: 4760 }, { retry: 5, retryInterval: 500, c: 4761 }] }], [{ cc: 4762 }], {}], [1, "maree-info", 2, "^https?://(www\\.)?maree\\.info/", 22, [4763], [{ e: 4764 }], [{ v: 4764 }], [{ c: 4765 }, { check: "none", timeout: 3e3, optional: true, wv: 4764 }], [{ cc: 4766 }], {}], [1, "massaggiamilano", 2, "^https?://(www\\.)?massagg(iamilano|iemozionali)\\.it/", 22, [4767], [{ e: 4768 }], [{ v: 4768 }], [{ c: 4768 }, { c: 4769 }], [{ check: "none", timeout: 5e3, wv: 4770 }], {}], [1, "massgeneralbrigham", 0, "^https?://(\\w+\\.)?massgeneralbrigham\\.org/", 22, [4771], [{ e: 4772 }], [{ v: 4772 }], [{ c: 4772 }], [{ negated: true, e: 4771 }], {}], [1, "matemaks", 1, "^https?://(www\\.)?matemaks\\.pl/", 22, [4773], [{ e: 4774 }], [{ v: 4773 }], [{ h: 4773 }], [], {}], [1, "maticrobots-com", 2, "^https?://(\\w+\\.)?maticrobots\\.com/", 22, [4775], [{ e: 4775 }], [{ v: 4775 }], [{ c: 4776 }, { wv: 4777 }, { c: 4778 }, { c: 4779 }], [], {}], [1, "matspar-se", 2, "^https?://(www\\.)?matspar\\.se/", 22, [4780], [{ e: 4781 }], [{ v: 4781 }], [{ c: 4782 }, { w: 4783 }, { if: { e: 4784 }, then: [{ k: 4783 }] }, { k: 4785 }], [{ check: "none", timeout: 5e3, wv: 4781 }], {}], [1, "mblock", 1, "^https?://ide\\.mblock\\.cc/", 22, [4786], [{ e: 4787 }], [{ v: 4786 }], [{ h: 4786 }], [], {}], [1, "mccoysguide", 2, "^https?://(www\\.)?mccoysguide\\.com/", 22, [4788], [{ e: 4789 }], [{ v: 4789 }], [{ all: true, optional: true, k: 4790 }, { c: 4789 }], [{ check: "none", timeout: 2e3, wv: 4791 }], {}], [1, "medium", 1, "^https://([a-z0-9-]+\\.)?medium\\.com/", 10, [], [{ e: 4792 }], [{ v: 4792 }], [{ h: 4792 }], [], {}], [1, "meduza", 0, "^https?://(\\w+\\.)?meduza\\.io/", 10, [4793], [{ e: 4794 }], [{ v: 4794 }], [{ c: 4794 }], [{ check: "none", timeout: 2e3, wv: 4793 }], {}], [1, "mega.io", 2, "^https?://(\\w+\\.)?mega\\.(io|nz)/", 22, [4795], [{ e: 4796 }], [{ v: 4795 }], [{ if: { v: 4797 }, then: [{ k: 4797 }], else: [{ k: 4796 }, { wv: 4798 }, { all: true, optional: true, k: 4799 }, { k: 4798 }] }], [{ cc: 4212 }], {}], [1, "menti.com", 2, "^https?://(www\\.)?menti\\.com/", 22, [4800], [{ e: 4801 }], [{ v: 4801 }], [{ retry: 10, retryInterval: 500, c: 4802 }], [{ cc: 4803 }], {}], [1, "meowdb.com", 2, "^https?://(\\w+\\.)?meowdb\\.com/", 22, [4804, 724], [{ e: 4805 }], [{ v: 4804 }], [{ c: 4805 }, { timeout: 3e3, optional: true, w: 725 }, { if: { e: 725 }, then: [{ wait: 500 }, { eval: "EVAL_CONSENTMANAGER_NCMP_REJECT" }] }], [{ cc: 4806 }], {}], [1, "mercadolibre-subdomain", 0, "^https://(?!www\\.)[\\w-]+\\.mercado(libre|livre|pago)\\.[a-z.]+/", 22, [1936], [{ e: 1936 }], [{ v: 1936 }], [{ timeout: 15e3, w: 4807 }, { retry: 2, retryInterval: 1e3, c: 1937 }, { w: 4808 }, { check: "none", timeout: 15e3, wv: 1939 }], [{ cc: 1940 }, { cc: 1941 }], {}], [1, "merito.pl", 2, "^https?://(\\w+\\.)?merito\\.pl/", 22, [], [{ e: 4809 }], [{ v: 4810 }], [{ c: 4811 }, { wv: 4812 }, { all: true, optional: true, k: 4813 }, { k: 4814 }], [{ cc: 4039 }], {}], [1, "meta-cookie-dialog-v2", 2, "^https?://(\\w+\\.)?meta\\.com/", 22, [], [{ e: 4815 }], [{ v: 4815 }], [{ retry: 20, retryInterval: 500, c: 4815 }, { check: "none", wv: 4815 }], [], {}], [1, "meteocat", 2, "^https?://(\\w+\\.)?meteo\\.cat/", 22, [4816], [{ e: 4817 }], [{ v: 4816 }], [{ c: 4817 }], [{ cc: 4818 }], {}], [1, "midasbuy", 2, "^https://(www\\.)?midasbuy\\.com/", 22, [4819], [{ e: 4820 }], [{ v: 4820 }], [{ c: 4820 }], [{ cc: 4821 }, { cc: 4822 }], {}], [1, "midway-usa", 1, "^https://www\\.midwayusa\\.com/", 22, [4823], [{ e: 4823 }], [{ v: 4823 }], [{ h: 4823 }], [], {}], [1, "miles-and-more", 2, "^https://(www\\.)?miles-and-more\\.com/", 22, [4824], [{ e: 4825 }], [{ v: 4826 }], [{ wait: 500 }, { c: 4826 }], [{ cc: 4827 }], {}], [1, "mipro.com.tw", 2, "^https?://(\\w+\\.)?mipro\\.com\\.tw/", 22, [4828], [{ e: 4829 }], [{ v: 4830 }], [{ c: 4830 }], [{ negated: true, e: 4828 }], {}], [1, "misli", 2, "^https?://(www\\.)?misli\\.az/", 22, [], [{ e: 4831 }], [{ v: 4832 }], [{ c: 4833 }], [{ check: "none", timeout: 2e3, wv: 4832 }], {}], [1, "mitelcel", 1, "^https?://(www\\.)?mitelcel\\.com/", 22, [1094, 4834], [{ e: 4835 }], [{ v: 1094 }], [{ h: 4836 }], [{ check: "none", v: 1094 }], {}], [1, "mites.gob.es", 2, "^https?://(\\w+\\.)?mites\\.gob\\.es/", 22, [4837, 3986], [{ e: 4838 }], [{ v: 4838 }], [{ c: 4838 }, { wv: 4839 }, { all: true, optional: true, k: 4840 }, { k: 4839 }], [{ cc: 4841 }, { negated: true, cc: 4842 }], {}], [1, "mitrejsevejr.dk", 2, "^https?://(www\\.)?mitrejsevejr\\.dk/", 22, [4843], [{ e: 4844 }], [{ v: 745 }], [{ c: 4844 }], [{ cc: 4845 }], {}], [1, "mizuno.com", 2, "^https?://(\\w+\\.)?mizuno\\.com/", 22, [146], [{ e: 4846 }], [{ v: 146 }], [{ c: 4846 }], [{ cc: 4847 }], {}], [1, "mobile.de", 2, "^https?://([a-z0-9-]+\\.)?mobile\\.de/", 22, [4848], [{ e: 4848 }], [{ v: 4849 }], [{ retry: 3, retryInterval: 500, c: 4850 }], [{ wait: 500 }, { cc: 4851 }], {}], [1, "modelsociety", 2, "^https?://(www\\.)?modelsociety\\.com/", 22, [4852], [{ e: 4852 }], [{ v: 4852 }], [{ c: 4853 }, { timeout: 3e3, optional: true, c: 4854 }], [{ check: "none", timeout: 2e3, wv: 4852 }], {}], [1, "monex-co-jp", 2, "^https?://(\\w+\\.)?monex\\.co\\.jp/", 22, [4855], [{ e: 4856 }], [{ v: 4855 }], [{ c: 4856 }], [{ check: "none", v: 4855 }], {}], [1, "money.co.uk", 2, "^https?://(www\\.)?money\\.co\\.uk/", 10, [4857], [{ e: 4858 }], [{ v: 4858 }], [{ all: true, optional: true, k: 4859 }, { c: 4858 }], [{ cc: 4212 }], {}], [1, "moneybird", 2, "^https?://(\\w+\\.)?moneybird\\.(nl|com|de|be)/", 22, [], [{ exists: ["mb-cookie-modal-component", "#mb-cookie-modal"] }], [{ visible: ["mb-cookie-modal-component", "#mb-cookie-modal[open]"] }], [{ waitForThenClick: ["mb-cookie-modal-component", "#show-preferences"] }, { waitForVisible: ["mb-cookie-modal-component", "#preferences-view"] }, { if: { exists: ["mb-cookie-modal-component", "#check-analytical:checked"] }, then: [{ click: ["mb-cookie-modal-component", "#check-analytical"] }] }, { if: { exists: ["mb-cookie-modal-component", "#check-thirdparty:checked"] }, then: [{ click: ["mb-cookie-modal-component", "#check-thirdparty"] }] }, { waitForThenClick: ["mb-cookie-modal-component", "#save-preferences"] }], [{ cc: 4860 }, { cc: 4861 }], {}], [1, "moneywise", 2, "^https?://(\\w+\\.)?moneywise\\.nl/", 22, [4862], [{ e: 4863 }], [{ v: 4864 }], [{ if: { e: 4865 }, then: [{ c: 4865 }], else: [{ c: 4866 }, { wv: 4867 }, { all: true, optional: true, k: 4868 }, { c: 4869 }] }], [{ cc: 4870 }], {}], [1, "morgenlevering.no", 0, "^https?://(www\\.)?morgenlevering\\.no/", 22, [4871], [{ e: 4872 }], [{ v: 4872 }], [{ c: 4873 }, { timeout: 2e3, wv: 4874 }, { all: true, optional: true, k: 4875 }, { c: 4876 }], [{ cc: 4877 }], {}], [1, "mos-cudzoziemcy-gov-pl", 1, "^https?://mos\\.cudzoziemcy\\.gov\\.pl/", 22, [4878], [{ e: 4879 }], [{ v: 4879 }], [{ h: 4878 }], [], {}], [1, "mq.edu.au", 2, "^https?://(\\w+\\.)?mq\\.edu\\.au/", 10, [4880], [{ exists: ["mq-alert-cookies", ".alert"] }], [{ visible: ["mq-alert-cookies", ".alert"], check: "any" }], [{ if: { exists: ["mq-alert-cookies[variant=tiktok]", ".alert .button.secondary"] }, then: [{ waitForThenClick: ["mq-alert-cookies[variant=tiktok]", ".alert .button.secondary"] }], else: [{ waitForThenClick: ["mq-alert-cookies[variant=cookies]", ".alert .button-container button"] }] }], [{ waitForVisible: ["mq-alert-cookies", ".alert"], check: "none", timeout: 2e3 }], {}], [1, "mrchadd", 2, "^https?://(www\\.)?mrchadd\\.nl/", 22, [], [{ e: 4881 }], [{ v: 4881 }], [{ c: 4882 }, { wv: 4883 }, { all: true, optional: true, k: 4884 }, { c: 4885 }], [{ check: "none", v: 4881 }], {}], [1, "msn", 0, "^https?://(www\\.)?msn\\.com/", 10, [4886, 4887], [{ e: 4886 }], [{ v: 4886 }], [{ c: 4888 }], [{ cc: 2906 }], {}], [1, "multicalcolo", 2, "^https?://(www\\.)?multicalcolo\\.it/", 22, [4889], [{ e: 4890 }], [{ v: 4890 }], [{ k: 4891 }, { check: "none", wv: 4889 }], [{ cc: 4892 }], {}], [1, "myfooddiary", 0, "^https?://(\\w+\\.)?myfooddiary\\.com/", 22, [3433], [{ e: 4893 }], [{ v: 4893 }], [{ c: 4893 }], [{ check: "none", timeout: 1e3, wv: 3433 }], {}], [1, "myhora.com", 2, "^https?://(\\w+\\.)?myhora\\.com/", 22, [], [{ v: 4894 }, { check: "none", v: 1396 }], [{ v: 4894 }], [{ c: 4894 }], [{ check: "none", timeout: 2e3, wv: 4895 }], {}], [1, "myjobquote", 2, "^https?://(www\\.)?myjobquote\\.co\\.uk/", 22, [4896], [{ e: 4897 }], [{ v: 4897 }], [{ c: 4898 }, { wv: 4899 }, { all: true, optional: true, k: 4900 }, { k: 4899 }], [], {}], [1, "mypharmacy.co.uk", 2, "^https?://(www\\.)?mypharmacy\\.co\\.uk/", 22, [], [{ e: 4901 }], [{ v: 4902 }], [{ c: 4903 }, { c: 4904 }], [{ cc: 4905 }], {}], [1, "nationwidevehiclecontracts", 2, "^https?://(www\\.)?nationwidevehiclecontracts\\.co\\.uk/", 22, [3801], [{ e: 4906 }], [{ v: 4906 }], [{ c: 4907 }, { timeout: 5e3, c: 4908 }], [{ cc: 4909 }], {}], [1, "nba.com", 1, "^https://(www\\.)?nba\\.com/", 22, [2231], [{ e: 2231 }], [{ v: 2231 }], [{ h: 2231 }], [], {}], [1, "ndl-go-jp", 2, "^https://([a-z0-9-]+\\.)?ndl\\.go\\.jp/", 22, [4910], [{ e: 4911 }], [{ v: 4911 }], [{ c: 4912 }], [{ timeout: 2e3, check: "none", wv: 4911 }], {}], [1, "nederlandseloterij", 2, "^https?://([a-z0-9-]+\\.)?nederlandseloterij\\.nl/", 22, [4913, 4914], [{ e: 4915 }], [{ v: 4915 }], [{ c: 4916 }], [{ timeout: 2e3, check: "none", wv: 4917 }], {}], [1, "nelf-gov-ng", 2, "^https://(\\w+\\.)?nelf\\.gov\\.ng/", 22, [4918], [{ e: 4919 }], [{ v: 4919 }], [{ c: 4919 }, { wv: 4920 }, { c: 4921 }], [{ cc: 4922 }], {}], [1, "nestpensions", 0, "^https?://(www\\.)?nestpensions\\.org\\.uk/", 22, [4923], [{ e: 4924 }], [{ v: 4923 }], [{ c: 4924 }], [{ cc: 4925 }], {}], [1, "netbeat.de", 2, "^https://(www\\.)?netbeat\\.de/", 22, [4926], [{ e: 4926 }], [{ v: 4926 }], [{ c: 4927 }], [], {}], [1, "netwerknotarissen", 2, "^https?://(\\w+\\.)?netwerknotarissen\\.nl/", 22, [52], [{ e: 4928 }], [{ v: 52 }], [{ c: 4928 }, { wv: 4929 }, { all: true, optional: true, k: 4930 }, { k: 4929 }, { check: "none", wv: 4077 }], [{ cc: 4931 }, { negated: true, cc: 4932 }, { negated: true, cc: 4933 }], {}], [1, "newsbreak", 0, "^https?://(www\\.)?newsbreak\\.com/", 10, [], [{ e: 4934 }], [{ v: 4934 }], [{ c: 4934 }], [{ check: "none", timeout: 2e3, wv: 4934 }], {}], [1, "newyorker-de", 2, "^https?://(www\\.)?newyorker\\.de/", 22, [], [{ e: 4935 }], [{ visible: ["cookie-banner", ".cookie-banner .cookie-banner-controls"] }], [{ waitForThenClick: ["cookie-banner", ".cookie-banner-controls > button:nth-child(2)"] }], [{ waitForVisible: ["cookie-banner", ".cookie-banner"], timeout: 1e3, check: "none" }], {}], [1, "nfl", 2, "^https?://(\\w+\\.)?(nfl|49ers|atlantafalcons|azcardinals|baltimoreravens|bengals|buccaneers|buffalobills|chargers|chicagobears|chiefs|clevelandbrowns|colts|commanders|dallascowboys|denverbroncos|detroitlions|giants|houstontexans|jaguars|miamidolphins|neworleanssaints|newyorkjets|packers|panthers|patriots|philadelphiaeagles|raiders|seahawks|steelers|tennesseetitans|therams|vikings)\\.com/", 22, [2231], [{ e: 4936 }], [{ v: 2231 }], [{ timeout: 5e3, wv: 4937 }, { any: [{ eval: "EVAL_NFL_ONETRUST_REJECT_ALL" }, { timeout: 5e3, check: "none", wv: 2231 }, { k: 4937 }] }, { timeout: 5e3, check: "none", wv: 2231 }], [{ eval: "EVAL_ONETRUST_1" }], {}], [1, "nhm.ac.uk", 1, "^https?://(\\w+\\.)?nhm\\.ac\\.uk/", 22, [4938, 4939], [{ e: 4938 }], [{ v: 4938 }], [{ h: 4940 }], [], {}], [1, "nhnieuws", 2, "^https://(www\\.)?nhnieuws\\.nl/", 22, [4941], [{ e: 4942 }], [{ check: "any", v: 4942 }], [{ c: 4943 }], [{ eval: "EVAL_NHNIEUWS_TEST" }], {}], [1, "nhs-jobs", 2, "^https?://(\\w+\\.)?jobs\\.nhs\\.uk/", 22, [52], [{ e: 4944 }], [{ v: 4944 }], [{ c: 4944 }], [], {}], [1, "nhsapp", 2, "^https?://(\\w+\\.)?nhsapp\\.service\\.nhs\\.uk/", 22, [4945], [{ e: 4946 }], [{ v: 4947 }], [{ c: 4946 }], [{ timeout: 1e3, check: "none", wv: 4947 }], {}], [1, "niedziela-pl", 1, "^https?://([\\w-]+\\.)?niedziela\\.pl/", 22, [4948], [{ e: 4949 }], [{ v: 4949 }], [{ h: 4948 }], [{ check: "none", v: 4949 }], {}], [1, "nocturnhq", 2, "^https?://(www\\.)?nocturnhq\\.com/", 22, [], [{ e: 4950 }], [{ v: 4951 }], [{ c: 4951 }], [{ check: "none", timeout: 2e3, wv: 4950 }], {}], [1, "noon", 2, "^https?://(www\\.)?noon\\.com/", 22, [4952], [{ e: 4952 }], [{ v: 4952 }], [{ c: 4953 }, { wv: 4954 }, { all: true, optional: true, k: 4955 }, { c: 4956 }], [], {}], [1, "noord-holland.nl", 2, "^https?://(\\w+\\.)?noord-holland\\.nl/", 22, [845], [{ e: 4957 }], [{ v: 845 }], [{ if: { e: 4958 }, then: [{ all: true, optional: true, k: 4959 }, { c: 4960 }], else: [{ c: 4961 }] }], [], {}], [1, "nordea", 2, "^https?://([a-z0-9-]+\\.)?nordea\\.(se|fi|no|dk)/", 22, [], [{ e: 4962 }], [{ v: 950 }], [{ all: true, optional: true, k: 4963 }, { c: 4964 }], [{ cc: 4965 }], {}], [1, "nordnet", 2, "^https?://(www\\.)?nordnet\\.(dk|se|no|fi)/", 22, [], [{ e: 4966 }], [{ v: 4966 }], [{ c: 4967 }], [{ cc: 4968 }], {}], [1, "northwell.edu", 1, "^https?://(\\w+\\.)?northwell\\.edu/", 22, [4969], [{ exists: ["nwhlit-gdpr-banner", ".nwhlit-gdpr-banner"] }], [{ visible: ["nwhlit-gdpr-banner", ".nwhlit-gdpr-banner"] }], [{ h: 4969 }], [], {}], [1, "nos.nl", 1, "^https://nos\\.nl/", 22, [2080], [{ e: 2080 }], [{ visible: ["ccm-notification"] }], [{ h: 2080 }], [], {}], [1, "noticiasdatv", 1, "^https?://(\\w+\\.)?noticiasdatv\\.uol\\.com\\.br/", 22, [4970], [{ e: 4971 }], [{ v: 4970 }, { negated: true, cc: 3925 }], [{ h: 4970 }], [], {}], [1, "nperf", 2, "^https?://(\\w+\\.)?nperf\\.com/", 22, [], [{ e: 4972 }], [{ v: 4972 }], [{ c: 4972 }], [{ cc: 4973 }], {}], [1, "nts-org-uk", 2, "^https?://(\\w+\\.)?nts\\.org\\.uk/", 22, [4974], [{ e: 4975 }], [{ v: 4976 }], [{ c: 4977 }, { timeout: 2e3, wv: 4975 }, { if: { e: 4978 }, then: [{ all: true, k: 4978 }] }, { k: 4975 }], [{ cc: 4979 }], {}], [1, "ntvspor.net", 2, "^https?://(\\w+\\.)?ntvspor\\.net/", 22, [4980], [{ v: 4981 }], [{ v: 4981 }], [{ c: 4981 }, { timeout: 5e3, optional: true, w: 1424 }, { if: { e: 1424 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }], else: [{ e: 1398 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ cc: 4982 }], {}], [1, "nutri.se", 0, "^https?://(www\\.)?nutri\\.se/", 22, [4983], [{ e: 4984 }], [{ v: 4984 }], [{ c: 4985 }, { c: 4986 }], [{ cc: 4987 }, { cc: 707 }], {}], [1, "octoparse", 2, "^https?://(\\w+\\.)?octoparse\\.(com|jp|de|fr|es|ai)/", 22, [4988], [{ e: 4989 }], [{ v: 4989 }], [{ c: 4989 }, { check: "none", timeout: 2e3, wv: 4988 }], [], {}], [1, "octopusenergy-it", 2, "^https?://(www\\.)?octopusenergy\\.it/", 22, [], [{ e: 4990 }], [{ v: 4990 }], [{ c: 4990 }, { w: 4991 }, { if: { e: 4992 }, then: [{ k: 4991 }] }, { if: { e: 4993 }, then: [{ k: 4994 }] }, { c: 4995 }], [{ cc: 4996 }], {}], [1, "odia.ig.com.br", 2, "^https?://odia\\.ig\\.com\\.br/", 22, [4997], [{ e: 4998 }], [{ v: 4997 }], [{ c: 4998 }], [{ cc: 4999 }], {}], [1, "oechsle", 2, "^https?://(www\\.)?oechsle\\.pe/", 22, [52, 5e3], [{ e: 5001 }], [{ v: 52 }], [{ c: 5001 }, { c: 5002 }], [{ cc: 4617 }], {}], [1, "ofsted-reports-cosmetic", 1, "^https?://reports\\.ofsted\\.gov\\.uk/", 22, [5003], [{ e: 5004 }], [{ v: 5004 }], [{ h: 5003 }], [{ check: "none", v: 5004 }], {}], [1, "ok", 0, "^https://(\\w+\\.)?ok\\.ru/", 22, [5005], [{ e: 5006 }], [{ v: 5006 }], [{ retry: 6, retryInterval: 1e3, c: 5007 }, { wv: 5008 }, { wait: 500 }, { all: true, optional: true, k: 5009 }, { c: 5010 }], [], {}], [1, "okayama-kanko-jp", 2, "^https?://(www\\.)?okayama-kanko\\.jp/", 22, [3439], [{ e: 5011 }], [{ v: 3439 }], [{ c: 5011 }, { check: "none", wv: 3439 }], [], {}], [1, "oko-press", 2, "^https?://(www\\.)?oko\\.press/", 22, [5012], [{ e: 5013 }], [{ v: 5012 }], [{ c: 5014 }, { wv: 5015 }, { if: { e: 5016 }, then: [{ k: 5015 }] }, { c: 5017 }], [{ check: "none", timeout: 2e3, wv: 5012 }, { cc: 5018 }], {}], [1, "olvg", 2, "^https?://(www\\.)?olvg\\.nl/", 22, [5019], [{ e: 5020 }], [{ v: 5021 }], [{ c: 5020 }, { c: 5022 }, { check: "none", timeout: 2e3, optional: true, wv: 5019 }], [{ cc: 5023 }], {}], [1, "ometv.pl", 2, "^https?://(\\w+\\.)?ometv\\.pl/", 22, [], [{ e: 5024 }], [{ v: 5025 }], [{ c: 5024 }], [{ check: "none", v: 5025 }], {}], [1, "omroepflevoland", 2, "^https?://(www\\.)?omroepflevoland\\.nl/", 22, [], [{ e: 5026 }], [{ check: "any", v: 5026 }], [{ if: { v: 5027 }, then: [{ k: 5028 }, { k: 5029 }, { if: { v: 5030 }, then: [{ k: 5030 }] }] }, { if: { v: 5031 }, then: [{ k: 5032 }] }], [{ check: "none", timeout: 2e3, wv: 5026 }], {}], [1, "onecall-no", 0, "^https?://(www\\.)?onecall\\.no/", 22, [5033], [{ e: 5034 }], [{ v: 5033 }], [{ if: { e: 5035 }, then: [{ k: 5034 }] }, { c: 5036 }], [{ cc: 5037 }], {}], [1, "onlineradiobox", 1, "^https?://(\\w+\\.)?onlineradiobox\\.com/", 22, [5038], [{ e: 5039 }], [{ v: 5038 }], [{ h: 5038 }], [{ check: "none", v: 5038 }], {}], [1, "onlyFans.com", 2, "^https://onlyfans\\.com/", 22, [5040], [{ e: 5040 }], [{ e: 5040 }], [{ k: 5041 }, { if: { e: 5042 }, then: [{ all: true, k: 5043 }, { k: 5044 }] }], [], {}], [1, "opalcollection-com", 1, "^https://(www\\.)?opalcollection\\.com/", 22, [5045], [{ v: 5046 }], [{ v: 5045 }], [{ h: 5045 }], [], {}], [1, "openai", 0, "^https://([a-z0-9-]+\\.)?openai\\.com/", 22, [5047], [{ e: 5047 }], [{ v: 5047 }], [{ c: 5048 }], [{ wait: 500 }, { cc: 5049 }], {}], [1, "opera.com", 0, "^https?://(www\\.|)?opera\\.com/", 22, [658], [{ e: 5050 }], [{ v: 5050 }], [{ all: true, timeout: 500, optional: true, c: 5051 }, { c: 5052 }], [{ cc: 5053 }, { negated: true, cc: 5054 }], {}], [1, "optum", 2, "^https?://(\\w+\\.)?optum\\.com/", 22, [5055], [{ e: 5056 }], [{ v: 5056 }], [{ c: 5056 }], [{ check: "none", timeout: 2e3, wv: 5055 }], {}], [1, "optyczne-pl", 1, "^https?://(\\w+\\.)?optyczne\\.pl/", 22, [5057], [{ e: 5058 }], [{ v: 5057 }], [{ h: 5057 }], [], {}], [1, "orbys", 1, "^https?://(\\w+\\.)?orbys\\.eu/", 22, [5059], [{ e: 5060 }], [{ v: 5059 }], [{ h: 5059 }], [{ check: "none", v: 5059 }], {}], [1, "oresundstag", 2, "^https?://(www\\.)?oresundstag\\.se/", 22, [5061], [{ e: 5062 }], [{ v: 5063 }], [{ all: true, optional: true, k: 5064 }, { c: 5065 }], [{ cc: 2915 }], {}], [1, "orthinform.de", 2, "^https?://(\\w+\\.)?orthinform\\.de/", 22, [2379], [{ e: 5066 }], [{ v: 2379 }], [{ c: 5066 }, { check: "none", wv: 2379 }], [{ check: "none", v: 2379 }], {}], [1, "osf.io", 1, "^https?://(\\w+\\.)?osf\\.io/", 22, [5067], [{ e: 5068 }], [{ v: 5068 }], [{ h: 5067 }], [], {}], [1, "oslosportslager.no", 0, "^https?://(www\\.)?oslosportslager\\.no/", 22, [5069], [{ e: 5070 }], [{ v: 5069 }], [{ c: 5070 }], [{ cc: 5071 }], {}], [1, "ourworldindata", 2, "^https://ourworldindata\\.org/", 22, [5072], [{ e: 5072 }], [{ v: 5073 }], [{ c: 5074 }], [], {}], [1, "oventrop", 2, "^https?://(\\w+\\.)?oventrop\\.com/", 22, [5075], [{ e: 5075 }], [{ v: 5076 }], [{ all: true, optional: true, k: 5077 }, { c: 5078 }], [], {}], [1, "overdrive", 2, "^https?://[^/]+\\.overdrive\\.com/", 22, [5079], [{ e: 5080 }], [{ v: 5080 }], [{ if: { e: 5081 }, then: [{ all: true, optional: true, k: 5082 }, { c: 5083 }], else: [{ c: 5084 }] }], [{ cc: 5085 }], {}], [1, "pabcogypsum", 2, "^https?://(www\\.)?pabcogypsum\\.com/", 22, [5086], [{ e: 5087 }], [{ v: 5087 }], [{ wv: 5088 }, { all: true, optional: true, k: 5089 }, { c: 5088 }], [{ cc: 5090 }, { cc: 5091 }, { cc: 5092 }], {}], [1, "pakamera.pl", 2, "^https?://(\\w+\\.)?pakamera\\.pl/", 22, [5093], [{ e: 5093 }], [{ v: 5094 }], [{ c: 5095 }, { wv: 5096 }, { all: true, optional: true, k: 5097 }, { k: 5096 }], [{ check: "none", wv: 5094 }], {}], [1, "palace-company", 1, "^https://(www\\.)?(moonpalace|palaceresorts|leblancsparesorts|baglionihotels)\\.com/", 22, [658, 5098], [{ e: 5099 }], [{ v: 5099 }], [{ h: 5100 }], [], {}], [1, "pantip", 1, "^https?://(\\w+\\.)?pantip\\.com/", 22, [5101], [{ e: 5102 }], [{ v: 5101 }], [{ h: 5101 }], [{ check: "none", v: 5101 }], {}], [1, "paperlesspost", 2, "^https?://(www\\.)?paperlesspost\\.com/", 22, [5103], [{ e: 5103 }], [{ v: 5103 }], [{ if: { e: 5104 }, then: [{ c: 5105 }], else: [{ c: 5106 }] }], [{ any: [{ cc: 5107 }, { cc: 5108 }] }], {}], [1, "paychex", 1, "^https://(www\\.)?paychex\\.com/", 22, [5109], [{ e: 5109 }], [{ v: 5109 }], [{ h: 5109 }], [], {}], [1, "payfip", 1, "^https?://(www\\.)?payfip\\.gouv\\.fr/", 22, [5110], [{ e: 5111 }], [{ check: "any", v: 5110 }], [{ h: 5110 }], [{ check: "none", v: 5110 }], {}], [1, "pcloud", 2, "^https?://(\\w+\\.)?pcloud\\.com/", 22, [], [{ e: 5112 }], [{ v: 5112 }], [{ c: 5113 }, { wv: 5114 }, { all: true, optional: true, k: 5115 }, { k: 5116 }], [{ cc: 5117 }], {}], [1, "pcspecialist", 2, "^https?://(www\\.)?pcspecialist\\.[a-z.]+/", 22, [5118, 5119], [{ e: 5120 }], [{ v: 5119 }], [{ c: 5120 }], [{ cc: 5121 }], {}], [1, "peda.net", 2, "^https?://(\\w+\\.)?peda\\.net/", 22, [5122], [{ e: 5123 }], [{ v: 5122 }], [{ c: 5123 }], [{ timeout: 1e3, check: "none", wv: 5122 }], {}], [1, "pekao24", 2, "^https?://(www\\.)?pekao24\\.pl/", 22, [5124], [{ e: 5125 }], [{ v: 5125 }], [{ c: 5126 }], [{ cc: 5127 }], {}], [1, "pensionsmyndigheten", 2, "^https?://(\\w+\\.)?pensionsmyndigheten\\.se/", 22, [5128], [{ e: 5128 }], [{ v: 5128 }], [{ c: 5129 }], [{ cc: 5130 }], {}], [1, "peppes.no", 2, "^https?://(\\w+\\.)?peppes\\.no/", 22, [5131], [{ e: 5132 }], [{ v: 5132 }], [{ all: true, optional: true, k: 5133 }, { c: 5132 }, { check: "none", timeout: 2e3, wv: 5131 }], [], {}], [1, "peterchristian", 2, "^https?://(www\\.)?peterchristian\\.(co\\.uk|eu)/", 22, [5134], [{ e: 5134 }], [{ v: 5134 }], [{ c: 5135 }, { c: 5136 }], [{ cc: 5137 }], {}], [1, "pfron-gov-pl", 2, "^https?://(www\\.)?pfron\\.(gov|org)\\.pl/", 22, [4333], [{ e: 5138 }], [{ v: 5138 }], [{ retry: 3, retryInterval: 500, c: 5138 }], [{ cc: 5139 }], {}], [1, "pharmasave", 2, "^https?://(www\\.)?pharmasave\\.com/", 22, [1564], [{ e: 5140 }], [{ v: 5140 }], [{ retry: 10, retryInterval: 500, c: 5141 }, { check: "none", wv: 1564 }], [{ cc: 5142 }], {}], [1, "pinterest-business", 2, "^https://[a-z]*\\.pinterest\\.com/", 22, [5143], [{ e: 5143 }], [{ v: 5144 }], [{ c: 5145 }], [], {}], [1, "pitt-edu", 1, "^https?://(\\w+\\.)?pitt\\.edu/", 22, [5146], [{ e: 5146 }], [{ v: 5146 }], [{ h: 5146 }], [], {}], [1, "pizzapilgrims.co.uk", 2, "^https?://(www\\.)?pizzapilgrims\\.co\\.uk/", 10, [5147], [{ e: 5148 }], [{ v: 5149 }], [{ c: 5150 }, { wv: 5151 }, { all: true, optional: true, k: 5152 }, { k: 5153 }], [{ cc: 5154 }, { cc: 5155 }], {}], [1, "planteportalen.no", 2, "^https?://(www\\.)?planteportalen\\.no/", 22, [], [{ e: 5156 }], [{ v: 5157 }], [{ c: 5158 }], [{ cc: 5159 }], {}], [1, "playdoit.mx", 2, "^https?://(\\w+\\.)?playdoit\\.mx/", 22, [5160], [{ e: 5160 }], [{ v: 5160 }], [{ c: 5161 }], [{ cc: 5162 }], {}], [1, "plazavea", 2, "^https?://(www\\.)?plazavea\\.com\\.pe/", 22, [5163], [{ e: 5164 }], [{ v: 5164 }], [{ c: 5165 }, { c: 5166 }], [{ check: "none", timeout: 1e3, wv: 5163 }], {}], [1, "plex.tv", 2, "^https?://(\\w+\\.)?plex\\.tv/", 22, [5167, 5168, 5169], [{ any: [{ e: 5167 }, { e: 5170 }, { e: 5168 }, { e: 5169 }] }], [{ any: [{ v: 5167 }, { v: 5170 }, { v: 5168 }, { v: 5169 }] }], [{ if: { v: 5170 }, then: [{ c: 5171 }, { timeout: 5e3, optional: true, c: 5172 }], else: [{ if: { v: 5169 }, then: [{ c: 5173 }], else: [{ c: 5174 }] }] }], [{ cc: 5175 }], {}], [1, "plos", 0, "^https://([.a-zA-Z0-9-]+\\.)?plos\\.org/", 22, [658], [{ e: 5176 }], [{ v: 5176 }], [{ all: true, optional: true, k: 5177 }, { waitForThenClick: ["#cookie-consent", "xpath///button[contains(., 'Save Selected')]"] }], [{ cc: 5178 }], {}], [1, "pnb-bank", 1, "^https://([a-z0-9-]+\\.)?(pnb\\.bank\\.in|pcppnb\\.com)/", 22, [5179], [{ e: 5180 }], [{ v: 5179 }], [{ h: 5179 }], [], {}], [1, "podimo", 2, "^https?://(www\\.)?podimo\\.com/", 22, [], [{ e: 5181 }], [{ check: "any", v: 5181 }], [{ if: { v: 5182 }, then: [{ c: 5182 }], else: [{ c: 5183 }] }, { wv: 5184 }, { all: true, optional: true, k: 5185 }, { c: 5186 }], [{ cc: 5187 }, { negated: true, cc: 5188 }], {}], [1, "poki", 2, "^https?://(\\w+\\.)?poki\\.com/", 22, [5189], [{ e: 5190 }], [{ v: 5190 }], [{ c: 5190 }], [{ check: "none", timeout: 2e3, wv: 5191 }], {}], [1, "pornhub-compact-cookie-banner", 0, "^https://(\\w+\\.)?pornhub\\.(com|org)/", 22, [5192], [{ e: 5193 }], [{ v: 5193 }], [{ k: 5193 }], [], {}], [1, "pornhub.com", 0, "^https://(\\w+\\.)?pornhub\\.(com|org)/", 22, [5194], [{ e: 5195 }], [{ v: 5195 }], [{ if: { e: 5196 }, then: [{ c: 5196 }] }, { if: { e: 5197 }, then: [{ k: 5197 }], else: [{ c: 5198 }] }], [], {}], [1, "pornpics.de", 2, "^https?://(www\\.)?pornpics\\.(com|de)/", 22, [], [{ e: 5199 }], [{ v: 5199 }], [{ c: 5200 }], [{ cc: 5201 }], {}], [1, "posthog", 2, "^https?://(www\\.)?posthog\\.com/", 22, [], [{ e: 5202 }], [{ v: 5202 }], [{ c: 5203 }], [{ check: "none", timeout: 2e3, wv: 5202 }], {}], [1, "posthog.com", 2, "^https?://(www\\.)?posthog\\.com/", 22, [], [{ e: 5204 }], [{ v: 5204 }], [{ c: 5205 }, { check: "none", wv: 5204 }], [{ eval: "EVAL_POSTHOG_TEST" }], {}], [2, "postnl", 0, "^https://([a-z]*\\.)?postnl\\.nl/", 22, [5206], [{ e: 5206 }], [{ visible: ["pnl-cookie-wall-widget", ".pnl-cookie-wall"] }], [{ waitForThenClick: ["pnl-cookie-wall-widget", ".cookie-overview__footer button.stamp-button--variant-secondary:last-child"] }, { waitForVisible: ["pnl-cookie-wall-widget", ".pnl-cookie-wall"], check: "none", timeout: 3e3, optional: true }, { setStyle: "", selector: "body", optional: true }], [{ cc: 5207 }], {}], [1, "povr", 0, "^https://povr\\.com/", 22, [], [{ e: 5208 }], [{ v: 5208 }], [{ h: 5209 }, { if: { e: 5210 }, then: [{ w: 5211 }, { all: true, optional: true, k: 5212 }, { c: 5213 }, { eval: "EVAL_POVR_GOBACK" }], else: [{ c: 5214 }] }], [], {}], [1, "praca-pl", 2, "^https?://(www\\.)?praca\\.pl/", 22, [5215], [{ e: 5216 }], [{ v: 5216 }], [{ c: 5216 }, { wv: 5217 }, { k: 5216 }], [{ check: "none", wv: 5218 }], {}], [1, "praktikertjanst", 2, "^https?://(www\\.)?praktikertjanst\\.se/", 22, [5219], [{ e: 5220 }], [{ v: 5221 }], [{ all: true, optional: true, k: 5222 }, { c: 5221 }], [{ cc: 5223 }], {}], [1, "prestigeflowers", 2, "^https?://(www\\.)?prestigeflowers\\.co\\.uk/", 22, [5224], [{ e: 5225 }], [{ v: 5224 }], [{ if: { v: 5226 }, then: [], else: [{ c: 5227 }, { wv: 5226 }] }, { if: { e: 5228 }, then: [{ all: true, k: 5228 }] }, { k: 5226 }], [{ cc: 5229 }], {}], [1, "privateproperty", 0, "^https?://(www\\.)?privateproperty\\.co\\.za/", 22, [5230], [{ e: 5231 }], [{ v: 5231 }], [{ c: 5232 }, { c: 5233 }], [{ check: "none", timeout: 2e3, wv: 5231 }, { check: "none", v: 5234 }], {}], [1, "professoren-tum-de", 2, "^https?://(www\\.)?professoren\\.tum\\.de/", 22, [3368], [{ e: 5235 }], [{ v: 5235 }], [{ c: 5236 }], [{ cc: 1852 }], {}], [1, "profiler-dk", 1, "^https?://(www\\.)?(profiler|debtor)\\.dk/", 22, [5237], [{ e: 5238 }], [{ v: 5237 }], [{ h: 5237 }], [], {}], [1, "profootballmania.com", 2, "^https?://(\\w+\\.)?profootballmania\\.com/", 22, [5239], [{ e: 5240 }], [{ v: 5241 }], [{ c: 5242 }, { if: { e: 5243 }, then: [{ k: 1397 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 5244 }], [{ cc: 1038 }], {}], [1, "properstar", 2, "^https?://((www\\.)?properstar\\.[a-z.]+|international\\.immobiliare\\.it)/", 22, [5245], [{ e: 5246 }], [{ v: 5247 }], [{ timeout: 15e3, w: 5248 }, { c: 5246 }, { timeout: 3e3, wv: 5249 }, { all: true, optional: true, k: 5250 }, { retry: 2, c: 5251 }], [{ check: "none", timeout: 2e3, wv: 5247 }], {}], [1, "publicmobile", 2, "^https?://(www\\.)?publicmobile\\.ca/", 22, [5252], [{ e: 5252 }], [{ v: 5253 }], [{ c: 5254 }, { wv: 5255 }, { all: true, optional: true, k: 5256 }, { c: 5257 }, { check: "none", timeout: 3e3, wv: 5253 }], [{ cc: 3863 }], {}], [1, "puesc-gov-pl", 2, "^https?://(www\\.)?puesc\\.gov\\.pl/", 22, [5258], [{ e: 5259 }], [{ v: 5259 }], [{ retry: 3, retryInterval: 500, c: 5259 }], [{ cc: 5260 }], {}], [1, "qudosbank-com-au", 2, "^https?://(www\\.)?qudosbank\\.com\\.au/", 22, [5261], [{ e: 5262 }], [{ v: 5261 }], [{ c: 5262 }, { check: "none", timeout: 2e3, wv: 5261 }], [], {}], [3, "racv", 1, "^https?://(www\\.)?racv\\.com\\.au/", 10, [5263], [{ e: 5264 }], [{ v: 5264 }], [{ h: 5263 }, { stylesheet: "body.gdpr-active { overflow: auto !important; } body.gdpr-active::before { display: none !important; }", stylesheetId: "racv-gdpr-backdrop" }], [], {}], [1, "randewoo.ru", 2, "^https?://(\\w+\\.)?randewoo\\.ru/", 22, [], [{ e: 5265 }], [{ v: 5265 }], [{ retry: 10, retryInterval: 500, c: 5265 }], [{ check: "none", timeout: 2e3, wv: 5265 }], {}], [1, "random-org", 2, "^https?://(\\w+\\.)?random\\.org/", 22, [52], [{ e: 5266 }], [{ v: 52 }], [{ if: { e: 5267 }, then: [{ k: 5268 }] }, { if: { e: 5269 }, then: [{ k: 5270 }] }, { c: 5271 }], [{ cc: 5272 }], {}], [1, "raspberrypi.com", 0, "^https://([a-z0-9-]+\\.)?raspberrypi\\.com/", 10, [], [{ e: 5273 }], [{ v: 5273 }], [{ c: 5273 }], [{ check: "none", v: 5273 }], {}], [1, "readawrite", 2, "^https?://(www\\.)?readawrite\\.com/", 22, [], [{ e: 5274 }], [{ v: 5275 }], [{ k: 5276 }], [{ check: "none", v: 5275 }], {}], [1, "readly", 2, "^https://([a-z0-9-]+\\.)?readly\\.(com|co)/", 22, [5277, 5278], [{ e: 5279 }], [{ check: "any", v: 5279 }], [{ if: { e: 5280 }, then: [{ c: 5280 }], else: [{ c: 5281 }, { if: { e: 5282 }, then: [{ all: true, c: 5282 }], else: [] }, { c: 5283 }] }], [], {}], [1, "realfoods.co.uk", 2, "^https?://(www\\.)?realfoods\\.co\\.uk/", 22, [5284], [{ e: 5285 }], [{ v: 5284 }], [{ c: 5285 }, { wv: 5286 }, { all: true, optional: true, k: 5287 }, { k: 5288 }], [{ cc: 5289 }], {}], [1, "realme", 2, "^https?://(\\w+\\.)?realme\\.com/", 22, [5290, 5291], [{ e: 5292 }], [{ v: 5293 }], [{ if: { e: 5294 }, then: [{ c: 5295 }], else: [{ c: 5296 }] }], [], {}], [1, "reddit.com", 2, "^https://(www|old)\\.reddit\\.com/", 22, [5297], [{ e: 5298 }], [{ v: 5298 }], [{ c: 5299 }], [{ cc: 5300 }], {}], [1, "refurbed", 2, "^https?://(www\\.)?refurbed\\.(com|co\\.uk|[a-z]{2})/", 22, [5301], [{ e: 5302 }], [{ v: 5301 }], [{ c: 5302 }, { check: "none", timeout: 2e3, wv: 5301 }], [{ cc: 5303 }, { cc: 5304 }], {}], [1, "regjeringen.no", 2, "^https?://(www\\.)?regjeringen\\.no/", 22, [5305], [{ e: 5306 }], [{ v: 5307 }], [{ c: 5308 }], [{ check: "none", timeout: 2e3, wv: 5305 }], {}], [1, "rejestr.io", 0, "^https?://(www\\.)?rejestr\\.io/", 22, [], [{ e: 5309 }], [{ v: 5309 }], [{ c: 5309 }], [{ timeout: 1e3, check: "none", wv: 5309 }], {}], [1, "reliving", 2, "^https?://(www\\.)?reliving\\.(nl|be|fr)/", 22, [], [{ e: 5310 }], [{ v: 5310 }], [{ timeout: 1e4, optional: true, w: 1561 }, { if: { e: 5311 }, then: [{ k: 5312 }] }, { if: { e: 5313 }, then: [{ k: 5314 }] }, { retry: 3, retryInterval: 1e3, c: 5315 }], [{ cc: 5316 }], {}], [1, "remarkable.com", 1, "^https://(www\\.)?remarkable\\.com/", 22, [5317], [{ e: 5318 }], [{ v: 5318 }], [{ h: 5317 }], [], {}], [1, "renaud-bray", 2, "^https?://(www\\.)?renaud-bray\\.com/", 22, [52], [{ e: 5319 }], [{ v: 52 }], [{ c: 5320 }, { wv: 5321 }, { c: 5322 }], [{ check: "none", v: 52 }, { check: "none", v: 5321 }], {}], [1, "restaurants.nl", 2, "^https?://(\\w+\\.)?restaurants\\.nl/", 22, [], [{ e: 5323 }], [{ v: 5323 }], [{ c: 5324 }], [{ check: "none", v: 5323 }], {}], [1, "reuma.nl", 2, "^https?://(www\\.)?reuma\\.nl/", 22, [5325], [{ e: 5326 }], [{ v: 5326 }], [{ if: { e: 5327 }, then: [{ k: 5327 }] }, { w: 5328 }, { all: true, optional: true, k: 5329 }, { c: 5326 }], [{ cc: 5330 }], {}], [1, "reverb", 2, "^https?://(www\\.)?reverb\\.com/", 22, [5331], [{ e: 5332 }], [{ v: 5332 }], [{ if: { e: 5333 }, then: [{ c: 5333 }], else: [{ c: 5334 }, { w: 5335 }, { all: true, optional: true, k: 5336 }, { c: 5337 }] }], [{ cc: 5338 }], {}], [1, "reverb-gdpr-nag", 2, "^https?://(www\\.)?reverb\\.com/", 22, [], [{ cc: 5339 }, { e: 5340 }], [{ v: 5341 }], [{ retry: 5, retryInterval: 500, c: 5340 }], [], {}], [1, "reviewsolicitors.co.uk", 2, "^https?://(www\\.)?reviewsolicitors\\.co\\.uk/", 22, [5342, 5343], [{ e: 5344 }], [{ v: 5342 }], [{ c: 5345 }, { wv: 5346 }, { wait: 500 }, { k: 5346 }], [{ cc: 5347 }], {}], [1, "ria-com", 2, "^https?://([\\w-]+\\.)?ria\\.com/", 22, [5348], [{ e: 5349 }], [{ v: 5348 }], [{ c: 5350 }, { wv: 5351 }, { if: { e: 5352 }, then: [{ k: 5353 }] }, { if: { e: 5354 }, then: [{ k: 5355 }] }, { c: 5356 }], [{ cc: 5357 }], {}], [1, "rinkabyror-se", 1, "^https?://(www\\.)?rinkabyror\\.se/", 22, [5358], [{ e: 5359 }], [{ v: 5358 }], [{ h: 5358 }], [], {}], [1, "rittal", 2, "^https?://(\\w+\\.)?rittal\\.com/", 22, [4713], [{ e: 5360 }], [{ v: 5360 }], [{ c: 5361 }], [{ cc: 5362 }], {}], [1, "roblox", 0, "^https://(www\\.)?roblox\\.com/", 10, [], [{ e: 5363 }], [{ v: 5364 }], [{ c: 5365 }], [{ cc: 5366 }], {}], [1, "roblox-creator-hub", 0, "^https://create\\.roblox\\.com/", 10, [], [{ e: 5367 }], [{ v: 5368 }], [{ c: 5368 }, { check: "none", timeout: 2e3, optional: true, wv: 5368 }, { timeout: 3e3, optional: true, c: 5368 }], [{ cc: 5369 }], {}], [1, "rog-forum.asus.com", 2, "^https://rog-forum\\.asus\\.com/", 22, [5370], [{ e: 5370 }], [{ v: 5370 }], [{ k: 5371 }, { c: 5372 }], [], {}], [1, "roguefitness", 2, "^https?://(www\\.)?roguefitness\\.com/", 22, [5373], [{ e: 5374 }], [{ v: 5374 }], [{ c: 5375 }, { wv: 5376 }, { all: true, optional: true, k: 5377 }, { c: 5378 }], [{ cc: 4212 }], {}], [1, "roll20", 2, "^https://([a-z0-9-]+\\.)?roll20\\.net/", 22, [5379], [{ e: 5380 }], [{ v: 5379 }], [{ c: 5381 }, { timeout: 2e3, wv: 5382 }, { if: { e: 5383 }, then: [{ k: 5384 }] }, { k: 5385 }], [{ cc: 5386 }], {}], [1, "romeo", 2, "^https?://(www\\.)?romeo\\.com/", 22, [], [{ e: 5387 }], [{ v: 5387 }], [{ c: 5388 }, { wv: 5389 }, { if: { e: 5390 }, then: [{ k: 5389 }] }, { k: 5391 }, { check: "none", wv: 5387 }], [], {}], [1, "rosbalt.ru", 1, "^https?://(\\w+\\.)?rosbalt\\.ru/", 22, [5392], [{ e: 5392 }], [{ v: 5392 }], [{ h: 5392 }], [{ check: "none", v: 5392 }], {}], [1, "route-inn", 2, "^https?://(\\w+\\.)?(route-inn|ark-hotel)\\.co\\.jp/", 22, [3801], [{ e: 5393 }], [{ v: 5394 }], [{ c: 5393 }], [{ cc: 5395 }], {}], [1, "rspb.org.uk", 0, "^https://(\\w+\\.)?rspb\\.org\\.uk/", 10, [5396], [{ e: 5396 }], [{ v: 5396 }], [{ c: 5397 }, { wv: 5398 }, { c: 5399 }], [{ cc: 5400 }], {}], [1, "rt", 1, "^https://(www\\.)?(rt\\.com|rt-english\\.com)/", 22, [5401], [{ e: 5401 }], [{ v: 5401 }], [{ h: 5401 }], [], {}], [1, "rug-nl", 0, "^https?://(\\w+\\.)?rug\\.nl/", 10, [5402], [{ e: 5403 }], [{ v: 5402 }], [{ c: 5403 }], [], {}], [1, "rule34-xxx", 2, "^https?://(www\\.)?rule34\\.xxx/", 22, [5404], [{ e: 5404 }], [{ v: 5404 }], [{ c: 5405 }], [{ cc: 5406 }], {}], [1, "rutjes", 2, "^https?://(www\\.)?rutjes(paardenboxen\\.nl|pferdeboxen\\.de)/", 22, [5301], [{ e: 5407 }], [{ v: 5408 }], [{ c: 5408 }], [{ wait: 500 }, { cc: 5409 }], {}], [1, "rwth-moodle", 2, "^https?://moodle\\.rwth-aachen\\.de/", 22, [1451], [{ e: 5410 }], [{ v: 1451 }], [{ c: 5410 }], [{ cc: 5411 }], {}], [1, "ryanair", 0, "^https://(www\\.)?ryanair\\.com/", 10, [5412], [{ e: 5412 }], [{ v: 5412 }], [{ c: 5413 }], [{ cc: 5414 }], {}], [1, "samsung-account", 2, "^https://(\\w+\\.)?account\\.samsung\\.com/", 22, [5415], [{ e: 5416 }], [{ v: 5416 }], [{ c: 5416 }], [{ cc: 5417 }], {}], [1, "samsung.com", 1, "^https://www\\.samsung\\.com/", 22, [5418], [{ e: 5418 }], [{ v: 5418 }], [{ h: 5418 }], [], {}], [1, "san-tatsu.jp", 2, "^https?://(\\w+\\.)?san-tatsu\\.jp/", 22, [5419], [{ e: 5420 }], [{ v: 5420 }], [{ c: 5420 }], [{ cc: 5421 }], {}], [1, "sanook", 2, "^https?://([a-z0-9-]+\\.)?sanook\\.com/", 22, [5422], [{ e: 5423 }], [{ v: 5424 }], [{ c: 5423 }, { wv: 5425 }, { if: { e: 5426 }, then: [{ all: true, k: 5426 }] }, { retry: 2, retryInterval: 500, c: 5425 }], [{ cc: 5427 }, { cc: 5428 }, { cc: 5429 }], {}], [1, "saos-org-pl", 1, "^https?://(www\\.)?saos\\.org\\.pl/", 22, [5430, 4077], [{ e: 5431 }], [{ v: 5430 }], [{ h: 5432 }], [{ check: "none", v: 5430 }], {}], [1, "saturdaysnyc", 2, "^https?://(www\\.)?saturdaysnyc\\.com/", 22, [5433], [{ e: 5434 }], [{ v: 5433 }], [{ c: 5434 }], [{ cc: 5435 }], {}], [1, "scb.se", 2, "^https?://(www\\.)?scb\\.se/", 22, [5436], [{ e: 5437 }], [{ v: 5436 }], [{ waitForThenClick: ["#kakrutan scb-button[value='inget']", "button"] }], [{ check: "none", v: 5436 }], {}], [1, "schadefonds", 2, "^https?://(www\\.)?schadefonds\\.nl/", 22, [3368], [{ e: 5438 }], [{ v: 5438 }], [{ timeout: 2e3, optional: true, w: 5439 }, { c: 3642 }], [], {}], [1, "schullv.de", 2, "^https?://(\\w+\\.)?schullv\\.de/", 22, [5440], [{ e: 5441 }], [{ v: 5441 }], [{ c: 5442 }, { w: 5443 }, { all: true, optional: true, k: 5444 }, { c: 5445 }], [], {}], [1, "schumacher.com", 2, "^https?://(www\\.)?schumacher\\.com/", 22, [], [{ e: 5446 }], [{ v: 5446 }], [{ if: { e: 5447 }, then: [{ k: 5447 }], else: [{ c: 5448 }, { c: 5449 }] }], [{ cc: 5450 }, { cc: 5451 }, { cc: 5452 }], {}], [1, "schuurman-schoenen", 2, "^https?://(www\\.)?schuurman-(schoenen|schuhe)\\.(nl|be|de)/", 10, [5453], [{ e: 5454 }], [{ v: 5455 }], [{ c: 5456 }, { c: 5454 }], [{ cc: 5457 }], {}], [1, "scmp", 2, "^https://(www\\.)?scmp\\.com/", 22, [5458], [{ any: [{ e: 5459 }, { e: 1395 }] }], [{ any: [{ v: 5459 }, { v: 1424 }] }], [{ timeout: 4e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }, { timeout: 3e3, optional: true, wv: 5459 }, { h: 5458 }], [], {}], [1, "scotland-police-uk", 1, "^https?://(www\\.)?scotland\\.police\\.uk/", 22, [5460], [{ e: 5461 }], [{ v: 5461 }], [{ h: 5460 }], [{ check: "none", v: 5460 }], {}], [1, "sda-it", 2, "^https?://(\\w+\\.)?sda\\.it/", 22, [5462], [{ e: 5463 }], [{ v: 5463 }], [{ c: 5463 }], [{ cc: 5464 }, { negated: true, cc: 5465 }], {}], [1, "seg-social", 2, "^https?://([a-z0-9-]+\\.)*seg-social\\.(gob\\.)?es/", 22, [5466], [{ e: 5467 }], [{ v: 5467 }], [{ c: 5467 }], [{ cc: 5468 }], {}], [1, "sejm-gov-pl", 0, "^https?://(www\\.)?sejm\\.gov\\.pl/", 22, [], [{ e: 5469 }], [{ v: 5469 }], [{ c: 5469 }], [{ cc: 5470 }], {}], [1, "seniorweb", 2, "^https?://(www\\.)?seniorweb\\.nl/", 22, [5471], [{ e: 5471 }], [{ v: 5471 }], [{ c: 5472 }, { wv: 5473 }, { k: 5473 }, { c: 5474 }], [{ cc: 5475 }], {}], [1, "seria-group", 1, "^https?://(www\\.)?seria-group\\.com/", 22, [5476], [{ e: 5477 }], [{ v: 5478 }], [{ h: 5476 }], [{ check: "none", v: 5476 }], {}], [1, "serpstat-com", 1, "^https://(\\w+\\.)?serpstat\\.com/", 22, [5479], [{ e: 5480 }], [{ v: 5480 }], [{ h: 5479 }], [], {}], [1, "service2school", 2, "^https?://(www\\.)?service2school\\.org/", 22, [2641, 1591], [{ e: 2649 }, { negated: true, cc: 5481 }], [{ v: 2651 }], [{ h: 2641 }, { timeout: 5e3, c: 1592 }], [{ cc: 5482 }], {}], [1, "sex.com", 2, "^https?://(\\w+\\.)?sex\\.com/", 22, [5483], [{ e: 5484 }], [{ v: 5485 }], [{ w: 5486 }, { c: 5487 }, { c: 5488 }], [{ cc: 1038 }], {}], [1, "sexlog", 1, "^https?://([\\w-]+\\.)?sexlog\\.com/", 22, [5489], [{ e: 5490 }], [{ v: 5489 }], [{ h: 5489 }], [{ check: "none", v: 5489 }], {}], [1, "sfanytime", 2, "^https?://(www\\.)?sfanytime\\.com/", 22, [4085], [{ e: 4085 }], [{ v: 4085 }], [{ c: 5491 }, { wv: 5492 }, { all: true, optional: true, k: 5493 }, { c: 5494 }], [{ check: "none", v: 4085 }], {}], [1, "shein.com", 2, "^https?://([a-z]+\\.)?shein\\.com/", 22, [5495], [{ e: 5496 }], [{ v: 5496 }], [{ if: { v: 5497 }, then: [{ k: 5497 }], else: [{ k: 5496 }, { wv: 5498 }, { if: { v: 5499 }, then: [{ k: 5499 }], else: [{ all: true, optional: true, k: 5500 }, { k: 5501 }] }] }], [{ timeout: 1e3, check: "none", wv: 5502 }], {}], [1, "shimano-bike", 1, "^https?://bike\\.shimano\\.com/", 22, [5503], [{ e: 5504 }], [{ v: 5503 }], [{ h: 5503 }], [], {}], [1, "shinden.pl", 2, "^https?://(www\\.)?shinden\\.pl/", 22, [745], [{ e: 5505 }], [{ check: "any", v: 5505 }], [{ h: 745 }, { timeout: 1e4, optional: true, wv: 2868 }, { if: { v: 2868 }, then: [{ retry: 2, retryInterval: 500, c: 2869 }, { c: 2870 }, { check: "none", wv: 2868 }] }], [], {}], [1, "shoezone", 1, "^https?://(www\\.)?shoezone\\.com/", 22, [5506], [{ e: 5507 }], [{ v: 5506 }], [{ h: 5506 }], [{ check: "none", v: 5506 }], {}], [1, "shopquarters", 1, "^https?://(www\\.)?shopquarters\\.com/", 22, [2488], [{ e: 5508 }], [{ check: "any", v: 5509 }], [{ h: 5508 }, { timeout: 2e3, optional: true, c: 2489 }], [], {}], [1, "showroomprive", 2, "^https?://(\\w+\\.)*(showroomprive\\.\\w+|saldiprivati\\.com)/", 22, [5510, 5511], [{ e: 5512 }], [{ v: 5513 }], [{ c: 5512 }], [{ cc: 5514 }], {}], [1, "siamsport-co-th", 1, "^https?://(www\\.)?siamsport\\.co\\.th/", 22, [1736], [{ e: 5515 }], [{ v: 1736 }], [{ h: 1736 }], [], {}], [1, "sian-it", 1, "^https?://(www\\.)?sian\\.it/", 22, [5516], [{ e: 5517 }], [{ v: 5516 }], [{ h: 5516 }], [{ check: "none", v: 5516 }], {}], [1, "silver.nu", 2, "^https?://(www\\.)?silver\\.nu/", 22, [], [{ e: 5518 }], [{ v: 5518 }], [{ c: 5519 }, { timeout: 5e3, optional: true, w: 1395 }, { if: { e: 1395 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ cc: 5520 }], {}], [1, "simplehuman-com", 2, "^https?://(www\\.)?simplehuman\\.com/", 10, [5521], [{ e: 5522 }], [{ v: 5523 }], [{ c: 5522 }, { c: 5524 }], [], {}], [1, "simplepractice.com", 2, "^https?://(\\w+\\.)?simplepractice\\.com/", 22, [], [{ e: 5525 }], [{ v: 5525 }], [{ timeout: 1e4, w: 1114 }, { c: 5526 }, { waitForVisible: [".dg-consent-banner", ".dg-app"] }, { click: [".dg-consent-banner", "#dg-category-functional:checked"], optional: true }, { click: [".dg-consent-banner", "#dg-category-performance:checked"], optional: true }, { click: [".dg-consent-banner", "#dg-category-marketing:checked"], optional: true }, { waitForThenClick: [".dg-consent-banner", "button.dg-button.custom"] }], [{ cc: 5527 }, { cc: 5528 }, { cc: 5529 }], {}], [1, "simyo-nl", 2, "^https?://(www\\.)?simyo\\.nl/", 10, [5530], [{ v: 5530 }], [{ v: 5530 }], [{ c: 5531 }], [{ cc: 5532 }], {}], [1, "skatteverket-se", 2, "^https?://(www\\.)?skatteverket\\.se/", 22, [5533], [{ exists: ["skv-cookie-banner", ".skv-cookie-banner-root"] }], [{ visible: ["skv-cookie-banner", ".skv-cookie-banner-root"] }], [{ waitForThenClick: ["skv-cookie-banner", "#deny-all"] }], [{ cc: 5534 }], {}], [1, "skokka", 2, "^https?://(\\w+\\.)?skokka\\.com/", 22, [5535], [{ e: 5536 }], [{ v: 5536 }], [{ c: 5537 }, { c: 5538 }], [{ cc: 5539 }], {}], [1, "sl-se", 2, "^https?://(www\\.)?sl\\.se/", 22, [5540], [{ e: 5541 }], [{ v: 5541 }], [{ c: 5541 }], [{ cc: 5542 }], {}], [1, "smallpdf", 2, "^https?://(www\\.)?smallpdf\\.com/", 22, [], [{ e: 5543 }], [{ v: 5543 }], [{ c: 5544 }, { wv: 5545 }, { all: true, optional: true, k: 5546 }, { k: 5545 }], [{ cc: 5547 }], {}], [1, "smartfren", 2, "^https?://(www\\.)?smartfren\\.com/", 22, [], [{ e: 5548 }], [{ v: 5549 }], [{ c: 5550 }], [{ check: "none", v: 5549 }], {}], [1, "smile-insurances", 2, "^https?://(www\\.)?smile-insurances\\.com/", 22, [5551], [{ e: 5551 }], [{ v: 5552 }], [{ c: 5552 }], [{ cc: 5553 }], {}], [1, "snb.ch", 2, "^https?://(www\\.)?snb\\.ch/", 22, [5554, 5555], [{ e: 5556 }], [{ v: 5557 }], [{ c: 5556 }, { wv: 5558 }, { all: true, optional: true, k: 5559 }, { k: 5558 }], [{ check: "none", v: 5554 }], {}], [1, "solvhealth.com", 2, "^https://(www\\.)?solvhealth\\.com/", 22, [4055], [{ e: 5560 }], [{ v: 4055 }], [{ c: 5561 }, { check: "none", wv: 4055 }], [{ check: "none", v: 4055 }], {}], [1, "spankbang", 2, "^https?://(\\w+\\.)?spankbang\\.com/", 22, [], [{ e: 5562 }], [{ v: 5562 }], [{ c: 5563 }], [{ timeout: 2e3, check: "none", wv: 5562 }], {}], [1, "spares2repair", 2, "^https?://(www\\.)?spares(2repair|4shavers)\\.co\\.uk/", 22, [5564, 5565], [{ e: 5566 }], [{ v: 5565 }], [{ retry: 3, retryInterval: 500, c: 5567 }, { retry: 3, retryInterval: 500, c: 5568 }], [{ cc: 5569 }], {}], [1, "speciesplus.net", 2, "^https?://(www\\.)?speciesplus\\.net/", 22, [5570], [{ e: 5571 }], [{ v: 5570 }], [{ c: 5572 }, { check: "none", wv: 5570 }], [{ cc: 5573 }], {}], [1, "spermidinelife-us", 1, "^https://(www\\.)?spermidinelife\\.us/", 22, [5574], [{ e: 5575 }], [{ v: 5576 }], [{ h: 5574 }], [], {}], [3, "sportmedizin-rheuma", 1, "^https?://(www\\.)?sportmedizin-rheuma\\.de/", 22, [639], [{ e: 641 }], [{ v: 641 }], [{ h: 5577 }, { stylesheet: "body#home { overflow: visible !important; }" }], [], {}], [1, "sportpesa", 1, "^https?://(www\\.)?sportpesa\\.co\\.tz/", 22, [5578], [{ e: 5579 }], [{ v: 5578 }], [{ h: 5578 }], [{ check: "none", v: 5578 }], {}], [1, "sportsmans.com", 2, "^https?://(www\\.)?sportsmans\\.com/", 22, [5580], [{ e: 5580 }, { exists: [".dg-consent-banner", "button.dg-button.reject_all"] }], [{ check: "any", v: 5580 }], [{ waitForThenClick: [".dg-consent-banner", "button.dg-button.reject_all"] }, { h: 5580 }], [], {}], [1, "sportstiming", 2, "^https?://(www\\.)?sportstiming\\.(dk|se|no|de)/", 22, [5581], [{ e: 5582 }], [{ v: 5582 }], [{ all: true, optional: true, k: 5583 }, { c: 5582 }], [{ cc: 5584 }], {}], [1, "spreekwoorden", 1, "^https?://(www\\.)?spreekwoorden\\.nl/", 22, [5585], [{ e: 5586 }], [{ v: 5585 }], [{ h: 5586 }], [], {}], [1, "ss.com", 2, "^https?://(\\w+\\.)?ss\\.(com|lv)/", 22, [5587], [{ e: 5587 }], [{ v: 5587 }], [{ eval: "EVAL_SS_COM_OPT_OUT" }, { check: "none", wv: 5587 }], [{ eval: "EVAL_SS_COM_TEST" }], {}], [1, "stoffe-hemmers", 2, "^https?://(\\w+\\.)?(stoffen?|tissus|fabrics)-hemmers\\.(de|nl|fr|com)/", 22, [5588, 5589], [{ e: 5590 }], [{ v: 5590 }], [{ c: 5591 }, { wv: 5592 }, { all: true, optional: true, k: 5593 }, { k: 5592 }], [{ cc: 2512 }, { negated: true, cc: 5594 }], {}], [1, "stoneacre.co.uk", 2, "^https?://(www\\.)?stoneacre\\.co\\.uk/", 22, [], [{ e: 5595 }], [{ v: 5595 }], [{ c: 5595 }], [{ timeout: 1e3, check: "none", wv: 5595 }], {}], [1, "store2000.fr", 2, "^https?://(www\\.)?store2000\\.fr/", 22, [5596], [{ e: 5596 }], [{ v: 5596 }], [{ c: 5597 }, { h: 5596 }], [], {}], [1, "strato.de", 2, "^https://www\\.strato\\.de/", 22, [5598], [{ e: 5599 }], [{ v: 5598 }], [{ c: 5599 }, { wv: 5600 }, { all: true, optional: true, k: 5601 }, { c: 5602 }], [{ check: "none", timeout: 2e3, wv: 5603 }], {}], [1, "stripinfo.be", 2, "^https?://(www\\.)?stripinfo\\.be/", 22, [5604], [{ e: 5605 }], [{ v: 5604 }], [{ retry: 5, retryInterval: 600, c: 5606 }, { check: "none", wv: 5604 }], [{ cc: 5607 }], {}], [1, "studentapan", 2, "^https?://(www\\.)?studentapan\\.se/", 22, [5608], [{ e: 5608 }], [{ v: 5608 }], [{ c: 5609 }, { wv: 5610 }, { all: true, optional: true, k: 5611 }, { c: 5612 }], [{ cc: 5613 }], {}], [2, "stuvia", 1, "^https?://(\\w+\\.)?stuvia\\.com/", 22, [5614], [{ e: 5615 }], [{ v: 5614 }], [{ h: 5614 }, { addStyle: "display: none !important", selector: "#cookiesPermission" }], [], {}], [1, "subaru-ca", 2, "^https?://([\\w-]+\\.)*subaru(dealer)?\\.ca/", 22, [5616], [{ e: 5617 }], [{ check: "any", v: 5618 }], [{ c: 5617 }], [{ check: "none", timeout: 2e3, wv: 5618 }], {}], [1, "sujetdebac.fr", 2, "^https?://(www\\.)?sujetdebac\\.fr/", 22, [5619], [{ e: 5619 }], [{ v: 5619 }], [{ c: 5620 }], [{ check: "none", v: 5619 }], {}], [1, "surfshark", 2, "^https?://(\\w+\\.)?surfshark\\.com/", 22, [5621], [{ e: 5621 }], [{ v: 5621 }], [{ if: { e: 5622 }, then: [{ k: 5622 }], else: [{ k: 5623 }, { c: 5624 }] }], [{ cc: 5625 }], {}], [1, "svt.se", 2, "^https://(\\w+\\.)?svt\\.se/", 22, [5626], [{ e: 5626 }], [{ v: 5627 }], [{ c: 5628 }], [{ cc: 5629 }], {}], [1, "sykescottages.co.uk", 2, "^https?://(www\\.)?sykescottages\\.co\\.uk/", 22, [], [{ e: 5630 }], [{ v: 5630 }], [{ timeout: 1e4, w: 2231 }, { c: 5631 }, { check: "none", timeout: 2e3, optional: true, wv: 5630 }], [{ wait: 500 }, { cc: 2906 }], {}], [1, "synergy-net-au", 2, "^https?://(www\\.)?synergy\\.net\\.au/", 22, [5632], [{ e: 5633 }], [{ v: 5634 }], [{ c: 5635 }], [{ cc: 5636 }], {}], [1, "tcl.com", 2, "^https?://(www\\.)?tcl\\.com/", 22, [5637], [{ e: 5638 }], [{ v: 5638 }], [{ if: { e: 5639 }, then: [{ retry: 5, c: 5639 }], else: [{ retry: 5, c: 5640 }] }], [{ timeout: 2e3, check: "none", wv: 5638 }], {}], [1, "teacherspensions.co.uk", 2, "^https?://(www\\.)?teacherspensions\\.co\\.uk/", 10, [5641], [{ e: 5642 }], [{ v: 5641 }], [{ c: 5642 }, { wv: 5643 }, { all: true, optional: true, k: 5644 }, { k: 5643 }], [{ cc: 5645 }], {}], [1, "teapuesto", 2, "^https?://(\\w+\\.)?teapuesto\\.pe/", 22, [5646], [{ e: 5647 }], [{ v: 5647 }], [{ c: 5647 }, { c: 5648 }, { check: "none", wv: 5646 }], [{ cc: 2120 }], {}], [1, "teeshoppen", 2, "^https?://(www\\.)?teeshoppen\\.(se|dk|no|fi|de|nl|com|co\\.uk|fr|at)/", 22, [5649], [{ e: 5650 }], [{ v: 5651 }], [{ retry: 3, retryInterval: 1e3, c: 5650 }, { check: "none", wv: 5649 }], [{ cc: 5652 }, { cc: 5653 }], {}], [1, "telcel", 1, "^https?://(www\\.)?telcel\\.com/", 22, [5654], [{ e: 5655 }], [{ v: 5654 }], [{ h: 5654 }], [], {}], [1, "telegram-im", 2, "^https?://(www\\.)?(telegram\\.im|telegramcn\\.org\\.cn|telegramim\\.ru)/", 22, [5656], [{ e: 5657 }], [{ v: 5656 }], [{ c: 5656 }], [{ check: "none", v: 5656 }], {}], [1, "temu", 2, "^https://([a-z0-9-]+\\.)?temu\\.com/", 22, [], [{ e: 5658 }], [{ v: 5658 }], [{ c: 5659 }], [{ wait: 500 }, { cc: 5660 }], {}], [1, "tesco", 0, "^https://(www\\.)?tesco\\.com/", 22, [5661], [{ e: 5661 }], [{ v: 5661 }], [{ w: 2902 }, { c: 5662 }], [{ cc: 5663 }], {}], [1, "tesla", 2, "^https://(www\\.)?tesla\\.com/", 10, [], [{ e: 356 }], [{ v: 356 }], [{ c: 5664 }], [{ cc: 5665 }], {}], [1, "texas.gov", 2, "^https?://(www\\.)?texas\\.gov/", 22, [5666], [{ e: 5667 }], [{ check: "any", v: 5668 }], [{ if: { v: 5669 }, then: [{ k: 5669 }], else: [{ k: 5670 }] }, { check: "none", wv: 5666 }], [], {}], [2, "tfl.gov.uk", 2, "^https?://(\\w+\\.)?tfl\\.gov\\.uk/", 22, [5671], [{ e: 5672 }], [{ v: 5673 }], [{ c: 5673 }, { timeout: 400, optional: true, wv: 5671 }, { if: { v: 5671 }, then: [{ addStyle: "display: none", selector: "#cb-cookieoverlay" }] }], [{ check: "none", v: 5671 }, { cc: 3282 }], {}], [1, "thecode", 2, "^https?://(www\\.)?(thecode\\.co\\.uk|lovethesales\\.com)/", 22, [5674], [{ e: 5674 }], [{ v: 5675 }], [{ c: 5676 }, { wv: 5677 }, { if: { e: 5678 }, then: [{ k: 5679 }] }, { k: 5680 }], [{ wait: 1e3 }, { cc: 5681 }], {}], [1, "thegrandyork", 2, "^https?://(www\\.)?thegrandyork\\.co\\.uk/", 22, [5682], [{ e: 5683 }], [{ v: 5684 }], [{ c: 5683 }, { wv: 5685 }, { all: true, optional: true, k: 5686 }, { k: 5687 }], [{ wait: 500 }, { cc: 5688 }], {}], [1, "theinfatuation", 2, "^https://(www\\.)?theinfatuation\\.com", 10, [3911], [{ e: 5689 }], [{ v: 5689 }], [{ c: 5689 }], [{ check: "none", v: 3911 }], {}], [1, "thenounproject", 2, "^https?://(\\w+\\.)?thenounproject\\.com/", 22, [5690], [{ e: 5691 }], [{ check: "any", v: 5691 }], [{ c: 5691 }, { any: [{ timeout: 2e3, check: "any", wv: 5692 }, { k: 5691 }] }, { check: "any", wv: 5692 }, { all: true, optional: true, k: 5693 }, { c: 5694 }], [{ cc: 1038 }, { cc: 1940 }], {}], [1, "thenude", 0, "^https?://(www\\.)?thenude\\.com/", 10, [5695], [{ e: 5695 }], [{ v: 5695 }], [{ c: 5696 }, { wv: 5697 }, { if: { e: 5698 }, then: [{ k: 5698 }, { timeout: 1e3, c: 5699 }] }, { if: { e: 5698 }, then: [{ k: 5698 }, { timeout: 1e3, c: 5699 }] }, { if: { e: 5698 }, then: [{ k: 5698 }, { timeout: 1e3, c: 5699 }] }, { if: { e: 5698 }, then: [{ k: 5698 }, { timeout: 1e3, c: 5699 }] }, { k: 5700 }, { check: "none", timeout: 3e3, wv: 5695 }], [{ cc: 2906 }, { cc: 5701 }], {}], [1, "therealest", 2, "^https?://([a-z0-9-]+\\.)?therealest\\.com/", 22, [5702], [{ e: 5702 }], [{ v: 5702 }], [{ c: 5703 }, { c: 5704 }, { w: 5705 }, { c: 5706 }], [{ cc: 1038 }], {}], [1, "thisiseindhoven", 2, "^https?://(www\\.)?thisiseindhoven\\.com/", 22, [5707], [{ e: 5708 }], [{ v: 5708 }], [{ c: 5709 }, { c: 5710 }, { c: 5711 }], [{ cc: 5712 }], {}], [1, "thomsonlocal.com", 2, "^https?://(www\\.)?thomsonlocal\\.com/", 22, [3828], [{ e: 5713 }], [{ v: 5714 }], [{ c: 5713 }], [{ cc: 5715 }], {}], [1, "tinder", 2, "^https?://(www\\.)?tinder\\.com/", 22, [5716], [{ e: 5716 }], [{ v: 5716 }], [{ c: 5717 }, { c: 5718 }], [{ check: "none", timeout: 2e3, wv: 5716 }], {}], [1, "tineye", 1, "^https://(www\\.)?tineye\\.com/", 22, [5719], [{ e: 5719 }], [{ v: 5719 }], [{ h: 5719 }], [{ check: "none", v: 5719 }], {}], [1, "tiresize.com", 0, "^https?://(www\\.)?tiresize\\.com/", 22, [5720], [{ e: 5721 }], [{ v: 5720 }], [{ c: 5721 }, { check: "none", timeout: 2e3, wv: 5720 }], [{ cc: 5722 }], {}], [1, "tk-aerztefuehrer.de", 0, "^https?://(www\\.)?tk-aerztefuehrer\\.de/", 10, [5723], [{ e: 5723 }], [{ v: 5723 }], [{ c: 5724 }], [{ cc: 5725 }], {}], [1, "tlc-direct", 2, "^https?://(\\w+\\.)?tlc-direct\\.co\\.uk/", 22, [658], [{ e: 5726 }, { e: 5727 }], [{ v: 658 }], [{ c: 5728 }, { if: { e: 5729 }, then: [{ k: 5730 }] }, { if: { e: 3804 }, then: [{ k: 3805 }] }, { c: 5731 }], [{ cc: 5732 }], {}], [1, "todostuslibros", 2, "^https?://(www\\.)?todostuslibros\\.com/", 22, [5733], [{ e: 5734 }], [{ v: 5733 }], [{ c: 5735 }, { wv: 5734 }, { if: { e: 5736 }, then: [{ k: 5737 }] }, { if: { e: 5738 }, then: [{ k: 5739 }] }, { k: 5734 }], [{ cc: 5740 }, { negated: true, cc: 5741 }], {}], [1, "toho-one.com", 2, "^https?://www\\.toho-one\\.com/", 22, [], [{ e: 5742 }], [{ v: 5742 }], [{ c: 5743 }, { waitFor: ["xpath///div[contains(@class, 'fixed') and .//button[normalize-space()='\u8A2D\u5B9A\u3092\u4FDD\u5B58\u3059\u308B']]", "input[type=checkbox]:checked:not(:disabled)"] }, { click: ["xpath///div[contains(@class, 'fixed') and .//button[normalize-space()='\u8A2D\u5B9A\u3092\u4FDD\u5B58\u3059\u308B']]", "input[type=checkbox]:checked:not(:disabled)"], all: true }, { c: 5744 }], [{ timeout: 1e3, check: "none", wv: 5742 }], {}], [1, "tohotheater-jp", 2, "^https?://(?:[^/]+\\.)?tohotheater\\.jp/", 22, [5745], [{ e: 5746 }], [{ v: 5745 }], [{ c: 5746 }, { c: 5747 }, { c: 5748 }, { c: 5749 }, { c: 5750 }, { c: 5751 }], [{ cc: 5752 }, { cc: 5753 }], {}], [1, "tomplay", 1, "^https?://(\\w+\\.)?tomplay\\.com/", 22, [4557], [{ e: 5754 }], [{ v: 4557 }], [{ h: 4557 }], [], {}], [1, "topcv", 2, "^https?://(www\\.)?topcv\\.vn/", 22, [5755], [{ e: 5755 }], [{ v: 5756 }], [{ c: 5757 }, { w: 5758 }, { k: 5759 }, { k: 5760 }, { retry: 2, retryInterval: 1e3, c: 5761 }, { check: "none", wv: 5758 }], [{ check: "none", v: 5756 }], {}], [1, "tradecalculator.co.uk", 2, "^https?://(www\\.)?tradecalculator\\.co\\.uk/", 22, [], [{ e: 5762 }], [{ v: 5762 }], [{ if: { e: 5763 }, then: [{ k: 5763 }, { timeout: 1e3, w: 5764 }] }, { c: 5765 }], [{ check: "none", timeout: 1e3, wv: 5762 }], {}], [1, "truecar", 1, "^https://(www\\.)?truecar\\.com/", 22, [5766], [{ e: 5767 }], [{ v: 5767 }], [{ h: 5766 }], [], {}], [1, "tu-darmstadt", 2, "^https?://([\\w-]+\\.)*tu-darmstadt\\.de/", 22, [], [{ e: 5768 }], [{ v: 5769 }], [{ if: { e: 5770 }, then: [{ k: 5771 }] }, { if: { e: 5772 }, then: [{ k: 5773 }] }, { retry: 3, retryInterval: 500, c: 5769 }], [{ cc: 1563 }, { negated: true, cc: 5774 }], {}], [1, "tullys-jp", 1, "^https?://(\\w+\\.)?tullys\\.co\\.jp/", 22, [5775], [{ e: 5776 }], [{ v: 5775 }], [{ h: 5775 }], [{ check: "none", v: 5775 }], {}], [1, "turkishairlines.com", 2, "^https?://(\\w+\\.)?turkishairlines\\.com/", 22, [5777], [{ e: 5778 }], [{ v: 5779 }], [{ c: 5779 }], [{ cc: 5780 }], {}], [1, "tusclasesparticulares.com", 2, "^https?://(www\\.)?tusclasesparticulares\\.com/", 22, [5781], [{ e: 5781 }], [{ v: 5781 }], [{ retry: 5, retryInterval: 500, c: 5782 }, { check: "none", timeout: 2e3, wv: 5781 }], [{ cc: 5783 }], {}], [1, "tutosurexcel", 2, "^https?://(\\w+\\.)?tutosurexcel\\.com/", 22, [5784], [{ e: 5784 }], [{ v: 5784 }], [{ c: 5785 }, { wv: 5786 }, { optional: true, k: 5787 }, { k: 5788 }], [{ check: "none", timeout: 2e3, wv: 5784 }], {}], [1, "tutu-ru", 1, "^https?://([a-z0-9-]+\\.)?tutu\\.ru/", 22, [5789], [{ e: 5789 }], [{ v: 5789 }], [{ h: 5789 }], [{ check: "none", v: 5789 }], {}], [1, "tvp", 0, "^https?://(\\w+\\.)?tvp\\.pl/", 10, [5790], [{ e: 5791 }], [{ v: 5791 }], [{ c: 5792 }, { w: 5793 }, { if: { e: 5794 }, then: [{ k: 5795 }] }, { k: 5793 }, { check: "none", timeout: 2e3, optional: true, wv: 5791 }], [{ cc: 5796 }], {}], [1, "twitch.tv", 2, "^https?://([\\w-]+\\.)?twitch\\.tv/", 22, [5797], [{ e: 5798 }], [{ v: 5798 }], [{ if: { e: 5799 }, then: [{ retry: 3, retryInterval: 1e3, c: 5800 }, { check: "none", wv: 5798 }], else: [{ c: 5801 }, { w: 5802 }, { all: true, optional: true, k: 5803 }, { c: 5804 }, { check: "none", wv: 5805 }] }], [], {}], [1, "ub-hu-berlin", 2, "^https?://(www\\.)?ub\\.hu-berlin\\.de/", 22, [], [{ e: 5806 }], [{ v: 5807 }], [{ c: 5808 }], [{ cc: 5809 }], {}], [1, "ubisoft.com", 2, "^https?://(\\w+\\.)?ubisoft\\.com/", 22, [4284, 5810], [{ e: 5811 }], [{ check: "any", v: 5812 }], [{ if: { e: 5813 }, then: [{ c: 5813 }], else: [{ c: 5814 }, { c: 5815 }] }], [{ cc: 5816 }, { cc: 5817 }], {}], [1, "udg.edu", 0, "^https?://(\\w+\\.)?udg\\.edu/", 22, [3664], [{ e: 5818 }], [{ v: 3664 }], [{ c: 5819 }, { wv: 5820 }, { all: true, optional: true, k: 5821 }, { retry: 3, retryInterval: 500, c: 5822 }], [{ cc: 5823 }], {}], [1, "uhcprovider", 2, "^https?://(www\\.)?uhc(provider|dental)\\.com/", 22, [5824], [{ e: 5825 }], [{ v: 5824 }], [{ c: 5826 }], [{ check: "none", timeout: 2e3, wv: 5824 }], {}], [1, "ukplanettools", 2, "^https?://(\\w+\\.)?ukplanettools\\.co\\.uk/", 22, [], [{ e: 5827 }], [{ v: 5827 }], [{ c: 5828 }, { timeout: 5e3, wv: 5829 }, { all: true, optional: true, k: 5830 }, { c: 5831 }, { check: "none", timeout: 3e3, wv: 5827 }], [], {}], [1, "unian", 2, "^https?://(www\\.)?unian\\.net/", 22, [], [{ e: 5832 }], [{ v: 5832 }], [{ c: 5833 }], [{ check: "none", v: 5832 }], {}], [1, "unicourt", 1, "^https://(www\\.)?unicourt\\.com/", 22, [3433], [{ e: 3433 }], [{ v: 3433 }], [{ h: 3433 }], [], {}], [1, "unitedconsumers.com", 2, "^https?://(www\\.)?unitedconsumers\\.com/", 22, [5834], [{ e: 5835 }], [{ v: 5834 }], [{ retry: 10, retryInterval: 500, c: 5836 }, { check: "none", wv: 5834 }], [{ cc: 5837 }], {}], [1, "unitedutilities", 2, "^https?://(www\\.)?unitedutilities\\.com/", 10, [5838], [{ e: 5839 }], [{ v: 5840 }], [{ c: 5839 }, { wv: 5841 }, { optional: true, k: 5842 }, { optional: true, k: 5843 }, { k: 5841 }], [{ cc: 5844 }, { cc: 5845 }], {}], [1, "unive-nl", 0, "^https?://(?:[^/]+\\.)?unive\\.nl/", 10, [5846], [{ e: 5847 }], [{ v: 5846 }], [{ c: 5848 }], [{ check: "none", timeout: 2e3, wv: 5846 }], {}], [1, "unive.it", 0, "^https?://(\\w+\\.)?unive\\.it/", 22, [5849], [{ e: 5850 }], [{ any: [{ v: 5850 }, { negated: true, cc: 5851 }] }], [{ timeout: 15e3, wv: 5850 }, { retry: 3, retryInterval: 500, c: 5850 }], [{ cc: 5851 }, { negated: true, cc: 5852 }, { negated: true, cc: 5853 }], {}], [1, "uregina", 1, "^https?://(\\w+\\.)?uregina\\.ca/", 22, [5854], [{ e: 5855 }], [{ v: 5854 }], [{ h: 5854 }], [{ check: "none", v: 5854 }], {}], [1, "urvaerket", 2, "^https?://(www\\.)?(urvaerket\\.dk|uret\\.se|urverket\\.no|laatukellot\\.fi|thewatchagency\\.com)/", 22, [5856], [{ e: 5857 }], [{ v: 5857 }], [{ c: 5858 }], [{ cc: 5732 }], {}], [1, "usherbrooke", 2, "^https?://(\\w+\\.)?usherbrooke\\.ca/", 22, [5859], [{ e: 5860 }], [{ v: 368 }], [{ c: 5861 }, { wv: 5862 }, { if: { e: 3804 }, then: [{ k: 3805 }] }, { if: { e: 5863 }, then: [{ k: 5864 }] }, { retry: 3, retryInterval: 600, c: 5862 }, { check: "none", wv: 5865 }], [], {}], [1, "uswitch.com", 2, "^https://(www\\.)?uswitch\\.com/", 10, [5866], [{ e: 5867 }], [{ v: 5867 }], [{ c: 5868 }], [], {}], [1, "uttings.co.uk", 2, "^https?://(www\\.)?uttings\\.co\\.uk/", 22, [1135, 5869], [{ e: 5870 }], [{ v: 5870 }], [{ c: 5870 }, { waitForVisible: ["#colorbox iframe.cboxIframe", "#cookie_notice_save"], timeout: 1e4 }, { click: ["#colorbox iframe.cboxIframe", ".cookie-field input[type=checkbox]:checked:not(:disabled)"], all: true, optional: true }, { waitForThenClick: ["#colorbox iframe.cboxIframe", "#cookie_notice_save"], timeout: 1e4, retry: 5, retryInterval: 1e3 }], [{ cc: 5871 }], {}], [1, "uwv-nl", 0, "^https?://(?:www\\.)?uwv\\.nl/", 10, [5872], [{ e: 5872 }], [{ v: 5873 }], [{ c: 5873 }], [{ check: "none", timeout: 2e3, wv: 5873 }], {}], [1, "vantilburgonline", 2, "^https?://(www\\.)?vantilburgonline\\.nl/", 22, [], [{ e: 5874 }], [{ v: 5874 }], [{ c: 5875 }, { c: 5876 }, { c: 5877 }], [{ cc: 5878 }], {}], [1, "vardgivarguiden.se", 2, "^https?://(\\w+\\.)?vardgivarguiden\\.se/", 22, [5879], [{ e: 5880 }], [{ v: 5880 }], [{ wv: 5880 }, { all: true, optional: true, k: 5881 }, { c: 5880 }], [{ cc: 5882 }], {}], [1, "vd-ch", 0, "^https?://(\\w+\\.)?vd\\.ch/", 22, [], [{ e: 5883 }], [{ v: 5883 }], [{ c: 5883 }], [{ cc: 5884 }], {}], [1, "venngage.com", 2, "^https?://(\\w+\\.)?venngage\\.com/", 22, [5885, 5886], [{ e: 5887 }, { v: 5888 }], [{ v: 5888 }], [{ c: 5887 }, { c: 5889 }], [{ cc: 5890 }], {}], [1, "vgn.de", 2, "^https?://(\\w+\\.)?vgn\\.de/", 22, [5891], [{ e: 5892 }], [{ v: 5893 }], [{ if: { e: 5894 }, then: [{ all: true, k: 5894 }] }, { c: 5892 }, { check: "none", timeout: 2e3, wv: 5893 }], [{ cc: 5895 }, { negated: true, cc: 5896 }], {}], [1, "viabcp", 2, "^https?://(www\\.)?viabcp\\.com/", 22, [5897], [{ e: 5898 }], [{ v: 5899 }], [{ c: 5899 }, { c: 5900 }], [{ cc: 5901 }, { cc: 5902 }], {}], [1, "vidal.ru", 2, "^https?://(www\\.)?vidal\\.ru/", 22, [5903], [{ e: 5904 }], [{ v: 5903 }], [{ c: 5905 }], [{ cc: 5906 }], {}], [1, "vinnies-org-au", 1, "^https?://(\\w+\\.)?vinnies\\.org\\.au/", 22, [5907], [{ e: 5908 }], [{ v: 5907 }], [{ h: 5907 }], [], {}], [1, "vinnova-se", 2, "^https?://(www\\.)?vinnova\\.se/", 22, [5909], [{ e: 5910 }], [{ v: 5910 }], [{ c: 5911 }, { wv: 5912 }, { if: { e: 5913 }, then: [{ k: 5913 }] }, { c: 5914 }], [{ cc: 5915 }], {}], [1, "virginwines.co.uk", 2, "^https?://(www\\.)?virginwines\\.co\\.uk/", 22, [5916], [{ e: 5916 }], [{ visible: ["wc-consent-modal", "#wc-consent-modal__rejectCookies"] }], [{ waitForThenClick: ["wc-consent-modal", "#wc-consent-modal__rejectCookies"] }], [{ cc: 5917 }], {}], [1, "visit-x.net", 2, "^https?://(\\w+\\.)?visit-x\\.(net|us|co\\.uk)/", 22, [5918], [{ e: 5919 }], [{ v: 5919 }], [{ c: 5920 }, { c: 5921 }], [{ cc: 5922 }], {}], [1, "vmock", 2, "^https?://(\\w+\\.)?vmock\\.com/", 22, [5923, 5924], [{ e: 5925 }], [{ v: 5925 }], [{ c: 5925 }, { c: 5926 }, { timeout: 2e3, check: "none", wv: 5924 }], [{ cc: 3012 }], {}], [1, "vodafone.de", 2, "^https://www\\.vodafone\\.de/", 22, [5927], [{ e: 5928 }], [{ v: 5929 }], [{ k: 5930 }], [], {}], [1, "vogue.nl", 2, "^https?://(\\w+\\.)?vogue\\.nl/", 22, [5931], [{ e: 5932 }], [{ v: 5933 }], [{ if: { e: 5934 }, then: [{ k: 5934 }] }, { c: 5935 }], [{ cc: 5936 }], {}], [1, "volvocars-com", 2, "^https://([a-z0-9-]+\\.)?volvocars\\.com/", 10, [5937], [{ exists: ["cookie-banner#cookie-banner-host", "#dialog_cookie_consent"] }], [{ visible: ["cookie-banner#cookie-banner-host", "#dialog_cookie_consent"] }], [{ wait: 500 }, { if: { exists: ["cookie-banner#cookie-banner-host", "#onetrust-reject-all-handler"] }, then: [{ waitForThenClick: ["cookie-banner#cookie-banner-host", "#onetrust-reject-all-handler"] }], else: [{ waitForThenClick: ["cookie-banner#cookie-banner-host", "#onetrust-pc-btn-handler"] }, { c: 2903 }] }, { waitForVisible: ["cookie-banner#cookie-banner-host", "#dialog_cookie_consent"], check: "none", timeout: 5e3 }], [{ cc: 2906 }, { cc: 5938 }, { cc: 5939 }], {}], [1, "vowels", 1, "^https://(www\\.)?vowels\\.(net|jp)/", 22, [5940], [{ e: 5941 }], [{ v: 5942 }], [{ h: 5940 }], [], {}], [1, "vsco", 2, "^https?://(www\\.)?vsco\\.co/", 22, [5943], [{ v: 5943 }], [{ v: 5943 }], [{ c: 5944 }, { if: { e: 5945 }, then: [{ k: 5945 }, { timeout: 5e3, wv: 2903 }, { k: 2903 }, { check: "none", timeout: 3e3, optional: true, wv: 2902 }] }], [{ check: "none", v: 5943 }, { cc: 325 }], {}], [1, "vszutphen.nl", 2, "^https?://(www\\.)?vszutphen\\.nl/", 22, [5946], [{ e: 5946 }], [{ v: 5946 }], [{ c: 5947 }], [{ check: "none", timeout: 2e3, wv: 5946 }], {}], [1, "vystarcu.org", 2, "^https?://(www\\.)?vystarcu\\.org/", 22, [52], [{ e: 5948 }], [{ v: 52 }], [{ c: 5948 }, { wv: 5949 }, { all: true, optional: true, k: 5950 }, { c: 5951 }], [{ cc: 5952 }, { cc: 5953 }], {}], [1, "walmart-ca", 0, "^https?://(www\\.)?walmart\\.ca/", 22, [], [{ e: 5954 }], [{ v: 5954 }], [{ retry: 10, retryInterval: 1e3, c: 5955 }, { w: 5956 }, { all: true, optional: true, k: 5957 }, { c: 5958 }], [{ check: "none", timeout: 5e3, wv: 5954 }, { cc: 5959 }], {}], [1, "warszawa19115.pl", 2, "^https?://(\\w+\\.)?warszawa19115\\.pl/", 22, [], [{ e: 5960 }], [{ v: 5960 }], [{ c: 5961 }, { wv: 5962 }, { if: { e: 5963 }, then: [{ all: true, k: 5963 }] }, { k: 5962 }], [{ check: "none", timeout: 3e3, wv: 5964 }], {}], [1, "web-rewind.com", 0, "^https?://(www\\.)?web-rewind\\.com/", 22, [], [{ e: 5965 }], [{ v: 5965 }], [{ all: true, timeout: 500, optional: true, c: 5966 }, { c: 5965 }], [], {}], [1, "welcome-city-yokohama", 1, "^https?://(www\\.)?welcome\\.city\\.yokohama\\.jp/", 22, [738], [{ e: 739 }], [{ v: 739 }], [{ h: 738 }, { timeout: 8e3, optional: true, w: 3638 }, { if: { e: 3638 }, then: [{ if: { e: 1397 }, then: [{ c: 1397 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [], {}], [1, "westminster.ac.uk", 2, "^https?://(\\w+\\.)?westminster\\.ac\\.uk/", 22, [5967], [{ e: 5968 }], [{ v: 5969 }], [{ c: 5970 }, { wv: 5971 }, { all: true, optional: true, k: 5972 }, { k: 5971 }], [{ cc: 5973 }, { cc: 5974 }], {}], [1, "what3words", 2, "^https?://(\\w+\\.)?what3words\\.com/", 22, [], [{ e: 5975 }], [{ check: "any", v: 5975 }], [{ if: { e: 5976 }, then: [{ k: 5976 }, { c: 5977 }], else: [{ k: 5978 }, { c: 5979 }] }, { timeout: 4e3, optional: true, wv: 1424 }, { if: { v: 1424 }, then: [{ k: 1397 }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ any: [{ cc: 5732 }, { cc: 5980 }] }], {}], [1, "whatnot", 2, "^https?://(www\\.)?whatnot\\.com/", 22, [5981], [{ e: 5982 }], [{ v: 5981 }], [{ c: 5983 }], [{ cc: 5984 }], {}], [1, "wildling-com", 1, "^https://(www\\.)?wildling\\.com/", 22, [5985], [{ e: 5986 }], [{ v: 5986 }], [{ h: 5985 }], [], {}], [1, "wochenmarktfinder.de", 2, "^https?://(\\w+\\.)?wochenmarktfinder\\.de/", 22, [5987], [{ e: 5987 }], [{ v: 5988 }], [{ c: 5988 }], [], {}], [1, "wojsko-polskie-pl", 1, "^https?://(www\\.)?wojsko-polskie\\.pl/", 22, [5989], [{ e: 5990 }], [{ v: 5989 }], [{ h: 5989 }], [], {}], [1, "wow-forever.gg", 2, "^https?://(www\\.)?wow-forever\\.gg/", 22, [5991], [{ e: 5992 }], [{ v: 5992 }], [{ c: 5992 }], [{ check: "none", v: 5991 }], {}], [1, "xe.com", 2, "^https?://(www\\.)?xe\\.com/", 22, [5993, 5994], [{ e: 5995 }], [{ v: 5995 }], [{ retry: 3, retryInterval: 500, c: 5996 }, { wv: 5997 }, { c: 5998 }], [{ cc: 5999 }], {}], [1, "xhamster-eu", 2, "^https://(\\w+\\.)?(xhamster\\d*\\.(com|desi)|xh(wide|open|access|vid|fanclub|stream|name|spot|fuck|social)\\d*\\.com|xhzone\\.live)/", 22, [6e3], [{ e: 6001 }], [{ v: 6001 }], [{ wv: 6002 }, { wait: 500 }, { k: 6002 }, { optional: true, h: 6003 }], [], {}], [1, "xhamster-us", 1, "^https://(\\w+\\.)?(xhamster\\d*\\.(com|desi)|xh(wide|open|access|vid|fanclub|stream|name|spot|fuck|social)\\d*\\.com|xhzone\\.live)/", 22, [6004], [{ e: 6004 }], [{ v: 6005 }], [{ h: 6004 }], [], {}], [1, "xlbygg.se", 2, "^https?://(\\w+\\.)?xlbygg\\.se/", 22, [], [{ e: 6006 }], [{ v: 6007 }], [{ c: 6008 }, { wv: 6009 }, { all: true, optional: true, k: 6010 }, { k: 6006 }], [{ cc: 6011 }], {}], [1, "xtb", 2, "^https?://(www\\.)?xtb\\.com/", 22, [6012, 5215], [{ e: 6013 }], [{ v: 6012 }], [{ c: 6014 }, { wv: 6015 }, { all: true, optional: true, k: 6016 }, { k: 6015 }], [{ check: "none", wv: 6012 }, { cc: 6017 }], {}], [1, "xvideos", 2, "^https://[a-z]*\\.xvideos\\.com/", 22, [], [{ e: 3235 }], [{ v: 3236 }], [{ c: 3237 }], [], {}], [1, "yachtclubgames.com", 2, "^https?://(www\\.)?yachtclubgames\\.com/", 22, [6018], [{ e: 6018 }], [{ v: 6018 }], [{ c: 6019 }], [{ timeout: 1e3, check: "none", wv: 6018 }], {}], [1, "Yahoo", 2, "^https://consent\\.yahoo\\.com/v2/", 22, [2805], [{ e: 6020 }], [{ v: 6020 }], [{ c: 6021 }], [], {}], [1, "ynjn", 2, "^https?://(www\\.)?ynjn\\.jp/", 22, [6022], [{ e: 6022 }], [{ v: 6023 }], [{ c: 6024 }], [{ timeout: 1e3, check: "none", wv: 6023 }], {}], [1, "yourparkingspace", 2, "^https?://(www\\.)?yourparkingspace\\.(co\\.uk|ie)/", 22, [6025], [{ e: 6025 }], [{ v: 6025 }], [{ retry: 5, retryInterval: 500, c: 6026 }, { wv: 6027 }, { all: true, optional: true, k: 6028 }, { retry: 3, c: 6027 }], [{ cc: 707 }], {}], [1, "yourspares", 2, "^https?://(www\\.)?yourspares\\.co\\.uk/", 22, [6029, 6030], [{ e: 6031 }], [{ v: 6029 }], [{ w: 6032 }, { k: 6032 }, { check: "none", wv: 6029 }], [{ cc: 6033 }], {}], [1, "yuntrack", 2, "^https://(www\\.|m\\.)?yuntrack\\.com/", 22, [3715], [{ e: 6034 }], [{ v: 3715 }], [{ c: 6034 }, { wv: 6035 }, { if: { e: 6036 }, then: [{ all: true, k: 6036 }] }, { c: 6037 }], [{ cc: 6038 }], {}], [1, "zentralruf-de", 2, "^https://(www\\.)?zentralruf\\.de", 22, [], [{ e: 6039 }], [{ v: 6039 }], [{ optional: true, k: 6040 }, { c: 6039 }], [{ check: "none", timeout: 2e3, wv: 6039 }], {}], [1, "zinio", 0, "^https://(www\\.)?zinio\\.com/", 22, [], [{ e: 6041 }], [{ v: 6041 }], [{ c: 6042 }, { c: 6043 }], [{ cc: 6044 }], {}], [1, "ziptozipmoving", 2, "^https://(www\\.)?ziptozipmoving\\.com/", 22, [], [{ e: 6045 }], [{ v: 6045 }], [{ c: 6046 }, { wv: 6047 }, { all: true, optional: true, k: 6048 }, { c: 6049 }], [{ cc: 6050 }], {}], [1, "zoomalia", 2, "^https?://(www\\.)?zoomalia\\.\\w+/", 22, [], [{ e: 6051 }], [{ v: 6051 }], [{ c: 6052 }], [{ cc: 6053 }, { cc: 6054 }], {}], [1, "zorgenzekerheid.nl", 2, "^https?://(www\\.)?zorgenzekerheid\\.nl/", 22, [6055], [{ exists: ["zz-cookie-banner", "zz-drawer"] }], [{ visible: ["zz-cookie-banner[visible]", "zz-drawer"] }], [{ waitForThenClick: ["zz-cookie-banner", ".footer zz-button[variant=ghost]", "button"] }, { waitForVisible: ["zz-cookie-banner[visible]", "zz-drawer"], check: "none" }], [{ cc: 6056 }, { cc: 6057 }], {}], [1, "zr.ru", 2, "^https?://(\\w+\\.)?zr\\.ru/", 22, [6058], [{ e: 6059 }], [{ v: 6058 }], [{ c: 6059 }, { timeout: 6e3, optional: true, w: 1424 }, { if: { e: 1424 }, then: [{ if: { e: 1397 }, then: [{ k: 1397 }], else: [{ e: 1398 }] }, { all: true, optional: true, k: 1399 }, { optional: true, k: 1400 }] }], [{ check: "none", wv: 6058 }], {}]], index: { genericRuleRange: [0, 719], frameRuleRange: [719, 741], specificRuleRange: [719, 1601], genericStringEnd: 3272, frameStringEnd: 3321 } };

  // PouBrowser start-up (replaces standalone/content.ts): rejects cookie banners and tells the app.
  if (!window.autoconsentReceiveMessage) {
    const consent = new AutoConsent(async (message) => {
      if (message.type === "autoconsentDone" && typeof pouTell === "function") pouTell("cookies", message.cmp || "");
    });
    window.autoconsentReceiveMessage = (message) => Promise.resolve(consent.receiveMessageCallback(message));
    consent.initialize({
      isMainWorld: true,
      autoAction: "optOut",
      enableHeuristicDetection: true,
      heuristicMode: "tier2",
      logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false }
    }, {
      autoconsent: [],
      compact: filterCompactRules(compact_rules_default, { url: window.location.href, mainFrame: window.top === window })
    });
  }
})();
