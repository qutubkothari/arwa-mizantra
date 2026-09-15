# Mizantra Production Module — Deep Audit and Standard Flow

Date: 9 September 2026  
Scope: Mizantra only (`mizantra.saksolution.com`); Saifseas is excluded.  
Design rule: minimum user input, maximum controlled output for MSME users.

## Executive conclusion

The production module already contains the required business capabilities—BOM and revision control, routing, work centres, material planning, shortage PR, SIV, production reporting, SRV, QC, costing, subcontracting, tooling, downtime and maintenance—but one critical architecture break existed: the Job Order and Shop Floor used separate production-order records. Therefore routing operations visible in a Job Order did not reliably become start/stop operations in Shop Floor, and manual operation completion could incorrectly post the full Job Order quantity.

This release removes that split. Every Job Order with a BOM now owns one operator-facing execution order. Each BOM routing step is linked to the corresponding Job Order operation, and Shop Floor confirmations roll good, rejected, rework, time and status back into that same operation and Job Order.

## Standard operating flow

```text
Demand (daily prompt / project / sales order)
  → approved item + effective BOM
  → routing + eligible work centres
  → MRP availability check
  → shortage PR/PO/GRN, when required
  → SIV material issue
  → Job Order release
  → Shop Floor: start / pause / resume / complete each operation
  → operation WIP: good / rejected / rework / remaining
  → final output → QC
  → SRV finished-goods receipt
  → actual-vs-standard cost and production report
```

