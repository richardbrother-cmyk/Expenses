# Mis Finanzas 💰

App web progresiva (PWA) para llevar el control de tus ingresos y gastos personales. Se instala en el celular como una app normal, funciona sin internet y tus datos se quedan en tu dispositivo.

## Funciones

- **Movimientos**: registra ingresos y gastos con categoría, fecha y nota. Búsqueda y filtros por mes y tipo.
- **Recurrentes** con la temporalidad que quieras:
  - Cada N días, semanas, meses o años (semanal, cada 2 semanas, mensual, bimestral, trimestral, semestral, anual…).
  - Semanal en uno o varios días (ej. *cada jueves*, *lunes y jueves cada 2 semanas*).
  - Mensual en uno o varios días (ej. *el día 5*, *el 15 y el último día*). Si el día no existe (31 en abril) se usa el último día del mes.
  - Mensual por día de la semana (ej. *el primer lunes*, *el último viernes*).
  - Fecha de inicio y fin (nunca, en una fecha o después de N veces).
  - Vista previa de las próximas fechas mientras lo configuras.
  - **Por confirmar**: cuando llega la fecha, confirmas el pago (✓), ajustas el monto real (✎) o lo omites (✕). O márcalo como *automático* para que se registre solo.
- **Presupuestos variables** por categoría (súper, gasolina…) que se suman a la proyección.
- **Reportes**:
  - *Resumen*: gastos por categoría, ingresos vs gastos de 6 meses, tasa de ahorro, gastos más grandes.
  - *Plan vs real*: comparativo por categoría de lo proyectado contra lo real del mes, más la tendencia de 6 meses.
  - *Proyección*: saldo proyectado a 3, 6, 12 o 24 meses comparado con el saldo real histórico, con alerta si algún mes queda en negativo.
- **Respaldo**: descarga/restaura tus datos en JSON y exporta movimientos a CSV (Excel).
- Tema claro/oscuro, varias monedas, datos de ejemplo para probar.

## Instalar en tu celular

La app necesita estar publicada en una dirección `https://` para poder instalarse. La forma más sencilla es GitHub Pages (gratis):

1. En GitHub, ve a **Settings → Pages** del repositorio y en *Source* elige **GitHub Actions**.
2. Une estos cambios a la rama `main`. El flujo `.github/workflows/pages.yml` publica la app automáticamente.
3. Abre la dirección que aparece en *Settings → Pages* (algo como `https://<usuario>.github.io/<repo>/`) en tu celular:
   - **Android (Chrome)**: menú ⋮ → *Instalar app* / *Agregar a pantalla de inicio* (o el botón *Instalar app* en Ajustes).
   - **iPhone (Safari)**: botón *Compartir* → *Agregar a inicio*.

> Tus datos se guardan solo en el navegador del teléfono donde instalas la app. Descarga un respaldo de vez en cuando desde **Ajustes → Respaldo de datos**.

## Desarrollo local

No necesita compilación ni dependencias.

```bash
npm start      # sirve la app en http://localhost:8080
npm test       # pruebas del motor de recurrencias
```

Estructura:

| Archivo | Contenido |
| --- | --- |
| `index.html` | Estructura de la app y navegación |
| `app.js` | Vistas, formularios, reportes, proyección y almacenamiento |
| `recurrence.js` | Motor de fechas y recurrencias |
| `styles.css` | Estilos (claro/oscuro, diseño móvil) |
| `sw.js` | Service worker para uso sin conexión |
| `manifest.webmanifest`, `icons/` | Datos para instalar como app |
