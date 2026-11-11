-- Dynamic QR: scan analytics and visitor metadata.
-- Additive migration for installations that already applied 202611110001.

create index if not exists qr_scans_qr_time_idx
  on public.qr_scans(qr_id, scanned_at desc);

drop function if exists public.get_qr_content(text, text);

create function public.get_qr_content(
  p_slug text,
  p_password text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_qr public.qr_codes;
  v_password_hash text;
begin
  select * into v_qr
  from public.qr_codes
  where slug = p_slug and status = 'active';

  if not found or v_qr.published_at is null then
    return null;
  end if;

  select password_hash into v_password_hash
  from private.qr_passwords
  where qr_id = v_qr.id;

  if v_password_hash is not null then
    if p_password is null
       or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      return jsonb_build_object('password_required', true);
    end if;
  end if;

  insert into public.qr_scans(qr_id, user_agent)
  values (v_qr.id, left(p_user_agent, 500));

  return jsonb_build_object(
    'title', v_qr.title,
    'content', v_qr.published_content,
    'design', v_qr.design,
    'published_at', v_qr.published_at
  );
end;
$fn$;

revoke all on function public.get_qr_content(text, text, text) from public;
grant execute on function public.get_qr_content(text, text, text) to anon, authenticated;

create or replace function public.get_qr_analytics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'total_scans',
    (
      select count(*)
      from public.qr_scans s
      join public.qr_codes q on q.id = s.qr_id
      where q.owner_id = v_user
    ),
    'qr_codes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'qr_id', q.id,
          'title', q.title,
          'slug', q.slug,
          'scans', coalesce(s.scan_count, 0)
        )
        order by coalesce(s.scan_count, 0) desc, q.created_at desc
      )
      from public.qr_codes q
      left join lateral (
        select count(*) as scan_count
        from public.qr_scans
        where qr_id = q.id
      ) s on true
      where q.owner_id = v_user and q.status <> 'archived'
    ), '[]'::jsonb),
    'daily',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(days.day, 'YYYY-MM-DD'),
          'scans', coalesce(daily.scan_count, 0)
        )
        order by days.day
      )
      from generate_series(
        current_date - 13,
        current_date,
        interval '1 day'
      ) as days(day)
      left join (
        select date_trunc('day', scanned_at)::date as day, count(*) as scan_count
        from public.qr_scans s
        join public.qr_codes q on q.id = s.qr_id
        where q.owner_id = v_user
          and s.scanned_at >= current_date - 13
        group by date_trunc('day', scanned_at)::date
      ) daily on daily.day = days.day::date
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.get_qr_analytics() from public, anon;
grant execute on function public.get_qr_analytics() to authenticated;
