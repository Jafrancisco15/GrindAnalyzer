# GrindSizer — Portafiltro (v2.4)

- Canvas sin deformación; zoom al cursor; pan controlado.
- **Overlays reales (incluye Contornos reales)** del procesamiento: **Máscara (BW/ámbar)** y **Bordes (Canny)**.
- Opción de ver **círculos equivalentes** solo a modo ilustrativo.
- **Índice de Uniformidad de Molienda (IUM, 0–100)** basado en:
  - Uniformidad de distribución (span D90/D10)
  - Enfoque (σ del Laplaciano)
  - Alineación borde/máscara
  - Solidez media de partículas
  - Tamaño de muestra
- D10/D50/D90 + histograma; ROI y exclusiones.

## Uso
```bash
npm i
npm run dev
```


**Nuevo en v2.4**: modo *Contornos reales* y botón **Exportar CSV** (tamaños individuales y métricas por partícula).


## v2.6
- Tema **negro + amarillo**.
- Pan por cursor **(default)**; lupa **off**.
- Guías y flechas para subir/bajar/izq/der la imagen.
- Selector de overlays **independiente** (Máscara, Borde, Canny, Contornos, Círculos) y presets (Auditar, Todos, etc.).
- Overlays reconstruidos desde el **pipeline real**: `opened` (máscara), `boundary`, `Canny`, contornos y círculos equivalentes.
