require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Create RPC to get distinct room photos from v2_room_feature_facts
  const { error } = await db.rpc('exec_ddl_unsafe', {}).catch(() => ({ error: 'no_exec_rpc' }));

  // Use the raw REST API to execute DDL
  const sql = `
CREATE OR REPLACE FUNCTION get_v2_room_photos(p_hotel_ids text[], p_city text)
RETURNS TABLE(hotel_id text, room_name text, room_type_id text, photo_url text, photo_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT ON (hotel_id, room_name, photo_url)
    hotel_id::text,
    room_name,
    room_type_id::text,
    photo_url,
    NULL::text AS photo_type
  FROM v2_room_feature_facts
  WHERE hotel_id = ANY(p_hotel_ids)
    AND city = p_city
    AND photo_url IS NOT NULL
  ORDER BY hotel_id, room_name, photo_url
  LIMIT 30000;
$$;
GRANT EXECUTE ON FUNCTION get_v2_room_photos(text[], text) TO anon, authenticated, service_role;
`;

  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/`,
    {
      method: 'GET',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
      }
    }
  );
  console.log('Supabase URL status:', resp.status);

  // Try via postgres directly using the management API
  const mgmtResp = await fetch(
    `https://api.supabase.com/v1/projects/dmgxrcmdihgsffvqllms/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  console.log('MGMT API status:', mgmtResp.status);
  const body = await mgmtResp.text();
  console.log('Body:', body.substring(0, 200));
})();
