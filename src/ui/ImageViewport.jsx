
import React, { useRef, useState, useEffect, useMemo } from 'react'
import { toGrayscale, threshold, sobelEdges, connectedComponents, sizeToColor } from '../utils/overlay'

/**
 * ImageViewport
 * - Mobile-first pinch-to-zoom & pan (single finger pan, two-finger pinch)
 * - Renders source image and optional overlays on a single canvas
 * - Exposes callback with computed particles for other components
 */
export default function ImageViewport({
  file,
  overlays, // {mask:boolean, edges:boolean, contours:boolean, centroids:boolean, sizeMap:boolean}
  params,   // {threshold:number, invert:boolean, minArea:number, maxArea:number}
  onParticles,
}) {
  const canvasRef = useRef(null)
  const [img, setImg] = useState(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [gesture, setGesture] = useState({ mode: null, startDist: 0, startScale: 1, lastX: 0, lastY: 0 })

  // Load image from file
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      setImg(image)
      URL.revokeObjectURL(url)
    }
    image.src = url
  }, [file])

  // Draw pipeline
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    ctx.setTransform(1,0,0,1,0,0)
    ctx.scale(dpr, dpr)

    // Clear
    ctx.fillStyle = '#0b0b0b'
    ctx.fillRect(0,0,cssW,cssH)

    // Draw image with current viewport transform
    ctx.save()
    ctx.translate(view.x, view.y)
    ctx.scale(view.scale, view.scale)
    const iw = img.width
    const ih = img.height
    // Center image initially if no transform applied
    if (view.scale === 1 && view.x === 0 && view.y === 0) {
      const scaleFit = Math.min(cssW/iw, cssH/ih)
      const offsetX = (cssW - iw*scaleFit) * 0.5
      const offsetY = (cssH - ih*scaleFit) * 0.5
      ctx.translate(offsetX, offsetY)
      ctx.scale(scaleFit, scaleFit)
    }
    ctx.drawImage(img, 0, 0)

    // Grab imageData in image space
    const imgData = (() => {
      const temp = document.createElement('canvas')
      temp.width = iw
      temp.height = ih
      const tctx = temp.getContext('2d', { willReadFrequently: true })
      tctx.drawImage(img, 0, 0)
      return tctx.getImageData(0,0,iw,ih)
    })()

    const gray = toGrayscale(imgData)
    const mask = threshold(gray, params.threshold ?? 160, params.invert ?? false)
    const edges = sobelEdges(gray)
    const cc = connectedComponents(mask, params.minArea ?? 12, params.maxArea ?? 1e9)

    // Overlays
    if (overlays.mask) {
      ctx.globalAlpha = 0.35
      ctx.fillStyle = '#FFD000'
      // Draw mask as translucent yellow pixels (downsampled for performance)
      const step = Math.max(1, Math.floor(Math.min(iw,ih)/512))
      for (let y=0; y<ih; y+=step) {
        for (let x=0; x<iw; x+=step) {
          const v = mask.data[x + y*iw]
          if (v===255) {
            ctx.fillRect(x, y, step, step)
          }
        }
      }
      ctx.globalAlpha = 1
    }

    if (overlays.edges) {
      ctx.globalAlpha = 0.7
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 0.5 / (view.scale||1)
      // Draw edges as stippled points
      const step = Math.max(1, Math.floor(Math.min(iw,ih)/512))
      for (let y=1; y<ih-1; y+=step) {
        for (let x=1; x<iw-1; x+=step) {
          if (edges.data[x + y*iw] > 180) {
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x+0.01, y+0.01)
            ctx.stroke()
          }
        }
      }
      ctx.globalAlpha = 1
    }

    if (overlays.contours || overlays.centroids || overlays.sizeMap) {
      // Iterate components
      for (const comp of cc.components) {
        const size = Math.sqrt(comp.area) // proxy for diameter (px)
        if (overlays.contours) {
          ctx.strokeStyle = 'rgba(255,208,0,0.9)'
          ctx.lineWidth = 1.0 / (view.scale||1)
          ctx.strokeRect(comp.bbox.x, comp.bbox.y, comp.bbox.w, comp.bbox.h)
        }
        if (overlays.centroids) {
          ctx.fillStyle = '#00E5FF'
          const r = Math.max(1.5, 2.5/(view.scale||1))
          ctx.beginPath()
          ctx.arc(comp.cx, comp.cy, r, 0, Math.PI*2)
          ctx.fill()
        }
        if (overlays.sizeMap) {
          ctx.fillStyle = sizeToColor(size, 2, 50)
          const r = Math.max(1.5, 2.0/(view.scale||1))
          ctx.beginPath()
          ctx.arc(comp.cx, comp.cy, r, 0, Math.PI*2)
          ctx.fill()
        }
      }
    }

    // Guides (subtle) — can help align when panning
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = 'rgba(255,208,0,0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cssW*0.5, 0); ctx.lineTo(cssW*0.5, cssH); // vertical
    ctx.moveTo(0, cssH*0.5); ctx.lineTo(cssW, cssH*0.5); // horizontal
    ctx.stroke()
    ctx.restore()

    // Emit particles for external stats
    onParticles?.(cc.components)

  }, [img, overlays, params, view])

  // Gesture handlers (mobile-friendly)
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let pointers = new Map()

    function distance(p1, p2) {
      const dx = p2.clientX - p1.clientX
      const dy = p2.clientY - p1.clientY
      return Math.hypot(dx, dy)
    }

    function onPointerDown(e) {
      el.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, e)
      if (pointers.size === 1) {
        setGesture(g => ({ ...g, mode: 'pan', lastX: e.clientX, lastY: e.clientY }))
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        setGesture(g => ({ ...g, mode: 'pinch', startDist: distance(a,b), startScale: view.scale }))
      }
    }
    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, e)

      if (gesture.mode === 'pan' && pointers.size === 1) {
        const dx = e.clientX - gesture.lastX
        const dy = e.clientY - gesture.lastY
        setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }))
        setGesture(g => ({ ...g, lastX: e.clientX, lastY: e.clientY }))
      } else if (gesture.mode === 'pinch' && pointers.size === 2) {
        const [a, b] = Array.from(pointers.values())
        const dist = distance(a,b)
        const scale = Math.min(20, Math.max(0.2, (gesture.startScale || 1) * (dist / (gesture.startDist || dist)) ))
        setView(v => ({ ...v, scale }))
      }
    }
    function onPointerUp(e) {
      pointers.delete(e.pointerId)
      if (pointers.size === 0) setGesture({ mode: null, startDist: 0, startScale: 1, lastX: 0, lastY: 0 })
      el.releasePointerCapture(e.pointerId)
    }
    function onWheel(e) {
      e.preventDefault()
      const delta = -e.deltaY
      const factor = Math.exp(delta * 0.0015)
      setView(v => {
        const newScale = Math.min(20, Math.max(0.2, v.scale * factor))
        return { ...v, scale: newScale }
      })
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gesture.mode, view.scale])

  function resetView() {
    setView({ scale: 1, x: 0, y: 0 })
  }

  return (
    <div className="w-full h-[60vh] sm:h-[70vh] rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900">
      <div className="flex items-center justify-between p-2 sm:p-3 border-b border-neutral-800">
        <div className="text-sm text-neutral-300">Vista • Pellizca para zoom, arrastra para mover</div>
        <button onClick={resetView} className="px-3 py-1 rounded-xl bg-neutral-800 text-neutral-200 border border-neutral-700 active:scale-[0.98]">
          Reset
        </button>
      </div>
      <div ref={containerRef} className="relative w-full h-[calc(60vh-44px)] sm:h-[calc(70vh-52px)] touch-none">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  )
}
