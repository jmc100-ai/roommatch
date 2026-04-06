-- Applied 2026-04-06: extends fetch_hotel_photos with feature_flags for per-photo ordering.
-- If your DB still has the old signature, run this once.

DROP FUNCTION IF EXISTS public.fetch_hotel_photos(text[], integer);

CREATE OR REPLACE FUNCTION public.fetch_hotel_photos(
  hotel_ids text[],
  max_per_hotel integer DEFAULT 40
)
RETURNS TABLE(
  hotel_id text, hotel_name text, room_name text, room_type_id text,
  photo_url text, photo_type text, star_rating double precision, guest_rating double precision,
  feature_flags jsonb
)
LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL statement_timeout = '30000';
  RETURN QUERY
  WITH ranked AS (
    SELECT
      re.hotel_id       AS r_hotel_id,
      re.hotel_name     AS r_hotel_name,
      re.room_name      AS r_room_name,
      re.room_type_id   AS r_room_type_id,
      re.photo_url      AS r_photo_url,
      re.photo_type     AS r_photo_type,
      re.star_rating    AS r_star_rating,
      re.guest_rating   AS r_guest_rating,
      COALESCE(re.feature_flags, '{}'::jsonb) AS r_feature_flags,
      ROW_NUMBER() OVER (
        PARTITION BY re.hotel_id
        ORDER BY re.room_name, re.photo_type, re.id
      ) AS rn
    FROM room_embeddings re
    WHERE re.hotel_id = ANY(hotel_ids)
      AND re.embedding IS NOT NULL
  )
  SELECT r_hotel_id, r_hotel_name, r_room_name, r_room_type_id, r_photo_url, r_photo_type, r_star_rating, r_guest_rating, r_feature_flags
  FROM ranked
  WHERE rn <= max_per_hotel;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_hotel_photos(text[], integer) TO authenticated, anon, service_role;