This separation follows ISA-95: ERP planning belongs at business-planning level, while dispatch and detailed execution belong in manufacturing operations management. Job responses must be reported against the dispatched workflow step and Job Order ([ISA-95 overview](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard), [ISA-95 job-control explanation](https://www.isa.org/intech-home/2017/january-february/features/advancements-in-isa-95)).

## What was corrected

1. **One Job Order, one execution record.** A database-enforced one-to-one link now prevents the planner and operator views from drifting apart.
2. **Routing is the process definition.** Every routing step receives a stable link to the Job Order operation; all route steps appear in the relevant work-centre queue.
3. **One execution screen.** Direct Start/Complete shortcuts were removed from Job Order details. The user opens Shop Floor, where the controlled quantity and time evidence is captured once.
4. **Individual process control.** Each process supports start, pause with downtime reason, resume, partial completion, good quantity, rejected quantity and optional rework quantity.
5. **Sequential WIP control.** A downstream operation cannot process more good WIP than the previous operation has supplied. Odoo documents the same predecessor dependency principle for manufacturing work orders ([Odoo work-order dependencies](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/work_order_dependencies.html)).
6. **Final-output roll-up.** The last routing operation updates the Job Order’s produced/rejected totals and closes shop-floor execution; the controlled Job Order QC/SRV handoff remains mandatory and it does not silently receive stock.
7. **Material reconciliation.** Job Order materials are mirrored into the execution order so a short run can show standard-used, recorded-used and expected balance for continue/next shift/next day/close short/return-to-store decisions.
8. **Historical compatibility.** Existing Job Orders, their operations and earlier matching execution records are linked by an additive migration; records are not deleted.
9. **Work-centre labels repaired.** Existing operation rows are backfilled from the canonical work-centre master so supervisors see the correct machine/station at every stage.
10. **Executable-routing gate.** A manufactured Job Order cannot be created from an empty or incomplete route; each process must have an operation name and work station.
11. **Faster route maintenance.** Work stations use smart search, cycle minutes automatically calculate duration and one-operator manhours, advanced timing stays collapsed, and processes can be moved up or down without deleting them.
12. **Truthful material status.** A zero-issue Job Order remains Pending; it can no longer display SIV/Material Issue as Completed merely because no loaded material row was present.

## Industry-standard control comparison

| Control | Industry expectation | Mizantra result |
|---|---|---|
| Order release | Release separates planning from execution and enables material withdrawal and confirmation | Controlled by Job Order status and SIV readiness; Shop Floor sees only released/in-progress work |
| Operation confirmation | Capture yield, scrap/rejection, rework, actual work/time, work centre and operator | Captured per routing step with operator and timestamps |
| Partial/final production | Permit partial confirmations without pretending the order is complete | Partial output and remaining balance are explicit |
| Routing dependency | Successor cannot start without predecessor output | Enforced using upstream good WIP |
| Material issue/return | Issue before production; unused balance returned through Stores | SIV remains controlled; return request requires Stores confirmation |
| Quality | Final output moves to inspection/NCR/rework before unrestricted stock | Final route closes execution; QC/SRV remains the stock-posting gate |
| Traceability | Unique order, operation, operator, time, quantity and disposition evidence | Linked Job Order → route → station completion → QC/SRV |
| Performance | Production KPIs should cover time, quality and loss categories | Runtime, downtime, good/reject, productivity and OEE services exist |

SAP’s production-confirmation model explicitly records yield, scrap, rework, actual work, work centre and operator, and supports partial or final operation confirmation ([SAP confirmations](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25a41481f62e469ba0e61015a0d39d20/2d6b6b54cd410e4ee10000000a423f68.html), [SAP partial/final confirmation](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f899ce30af9044299d573ea30b533f1c/b439c95360267614e10000000a174cb4.html)). SAP also places component withdrawal and confirmation after order release ([SAP order release](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/f899ce30af9044299d573ea30b533f1c/7f39c95360267614e10000000a174cb4.html)). Mizantra now follows those control points using MSME terminology and fewer screens.

Microsoft Dynamics describes “report as finished” as a partial or final quantity event that can backflush proportional material/time and create quality work ([Dynamics 365 report as finished](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/report-production-orders-as-finished)). Mizantra retains the same accounting boundary: operator output is evidence; SRV/QC performs the controlled inventory receipt.

Odoo’s Shop Floor guidance favours visual work-centre cards showing ready work, current/completed operations, time, components, quality and scrap ([Odoo Shop Floor](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html)). Mizantra applies that MSME-friendly pattern: select a work centre, see one recommended next operation, then disclose advanced readings only when needed.

ISO 22400 provides the framework for manufacturing KPIs across time, quality, effectiveness and resource use ([ISO 22400-2](https://www.iso.org/obp/ui?_escaped_fragment_=iso%3Astd%3Aiso%3A22400%3A-2%3Adis%3Aed-2%3Av1%3Aen)). These are supported by station confirmations, structured downtime, rejection and tooling evidence; client-specific KPI targets remain configuration, not hard-coded assumptions.

## AC duct manufacturing fit

For the ducting client, the routing can contain as many actual processes as required, for example:

1. Shearing / CNC cutting
2. Beading / grooving
3. Lock forming
4. TDF/TDC or flange forming
5. Corner / cleat fitting
6. Reinforcement
7. Insulation
8. Sealant / gasket
9. Assembly
10. Quality inspection
11. Packing
12. Dispatch readiness

The ERP must store the client’s approved duct specification and licensed construction-table result. It must not invent gauge, reinforcement or pressure-class rules. SMACNA identifies its HVAC duct construction standards as the recognised source for fabrication and installation requirements; licensed tables and approved project specifications remain the engineering source of truth ([SMACNA HVAC duct construction standards](https://www.smacna.org/technical-standards/hvac-duct-construction-standards)).

## Minimum-input user experience

### Planner

The normal daily path is one prompt or one short form: item, quantity and date. Mizantra derives the effective BOM, route, material demand, shortage documents and operation schedule, then presents a review before confirmation.

### Operator

The normal Shop Floor path is:

1. Select work centre.
2. Press **Start this operation**.
3. Enter only **Good quantity** and press **Complete**.

Rejected output requires a reason. Rework, actual input kg, process scrap, strokes/batches, tooling changes and downtime stay behind progressive disclosure, so a simple job remains simple.

### Supervisor

The supervisor sees route-level planned/good/rejected/rework/remaining quantities and intervenes only for shortages, downtime, quality holds or short-close decisions.

## Release-gate evidence

### AC duct demo catalogue

- Six approved finished products now cover straight duct, large straight duct, elbow, reducer, tee and insulated straight duct.
- Eight issueable material/consumable masters cover GI sheet by kg, flange and reinforcement by metre, corner cleats by piece, gasket and tape by metre, sealant by kg and insulation by square metre.
- The six BOMs contain 34 component lines and 49 work-centre-linked routing operations.
- All take-off quantities, scrap allowances, cycle times and commercial rates are explicitly marked as illustrative demo values. Client-approved drawings and licensed construction rules remain authoritative.
- A ten-piece tee preview expands into six SIV requirements: 151.800 kg GI sheet, 47.380 m flange, 120 corner cleats, 51.000 m gasket, 3.150 kg sealant and 18.540 m reinforcement angle.
- Existing released Job Orders keep their original controlled snapshot. The expanded BOM and routing are used by newly created Job Orders.
- Deployment backup: `/var/www/sak-erp-test/backups/ac-duct-demo-catalog-v1-20260909-104101`.

- Complete API regression: 49 suites, 479 tests passed across production, MRP, procurement, inventory, quality, sales, service and governed planner controls.
- API production/MRP/quality automated suites: 14 suites, 99 tests passed.
- Focused Job Order, routing, WIP, partial production, tooling and formula suites passed.
- API production build passed.
- Web TypeScript validation passed.
- Optimised web build passed, including Job Orders, BOM routing, Shop Floor, production reporting, MRP, QC, maintenance and production setup routes.
- Database migration is additive and transactional; it creates links and controls without deleting Job Orders or stock transactions.
- Live Mizantra schema audit passed against `db.nwkaruzvzwwuftjquypk.supabase.co`: 1 BOM-backed Job Order, 1 linked execution order, 12 linked operations, 3 completion evidence columns and 5 active control triggers.
- Signed-in live verification passed for `JO-2026-09-0001`: all 12 duct-routing operations load in sequence with canonical work-centre names and the SIV release gate shown on every pending operation.
- Live Job Orders and Shop Floor pages both returned HTTP 200 after deployment; the API and web PM2 services remained online.
- Mobile Shop Floor inspection showed no horizontal overflow and retained a full-width work-centre selector and operator workflow.
- Deployment backup: `/var/www/sak-erp-test/backups/unified-production-execution-20260909-v1-20260909-072836`.

## Controlled boundaries (not hidden automation)

- A prompt may prepare/review a Job Order but does not approve purchasing, post GRN, issue stock, approve QC or receive finished goods without the relevant controlled action.
- A Shop Floor completion records production evidence; it does not bypass QC or Stores.
- Closing short or returning unused material requires a reason; stock changes only after Stores confirms the return.
- Engineering specifications, construction tables, rates and machine standards must be approved client data before go-live.

This is deliberate: ISO 9001 guidance requires organisations to retain appropriate documented evidence of process execution and conformity, while the authority for disposition of nonconforming output must be controlled ([ISO 9001 documented information guidance](https://www.iso.org/files/live/sites/isoorg/files/standards/docs/en/iso_9001_2015_guidance_documented_information.pdf)).
