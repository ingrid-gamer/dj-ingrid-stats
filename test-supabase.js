import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  console.log('Probando conexión con Supabase...');

  const { data, error } = await supabase
    .from('artists')
    .select('id')
    .limit(1);

  if (error) {
    console.error('❌ Error de conexión:');
    console.error(error.message);
    return;
  }

  console.log('✅ Conexión correcta con Supabase.');
  console.log('✅ La tabla artists existe y se puede consultar.');
}

testConnection();