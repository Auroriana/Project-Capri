-- Optional prepared index. Original notes and legacy chunks remain untouched.
begin;
create table if not exists public.aria_prepared_chunks (
 id uuid primary key default gen_random_uuid(),
 note_id uuid not null references public.aria_notes(id) on delete cascade,
 owner_id uuid not null references auth.users(id),
 content_hash text not null, seq integer not null check(seq>=0),
 heading text not null, original_text text not null, clarified_text text not null,
 keywords jsonb not null default '[]', questions jsonb not null default '[]',
 embedding extensions.vector(768),
 created_at timestamptz not null default now(),
 unique(note_id,content_hash,seq)
);
alter table public.aria_prepared_chunks enable row level security;
create policy prepared_owner on public.aria_prepared_chunks for all to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.aria_notes n where n.id=note_id and n.owner_id=(select auth.uid()) and n.ai_enabled and not n.deleted))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.aria_notes n where n.id=note_id and n.owner_id=(select auth.uid()) and n.content_hash=aria_prepared_chunks.content_hash and n.ai_enabled and not n.deleted));
revoke all on public.aria_prepared_chunks from public,anon;
grant select,insert,update,delete on public.aria_prepared_chunks to authenticated;
create index if not exists aria_prepared_note on public.aria_prepared_chunks(note_id,content_hash,seq);
create or replace function public.aria_search_prepared(p_query text,p_embedding extensions.vector(768) default null,p_vault uuid default null)
returns table(id uuid,title text,source_path text,content text,vault_name text)
language sql stable security invoker set search_path='' as $$
 with ranked as (
 select c.id,n.title||' / '||c.heading as title,n.path,c.original_text,v.name,
 case when p_embedding is not null and c.embedding is not null then 1-(c.embedding operator(extensions.<=>) p_embedding) else 0 end as similarity,
 ts_rank(to_tsvector('simple',n.title||' '||c.heading||' '||c.clarified_text||' '||c.keywords::text||' '||c.questions::text),plainto_tsquery('simple',p_query)) as keyword_score
 from public.aria_prepared_chunks c join public.aria_notes n on n.id=c.note_id and n.content_hash=c.content_hash
 join public.aria_vaults v on v.id=n.vault_id
 where n.owner_id=auth.uid() and n.ai_enabled and not n.deleted and (p_vault is null or n.vault_id=p_vault)
 ) select id,title,path,original_text,name from ranked where (p_embedding is not null and similarity>0.5) or (p_embedding is null and keyword_score>0)
 order by similarity desc,keyword_score desc limit 8;
$$;
revoke all on function public.aria_search_prepared(text,extensions.vector,uuid) from public,anon;
grant execute on function public.aria_search_prepared(text,extensions.vector,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
