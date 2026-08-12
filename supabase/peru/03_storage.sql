-- Storage privado de la intranet Perú.
-- Mantener el mismo bucket/contrato que Chile, pero dentro del proyecto
-- Supabase independiente de la instancia PE.

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
  262144000, -- 250 MiB; máximo funcional actual: 200 MiB
  null
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

