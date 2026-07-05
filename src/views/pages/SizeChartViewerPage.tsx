import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type SizeChartViewerPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
}

function SizeChartViewerScript() {
    return (
        <script dangerouslySetInnerHTML={{
            __html: `
const INCHES_PER_METER = 39.37007874015748;
const LABEL_GUTTER = 70;
const CHART_PAD = 18;
const MODEL_TOP_PADDING = 25;
const MIN_DRAWABLE_WIDTH = 140;
const MAX_LAYER = 99;
const ALPHA_HIT_THRESHOLD = 24;
const alphaMasks = new Map();
const exportImages = new Map();
let currentChartLayout = null;
const state = {
    query: '',
    searchItems: [],
    characters: [],
    selectedId: '',
    searchTimer: 0,
    isRestoringLayout: false
};

const els = {
    searchInput: document.getElementById('size-chart-search'),
    searchResults: document.getElementById('size-chart-search-results'),
    chartPlot: document.getElementById('size-chart-plot'),
    chartLabels: document.getElementById('size-chart-labels'),
    chartStatus: document.getElementById('size-chart-status'),
    exportButton: document.getElementById('size-chart-export'),
    roster: document.getElementById('size-chart-roster'),
    placement: document.getElementById('size-chart-placement')
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function formatHeight(meters) {
    const inches = Math.max(0, Math.round(meters * INCHES_PER_METER));
    return Math.floor(inches / 12) + ' ft ' + (inches % 12) + ' in';
}

function characterXPct(character) {
    const xPct = Number(character.xPct);
    return clamp(Number.isFinite(xPct) ? xPct : 50, 0, 100);
}

function characterLayer(character) {
    const layer = Number(character.layer);
    return clamp(Number.isFinite(layer) ? Math.round(layer) : 1, 1, MAX_LAYER);
}

function selectedCharacter() {
    return state.characters.find((character) => character.id === state.selectedId) || null;
}

function layeredCharacters() {
    return state.characters
        .map((character, index) => ({ character, index }))
        .sort((a, b) => characterLayer(b.character) - characterLayer(a.character) || a.index - b.index)
        .map((item) => item.character);
}

function alphabeticalCharacters() {
    return state.characters
        .map((character, index) => ({ character, index }))
        .sort((a, b) => {
            const nameCompare = a.character.name.localeCompare(b.character.name, undefined, { sensitivity: 'base' });
            return nameCompare || a.index - b.index;
        })
        .map((item) => item.character);
}

function maxCharacterLayer() {
    return Math.max(0, ...state.characters.map(characterLayer));
}

function normalizeLayoutNumber(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function encodeLayoutValue(layout) {
    const bytes = new TextEncoder().encode(JSON.stringify(layout));
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .split('+').join('-')
        .split('/').join('_')
        .replace(/=+$/g, '');
}

function decodeLayoutValue(value) {
    const normalized = value.split('-').join('+').split('_').join('/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
}

function parseLayoutFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const rawLayout = params.get('layout');
    if (rawLayout) {
        try {
            const parsed = JSON.parse(decodeLayoutValue(rawLayout));
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.characters)) {
                const characters = parsed.characters
                    .map((character) => {
                        if (!character || typeof character !== 'object' || typeof character.id !== 'string') return null;
                        return {
                            id: character.id,
                            xPct: normalizeLayoutNumber(character.xPct, 50, 0, 100),
                            flipped: Boolean(character.flipped),
                            layer: normalizeLayoutNumber(character.layer, 1, 1, MAX_LAYER)
                        };
                    })
                    .filter(Boolean)
                    .slice(0, 30);
                return {
                    selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : '',
                    characters
                };
            }
        } catch {}
    }

    return null;
}

function layoutPayload() {
    return {
        version: 1,
        selectedId: state.selectedId,
        characters: state.characters.map((character) => ({
            id: character.id,
            xPct: Math.round(characterXPct(character)),
            flipped: Boolean(character.flipped),
            layer: characterLayer(character)
        }))
    };
}

function syncLayoutUrl() {
    if (state.isRestoringLayout) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('characters');
    url.searchParams.delete('character');
    if (state.characters.length === 0) {
        url.searchParams.delete('layout');
    } else {
        url.searchParams.set('layout', encodeLayoutValue(layoutPayload()));
    }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
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
        lines.push({
            meters,
            label: Math.round(meters * INCHES_PER_METER / 12) + ' ft'
        });
    }
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.meters - maxMeters) > stepMeters * 0.25) {
        lines.push({ meters: maxMeters, label: formatHeight(maxMeters) });
    }
    return lines;
}

function measuredPixels(character) {
    return Math.max(1, ((character.calibration.footYPercent - character.calibration.headYPercent) / 100) * character.image.naturalHeight);
}

function ensureAlphaMask(character) {
    const existing = alphaMasks.get(character.id);
    if (existing) return existing;
    const mask = {
        status: 'loading',
        width: 0,
        height: 0,
        alpha: null,
        opaqueBounds: null
    };
    alphaMasks.set(character.id, mask);

    const image = new Image();
    image.onload = () => {
        try {
            const width = image.naturalWidth || character.image.naturalWidth || 1;
            const height = image.naturalHeight || character.image.naturalHeight || 1;
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('Canvas unavailable.');
            canvas.width = width;
            canvas.height = height;
            context.drawImage(image, 0, 0, width, height);
            const rgba = context.getImageData(0, 0, width, height).data;
            const alpha = new Uint8Array(width * height);
            for (let sourceIndex = 3, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, targetIndex += 1) {
                alpha[targetIndex] = rgba[sourceIndex];
            }
            mask.status = 'ready';
            mask.width = width;
            mask.height = height;
            mask.alpha = alpha;
            mask.opaqueBounds = findOpaqueBounds(alpha, width, height);
            requestChartRender();
        } catch (error) {
            mask.status = 'failed';
            mask.error = error;
            requestChartRender();
        }
    };
    image.onerror = () => {
        mask.status = 'failed';
        requestChartRender();
    };
    image.src = character.image.url;
    return mask;
}

function findOpaqueBounds(alpha, width, height) {
    let top = height;
    let left = width;
    let right = -1;
    let bottom = -1;
    for (let index = 0; index < alpha.length; index += 1) {
        if (alpha[index] <= ALPHA_HIT_THRESHOLD) continue;
        const y = Math.floor(index / width);
        const x = index - y * width;
        top = Math.min(top, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
    }
    if (right < 0 || bottom < 0) {
        return null;
    }
    return { top, left, right, bottom };
}

function requestChartRender() {
    window.requestAnimationFrame(() => {
        renderChart();
    });
}

function isOpaqueImagePixel(item, imageX, imageY) {
    const mask = ensureAlphaMask(item.character);
    if (mask.status !== 'ready' || !mask.alpha) return true;
    const xRatio = clamp(imageX / item.imageWidth, 0, 1);
    const yRatio = clamp(imageY / item.imageHeight, 0, 1);
    const sourceXRatio = item.character.flipped ? 1 - xRatio : xRatio;
    const sourceX = clamp(Math.floor(sourceXRatio * mask.width), 0, mask.width - 1);
    const sourceY = clamp(Math.floor(yRatio * mask.height), 0, mask.height - 1);
    return mask.alpha[sourceY * mask.width + sourceX] > ALPHA_HIT_THRESHOLD;
}

function chartHitTest(clientX, clientY) {
    if (!currentChartLayout || !els.chartPlot) return null;
    const rect = els.chartPlot.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const plotHeight = els.chartPlot.clientHeight || 0;
    if (x < 0 || x > rect.width || y < 0 || y > plotHeight) return null;
    const candidates = currentChartLayout.items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => b.item.layer - a.item.layer || b.index - a.index);
    for (const candidate of candidates) {
        const item = candidate.item;
        const imageTop = plotHeight - CHART_PAD - item.imageBottomOffset - item.imageHeight;
        const imageX = x - item.left;
        const imageY = y - imageTop;
        if (imageX < 0 || imageX > item.imageWidth || imageY < 0 || imageY > item.imageHeight) continue;
        if (isOpaqueImagePixel(item, imageX, imageY)) return item;
    }
    return null;
}

function roundChartMaxMeters(maxMeters) {
    const maxFeet = maxMeters * INCHES_PER_METER / 12;
    return Math.max(60 / INCHES_PER_METER, Math.ceil(maxFeet) * 12 / INCHES_PER_METER);
}

function opaqueTopPixel(character) {
    const mask = ensureAlphaMask(character);
    if (mask.status === 'ready' && mask.opaqueBounds && mask.height > 0) {
        return (mask.opaqueBounds.top / mask.height) * character.image.naturalHeight;
    }
    if (mask.status === 'failed') {
        return 0;
    }
    return (character.calibration.headYPercent / 100) * character.image.naturalHeight;
}

function effectiveOpaqueTopMeters(character) {
    const footPixel = (character.calibration.footYPercent / 100) * character.image.naturalHeight;
    const topPixel = Math.min(opaqueTopPixel(character), footPixel);
    return Math.max(character.heightMeters, (footPixel - topPixel) * character.heightMeters / measuredPixels(character));
}

function chartMaxForTopPadding(topMeters, plotHeight, chartHeight) {
    const availableHeight = Math.max(1, chartHeight - CHART_PAD - MODEL_TOP_PADDING);
    return (topMeters * plotHeight) / availableHeight;
}

function loadExportImage(character) {
    const existing = exportImages.get(character.id);
    if (existing) return existing;
    const promise = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not load ' + character.name + '.'));
        image.src = character.image.url;
    });
    exportImages.set(character.id, promise);
    return promise;
}

function drawExportBackground(context, width, height) {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    for (let x = 0.5; x < width; x += 64) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
    }
    context.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let y = 0.5; y < height; y += 64) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
    }
}

function drawExportGrid(context, layout, width, height) {
    context.textBaseline = 'middle';
    context.font = '800 12px Trebuchet MS, Verdana, sans-serif';
    gridLines(layout.chartMax).forEach((line) => {
        const y = height - (CHART_PAD + line.meters * layout.pxPerMeter);
        context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(width, y + 0.5);
        context.stroke();
        const labelWidth = Math.max(42, context.measureText(line.label).width + 14);
        context.fillStyle = 'rgba(0, 0, 0, 0.86)';
        context.fillRect(0, y - 9, labelWidth, 18);
        context.fillStyle = '#fff';
        context.fillText(line.label, 7, y);
    });
}

function drawExportVirtualFoot(context, item, height) {
    if (item.virtualFootGap <= 0) return;
    const gapHeight = item.virtualFootGap + item.imageHeight / 2;
    const gapWidth = Math.max(8, Math.min(38, item.imageWidth * 0.44));
    const x = item.left + item.imageWidth / 2 - gapWidth / 2;
    const y = height - CHART_PAD - gapHeight;
    const gradient = context.createLinearGradient(0, y, 0, y + gapHeight);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(x, y, gapWidth, gapHeight);
    context.setLineDash([5, 5]);
    context.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 0.5, y);
    context.lineTo(x + 0.5, y + gapHeight);
    context.moveTo(x + gapWidth - 0.5, y);
    context.lineTo(x + gapWidth - 0.5, y + gapHeight);
    context.stroke();
    context.setLineDash([]);
}

function drawExportWatermark(context, width, height) {
    const label = 'myoc.art';
    context.font = '800 13px Trebuchet MS, Verdana, sans-serif';
    context.textBaseline = 'middle';
    const textWidth = context.measureText(label).width;
    const boxWidth = textWidth + 18;
    const boxHeight = 24;
    const x = width - boxWidth - 12;
    const y = height - boxHeight - 12;
    context.fillStyle = 'rgba(0, 0, 0, 0.56)';
    context.fillRect(x, y, boxWidth, boxHeight);
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.fillText(label, x + 9, y + boxHeight / 2);
}

function downloadCanvasPng(canvas) {
    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'myoc-size-chart.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
}

async function exportSizeChartPng() {
    if (!els.chartPlot || state.characters.length === 0) return;
    const button = els.exportButton;
    const previousLabel = button ? button.textContent : '';
    if (button) {
        button.disabled = true;
        button.textContent = 'Exporting...';
    }
    try {
        const layout = chartLayout();
        const width = Math.max(320, Math.round(els.chartPlot.clientWidth || 900));
        const height = Math.max(320, Math.round(els.chartPlot.clientHeight || 640));
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable.');
        context.scale(dpr, dpr);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        drawExportBackground(context, width, height);
        drawExportGrid(context, layout, width, height);
        const orderedItems = layout.items
            .map((item, index) => ({ item, index }))
            .sort((a, b) => a.item.layer - b.item.layer || a.index - b.index)
            .map((entry) => entry.item);
        for (const item of orderedItems) {
            const image = await loadExportImage(item.character);
            drawExportVirtualFoot(context, item, height);
            const imageY = height - CHART_PAD - item.imageBottomOffset - item.imageHeight;
            if (item.character.flipped) {
                context.save();
                context.translate(item.left + item.imageWidth / 2, 0);
                context.scale(-1, 1);
                context.drawImage(image, -item.imageWidth / 2, imageY, item.imageWidth, item.imageHeight);
                context.restore();
            } else {
                context.drawImage(image, item.left, imageY, item.imageWidth, item.imageHeight);
            }
        }
        drawExportWatermark(context, width, height);
        downloadCanvasPng(canvas);
    } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not export the chart.');
    } finally {
        if (button) {
            button.disabled = state.characters.length === 0;
            button.textContent = previousLabel || 'Export PNG';
        }
    }
}

function renderPlacementControls() {
    if (!els.placement) return;
    const character = selectedCharacter();
    if (!character) {
        els.placement.innerHTML = '<div class="size-chart-muted">Select a character to adjust placement.</div>';
        return;
    }
    const ordered = layeredCharacters();
    const topLayerId = ordered[0]?.id || '';
    const bottomLayerId = ordered[ordered.length - 1]?.id || '';
    const xPosition = Math.round(characterXPct(character));
    els.placement.innerHTML =
        '<div class="size-chart-placement-editor">' +
        '<div class="size-chart-placement-head"><strong>' + escapeHtml(character.name) + '</strong><span>' + escapeHtml(formatHeight(character.heightMeters)) + '</span></div>' +
        '<label class="size-chart-range-row">' +
        '<span><span>Left / Right</span><output id="size-chart-x-output">' + xPosition + '%</output></span>' +
        '<input data-x-position max="100" min="0" step="1" type="range" value="' + xPosition + '">' +
        '</label>' +
        '<label class="size-chart-switch-row">' +
        '<span>Flip horizontal</span>' +
        '<input data-flipped type="checkbox" ' + (character.flipped ? 'checked' : '') + '>' +
        '</label>' +
        '<div class="size-chart-layer-row">' +
        '<button class="btn btn-outline btn-sm" data-character-id="' + escapeHtml(character.id) + '" data-move-layer="up" ' + (character.id === topLayerId ? 'disabled' : '') + ' type="button">Layer up</button>' +
        '<button class="btn btn-outline btn-sm" data-character-id="' + escapeHtml(character.id) + '" data-move-layer="down" ' + (character.id === bottomLayerId ? 'disabled' : '') + ' type="button">Layer down</button>' +
        '<span>Layer ' + characterLayer(character) + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" data-clear-selection type="button">Clear selection</button>' +
        '</div>';
}

function renderSearchResults() {
    if (!els.searchResults) return;
    if (!state.query) {
        els.searchResults.innerHTML = '<div class="size-chart-muted">Search for a character to add.</div>';
        return;
    }
    if (state.searchItems.length === 0) {
        els.searchResults.innerHTML = '<div class="size-chart-muted">No characters found.</div>';
        return;
    }
    els.searchResults.innerHTML = state.searchItems.map((item, index) => {
        const selected = state.characters.some((character) => character.id === item.id);
        const disabled = !item.hasSizeChart || selected;
        const badge = item.hasSizeChart
            ? '<span class="badge badge-primary badge-sm">' + escapeHtml(formatHeight(item.heightChart.height.meters)) + '</span>'
            : '<span class="badge badge-outline badge-sm">no size chart</span>';
        const action = selected ? 'Added' : 'Add';
        return '<button class="size-chart-result ' + (disabled ? 'is-disabled' : '') + '" data-result-index="' + index + '" ' + (disabled ? 'disabled' : '') + ' type="button">' +
            '<img alt="' + escapeHtml(item.name) + '" src="' + escapeHtml(item.profileImageUrl) + '">' +
            '<span><strong>' + escapeHtml(item.name) + '</strong><small>by ' + escapeHtml(item.ownerUsername) + '</small></span>' +
            badge +
            '<em>' + escapeHtml(action) + '</em>' +
            '</button>';
    }).join('');
}

function renderRoster() {
    if (!els.roster) return;
    if (state.characters.length === 0) {
        els.roster.innerHTML = '<div class="size-chart-muted">No characters on the chart.</div>';
        return;
    }
    els.roster.innerHTML = alphabeticalCharacters().map((character) => {
        const selected = character.id === state.selectedId ? ' is-selected' : '';
        return '<div class="size-chart-roster-item' + selected + '">' +
        '<button class="size-chart-roster-thumb" data-select-character="' + escapeHtml(character.id) + '" type="button"><img alt="' + escapeHtml(character.name) + '" src="' + escapeHtml(character.profileImageUrl) + '" style="transform:' + (character.flipped ? 'scaleX(-1)' : 'none') + '"></button>' +
        '<button class="size-chart-roster-meta" data-select-character="' + escapeHtml(character.id) + '" type="button"><strong>' + escapeHtml(character.name) + '</strong><small>' + escapeHtml(character.ownerUsername) + ' / ' + escapeHtml(formatHeight(character.heightMeters)) + ' / layer ' + characterLayer(character) + '</small></button>' +
        '<button class="btn btn-ghost btn-xs" data-remove-character="' + escapeHtml(character.id) + '" type="button">Remove</button>' +
        '</div>'
    }).join('');
}

function chartLayout() {
    const chartHeight = Math.max(120 + CHART_PAD * 2, els.chartPlot.clientHeight || 640);
    const plotHeight = Math.max(120, chartHeight - CHART_PAD * 2);
    const contentWidth = Math.max(1, els.chartPlot.clientWidth || 900);
    const drawableLeft = LABEL_GUTTER;
    const drawableRight = Math.max(drawableLeft + MIN_DRAWABLE_WIDTH, contentWidth - CHART_PAD);
    const drawableWidth = Math.max(MIN_DRAWABLE_WIDTH, drawableRight - drawableLeft);
    const usableWidth = Math.max(48, drawableWidth - 8);
    const widthRequiredMax = state.characters.reduce((requiredMax, character) => {
        const widthMeters = (character.image.naturalWidth * character.heightMeters) / measuredPixels(character);
        return Math.max(requiredMax, (plotHeight * widthMeters) / usableWidth);
    }, 0);
    const topRequiredMax = state.characters.reduce((requiredMax, character) => (
        Math.max(requiredMax, chartMaxForTopPadding(effectiveOpaqueTopMeters(character), plotHeight, chartHeight))
    ), 0);
    const chartMax = roundChartMaxMeters(Math.max(60 / INCHES_PER_METER, widthRequiredMax, topRequiredMax, ...state.characters.map((character) => character.heightMeters)));
    const pxPerMeter = plotHeight / chartMax;
    const items = state.characters.map((character) => {
        const scale = (character.heightMeters * pxPerMeter) / measuredPixels(character);
        const imageWidth = Math.max(24, character.image.naturalWidth * scale);
        const imageHeight = Math.max(24, character.image.naturalHeight * scale);
        const imageBottomOffset = (((character.calibration.footYPercent / 100) * character.image.naturalHeight) - character.image.naturalHeight) * scale;
        const maxLeft = Math.max(drawableLeft, drawableRight - imageWidth);
        const left = drawableLeft + (characterXPct(character) / 100) * Math.max(0, maxLeft - drawableLeft);
        const labelWidth = Math.min(132, Math.max(86, imageWidth));
        return {
            character,
            imageWidth,
            imageHeight,
            imageBottomOffset,
            virtualFootGap: Math.max(0, imageBottomOffset),
            left,
            labelLeft: clamp(left + imageWidth / 2 - labelWidth / 2, drawableLeft, Math.max(drawableLeft, drawableRight - labelWidth)),
            labelWidth,
            layer: characterLayer(character),
        };
    });
    return { items, chartMax, pxPerMeter };
}

function renderChart() {
    if (!els.chartPlot || !els.chartLabels) return;
    if (state.characters.length === 0) {
        currentChartLayout = null;
        els.chartPlot.innerHTML = '<div class="size-chart-empty">Add characters to build a size chart</div>';
        els.chartLabels.innerHTML = '';
        if (els.chartStatus) els.chartStatus.textContent = '0 characters';
        if (els.exportButton) els.exportButton.disabled = true;
        return;
    }
    const layout = chartLayout();
    currentChartLayout = layout;
    layout.items.forEach((item) => ensureAlphaMask(item.character));
    const gridHtml = gridLines(layout.chartMax).map((line) => (
        '<div class="size-chart-grid-line" style="bottom:' + (CHART_PAD + line.meters * layout.pxPerMeter) + 'px"><span>' + escapeHtml(line.label) + '</span></div>'
    )).join('');
    const characterHtml = layout.items.map((item) => {
        const selected = item.character.id === state.selectedId ? ' is-selected' : '';
        const gap = item.virtualFootGap > 0
            ? '<div class="size-chart-virtual-foot" style="height:' + (item.virtualFootGap + item.imageHeight / 2) + 'px"></div>'
            : '';
        return '<button class="size-chart-character' + selected + '" style="bottom:' + CHART_PAD + 'px;left:' + item.left + 'px;width:' + item.imageWidth + 'px;z-index:' + item.layer + '" tabindex="-1" type="button">' +
            gap +
            '<img alt="' + escapeHtml(item.character.name) + '" src="' + escapeHtml(item.character.image.url) + '" style="width:' + item.imageWidth + 'px;height:' + item.imageHeight + 'px;bottom:' + item.imageBottomOffset + 'px;transform:' + (item.character.flipped ? 'scaleX(-1)' : 'none') + '">' +
            '</button>';
    }).join('');
    const labelsHtml = layout.items.map((item) => (
        '<button class="size-chart-label" data-select-character="' + escapeHtml(item.character.id) + '" style="left:' + item.labelLeft + 'px;width:' + item.labelWidth + 'px;z-index:' + item.layer + '" type="button"><strong>' + escapeHtml(item.character.name) + '</strong><span>' + escapeHtml(formatHeight(item.character.heightMeters)) + '</span></button>'
    )).join('');
    els.chartPlot.innerHTML = gridHtml + characterHtml;
    els.chartLabels.innerHTML = labelsHtml;
    if (els.chartStatus) els.chartStatus.textContent = state.characters.length + ' ' + (state.characters.length === 1 ? 'character' : 'characters');
    if (els.exportButton) els.exportButton.disabled = false;
}

function renderAll() {
    renderSearchResults();
    renderRoster();
    renderPlacementControls();
    renderChart();
    syncLayoutUrl();
}

function setSelected(id) {
    if (!state.characters.some((character) => character.id === id)) return;
    state.selectedId = id;
    renderAll();
}

function clearSelection() {
    if (!state.selectedId) return;
    state.selectedId = '';
    renderAll();
}

function moveCharacterLayer(id, direction) {
    const ordered = layeredCharacters();
    const fromIndex = ordered.findIndex((character) => character.id === id);
    if (fromIndex === -1) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= ordered.length) return;
    const [character] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, character);
    ordered.forEach((item, index) => {
        item.layer = clamp(ordered.length - index, 1, MAX_LAYER);
    });
    state.selectedId = id;
    renderAll();
}

function createChartCharacter(item, placement) {
    return {
        id: item.id,
        name: item.name,
        ownerUsername: item.ownerUsername,
        profileImageUrl: item.profileImageUrl,
        heightMeters: item.heightChart.height.meters,
        image: item.heightChart.image,
        calibration: item.heightChart.calibration,
        xPct: placement ? normalizeLayoutNumber(placement.xPct, 50, 0, 100) : 50,
        flipped: placement ? Boolean(placement.flipped) : false,
        layer: placement ? normalizeLayoutNumber(placement.layer, clamp(maxCharacterLayer() + 1, 1, MAX_LAYER), 1, MAX_LAYER) : clamp(maxCharacterLayer() + 1, 1, MAX_LAYER)
    };
}

function addCharacter(item, placement) {
    if (!item || !item.hasSizeChart || !item.heightChart || !item.heightChart.image) return;
    if (state.characters.some((character) => character.id === item.id)) return;
    state.characters.push(createChartCharacter(item, placement));
    state.selectedId = item.id;
    renderAll();
}

async function fetchCharactersByIds(ids) {
    if (ids.length === 0) return [];
    const response = await fetch('/api/search/size-chart-characters/by-id?ids=' + encodeURIComponent(ids.join(',')), {
        headers: { accept: 'application/json' }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || 'Could not load shared size chart.');
    }
    return Array.isArray(body.items) ? body.items : [];
}

async function restoreLayoutFromUrl() {
    const layout = parseLayoutFromUrl();
    if (!layout || layout.characters.length === 0) return;

    state.isRestoringLayout = true;
    try {
        const placements = new Map(layout.characters.map((character) => [character.id, character]));
        const ids = layout.characters.map((character) => character.id);
        const items = await fetchCharactersByIds(ids);
        const itemsById = new Map(items.map((item) => [item.id, item]));
        state.characters = [];
        ids.forEach((id) => {
            const item = itemsById.get(id);
            if (!item || !item.hasSizeChart || !item.heightChart?.image) return;
            state.characters.push(createChartCharacter(item, placements.get(id)));
        });
        state.selectedId = state.characters.some((character) => character.id === layout.selectedId)
            ? layout.selectedId
            : '';
    } finally {
        state.isRestoringLayout = false;
    }
}

async function searchCharacters(query) {
    state.query = query.trim();
    if (!state.query) {
        state.searchItems = [];
        renderSearchResults();
        return;
    }
    els.searchResults.innerHTML = '<div class="size-chart-muted">Searching...</div>';
    const response = await fetch('/api/search/size-chart-characters?q=' + encodeURIComponent(state.query), {
        headers: { accept: 'application/json' }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.error || 'Search failed.');
    }
    state.searchItems = Array.isArray(body.items) ? body.items : [];
    renderSearchResults();
}

els.searchInput.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(async () => {
        try {
            await searchCharacters(els.searchInput.value);
        } catch (error) {
            els.searchResults.innerHTML = '<div class="alert alert-error">' + escapeHtml(error.message || 'Search failed.') + '</div>';
        }
    }, 220);
});

document.addEventListener('click', (event) => {
    const resultButton = event.target.closest('[data-result-index]');
    if (resultButton) {
        addCharacter(state.searchItems[Number(resultButton.dataset.resultIndex)]);
        return;
    }
    const selectButton = event.target.closest('[data-select-character]');
    if (selectButton) {
        setSelected(selectButton.dataset.selectCharacter);
        return;
    }
    const moveLayerButton = event.target.closest('[data-move-layer]');
    if (moveLayerButton) {
        moveCharacterLayer(moveLayerButton.dataset.characterId, moveLayerButton.dataset.moveLayer);
        return;
    }
    const clearSelectionButton = event.target.closest('[data-clear-selection]');
    if (clearSelectionButton) {
        clearSelection();
        return;
    }
    const removeButton = event.target.closest('[data-remove-character]');
    if (removeButton) {
        alphaMasks.delete(removeButton.dataset.removeCharacter);
        exportImages.delete(removeButton.dataset.removeCharacter);
        state.characters = state.characters.filter((character) => character.id !== removeButton.dataset.removeCharacter);
        if (state.selectedId === removeButton.dataset.removeCharacter) {
            state.selectedId = '';
        }
        renderAll();
    }
});

if (els.exportButton) {
    els.exportButton.addEventListener('click', () => {
        void exportSizeChartPng();
    });
}

els.chartPlot.addEventListener('click', (event) => {
    if (state.characters.length === 0) return;
    const hit = chartHitTest(event.clientX, event.clientY);
    event.preventDefault();
    event.stopPropagation();
    if (hit) {
        setSelected(hit.character.id);
    } else {
        clearSelection();
    }
});

els.chartPlot.addEventListener('pointermove', (event) => {
    if (state.characters.length === 0) {
        els.chartPlot.style.cursor = 'default';
        return;
    }
    els.chartPlot.style.cursor = chartHitTest(event.clientX, event.clientY) ? 'pointer' : 'default';
});

els.chartPlot.addEventListener('pointerleave', () => {
    els.chartPlot.style.cursor = 'default';
});

document.addEventListener('input', (event) => {
    const character = selectedCharacter();
    if (!character) return;
    if (event.target.matches('[data-x-position]')) {
        character.xPct = clamp(Number(event.target.value) || 0, 0, 100);
        const output = document.getElementById('size-chart-x-output');
        if (output) output.textContent = Math.round(character.xPct) + '%';
        renderChart();
        renderRoster();
        syncLayoutUrl();
    }
});

document.addEventListener('change', (event) => {
    const character = selectedCharacter();
    if (!character) return;
    if (event.target.matches('[data-flipped]')) {
        character.flipped = event.target.checked;
        renderAll();
    }
});

window.addEventListener('resize', renderChart);
void restoreLayoutFromUrl()
    .catch((error) => {
        if (els.searchResults) {
            els.searchResults.innerHTML = '<div class="alert alert-error">' + escapeHtml(error.message || 'Could not load shared size chart.') + '</div>';
        }
    })
    .finally(() => {
        renderAll();
    });
`,
        }}/>
    )
}

