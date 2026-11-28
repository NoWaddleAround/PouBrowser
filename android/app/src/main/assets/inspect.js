// "Inspect element" (developer tools): marks what the finger is on with a box, and the next tap reports that element
// (path, size, HTML) instead of clicking it. Same channel and pattern as pick.js, but nothing is hidden.
(() => {
    const report = window.pouPick;
    if (!report || window.__pouPicking) return;
    window.__pouPicking = true;
    const element = event => {
        let node = event.target;
        while (node && node.nodeType !== 1) node = node.parentElement;
        return node;
    };
    // A box over the element, not an outline on it: Dark Reader rewrites inline styles, which would show in the HTML.
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;' +
        'border:2px solid #1a73e8;background:rgba(26,115,232,.15)';
    const mark = event => {
        const target = element(event);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        Object.assign(box.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
        if (!box.isConnected) document.documentElement.appendChild(box);
    };
    const pick = event => {
        const target = element(event);
        if (!event.isTrusted || !target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        box.remove();
        removeEventListener('touchstart', mark, true);
        removeEventListener('pointerover', mark, true);
        removeEventListener('click', pick, true);
        window.__pouPicking = false;
        const path = [];
        for (let node = target; node && node.nodeType === 1 && path.length < 6; node = node.parentElement) {
            path.unshift(node.localName + (node.id ? '#' + node.id : '') + [...node.classList].slice(0, 3).map(name => '.' + name).join(''));
        }
        const size = target.getBoundingClientRect();
        try {
            report.postMessage('inspect:' + path.join(' > ') + '  ' + Math.round(size.width) + '×' + Math.round(size.height) + '\n' +
                target.outerHTML.slice(0, 4000));
        } catch (_) {}
    };
    addEventListener('touchstart', mark, { capture: true, passive: true });
    addEventListener('pointerover', mark, true);
    addEventListener('click', pick, true);
})();
