-- Checkpoint JSON for long V2 reindex runs (catalog offset, scanned vs indexed counts).
ALTER TABLE v2_indexed_cities
  ADD COLUMN IF NOT EXISTS index_progress JSONB;
