import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'spotify_history_extended';
const BATCH_SIZE = Number(process.env.IMPORT_BATCH_SIZE || 500);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Faltan SUPABASE_URL y/o SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeRecord(raw, sourceFile) {
  // Spotify Extended Streaming History usa estos campos.
  // ts = fecha/hora del final del stream, en UTC.
  const trackName = normalizeText(raw.master_metadata_track_name);
  const artistName = normalizeText(raw.master_metadata_album_artist_name);
  const albumName = normalizeText(raw.master_metadata_album_album_name);

  if (!trackName || !artistName || !raw.ts) {
    return null;
  }

  const date = new Date(raw.ts);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const msPlayed = Number(raw.ms_played ?? 0);
  if (!Number.isFinite(msPlayed) || msPlayed < 0) {
    return null;
  }

  const spotifyTrackUri = normalizeText(raw.spotify_track_uri);

  // Esta clave identifica un evento concreto y permite volver a importar
  // el mismo ZIP sin duplicar reproducciones.
  const sourceKey = sha256([
    date.toISOString(),
    spotifyTrackUri || '',
    trackName,
    artistName,
    albumName || '',
    String(msPlayed)
  ].join('\u001f'));

  return {
    source_key: sourceKey,
    played_at: date.toISOString(),
    track_name: trackName,
    artist_name: artistName,
    album_name: albumName,
    album_cover: null,
    spotify_track_uri: spotifyTrackUri,
    spotify_album_uri: null,
    ms_played: Math.trunc(msPlayed),
    skipped: normalizeBoolean(raw.skipped),
    shuffle: normalizeBoolean(raw.shuffle),
    offline: normalizeBoolean(raw.offline),
    incognito_mode: normalizeBoolean(raw.incognito_mode ?? raw.incognito),
    source_file: sourceFile
  };
}

function findInputFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No existe la ruta: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    if (!resolved.toLowerCase().endsWith('.json')) {
      throw new Error('El archivo indicado debe ser JSON.');
    }
    return [resolved];
  }

  const files = fs.readdirSync(resolved)
    .filter(name => /^Streaming_History_Audio.*\.json$/i.test(name))
    .map(name => path.join(resolved, name))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(
      `No encontré archivos Streaming_History_Audio*.json en ${resolved}. ` +
      'Extrae primero el ZIP de Spotify y usa esa carpeta.'
    );
  }

  return files;
}

async function getDatabaseCount() {
  const { count, error } = await supabase
    .from(TABLE_NAME)
    .select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error(`No se pudo consultar la tabla ${TABLE_NAME}: ${error.message}`);
  }

  return count ?? 0;
}

async function importFile(filePath, seenKeys) {
  const sourceFile = path.basename(filePath);
  const rawText = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(rawText);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceFile} no contiene un array JSON.`);
  }

  let invalid = 0;
  let duplicateInsideFiles = 0;
  let prepared = 0;

  const rows = [];

  for (const raw of parsed) {
    const row = normalizeRecord(raw, sourceFile);

    if (!row) {
      invalid++;
      continue;
    }

    if (seenKeys.has(row.source_key)) {
      duplicateInsideFiles++;
      continue;
    }

    seenKeys.add(row.source_key);
    rows.push(row);
    prepared++;
  }

  console.log(`\n📄 ${sourceFile}`);
  console.log(`   Registros JSON: ${parsed.length}`);
  console.log(`   Válidos para música: ${prepared}`);
  console.log(`   Ignorados por datos incompletos: ${invalid}`);
  console.log(`   Duplicados dentro del conjunto importado: ${duplicateInsideFiles}`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

    const { error } = await supabase
      .from(TABLE_NAME)
      .upsert(batch, {
        onConflict: 'source_key',
        ignoreDuplicates: true
      });

    if (error) {
      throw new Error(`Error en lote ${batchNumber}/${totalBatches}: ${error.message}`);
    }

    const progress = Math.round(((i + batch.length) / rows.length) * 100);
    console.log(`   ✅ Lote ${batchNumber}/${totalBatches} (${progress}%)`);
  }

  return {
    totalJson: parsed.length,
    prepared,
    invalid,
    duplicateInsideFiles
  };
}

async function main() {
  try {
    const inputPath = process.argv[2] || process.env.SPOTIFY_HISTORY_DIR || './spotify-data';
    const files = findInputFiles(inputPath);

    console.log('==============================================');
    console.log('🎧 DJ PIXULA — IMPORTADOR SPOTIFY EXTENDED');
    console.log('==============================================');
    console.log(`📂 Carpeta/archivo: ${path.resolve(inputPath)}`);
    console.log(`📄 Archivos encontrados: ${files.length}`);
    console.log(`🗄️ Tabla destino: ${TABLE_NAME}`);

    const beforeCount = await getDatabaseCount();
    console.log(`📊 Registros antes de importar: ${beforeCount}`);

    const seenKeys = new Set();
    const totals = {
      totalJson: 0,
      prepared: 0,
      invalid: 0,
      duplicateInsideFiles: 0
    };

    for (const file of files) {
      const result = await importFile(file, seenKeys);
      totals.totalJson += result.totalJson;
      totals.prepared += result.prepared;
      totals.invalid += result.invalid;
      totals.duplicateInsideFiles += result.duplicateInsideFiles;
    }

    const afterCount = await getDatabaseCount();

    console.log('\n==============================================');
    console.log('🎉 IMPORTACIÓN FINALIZADA');
    console.log('==============================================');
    console.log(`📄 Registros JSON procesados: ${totals.totalJson}`);
    console.log(`✅ Registros válidos de música: ${totals.prepared}`);
    console.log(`⏭️ Registros inválidos/ignorados: ${totals.invalid}`);
    console.log(`♻️ Duplicados detectados en los archivos: ${totals.duplicateInsideFiles}`);
    console.log(`🗄️ Registros en Supabase antes: ${beforeCount}`);
    console.log(`🗄️ Registros en Supabase después: ${afterCount}`);
    console.log(`➕ Diferencia neta en la tabla: ${Math.max(0, afterCount - beforeCount)}`);
    console.log('==============================================\n');
  } catch (error) {
    console.error('\n❌ ERROR FATAL');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
