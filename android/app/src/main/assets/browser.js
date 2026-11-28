(() => {
    if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
    // Global Privacy Control signal.
    try { Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true, configurable: true }); } catch (_) {}

    // Tells the app which link or form the finger is on, so it can tell a tapped link from a script
    // that sends the tab elsewhere during the same tap. Sent at touch time, well before the navigation.
    // The reporting object is taken off the page so page scripts cannot vouch for their own redirects.
    let report;
    const takeReport = () => {
        if (!report && window.pouTap) {
            report = window.pouTap;
            try { delete window.pouTap; } catch (_) {}
        }
        return report;
    };
    takeReport();
    const tell = (url, form) => {
        try { takeReport()?.postMessage(JSON.stringify({ url: new URL(url, location.href).href, form })); } catch (_) {}
    };
    const note = event => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        const link = event.target.closest('a[href], area[href]');
        if (link) return tell(link.href, false);
        const control = event.type === 'keydown' ? event.target
            : event.target.closest('button, input[type="submit"], input[type="image"]');
        // `formAction` without the attribute gives the page's own address, not the form's.
        if (control?.form) tell(control.hasAttribute('formaction') ? control.formAction : control.form.action, true);
    };
    for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, note, true);

    addEventListener('click', event => {
        if (!event.isTrusted || event.button !== 0 || !(event.target instanceof Element)) return;
        const link = event.target.closest('a[href][target="_blank"]:not([download])');
        if (link && link.origin === location.origin) link.target = '_self';
    }, true);

    // An empty layer over the page that answers a tap with a popup is an ad trap (kaa.to puts one over
    // its video player). Taps fall through it from then on, so the next one reaches what lies underneath.
    // The script also gets a window that does nothing: one that sees its popup fail swallows every
    // following tap and tries again.
    let tapped, tappedAt = 0;
    addEventListener('pointerdown', event => {
        if (!event.isTrusted || !(event.target instanceof HTMLElement)) return;
        tapped = event.target;
        tappedAt = Date.now();
    }, true);
    const decoy = new Proxy(function () {}, {
        get: (_, key) => key === 'closed' ? false : key === Symbol.toPrimitive ? () => '' : decoy,
        set: () => true,
        apply: () => decoy,
        construct: () => decoy,
    });
    const open = window.open;
    // Set by the app before this script, only on sites where the user allowed popups.
    const allowPopups = window.__pouPopups === true;
    try { delete window.__pouPopups; } catch (_) {}
    const kaa = /(^|\.)(kaa\.to|kaa\.lt|kaa\.mx|krussdomi\.com)$/i.test(location.hostname);
    if (!allowPopups) window.open = function (url) {
        if (tapped?.isConnected && Date.now() - tappedAt < 1000 &&
            !tapped.closest('a, button, input, select, textarea, label, video') && !tapped.innerText.trim() &&
            /^(fixed|absolute)$/.test(getComputedStyle(tapped).position)) {
            tapped.style.setProperty('pointer-events', 'none', 'important');
        }
        // Without the reporting channel the app only learns of a popup through the real call.
        if (!takeReport()) return kaa ? decoy : open.apply(this, arguments);
        try { report.postMessage(JSON.stringify({ popup: new URL(url || 'about:blank', location.href).href })); } catch (_) {}
        return decoy;
    };
})();
