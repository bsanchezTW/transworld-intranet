-- Storage privado de la intranet Chile.
--
-- Idempotente: no borra objetos. El bucket histórico se conserva.
-- La aplicación es el único cliente (secret key). Sin policies para anon
-- ni authenticated.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'intranet-content',
  'intranet-content',
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
