
// Basic image utilities for overlays (pure JS).
// NOTE: These are simplified to keep the UI fast on mobile.
// For production, consider web-workers and more robust algorithms.

export function toGrayscale(imgData) {
  const { data, width, height } = imgData
  const gray = new Uint8ClampedArray(width * height)
  for (let i=0, j=0; i<data.length; i+=4, j++) {
    const r = data[i], g = data[i+1], b = data[i+2]
    // Luma (Rec.601)
    gray[j] = (0.299*r + 0.587*g + 0.114*b) | 0
  }
  return { data: gray, width, height }
}

export function threshold(gray, t=128, invert=false) {
  const { data, width, height } = gray
  const out = new Uint8ClampedArray(width * height)
  for (let i=0; i<data.length; i++) {
    const v = data[i]
    out[i] = invert ? (v > t ? 0 : 255) : (v > t ? 255 : 0)
  }
  return { data: out, width, height }
}

// Sobel edges (very lightweight edge map)
export function sobelEdges(gray) {
  const { data, width, height } = gray
  const out = new Uint8ClampedArray(width * height)
  const gx = [-1,0,1,-2,0,2,-1,0,1]
  const gy = [-1,-2,-1,0,0,0,1,2,1]
  for (let y=1; y<height-1; y++) {
    for (let x=1; x<width-1; x++) {
      let sx=0, sy=0, idx=0
      for (let ky=-1; ky<=1; ky++) {
        for (let kx=-1; kx<=1; kx++) {
          const i = (x+kx) + (y+ky)*width
          const val = data[i]
          sx += val * gx[idx]
          sy += val * gy[idx]
          idx++
        }
      }
      const mag = Math.hypot(sx, sy)
      out[x + y*width] = mag > 128 ? 255 : (mag|0)
    }
  }
  return { data: out, width, height }
}

// Quick connected-components (4-neighbors). Returns label matrix and components.
export function connectedComponents(mask, minArea=8, maxArea=1e9) {
  const { data, width, height } = mask
  const labels = new Int32Array(width * height).fill(-1)
  const components = []
  let current = 0

  const stack = []
  const N = (x,y)=> y*width + x

  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const i = N(x,y)
      if (data[i]===255 && labels[i]===-1) {
        let minx=x, miny=y, maxx=x, maxy=y, area=0, sumx=0, sumy=0
        stack.length = 0
        stack.push(i)
        labels[i] = current
        while (stack.length) {
          const p = stack.pop()
          const px = p % width
          const py = (p - px) / width
          // stats
          area++
          sumx += px
          sumy += py
          if (px<minx) minx=px
          if (py<miny) miny=py
          if (px>maxx) maxx=px
          if (py>maxy) maxy=py

          // neighbors (4-connectivity)
          if (px>0) {
            const q = p-1
            if (data[q]===255 && labels[q]===-1) { labels[q]=current; stack.push(q) }
          }
          if (px<width-1) {
            const q = p+1
            if (data[q]===255 && labels[q]===-1) { labels[q]=current; stack.push(q) }
          }
          if (py>0) {
            const q = p-width
            if (data[q]===255 && labels[q]===-1) { labels[q]=current; stack.push(q) }
          }
          if (py<height-1) {
            const q = p+width
            if (data[q]===255 && labels[q]===-1) { labels[q]=current; stack.push(q) }
          }
        }
        if (area>=minArea && area<=maxArea) {
          const cx = sumx/area
          const cy = sumy/area
          components.push({
            id: current, area, cx, cy,
            bbox: { x:minx, y:miny, w:(maxx-minx+1), h:(maxy-miny+1) }
          })
          current++
        } else {
          // mark them as background by resetting labels to -1
          for (let j=0; j<labels.length; j++) {
            if (labels[j]===current) labels[j] = -2 // filtered
          }
          current++
        }
      }
    }
  }
  return { labels, width, height, components }
}

// Color map helper (size-coded overlay for particles)
export function sizeToColor(size, minSize, maxSize) {
  // Map size to 0..1
  const t = Math.min(1, Math.max(0, (size - minSize) / Math.max(1, (maxSize - minSize)) ))
  // Interpolate between blue(0,120,255) and red(255,80,80)
  const r = Math.round(255 * t + 0   * (1-t))
  const g = Math.round( 80 * t + 120 * (1-t))
  const b = Math.round( 80 * t + 255 * (1-t))
  return `rgba(${r},${g},${b},0.9)`
}
