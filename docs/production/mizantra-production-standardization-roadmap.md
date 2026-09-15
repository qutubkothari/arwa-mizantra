# Mizantra Production Standardization Roadmap

## Decision

Mizantra Production will be a reusable, configuration-driven manufacturing
system for MSMEs. It must remain simple for daily users while producing
enterprise-grade planning, execution, control, costing and audit evidence.

New clients and industries must be implemented through configuration packs.
We will not create separate production engines, duplicate masters or
client-specific screens unless a requirement cannot be represented by the
standard production model.

## Source and sequencing

The AC duct manufacturing blueprint is a reference scenario:

`C:\Users\QK\Downloads\Mizantra_AC_Duct_Manufacturing_Implementation_Blueprint.docx`

The screw and rawl-plug scenario remains documented in:

`docs/production/production-development-reference.md`

The eight shared gaps in this roadmap must be completed and accepted first.
Only then should we return to the AC duct configuration pack.

## Canonical production model

There must be one governed production definition:

```text
Demand (sales order or project work package)
  -> Product or variant
  -> Approved BOM version
  -> Approved route version
  -> Operation resources and machine rules
  -> QC plan
  -> Costing definition
  -> Job order execution snapshot
  -> Actual material, time, output, quality and cost
  -> Dispatch, margin and management intelligence
```

A released job order must retain a frozen snapshot of the approved definition
used to create it. Later master-data changes must not silently alter historical
or in-process jobs.

## Existing reusable capability

The following capabilities already exist and must be consolidated rather than
rebuilt:

- Item, material and finished-goods masters.
- Multi-level BOMs and subassemblies.
- BOM revision, effectivity and approval controls.
- Routing and ordered production operations.
- Workstations, machines and product-specific resource profiles.
- Alternate resources, tooling, tool life and calibration controls.
- Job orders, SIV material issue, SRV receipt and QC closure.
- Shop-floor start, pause, output, rejection and downtime capture.
- Subcontract orders, material outward, vendor WIP, receipt and reconciliation.
- Incoming, in-process and final QC, NCR and CAPA.
- MRP netting, shortages, MOQ, order multiples, safety stock and alternatives.
- Maintenance, OEE, UID traceability and production variance foundations.

## Mandatory gaps before any industry pack

### Gap 1 - Project manufacturing structure

**Objective:** Extend the basic Project master into a reusable manufacturing
demand hierarchy.

Required standard objects:

- Project, customer, site and committed delivery date.
- BOQ or demand package.
- Work package with floor, area, zone or another configurable location label.
- Work-package lines for item/variant, quantity, UOM and required date.
- Status, ownership, attachments and audit trail.
- Links from work-package lines to MRP, job orders, procurement and dispatch.

**Acceptance:** A project line can generate controlled production demand and its
status can be traced through manufacture and delivery without manually copying
references.

### Gap 2 - Controlled drawing and document revision register

**Objective:** Replace loose drawing links with governed engineering evidence.

Required standard capability:

- Drawing/document number, type and revision.
- Draft, submitted, approved and retired lifecycle.
- Effective dates and independent approval.
- File, specification and approval evidence.
- Assignment to product/variant, BOM, route and project work package.
- Impact warning when a new revision affects open demand or jobs.

**Acceptance:** Production can only release against an approved, effective
revision, while old jobs preserve their original drawing snapshot.

### Gap 3 - Dynamic product specification and variants

**Objective:** Support client-specific dimensions and characteristics without
adding database columns or new screens for each industry.

Required standard capability:

- Administrator-defined typed attributes: number, text, option, boolean, date
  and unit-bearing measurement.
- Required/default values, allowed ranges and validation rules.
- Attribute groups and reusable product-family templates.
- Variant identity generated from selected attributes where required.
- Search using every configured attribute and its display value.
- Attribute effectivity and audit history.

Examples include duct width/height/length/gauge/material/insulation and screw
diameter/length/weight.

**Acceptance:** An administrator can configure a new product family and its
valid variants without a code change.

### Gap 4 - Formula-driven quantity and yield engine

