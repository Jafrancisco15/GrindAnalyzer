
import React from 'react'
import logo from '../assets/logo.svg'

export default function BrandBar() {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="logo-wrap rounded-xl drop-shadow-logo">
        <img src={logo} alt="Grind Sizer" className="h-9 w-auto select-none" />
      </div>
      <div className="text-xs text-neutral-400">
        Beta • móvil
      </div>
    </div>
  )
}
