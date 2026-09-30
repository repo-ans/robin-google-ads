-- Client contact on the New client form: the funeral home's contact person and
-- email (business contact - never a family member).
alter table public.clients
  add column contact_name  text check (contact_name is null or length(contact_name) <= 120),
  add column contact_email text check (contact_email is null or contact_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');
