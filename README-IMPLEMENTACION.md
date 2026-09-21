# DJ Pixula Spotify Stats — implementación corregida

## Qué cambia

1. El importador acepta el formato real de Spotify Extended Streaming History (`Streaming_History_Audio*.json`).
2. Se importan todos los archivos de audio encontrados en una carpeta.
3. Se evita duplicar reproducciones mediante `source_key` + `upsert(... ignoreDuplicates)`.
4. Se guarda `played_at` como `timestamptz`.
5. Las 20 últimas reproducciones se muestran con fecha y hora de Chile (`es-CL`, `America/Santiago`).
6. El Top reciente usa exactamente 90 días.
7. Los álbumes recientes son Top 5.
8. Los álbumes de todos los tiempos son Top 5.
9. Los álbumes cuentan todas las reproducciones de sus canciones.
10. Las portadas se enriquecen con el Spotify Web API desde Node.js, no desde el navegador.
11. Si falta una portada, la web muestra un placeholder y no queda en "Cargando...".
12. Se conserva el Spotify Track URI y, después del enriquecimiento, el Spotify Album URI.
13. El frontend solo usa la clave pública/anon; las claves secret/service_role quedan en `.env`.
14. La tabla no almacena IP, user-agent, país ni otros datos técnicos innecesarios.

## Instalación

### 1. Supabase

Abre Supabase > SQL Editor y ejecuta COMPLETO:

`supabase-setup.sql`

Esto crea la tabla `spotify_history_extended`, índices, RLS y las cinco vistas.

### 2. Proyecto local

Instala Node.js 22 o superior y ejecuta:

```bash
npm install
```

### 3. Variables de entorno

Copia:

```text
.env.example -> .env
```

Completa `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o la variable legacy `SUPABASE_SERVICE_ROLE_KEY`) y las credenciales de Spotify.

### 4. Historial de Spotify

Descomprime el ZIP de Extended Streaming History. Dentro debes tener archivos parecidos a:

```text
Streaming_History_Audio_2020-2021_0.json
Streaming_History_Audio_2022-2023_0.json
Streaming_History_Audio_2024-2025_0.json
...
```

Ponlos, por ejemplo, en:

```text
spotify-data/
```

La carpeta debe quedar así:

```text
proyecto/
├── index.html
├── import-history.js
├── enrich-metadata.js
├── supabase-setup.sql
├── package.json
├── .env
└── spotify-data/
    ├── Streaming_History_Audio_....json
    ├── Streaming_History_Audio_....json
    └── ...
```

### 5. Importar historial

```bash
npm run import
```

También puedes indicar la carpeta manualmente:

```bash
node import-history.js ./spotify-data
```

### 6. Obtener portadas

Después de importar:

```bash
npm run covers
```

El script toma el `spotify_track_uri`, busca el track en Spotify y guarda la portada y el álbum correspondiente.

### 7. Abrir la web

```bash
npm run dev
```

## Lo que debe aparecer

### Sección 1
Top 10 canciones de los últimos 90 días.

Cada tarjeta muestra:

- posición
- portada
- canción
- artista
- cantidad de reproducciones
- enlace a Spotify si existe el URI

### Sección 2
Top 5 álbumes de los últimos 90 días.

La cantidad es la suma de las reproducciones registradas de las canciones que pertenecen al álbum.

### Sección 3
Top 10 canciones de todo el historial importado.

### Sección 4
Top 5 álbumes de todo el historial importado.

### Sección 5
Las últimas 20 reproducciones reales del historial, ordenadas por `played_at DESC` y por `id DESC` como desempate.

La fecha se presenta en Chile:

`DD-MM-YYYY, HH:MM`

## Importante sobre las portadas

El Extended Streaming History no trae `album_cover`. Spotify documenta nombres de track, artista, álbum, timestamp, duración y Spotify Track URI, pero la portada se obtiene aparte desde el catálogo/API.

Por eso el flujo correcto es:

```text
Spotify Extended History
        ↓
import-history.js
        ↓
Supabase
        ↓
enrich-metadata.js
        ↓
album_cover + spotify_album_uri
        ↓
index.html
```

## Nota sobre las reproducciones

El SQL cuenta eventos musicales con `ms_played > 0`. No descarta automáticamente los eventos marcados como `skipped`, porque el objetivo es representar el historial registrado, no redefinirlo con una regla adicional.

## Seguridad

El `SUPABASE_SECRET_KEY` / `service_role` es solo para Node.js.

La clave anon/publicable es la que puede estar en `index.html`. Las políticas RLS determinan qué puede leer el navegador.
