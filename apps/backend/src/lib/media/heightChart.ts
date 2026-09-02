export type HeightChartJson = {
    version: 1
    height: {
        meters: number
    }
    image: {
        key: string
        contentType: string
        naturalWidth: number
        naturalHeight: number
    } | null
    calibration: {
        headYPercent: number
        footYPercent: number
        footIsVirtual: boolean
        nameTagXPercent: number
    }
}

export function parseHeightChartJson(value: string | null | undefined): HeightChartJson | null {
    const chart = parseJsonRecord(value)

    if (!chart || !isRecord(chart.height) || !isRecord(chart.calibration)) {
        return null
    }

    const meters = Number(chart.height.meters)
    const headYPercent = Number(chart.calibration.headYPercent)
    const footYPercent = Number(chart.calibration.footYPercent)
    const nameTagXPercent = Number(chart.calibration.nameTagXPercent ?? 50)

    if (![meters, headYPercent, footYPercent, nameTagXPercent].every(Number.isFinite)) {
        return null
    }

    return {
        version: 1,
        height: {meters},
        image: parseHeightChartImage(chart.image),
        calibration: {
            headYPercent,
            footYPercent,
            footIsVirtual: Boolean(chart.calibration.footIsVirtual),
            nameTagXPercent,
        },
    }
}

function parseHeightChartImage(value: unknown): HeightChartJson['image'] {
    if (!isRecord(value) || typeof value.key !== 'string' || value.key.length === 0) {
        return null
    }

    return {
        key: value.key,
        contentType: typeof value.contentType === 'string' ? value.contentType : 'image/png',
        naturalWidth: normalizeStoredImageDimension(value.naturalWidth),
        naturalHeight: normalizeStoredImageDimension(value.naturalHeight),
    }
}

function normalizeStoredImageDimension(value: unknown): number {
    const dimension = Number(value)
    return Number.isFinite(dimension) && dimension > 0 ? dimension : 1
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
    if (!value) {
        return null
    }

    try {
        const parsed = JSON.parse(value) as unknown
        return isRecord(parsed) ? parsed : null
    } catch {
        return null
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
