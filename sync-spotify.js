require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getSpotifyAccessToken() {
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
      client_id: process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data.access_token;
}

async function sync() {
  try {
    const token = await getSpotifyAccessToken();
    const { data } = await axios.get(
      'https://api.spotify.com/v1/me/player/recently-played?limit=20',
      { headers: { Authorization: `Bearer ${token}` } }
    );

    for (const item of data.items) {
      await supabase.from('spotify_history').upsert(
        {
          played_at: item.played_at,
          track_name: item.track.name,
          artist_name: item.track.artists.map((a) => a.name).join(', '),
          album_name: item.track.album.name,
          album_cover: item.track.album.images[0]?.url || '',
          spotify_url: item.track.external_urls.spotify,
        },
        { onConflict: 'played_at' }
      );
    }
    console.log('✅ Sincronización exitosa. Canciones guardadas en Supabase.');
  } catch (err) {
    console.error('❌ Error en la sincronización:', err.response?.data || err.message);
  }
}

sync();