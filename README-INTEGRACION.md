# Integración de correcciones — DJ Ingrid Stats

## Qué se corrigió

- Se usa una sola tabla: `spotify_history_extended`.
- `source_key` sigue siendo la clave de deduplicación del historial.
- Se agrega `source_file`, que el importador ya enviaba pero que faltaba en el SQL publicado.
- Se corrige la normalización de texto de `enrich-metadata.js`.
- El frontend usa los nombres reales de las vistas SQL.
- El frontend usa `veces_reproducidas`, que es el nombre real devuelto por las vistas.
- Las últimas 20 reproducciones se muestran usando la zona horaria `America/Santiago`.
- El Top 10 histórico de canciones exige al menos 50 reproducciones acumuladas.
- Se agregan Top 5 de álbumes para 90 días y todos los tiempos.
- El frontend comprueba errores de Supabase y no deja una pantalla aparentemente cargando.
- Se mantiene la clave pública/anon en el navegador y las claves secret/service_role fuera del frontend.
- `.env`, `.cache` y `spotify-data/` pasan a estar ignorados por Git.

## Archivos principales

Reemplazar en el proyecto:

- `import-history.js`
- `enrich-metadata.js`
- `index.html`
- `supabase-setup.sql`
- `.gitignore`

## Archivos antiguos que no deben seguir participando en la carga

Eliminar del repositorio:

- `sincronizar_spotify.py`
- `importar_todo_el_historial.py`

Los dos crean una segunda ruta de importación y no siguen el mismo esquema de deduplicación del importador Node.

## Seguridad antes de hacer push

Las credenciales que ya fueron publicadas deben considerarse comprometidas. Rotar/revocar primero:

- Supabase secret/service_role key.
- Spotify Client Secret.
- El refresh token de Spotify que estaba guardado en `.cache`.

Después eliminar del repositorio y del historial los archivos sensibles (`.env`, `.cache` y cualquier historial JSON privado que haya sido subido).

## Configuración local

Crear `.env` a partir de `.env.example`:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_SECRET_KEY
SPOTIFY_CLIENT_ID=TU_CLIENT_ID
SPOTIFY_CLIENT_SECRET=TU_CLIENT_SECRET
SPOTIFY_MARKET=CL
SPOTIFY_HISTORY_DIR=./spotify-data
IMPORT_BATCH_SIZE=500
```

## Supabase

1. Abrir **Supabase > SQL Editor**.
2. Ejecutar el contenido completo de `supabase-setup.sql`.
3. Confirmar que existe `spotify_history_extended`.
4. Confirmar que existen las vistas `view_*` del script.

## Importación

```bash
npm install
npm run import
npm run covers
```

## Frontend

En `index.html`, completar:

```js
const SUPABASE_URL = 'TU_SUPABASE_URL_AQUI';
const SUPABASE_ANON_KEY = 'TU_SUPABASE_PUBLISHABLE_O_ANON_KEY_AQUI';
```

La clave del navegador debe ser la clave pública/publishable o la legacy `anon`, nunca la secret/service_role.

Luego:

```bash
npm run dev
```

## Comprobaciones SQL útiles

Total de registros:

```sql
SELECT COUNT(*)
FROM public.spotify_history_extended;
```

Rango de fechas:

```sql
SELECT MIN(played_at) AS primera_reproduccion,
       MAX(played_at) AS ultima_reproduccion
FROM public.spotify_history_extended;
```

Canciones agrupadas por título + artista, mostrando solo las que tienen 50 o más reproducciones:

```sql
SELECT
    track_name,
    artist_name,
    COUNT(*) AS total_plays
FROM public.spotify_history_extended
WHERE ms_played > 0
GROUP BY track_name, artist_name
HAVING COUNT(*) >= 50
ORDER BY total_plays DESC;
```
