import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan variables de Supabase en el archivo .env');
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  console.log('=================================');
  console.log('   PRUEBA DE SUPABASE');
  console.log('=================================');
  console.log('');

  console.log('Probando conexión con Supabase...');

  const { error } = await supabase
    .from('artists')
    .select('id')
    .limit(1);

  if (error) {
    console.error('');
    console.error('❌ Error al conectar con Supabase');
    console.error('');
    console.error('Mensaje:', error.message);
    console.error('');

    if (error.code) {
      console.error('Código:', error.code);
    }

    process.exit(1);
  }

  console.log('');
  console.log('✅ Conexión correcta con Supabase.');
  console.log('✅ La tabla artists existe.');
  console.log('✅ Node puede comunicarse con tu base de datos.');
  console.log('');
  console.log('=================================');
  console.log('          TODO CORRECTO');
  console.log('=================================');
}

testConnection();