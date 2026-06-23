import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

export type CharacterHeightChartEditorData = {
    version: 1
    height: {
        meters: number
    }
    image: null | {
        key: string
        contentType: string
        naturalWidth: number
        naturalHeight: number
        url: string
    }
    calibration: {
        headYPercent: number
        footYPercent: number
        footIsVirtual: boolean
    }
}

export type CharacterHeightChartEditorCharacter = {
    id: string
    userId: string
    name: string
    heightChart: CharacterHeightChartEditorData | null
}

type CharacterHeightChartEditorPageProps = {
    currentUser: CurrentUser
    character: CharacterHeightChartEditorCharacter
    mediaBaseUrl: string
}

function safeJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

function CharacterHeightChartEditorScript({
                                              character,
                                              csrfToken,
                                          }: {
    character: CharacterHeightChartEditorCharacter
    csrfToken: string
}) {
    return (
        <script dangerouslySetInnerHTML={{
            __html: `
const character = ${safeJson(character)};
const csrfToken = ${safeJson(csrfToken)};
const INCHES_PER_METER = 39.37007874015748;
const VIRTUAL_FOOT_MAX_PCT = 180;
const VIRTUAL_FOOT_START_PCT = 118;
const CHART_FRAME_PAD = 18;

const initialChart = character.heightChart || null;
const state = {
    heightMeters: initialChart ? initialChart.height.meters : 1.52,
    image: initialChart ? initialChart.image : null,
    topPct: initialChart ? initialChart.calibration.headYPercent : 5,
    bottomPct: initialChart ? initialChart.calibration.footYPercent : 95,
    croppedFeet: initialChart ? initialChart.calibration.footIsVirtual : false,
    previewSrc: initialChart && initialChart.image ? initialChart.image.url : '',
    pendingFile: null,
    objectUrl: ''
};

const els = {
    chartPlot: document.getElementById('height-chart-plot'),
    chartStatus: document.getElementById('height-chart-status'),
    heightFeet: document.getElementById('height-feet'),
    heightInches: document.getElementById('height-inches'),
    heightMeters: document.getElementById('height-meters'),
    imageInput: document.getElementById('height-chart-image'),
    removeImage: document.getElementById('remove-height-chart-image'),
    calibrationPanel: document.getElementById('height-chart-calibration'),
    calibrationFrame: document.getElementById('height-chart-calibration-frame'),
    saveButton: document.getElementById('save-height-chart'),
    toastRegion: document.querySelector('[data-height-chart-toast-region]')
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function imperialParts(meters) {
    const inches = Math.max(1, Math.round(meters * INCHES_PER_METER));
    return {
        feet: Math.floor(inches / 12),
        inches: inches % 12
    };
}

function formatHeight(meters) {
    const inches = Math.max(0, Math.round(meters * INCHES_PER_METER));
    return Math.floor(inches / 12) + ' ft ' + (inches % 12) + ' in';
}

function measuredPixels() {
    if (!state.image) return 1;
    return Math.max(1, ((state.bottomPct - state.topPct) / 100) * state.image.naturalHeight);
}

function niceStep(rawStep, candidates) {
    return candidates.find((candidate) => candidate >= rawStep) || candidates[candidates.length - 1];
}

function gridStep(maxMeters) {
    const maxFeet = maxMeters * INCHES_PER_METER / 12;
    const stepFeet = maxFeet <= 18
        ? 1
        : niceStep(maxFeet / 14, [2, 5, 10, 20, 50, 100, 200, 500]);

    return stepFeet * 12 / INCHES_PER_METER;
}

function gridLines(maxMeters) {
    const lines = [];
    const stepMeters = gridStep(maxMeters);

    for (let meters = 0; meters <= maxMeters + 0.001; meters += stepMeters) {
        const feet = Math.round(meters * INCHES_PER_METER / 12);
        lines.push({
            meters,
            label: feet + ' ft'
        });
    }

    const last = lines[lines.length - 1];
    if (last && Math.abs(last.meters - maxMeters) > stepMeters * 0.25) {
        lines.push({
            meters: maxMeters,
            label: formatHeight(maxMeters)
        });
    }

    return lines;
}

function calibrationSpace() {
    return state.croppedFeet ? VIRTUAL_FOOT_MAX_PCT : 100;
}

function calibrationMarkerTop(markerPct) {
    return (markerPct / calibrationSpace()) * 100;
}

function showToast(message, isSuccess) {
    if (!els.toastRegion) return;
    const toast = document.createElement('div');
    toast.className = 'alert shadow-lg ' + (isSuccess ? 'alert-success' : 'alert-error');
    toast.textContent = message || 'Request failed.';
    els.toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
}

function setLoading(isLoading) {
    if (!els.saveButton) return;
    els.saveButton.disabled = isLoading;
    els.saveButton.classList.toggle('loading', isLoading);
    els.saveButton.textContent = isLoading ? 'Saving...' : 'Save Height Data';
}

function syncHeightInputs() {
    const parts = imperialParts(state.heightMeters);
    if (els.heightFeet) els.heightFeet.value = String(parts.feet);
    if (els.heightInches) els.heightInches.value = String(parts.inches);
    if (els.heightMeters) els.heightMeters.value = state.heightMeters.toFixed(2);
}

function setCalibration(marker, valuePct) {
    if (marker === 'top') {
        state.topPct = clamp(valuePct, 0, Math.min(100, state.bottomPct - 2));
    } else {
        const maxFoot = state.croppedFeet ? VIRTUAL_FOOT_MAX_PCT : 100;
        state.bottomPct = clamp(valuePct, state.topPct + 2, maxFoot);
    }
}

function maxMeters() {
    if (!state.image) return 2;
    const maxFeet = state.heightMeters * INCHES_PER_METER / 12;
    return Math.max(2, Math.ceil(maxFeet) * 12 / INCHES_PER_METER);
}

function renderChart() {
    if (!els.chartPlot) return;

    if (!state.image || !state.previewSrc) {
        els.chartPlot.innerHTML = '<div class="height-chart-empty">No height data</div>';
        if (els.chartStatus) els.chartStatus.textContent = 'No height data';
        if (els.calibrationPanel) els.calibrationPanel.classList.add('hidden');
        return;
    }

    if (els.calibrationPanel) els.calibrationPanel.classList.remove('hidden');

    const plotHeight = Math.max(120, (els.chartPlot.clientHeight || 620) - CHART_FRAME_PAD * 2);
    const chartMax = maxMeters();
    const pxPerMeter = plotHeight / chartMax;
    const scale = (state.heightMeters * pxPerMeter) / measuredPixels();
    const imageWidth = Math.max(24, state.image.naturalWidth * scale);
    const imageHeight = Math.max(24, state.image.naturalHeight * scale);
    const imageBottomOffset = (((state.bottomPct / 100) * state.image.naturalHeight) - state.image.naturalHeight) * scale;
    const virtualFootGap = Math.max(0, imageBottomOffset);
    const lines = gridLines(chartMax).map((line) => (
        '<div class="height-chart-grid-line" style="bottom:' + (CHART_FRAME_PAD + line.meters * pxPerMeter) + 'px"><span>' + line.label + '</span></div>'
    ));

    const gap = virtualFootGap > 0
        ? '<div class="height-chart-virtual-foot" style="height:' + (virtualFootGap + imageHeight / 2) + 'px"></div>'
        : '';

    els.chartPlot.innerHTML = lines.join('') + [
        '<div class="height-chart-character" style="bottom:' + CHART_FRAME_PAD + 'px;width:' + imageWidth + 'px">',
        gap,
        '<img alt="' + escapeHtml(character.name) + '" src="' + escapeHtml(state.previewSrc) + '" style="width:' + imageWidth + 'px;height:' + imageHeight + 'px;bottom:' + imageBottomOffset + 'px">',
        '</div>'
    ].join('');
    if (els.chartStatus) els.chartStatus.textContent = character.name + ' / ' + formatHeight(state.heightMeters);
}

function renderCalibration() {
    if (!state.image || !state.previewSrc || !els.calibrationFrame) return;

    const space = calibrationSpace();
    const imageHeight = 10000 / space;
    const top = calibrationMarkerTop(state.topPct);
    const bottom = calibrationMarkerTop(state.bottomPct);
    const guideHeight = ((state.bottomPct - state.topPct) / space) * 100;
    const footLabel = state.croppedFeet ? 'Virtual foot' : 'Foot';

    els.calibrationFrame.classList.toggle('is-cropped', state.croppedFeet);
    els.calibrationFrame.innerHTML = [
        '<div class="height-chart-calibration-stage" style="--cal-image-height:' + imageHeight + '%;--cal-top-pos:' + top + '%;--cal-guide-height:' + guideHeight + '%">',
        '<div class="height-chart-calibration-extension"></div>',
        '<div class="height-chart-body-guide" aria-hidden="true"><img alt="" src="/assets/Human_outline_generic.svg"></div>',
        '<img alt="' + escapeHtml(character.name) + ' calibration" class="height-chart-calibration-image" src="' + escapeHtml(state.previewSrc) + '" style="display:block;height:' + imageHeight + '%;left:' + (state.croppedFeet ? 38 : 50) + '%;max-width:' + (state.croppedFeet ? 58 : 100) + '%;object-fit:contain;position:absolute;top:0;transform:translateX(-50%);width:auto;z-index:1">',
        '<div class="height-chart-cal-line" data-marker="top" style="top:' + top + '%"><span>Head</span><b aria-hidden="true"></b></div>',
        '<div class="height-chart-cal-line" data-marker="bottom" style="top:' + bottom + '%"><span>' + footLabel + '</span><b aria-hidden="true"></b></div>',
        '</div>'
    ].join('');

    updateCalibrationUi();
}

function updateCalibrationUi() {
    if (!state.image || !els.calibrationFrame) return;

    const space = calibrationSpace();
    const imageHeight = 10000 / space;
    const top = calibrationMarkerTop(state.topPct);
    const bottom = calibrationMarkerTop(state.bottomPct);
    const guideHeight = ((state.bottomPct - state.topPct) / space) * 100;
    const footLabel = state.croppedFeet ? 'Virtual foot' : 'Foot';
    const stage = els.calibrationFrame.querySelector('.height-chart-calibration-stage');
    const image = els.calibrationFrame.querySelector('.height-chart-calibration-image');
    const topLine = els.calibrationFrame.querySelector('[data-marker="top"]');
    const bottomLine = els.calibrationFrame.querySelector('[data-marker="bottom"]');

    els.calibrationFrame.classList.toggle('is-cropped', state.croppedFeet);
    if (stage) {
        stage.style.setProperty('--cal-image-height', imageHeight + '%');
        stage.style.setProperty('--cal-top-pos', top + '%');
        stage.style.setProperty('--cal-guide-height', guideHeight + '%');
    }
    if (image) {
        image.style.height = imageHeight + '%';
        image.style.left = (state.croppedFeet ? 38 : 50) + '%';
        image.style.maxWidth = (state.croppedFeet ? 58 : 100) + '%';
        image.style.display = 'block';
        image.style.zIndex = '1';
    }
    if (topLine) {
        topLine.style.top = top + '%';
    }
    if (bottomLine) {
        bottomLine.style.top = bottom + '%';
        const label = bottomLine.querySelector('span');
        if (label) label.textContent = footLabel;
    }
    document.getElementById('head-marker-value').textContent = Math.round(state.topPct) + '%';
    document.getElementById('foot-marker-label').textContent = footLabel;
    document.getElementById('foot-marker-value').textContent = Math.round(state.bottomPct) + '%';
    document.getElementById('head-marker').value = String(state.topPct);
    const footRange = document.getElementById('foot-marker');
    footRange.max = String(state.croppedFeet ? VIRTUAL_FOOT_MAX_PCT : 100);
    footRange.value = String(state.bottomPct);
}

function renderAll() {
    syncHeightInputs();
    renderChart();
    renderCalibration();
}

async function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        throw new Error('Choose an image file.');
    }

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);

    const dimensions = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
        image.onerror = () => reject(new Error('Could not read image dimensions.'));
        image.src = state.objectUrl;
    });

    state.pendingFile = file;
    state.previewSrc = state.objectUrl;
    state.image = {
        key: '',
        contentType: file.type || 'image/png',
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height,
        url: state.objectUrl
    };
    state.topPct = 5;
    state.bottomPct = state.croppedFeet ? VIRTUAL_FOOT_START_PCT : 95;
}

async function apiSave() {
    const payload = {
        version: 1,
        height: {
            meters: state.heightMeters
        },
        image: state.image && !state.pendingFile && state.image.key ? {
            key: state.image.key
        } : null,
        calibration: {
            headYPercent: state.topPct,
            footYPercent: state.bottomPct,
            footIsVirtual: state.croppedFeet
        }
    };
    const form = new FormData();
    form.set('heightChartJson', JSON.stringify(payload));
    if (state.pendingFile) form.set('heightChartImage', state.pendingFile);

    const response = await fetch('/api/characters/' + encodeURIComponent(character.id) + '/height-chart', {
        method: 'PUT',
        headers: {
            'x-csrf-token': csrfToken
        },
        body: form
    });

    if (!response.ok) {
        let message = 'Could not save height data.';
        try {
            const body = await response.json();
            message = body.error || message;
        } catch {}
        throw new Error(message);
    }

    return await response.json();
}

els.heightFeet.addEventListener('input', () => {
    const feet = Number(els.heightFeet.value || 0);
    const inches = Number(els.heightInches.value || 0);
    state.heightMeters = Math.max(1, Math.round(feet * 12 + inches)) / INCHES_PER_METER;
    if (els.heightMeters) els.heightMeters.value = state.heightMeters.toFixed(2);
    renderChart();
    renderCalibration();
});

els.heightInches.addEventListener('input', () => {
    const feet = Number(els.heightFeet.value || 0);
    const inches = Number(els.heightInches.value || 0);
    state.heightMeters = Math.max(1, Math.round(feet * 12 + inches)) / INCHES_PER_METER;
    if (els.heightMeters) els.heightMeters.value = state.heightMeters.toFixed(2);
    renderChart();
    renderCalibration();
});

els.heightMeters.addEventListener('input', () => {
    state.heightMeters = Math.max(0.01, Number(els.heightMeters.value || 0));
    const parts = imperialParts(state.heightMeters);
    els.heightFeet.value = String(parts.feet);
    els.heightInches.value = String(parts.inches);
    renderChart();
    renderCalibration();
});

els.imageInput.addEventListener('change', async () => {
    const file = els.imageInput.files && els.imageInput.files[0];
    if (!file) return;
    try {
        await loadImageFile(file);
        renderAll();
    } catch (error) {
        showToast(error.message || 'Could not load image.', false);
        els.imageInput.value = '';
    }
});

els.removeImage.addEventListener('click', () => {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.image = null;
    state.previewSrc = '';
    state.pendingFile = null;
    state.objectUrl = '';
    els.imageInput.value = '';
    renderAll();
});

document.addEventListener('input', (event) => {
    if (event.target.matches('[data-height-marker]')) {
        setCalibration(event.target.dataset.heightMarker, Number(event.target.value));
        renderChart();
        updateCalibrationUi();
    }
});

document.addEventListener('change', (event) => {
    if (event.target.matches('[data-cropped-feet]')) {
        state.croppedFeet = event.target.checked;
        if (state.croppedFeet) {
            state.bottomPct = Math.max(state.bottomPct, VIRTUAL_FOOT_START_PCT);
        } else {
            state.bottomPct = Math.min(state.bottomPct, 100);
        }
        renderChart();
        renderCalibration();
    }
});

document.addEventListener('pointerdown', (event) => {
    const marker = event.target.closest('[data-marker]');
    const frame = event.target.closest('#height-chart-calibration-frame');
    if (!marker || !frame || !state.image) return;

    event.preventDefault();
    const moveMarker = (moveEvent) => {
        const rect = frame.getBoundingClientRect();
        const pct = ((moveEvent.clientY - rect.top) / Math.max(1, rect.height)) * calibrationSpace();
        setCalibration(marker.dataset.marker, pct);
        renderChart();
        updateCalibrationUi();
    };

    const stopDragging = () => {
        document.removeEventListener('pointermove', moveMarker);
        document.removeEventListener('pointerup', stopDragging);
        document.removeEventListener('pointercancel', stopDragging);
    };

    document.addEventListener('pointermove', moveMarker);
    document.addEventListener('pointerup', stopDragging);
    document.addEventListener('pointercancel', stopDragging);
    moveMarker(event);
});

els.saveButton.addEventListener('click', async () => {
    try {
        setLoading(true);
        const result = await apiSave();
        state.pendingFile = null;
        if (result.heightChart && result.heightChart.image) {
            state.image = result.heightChart.image;
            state.previewSrc = result.heightChart.image.url;
            if (state.objectUrl) {
                URL.revokeObjectURL(state.objectUrl);
                state.objectUrl = '';
            }
        } else {
            state.image = null;
            state.previewSrc = '';
        }
        showToast('Height data saved.', true);
        renderAll();
    } catch (error) {
        showToast(error.message || 'Could not save height data.', false);
    } finally {
        setLoading(false);
    }
});

window.addEventListener('resize', renderChart);
renderAll();
`,
        }}/>
    )
}

