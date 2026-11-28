// "Hide element": outlines what the finger is on, and the next tap hides it instead of clicking it.
// The app stores the reported selector and hides the element on every later visit of the site.
(() => {
    const report = window.pouPick;
    if (!report || window.__pouPicking) return;
    window.__pouPicking = true;
    const simple = /^[A-Za-z][\w-]*$/;
    const element = event => {
        let node = event.target;
        while (node && !(node instanceof HTMLElement)) node = node.parentElement;
        return node === document.body || node === document.documentElement ? null : node;
    };
    let marked = null, before = '';
    const unmark = () => {
        if (marked) marked.style.setProperty('outline', before);
        marked = null;
    };
    const mark = event => {
        const target = element(event);
        if (!target || target === marked) return;
        unmark();
        marked = target;
        before = target.style.getPropertyValue('outline');
        target.style.setProperty('outline', '3px solid #e5484d', 'important');
    };
    // The id if it is a plain one, else up to five levels of tag.class:nth-of-type(n), up to an id or the body.
    const selector = target => {
        if (simple.test(target.id)) return '#' + target.id;
        const parts = [];
        for (let node = target; node && parts.length < 5; node = node.parentElement) {
            if (node === document.body) { parts.unshift('body'); break; }
            if (simple.test(node.id)) { parts.unshift('#' + node.id); break; }
            const same = [...(node.parentElement?.children ?? [])].filter(other => other.localName === node.localName);
            const classes = [...node.classList].filter(name => simple.test(name)).map(name => '.' + name).join('');
            parts.unshift(node.localName + classes + ':nth-of-type(' + (same.indexOf(node) + 1) + ')');
        }
        return parts.join(' > ');
    };
    const pick = event => {
        const target = element(event);
        if (!event.isTrusted || !target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        unmark();
        removeEventListener('touchstart', mark, true);
        removeEventListener('pointerover', mark, true);
        removeEventListener('click', pick, true);
        window.__pouPicking = false;
        target.style.setProperty('display', 'none', 'important');
        try { report.postMessage(selector(target)); } catch (_) {}
    };
    addEventListener('touchstart', mark, { capture: true, passive: true });
    addEventListener('pointerover', mark, true);
    addEventListener('click', pick, true);
})();
