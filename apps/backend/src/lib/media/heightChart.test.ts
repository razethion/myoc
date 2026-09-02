import {describe, expect, it} from 'vitest'
import {parseHeightChartJson} from './heightChart'

const validChart = {
    version: 1,
    height: {meters: 1.8},
    image: {
        key: 'chart-key',
        contentType: 'image/webp',
        naturalWidth: 1200,
        naturalHeight: 1800,
    },
    calibration: {
        headYPercent: 10,
        footYPercent: 90,
        footIsVirtual: false,
        nameTagXPercent: 55,
    },
}

describe('parseHeightChartJson', () => {
    it('normalizes stored chart data', () => {
        expect(parseHeightChartJson(JSON.stringify(validChart))).toEqual(validChart)
    })

    it.each([null, undefined, '', '{bad json', '[]', JSON.stringify({height: {meters: 1.8}})])('rejects malformed chart data', (value) => {
        expect(parseHeightChartJson(value)).toBeNull()
    })

    it('preserves stored image references with safe dimension defaults', () => {
        expect(
            parseHeightChartJson(
                JSON.stringify({
                    ...validChart,
                    image: {...validChart.image, naturalWidth: 0, naturalHeight: undefined},
                    calibration: {...validChart.calibration, nameTagXPercent: undefined},
                }),
            ),
        ).toEqual({
            ...validChart,
            image: {...validChart.image, naturalWidth: 1, naturalHeight: 1},
            calibration: {...validChart.calibration, nameTagXPercent: 50},
        })
    })

    it('accepts a chart without a stored image', () => {
        expect(parseHeightChartJson(JSON.stringify({...validChart, image: null}))).toEqual({...validChart, image: null})
    })

    it('rejects nonnumeric height and calibration values', () => {
        expect(
            parseHeightChartJson(
                JSON.stringify({
                    ...validChart,
                    height: {meters: 'unknown'},
                }),
            ),
        ).toBeNull()
    })
})
