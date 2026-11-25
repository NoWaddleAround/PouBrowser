(() => {
    let current, candidate, prepared, visible;
    const seen = new Set();

    function toWebVTT(raw, url) {
        const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch (_) { return ''; } })();
        const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (/^WEBVTT(\s|$)/.test(text)) return text;
        if (path.endsWith('.ass') || path.endsWith('.ssa') || /^\[Script Info\]/im.test(text)) {
            const lines = text.split('\n');
            let format = null;
            const cues = [];
            const stamp = value => {
                const m = value.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2,3})$/);
                if (!m) return null;
                const ms = m[4].length === 2 ? m[4] + '0' : m[4];
                return m[1].padStart(2, '0') + ':' + m[2] + ':' + m[3] + '.' + ms;
            };
            for (const line of lines) {
                if (/^Format:/i.test(line)) {
                    format = line.slice(7).split(',').map(part => part.trim().toLowerCase());
                    continue;
                }
                if (!/^Dialogue:/i.test(line) || !format) continue;
                const body = line.slice(9).trimStart();
                const parts = [];
                let rest = body;
                for (let i = 0; i < format.length - 1; i++) {
                    const comma = rest.indexOf(',');
                    if (comma < 0) break;
                    parts.push(rest.slice(0, comma));
                    rest = rest.slice(comma + 1);
                }
                parts.push(rest);
                const start = stamp(parts[format.indexOf('start')] || '');
                const end = stamp(parts[format.indexOf('end')] || '');
                const rawText = parts[format.indexOf('text')] || '';
                const cleaned = rawText.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
                if (start && end && cleaned) cues.push(start + ' --> ' + end + '\n' + cleaned);
            }
            return cues.length ? 'WEBVTT\n\n' + cues.join('\n\n') + '\n' : null;
        }
        if (path.endsWith('.srt') || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) {
            const converted = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
            return 'WEBVTT\n\n' + converted;
        }
        return null;
    }

    function restore() {
        if (!visible) return;
        visible.track.mode = visible.mode;
        visible = undefined;
    }

    function discard() {
        restore();
        if (!prepared) return;
        prepared.abort.abort();
        if (prepared.element) {
            prepared.element.remove();
            URL.revokeObjectURL(prepared.element.src);
        }
        prepared = undefined;
    }

    function nativeTrack(video) {
        const tracks = Array.from(video.textTracks).filter(track => track !== prepared?.element?.track &&
            (track.kind === 'subtitles' || track.kind === 'captions'));
        return tracks.find(track => track.mode === 'showing') ??
            tracks.find(track => track.mode === 'hidden' && track.cues?.length);
    }

    function update() {
        const full = document.fullscreenElement || document.webkitFullscreenElement;
        const track = full === current && current ? nativeTrack(current) ?? prepared?.element?.track : null;
        if (visible?.track === track) return;
        restore();
        if (track && track.mode !== 'showing') {
            visible = { track, mode: track.mode };
            track.mode = 'showing';
        }
    }

    async function prepare() {
        if (!current || !candidate || nativeTrack(current) || prepared?.url === candidate) return;
        discard();
        const loading = { url: candidate, video: current, abort: new AbortController(), element: null };
        prepared = loading;
        try {
            const response = await fetch(loading.url, { signal: loading.abort.signal });
            if (!response.ok) return;
            const vtt = toWebVTT(await response.text(), loading.url);
            if (!vtt || prepared !== loading) return;
            const element = document.createElement('track');
            element.kind = 'subtitles';
            element.label = 'Untertitel';
            element.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
            loading.element = element;
            loading.video.append(element);
            element.track.mode = 'hidden';
            update();
        } catch (_) {}
    }

    if (typeof PerformanceObserver !== 'undefined') {
        new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (seen.has(entry.name) || !/^https?:\/\//i.test(entry.name)) continue;
                const path = new URL(entry.name).pathname;
                if (!/\.(vtt|srt|ass|ssa)$/i.test(path) || /preview|thumb|storyboard|sprite/i.test(path)) continue;
                seen.add(entry.name);
                candidate = entry.name;
            }
            prepare();
        }).observe({ type: 'resource', buffered: true });
    }

    addEventListener('play', event => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        if (current && current !== event.target) {
            if (prepared?.element) candidate = undefined;
            discard();
        }
        current = event.target;
        prepare();
    }, true);
    addEventListener('emptied', event => {
        if (event.target !== current) return;
        discard();
        candidate = current = undefined;
    }, true);
    addEventListener('fullscreenchange', update, true);
    addEventListener('webkitfullscreenchange', update, true);
})();