**Objective:** Convert product attributes into governed planning quantities.

Required standard capability:

- Versioned formulas with named inputs, units and rounding rules.
- Formula output into BOM quantity, scrap/yield, operation time or cost driver.
- Test cases and approval before activation.
- Calculation trace showing input, formula version and result.
- Optional import of approved specialist outputs such as CAD/CNC nesting.
- Planned-versus-actual utilization and yield comparison.

**Acceptance:** A configured product can calculate its material requirement
from attributes reproducibly, and users can explain every calculated value.

### Gap 5 - Operation-level material allocation

**Objective:** Stage material availability and consumption at the operation
where it is actually required.

Required standard capability:

- Assign each BOM component to a route operation.
- Define issue method: manual, pre-stage, backflush or subcontract outward.
- Derive operation input warehouse/location at scheduling or release.
- Prevent premature consumption and duplicate issue/backflush.
- Support return, substitution, scrap and approved variance by operation.

**Acceptance:** MRP and shop-floor execution show when and where each material
is needed, and inventory is posted exactly once.

### Gap 6 - Unified planned and actual production costing

**Objective:** Join the production cost sheet to transaction evidence.

Required standard calculation:

- Planned material from the approved BOM and valuation basis.
- Actual material from SIV/backflush/returns and inventory cost events.
- Planned and actual labour/machine time by operation.
- Tooling and consumable usage.
- Subcontract charges.
- Scrap, rework and recoverable scrap value.
- Allocated overhead using a governed cost driver.
- Cost per good unit and complete variance explanation.

**Acceptance:** One job-cost statement reconciles planned cost, actual cost and
variance to the underlying controlled transactions.

### Gap 7 - Project dispatch, delivery and margin thread

**Objective:** Complete the digital thread after production.

Required standard capability:

- Allocate accepted finished output to a project/work-package line.
- Pack and dispatch by site/location/package reference.
- Record delivery and proof of delivery.
- Reconcile ordered, produced, accepted, dispatched and delivered quantity.
- Combine production, procurement, subcontract and delivery cost into project
  margin.

**Acceptance:** Management can open one project and see demand, production,
delivery, actual cost and margin with drill-down evidence.

### Gap 8 - Approved nesting and engineering-result integration

**Objective:** Integrate specialist optimization without duplicating CAD/CAM or
nesting software.

Required standard capability:

- Import a versioned nesting/engineering result by file or API.
- Map output material, sheet/coil size, developed pieces, planned usage and
  expected scrap to a work package and BOM/operation.
- Validate totals, units and revision before approval.
- Feed the approved result into MRP and the job-order snapshot.
- Compare planned nesting yield with actual issue, output and scrap.

**Acceptance:** Approved nesting output drives material planning and later yield
comparison, while the source file and revision remain traceable.

## Consolidation work required alongside the gaps

The gaps must not create more parallel modules. During implementation:

1. Select one canonical MRP/planning service and retire overlapping planning
   paths after migration and regression testing.
2. Keep BOM and routing as the engineering source of truth; do not require a
   second Manufacturing Model for the same definition.
3. Treat Production Programs or waves as optional planning views over canonical
   demand, not an independent order system.
4. Use one Resource model for machines, labour, tools, locations and eligible
   subcontractors.
5. Use one shop-floor actuals ledger for manual and IoT events.
6. Keep hidden legacy routes unavailable to users until they are consolidated
   or formally retired.

## Industry configuration packs

After the eight gaps pass acceptance, an industry pack may define:

- Attribute schema and product-family templates.
- Approved formula templates.
- Default BOM and operation templates.
- Machine/resource capability templates.
- QC characteristics and inspection templates.
- Cost-sheet elements and allocation defaults.
- Role workspace, report and dashboard presets.
- Import mappings to specialist engineering systems.

An industry pack must contain configuration and seed templates, not its own
planning or execution engine.

The future AC Duct pack should configure rectangular/round/fitting attributes,
sheet-development formulas, cutting/forming/flanging/insulation/assembly
routes, duct QC checks, project/site packaging and approved nesting import.

## AC duct controlled configuration release

