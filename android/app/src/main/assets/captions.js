(() => {
    let current, candidate, prepared, visible;
    const seen = new Set();

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
            const text = await response.text();
            if (prepared !== loading) return;
            const element = document.createElement('track');
            element.kind = 'subtitles';
            element.label = 'Untertitel';
            element.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
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
                if (!/\.vtt$/i.test(path) || /preview|thumb|storyboard|sprite/i.test(path)) continue;
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