export function CharacterHeightChartEditorPage({
                                                   currentUser,
                                                   character,
                                                   mediaBaseUrl,
                                               }: CharacterHeightChartEditorPageProps) {
    return (
        <BaseLayout title={`${character.name} Height Chart | MyOC`}>
            <Navbar currentUser={currentUser} guestInitial={currentUser.username.charAt(0).toUpperCase()}
                    mediaBaseUrl={mediaBaseUrl}/>
            <main class="container mx-auto max-w-6xl px-3 py-6 sm:px-0">
                <style>{`
                    .height-chart-shell { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 380px); gap: 1rem; align-items: start; }
                    .height-chart-plot { background: linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(180deg, rgb(255 255 255 / 0.05) 1px, transparent 1px), #000; background-size: 64px 64px; height: clamp(440px, 68vh, 760px); overflow: hidden; position: relative; }
                    .height-chart-grid-line { background: rgb(255 255 255 / 0.72); height: 1px; left: 0; position: absolute; right: 0; transform: translateY(50%); }
                    .height-chart-grid-line span { background: rgb(0 0 0 / 0.86); color: white; display: inline-flex; font-size: 0.75rem; font-weight: 800; line-height: 1; padding: 0.15rem 0.45rem; transform: translateY(-50%); }
                    .height-chart-character { bottom: 0; left: 50%; position: absolute; top: 0; transform: translateX(-50%); }
                    .height-chart-character img { max-width: none; object-fit: contain; pointer-events: none; position: absolute; user-select: none; }
                    .height-chart-virtual-foot { background: linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent); border-left: 1px dashed rgb(255 255 255 / 0.32); border-right: 1px dashed rgb(255 255 255 / 0.32); bottom: 0; left: 50%; opacity: 0.72; pointer-events: none; position: absolute; transform: translateX(-50%); width: min(2.4rem, 44%); }
                    .height-chart-empty { align-items: center; color: rgb(255 255 255 / 0.58); display: flex; font-size: 1.25rem; font-weight: 800; height: 100%; justify-content: center; text-transform: uppercase; }
                    .height-chart-calibration-frame { background: linear-gradient(45deg, rgb(255 255 255 / 0.055) 25%, transparent 25%), linear-gradient(-45deg, rgb(255 255 255 / 0.055) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgb(255 255 255 / 0.055) 75%), linear-gradient(-45deg, transparent 75%, rgb(255 255 255 / 0.055) 75%), #050505; background-position: 0 0, 0 10px, 10px -10px, -10px 0; background-size: 20px 20px; border: 1px solid rgb(255 255 255 / 0.18); height: clamp(16rem, 46vw, 22rem); overflow: hidden; position: relative; }
                    .height-chart-calibration-stage { height: 100%; position: relative; width: 100%; }
                    .height-chart-calibration-image { display: block; height: var(--cal-image-height); left: 50%; max-width: 100%; object-fit: contain; pointer-events: none; position: absolute; top: 0; transform: translateX(-50%); user-select: none; width: auto; }
                    .height-chart-calibration-frame.is-cropped .height-chart-calibration-image { left: 38%; max-width: 58%; }
                    .height-chart-body-guide { aspect-ratio: 325 / 720; height: var(--cal-guide-height); left: 75%; opacity: 0; pointer-events: none; position: absolute; top: var(--cal-top-pos); transform: translateX(-50%); width: auto; z-index: 0; }
                    .height-chart-calibration-frame.is-cropped .height-chart-body-guide { opacity: 1; }
                    .height-chart-body-guide img { display: block; filter: invert(1); height: 100%; max-width: none; opacity: 0.34; width: auto; }
                    .height-chart-calibration-extension { background: linear-gradient(180deg, rgb(255 77 77 / 0.08), transparent); border-left: 1px dashed rgb(255 77 77 / 0.36); border-right: 1px dashed rgb(255 77 77 / 0.36); bottom: 0; left: 38%; opacity: 0; pointer-events: none; position: absolute; top: var(--cal-image-height); transform: translateX(-50%); width: min(4rem, 26%); }
                    .height-chart-calibration-frame.is-cropped .height-chart-calibration-extension { opacity: 1; }
                    .height-chart-cal-line { border-top: 2px solid var(--color-primary); color: var(--color-primary); cursor: ns-resize; height: 0; left: 0; position: absolute; right: 0; touch-action: none; z-index: 2; }
                    .height-chart-cal-line[data-marker="bottom"] { border-color: #ff4d4d; color: #ff4d4d; }
                    .height-chart-cal-line::before { background: currentColor; border: 2px solid #000; border-radius: 999px; box-shadow: 0 0 0 2px rgb(255 255 255 / 0.8); content: ""; height: 1.1rem; left: 50%; position: absolute; top: -0.55rem; transform: translateX(-50%); width: 1.1rem; }
                    .height-chart-cal-line b { background: rgb(0 0 0 / 0.001); cursor: ns-resize; display: block; height: 3.25rem; left: 0; position: absolute; right: 0; top: -1.625rem; }
                    .height-chart-cal-line span { background: rgb(0 0 0 / 0.82); color: white; font-size: 0.72rem; font-weight: 900; left: 0.5rem; padding: 0.12rem 0.35rem; position: absolute; text-transform: uppercase; top: -1.55rem; }
                    @media (max-width: 900px) { .height-chart-shell { grid-template-columns: 1fr; } }
                `}</style>
                <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p class="text-sm font-bold uppercase tracking-wide text-base-content/60">Height Chart
                            Editor</p>
                        <h1 class="text-4xl font-bold">{character.name}</h1>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <a class="btn btn-ghost" href={`/edit/${encodeURIComponent(character.id)}`}>Back to Settings</a>
                        <button class="btn btn-primary" id="save-height-chart" type="button">Save Height Data</button>
                    </div>
                </div>
                <div class="height-chart-shell">
                    <section class="rounded-box border border-base-300 bg-base-200 shadow-xl">
                        <div class="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                            <strong
                                id="height-chart-status">{character.heightChart?.image ? character.name : 'No height data'}</strong>
                            <span class="text-sm text-base-content/60">Centered preview</span>
                        </div>
                        <div class="height-chart-plot" id="height-chart-plot"></div>
                    </section>
                    <aside class="rounded-box border border-base-300 bg-base-200 p-4 shadow-xl">
                        <div class="space-y-5">
                            <fieldset class="fieldset">
                                <label class="fieldset-label" for="height-chart-image">Height Chart Image</label>
                                <input accept="image/*" class="file-input w-full" id="height-chart-image" type="file"/>
                                <button class="btn btn-outline btn-error btn-sm mt-2" id="remove-height-chart-image"
                                        type="button">Remove Image
                                </button>
                            </fieldset>
                            <section class="grid gap-3">
                                <div>
                                    <span
                                        class="text-xs font-black uppercase tracking-wide text-base-content/60">Character</span>
                                    <div
                                        class="mt-1 rounded border border-base-300 bg-base-100 px-3 py-2 font-bold">{character.name}</div>
                                </div>
                                <div>
                                    <span
                                        class="text-xs font-black uppercase tracking-wide text-base-content/60">Height</span>
                                    <div class="mt-2 grid grid-cols-2 gap-2">
                                        <label class="input input-bordered flex items-center gap-2"><input class="grow"
                                                                                                           id="height-feet"
                                                                                                           min="0"
                                                                                                           step="1"
                                                                                                           type="number"/><span>ft</span></label>
                                        <label class="input input-bordered flex items-center gap-2"><input class="grow"
                                                                                                           id="height-inches"
                                                                                                           min="0"
                                                                                                           step="1"
                                                                                                           type="number"/><span>in</span></label>
                                    </div>
                                    <label class="input input-bordered mt-2 flex items-center gap-2"><input class="grow"
                                                                                                            id="height-meters"
                                                                                                            min="0.01"
                                                                                                            step="0.01"
                                                                                                            type="number"/><span>m</span></label>
                                </div>
                            </section>
                            <section class="space-y-4" id="height-chart-calibration">
                                <label class="label cursor-pointer justify-start gap-3">
                                    <input checked={Boolean(character.heightChart?.calibration.footIsVirtual)}
                                           class="toggle toggle-primary" data-cropped-feet type="checkbox"/>
                                    <span class="label-text font-bold">Feet not visible</span>
                                </label>
                                <div class="height-chart-calibration-frame" id="height-chart-calibration-frame"></div>
                                <div class="space-y-3">
                                    <label class="grid gap-1">
                                        <span
                                            class="flex justify-between text-xs font-black uppercase tracking-wide text-base-content/60"><span>Head</span><output
                                            id="head-marker-value"></output></span>
                                        <input class="range range-primary range-sm" data-height-marker="top"
                                               id="head-marker" max="100" min="0" step="0.1" type="range"/>
                                    </label>
                                    <label class="grid gap-1">
                                        <span
                                            class="flex justify-between text-xs font-black uppercase tracking-wide text-base-content/60"><span
                                            id="foot-marker-label">Foot</span><output
                                            id="foot-marker-value"></output></span>
                                        <input class="range range-error range-sm" data-height-marker="bottom"
                                               id="foot-marker" max="100" min="0" step="0.1" type="range"/>
                                    </label>
                                </div>
                            </section>
                        </div>
                    </aside>
                </div>
                <div class="toast toast-end z-50" data-height-chart-toast-region></div>
            </main>
            <CharacterHeightChartEditorScript character={character} csrfToken={currentUser.csrfToken}/>
        </BaseLayout>
    )
}
