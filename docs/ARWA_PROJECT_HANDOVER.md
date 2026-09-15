# Arwa Mizantra Project Handover

## Provisioning status — 15 September 2026

- Application repository created and pushed at commit `4057295`.
- Dedicated application deployed and running under separate PM2 processes.
- Domain and HTTPS certificate activated; automatic renewal timer is enabled.
- Public login page and API access boundary verified.
- Public database structure cloned: 468 tables, 9 views and 80 functions, including constraints, indexes, triggers and RLS policies.
- Shared feature catalogue seeded with 96 records.
- Isolation verified after provisioning: 0 tenants and 0 users; no Saif business data was copied.
- Arwa organisation, administrator, client masters and opening balances remain onboarding activities because client-approved identities and source data have not yet been supplied.

## Deployment architecture

| Area | Arwa environment |
| --- | --- |
| Public URL | `https://arwa.mizantra.ae` |
| Git repository | `qutubkothari/arwa-mizantra` |
| Server root | `/var/www/arwa-mizantra` |
| Web process / port | `arwa-mizantra-web` / `3004` |
| API process / port | `arwa-mizantra-api` / `4002` |
| Database project | Dedicated Supabase project `igwbnjjepprmmhutrvej` |
| Market | Egypt |

## What was copied

The complete current Mizantra application and public database structure were copied. The database clone includes tables, views, functions, triggers, constraints, indexes, row-level-security policies and the shared feature catalogue.

Saif customer records, employees, financial documents, inventory transactions and other tenant data were intentionally not copied into Arwa. This prevents cross-customer data exposure. Arwa starts as a clean tenant and its own master and transaction data must be onboarded.

## Arwa onboarding

1. Create the Arwa organisation and first Super Admin.
2. Configure Egypt localisation: EGP, addresses, tax registrations, fiscal calendar and document numbering.
3. Apply Arwa branding, legal name, logo and document headers.
4. Configure plants, warehouses, departments, roles and users.
5. Import approved items, vendors, customers, BOMs, routings and opening stock.
6. Configure dedicated Arwa email identities and approval recipients. Do not reuse another client's mailbox credentials.
7. Validate purchase, inventory, production, sales, accounts and HR flows before entering live transactions.

## Release procedure

1. Merge and push a reviewed commit to the Arwa repository.
2. Pull it into `/var/www/arwa-mizantra`.
3. Validate the environment with the `arwa` deployment target guard.
4. Install locked dependencies, generate the Prisma client, and build the HR workspace package, API and web.
5. Restart only `arwa-mizantra-api` and `arwa-mizantra-web`.
6. Verify the public URL, authentication, API protection and core smoke tests.

Never restart or deploy the Saif or Mizantra test PM2 processes as part of an Arwa release.

## Security actions

- Rotate every credential shared during initial provisioning.
- Keep populated environment files only on the server and out of Git.
- Use unique JWT secrets and separate email/API integration credentials.
- Enable MFA for GitHub, Supabase, domain and server administrators.
- Review user roles and feature entitlements before client access.

## Acceptance checklist

- [ ] TLS and domain work without warnings.
- [ ] Only Arwa users can authenticate.
- [ ] No Saif or test customer data is visible.
- [ ] Egypt currency, address and tax fields are correct.
- [ ] Roles and permissions pass least-privilege testing.
- [ ] Master-data imports are reconciled to source totals.
- [ ] PR-to-PO-to-GRN and payable flows pass.
- [ ] BOM-to-job-order-to-production-receipt flows pass.
- [ ] Sales-to-dispatch-to-receivable flows pass.
- [ ] Attendance, approvals, payroll and reports pass.
- [ ] Backups, monitoring and email delivery are confirmed.
