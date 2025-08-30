# GrindSizer — Portafiltro (v2.1)

- Canvas responsivo sin deformación; zoom al cursor; pan con arrastre.
- **Lupa** circular (2×/3×/4×, radio ajustable) para colocar y ampliar el aro con precisión.
- Detección automática del aro (Hough + score por gradiente) + ajuste manual con gizmo (centro y radio).
- ROI y exclusiones múltiples. Métricas D10/D50/D90 + histograma.

## Uso
```bash
npm i
npm run dev
```

1) Sube foto top‑down. 2) Detectar Aro o Calibrar (3 puntos). 3) Ajusta con el cursor y la Lupa. 4) ROI/Excluir si hace falta. 5) Analizar.
