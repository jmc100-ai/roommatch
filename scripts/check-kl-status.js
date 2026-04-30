require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data: kl } = await db.from('v2_indexed_cities').select('status,hotel_count,photo_count,updated_at').eq('city', 'Kuala Lumpur').single();
  const { count: klh } = await db.from('v2_hotels_cache').select('hotel_id', { count: 'exact', head: true }).eq('city', 'Kuala Lumpur');
  const { count: klf } = await db.from('v2_room_feature_facts').select('id', { count: 'exact', head: true }).eq('city', 'Kuala Lumpur');
  console.log('KL status:', kl?.status, '| v2_indexed_cities hotels:', kl?.hotel_count, '| v2_hotels_cache:', klh, '| facts:', klf);
  console.log('Updated at:', kl?.updated_at);
})();
