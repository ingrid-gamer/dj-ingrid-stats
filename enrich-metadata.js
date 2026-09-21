import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || 'CL';
const TABLE_NAME = 'spotify_history_extended';
const PAGE_SIZE = 1000;
const SPOTIFY_BATCH_SIZE = 50;
const FALLBACK_DELAY_MS = 350;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY en .env');
}

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error('Faltan SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function getSpotifyToken() {
  const credentials = Buffer
    .from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)
    .toString('base64');

  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 15000
    }
  );

  return response.data.access_token;
}

function extractSpotifyTrackId(uri) {
  if (!uri || typeof uri !== 'string') return null;

  if (uri.startsWith('spotify:track:')) {
    const id = uri.slice('spotify:track:'.length).trim();
    return /^[A-Za-z0-9]{10,}$/.test(id) ? id : null;
  }

  const match = uri.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i);
  return match?.[1] || null;
}

async function getMissingCoverRows() {
  const rows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('source_key, spotify_track_uri, track_name, artist_name, album_name, album_cover')
      .or('album_cover.is.null,album_cover.eq.""')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Error leyendo filas sin portada: ${error.message}`);
    }

    if (!data?.length) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Una canción puede aparecer miles de veces en el historial.
  // Solo necesitamos enriquecer una vez por spotify_track_uri.
  const unique = new Map();
  for (const row of rows) {
    const key = row.spotify_track_uri
      || `${normalizeText(row.track_name)}|${normalizeText(row.artist_name)}|${normalizeText(row.album_name)}`;

    if (!key || key.startsWith('|')) continue;

    if (!unique.has(key)) {
      unique.set(key, {
        ...row,
        sourceKeys: [row.source_key].filter(Boolean)
      });
    } else if (row.source_key) {
      unique.get(key).sourceKeys.push(row.source_key);
    }
  }

  return [...unique.values()];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function spotifyTrackIds(rows) {
  return rows
    .map(row => ({ row, trackId: extractSpotifyTrackId(row.spotify_track_uri) }))
    .filter(item => item.trackId);
}

async function getSeveralTracksMetadata(token, trackIds) {
  if (!trackIds.length) return [];

  const params = new URLSearchParams({
    ids: trackIds.join(','),
    market: SPOTIFY_MARKET
  });

  const response = await axios.get(`https://api.spotify.com/v1/tracks?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000
  });

  return response.data?.tracks || [];
}

async function searchSpotifyTrack(token, trackName, artistName) {
  if (!trackName || !artistName) return null;

  const query = `track:${trackName} artist:${artistName}`;
  const params = new URLSearchParams({
    q: query,
    type: 'track',
    limit: '5',
    market: SPOTIFY_MARKET
  });

  const response = await axios.get(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000
  });

  const tracks = response.data?.tracks?.items || [];
  if (!tracks.length) return null;

  return tracks.find(track => track?.album?.images?.length) || tracks[0];
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toLargeItunesArtwork(url) {
  if (!url) return null;
  return String(url).replace(/\b100x100bb\b/i, '600x600bb');
}

