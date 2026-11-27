-- #277 / #269 древо 2.0: фото у любого человека древа, не только у рассказчика (флаг family_tree).
-- Только добавляет. Файл — в бакете photos: <family_id>/people/<entity_id>-<время>.jpg (грузит сервер, lib/db/photos.ts).
alter table public.family_entities add column if not exists photo_url text;

comment on column public.family_entities.photo_url is
  'Древо (#269): путь фото человека в бакете photos (<family>/people/<entity>-<время>.jpg). Пусто — инициал; у рассказчика — storytellers.photo_url.';
