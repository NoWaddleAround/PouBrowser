const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/captions.js'), 'utf8');

function setup(responses = {}) {
    const listeners = new Map();
    const requested = [];
    const blobs = [];
    let resourceObserver;
    class Video {
        textTracks = [];
        append(element) {
            this.textTracks.push(element.track);
            element.remove = () => this.textTracks.splice(this.textTracks.indexOf(element.track), 1);
        }
    }
    const document = {
        fullscreenElement: null,
        createElement: () => ({ track: { kind: 'subtitles', mode: 'disabled' } }),
    };
    class RecordingBlob extends Blob {
        constructor(parts, options) {
            super(parts, options);
            blobs.push(parts.join(''));
        }
    }
    vm.runInNewContext(source, {
        AbortController, Blob: RecordingBlob, URL, document,
        addEventListener: (type, callback) => listeners.set(type, callback),
        HTMLVideoElement: Video,
        PerformanceObserver: class {
            constructor(callback) { resourceObserver = callback; }
            observe() {}
        },
        fetch: async url => {
            requested.push(url);
            const text = responses[url] ?? 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nTest\n';
            return { ok: true, text: async () => text };
        },
    });
    return {
        video: new Video(), requested, blobs,
        resources: (...names) => resourceObserver({ getEntries: () => names.map(name => ({ name })) }),
        fire: (type, target) => listeners.get(type)({ target }),
        fullscreen: element => {
            document.fullscreenElement = element;
            listeners.get('fullscreenchange')();
        },
    };
}

test('preloads dialogue, shows it on fullscreen video, and removes it when the source changes', async () => {
    const page = setup();
    const subtitle = 'https://subst.krussdomi.com/dialogue.vtt?q=1';
    page.resources('https://subst.krussdomi.com/preview.vtt', subtitle);
    page.fire('play', page.video);
    await new Promise(setImmediate);
    assert.deepEqual(page.requested, [subtitle]);
    const [track] = page.video.textTracks;
    assert.equal(track.mode, 'hidden');
    page.fullscreen(page.video);
    assert.equal(track.mode, 'showing');
    page.fullscreen(null);
    assert.equal(track.mode, 'hidden');
    page.fire('emptied', page.video);
    assert.equal(page.video.textTracks.length, 0);
});

test('converts SRT and ASS subtitles into WebVTT tracks cleanly', async () => {
    const srtUrl = 'https://cdn.example/subs/ep1.srt';
    const assUrl = 'https://cdn.example/subs/ep1.ass';
    const page = setup({
        [srtUrl]: '1\r\n00:00:01,250 --> 00:00:03,500\r\nHello world\r\n',
        [assUrl]: '[Script Info]\nTitle: Ep1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:01:02.34,0:01:05.00,Default,,0,0,0,,{\\an8\\i1}Line one\\NLine two, indeed!\n',
    });

    page.resources(srtUrl);
    page.fire('play', page.video);
    await new Promise(setImmediate);
    assert.match(page.blobs[0], /^WEBVTT\n\n1\n00:00:01\.250 --> 00:00:03\.500\nHello world/);

    page.resources(assUrl);
    await new Promise(setImmediate);
    assert.equal(
        page.blobs[1],
        'WEBVTT\n\n00:01:02.340 --> 00:01:05.000\nLine one\nLine two, indeed!\n',
    );
});

test('leaves a visible website track and fullscreen player overlays alone', () => {
    const page = setup();
    const hidden = { kind: 'subtitles', mode: 'hidden', cues: [{}] };
    page.video.textTracks.push(hidden, { kind: 'captions', mode: 'showing' });
    page.fire('play', page.video);
    page.fullscreen(page.video);
    assert.equal(hidden.mode, 'hidden');
    page.video.textTracks.pop();
    page.fullscreen({ player: page.video });
    assert.equal(hidden.mode, 'hidden');
    assert.deepEqual(page.requested, []);
});
