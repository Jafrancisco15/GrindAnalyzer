
import React from 'react'

export default function StatsPanel({ particles }) {
  const count = particles.length
  const areas = particles.map(p => p.area).sort((a,b)=>a-b)
  const minA = areas[0] || 0
  const maxA = areas[areas.length-1] || 0
  const meanA = areas.length ? (areas.reduce((s,v)=>s+v,0)/areas.length) : 0

  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="col-span-2">
        <h3 className="text-sm font-semibold text-accent">Estadísticas (rápidas)</h3>
      </div>
      <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-neutral-400">Conteo</div>
        <div className="text-lg font-bold">{count}</div>
      </div>
      <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-neutral-400">Área mín</div>
        <div className="text-lg font-bold">{minA.toFixed(0)}</div>
      </div>
      <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-neutral-400">Área máx</div>
        <div className="text-lg font-bold">{maxA.toFixed(0)}</div>
      </div>
      <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-neutral-400">Área media</div>
        <div className="text-lg font-bold">{meanA.toFixed(1)}</div>
      </div>
    </div>
  )
}
