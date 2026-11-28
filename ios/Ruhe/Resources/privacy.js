// Brave-style privacy in the page itself. Shared by iOS, Mac and Android; the apps wrap it in a function
// that defines `pouKey` (random per app start, never visible to the page) and `pouTell(kind, text)`.
// - Hyperlink auditing: <a ping> sends a tracking request on every click; the attribute goes before the click.
// - Fingerprinting: canvas, WebGL and audio readouts get a tiny change that is the same on one site for the
//   whole app session and different on every other site, so the readouts cannot link visits across sites.
//   `hardwareConcurrency` reports between 2 and the real count, the battery API is gone.
// - Clipboard: a page that swaps the text the user copies (commands, wallet addresses) is reported.
(() => {
    if (window.__pouPrivacy) return;
    Object.defineProperty(window, '__pouPrivacy', { value: true });

    // Wrapped functions still print as native code.
    const natives = new WeakMap();
    const toText = Function.prototype.toString;
    const asText = function toString() { return toText.call(natives.get(this) || this); };
    natives.set(asText, toText);
    Function.prototype.toString = asText;
    const wrap = (owner, name, make) => {
        const original = owner && owner[name];
        if (typeof original !== 'function') return;
        const replacement = make(original);
        natives.set(replacement, original);
        owner[name] = replacement;
    };

    // Hyperlink auditing.
    const unping = event => {
        const start = event.composedPath ? event.composedPath()[0] : event.target;
        const link = start && start.closest && start.closest('a[ping], area[ping]');
        if (link) link.removeAttribute('ping');
    };
    for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown']) {
        addEventListener(type, unping, { capture: true, passive: true });
    }

    // The seed: app session key and the registrable domain of the top page.
    const top = (() => {
        try { return window.top.location.hostname; } catch (error) {}
        const origins = location.ancestorOrigins;
        try { return new URL(origins[origins.length - 1]).hostname; } catch (error) { return location.hostname; }
    })();
    const site = (() => {
        if (/^[\d.]+$|:/.test(top)) return top;
        const labels = top.split('.');
        // shortcut: two-letter country domains like co.uk count as one suffix; a full list is not worth it here.
        const take = labels.length > 2 && labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
        return labels.slice(-take).join('.');
    })();
    const hash = text => {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return h >>> 0;
    };
    const seed = hash((typeof pouKey === 'string' ? pouKey : '') + '|' + site);
    const random = start => {
        let state = (seed ^ start) >>> 0;
        return () => {
            state = (state + 0x6D2B79F5) >>> 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    // Up to 24 colour bits change, at places fixed by the seed and the image size: invisible, and stable for one site.
    const farble = data => {
        const pixels = data.length >> 2;
        if (!pixels) return;
        const next = random(pixels);
        for (let i = 0; i < Math.min(pixels, 24); i++) data[(next() * pixels | 0) * 4 + (next() * 3 | 0)] ^= 1;
    };
    const Context2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    const readImage = Context2D && Context2D.getImageData;
    wrap(Context2D, 'getImageData', original => function getImageData() {
        const image = original.apply(this, arguments);
        farble(image.data);
        return image;
    });
    // toDataURL and toBlob export a changed copy; the page's own canvas stays as drawn.
    const changedCopy = canvas => {
        const width = canvas.width, height = canvas.height;
        if (!readImage || !width || !height || width * height > 4000000) return canvas;
        const copy = document.createElement('canvas');
        copy.width = width;
        copy.height = height;
        const context = copy.getContext('2d');
        context.drawImage(canvas, 0, 0);
        const image = readImage.call(context, 0, 0, width, height);
        farble(image.data);
        context.putImageData(image, 0, 0);
        return copy;
    };
    const Canvas = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
    for (const name of ['toDataURL', 'toBlob']) {
        wrap(Canvas, name, original => ({ [name]() {
            let source = this;
            try { source = changedCopy(this); } catch (error) {}   // a tainted canvas fails in the original call
            return original.apply(source, arguments);
        } })[name]);
    }
    for (const gl of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        wrap(gl && gl.prototype, 'readPixels', original => function readPixels() {
            original.apply(this, arguments);
            const pixels = arguments[6];
            if (pixels instanceof Uint8Array) farble(pixels);
        });
    }

    // Audio: a factor a hair away from 1 on the samples a fingerprint reads. Long buffers are real sound: left alone.
    const factor = 1 + (random(7)() - 0.5) * 1e-6;
    const changed = new WeakSet();
    wrap(window.AudioBuffer && AudioBuffer.prototype, 'getChannelData', original => function getChannelData() {
        const data = original.apply(this, arguments);
        if (data.length <= 200000 && !changed.has(data)) {
            changed.add(data);
            for (let i = 0; i < data.length; i++) data[i] *= factor;
        }
        return data;
    });
    wrap(window.AnalyserNode && AnalyserNode.prototype, 'getFloatFrequencyData', original => function getFloatFrequencyData(array) {
        original.apply(this, arguments);
        for (let i = 0; i < array.length; i++) array[i] *= factor;
    });

    // Device details.
    const Nav = window.Navigator && Navigator.prototype;
    const cores = Nav && Object.getOwnPropertyDescriptor(Nav, 'hardwareConcurrency');
    if (cores && cores.get) {
        const real = cores.get.call(navigator);
        const shown = real > 2 ? 2 + (seed % (real - 1)) : real;
        const get = { get hardwareConcurrency() { return shown; } };
        const getter = Object.getOwnPropertyDescriptor(get, 'hardwareConcurrency').get;
        natives.set(getter, cores.get);
        Object.defineProperty(Nav, 'hardwareConcurrency', { get: getter, configurable: true, enumerable: true });
    }
    if (Nav && 'getBattery' in Nav) delete Nav.getBattery;

    // Clipboard: the copy event's text against what was selected.
    let copying = null;
    wrap(window.DataTransfer && DataTransfer.prototype, 'setData', original => function setData(type, data) {
        if (copying && copying.data === this && /^text(\/plain)?$/i.test(type)) copying.text = String(data);
        return original.apply(this, arguments);
    });
    addEventListener('copy', event => {
        copying = { data: event.clipboardData, text: null, selected: String(getSelection() || '') };
        setTimeout(() => {
            const copy = copying;
            copying = null;
            const plain = text => text.replace(/\s+/g, ' ').trim();
            if (!copy || copy.text === null || !plain(copy.selected) || plain(copy.text) === plain(copy.selected)) return;
            if (typeof pouTell === 'function') pouTell('clipboard', copy.selected);
        }, 0);
    }, true);
})();
