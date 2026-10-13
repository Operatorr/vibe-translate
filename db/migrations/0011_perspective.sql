-- Perspective: whether the user speaks AS the Character (their own voice) or
-- TO the Character (the user's voice, addressed to them). See adr/0009.
--
-- Characters default to `to`: a Character is someone the user writes to.
-- Segments record the generation-time perspective; existing rows stay null
-- because they were generated before the prompt distinguished the two, and
-- guessing would misdescribe them (the same rule as `segments.vibe`, adr/0007).
-- The shared cache keys on perspective through its fingerprint; the column is
-- descriptive, and pre-existing rows are orphaned by the prompt revision bump.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'perspective') then
    create type perspective as enum ('as', 'to');
  end if;
end$$;

alter table characters add column if not exists perspective perspective not null default 'to';
alter table segments add column if not exists perspective perspective;
alter table translation_cache add column if not exists perspective perspective;
