# OttoCabs Fleet Tracker — versión pública (flotas)

Dashboard estático que se reconstruye solo cada mañana con los datos del día vencido.
La lista de flotas se lee del Google Sheet "Madrid Grouping": añadir/quitar una company
con FO = OTTOCABS SL se refleja automáticamente en la siguiente ejecución.

## Contenido
- `fleet-template.html` — código del dashboard en modo flotas (sin importes confidenciales; verificado)
- `build.js` — extrae las queries de la plantilla, consulta Databricks y el sheet, e inyecta los datos
- `.github/workflows/update-dashboard.yml` — ejecución diaria automática
- `docs/index.html` — resultado publicado (lo genera el workflow)

## Puesta en marcha (una sola vez)
1. Crea un repositorio en GitHub y sube estos archivos tal cual (incluida la carpeta `.github`).
2. Google Sheet: en "Madrid Grouping" → Compartir → "Cualquier persona con el enlace: Lector".
   La URL para el secreto es: `https://docs.google.com/spreadsheets/d/13.../export?format=csv&gid=0`
   (sustituye el ID por el del sheet; gid=0 es la primera pestaña).
3. Databricks: crea un token de solo lectura (idealmente de un service principal) y localiza el
   ID de tu SQL Warehouse (SQL Warehouses → tu warehouse → Connection details).
4. En el repo: Settings → Secrets and variables → Actions → New repository secret, crea:
   - `DATABRICKS_HOST` (p. ej. https://xxxx.cloud.databricks.com)
   - `DATABRICKS_TOKEN`
   - `DATABRICKS_WAREHOUSE_ID`
   - `SHEET_CSV_URL`
5. Settings → Pages → Source: "Deploy from a branch" → rama `main`, carpeta `/docs` → Save.
6. Actions → "Actualizar dashboard flotas" → Run workflow (primera ejecución manual).
   La URL pública será `https://<usuario>.github.io/<repo>/`.

## Mantenimiento
- Datos y lista de flotas: automáticos, cada mañana.
- Cambios de diseño o métricas del dashboard: se hacen en la versión interna (Claude) y se
  regenera `fleet-template.html` desde allí; es el único paso manual, y solo cuando cambia el código.

## Seguridad
- El sitio publicado no contiene: Supply Spend, Total a Pagar, importes del objetivo de flota
  (40.000 € / 4%), ni datos anteriores a julio 2026. Se eliminan del código, no se ocultan.
- Si el sheet llega ilegible o con pocas flotas, el build ABORTA y no publica datos erróneos.
- El token de Databricks vive solo en GitHub Secrets. Usa un token de solo lectura y rótalo periódicamente.
