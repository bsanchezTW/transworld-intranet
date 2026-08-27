-- Storage privado de la intranet Perú.
-- Bucket distinto al de Chile. Vacío al crear. No reutilizar intranet-content.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'intranet-content-pe',
  'intranet-content-pe',
  false,
  262144000, -- 250 MiB
  null
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