async function searchItunesCover(trackName, artistName, albumName) {
  if (!trackName || !artistName) return null;

  const term = [trackName, artistName, albumName].filter(Boolean).join(' ');
  const params = new URLSearchParams({
    term,
    country: 'CL',
    media: 'music',
    entity: 'song',
    limit: '10'
  });

  const response = await axios.get(`https://itunes.apple.com/search?${params.toString()}`, {
    timeout: 15000
  });

  const results = response.data?.results || [];
  if (!results.length) return null;

  const trackKey = normalizeText(trackName);
  const artistKey = normalizeText(artistName);
  const albumKey = normalizeText(albumName);

  const scored = results.map(item => {
    const itemTrack = normalizeText(item.trackName);
    const itemArtist = normalizeText(item.artistName);
    const itemAlbum = normalizeText(item.collectionName);

    let score = 0;
    if (itemTrack === trackKey) score += 5;
    else if (itemTrack.includes(trackKey) || trackKey.includes(itemTrack)) score += 2;

    if (itemArtist === artistKey) score += 5;
    else if (itemArtist.includes(artistKey) || artistKey.includes(itemArtist)) score += 2;

    if (albumKey && itemAlbum === albumKey) score += 3;

    return { item, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0]?.item;
  return best?.artworkUrl100 ? toLargeItunesArtwork(best.artworkUrl100) : null;
}

function metadataFromSpotifyTrack(track) {
  if (!track) return null;

  const album = track.album;
  const albumCover = album?.images?.[0]?.url || null;
  const albumUri = album?.uri || null;

  if (!albumCover && !albumUri) return null;

  return { albumCover, albumUri, source: 'spotify' };
}

function metadataPayload(metadata) {
  const payload = {};
  if (metadata?.albumCover) payload.album_cover = metadata.albumCover;
  if (metadata?.albumUri) payload.spotify_album_uri = metadata.albumUri;
  return payload;
}

async function updateRowsBySpotifyUri(uri, metadata) {
  const payload = metadataPayload(metadata);
  if (!uri || !Object.keys(payload).length) return;

  const { error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('spotify_track_uri', uri);

  if (error) {
    throw new Error(`Error actualizando ${uri}: ${error.message}`);
  }
}

async function updateRowsBySourceKeys(sourceKeys, metadata) {
  const payload = metadataPayload(metadata);
  if (!sourceKeys?.length || !Object.keys(payload).length) return;

  const { error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .in('source_key', sourceKeys);

  if (error) {
    throw new Error(`Error actualizando registros: ${error.message}`);
  }
}

async function enrichWithSpotify(token, pending) {
  const valid = spotifyTrackIds(pending);
  const byId = new Map(valid.map(({ row, trackId }) => [trackId, row]));
  const result = new Map();

  for (let i = 0; i < valid.length; i += SPOTIFY_BATCH_SIZE) {
    const batch = valid.slice(i, i + SPOTIFY_BATCH_SIZE);
    const ids = batch.map(item => item.trackId);
    const tracks = await getSeveralTracksMetadata(token, ids);

    for (const track of tracks) {
      if (!track?.id) continue;
      const row = byId.get(track.id);
      const metadata = metadataFromSpotifyTrack(track);
      if (row && metadata?.albumCover) {
        result.set(row.spotify_track_uri, metadata);
      }
    }

    console.log(`🎵 Spotify: procesados ${Math.min(i + batch.length, valid.length)}/${valid.length} IDs`);
  }

  return result;
}

async function main() {
  console.log('==============================================');
  console.log('🖼️ DJ PIXULA — ENRIQUECIMIENTO DE PORTADAS');
  console.log('==============================================');

  const token = await getSpotifyToken();
  const pending = await getMissingCoverRows();

  console.log(`🔎 Canciones únicas sin portada: ${pending.length}`);
  if (!pending.length) {
    console.log('✅ No quedan canciones pendientes.');
    return;
  }

  let spotifyMap = new Map();
  try {
    spotifyMap = await enrichWithSpotify(token, pending);
  } catch (error) {
    console.warn(`⚠️ Spotify no pudo completar el enriquecimiento por lotes: ${error.message}`);
  }

  let spotifySuccess = 0;
  let fallbackSuccess = 0;
  let noMetadata = 0;
  let failed = 0;

  const missingAfterSpotify = [];

  for (const row of pending) {
    const metadata = spotifyMap.get(row.spotify_track_uri);
    if (metadata?.albumCover) {
      try {
        await updateRowsBySpotifyUri(row.spotify_track_uri, metadata);
        spotifySuccess++;
      } catch (error) {
        failed++;
        console.warn(`⚠️ Error guardando Spotify ${row.spotify_track_uri}: ${error.message}`);
      }
    } else {
      missingAfterSpotify.push(row);
    }
  }

  console.log(`✅ Portadas obtenidas desde Spotify: ${spotifySuccess}`);
  console.log(`🔁 Sin portada directa, probando Spotify Search + respaldo: ${missingAfterSpotify.length}`);

  for (let index = 0; index < missingAfterSpotify.length; index++) {
    const row = missingAfterSpotify[index];
    let resolved = null;

    try {
      // Segundo intento: Spotify Search. Esto sirve también cuando el historial
      // no trae spotify_track_uri o cuando el ID antiguo ya no responde.
      const foundTrack = await searchSpotifyTrack(token, row.track_name, row.artist_name);
      resolved = metadataFromSpotifyTrack(foundTrack);

      if (resolved?.albumCover) {
        if (row.spotify_track_uri) {
          await updateRowsBySpotifyUri(row.spotify_track_uri, resolved);
        } else {
          await updateRowsBySourceKeys(row.sourceKeys, resolved);
        }
        fallbackSuccess++;
      }
    } catch (error) {
      console.warn(`⚠️ Búsqueda Spotify ${row.track_name} — ${row.artist_name}: ${error.message}`);
    }

    // Tercer intento: iTunes como respaldo cuando Spotify no devuelve portada.
    if (!resolved?.albumCover) {
      try {
        const fallbackCover = await searchItunesCover(
          row.track_name,
          row.artist_name,
          row.album_name
        );

        if (fallbackCover) {
          const metadata = { albumCover: fallbackCover, albumUri: null };
          if (row.spotify_track_uri) {
            await updateRowsBySpotifyUri(row.spotify_track_uri, metadata);
          } else {
            await updateRowsBySourceKeys(row.sourceKeys, metadata);
          }
          fallbackSuccess++;
          resolved = metadata;
        }
      } catch (error) {
        failed++;
        console.warn(`⚠️ Respaldo iTunes ${row.track_name} — ${row.artist_name}: ${error.message}`);
      }
    }

    if (!resolved?.albumCover) noMetadata++;

    if ((index + 1) % 10 === 0 || index === missingAfterSpotify.length - 1) {
      console.log(`🖼️ Respaldo: ${index + 1}/${missingAfterSpotify.length}`);
    }

    await sleep(FALLBACK_DELAY_MS);
  }

  console.log('\n==============================================');
  console.log('✅ ENRIQUECIMIENTO FINALIZADO');
  console.log('==============================================');
  console.log(`🟢 Spotify: ${spotifySuccess}`);
  console.log(`🟡 Respaldo: ${fallbackSuccess}`);
  console.log(`ℹ️ Sin portada disponible: ${noMetadata}`);
  console.log(`❌ Errores: ${failed}`);
  console.log('==============================================\n');
}

main().catch(error => {
  console.error('\n❌ ERROR FATAL:', error.message);
  process.exit(1);
});
