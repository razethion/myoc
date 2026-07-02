export const PROFILE_CROPPER_BROWSER_HELPERS = `
const profileCropperTemplate = [
    '<cropper-canvas>',
    '<cropper-image></cropper-image>',
    '<cropper-shade hidden></cropper-shade>',
    '<cropper-selection aspect-ratio="1" initial-coverage="1" movable precise resizable>',
    '<cropper-grid role="grid" bordered covered></cropper-grid>',
    '<cropper-crosshair centered></cropper-crosshair>',
    '<cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>',
    '<cropper-handle action="n-resize"></cropper-handle>',
    '<cropper-handle action="e-resize"></cropper-handle>',
    '<cropper-handle action="s-resize"></cropper-handle>',
    '<cropper-handle action="w-resize"></cropper-handle>',
    '<cropper-handle action="ne-resize"></cropper-handle>',
    '<cropper-handle action="nw-resize"></cropper-handle>',
    '<cropper-handle action="se-resize"></cropper-handle>',
    '<cropper-handle action="sw-resize"></cropper-handle>',
    '</cropper-selection>',
    '</cropper-canvas>',
].join('');

function createProfileCropper(image) {
    const cropperConstructor = typeof globalThis.Cropper === 'function'
        ? globalThis.Cropper
        : globalThis.Cropper && typeof globalThis.Cropper.default === 'function'
            ? globalThis.Cropper.default
            : null;

    if (!cropperConstructor) {
        throw new Error('Profile image editor could not load. Refresh and try again.');
    }

    return new cropperConstructor(image, { template: profileCropperTemplate });
}

function selectionWithinBounds(selection, bounds) {
    const tolerance = 1;
    return selection.x >= bounds.x - tolerance
        && selection.y >= bounds.y - tolerance
        && selection.x + selection.width <= bounds.x + bounds.width + tolerance
        && selection.y + selection.height <= bounds.y + bounds.height + tolerance;
}

function getProfileCropperImageBounds(cropperCanvas, cropperImage) {
    const canvasRect = cropperCanvas.getBoundingClientRect();
    const imageRect = cropperImage.getBoundingClientRect();
    return {
        x: imageRect.left - canvasRect.left,
        y: imageRect.top - canvasRect.top,
        width: imageRect.width,
        height: imageRect.height,
    };
}

function bindProfileCropperSelectionBounds(cropperCanvas, cropperImage, cropperSelection) {
    cropperSelection.addEventListener('change', (event) => {
        if (!selectionWithinBounds(event.detail, getProfileCropperImageBounds(cropperCanvas, cropperImage))) {
            event.preventDefault();
        }
    });
}

async function initializeProfileCropper(cropper) {
    const cropperCanvas = cropper.getCropperCanvas();
    const cropperImage = cropper.getCropperImage();
    const cropperSelection = cropper.getCropperSelection();

    if (!cropperCanvas || !cropperImage || !cropperSelection) {
        throw new Error('Profile image editor could not initialize.');
    }

    bindProfileCropperSelectionBounds(cropperCanvas, cropperImage, cropperSelection);
    await cropperImage.$ready();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const imageBounds = getProfileCropperImageBounds(cropperCanvas, cropperImage);
    if (imageBounds.width <= 0 || imageBounds.height <= 0) {
        throw new Error('Profile image editor could not measure the selected image.');
    }

    const size = Math.max(1, Math.min(imageBounds.width, imageBounds.height));
    cropperSelection.$change(
        imageBounds.x + ((imageBounds.width - size) / 2),
        imageBounds.y + ((imageBounds.height - size) / 2),
        size,
        size,
        1,
    );
}

async function createProfileCropCanvas(cropper) {
    const cropperSelection = cropper.getCropperSelection();

    if (!cropperSelection) {
        throw new Error('Profile image editor is not ready.');
    }

    return await cropperSelection.$toCanvas({
        width: 512,
        height: 512,
        beforeDraw(context) {
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
        },
    });
}
`