export function SizeChartViewerPage({currentUser, guestInitial, mediaBaseUrl}: SizeChartViewerPageProps) {
    return (
        <BaseLayout title="Size Chart | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main class="size-chart-page px-3 py-6 sm:px-6">
                <style>{`
                    .size-chart-page { min-height: calc(100vh - 4rem); }
                    .size-chart-shell { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 390px); gap: 1rem; align-items: start; width: 100%; }
                    .size-chart-panel { border: 1px solid var(--color-base-300); background: var(--color-base-200); border-radius: var(--radius-box, 0.5rem); overflow: hidden; }
                    .size-chart-plot { background: linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(180deg, rgb(255 255 255 / 0.05) 1px, transparent 1px), #000; background-size: 64px 64px; height: clamp(460px, 68vh, 800px); overflow: hidden; position: relative; }
                    .size-chart-grid-line { background: rgb(255 255 255 / 0.72); height: 1px; left: 0; position: absolute; right: 0; transform: translateY(50%); }
                    .size-chart-grid-line span { background: rgb(0 0 0 / 0.86); color: white; display: inline-flex; font-size: 0.75rem; font-weight: 800; line-height: 1; padding: 0.15rem 0.45rem; transform: translateY(-50%); }
                    .size-chart-character { appearance: none; background: transparent; border: 0; color: inherit; cursor: pointer; padding: 0; position: absolute; top: 0; }
                    .size-chart-character.is-selected img { filter: drop-shadow(0 0 0.75rem rgb(56 245 212 / 0.34)); }
                    .size-chart-character img { max-width: none; object-fit: contain; pointer-events: none; position: absolute; user-select: none; }
                    .size-chart-virtual-foot { background: linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent); border-left: 1px dashed rgb(255 255 255 / 0.32); border-right: 1px dashed rgb(255 255 255 / 0.32); bottom: 0; left: 50%; opacity: 0.72; pointer-events: none; position: absolute; transform: translateX(-50%); width: min(2.4rem, 44%); }
                    .size-chart-empty { align-items: center; color: rgb(255 255 255 / 0.58); display: flex; font-size: 1.1rem; font-weight: 800; height: 100%; justify-content: center; padding: 1rem; text-align: center; text-transform: uppercase; }
                    .size-chart-label-row { min-height: 4rem; position: relative; }
                    .size-chart-label { appearance: none; background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; gap: 0.2rem; justify-items: center; padding: 0.55rem 0.3rem; position: absolute; text-align: center; }
                    .size-chart-label strong, .size-chart-label span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .size-chart-label strong { font-size: 0.86rem; }
                    .size-chart-label span { color: rgb(255 255 255 / 0.62); font-size: 0.75rem; font-weight: 800; }
                    .size-chart-side { display: grid; gap: 1rem; }
                    .size-chart-results, .size-chart-roster { display: grid; gap: 0.5rem; max-height: 22rem; overflow: auto; }
                    .size-chart-result, .size-chart-roster-item { align-items: center; background: var(--color-base-100); border: 1px solid var(--color-base-300); border-radius: var(--radius-field, 0.25rem); color: inherit; display: grid; gap: 0.65rem; grid-template-columns: 3rem minmax(0, 1fr) auto auto; min-height: 4rem; padding: 0.5rem; text-align: left; }
                    .size-chart-result:not(.is-disabled):hover { border-color: var(--color-primary); cursor: pointer; }
                    .size-chart-result.is-disabled { opacity: 0.58; }
                    .size-chart-roster-item { grid-template-columns: 3rem minmax(0, 1fr) auto; }
                    .size-chart-roster-item.is-selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, var(--color-base-100)); }
                    .size-chart-result img, .size-chart-roster-thumb img { aspect-ratio: 1; border-radius: var(--radius-field, 0.25rem); object-fit: cover; width: 3rem; }
                    .size-chart-roster-thumb, .size-chart-roster-meta { appearance: none; background: transparent; border: 0; color: inherit; min-width: 0; padding: 0; text-align: left; }
                    .size-chart-roster-thumb { cursor: pointer; height: 3rem; overflow: hidden; width: 3rem; }
                    .size-chart-roster-thumb img { height: 100%; object-fit: contain; }
                    .size-chart-roster-meta { cursor: pointer; }
                    .size-chart-result span, .size-chart-roster-item span { min-width: 0; }
                    .size-chart-result strong, .size-chart-result small, .size-chart-roster-meta strong, .size-chart-roster-meta small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .size-chart-result small, .size-chart-roster-item small { color: rgb(255 255 255 / 0.62); font-size: 0.75rem; }
                    .size-chart-result em { color: rgb(255 255 255 / 0.58); font-size: 0.75rem; font-style: normal; font-weight: 800; text-transform: uppercase; }
                    .size-chart-placement-editor { display: grid; gap: 0.8rem; }
                    .size-chart-placement-head { display: grid; gap: 0.15rem; }
                    .size-chart-placement-head span { color: rgb(255 255 255 / 0.62); font-size: 0.78rem; font-weight: 800; }
                    .size-chart-range-row { display: grid; gap: 0.35rem; }
                    .size-chart-range-row > span { align-items: center; color: rgb(255 255 255 / 0.72); display: flex; font-size: 0.78rem; font-weight: 900; justify-content: space-between; text-transform: uppercase; }
                    .size-chart-range-row input { accent-color: var(--color-primary); width: 100%; }
                    .size-chart-switch-row { align-items: center; background: var(--color-base-100); border: 1px solid var(--color-base-300); border-radius: var(--radius-field, 0.25rem); display: flex; font-weight: 800; gap: 1rem; justify-content: space-between; min-height: 2.7rem; padding: 0.55rem 0.65rem; }
                    .size-chart-switch-row input { accent-color: var(--color-primary); height: 1.35rem; width: 2.7rem; }
                    .size-chart-layer-row { align-items: center; display: grid; gap: 0.45rem; grid-template-columns: 1fr 1fr auto; }
                    .size-chart-layer-row span { color: rgb(255 255 255 / 0.62); font-size: 0.75rem; font-weight: 800; white-space: nowrap; }
                    .size-chart-muted { border: 1px dashed var(--color-base-300); border-radius: var(--radius-field, 0.25rem); color: rgb(255 255 255 / 0.58); padding: 1rem; text-align: center; }
                    @media (max-width: 1000px) { .size-chart-shell { grid-template-columns: 1fr; } }
                `}</style>
                <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p class="text-sm font-bold uppercase tracking-wide text-base-content/60">Site Tools</p>
                        <h1 class="text-4xl font-bold">Size Chart</h1>
                    </div>
                    <p class="max-w-xl text-sm text-base-content/70">Search the site for characters with saved height
                        data, then add them to a temporary comparison chart.</p>
                </div>
                <div class="alert alert-warning alert-dash mb-4" role="alert">
                    <span>This feature does not yet support content preferences. You may see NSFW media unexpectedly.</span>
                </div>
                <div class="size-chart-shell">
                    <section class="size-chart-panel">
                        <div class="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                            <strong id="size-chart-status">0 characters</strong>
                            <button class="btn btn-outline btn-sm" disabled id="size-chart-export" type="button">Export
                                PNG
                            </button>
                        </div>
                        <div class="size-chart-plot" id="size-chart-plot"></div>
                        <div class="size-chart-label-row" id="size-chart-labels"></div>
                    </section>
                    <aside class="size-chart-side">
                        <section class="size-chart-panel p-4">
                            <label class="fieldset">
                                <span class="fieldset-label">Search Characters</span>
                                <input autocomplete="off" class="input input-bordered w-full" id="size-chart-search"
                                       placeholder="username character name" type="search"/>
                            </label>
                            <div class="size-chart-results mt-3" id="size-chart-search-results"></div>
                        </section>
                        <section class="size-chart-panel p-4">
                            <div class="mb-3 flex items-center justify-between">
                                <h2 class="font-bold">On Chart</h2>
                            </div>
                            <div class="size-chart-roster" id="size-chart-roster"></div>
                        </section>
                        <section class="size-chart-panel p-4">
                            <div class="mb-3 flex items-center justify-between">
                                <h2 class="font-bold">Placement</h2>
                            </div>
                            <div id="size-chart-placement"></div>
                        </section>
                    </aside>
                </div>
            </main>
            <SizeChartViewerScript/>
        </BaseLayout>
    )
}
