// OpenSeadragon Bookmark URL plugin 0.0.5, adapted to preserve page-owned hash params.
;(function () {
    var OpenSeadragon = window.OpenSeadragon
    if (!OpenSeadragon && typeof require === 'function') {
        OpenSeadragon = require('openseadragon')
    }
    if (!OpenSeadragon) {
        throw new Error('OpenSeadragon is missing.')
    }

    OpenSeadragon.Viewer.prototype.bookmarkUrl = function (options) {
        options = options || {}
        var trackPage = options.trackPage || false
        var preserveHashParams = options.preserveHashParams || function () { return {} }
        var requiredHashParam = options.requiredHashParam || ''
        var self = this
        var updateTimeout
        var isDestroyed = false

        var parseHash = function () {
            var params = {}
            var hash = window.location.hash.replace(/^#/, '')
            if (!hash) return params

            var searchParams = new URLSearchParams(hash.indexOf('=') === -1 ? '' : hash)
            searchParams.forEach(function (value, key) {
                var numberValue = parseFloat(value)
                if (!isNaN(numberValue)) {
                    params[key] = numberValue
                }
            })
            return params
        }

        var buildHash = function (viewerParams, preserved) {
            var hashParams = new URLSearchParams()
            Object.keys(preserved).forEach(function (key) {
                var value = preserved[key]
                if (value !== undefined && value !== null && value !== '') {
                    hashParams.set(key, value)
                }
            })
            Object.keys(viewerParams).forEach(function (key) {
                var value = viewerParams[key]
                if (value !== undefined && value !== null && !isNaN(value)) {
                    hashParams.set(key, String(value))
                }
            })
            return hashParams.toString()
        }

        var updateUrl = function () {
            clearTimeout(updateTimeout)
            updateTimeout = setTimeout(function () {
                if (isDestroyed || !self.viewport) return

                var zoom = self.viewport.getZoom()
                var pan = self.viewport.getCenter()
                var page = self.currentPage()
                var viewerParams = {zoom: zoom, x: pan.x, y: pan.y}
                if (trackPage) {
                    viewerParams.page = page
                }
                var preserved = preserveHashParams()
                if (requiredHashParam && !preserved[requiredHashParam]) return

                var oldUrl = location.pathname + location.search + location.hash
                var hash = buildHash(viewerParams, preserved)
                var url = location.pathname + location.search + (hash ? '#' + hash : '')
                history.replaceState({}, '', url)
                if (url !== oldUrl) {
                    self.raiseEvent('bookmark-url-change', {url: location.href})
                }
            }, 100)
        }

        var useParams = function (params) {
            if (isDestroyed || !self.viewport) return

            var zoom = self.viewport.getZoom()
            var pan = self.viewport.getCenter()
            var page = self.currentPage()
            if (trackPage && params.page !== undefined && params.page !== page) {
                self.goToPage(params.page)
                self.addOnceHandler('open', function () {
                    if (params.zoom !== undefined) {
                        self.viewport.zoomTo(params.zoom, null, true)
                    }
                    if (params.x !== undefined && params.y !== undefined && (params.x !== pan.x || params.y !== pan.y)) {
                        self.viewport.panTo(new OpenSeadragon.Point(params.x, params.y), true)
                    }
                })
            } else {
                if (params.zoom !== undefined && params.zoom !== zoom) {
                    self.viewport.zoomTo(params.zoom, null, true)
                }
                if (params.x !== undefined && params.y !== undefined && (params.x !== pan.x || params.y !== pan.y)) {
                    self.viewport.panTo(new OpenSeadragon.Point(params.x, params.y), true)
                }
            }
        }

        var hashChangeHandler = function () {
            useParams(parseHash())
        }

        var params = parseHash()
        if (this.world.getItemCount() === 0) {
            this.addOnceHandler('open', function () {
                useParams(params)
            })
        } else {
            useParams(params)
        }

        this.addHandler('zoom', updateUrl)
        this.addHandler('pan', updateUrl)
        if (trackPage) {
            this.addHandler('page', updateUrl)
        }

        window.addEventListener('hashchange', hashChangeHandler, false)
        this.addOnceHandler('before-destroy', function () {
            isDestroyed = true
            clearTimeout(updateTimeout)
            window.removeEventListener('hashchange', hashChangeHandler, false)
        })
    }
})()
