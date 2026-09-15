import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function text(value: any, fallback = '') {
  return String(value ?? fallback).trim();
}

function code(value: any) {
  return text(value).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-_]/g, '').slice(0, 60);
}

function isMissingSchemaError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('schema cache') || message.includes('does not exist') || message.includes('exec_sql');
}

@Injectable()
export class ProjectsService {
  private supabase: SupabaseClient;
  private schemaReady: Promise<void> | null = null;

  constructor() {
    this.supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
  }

  async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;

    this.schemaReady = (async () => {
      const sql = `
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_code VARCHAR(80) NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  department VARCHAR(40) NOT NULL DEFAULT 'PRODUCTION',
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, project_code)
);

CREATE TABLE IF NOT EXISTS public.project_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type VARCHAR(80) NOT NULL,
  source_module VARCHAR(80),
  source_id UUID,
  source_number VARCHAR(120),
  remarks TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON public.projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_department ON public.projects(tenant_id, department);
CREATE INDEX IF NOT EXISTS idx_project_events_project ON public.project_events(project_id);

ALTER TABLE public.purchase_requisitions ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.purchase_requisitions ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE public.grns ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.grns ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_rnd_item BOOLEAN DEFAULT false;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS site_name VARCHAR(255);
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS site_address TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS committed_delivery_date DATE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_type VARCHAR(40) NOT NULL DEFAULT 'MANUFACTURING';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.project_work_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  package_code VARCHAR(80) NOT NULL, package_name VARCHAR(255) NOT NULL,
  package_type VARCHAR(60) NOT NULL DEFAULT 'MANUFACTURING', location_name VARCHAR(255),
  required_date DATE, priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 1 AND 100),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT', owner_user_id UUID, notes TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb, created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, package_code)
);

CREATE TABLE IF NOT EXISTS public.project_work_package_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_package_id UUID NOT NULL REFERENCES public.project_work_packages(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK(line_number > 0), item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  item_code VARCHAR(120), item_name TEXT, quantity NUMERIC(18,4) NOT NULL CHECK(quantity > 0),
  uom VARCHAR(30) NOT NULL, required_date DATE, demand_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  specification_values JSONB NOT NULL DEFAULT '{}'::jsonb, source_reference VARCHAR(160), created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, work_package_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_project_work_packages_project ON public.project_work_packages(tenant_id, project_id, status, required_date);
CREATE INDEX IF NOT EXISTS idx_project_work_package_lines_package ON public.project_work_package_lines(tenant_id, work_package_id, demand_status, required_date);

NOTIFY pgrst, 'reload schema';
`;

      const { error } = await this.supabase.rpc('exec_sql', { sql });
      if (!error) return;

      const message = String(error.message || '');
      if (message.includes('exec_sql')) {
        const probe = await this.supabase.from('projects').select('id', { count: 'exact', head: true }).limit(1);
        if (!probe.error) return;
      }

      if (isMissingSchemaError(error)) {
        console.warn('[ProjectsService] project schema unavailable; returning empty read models until migration is applied.');
        return;
      }

      throw new BadRequestException(`Project schema setup failed: ${error.message}`);
    })();

