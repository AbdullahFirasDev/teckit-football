-- ============================================================================
-- Super Admin bootstrap — run in Supabase Dashboard → SQL Editor.
--
-- Creates the initial 'admin' account so the platform can be managed:
--   1. auth.users           — the login account (bcrypt password, confirmed)
--   2. auth.identities      — required by GoTrue sign-in (else "invalid
--                             login credentials" even with the right password)
--   3. public.users         — profile row with role 'admin' (auto-created by
--                             the on_auth_user_created trigger; re-asserted
--                             here so the script also works on older installs)
--
-- Idempotent: safe to re-run. Re-running resets THIS admin's password to the
-- value below and re-asserts role='admin' — handy if the password is lost.
--
-- >>> EDIT v_password BELOW BEFORE RUNNING. The script refuses to run with
-- >>> the placeholder still in place.
-- ============================================================================

-- Resolve crypt()/gen_salt() whether pgcrypto lives in public or extensions.
set search_path = public, extensions;

do $seed_super_admin$
declare
    v_email     text := 'admin@platform.com';
    v_password  text := 'REPLACE_ME_WITH_A_STRONG_PASSWORD';
    v_full_name text := 'System Administrator';
    v_user_id   uuid;
begin
    -- Safety guard: never create a known default password.
    if v_password = 'REPLACE_ME_WITH_A_STRONG_PASSWORD' then
        raise exception 'Edit v_password in this script before running it.';
    end if;

    -- --------------------------------------------------------------------------
    -- 1. Create the auth user, or reset credentials if the email exists.
    -- --------------------------------------------------------------------------
    select id into v_user_id
      from auth.users
     where lower(email) = lower(v_email)
     limit 1;

    if v_user_id is null then
        insert into auth.users
            (id, aud, role, email, encrypted_password, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values (
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            v_email,
            crypt(v_password, gen_salt('bf')),
            now(),                       -- confirmed: no verification email needed
            '{"provider":"email","providers":["email"]}',
            jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
            now(), now()
        )
        returning id into v_user_id;
    else
        update auth.users
           set encrypted_password = crypt(v_password, gen_salt('bf')),
               email_confirmed_at = coalesce(email_confirmed_at, now()),
               raw_app_meta_data  = '{"provider":"email","providers":["email"]}',
               raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                                    || jsonb_build_object('full_name', v_full_name, 'role', 'admin'),
               updated_at         = now()
         where id = v_user_id;
    end if;

    -- --------------------------------------------------------------------------
    -- 2. Email identity — GoTrue resolves sign-ins through auth.identities.
    --    Convention: provider_id = user id, identity_data.sub = user id.
    -- --------------------------------------------------------------------------
    insert into auth.identities
        (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (
        v_user_id,
        'email',
        v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
        now(), now(), now()
    )
    on conflict do nothing;

    -- --------------------------------------------------------------------------
    -- 3. Drop orphan profile rows that share the email but point at another id
    --    (they would break the unique-email insert below). Only removed when no
    --    events reference them.
    -- --------------------------------------------------------------------------
    delete from public.users u
     where lower(u.email) = lower(v_email)
       and u.id <> v_user_id
       and not exists (select 1 from public.events e where e.organizer_id = u.id);

    -- --------------------------------------------------------------------------
    -- 4. Ensure the profile row exists with the admin role (covers installs
    --    where the auth user was created before the trigger existed).
    -- --------------------------------------------------------------------------
    insert into public.users (id, full_name, email, role)
    values (v_user_id, v_full_name, v_email, 'admin')
    on conflict (id) do update
        set full_name = excluded.full_name,
            email     = excluded.email,
            role      = 'admin';

    raise notice 'Super Admin ready: % (auth user %)', v_email, v_user_id;
end
$seed_super_admin$;
