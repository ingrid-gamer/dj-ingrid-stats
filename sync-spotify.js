import { createClient } from '@supabase/supabase-js';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getAccessToken() {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const data = await response.json();
  return data.access_token;
}

async function syncSpotify() {
  try {
    const token = await getAccessToken();
    const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    if (!data.items) {
      console.log('No se encontraron reproducciones.');
      return;
    }

    const records = data.items.map(item => ({
      played_at: item.played_at,
      track_name: item.track.name,
      artist_name: item.track.artists.map(a => a.name).join(', '),
      album_name: item.track.album.name,
      album_cover: item.track.album.images[0]?.url,
      spotify_url: item.track.external_urls.spotify,
      duration_ms: item.track.duration_ms
    }));

    const { error } = await supabase.from('spotify_history').upsert(records, { onConflict: 'played_at' });

    if (error) throw error;
    console.log(`Sincronización exitosa: ${records.length} canciones procesadas.`);
  } catch (err) {
    console.error('Error durante la sincronización:', err);
    process.exit(1);
  }
}

syncSpotify();