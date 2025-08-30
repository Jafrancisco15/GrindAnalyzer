
import React from 'react'

export default function OverlayControls({ overlays, setOverlays, params, setParams }) {
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      <div className="col-span-2">
        <h3 className="text-sm font-semibold text-accent">Overlays</h3>
      </div>
      {Object.entries(overlays).map(([key, val]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-accent"
            checked={val}
            onChange={(e)=> setOverlays(o => ({ ...o, [key]: e.target.checked }))}
          />
          <span className="capitalize">{key}</span>
        </label>
      ))}

      <div className="col-span-2 h-px bg-neutral-800 my-1" />

      <div className="col-span-2">
        <h3 className="text-sm font-semibold text-accent">Parámetros</h3>
      </div>

      <label className="flex items-center gap-3 text-sm col-span-2">
        <span className="w-28 shrink-0">Umbral</span>
        <input type="range" min="0" max="255" value={params.threshold}
          onChange={(e)=> setParams(p=>({ ...p, threshold: Number(e.target.value) }))}
          className="w-full accent-accent" />
        <span className="w-10 text-right">{params.threshold}</span>
      </label>

      <label className="flex items-center gap-3 text-sm col-span-2">
        <span className="w-28 shrink-0">Invertir</span>
        <input type="checkbox" className="accent-accent" checked={params.invert}
          onChange={(e)=> setParams(p=>({ ...p, invert: e.target.checked }))} />
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="w-28 shrink-0">Área mín</span>
        <input type="number" min="1" step="1" value={params.minArea}
          onChange={(e)=> setParams(p=>({ ...p, minArea: Number(e.target.value) }))}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-2 py-1" />
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="w-28 shrink-0">Área máx</span>
        <input type="number" min="1" step="1" value={params.maxArea}
          onChange={(e)=> setParams(p=>({ ...p, maxArea: Number(e.target.value) }))}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-2 py-1" />
      </label>
    </div>
  )
}
