-- Storage privado de la intranet Chile.
--
-- La aplicación es el único cliente: usa una secret key desde Node y sirve
-- los objetos mediante /content y /media. No se crean policies para anon ni
-- authenticated. El límite deja margen sobre el máximo funcional actual
-- (videos de noticias: 200 MiB).

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

