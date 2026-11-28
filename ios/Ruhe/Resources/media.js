// Long press (or right click) on a video or audio player reports its file to the app, which offers to
// download it. Images go through the apps' own long-press menus; `pouImageAtPress` finds the image under
// the last press for iOS, also when a see-through layer covers it. Shared by iOS, Mac and Android.
(() => {
    if (window.pouImageAtPress) return;
    const tell = data => {
        const text = JSON.stringify(data);
        try { webkit.messageHandlers.download.postMessage(text); return; } catch (error) {}
        try { pouMedia.postMessage(text); } catch (error) {}
    };
    const absolute = url => { try { return new URL(url, location.href).href; } catch (error) { return ''; } };
    const under = (x, y, tags) => document.elementsFromPoint(x, y).find(element => tags.includes(element.localName));
    const source = media => absolute(media.currentSrc || media.src
        || (media.querySelector('source[src]') || {}).src || '');

    let press = { x: 0, y: 0, time: 0 }, told = 0, timer = 0;
    const report = (x, y) => {
        const media = under(x, y, ['video', 'audio']);
        if (!media || Date.now() - told < 1000) return false;
        told = Date.now();
        const url = source(media);
        // A blob: address is a stream the player assembles piece by piece (YouTube and most video sites),
        // an .m3u8 one a playlist of pieces: neither is one file to save.
        const stream = !url || url.startsWith('blob:') || /\.m3u8(\?|#|$)/i.test(url);
        tell({ kind: media.localName, url: stream ? '' : url, stream, title: document.title });
        return true;
    };
    addEventListener('pointerdown', event => { press = { x: event.clientX, y: event.clientY, time: Date.now() }; }, true);
    addEventListener('touchstart', event => {
        clearTimeout(timer);
        if (event.touches.length !== 1) return;
        const { clientX: x, clientY: y } = event.touches[0];
        timer = setTimeout(() => report(x, y), 550);
    }, { capture: true, passive: true });
    const cancel = () => clearTimeout(timer);
    addEventListener('touchend', cancel, true);
    addEventListener('touchcancel', cancel, true);
    addEventListener('touchmove', event => {
        const touch = event.touches[0];
        if (touch && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) cancel();
    }, { capture: true, passive: true });
    addEventListener('contextmenu', event => {
        if (report(event.clientX, event.clientY)) event.preventDefault();
    }, true);

    // Video tools from the app's menu: speed, jumps and a volume boost for the video or audio that played last.
    // Answers a short code the app turns into its own words.
    let last = null;
    addEventListener('play', event => {
        const media = event.composedPath()[0];
        if (media instanceof HTMLMediaElement) last = media;
    }, true);
    const boosts = new WeakMap();
    window.pouVideo = (action, value) => {
        const media = last && last.isConnected ? last
            : [...document.querySelectorAll('video, audio')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        if (!media) return 'none';
        if (action === 'speed') {
            media.playbackRate = value;
            return 'speed:' + value;
        }
        if (action === 'seek') {
            media.currentTime = Math.max(0, Math.min(media.currentTime + value, media.duration || Infinity));
            return 'seek:' + value;
        }
        if (action === 'boost') {
            let gain = boosts.get(media);
            if (!gain) {
                if (value === 1) return 'boost:1';
                // Sound from another server without CORS would come out of Web Audio silent.
                const url = media.currentSrc || '';
                let own = /^(blob|data):/.test(url) || media.crossOrigin !== null;
                try { own = own || new URL(url, location.href).origin === location.origin; } catch (error) {}
                if (!own) return 'boost-foreign';
                const context = new (window.AudioContext || window.webkitAudioContext)();
                gain = context.createGain();
                context.createMediaElementSource(media).connect(gain).connect(context.destination);
                boosts.set(media, gain);
            }
            gain.gain.value = value;
            gain.context.resume();
            return 'boost:' + value;
        }
        return 'none';
    };

    window.pouImageAtPress = () => {
        if (Date.now() - press.time > 5000) return null;
        const image = under(press.x, press.y, ['img']);
        const url = image ? absolute(image.currentSrc || image.src) : '';
        return /^https?:/.test(url) ? url : null;
    };
})();