    return this.schemaReady;
  }

  async findAll(tenantId: string, query: any = {}) {
    await this.ensureSchema();
    let db = this.supabase
      .from('projects')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (query.department) db = db.eq('department', text(query.department).toUpperCase());
    if (query.status && query.status !== 'ALL') db = db.eq('status', text(query.status).toUpperCase());
    if (query.search) {
      const search = text(query.search).replace(/[%*,]/g, '');
      if (search) db = db.or(`project_code.ilike.%${search}%,project_name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await db;
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  async findOne(tenantId: string, id: string) {
    await this.ensureSchema();
    const { data, error } = await this.supabase
      .from('projects')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();
    if (error) throw new NotFoundException('Project not found');
    return data;
  }

  async create(tenantId: string, userId: string, body: any) {
    await this.ensureSchema();
    const name = text(body.projectName ?? body.project_name ?? body.name);
    if (!name) throw new BadRequestException('Project name is required.');
    const department = text(body.department || 'PRODUCTION').toUpperCase();
    if (!['PRODUCTION', 'R&D', 'RND'].includes(department)) {
      throw new BadRequestException('Department must be Production or R&D.');
    }
    const normalizedDepartment = department === 'RND' ? 'R&D' : department;
    const projectCode = code(body.projectCode ?? body.project_code) || code(name);

    const { data, error } = await this.supabase
      .from('projects')
      .insert({
        tenant_id: tenantId,
        project_code: projectCode,
        project_name: name,
        department: normalizedDepartment,
        status: text(body.status || 'ACTIVE').toUpperCase(),
        description: text(body.description) || null,
        customer_id: text(body.customerId ?? body.customer_id) || null,
        customer_name: text(body.customerName ?? body.customer_name) || null,
        site_name: text(body.siteName ?? body.site_name) || null,
        site_address: text(body.siteAddress ?? body.site_address) || null,
        committed_delivery_date: text(body.committedDeliveryDate ?? body.committed_delivery_date) || null,
        project_type: text(body.projectType ?? body.project_type ?? 'MANUFACTURING').toUpperCase(),
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.logEvent(tenantId, data.id, userId, {
      eventType: 'PROJECT_CREATED',
      sourceModule: 'PROJECTS',
      sourceId: data.id,
      sourceNumber: data.project_code,
      remarks: 'Project master created',
    });
    return data;
  }

  async update(tenantId: string, id: string, body: any) {
    await this.ensureSchema();
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.projectName !== undefined || body.project_name !== undefined || body.name !== undefined) {
      payload.project_name = text(body.projectName ?? body.project_name ?? body.name);
    }
    if (body.projectCode !== undefined || body.project_code !== undefined) payload.project_code = code(body.projectCode ?? body.project_code);
    if (body.department !== undefined) {
      const department = text(body.department).toUpperCase();
      payload.department = department === 'RND' ? 'R&D' : department;
    }
    if (body.status !== undefined) payload.status = text(body.status).toUpperCase();
    if (body.description !== undefined) payload.description = text(body.description) || null;
    if (body.customerId !== undefined || body.customer_id !== undefined) payload.customer_id = text(body.customerId ?? body.customer_id) || null;
    if (body.customerName !== undefined || body.customer_name !== undefined) payload.customer_name = text(body.customerName ?? body.customer_name) || null;
    if (body.siteName !== undefined || body.site_name !== undefined) payload.site_name = text(body.siteName ?? body.site_name) || null;
    if (body.siteAddress !== undefined || body.site_address !== undefined) payload.site_address = text(body.siteAddress ?? body.site_address) || null;
    if (body.committedDeliveryDate !== undefined || body.committed_delivery_date !== undefined) {
      payload.committed_delivery_date = text(body.committedDeliveryDate ?? body.committed_delivery_date) || null;
    }
    if (body.projectType !== undefined || body.project_type !== undefined) payload.project_type = text(body.projectType ?? body.project_type).toUpperCase();
    if (body.metadata !== undefined) payload.metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    const { data, error } = await this.supabase
      .from('projects')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async manufacturingDetail(tenantId: string, projectId: string) {
    await this.ensureSchema();
    const project = await this.findOne(tenantId, projectId);
    const [{ data: packages, error: packageError }, { data: lines, error: lineError }] = await Promise.all([
      this.supabase
        .from('project_work_packages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
      this.supabase
        .from('project_work_package_lines')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('project_id', projectId)
        .order('line_number', { ascending: true }),
    ]);
    if (packageError) throw new BadRequestException(packageError.message);
    if (lineError) throw new BadRequestException(lineError.message);

    const packageRows = (packages || []).map((workPackage: any) => ({
      ...workPackage,
      lines: (lines || []).filter((line: any) => line.work_package_id === workPackage.id),
    }));
    return {
      project,
      workPackages: packageRows,
      summary: {
        workPackages: packageRows.length,
        demandLines: (lines || []).length,
        releasedLines: (lines || []).filter((line: any) => !['DRAFT', 'CANCELLED'].includes(line.demand_status)).length,
        totalQuantity: (lines || []).reduce((sum: number, line: any) => sum + Number(line.quantity || 0), 0),
      },
    };
  }

  async createWorkPackage(tenantId: string, projectId: string, userId: string, body: any) {
    await this.ensureSchema();
    const project = await this.findOne(tenantId, projectId);
    const packageName = text(body.packageName ?? body.package_name ?? body.name);
    if (!packageName) throw new BadRequestException('Work package name is required.');
    const packageCode = code(body.packageCode ?? body.package_code) || code(packageName);
    const requiredDate = text(body.requiredDate ?? body.required_date) || project.committed_delivery_date || null;
    const priority = Number(body.priority ?? 50);
    if (!Number.isFinite(priority) || priority < 1 || priority > 100) {
      throw new BadRequestException('Priority must be between 1 and 100.');
    }

    const { data, error } = await this.supabase.from('project_work_packages').insert({
      tenant_id: tenantId,
      project_id: projectId,
      package_code: packageCode,
      package_name: packageName,
      package_type: text(body.packageType ?? body.package_type ?? 'MANUFACTURING').toUpperCase(),
      location_name: text(body.locationName ?? body.location_name) || null,
      required_date: requiredDate,
      priority,
      status: text(body.status || 'DRAFT').toUpperCase(),
      owner_user_id: text(body.ownerUserId ?? body.owner_user_id) || null,
      notes: text(body.notes) || null,
      attributes: body.attributes && typeof body.attributes === 'object' ? body.attributes : {},
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.logEvent(tenantId, projectId, userId, {
      eventType: 'WORK_PACKAGE_CREATED', sourceModule: 'PROJECTS', sourceId: data.id,
      sourceNumber: data.package_code, remarks: data.package_name,
    });
    return data;
  }

  async updateWorkPackage(tenantId: string, projectId: string, packageId: string, userId: string, body: any) {
    await this.findOne(tenantId, projectId);
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    const fields: Array<[string, string[]]> = [
      ['package_name', ['packageName', 'package_name', 'name']], ['package_code', ['packageCode', 'package_code']],
      ['package_type', ['packageType', 'package_type']], ['location_name', ['locationName', 'location_name']],
      ['required_date', ['requiredDate', 'required_date']], ['status', ['status']], ['notes', ['notes']],
      ['owner_user_id', ['ownerUserId', 'owner_user_id']],
    ];
    for (const [column, aliases] of fields) {
      const key = aliases.find((alias) => body[alias] !== undefined);
      if (key) payload[column] = column === 'package_code' ? code(body[key]) : column === 'status' || column === 'package_type' ? text(body[key]).toUpperCase() : text(body[key]) || null;
    }
    if (body.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isFinite(priority) || priority < 1 || priority > 100) throw new BadRequestException('Priority must be between 1 and 100.');
      payload.priority = priority;
    }
    if (body.attributes !== undefined) payload.attributes = body.attributes && typeof body.attributes === 'object' ? body.attributes : {};
    const { data, error } = await this.supabase.from('project_work_packages').update(payload)
      .eq('tenant_id', tenantId).eq('project_id', projectId).eq('id', packageId).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.logEvent(tenantId, projectId, userId, { eventType: 'WORK_PACKAGE_UPDATED', sourceModule: 'PROJECTS', sourceId: data.id, sourceNumber: data.package_code, remarks: data.status });
    return data;
  }

  async createWorkPackageLine(tenantId: string, projectId: string, packageId: string, userId: string, body: any) {
    await this.findOne(tenantId, projectId);
    const { data: workPackage, error: packageError } = await this.supabase.from('project_work_packages').select('*')
      .eq('tenant_id', tenantId).eq('project_id', projectId).eq('id', packageId).single();
    if (packageError || !workPackage) throw new NotFoundException('Work package not found.');
    const itemId = text(body.itemId ?? body.item_id);
    const quantity = Number(body.quantity);
    if (!itemId) throw new BadRequestException('Item is required.');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Quantity must be greater than zero.');
    const { data: item, error: itemError } = await this.supabase.from('items').select('id,code,name,uom')
      .eq('tenant_id', tenantId).eq('id', itemId).single();
    if (itemError || !item) throw new BadRequestException('Selected item was not found for this company.');
    const { data: lastLine } = await this.supabase.from('project_work_package_lines').select('line_number')
      .eq('tenant_id', tenantId).eq('work_package_id', packageId).order('line_number', { ascending: false }).limit(1).maybeSingle();
    const lineNumber = Number(body.lineNumber ?? body.line_number ?? (Number(lastLine?.line_number || 0) + 1));
    const { data, error } = await this.supabase.from('project_work_package_lines').insert({
      tenant_id: tenantId, project_id: projectId, work_package_id: packageId, line_number: lineNumber,
      item_id: item.id, item_code: item.code, item_name: item.name, quantity,
      uom: text(body.uom ?? item.uom ?? 'PCS').toUpperCase(),
      required_date: text(body.requiredDate ?? body.required_date) || workPackage.required_date || null,
      demand_status: text(body.demandStatus ?? body.demand_status ?? 'DRAFT').toUpperCase(),
      specification_values: body.specificationValues ?? body.specification_values ?? {},
      source_reference: text(body.sourceReference ?? body.source_reference) || null, created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.logEvent(tenantId, projectId, userId, { eventType: 'PROJECT_DEMAND_ADDED', sourceModule: 'PROJECTS', sourceId: data.id, sourceNumber: `${workPackage.package_code}/${data.line_number}`, remarks: `${data.item_code} - ${data.quantity} ${data.uom}` });
    return data;
  }

  async updateWorkPackageLine(tenantId: string, projectId: string, packageId: string, lineId: string, userId: string, body: any) {
    await this.findOne(tenantId, projectId);
    const { data: currentLine, error: currentError } = await this.supabase.from('project_work_package_lines')
      .select('*').eq('tenant_id', tenantId).eq('project_id', projectId).eq('work_package_id', packageId).eq('id', lineId).single();
    if (currentError || !currentLine) throw new NotFoundException('Project demand line not found.');
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.quantity !== undefined) {
      const quantity = Number(body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException('Quantity must be greater than zero.');
      payload.quantity = quantity;
    }
    if (body.requiredDate !== undefined || body.required_date !== undefined) payload.required_date = text(body.requiredDate ?? body.required_date) || null;
    if (body.demandStatus !== undefined || body.demand_status !== undefined) {
      const nextStatus = text(body.demandStatus ?? body.demand_status).toUpperCase();
      const transitions: Record<string, string[]> = {
        DRAFT: ['READY', 'CANCELLED'], READY: ['DRAFT', 'RELEASED', 'CANCELLED'],
        RELEASED: ['PLANNED', 'CANCELLED'], PLANNED: ['IN_PRODUCTION', 'CANCELLED'],
        IN_PRODUCTION: ['COMPLETED'], COMPLETED: [], CANCELLED: [],
      };
      if (!transitions[String(currentLine.demand_status || 'DRAFT')]?.includes(nextStatus)) {
        throw new BadRequestException(`Demand cannot move from ${currentLine.demand_status} to ${nextStatus}.`);
      }
      if (nextStatus === 'RELEASED') {
        const today = new Date().toISOString().slice(0, 10);
        const [{ data: item }, { data: bom }, { data: drawing }] = await Promise.all([
          this.supabase.from('items').select('id,drawing_required').eq('tenant_id', tenantId).eq('id', currentLine.item_id).single(),
          this.supabase.from('bom_headers').select('id').eq('tenant_id', tenantId).eq('item_id', currentLine.item_id)
            .eq('lifecycle_status', 'APPROVED').lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`).limit(1).maybeSingle(),
          this.supabase.from('item_drawings').select('id').eq('tenant_id', tenantId).eq('item_id', currentLine.item_id)
            .eq('lifecycle_status', 'APPROVED').eq('is_active', true).lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`).limit(1).maybeSingle(),
        ]);
        if (!bom) throw new BadRequestException('Approve an effective BOM for this item before releasing project demand.');
        if (item?.drawing_required === 'COMPULSORY' && !drawing) throw new BadRequestException('Approve an effective drawing revision before releasing project demand.');
      }
      payload.demand_status = nextStatus;
    }
    if (body.specificationValues !== undefined || body.specification_values !== undefined) payload.specification_values = body.specificationValues ?? body.specification_values ?? {};
    if (body.sourceReference !== undefined || body.source_reference !== undefined) payload.source_reference = text(body.sourceReference ?? body.source_reference) || null;
    const { data, error } = await this.supabase.from('project_work_package_lines').update(payload)
      .eq('tenant_id', tenantId).eq('project_id', projectId).eq('work_package_id', packageId).eq('id', lineId).select().single();
    if (error) throw new BadRequestException(error.message);
    await this.logEvent(tenantId, projectId, userId, { eventType: 'PROJECT_DEMAND_UPDATED', sourceModule: 'PROJECTS', sourceId: data.id, sourceNumber: String(data.line_number), remarks: data.demand_status });
    return data;
  }

  async trail(tenantId: string, id: string) {
    await this.ensureSchema();
    const project = await this.findOne(tenantId, id);
    const { data, error } = await this.supabase
      .from('project_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('project_id', id)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return { project, events: data || [] };
  }

  async logEvent(tenantId: string, projectId: string | null, userId: string | null, params: {
    eventType: string;
    sourceModule?: string;
    sourceId?: string | null;
    sourceNumber?: string | null;
    remarks?: string | null;
    metadata?: Record<string, any>;
  }) {
    await this.ensureSchema();
    if (!projectId) return null;
    const { error } = await this.supabase.from('project_events').insert({
      tenant_id: tenantId,
      project_id: projectId,
      event_type: params.eventType,
      source_module: params.sourceModule || null,
      source_id: params.sourceId || null,
      source_number: params.sourceNumber || null,
      remarks: params.remarks || null,
      metadata: params.metadata || {},
      created_by: userId || null,
    });
    if (error) throw new BadRequestException(error.message);
    return true;
  }
}