Implemented on 7 September 2026 as a reusable industry-pack workflow, without
creating a client-specific production engine:

- Governed AC duct attribute and formula starter definitions.
- BOM output quantity/UOM basis and component consumption basis
  (`PER_OUTPUT`, `PER_BATCH`, `FIXED_SETUP`, or approved formula).
- Revision-controlled item-specific and generic UOM conversions with
  independent submit/approve control.
- One guided mapping from finished item and draft BOM to existing work centres.
- Per-operation material issue-point mapping.
- Draft incoming, in-process and final QC-plan generation from real entered
  specifications; blank tolerances are never invented.
- Inactive planned-cost-sheet generation and saved MRP proposal for review.
- Canonical job release from `production_routing`, with read-only fallback for
  legacy `bom_routing` revisions.
- Structural validation and an auditable mapping record before any draft is
  generated.

The release intentionally does not create items, drawings, BOMs, jobs, stock
movements, purchase documents or finance postings. Client-approved machine
times, QC tolerances, UOM factors, cost rates and make/buy policies must be
entered and independently approved before operational use.

## Development gate

Before accepting a new production feature, check whether it can be represented
as one of the following:

- Configurable attribute or validation rule.
- Approved formula.
- BOM component or alternative.
- Route operation or operation-material allocation.
- Resource capability or calendar.
- Tool, consumable or maintenance rule.
- QC characteristic or inspection plan.
- Cost element or allocation driver.
- Report, filter, dashboard preset or workflow rule.

If it can, implement it as configuration. Code development is allowed only for
a reusable platform capability with documented cross-industry value.

## Delivery order

| Order | Work package                                  | Status                                                                                                                                                                                                                      |
| ----: | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Project manufacturing structure               | In progress — schema, project workspace, controlled demand release and MRP pegging deployed to Mizantra; authenticated browser-flow acceptance pending                                                                      |
|     2 | Drawing/document revision register            | In progress - governed lifecycle, approval-impact warning and immutable job-release drawing/BOM snapshot deployed to Mizantra; authenticated maker/approver browser acceptance pending                                      |
|     3 | Dynamic product specification and variants    | In progress - configurable typed attributes, product specifications, lifecycle controls, search and Studio UI deployed to Mizantra; authenticated role-flow acceptance pending                                              |
|     4 | Formula-driven quantity and yield engine      | In progress - safe versioned formula engine, test cases, approval, evaluation trace and MRP/job-order integration deployed to Mizantra; authenticated scenario acceptance pending                                           |
|     5 | Operation-level material allocation           | In progress - BOM operation allocation, issue method, input warehouse and controlled job-material propagation deployed to Mizantra; transaction-flow acceptance pending                                                     |
|     6 | Unified planned and actual production costing | In progress - controlled job-cost snapshots and drill-down links integrated with the existing costing service and deployed to Mizantra; finance reconciliation acceptance pending                                           |
|     7 | Project dispatch, delivery and margin thread  | In progress - accepted-output delivery allocation and evidence workspace deployed to Mizantra; full dispatch/POD/margin role-flow acceptance pending                                                                        |
|     8 | Nesting/engineering-result integration        | In progress - governed engineering-result import, line validation, approval and immutable release snapshot deployed to Mizantra; external-file/API and yield-comparison acceptance pending                                  |
|     9 | AC Duct configuration pack and end-to-end UAT | In progress - reusable starter-pack registry, blueprint preview, and idempotent draft attribute/formula installation implemented; client master mapping, authenticated approval, route/QC mapping and end-to-end UAT remain |

Each work package must include migration safety, API and UI tests, role/access
tests, focused browser testing, affected-flow regression and deployment
evidence before its status changes to Complete.

## Non-negotiable product principles

- One obvious next action for MSME users.
- Enterprise controls underneath a simple role-based interface.
- Configuration before customization.
- No silent postings from recommendations or AI.
- Maker-checker for engineering, planning and financial-impact changes.
- Every calculated recommendation exposes inputs, assumptions and evidence.
- No removal of historical data or routes until migration and rollback are
  proven.
