-- HR travel and per-diem support. Safe to run more than once.
alter table public.employees add column if not exists per_diem_amount numeric(12,2) default 0;

alter table public.attendance add column if not exists is_outstation_travel boolean default false;
alter table public.attendance add column if not exists travel_departure_time time;
alter table public.attendance add column if not exists travel_arrival_time time;
alter table public.attendance add column if not exists travel_notes text;

alter table public.attendance_records add column if not exists is_outstation_travel boolean default false;
alter table public.attendance_records add column if not exists travel_departure_time time;
alter table public.attendance_records add column if not exists travel_arrival_time time;
alter table public.attendance_records add column if not exists travel_notes text;

alter table public.payslips add column if not exists travel_days numeric(8,2) default 0;
alter table public.payslips add column if not exists per_diem_amount numeric(12,2) default 0;
alter table public.payslips add column if not exists total_per_diem numeric(12,2) default 0;

comment on column public.employees.per_diem_amount is 'Daily per-diem amount payable for approved outstation travel days.';
comment on column public.attendance.is_outstation_travel is 'Marks attendance as outstation travel eligible for per-diem evaluation.';
comment on column public.attendance.travel_departure_time is 'Outstation departure time; departures before 20:00 count as travel day.';
comment on column public.attendance.travel_arrival_time is 'Office return time; returns before 08:00 do not count as travel day.';
comment on column public.payslips.total_per_diem is 'Total per-diem allowance added to net salary for the payroll period.';
