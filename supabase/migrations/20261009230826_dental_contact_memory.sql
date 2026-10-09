-- Server-only contact memory. Existing project tables are untouched.
begin;
create table public.dental_contacts (
  clinic_id text not null check (clinic_id ~ '^[a-z0-9_-]{1,80}$'),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  name text check (length(name) between 3 and 100),
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  updated timestamptz not null,
  primary key (clinic_id, phone)
);
create table public.dental_appointments (
  clinic_id text not null,
  id text not null check (id ~ '^[a-f0-9]{8}$'),
  phone text not null,
  name text not null check (length(name) between 3 and 100),
  service text not null,
  professional text not null,
  start timestamptz not null,
  "end" timestamptz not null,
  busy_end timestamptz not null,
  status text not null check (status in ('confirmed','cancelled','rescheduled')),
  consent boolean not null,
  attendance boolean not null default false,
  updated timestamptz not null,
  primary key (clinic_id, id),
  foreign key (clinic_id, phone) references public.dental_contacts(clinic_id, phone),
  check (start < "end" and "end" <= busy_end)
);
create index dental_appointments_contact_idx on public.dental_appointments(clinic_id, phone, start desc);
create index dental_appointments_upcoming_idx on public.dental_appointments(clinic_id, start) where status='confirmed';
alter table public.dental_contacts enable row level security;
alter table public.dental_appointments enable row level security;
revoke all on public.dental_contacts, public.dental_appointments from public, anon, authenticated;
grant select, insert, update on public.dental_contacts, public.dental_appointments to service_role;

-- One transaction per contact snapshot; no browser or anonymous access.
create function public.dental_save_memory(p_clinic_id text, p_contact jsonb, p_appointments jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_phone text := p_contact->>'phone';
begin
  if p_clinic_id !~ '^[a-z0-9_-]{1,80}$' or v_phone !~ '^[0-9]{10,15}$'
    or jsonb_typeof(p_appointments) <> 'array' then
    raise exception 'Invalid contact snapshot';
  end if;
  if exists(select 1 from jsonb_array_elements(p_appointments) a where a->>'phone' is distinct from v_phone)
    or exists(select 1 from public.dental_appointments d join jsonb_array_elements(p_appointments) a on d.id=a->>'id'
      where d.clinic_id=p_clinic_id and d.phone<>v_phone) then
    raise exception 'Appointment owner mismatch';
  end if;
  insert into public.dental_contacts(clinic_id,phone,name,first_seen,last_seen,updated)
    values(p_clinic_id,v_phone,p_contact->>'name',(p_contact->>'first_seen')::timestamptz,(p_contact->>'last_seen')::timestamptz,(p_contact->>'updated')::timestamptz)
    on conflict(clinic_id,phone) do update set
      name=coalesce(excluded.name,dental_contacts.name),
      first_seen=least(dental_contacts.first_seen,excluded.first_seen),
      last_seen=greatest(dental_contacts.last_seen,excluded.last_seen),
      updated=greatest(dental_contacts.updated,excluded.updated);
  insert into public.dental_appointments(clinic_id,id,phone,name,service,professional,start,"end",busy_end,status,consent,attendance,updated)
    select p_clinic_id,a.id,a.phone,a.name,a.service,a.professional,a.start,a."end",a.busy_end,a.status,a.consent,a.attendance,(p_contact->>'updated')::timestamptz
    from jsonb_to_recordset(p_appointments) as a(id text,phone text,name text,service text,professional text,start timestamptz,"end" timestamptz,busy_end timestamptz,status text,consent boolean,attendance boolean)
    on conflict(clinic_id,id) do update set
      name=excluded.name,service=excluded.service,professional=excluded.professional,start=excluded.start,
      "end"=excluded."end",busy_end=excluded.busy_end,status=excluded.status,consent=excluded.consent,attendance=excluded.attendance,updated=excluded.updated
    where excluded.updated>=dental_appointments.updated;
end;
$$;
revoke all on function public.dental_save_memory(text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.dental_save_memory(text,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
