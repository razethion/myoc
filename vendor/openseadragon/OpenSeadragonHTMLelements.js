;(function () {
    var OpenSeadragon = window.OpenSeadragon
    if (!OpenSeadragon) {
        throw new Error('OpenSeadragon is missing.')
    }

    OpenSeadragon.Viewer.prototype.HTMLelements = function (options) {
        if (!this.elementsInstance || options) {
            options = options || {}
            options.viewer = this
            this.elementsInstance = new OpenSeadragon.hElements(options)
        }
        return this.elementsInstance
    }

    OpenSeadragon.hElements = function (options) {
        var self = this
        this.viewer = options.viewer
        this.elements = []
        ;['open', 'animation', 'rotate', 'flip', 'resize'].forEach(function (eventName) {
            self.viewer.addHandler(eventName, function () {
                repositionElements(self.elements, self.viewer)
            })
        })
    }

    OpenSeadragon.hElements.prototype = {
        getElements: function () {
            return this.elements
        },
        getElementById: function (id) {
            return this.elements.find(function (element) {
                return element.id === id
            })
        },
        addElement: function (entry) {
            if (validateElement(entry)) {
                entry.element.style.width = '100%'
                entry.element.style.height = '100%'

                var wrapper = document.createElement('div')
                wrapper.style.position = 'absolute'
                wrapper.appendChild(entry.element)
                this.viewer.canvas.appendChild(wrapper)

                var element = {
                    id: entry.id,
                    element: wrapper,
                    width: entry.width,
                    height: entry.height,
                    fontSize: entry.fontSize,
                    rect: new OpenSeadragon.Rect(entry.x + entry.width / 2, entry.y + entry.height / 2, entry.width, entry.height),
                }
                this.elements.push(element)
                repositionElement(element, this.viewer)
            }
            return this.elements
        },
        addElements: function (entries) {
            var self = this
            entries.forEach(function (entry) {
                self.addElement(entry)
            })
            return this.elements
        },
        removeElementById: function (id) {
            var element = this.getElementById(id)
            if (element) {
                this.viewer.canvas.removeChild(element.element)
                this.elements.splice(this.elements.indexOf(element), 1)
            }
            return this.elements
        },
        removeElementsById: function (ids) {
            var self = this
            ids.forEach(function (id) {
                self.removeElementById(id)
            })
            return this.elements
        },
        goToElementLocation: function (id, panOnly) {
            panOnly = typeof panOnly !== 'undefined' ? panOnly : false
            var element = this.getElementById(id)
            if (!element) return

            var viewportRect = this.viewer.viewport.imageToViewportRectangle(element.rect)
            var viewportPoint = this.viewer.viewport.imageToViewportCoordinates(element.rect.x, element.rect.y)
            if (panOnly) {
                this.viewer.viewport.panTo(new OpenSeadragon.Point(viewportPoint.x, viewportPoint.y), false)
                return
            }

            this.viewer.viewport.fitBoundsWithConstraints(
                new OpenSeadragon.Rect(
                    viewportPoint.x - viewportRect.width / 2,
                    viewportPoint.y - viewportRect.height / 2,
                    viewportRect.width,
                    viewportRect.height,
                ),
            )
        },
        moveElement: function (id, x, y) {
            var element = this.getElementById(id)
            if (element) {
                element.rect = new OpenSeadragon.Rect(x + element.width / 2, y + element.height / 2, element.width, element.height)
                repositionElement(element, this.viewer)
            }
        },
    }

    function validateElement(entry) {
        var missing = ['id', 'element', 'x', 'y', 'width', 'height'].filter(function (prop) {
            return !(prop in entry)
        })
        if (missing.length !== 0) {
            console.log('Missing properties. Element was not added.', missing, entry)
            return false
        }
        return true
    }

    function repositionElements(elements, viewer) {
        elements.forEach(function (element) {
            repositionElement(element, viewer)
        })
    }

    function repositionElement(element, viewer) {
        if (!viewer.world.getItemAt(0)) return

        var newRect = viewer.viewport.viewportToViewerElementRectangle(viewer.viewport.imageToViewportRectangle(element.rect))
        var point = viewer.viewport.getFlip()
            ? flipPoint(
                  {x: element.rect.x, y: element.rect.y},
                  viewer.viewport.getRotation(),
                  viewer.world.getItemAt(0).viewportToImageCoordinates(viewer.viewport.getCenter(true)),
              )
            : {x: element.rect.x, y: element.rect.y}
        var pos = viewer.viewport.viewportToViewerElementCoordinates(viewer.viewport.imageToViewportCoordinates(point.x, point.y))

        element.element.style.left = pos.x - newRect.width / 2 + 'px'
        element.element.style.top = pos.y - newRect.height / 2 + 'px'
        element.element.style.width = newRect.width + 'px'
        element.element.style.height = newRect.height + 'px'
        if ('fontSize' in element) {
            element.element.style.fontSize = (element.fontSize * viewer.viewport.getZoom(true)) / viewer.viewport.getHomeZoom() + 'px'
        }
    }

    function flipPoint(point, angle, center) {
        var rotatedPoint = rotatePoint(point, 180 + angle * 2, center)
        return {x: rotatedPoint.x, y: center.y * 2 - rotatedPoint.y}
    }

    function rotatePoint(point, angle, center) {
        angle = (angle * Math.PI) / 180
        var translated = center ? subtractPoints(point, center) : point
        var sin = Math.sin(angle)
        var cos = Math.cos(angle)
        translated = {
            x: translated.x * cos - translated.y * sin,
            y: translated.x * sin + translated.y * cos,
        }
        return center ? addPoints(translated, center) : translated
    }

    function subtractPoints(a, b) {
        return {x: a.x - b.x, y: a.y - b.y}
    }

    function addPoints(a, b) {
        return {x: a.x + b.x, y: a.y + b.y}
    }
})()
