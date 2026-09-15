import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { InventoryService } from '../../inventory/services/inventory.service';
import { EmailService } from '../../email/email.service';
import { QuotePdfService } from '../../documents/services/quote-pdf.service';
import { regionalDefaults, type RegionalDefaults } from '../../common/utils/market-profile';
import { AccountingService } from '../../accounting/accounting.service';

@Injectable()
export class ServiceService {
  private supabase: SupabaseClient;

  constructor(
    private readonly inventoryService?: InventoryService,
    private readonly emailService?: EmailService,
    private readonly quotePdfService?: QuotePdfService,
    private readonly accountingService?: AccountingService,
  ) {
    this.supabase = new SupabaseClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_KEY || '',
    );
  }

  async uploadServiceAttachments(
    tenantId: string,
    userId: string,
    files: Array<Express.Multer.File>,
  ): Promise<string[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const maxSizeBytes = 50 * 1024 * 1024;

    // Store uploads locally on the server (EC2). This avoids Supabase Storage.
    // Default: <repo>/uploads (on EC2: /home/ubuntu/sak-erp/uploads)
    const uploadsRoot =
      process.env.UPLOAD_ROOT_DIR || resolve(process.cwd(), '..', '..', 'uploads');

    const today = new Date().toISOString().split('T')[0];
    const uploads: string[] = [];

    for (const file of files) {
      const isAllowedType =
        file.mimetype?.startsWith('image/') ||
        file.mimetype?.startsWith('video/') ||
        ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'message/rfc822'].includes(file.mimetype || '');

      if (!isAllowedType) {
        throw new BadRequestException(
          `Unsupported file type: ${file.mimetype || 'unknown'}`,
        );
      }

      if (file.size > maxSizeBytes) {
        throw new BadRequestException(
          `File too large: ${file.originalname} exceeds 50MB`,
        );
      }

      const extensionFromName = extname(file.originalname || '').toLowerCase();
      const safeExtension =
        extensionFromName && extensionFromName.length <= 10
          ? extensionFromName
          : '';

      const relativeDir = `service/${today}/${tenantId}/${userId}`;
      const fileName = `${randomUUID()}${safeExtension}`;

      const targetDir = join(uploadsRoot, relativeDir);
      await fs.mkdir(targetDir, { recursive: true });

      const targetPath = join(targetDir, fileName);
      await fs.writeFile(targetPath, file.buffer);

      // Served by the API as /uploads/* (and proxied by Next.js)
      uploads.push(`/uploads/${relativeDir}/${fileName}`);
    }

    return uploads;
  }

  // ==================== Service Tickets ====================

  async createServiceTicket(tenantId: string, userId: string, data: any) {
    // Generate ticket number
    const ticketNumber = await this.generateTicketNumber(tenantId);

    // Validate warranty if UID provided
    let warrantyValidation: any = null;
    if (data.uid) {
      warrantyValidation = await this.validateWarrantyForUID(tenantId, data.uid);
    }

    let installedAsset: any = null;
    if (data.installed_asset_id) {
      const { data: asset } = await this.supabase.from('service_installed_assets').select('*').eq('tenant_id', tenantId).eq('id', data.installed_asset_id).maybeSingle();
      if (!asset || asset.customer_id !== data.customer_id || asset.status !== 'ACTIVE') {
        throw new BadRequestException('Selected installed asset must be active and belong to the ticket customer');
      }
      installedAsset = asset;
    }

    let serviceContract: any = null;
    if (data.service_contract_id) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: contract } = await this.supabase.from('service_contracts').select('*').eq('tenant_id', tenantId).eq('id', data.service_contract_id).maybeSingle();
      if (!contract || contract.customer_id !== data.customer_id || contract.status !== 'ACTIVE' || contract.start_date > today || contract.end_date < today) {
        throw new BadRequestException('Selected service contract is not an active entitlement for this customer');
      }
      if (installedAsset) {
        const { count: linkedAssetCount } = await this.supabase.from('service_contract_assets').select('*', { count: 'exact', head: true }).eq('contract_id', contract.id);
        if ((linkedAssetCount || 0) > 0) {
          const { data: link } = await this.supabase.from('service_contract_assets').select('asset_id').eq('contract_id', contract.id).eq('asset_id', installedAsset.id).maybeSingle();
          if (!link) throw new BadRequestException('Selected asset is not covered by this service contract');
        }
      }
      serviceContract = contract;
    }

    // A commissioned asset carries its own warranty entitlement. Selecting the
    // asset is enough; the correct active contract is resolved server-side.
    if (!serviceContract && installedAsset) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: contractLinks, error: contractLinksError } = await this.supabase
        .from('service_contract_assets')
        .select('contract:service_contracts(*)')
        .eq('asset_id', installedAsset.id);
      if (contractLinksError) throw new BadRequestException(contractLinksError.message);
      serviceContract = (contractLinks || [])
        .map((row: any) => row.contract)
        .filter((contract: any) => contract && contract.customer_id === data.customer_id && contract.status === 'ACTIVE' && contract.start_date <= today && contract.end_date >= today)
        .sort((left: any, right: any) => String(left.end_date).localeCompare(String(right.end_date)))[0] || null;
    }

    if (data.pm_schedule_id) {
      const { data: maintenanceSchedule } = await this.supabase.from('preventive_maintenance_schedule')
        .select('id, customer_id, uid, is_active').eq('tenant_id', tenantId).eq('id', data.pm_schedule_id).maybeSingle();
      if (!maintenanceSchedule || !maintenanceSchedule.is_active) throw new BadRequestException('Preventive-maintenance schedule is invalid or inactive');
      if (maintenanceSchedule.customer_id !== data.customer_id || String(maintenanceSchedule.uid) !== String(data.uid || '')) {
        throw new BadRequestException('Preventive-maintenance schedule does not match the ticket customer and equipment UID');
      }
    }

    // SLA targets are stored on the ticket when it is opened.  This keeps the
    // operational commitment auditable even if a future SLA policy changes.
    const openedAt = new Date();
    const sla = serviceContract
      ? { responseHours: Number(serviceContract.response_hours), resolutionHours: Number(serviceContract.resolution_hours) }
      : this.getSlaTargets(data.priority || 'MEDIUM', warrantyValidation?.is_valid ? 'WARRANTY' : data.service_type || 'PAID');
    const responseDueAt = data.response_due_at || new Date(openedAt.getTime() + sla.responseHours * 60 * 60 * 1000).toISOString();
    const resolutionDueAt = data.resolution_due_at || new Date(openedAt.getTime() + sla.resolutionHours * 60 * 60 * 1000).toISOString();

    const ticketData = {
      tenant_id: tenantId,
      ticket_number: ticketNumber,
      customer_id: data.customer_id,
      uid: data.uid || null,
      ship_name: data.ship_name || null,
      location: data.location || null,
      warranty_id: warrantyValidation?.warranty?.id || null,
      installed_asset_id: installedAsset?.id || null,
      service_contract_id: serviceContract?.id || null,
      pm_schedule_id: data.pm_schedule_id || null,
      entitlement_status: serviceContract?.contract_type === 'WARRANTY' || warrantyValidation?.is_valid ? 'WARRANTY' : serviceContract ? 'CONTRACT' : 'CHARGEABLE',
      service_type: serviceContract?.contract_type === 'WARRANTY' || warrantyValidation?.is_valid ? 'WARRANTY' : data.service_type || 'PAID',
      priority: data.priority || 'MEDIUM',
      status: 'OPEN',
      complaint_date: data.complaint_date || new Date().toISOString().split('T')[0],
      complaint_description: data.complaint_description,
      reported_by: data.reported_by,
      contact_number: data.contact_number,
      email: data.email,
      product_name: data.product_name || installedAsset?.asset_name,
      model_number: data.model_number,
      serial_number: data.serial_number || installedAsset?.serial_number,
      installation_date: data.installation_date || installedAsset?.installation_date,
      service_location: data.service_location || installedAsset?.location,
      is_under_warranty: warrantyValidation?.is_valid || serviceContract?.contract_type === 'WARRANTY' || false,
      warranty_valid_until: warrantyValidation?.warranty?.warranty_end_date || installedAsset?.warranty_until || null,
      expected_completion_date: data.expected_completion_date,
      response_due_at: responseDueAt,
      resolution_due_at: resolutionDueAt,
      estimated_cost: warrantyValidation?.is_valid || serviceContract ? 0 : data.estimated_cost || 0,
      commercial_approval_required: !serviceContract && !warrantyValidation?.is_valid,
      commercial_approval_status: !serviceContract && !warrantyValidation?.is_valid
        ? 'PENDING_ESTIMATE'
        : 'NOT_REQUIRED',
      attachments: data.attachments || [],
      created_by: userId,
    };

    const { data: ticket, error } = await this.supabase
      .from('service_tickets')
      .insert(ticketData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return ticket;
  }

  async getServiceTickets(tenantId: string, filters?: any) {
    let query = this.supabase
      .from('service_tickets')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.service_type) {
      query = query.eq('service_type', filters.service_type);
    }
    if (filters?.priority) {
      query = query.eq('priority', filters.priority);
    }
    if (filters?.customer_id) {
      query = query.eq('customer_id', filters.customer_id);
    }
    if (filters?.uid) {
      query = query.eq('uid', filters.uid);
    }

    const { data: tickets, error } = await query;

    if (error) throw new BadRequestException(error.message);

    // Fetch related data separately
    if (tickets && tickets.length > 0) {
      const customerIds = [...new Set(tickets.map(t => t.customer_id).filter(Boolean))];
      const warrantyIds = [...new Set(tickets.map(t => t.warranty_id).filter(Boolean))];
      const ticketIds = tickets.map((ticket) => ticket.id);

      // Fetch customers
      let customersMap: Record<string, any> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await this.supabase
          .from('customers')
          .select('id, customer_name, customer_code')
          .in('id', customerIds);
        
        if (customers) {
          customersMap = Object.fromEntries(customers.map(c => [c.id, c]));
        }
      }

      // Fetch warranties
      let warrantiesMap: Record<string, any> = {};
      if (warrantyIds.length > 0) {
        const { data: warranties } = await this.supabase
          .from('warranties')
          .select('id, warranty_number, warranty_end_date')
          .in('id', warrantyIds);
        
        if (warranties) {
          warrantiesMap = Object.fromEntries(warranties.map(w => [w.id, w]));
        }
      }

      const [{ data: assignments }, { data: visits }] = await Promise.all([
        this.supabase.from('service_assignments')
          .select('*, technician:technicians(id, technician_code, technician_name, contact_number)')
          .in('service_ticket_id', ticketIds),
        this.supabase.from('service_site_visits')
          .select('*, assignment:service_assignments(id, status, technician:technicians(id, technician_code, technician_name, contact_number))')
          .eq('tenant_id', tenantId)
          .in('service_ticket_id', ticketIds),
      ]);
      const assignmentsByTicket = (assignments || []).reduce((map: Record<string, any[]>, row: any) => {
        (map[row.service_ticket_id] ||= []).push(row);
        return map;
      }, {});
      const visitsByTicket = (visits || []).reduce((map: Record<string, any[]>, row: any) => {
        (map[row.service_ticket_id] ||= []).push(row);
        return map;
      }, {});

      // Attach related data to tickets
      return tickets.map(ticket => ({
        ...ticket,
        customer: customersMap[ticket.customer_id] || null,
        warranty: ticket.warranty_id ? warrantiesMap[ticket.warranty_id] || null : null,
        assignments: assignmentsByTicket[ticket.id] || [],
        site_visits: visitsByTicket[ticket.id] || [],
        sla: this.calculateTicketSla(ticket),
      }));
    }

    return tickets || [];
  }

  async getServiceTicketById(tenantId: string, ticketId: string) {
    const { data, error } = await this.supabase
      .from('service_tickets')
      .select(`
        *,
        customer:customers(*),
        warranty:warranties(*),
        assignments:service_assignments(
          *,
          technician:technicians(*)
        ),
        site_visits:service_site_visits(
          *,
          assignment:service_assignments(
            id,
            status,
            technician:technicians(id, technician_code, technician_name, contact_number)
          )
        ),
        checklist:service_ticket_checklist_items(*),
        parts_used:service_parts_used(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', ticketId)
      .single();

    if (error) throw new NotFoundException('Service ticket not found');

    return data;
  }

  async updateServiceTicket(tenantId: string, ticketId: string, data: any) {
    const current = await this.getOwnedTicket(tenantId, ticketId);
    const requestedBusinessFieldChange = Object.keys(data || {}).some((field) => field !== 'status');
    if (requestedBusinessFieldChange && ['COMPLETED', 'CLOSED', 'CANCELLED'].includes(current.status)) {
      throw new BadRequestException(
        `A ${current.status} service ticket is locked; use the document trail and controlled follow-on actions`,
      );
    }
    const allowedFields = [
      'priority',
      'expected_completion_date',
      'ship_name',
      'location',
      'service_location',
      'product_name',
      'model_number',
      'serial_number',
      'reported_by',
      'contact_number',
      'email',
      'complaint_description',
      'estimated_cost',
      'attachments',
    ];
    const updateData = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
        .map((field) => [field, data[field]]),
    );

    if (data.status && data.status !== current.status) {
      this.assertTicketStatusTransition(current.status, data.status);
      updateData.status = data.status;
    }

    const { data: ticket, error } = await this.supabase
      .from('service_tickets')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return ticket;
  }

  async deleteServiceTicket(tenantId: string, ticketId: string) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (ticket.status !== 'OPEN') {
      throw new BadRequestException('Only an OPEN ticket without follow-on activity can be deleted');
    }

    const [{ count: assignmentCount }, { count: partsCount }] = await Promise.all([
      this.supabase
        .from('service_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('service_ticket_id', ticketId),
      this.supabase
        .from('service_parts_used')
        .select('*', { count: 'exact', head: true })
        .eq('service_ticket_id', ticketId),
    ]);

    if ((assignmentCount || 0) > 0 || (partsCount || 0) > 0) {
      throw new BadRequestException('Ticket has follow-on documents and cannot be deleted; cancel it instead');
    }

    const { error } = await this.supabase
      .from('service_tickets')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', ticketId);
    if (error) throw new BadRequestException(error.message);
    return { message: `Service ticket ${ticket.ticket_number} deleted` };
  }

  async closeServiceTicket(tenantId: string, ticketId: string, userId: string, data: any) {
    const current = await this.getOwnedTicket(tenantId, ticketId);
    this.assertTicketStatusTransition(current.status, 'CLOSED');
    if (!data.resolution_description?.trim()) {
      throw new BadRequestException('Resolution description is required before closing a ticket');
    }
    // Update ticket status to CLOSED
    const { data: ticket, error } = await this.supabase
      .from('service_tickets')
      .update({
        status: 'CLOSED',
        actual_completion_date: data.completion_date || new Date().toISOString().split('T')[0],
        resolution_description: data.resolution_description,
        actual_cost: data.actual_cost,
        parts_cost: data.parts_cost,
        labor_cost: data.labor_cost,
        closed_by: userId,
        closed_at: new Date().toISOString(),
        customer_feedback: data.customer_feedback,
        customer_rating: data.customer_rating,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Create service history entry
    if (ticket.uid) {
      await this.createServiceHistoryEntry(tenantId, ticket);
    }

    return ticket;
  }

  // ==================== Warranty Validation ====================

  async validateWarrantyForUID(tenantId: string, uid: string) {
    const { data: warranty, error } = await this.supabase
      .from('warranties')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .eq('status', 'ACTIVE')
      .single();

    if (error || !warranty) {
      // Fallback: deployment tracking (supports part-number based workflows)
      const { data: deploymentStatus } = await this.supabase
        .from('v_uid_deployment_status')
        .select('warranty_expiry_date')
        .eq('tenant_id', tenantId)
        .eq('uid', uid)
        .single();

      const warrantyExpiryDate = deploymentStatus?.warranty_expiry_date;
      if (!warrantyExpiryDate) {
        return {
          is_valid: false,
          warranty: null,
          message: 'No active warranty found for this UID',
        };
      }

      const today = new Date();
      const warrantyEndDate = new Date(warrantyExpiryDate);
      const isValid = today <= warrantyEndDate;

      return {
        is_valid: isValid,
        warranty: {
          warranty_end_date: warrantyExpiryDate,
          source: 'deployment',
        },
        message: isValid
          ? 'Warranty is valid'
          : `Warranty expired on ${warrantyExpiryDate}`,
        days_remaining: isValid
          ? Math.ceil((warrantyEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          : 0,
      };
    }

    const today = new Date();
    const warrantyEndDate = new Date(warranty.warranty_end_date);

    const isValid = today <= warrantyEndDate;

    return {
      is_valid: isValid,
      warranty: warranty,
      message: isValid
        ? 'Warranty is valid'
        : `Warranty expired on ${warranty.warranty_end_date}`,
      days_remaining: isValid
        ? Math.ceil((warrantyEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 0,
    };
  }

  // ==================== Technicians ====================

  async getEligibleTechnicianEmployees(tenantId: string) {
    const { data, error } = await this.supabase
      .from('employees')
      .select('id, employee_code, employee_name, designation, department, contact_number, email, status')
      .eq('tenant_id', tenantId)
      .order('employee_name');

    if (error) throw new BadRequestException(error.message);

    return (data || []).filter((employee: any) =>
      String(employee.status || '').toUpperCase() !== 'INACTIVE' &&
      /technician/i.test(String(employee.designation || '')),
    );
  }

  async createTechnician(tenantId: string, data: any) {
    const employeeId = String(data.employee_id || '').trim() || null;
    if (employeeId) {
      const { data: employee, error: employeeError } = await this.supabase
        .from('employees')
        .select('id, designation, status')
        .eq('tenant_id', tenantId)
        .eq('id', employeeId)
        .maybeSingle();
      if (employeeError) throw new BadRequestException(employeeError.message);
      if (!employee || String(employee.status || '').toUpperCase() === 'INACTIVE' || !/technician/i.test(String(employee.designation || ''))) {
        throw new BadRequestException('Select an active employee with a Technician designation.');
      }

      const { data: existing, error: existingError } = await this.supabase
        .from('technicians')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .maybeSingle();
      if (existingError) throw new BadRequestException(existingError.message);
      if (existing) throw new BadRequestException('This employee is already linked to a service technician.');
    }

    const technicianCode = await this.generateTechnicianCode(tenantId);

    const technicianData = {
      tenant_id: tenantId,
      technician_code: technicianCode,
      technician_name: data.technician_name,
      employee_id: employeeId,
      specialization: data.specialization,
      contact_number: data.contact_number,
      email: data.email,
      daily_capacity_hours: this.validateDailyCapacity(data.daily_capacity_hours),
      skills: this.normalizeTextList(data.skills),
      territories: this.normalizeTextList(data.territories),
      base_location: String(data.base_location || '').trim() || null,
      shift_start: this.validateShiftTime(data.shift_start, '09:00'),
      shift_end: this.validateShiftTime(data.shift_end, '18:00'),
      working_days: this.validateWorkingDays(data.working_days),
      is_active: true,
    };

    this.assertValidShift(technicianData.shift_start, technicianData.shift_end);

    const { data: technician, error } = await this.supabase
      .from('technicians')
      .insert(technicianData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return technician;
  }

  async getTechnicians(tenantId: string, activeOnly = true) {
    let query = this.supabase
      .from('technicians')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('technician_name');

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async updateTechnician(tenantId: string, technicianId: string, data: any) {
    const allowedFields = [
      'technician_name',
      'employee_id',
      'specialization',
      'contact_number',
      'email',
      'daily_capacity_hours',
      'skills',
      'territories',
      'base_location',
      'shift_start',
      'shift_end',
      'working_days',
      'is_active',
    ];
    const updateData = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
        .map((field) => [field, data[field]]),
    );
    if (updateData.technician_name !== undefined && !String(updateData.technician_name).trim()) {
      throw new BadRequestException('Technician name is required');
    }
    if (updateData.daily_capacity_hours !== undefined) {
      updateData.daily_capacity_hours = this.validateDailyCapacity(updateData.daily_capacity_hours);
    }
    if (updateData.skills !== undefined) updateData.skills = this.normalizeTextList(updateData.skills);
    if (updateData.territories !== undefined) updateData.territories = this.normalizeTextList(updateData.territories);
    if (updateData.base_location !== undefined) updateData.base_location = String(updateData.base_location || '').trim() || null;
    if (updateData.working_days !== undefined) updateData.working_days = this.validateWorkingDays(updateData.working_days);
    if (updateData.shift_start !== undefined) updateData.shift_start = this.validateShiftTime(updateData.shift_start, '09:00');
    if (updateData.shift_end !== undefined) updateData.shift_end = this.validateShiftTime(updateData.shift_end, '18:00');
    if (updateData.shift_start !== undefined || updateData.shift_end !== undefined) {
      const { data: current } = await this.supabase.from('technicians').select('shift_start, shift_end')
        .eq('tenant_id', tenantId).eq('id', technicianId).maybeSingle();
      if (!current) throw new NotFoundException('Technician not found');
      this.assertValidShift(updateData.shift_start || current.shift_start, updateData.shift_end || current.shift_end);
    }

    const { data: technician, error } = await this.supabase
      .from('technicians')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', technicianId)
      .select()
      .single();
    if (error || !technician) throw new NotFoundException('Technician not found');
    return technician;
  }

  async deleteTechnician(tenantId: string, technicianId: string) {
    const { data: technician, error: technicianError } = await this.supabase
      .from('technicians')
      .select('id, technician_name, is_active')
      .eq('tenant_id', tenantId)
      .eq('id', technicianId)
      .single();
    if (technicianError || !technician) throw new NotFoundException('Technician not found');

    const { count } = await this.supabase
      .from('service_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('technician_id', technicianId);

    if ((count || 0) > 0) {
      const { error } = await this.supabase
        .from('technicians')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', technicianId);
      if (error) throw new BadRequestException(error.message);
      return { message: `${technician.technician_name} deactivated because service history exists`, deactivated: true };
    }

    const { error } = await this.supabase
      .from('technicians')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', technicianId);
    if (error) throw new BadRequestException(error.message);
    return { message: `${technician.technician_name} deleted`, deactivated: false };
  }

  // ==================== Service Assignments ====================

  async checkInServiceVisit(tenantId: string, userId: string, ticketId: string, input: any) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(String(ticket.status || '').toUpperCase())) {
      throw new BadRequestException(`Cannot start a site visit on a ${ticket.status} service ticket`);
    }
    if (!String(input.site_contact_name || '').trim()) {
      throw new BadRequestException('On-site client contact name is required');
    }

    const { data: assignment, error: assignmentError } = await this.supabase
      .from('service_assignments')
      .select('*, technician:technicians!inner(id, tenant_id, technician_name)')
      .eq('id', input.service_assignment_id)
      .eq('service_ticket_id', ticketId)
      .eq('technician.tenant_id', tenantId)
      .maybeSingle();
    if (assignmentError || !assignment) throw new BadRequestException('Select a valid technician assignment for this ticket');
    if (!['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'].includes(String(assignment.status || '').toUpperCase())) {
      throw new BadRequestException('Only an active technician assignment can start a site visit');
    }
    this.assertCommercialApproval(ticket);

    const beforeAttachments = this.validateServiceEvidence(input.before_attachments);
    const coordinates = this.validateServiceCoordinates(input.check_in_lat, input.check_in_lng, 'check-in');
    const { data: previousVisit } = await this.supabase
      .from('service_site_visits')
      .select('visit_number')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .order('visit_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: visit, error } = await this.supabase
      .from('service_site_visits')
      .insert({
        tenant_id: tenantId,
        service_ticket_id: ticketId,
        service_assignment_id: assignment.id,
        visit_number: Number(previousVisit?.visit_number || 0) + 1,
        status: 'CHECKED_IN',
        purpose: String(input.purpose || '').trim() || null,
        site_contact_name: String(input.site_contact_name).trim(),
        site_contact_designation: String(input.site_contact_designation || '').trim() || null,
        site_contact_mobile: String(input.site_contact_mobile || '').trim() || null,
        site_contact_email: String(input.site_contact_email || '').trim() || null,
        check_in_at: new Date().toISOString(),
        check_in_lat: coordinates.lat,
        check_in_lng: coordinates.lng,
        check_in_location: String(input.check_in_location || '').trim() || null,
        before_attachments: beforeAttachments,
        created_by: userId,
      })
      .select('*, assignment:service_assignments(id, status, technician:technicians(id, technician_code, technician_name, contact_number))')
      .single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('This technician assignment already has an open site visit');
      throw new BadRequestException(error.message);
    }

    try {
      if (String(assignment.status).toUpperCase() !== 'IN_PROGRESS') {
        await this.updateAssignment(tenantId, assignment.id, {
          status: 'IN_PROGRESS',
          actual_start_date: assignment.actual_start_date || visit.check_in_at,
        });
      }
    } catch (progressError) {
      await this.supabase.from('service_site_visits').delete().eq('tenant_id', tenantId).eq('id', visit.id);
      throw progressError;
    }
    return visit;
  }

  async checkOutServiceVisit(tenantId: string, userId: string, visitId: string, input: any) {
    const { data: visit, error: visitError } = await this.supabase
      .from('service_site_visits')
      .select('*, assignment:service_assignments!inner(*, technician:technicians!inner(tenant_id))')
      .eq('tenant_id', tenantId)
      .eq('id', visitId)
      .eq('assignment.technician.tenant_id', tenantId)
      .maybeSingle();
    if (visitError || !visit) throw new NotFoundException('Service site visit not found');
    if (visit.status !== 'CHECKED_IN') throw new BadRequestException('This site visit is already closed');
    if (!String(input.work_notes || '').trim()) throw new BadRequestException('Work performed during the visit is required');
    if (!String(input.customer_acknowledgement_name || '').trim()) {
      throw new BadRequestException('Customer acknowledgement name is required at check-out');
    }
    const customerSignatureUrl = String(input.customer_signature_url || '').trim() || null;
    const signatureDeclinedReason = String(input.signature_declined_reason || '').trim() || null;
    if (!customerSignatureUrl && !signatureDeclinedReason) {
      throw new BadRequestException('Capture the customer signature, or record why signature was declined');
    }
    const afterAttachments = this.validateServiceEvidence(input.after_attachments);
    if ((visit.before_attachments || []).length === 0 && afterAttachments.length === 0) {
      throw new BadRequestException('Upload at least one photo or video as site-visit evidence');
    }
    const coordinates = this.validateServiceCoordinates(input.check_out_lat, input.check_out_lng, 'check-out');
    const completedAt = new Date().toISOString();
    const { data: completed, error } = await this.supabase
      .from('service_site_visits')
      .update({
        status: 'COMPLETED',
        check_out_at: completedAt,
        check_out_lat: coordinates.lat,
        check_out_lng: coordinates.lng,
        check_out_location: String(input.check_out_location || '').trim() || null,
        work_notes: String(input.work_notes).trim(),
        customer_acknowledgement_name: String(input.customer_acknowledgement_name).trim(),
        customer_acknowledged_at: completedAt,
        customer_signature_url: customerSignatureUrl,
        customer_signature_designation: String(input.customer_signature_designation || '').trim() || null,
        signature_declined_reason: signatureDeclinedReason,
        after_attachments: afterAttachments,
        completed_by: userId,
        updated_at: completedAt,
      })
      .eq('tenant_id', tenantId)
      .eq('id', visitId)
      .eq('status', 'CHECKED_IN')
      .select('*, assignment:service_assignments(id, status, technician:technicians(id, technician_code, technician_name, contact_number))')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!completed) throw new BadRequestException('This site visit was already closed by another user');

    if (input.complete_assignment === true && String(visit.assignment?.status).toUpperCase() === 'IN_PROGRESS') {
      await this.updateAssignment(tenantId, visit.service_assignment_id, {
        status: 'COMPLETED',
        actual_end_date: completedAt,
        work_notes: String(input.work_notes).trim(),
      });
    }
    return completed;
  }

  async getServiceVisits(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase
      .from('service_site_visits')
      .select('*, assignment:service_assignments(id, status, technician:technicians(id, technician_code, technician_name, contact_number))')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .order('visit_number');
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async getChecklistTemplates(tenantId: string, activeOnly = true) {
    let query = this.supabase.from('service_checklist_templates')
      .select('*, items:service_checklist_template_items(*)')
      .eq('tenant_id', tenantId)
      .order('template_name');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((template: any) => ({
      ...template,
      items: (template.items || []).sort((a: any, b: any) => Number(a.sort_order) - Number(b.sort_order)),
    }));
  }

  async createChecklistTemplate(tenantId: string, userId: string, input: any) {
    const templateName = String(input.template_name || '').trim();
    const items = this.validateChecklistTemplateItems(input.items);
    if (!templateName) throw new BadRequestException('Checklist template name is required');
    const { data: template, error } = await this.supabase.from('service_checklist_templates').insert({
      tenant_id: tenantId,
      template_name: templateName,
      service_type: String(input.service_type || '').trim() || null,
      description: String(input.description || '').trim() || null,
      is_active: input.is_active !== false,
      created_by: userId,
    }).select().single();
    if (error || !template) throw new BadRequestException(error?.code === '23505' ? 'A checklist template with this name already exists' : error?.message || 'Checklist template could not be created');
    const { error: itemError } = await this.supabase.from('service_checklist_template_items').insert(items.map((item: any, index: number) => ({
      template_id: template.id,
      item_text: item.item_text,
      is_required: item.is_required,
      sort_order: index + 1,
    })));
    if (itemError) {
      await this.supabase.from('service_checklist_templates').delete().eq('tenant_id', tenantId).eq('id', template.id);
      throw new BadRequestException(itemError.message);
    }
    return (await this.getChecklistTemplates(tenantId, false)).find((row: any) => row.id === template.id);
  }

  async updateChecklistTemplate(tenantId: string, templateId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_checklist_templates').select('id, template_name').eq('tenant_id', tenantId).eq('id', templateId).maybeSingle();
    if (!existing) throw new NotFoundException('Checklist template not found');
    const update: any = { updated_at: new Date().toISOString() };
    if ('template_name' in input) {
      update.template_name = String(input.template_name || '').trim();
      if (!update.template_name) throw new BadRequestException('Checklist template name is required');
    }
    if ('service_type' in input) update.service_type = String(input.service_type || '').trim() || null;
    if ('description' in input) update.description = String(input.description || '').trim() || null;
    if ('is_active' in input) update.is_active = Boolean(input.is_active);
    const { error } = await this.supabase.from('service_checklist_templates').update(update).eq('tenant_id', tenantId).eq('id', templateId);
    if (error) throw new BadRequestException(error.code === '23505' ? 'A checklist template with this name already exists' : error.message);
    if (Array.isArray(input.items)) {
      const items = this.validateChecklistTemplateItems(input.items);
      const { error: deleteError } = await this.supabase.from('service_checklist_template_items').delete().eq('template_id', templateId);
      if (deleteError) throw new BadRequestException(deleteError.message);
      const { error: itemError } = await this.supabase.from('service_checklist_template_items').insert(items.map((item: any, index: number) => ({ template_id: templateId, item_text: item.item_text, is_required: item.is_required, sort_order: index + 1 })));
      if (itemError) throw new BadRequestException(itemError.message);
    }
    return (await this.getChecklistTemplates(tenantId, false)).find((row: any) => row.id === templateId);
  }

  async deactivateChecklistTemplate(tenantId: string, templateId: string) {
    const { data, error } = await this.supabase.from('service_checklist_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', templateId).select('id').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Checklist template not found');
    return { success: true };
  }

  async getTicketChecklist(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase.from('service_ticket_checklist_items')
      .select('*').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('sort_order');
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async assignTicketChecklist(tenantId: string, userId: string, ticketId: string, input: any) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(String(ticket.status || '').toUpperCase())) throw new BadRequestException(`Cannot assign a checklist to a ${ticket.status} ticket`);
    const { count, error: countError } = await this.supabase.from('service_ticket_checklist_items').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('service_ticket_id', ticketId);
    if (countError) throw new BadRequestException(countError.message);
    if ((count || 0) > 0) throw new BadRequestException('This ticket already has a service checklist');
    const { data: template, error } = await this.supabase.from('service_checklist_templates')
      .select('*, items:service_checklist_template_items(*)').eq('tenant_id', tenantId).eq('id', input.template_id).eq('is_active', true).maybeSingle();
    if (error || !template) throw new BadRequestException('Select an active checklist template');
    const items = (template.items || []).sort((a: any, b: any) => Number(a.sort_order) - Number(b.sort_order));
    if (!items.length) throw new BadRequestException('The selected checklist template has no items');
    const { error: insertError } = await this.supabase.from('service_ticket_checklist_items').insert(items.map((item: any, index: number) => ({
      tenant_id: tenantId, service_ticket_id: ticketId, template_id: template.id, template_item_id: item.id,
      item_text: item.item_text, is_required: item.is_required, sort_order: index + 1, created_by: userId,
    })));
    if (insertError) throw new BadRequestException(insertError.code === '23505' ? 'This ticket already has a service checklist' : insertError.message);
    return this.getTicketChecklist(tenantId, ticketId);
  }

  async updateTicketChecklistItem(tenantId: string, userId: string, ticketId: string, itemId: string, input: any) {
    await this.getOwnedTicket(tenantId, ticketId);
    const status = String(input.status || '').toUpperCase();
    if (!['PENDING', 'COMPLETED', 'NOT_APPLICABLE'].includes(status)) throw new BadRequestException('Checklist status must be PENDING, COMPLETED, or NOT_APPLICABLE');
    if (status === 'NOT_APPLICABLE' && !String(input.remarks || '').trim()) throw new BadRequestException('Remarks are required when a checklist item is not applicable');
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('service_ticket_checklist_items').update({
      status,
      remarks: String(input.remarks || '').trim() || null,
      completed_by: status === 'PENDING' ? null : userId,
      completed_at: status === 'PENDING' ? null : now,
      updated_at: now,
    }).eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).eq('id', itemId).select().maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Ticket checklist item not found');
    return data;
  }

  async assignTechnician(tenantId: string, userId: string, data: any) {
    // Check if ticket exists
    const { data: ticket, error: ticketError } = await this.supabase
      .from('service_tickets')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', data.service_ticket_id)
      .single();

    if (ticketError) throw new NotFoundException('Service ticket not found');
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status)) {
      throw new BadRequestException(`Cannot assign a technician to a ${ticket.status} ticket`);
    }

    const { data: technician, error: technicianError } = await this.supabase
      .from('technicians')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', data.technician_id)
      .single();
    if (technicianError || !technician?.is_active) {
      throw new BadRequestException('Select an active technician belonging to this company');
    }

    const { count: activeAssignmentCount } = await this.supabase
      .from('service_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('service_ticket_id', data.service_ticket_id)
      .in('status', ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS']);
    if ((activeAssignmentCount || 0) > 0) {
      throw new BadRequestException('Ticket already has an active technician assignment');
    }

    const scheduledStartAt = data.scheduled_start_at || (data.scheduled_start_date ? `${data.scheduled_start_date}T${technician.shift_start || '09:00'}:00` : null);
    const scheduledEndAt = data.scheduled_end_at || (data.scheduled_end_date ? `${data.scheduled_end_date}T${technician.shift_end || '18:00'}:00` : null);
    const requiredSkills = this.normalizeTextList(data.required_skills);
    const serviceTerritory = String(data.service_territory || ticket.service_location || '').trim() || null;
    if ((scheduledStartAt && !scheduledEndAt) || (!scheduledStartAt && scheduledEndAt)) {
      throw new BadRequestException('Both scheduled start and scheduled end are required');
    }
    if (scheduledStartAt && scheduledEndAt) {
      await this.assertTechnicianAvailability(tenantId, technician, scheduledStartAt, scheduledEndAt);
    }
    const technicianSkills = this.normalizeTextList(technician.skills).map((value) => value.toLowerCase());
    const missingSkills = requiredSkills.filter((skill) => !technicianSkills.includes(skill.toLowerCase()));
    if (missingSkills.length && !String(data.override_reason || '').trim()) {
      throw new BadRequestException(`Technician is missing required skills: ${missingSkills.join(', ')}. Provide an override reason to continue.`);
    }

    // Create assignment
    const assignmentData = {
      service_ticket_id: data.service_ticket_id,
      technician_id: data.technician_id,
      assigned_date: new Date().toISOString(),
      assigned_by: userId,
      scheduled_start_date: data.scheduled_start_date,
      scheduled_end_date: data.scheduled_end_date,
      scheduled_start_at: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
      scheduled_end_at: scheduledEndAt ? new Date(scheduledEndAt).toISOString() : null,
      required_skills: requiredSkills,
      service_territory: serviceTerritory,
      scheduling_override_reason: String(data.override_reason || '').trim() || null,
      status: 'ASSIGNED',
    };

    const { data: assignment, error } = await this.supabase
      .from('service_assignments')
      .insert(assignmentData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    // Update ticket status to ASSIGNED
    await this.supabase
      .from('service_tickets')
      .update({ status: 'ASSIGNED', updated_at: new Date().toISOString() })
      .eq('id', data.service_ticket_id);

    // Update technician's total assignments
    await this.supabase
      .from('technicians')
      .update({
        total_assignments: Number(technician.total_assignments || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', data.technician_id);

    return assignment;
  }

  async getAssignmentsByTechnician(tenantId: string, technicianId: string, status?: string) {
    const { data: technician, error: technicianError } = await this.supabase
      .from('technicians')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', technicianId)
      .single();
    if (technicianError || !technician) throw new NotFoundException('Technician not found');
    let query = this.supabase
      .from('service_assignments')
      .select(`
        *,
        service_ticket:service_tickets(
          *,
          customer:customers(customer_name, contact_person, mobile)
        )
      `)
      .eq('technician_id', technicianId)
      .order('assigned_date', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);

    return data;
  }

  async updateAssignment(tenantId: string, assignmentId: string, data: any) {
    const { data: existing, error: existingError } = await this.supabase
      .from('service_assignments')
      .select('*, service_ticket:service_tickets!inner(id, tenant_id, status, response_acknowledged_at, commercial_approval_required, commercial_approval_status)')
      .eq('id', assignmentId)
      .eq('service_ticket.tenant_id', tenantId)
      .single();
    if (existingError || !existing) throw new NotFoundException('Service assignment not found');

    const currentAssignmentStatus = String(existing.status || 'ASSIGNED').toUpperCase();
    const ticketStatus = String(existing.service_ticket?.status || '').toUpperCase();
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticketStatus)) {
      throw new BadRequestException(`Cannot change an assignment on a ${ticketStatus} service ticket`);
    }
    if (currentAssignmentStatus === 'COMPLETED') {
      throw new BadRequestException('A completed technician assignment is locked for audit');
    }
    if (data.status && String(data.status).toUpperCase() !== currentAssignmentStatus) {
      this.assertAssignmentStatusTransition(currentAssignmentStatus, String(data.status).toUpperCase());
      data.status = String(data.status).toUpperCase();
    }
    if (String(data.status || '').toUpperCase() === 'IN_PROGRESS') {
      this.assertCommercialApproval(existing.service_ticket);
    }

    const allowedFields = [
      'status', 'scheduled_start_date', 'scheduled_end_date', 'actual_start_date',
      'actual_end_date', 'work_notes', 'technician_remarks', 'travel_distance',
      'travel_cost', 'customer_satisfaction',
    ];
    const updateData = Object.fromEntries(
      allowedFields
        .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
        .map((field) => [field, data[field]]),
    );
    const { data: assignment, error } = await this.supabase
      .from('service_assignments')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    const nextStatus = String(data.status || currentAssignmentStatus).toUpperCase();
    const ticketUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
    if (['ACCEPTED', 'IN_PROGRESS'].includes(nextStatus) && !existing.service_ticket?.response_acknowledged_at) {
      ticketUpdate.response_acknowledged_at = new Date().toISOString();
    }
    if (nextStatus === 'IN_PROGRESS' || nextStatus === 'COMPLETED') {
      // Technician completion means work is ready for customer confirmation;
      // final confirmation remains the only way to resolve the ticket.
      ticketUpdate.status = 'IN_PROGRESS';
    } else if (nextStatus === 'REASSIGNED') {
      ticketUpdate.status = 'OPEN';
    }
    if (Object.keys(ticketUpdate).length > 1 || nextStatus === 'REASSIGNED') {
      const { error: ticketUpdateError } = await this.supabase
        .from('service_tickets')
        .update(ticketUpdate)
        .eq('tenant_id', tenantId)
        .eq('id', assignment.service_ticket_id)
        .in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PARTS_PENDING']);
      if (ticketUpdateError) throw new BadRequestException(ticketUpdateError.message);
    }

    return assignment;
  }

  // ==================== Service Parts Used ====================

  async addServicePart(req: any, data: any) {
    const { tenantId, userId } = req.user as any;
    const ticket = await this.getOwnedTicket(tenantId, data.service_ticket_id);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status)) {
      throw new BadRequestException(`Cannot add parts to a ${ticket.status} ticket`);
    }
    if (!Number.isFinite(Number(data.quantity)) || Number(data.quantity) <= 0) {
      throw new BadRequestException('Part quantity must be greater than zero');
    }
    this.assertServicePartPricing(data.unit_price, data.charged_to_customer !== false);
    if (!String(data.warehouse_id || '').trim()) {
      throw new BadRequestException('Source warehouse is required for service-part issue');
    }
    if (!String(data.part_id || '').trim()) {
      throw new BadRequestException('Replacement part is required');
    }
    if (!this.inventoryService) throw new BadRequestException('Inventory service is unavailable');
    const warranty = this.validateReplacementWarranty(
      data.replacement_warranty_start,
      data.replacement_warranty_months,
    );

    const { data: partItem, error: partItemError } = await this.supabase
      .from('items')
      .select('id, code, name, is_active')
      .eq('tenant_id', tenantId)
      .eq('id', data.part_id)
      .maybeSingle();
    if (partItemError) throw new BadRequestException(partItemError.message);
    if (!partItem?.id || partItem.is_active === false) {
      throw new BadRequestException('Replacement part is not active for this company');
    }

    const { data: warehouse, error: warehouseError } = await this.supabase
      .from('warehouses')
      .select('id, is_active')
      .eq('tenant_id', tenantId)
      .eq('id', data.warehouse_id)
      .maybeSingle();
    if (warehouseError) throw new BadRequestException(warehouseError.message);
    if (!warehouse?.id || warehouse.is_active === false) {
      throw new BadRequestException('Source warehouse is not active for this company');
    }

    if (data.service_assignment_id) {
      const { data: assignment, error: assignmentError } = await this.supabase
        .from('service_assignments')
        .select('id, service_ticket_id')
        .eq('id', data.service_assignment_id)
        .maybeSingle();
      if (assignmentError) throw new BadRequestException(assignmentError.message);
      if (!assignment?.id || assignment.service_ticket_id !== ticket.id) {
        throw new BadRequestException('Selected assignment does not belong to this service ticket');
      }
    }

    const { data: stockRows, error: stockError } = await this.supabase
      .from('inventory_stock')
      .select('category, available_quantity')
      .eq('tenant_id', tenantId)
      .eq('item_id', data.part_id)
      .eq('warehouse_id', data.warehouse_id)
      .order('available_quantity', { ascending: false });
    if (stockError) throw new BadRequestException(stockError.message);
    const requiredQuantity = Number(data.quantity);
    const stockCategory = this.selectServicePartStockCategory(stockRows || [], requiredQuantity);
    if (!stockCategory) {
      throw new BadRequestException('Insufficient replacement-part stock in the selected warehouse');
    }

    let newPartUID = String(data.new_part_uid || '').trim() || null;
    if (!newPartUID && data.generate_new_uid) {
      throw new BadRequestException('Enter or scan the replacement-part UID before issuing stock');
    }
    if (newPartUID) {
      const { data: duplicateUid, error: duplicateUidError } = await this.supabase
        .from('uid_registry')
        .select('uid')
        .eq('tenant_id', tenantId)
        .eq('uid', newPartUID)
        .maybeSingle();
      if (duplicateUidError) throw new BadRequestException(duplicateUidError.message);
      if (duplicateUid) throw new BadRequestException(`Replacement UID ${newPartUID} already exists`);
    }
    if (data.old_part_uid) {
      const { data: oldUid, error: oldUidLookupError } = await this.supabase
        .from('uid_registry')
        // uid_registry identifies the linked item through entity_id.  Some
        // legacy databases never had an item_id column, so selecting it here
        // prevents an otherwise valid replacement from being issued.
        .select('uid, entity_id')
        .eq('tenant_id', tenantId)
        .eq('uid', data.old_part_uid)
        .maybeSingle();
      if (oldUidLookupError) throw new BadRequestException(oldUidLookupError.message);
      if (!oldUid) throw new BadRequestException(`Removed-part UID ${data.old_part_uid} was not found`);
    }

    const partData = {
      service_ticket_id: data.service_ticket_id,
      service_assignment_id: data.service_assignment_id || null,
      part_id: data.part_id,
      part_name: partItem.name,
      part_code: partItem.code,
      old_part_uid: data.old_part_uid || null,
      old_part_condition: data.old_part_condition || null,
      new_part_uid: newPartUID,
      new_part_batch: data.new_part_batch,
      new_part_serial: data.new_part_serial,
      quantity: data.quantity,
      unit_price: data.unit_price,
      total_cost: data.quantity * data.unit_price,
      replacement_warranty_months: warranty.months,
      replacement_warranty_start: warranty.start,
      charged_to_customer: data.charged_to_customer !== false,
      notes: data.notes,
      return_required: data.return_required === true,
      return_status: data.return_required === true ? 'EXPECTED' : 'NOT_REQUIRED',
      warehouse_id: data.warehouse_id,
      issued_at: new Date().toISOString(),
      issued_by: userId,
    };

    const { data: part, error } = await this.supabase
      .from('service_parts_used')
      .insert({ ...partData, replacement_warranty_end: warranty.end })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    let movement: any;
    try {
      movement = await this.inventoryService.createStockMovement(req, {
        // A field-service part is a controlled stock issue, not an inventory
        // correction.  This yields an SRV document number and keeps the
        // service trail distinct from adjustments.
        movement_type: 'SERVICE_ISSUE',
        item_id: data.part_id,
        from_warehouse_id: data.warehouse_id,
        quantity: Number(data.quantity),
        category: stockCategory,
        unit_cost: Number(data.unit_price || 0),
        reference_type: 'SERVICE_PART_ISSUE',
        reference_id: ticket.id,
        reference_number: ticket.ticket_number,
        notes: `Service part issued for ${ticket.ticket_number}`,
      });
    } catch (movementError) {
      await this.supabase.from('service_parts_used').delete().eq('id', part.id);
      throw movementError;
    }
    const { error: movementLinkError } = await this.supabase
      .from('service_parts_used')
      .update({ stock_movement_id: movement.id })
      .eq('id', part.id);
    if (movementLinkError) {
      await this.compensateFailedServicePartIssue(req, part.id, movement, movementLinkError.message);
    }

    // Register new part UID in uid_registry if provided
    if (newPartUID) {
      const { error: newUidError } = await this.supabase.from('uid_registry').insert({
        tenant_id: tenantId,
        uid: newPartUID,
        entity_type: 'SERVICE_PART',
        entity_id: data.part_id,
        // uid_registry.status is a lifecycle enum.  A service replacement
        // has been fitted at the customer site, so INSTALLED is the valid
        // state (ACTIVE is not a UID status).
        status: 'INSTALLED',
        location: 'CUSTOMER',
        lifecycle: JSON.stringify([{
          stage: 'SERVICE_REPLACEMENT_INSTALLED',
          timestamp: new Date().toISOString(),
          reference: ticket.ticket_number,
          user: req.user?.email || userId,
        }]),
      });
      if (newUidError) {
        await this.compensateFailedServicePartIssue(req, part.id, movement, newUidError.message, newPartUID);
      }
    }

    // Mark the removed part only after the new UID was registered. If this
    // final step fails, compensation removes the new UID and restores stock.
    if (data.old_part_uid) {
      const { error: oldUidError } = await this.supabase
        .from('uid_registry')
        .update({
          // Keep the returned part traceable for diagnosis.  The registry
          // uses lifecycle states and has no free-form notes column.
          status: 'UNDER_SERVICE',
          location: 'SERVICE_RETURN',
        })
        .eq('tenant_id', tenantId)
        .eq('uid', data.old_part_uid);
      if (oldUidError) {
        await this.compensateFailedServicePartIssue(req, part.id, movement, oldUidError.message, newPartUID);
      }
    }

    return { ...part, stock_movement_id: movement.id, stock_movement_number: movement.movement_number };
  }

  private validateReplacementWarranty(startInput: any, monthsInput: any) {
    const start = String(startInput || new Date().toISOString().split('T')[0]).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(`${start}T00:00:00Z`))) {
      throw new BadRequestException('Replacement warranty start date is invalid');
    }
    const months = monthsInput === undefined || monthsInput === null || monthsInput === ''
      ? 6
      : Number(monthsInput);
    if (!Number.isInteger(months) || months < 0 || months > 120) {
      throw new BadRequestException('Replacement warranty months must be a whole number from 0 to 120');
    }
    const endDate = new Date(`${start}T00:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + months);
    return { start, months, end: endDate.toISOString().split('T')[0] };
  }

  private assertServicePartPricing(unitPriceInput: any, chargedToCustomer: boolean) {
    const unitPrice = Number(unitPriceInput);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new BadRequestException('Part unit price cannot be negative');
    }
    if (chargedToCustomer && unitPrice <= 0) {
      throw new BadRequestException('Enter a positive unit price for a billable service part, or mark it as warranty / no charge');
    }
    return unitPrice;
  }

  private selectServicePartStockCategory(rows: any[], requiredQuantity: number) {
    const availableByCategory = new Map<string, number>();
    for (const row of rows || []) {
      const category = String(row?.category || '').trim();
      if (!category) continue;
      availableByCategory.set(
        category,
        (availableByCategory.get(category) || 0) + Number(row?.available_quantity || 0),
      );
    }
    return Array.from(availableByCategory.entries())
      .sort((left, right) => right[1] - left[1])
      .find(([, available]) => available + 1e-9 >= requiredQuantity)?.[0] || null;
  }

  private async compensateFailedServicePartIssue(req: any, partId: string, movement: any, cause: string, newPartUid?: string | null): Promise<never> {
    try {
      await this.inventoryService!.reverseCommittedServiceIssue(
        req,
        movement,
        `Automatic reversal: service-part posting failed (${cause})`,
      );
      if (newPartUid) {
        await this.supabase
          .from('uid_registry')
          .delete()
          .eq('tenant_id', (req.user as any).tenantId)
          .eq('uid', newPartUid);
      }
      await this.supabase.from('service_parts_used').delete().eq('id', partId);
    } catch (rollbackError: any) {
      throw new BadRequestException(
        `Service issue ${movement.movement_number} needs administrator review because automatic reversal failed: ${rollbackError?.message || rollbackError}`,
      );
    }
    throw new BadRequestException(`Service part was not posted; stock issue ${movement.movement_number} was reversed automatically`);
  }

  async getServicePartsByTicket(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase
      .from('service_parts_used')
      .select('*')
      .eq('service_ticket_id', ticketId)
      .order('used_date', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return data;
  }

  // ==================== Service History ====================

  async createServiceHistoryEntry(tenantId: string, ticket: any) {
    const historyData = {
      tenant_id: tenantId,
      uid: ticket.uid,
      service_ticket_id: ticket.id,
      customer_id: ticket.customer_id,
      service_date: ticket.actual_completion_date || new Date().toISOString().split('T')[0],
      service_type: ticket.service_type,
      issue_description: ticket.complaint_description,
      resolution_description: ticket.resolution_description,
      total_cost: ticket.actual_cost || 0,
    };

    const { data, error } = await this.supabase
      .from('service_history')
      .insert(historyData)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    return data;
  }

  async getServiceHistoryByUID(tenantId: string, uid: string) {
    const { data, error } = await this.supabase
      .from('service_history')
      .select(`
        *,
        service_ticket:service_tickets(ticket_number, status),
        customer:customers(customer_name),
        technician:technicians(technician_name)
      `)
      .eq('tenant_id', tenantId)
      .eq('uid', uid)
      .order('service_date', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return { ...data, sla: this.calculateTicketSla(data) };
  }

  // ==================== Service Confirmation / Customer Billing ====================

  async getServiceConfirmations(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase
      .from('service_confirmations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    return data || [];
  }

  async createServiceConfirmation(tenantId: string, userId: string, ticketId: string, input: any) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(ticket.status)) {
      throw new BadRequestException(`Cannot confirm work against a ${ticket.status} ticket`);
    }
    if (!input.work_performed?.trim()) throw new BadRequestException('Work performed is required');
    this.assertCommercialApproval(ticket);

    const isFinal = Boolean(input.is_final);
    let failureCategory = String(input.failure_category || '').trim().toUpperCase();
    let failureCodeId: string | null = null;
    if (input.failure_code_id) {
      const { data: failureCode, error: failureCodeError } = await this.supabase
        .from('service_failure_codes')
        .select('id, category, is_active')
        .eq('tenant_id', tenantId)
        .eq('id', input.failure_code_id)
        .maybeSingle();
      if (failureCodeError || !failureCode || !failureCode.is_active) throw new BadRequestException('Select an active service failure code');
      failureCodeId = failureCode.id;
      failureCategory = String(failureCode.category || failureCategory).toUpperCase();
    }
    const rootCause = String(input.root_cause || '').trim();
    const correctiveAction = String(input.corrective_action || '').trim();
    const preventiveAction = String(input.preventive_action || '').trim();
    const allowedFailureCategories = new Set([
      'ELECTRICAL', 'MECHANICAL', 'SOFTWARE', 'INSTALLATION', 'OPERATOR_ERROR',
      'ENVIRONMENTAL', 'WEAR_AND_TEAR', 'NO_FAULT_FOUND', 'OTHER',
    ]);
    if (failureCategory && !allowedFailureCategories.has(failureCategory)) {
      throw new BadRequestException('Select a valid failure category');
    }
    if (isFinal && !failureCategory) throw new BadRequestException('Failure category is required for final service confirmation');
    if (isFinal && !rootCause) throw new BadRequestException('Root cause is required for final service confirmation');
    if (isFinal && !correctiveAction) throw new BadRequestException('Corrective action is required for final service confirmation');
    const confirmationDate = this.validateServiceConfirmationDate(input.confirmation_date, ticket.complaint_date);
    if (isFinal) {
      const { count: incompleteChecklistCount, error: checklistError } = await this.supabase
        .from('service_ticket_checklist_items')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('service_ticket_id', ticketId)
        .eq('is_required', true)
        .eq('status', 'PENDING');
      if (checklistError) throw new BadRequestException(checklistError.message);
      if ((incompleteChecklistCount || 0) > 0) {
        throw new BadRequestException(`Complete all ${incompleteChecklistCount} mandatory service checklist item(s) before final confirmation`);
      }
      const { data: existingFinal, error: finalCheckError } = await this.supabase
        .from('service_confirmations')
        .select('confirmation_number')
        .eq('tenant_id', tenantId).eq('service_ticket_id', ticketId)
        .eq('is_final', true).eq('status', 'COMPLETED').maybeSingle();
      if (finalCheckError) throw new BadRequestException(finalCheckError.message);
      if (existingFinal) throw new BadRequestException(`Ticket is already finalized on ${existingFinal.confirmation_number}`);
    }

    if (input.service_assignment_id) {
      const { data: assignment, error: assignmentError } = await this.supabase
        .from('service_assignments').select('id')
        .eq('id', input.service_assignment_id).eq('service_ticket_id', ticketId).maybeSingle();
      if (assignmentError) throw new BadRequestException(assignmentError.message);
      if (!assignment) throw new BadRequestException('Selected assignment does not belong to this service ticket');
    }

    const { data: parts, error: partsError } = await this.supabase
      .from('service_parts_used')
      .select('total_cost, charged_to_customer')
      .eq('service_ticket_id', ticketId);
    if (partsError) throw new BadRequestException(partsError.message);

    const laborHours = this.roundAmount(input.labor_hours);
    const requestedLaborRate = this.roundAmount(input.labor_rate);
    const laborRate = this.getWarrantyAdjustedLaborRate(ticket, requestedLaborRate);
    const travelCost = this.roundAmount(input.travel_cost);
    const otherAmount = this.roundAmount(input.other_amount);
    this.assertNonNegativeServiceCharges({ laborHours, laborRate, travelCost, otherAmount });
    const partsAmount = this.roundAmount((parts || [])
      .filter((part: any) => part.charged_to_customer)
      .reduce((sum: number, part: any) => sum + Number(part.total_cost || 0), 0));
    const subtotal = this.roundAmount(laborHours * laborRate + travelCost + partsAmount + otherAmount);
    const taxPercentage = Number(input.tax_percentage || 0);
    if (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100) throw new BadRequestException('Tax percentage must be between 0 and 100');
    const taxAmount = this.roundAmount(subtotal * taxPercentage / 100);
    const totalAmount = this.roundAmount(subtotal + taxAmount);
    if (isFinal && !input.customer_signoff_name?.trim()) {
      throw new BadRequestException('Customer sign-off name is required for a final confirmation');
    }

    let approvedEstimate: any = null;
    if (ticket.commercial_approval_required) {
      if (!ticket.approved_estimate_id) {
        throw new BadRequestException('The approved customer estimate is missing from this service ticket');
      }
      const { data: estimate, error: estimateError } = await this.supabase
        .from('service_estimates')
        .select('id, estimate_number, total_amount, status')
        .eq('tenant_id', tenantId)
        .eq('service_ticket_id', ticketId)
        .eq('id', ticket.approved_estimate_id)
        .maybeSingle();
      if (estimateError) throw new BadRequestException(estimateError.message);
      if (!estimate || String(estimate.status || '').toUpperCase() !== 'APPROVED') {
        throw new BadRequestException('The customer-approved estimate could not be verified');
      }
      approvedEstimate = estimate;
    }
    const varianceControl = this.validateServiceConfirmationVariance(ticket, approvedEstimate, totalAmount, input);

    const { data: confirmation, error } = await this.supabase
      .from('service_confirmations')
      .insert({
        tenant_id: tenantId,
        confirmation_number: await this.generateServiceConfirmationNumber(tenantId),
        service_ticket_id: ticketId,
        service_assignment_id: input.service_assignment_id || null,
        confirmation_date: confirmationDate,
        status: isFinal ? 'COMPLETED' : 'OPEN',
        labor_hours: laborHours,
        labor_rate: laborRate,
        travel_cost: travelCost,
        parts_amount: partsAmount,
        other_amount: otherAmount,
        subtotal,
        tax_percentage: taxPercentage,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        work_performed: input.work_performed.trim(),
        technician_remarks: input.technician_remarks || null,
        failure_code_id: failureCodeId,
        failure_category: failureCategory || null,
        root_cause: rootCause || null,
        corrective_action: correctiveAction || null,
        preventive_action: preventiveAction || null,
        customer_signoff_name: input.customer_signoff_name || null,
        customer_signoff_at: input.customer_signoff_name ? new Date().toISOString() : null,
        attachments: input.attachments || [],
        approved_estimate_id: varianceControl.approvedEstimateId,
        approved_estimate_amount: varianceControl.approvedEstimateAmount,
        estimate_variance_amount: varianceControl.varianceAmount,
        variance_reason: varianceControl.varianceReason,
        variance_approval_reference: varianceControl.varianceApprovalReference,
        variance_approval_attachment_url: varianceControl.varianceApprovalAttachmentUrl,
        variance_approved_by: varianceControl.varianceAmount > 0 ? userId : null,
        is_final: isFinal,
        completed_at: isFinal ? new Date().toISOString() : null,
        completed_by: isFinal ? userId : null,
        created_by: userId,
      })
      .select()
      .single();
    if (error || !confirmation) {
      if (error?.code === '23505' && String(error.message || '').includes('final_ticket')) {
        throw new BadRequestException('This service ticket already has a final confirmation');
      }
      throw new BadRequestException(error?.message || 'Service confirmation failed');
    }

    const completionDate = confirmationDate;
    const ticketUpdatedAt = new Date().toISOString();
    const { data: updatedTicket, error: ticketUpdateError } = await this.supabase
      .from('service_tickets')
      .update({
        status: isFinal ? 'COMPLETED' : 'IN_PROGRESS',
        actual_completion_date: isFinal ? completionDate : null,
        resolved_at: isFinal ? ticketUpdatedAt : null,
        actual_cost: totalAmount,
        parts_cost: partsAmount,
        labor_cost: this.roundAmount(laborHours * laborRate),
        resolution_description: isFinal ? input.work_performed.trim() : ticket.resolution_description,
        billing_status: isFinal && totalAmount > 0 ? 'READY_FOR_BILLING' : 'NOT_BILLABLE',
        updated_at: ticketUpdatedAt,
      })
      .eq('tenant_id', tenantId)
      .eq('id', ticketId)
      .eq('status', ticket.status)
      .select('id').maybeSingle();

    if (ticketUpdateError || !updatedTicket) {
      await this.supabase.from('service_confirmations').delete().eq('tenant_id', tenantId).eq('id', confirmation.id);
      throw new BadRequestException(ticketUpdateError?.message || 'Ticket changed while confirming work. Reload and try again.');
    }

    if (isFinal && ticket.service_contract_id) {
      const { error: consumptionError } = await this.supabase.from('service_contract_consumption').insert({
        tenant_id: tenantId,
        service_contract_id: ticket.service_contract_id,
        service_ticket_id: ticketId,
        service_confirmation_id: confirmation.id,
        visits_used: 1,
        labor_hours_used: laborHours,
        notes: `Posted from ${confirmation.confirmation_number}`,
      });
      if (consumptionError) {
        await this.supabase.from('service_tickets').update({
          status: ticket.status, actual_completion_date: ticket.actual_completion_date,
          resolved_at: ticket.resolved_at, actual_cost: ticket.actual_cost,
          parts_cost: ticket.parts_cost, labor_cost: ticket.labor_cost,
          resolution_description: ticket.resolution_description,
          billing_status: ticket.billing_status, updated_at: ticket.updated_at,
        }).eq('tenant_id', tenantId).eq('id', ticketId).eq('updated_at', ticketUpdatedAt);
        await this.supabase.from('service_confirmations').delete().eq('tenant_id', tenantId).eq('id', confirmation.id);
        throw new BadRequestException(consumptionError.message || 'Contract entitlement usage could not be posted');
      }
    }

    if (isFinal && ticket.uid) {
      try {
        await this.createServiceHistoryEntry(tenantId, {
          ...ticket,
          actual_completion_date: completionDate,
          resolution_description: input.work_performed.trim(),
          actual_cost: totalAmount,
        });
      } catch (historyError: any) {
        await this.supabase.from('service_contract_consumption').delete().eq('tenant_id', tenantId).eq('service_confirmation_id', confirmation.id);
        await this.supabase.from('service_tickets').update({
          status: ticket.status, actual_completion_date: ticket.actual_completion_date,
          resolved_at: ticket.resolved_at,
          actual_cost: ticket.actual_cost, parts_cost: ticket.parts_cost,
          labor_cost: ticket.labor_cost, resolution_description: ticket.resolution_description,
          billing_status: ticket.billing_status, updated_at: ticket.updated_at,
        }).eq('tenant_id', tenantId).eq('id', ticketId).eq('updated_at', ticketUpdatedAt);
        await this.supabase.from('service_confirmations').delete().eq('tenant_id', tenantId).eq('id', confirmation.id);
        throw new BadRequestException(historyError?.message || 'Service history could not be recorded; confirmation was rolled back');
      }
    }
    return confirmation;
  }

  async getCustomerServiceInvoices(tenantId: string, filters?: any) {
    let query = this.supabase
      .from('customer_service_invoices')
      .select('*, customer:customers(customer_code, customer_name), ticket:service_tickets(ticket_number, service_type)')
      .eq('tenant_id', tenantId)
      .order('invoice_date', { ascending: false });
    if (filters?.payment_status) query = query.eq('payment_status', filters.payment_status);
    if (filters?.customer_id) query = query.eq('customer_id', filters.customer_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((invoice: any) => this.withReceivableAgeing(invoice));
  }

  async getCustomerServiceInvoiceById(tenantId: string, invoiceId: string) {
    const { data, error } = await this.supabase
      .from('customer_service_invoices')
      .select(`
        *,
        customer:customers(customer_code, customer_name, contact_person, email, phone, billing_address),
        ticket:service_tickets(ticket_number, service_type, status, product_name, uid),
        confirmation:service_confirmations(
          confirmation_number, confirmation_date, status, work_performed,
          labor_hours, labor_rate, travel_cost, parts_amount, other_amount,
          subtotal, tax_percentage, tax_amount, total_amount
        ),
        payments:customer_service_payments(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', invoiceId)
      .single();
    if (error || !data) throw new NotFoundException('Customer service invoice not found');
    const { data: serviceParts, error: servicePartsError } = await this.supabase
      .from('service_parts_used')
      .select('id, part_code, part_name, quantity, unit_price, total_cost, charged_to_customer, new_part_uid')
      .eq('service_ticket_id', data.service_ticket_id)
      .order('issued_at', { ascending: true });
    if (servicePartsError) throw new BadRequestException(servicePartsError.message);
    return this.withReceivableAgeing({
      ...data,
      service_parts: serviceParts || [],
      payments: [...(data.payments || [])].sort((a: any, b: any) =>
        String(b.created_at || b.receipt_date || '').localeCompare(String(a.created_at || a.receipt_date || '')),
      ),
    });
  }

  async renderCustomerServiceInvoicePdf(tenantId: string, invoiceId: string): Promise<{ buffer: Buffer; fileName: string }> {
    if (!this.quotePdfService) throw new BadRequestException('Service invoice PDF generator is not configured');
    const invoice: any = await this.getCustomerServiceInvoiceById(tenantId, invoiceId);
    const confirmation = invoice.confirmation || {};
    const parts = (invoice.service_parts || []).filter((part: any) => part.charged_to_customer);
    const items = [
      Number(confirmation.labor_hours || 0) > 0 ? {
        description: `Service labour - ${confirmation.work_performed || invoice.ticket?.service_type || 'service work'}`,
        quantity: Number(confirmation.labor_hours || 0), unit: 'HRS', unit_price: Number(confirmation.labor_rate || 0),
      } : null,
      ...parts.map((part: any) => ({
        description: `${part.part_code || 'PART'} - ${part.part_name || 'Service part'}`,
        quantity: Number(part.quantity || 0), unit: 'NOS', unit_price: Number(part.unit_price || 0),
      })),
      Number(confirmation.travel_cost || 0) > 0 ? { description: 'Travel charges', quantity: 1, unit: 'JOB', unit_price: Number(confirmation.travel_cost || 0) } : null,
      Number(confirmation.other_amount || 0) > 0 ? { description: 'Other service charges', quantity: 1, unit: 'JOB', unit_price: Number(confirmation.other_amount || 0) } : null,
    ].filter(Boolean) as Array<{ description: string; quantity: number; unit: string; unit_price: number }>;
    if (!items.length) {
      items.push({ description: confirmation.work_performed || 'Service charges', quantity: 1, unit: 'JOB', unit_price: Number(invoice.taxable_amount || 0) });
    }
    const notes = [
      `Service Ticket: ${invoice.ticket?.ticket_number || '-'}`,
      `Service Confirmation: ${confirmation.confirmation_number || '-'}`,
      `Due Date: ${String(invoice.due_date || '-').slice(0, 10)}`,
      invoice.notes ? `Billing Notes: ${invoice.notes}` : '',
      Number(invoice.paid_amount || 0) > 0 ? `Amount Received: INR ${Number(invoice.paid_amount).toFixed(2)} | Outstanding: INR ${Number(invoice.balance_amount || 0).toFixed(2)}` : '',
      invoice.billing_status === 'CANCELLED' ? `CANCELLED: ${invoice.cancellation_reason || 'Invoice cancelled'}` : '',
    ].filter(Boolean).join('\n');
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      document_label: 'CUSTOMER SERVICE INVOICE',
      quote_number: invoice.invoice_number,
      quote_date_iso: invoice.invoice_date,
      title: invoice.invoice_number,
      company: { name: 'SAK ERP' },
      customer: {
        name: invoice.customer?.customer_name || 'Customer',
        address: invoice.customer?.billing_address || '',
        phone: invoice.customer?.phone || '',
        email: invoice.customer?.email || '',
      },
      items,
      currency: 'INR',
      tax_rate: Number(confirmation.tax_percentage || 0) / 100,
      notes,
    });
    return { buffer, fileName: `${String(invoice.invoice_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
  }

  async renderCustomerServiceReceiptPdf(
    tenantId: string,
    invoiceId: string,
    paymentId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    if (!this.quotePdfService) throw new BadRequestException('Service receipt PDF generator is not configured');
    const invoice: any = await this.getCustomerServiceInvoiceById(tenantId, invoiceId);
    const payment = (invoice.payments || []).find((row: any) => row.id === paymentId);
    if (!payment) throw new NotFoundException('Customer service receipt not found');

    const notes = [
      `Against Service Invoice: ${invoice.invoice_number}`,
      `Service Ticket: ${invoice.ticket?.ticket_number || '-'}`,
      `Payment Method: ${payment.payment_method || '-'}`,
      payment.payment_reference ? `Transaction Reference: ${payment.payment_reference}` : '',
      `Status: ${payment.reversed_at ? 'REVERSED' : 'POSTED'}`,
      payment.reversed_at ? `Reversal Reason: ${payment.reversal_reason || '-'}` : '',
      payment.notes ? `Notes: ${payment.notes}` : '',
      `Invoice Value: INR ${Number(invoice.net_amount || 0).toFixed(2)}`,
      `Current Outstanding: INR ${Number(invoice.balance_amount || 0).toFixed(2)}`,
    ].filter(Boolean).join('\n');
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      document_label: 'SERVICE RECEIPT VOUCHER',
      quote_number: payment.receipt_number,
      quote_date_iso: payment.receipt_date,
      title: payment.receipt_number,
      company: { name: 'SAK ERP' },
      customer: {
        name: invoice.customer?.customer_name || 'Customer',
        address: invoice.customer?.billing_address || '',
        phone: invoice.customer?.phone || '',
        email: invoice.customer?.email || '',
      },
      items: [{
        description: `Receipt against ${invoice.invoice_number}`,
        quantity: 1,
        unit: 'RECEIPT',
        unit_price: Number(payment.amount || 0),
      }],
      currency: 'INR',
      tax_rate: 0,
      notes,
    });
    return { buffer, fileName: `${String(payment.receipt_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
  }

  async sendCustomerServiceReceiptEmail(tenantId: string, invoiceId: string, paymentId: string, input: any = {}) {
    const invoice: any = await this.getCustomerServiceInvoiceById(tenantId, invoiceId);
    const payment = (invoice.payments || []).find((row: any) => String(row.id) === String(paymentId));
    if (!payment) throw new NotFoundException('Customer service receipt not found');
    if (payment.reversed_at) throw new BadRequestException('A reversed service receipt cannot be emailed');
    const recipient = String(input?.to || invoice.customer?.email || '').trim().toLowerCase();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new BadRequestException('Enter a valid customer email address');
    }
    if (!this.emailService) throw new BadRequestException('Email service is not configured');
    const document = await this.renderCustomerServiceReceiptPdf(tenantId, invoiceId, paymentId);
    const escapeHtml = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const money = (value: unknown) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const subject = String(input?.subject || `Service payment receipt ${payment.receipt_number}`).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>${escapeHtml(subject)}</h2><p>Dear ${escapeHtml(invoice.customer?.contact_person || invoice.customer?.customer_name || 'Customer')},</p><p>Thank you. We have recorded your payment against service invoice <strong>${escapeHtml(invoice.invoice_number)}</strong>.</p><p><strong>Receipt:</strong> ${escapeHtml(payment.receipt_number)}<br><strong>Amount received:</strong> Rs. ${money(payment.amount)}</p><p>The official service receipt voucher is attached.</p></div>`;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: 'support',
      tenantId,
      attachments: [{ filename: document.fileName, content: document.buffer, contentType: 'application/pdf' }],
    });
    return { message: `Service receipt ${payment.receipt_number} emailed successfully`, recipient };
  }

  async sendCustomerServiceInvoiceEmail(tenantId: string, invoiceId: string, input: any = {}) {
    const invoice: any = await this.getCustomerServiceInvoiceById(tenantId, invoiceId);
    if (invoice.billing_status === 'CANCELLED') {
      throw new BadRequestException('A cancelled service invoice cannot be emailed');
    }

    const recipient = String(input?.to || invoice.customer?.email || '').trim().toLowerCase();
    if (!recipient) throw new BadRequestException('Customer email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new BadRequestException('Enter a valid customer email address');
    }
    if (!this.emailService) throw new BadRequestException('Email service is not configured');

    const escapeHtml = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const money = (value: unknown) => Number(value || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const confirmation = invoice.confirmation || {};
    const billableParts = (invoice.service_parts || []).filter((part: any) => part.charged_to_customer);
    const partRows = billableParts.map((part: any, index: number) =>
      `<tr><td>${index + 1}</td><td>${escapeHtml(part.part_code || part.part_name || 'Service part')}</td><td style="text-align:right">${Number(part.quantity || 0)}</td><td style="text-align:right">Rs. ${money(part.unit_price)}</td><td style="text-align:right">Rs. ${money(part.total_cost)}</td></tr>`,
    ).join('');
    const subject = String(input?.subject || `Customer service invoice ${invoice.invoice_number}`).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>Customer Service Invoice ${escapeHtml(invoice.invoice_number)}</h2><p>Dear ${escapeHtml(invoice.customer?.contact_person || invoice.customer?.customer_name || 'Customer')},</p><p>Please find the service invoice summary below.</p><table style="border-collapse:collapse;width:100%"><tbody><tr><td style="border:1px solid #ddd;padding:8px"><strong>Service ticket</strong></td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(invoice.ticket?.ticket_number || '-')}</td></tr><tr><td style="border:1px solid #ddd;padding:8px"><strong>Confirmation</strong></td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(confirmation.confirmation_number || '-')}</td></tr><tr><td style="border:1px solid #ddd;padding:8px"><strong>Work performed</strong></td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(confirmation.work_performed || '-')}</td></tr></tbody></table>${partRows ? `<h3>Billable parts</h3><table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ddd;padding:8px">No.</th><th style="border:1px solid #ddd;padding:8px">Part</th><th style="border:1px solid #ddd;padding:8px">Qty</th><th style="border:1px solid #ddd;padding:8px">Rate</th><th style="border:1px solid #ddd;padding:8px">Amount</th></tr></thead><tbody>${partRows}</tbody></table>` : ''}<p><strong>Taxable value: Rs. ${money(invoice.taxable_amount)}</strong><br>GST: Rs. ${money(invoice.tax_amount)}<br><strong>Invoice value: Rs. ${money(invoice.net_amount)}</strong><br>Outstanding: Rs. ${money(invoice.balance_amount)}<br>Due date: ${escapeHtml(String(invoice.due_date || '-').slice(0, 10))}</p></div>`;

    const pdf = this.quotePdfService ? await this.renderCustomerServiceInvoicePdf(tenantId, invoiceId) : null;
    await this.emailService.sendEmail({
      to: recipient,
      subject,
      html,
      from: 'support',
      tenantId,
      attachments: pdf ? [{ filename: pdf.fileName, content: pdf.buffer, contentType: 'application/pdf' }] : [],
    });
    return { message: `Service invoice ${invoice.invoice_number} emailed successfully`, recipient };
  }

  async recordCustomerServiceCollectionAction(tenantId: string, userId: string, invoiceId: string, input: any) {
    const invoice: any = await this.getCustomerServiceInvoiceById(tenantId, invoiceId);
    if (invoice.billing_status === 'CANCELLED') throw new BadRequestException('Cancelled invoice cannot be followed up');
    if (Number(invoice.balance_amount || 0) <= 0) throw new BadRequestException('Paid invoice has no open receivable to follow up');
    const status = String(input?.collection_status || '').trim().toUpperCase();
    const allowed = ['NOT_STARTED', 'CONTACTED', 'PROMISED', 'DISPUTED', 'ESCALATED'];
    if (!allowed.includes(status)) throw new BadRequestException(`Collection status must be one of ${allowed.join(', ')}`);
    const notes = String(input?.notes || '').trim();
    if (!notes) throw new BadRequestException('Collection follow-up notes are required');
    if (status === 'PROMISED' && !input?.promise_to_pay_date) throw new BadRequestException('Promise-to-pay date is required for PROMISED status');
    const { nextFollowUpDate, promiseToPayDate } = this.validateServiceCollectionDates(
      input?.next_follow_up_date,
      status === 'PROMISED' ? input?.promise_to_pay_date : null,
    );
    const { data, error } = await this.supabase.from('customer_service_invoices').update({
      collection_status: status,
      last_follow_up_at: new Date().toISOString(),
      last_follow_up_by: userId,
      next_follow_up_date: nextFollowUpDate,
      promise_to_pay_date: promiseToPayDate,
      collection_notes: notes,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('id', invoiceId)
      .eq('billing_status', invoice.billing_status)
      .eq('balance_amount', Number(invoice.balance_amount || 0))
      .select().maybeSingle();
    if (error || !data) throw new BadRequestException(error?.message || 'Invoice changed while saving the follow-up. Reload and try again.');
    return this.withReceivableAgeing(data);
  }

  async createCustomerServiceInvoice(tenantId: string, userId: string, confirmationId: string, input: any = {}) {
    const { data: confirmation, error: confirmationError } = await this.supabase
      .from('service_confirmations')
      .select('*, ticket:service_tickets!inner(*)')
      .eq('tenant_id', tenantId)
      .eq('id', confirmationId)
      .eq('ticket.tenant_id', tenantId)
      .single();
    if (confirmationError || !confirmation) throw new NotFoundException('Service confirmation not found');
    if (confirmation.status !== 'COMPLETED') throw new BadRequestException('Only completed service confirmations can be billed');
    if (Number(confirmation.total_amount || 0) <= 0) throw new BadRequestException('This confirmation has no billable amount');

    const { data: existing, error: existingError } = await this.supabase
      .from('customer_service_invoices')
      .select('invoice_number')
      .eq('tenant_id', tenantId)
      .eq('service_confirmation_id', confirmationId)
      .neq('billing_status', 'CANCELLED')
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (existing) throw new BadRequestException(`Confirmation is already billed on ${existing.invoice_number}`);

    const netAmount = this.roundAmount(confirmation.total_amount);
    const { invoiceDate, dueDate } = this.validateServiceInvoiceDates(input.invoice_date, input.due_date, confirmation.confirmation_date);
    const { data: invoice, error } = await this.supabase
      .from('customer_service_invoices')
      .insert({
        tenant_id: tenantId,
        invoice_number: await this.generateCustomerServiceInvoiceNumber(tenantId),
        service_ticket_id: confirmation.service_ticket_id,
        service_confirmation_id: confirmation.id,
        customer_id: confirmation.ticket.customer_id,
        invoice_date: invoiceDate,
        due_date: dueDate,
        taxable_amount: this.roundAmount(confirmation.subtotal),
        tax_amount: this.roundAmount(confirmation.tax_amount),
        net_amount: netAmount,
        paid_amount: 0,
        balance_amount: netAmount,
        payment_status: 'PENDING',
        billing_status: 'POSTED',
        notes: input.notes || null,
        created_by: userId,
      })
      .select()
      .single();
    if (error || !invoice) {
      if (error?.code === '23505' && String(error.message || '').includes('confirmation')) {
        throw new BadRequestException('This service confirmation has already been billed');
      }
      throw new BadRequestException(error?.message || 'Service invoice creation failed');
    }
    const { data: updatedTicket, error: ticketError } = await this.supabase.from('service_tickets')
      .update({ billing_status: 'INVOICED', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', confirmation.service_ticket_id)
      .select('id').maybeSingle();
    if (ticketError || !updatedTicket) {
      await this.supabase.from('customer_service_invoices').delete().eq('tenant_id', tenantId).eq('id', invoice.id);
      throw new BadRequestException(ticketError?.message || 'Service ticket billing status could not be updated');
    }
    await this.accountingService?.queueAutomaticOperationalPosting(tenantId, userId, {
      source_type: 'SERVICE_INVOICE', source_id: invoice.id, source_number: invoice.invoice_number,
      amount: netAmount, journal_date: invoiceDate,
      narration: `Customer service invoice ${invoice.invoice_number}`,
    });
    return invoice;
  }

  async recordCustomerServicePayment(tenantId: string, userId: string, invoiceId: string, input: any) {
    const { data: invoice, error: invoiceError } = await this.supabase.from('customer_service_invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).single();
    if (invoiceError || !invoice) throw new NotFoundException('Customer service invoice not found');
    if (invoice.billing_status === 'CANCELLED') throw new BadRequestException('Cancelled invoice cannot receive payment');
    const amount = this.roundAmount(input.amount);
    if (amount <= 0) throw new BadRequestException('Receipt amount must be greater than zero');
    if (amount > Number(invoice.balance_amount || 0)) throw new BadRequestException(`Receipt exceeds outstanding balance of ${Number(invoice.balance_amount || 0).toFixed(2)}`);
    const paymentMethod = String(input.payment_method || '').trim().toUpperCase();
    const paymentReference = String(input.payment_reference || '').trim() || null;
    if (!paymentMethod) throw new BadRequestException('Payment method is required');
    if (paymentMethod !== 'CASH' && !paymentReference) throw new BadRequestException('Transaction reference is required for non-cash receipts');
    const receiptDate = this.validateServiceReceiptDate(input.receipt_date, invoice.invoice_date);

    const { data: payment, error } = await this.supabase.from('customer_service_payments').insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      receipt_number: await this.generateCustomerServiceReceiptNumber(tenantId),
      receipt_date: receiptDate,
      amount,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      notes: input.notes || null,
      received_by: userId,
    }).select().single();
    if (error || !payment) throw new BadRequestException(error?.message || 'Service payment posting failed');

    const paidAmount = this.roundAmount(Number(invoice.paid_amount || 0) + amount);
    const balanceAmount = this.roundAmount(Number(invoice.net_amount || 0) - paidAmount);
    const paymentStatus = balanceAmount <= 0 ? 'PAID' : 'PARTIAL';
    const { data: updatedInvoice, error: updateError } = await this.supabase.from('customer_service_invoices')
      .update({ paid_amount: paidAmount, balance_amount: balanceAmount, payment_status: paymentStatus, collection_status: balanceAmount <= 0 ? 'CLOSED' : invoice.collection_status || 'NOT_STARTED', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', invoiceId)
      .eq('paid_amount', Number(invoice.paid_amount || 0))
      .eq('balance_amount', Number(invoice.balance_amount || 0))
      .select('id').maybeSingle();
    if (updateError || !updatedInvoice) {
      await this.supabase.from('customer_service_payments').delete().eq('tenant_id', tenantId).eq('id', payment.id);
      throw new BadRequestException(updateError?.message || 'Invoice balance changed while posting. Reload the invoice and post the receipt again.');
    }
    await this.accountingService?.queueAutomaticOperationalPosting(tenantId, userId, {
      source_type: 'SALES_RECEIPT', source_id: payment.id, source_number: payment.receipt_number,
      amount, journal_date: receiptDate,
      narration: `Service receipt ${payment.receipt_number} against ${invoice.invoice_number}`,
    });
    return { ...payment, invoice_number: invoice.invoice_number, balance_amount: balanceAmount, payment_status: paymentStatus };
  }

  async cancelCustomerServiceInvoice(tenantId: string, userId: string, invoiceId: string, input: any) {
    const reason = String(input?.reason || '').trim();
    if (!reason) throw new BadRequestException('Cancellation reason is required');
    const { data: invoice, error: invoiceError } = await this.supabase.from('customer_service_invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).single();
    if (invoiceError || !invoice) throw new NotFoundException('Customer service invoice not found');
    const { count: activePaymentCount, error: paymentError } = await this.supabase.from('customer_service_payments').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('invoice_id', invoiceId).is('reversed_at', null);
    if (paymentError) throw new BadRequestException(paymentError.message);
    this.assertServiceInvoiceCancellable(invoice, activePaymentCount || 0);
    const cancelledAt = new Date().toISOString();
    const { data, error } = await this.supabase.from('customer_service_invoices').update({
      billing_status: 'CANCELLED', payment_status: 'CANCELLED', balance_amount: 0,
      collection_status: 'CLOSED', cancelled_at: cancelledAt, cancelled_by: userId,
      cancellation_reason: reason, updated_at: cancelledAt,
    }).eq('tenant_id', tenantId).eq('id', invoiceId)
      .eq('billing_status', invoice.billing_status)
      .eq('paid_amount', Number(invoice.paid_amount || 0))
      .select().maybeSingle();
    if (error || !data) throw new BadRequestException(error?.message || 'Invoice changed while cancelling. Reload and try again.');
    const { data: updatedTicket, error: ticketError } = await this.supabase.from('service_tickets')
      .update({ billing_status: 'READY_FOR_BILLING', updated_at: cancelledAt })
      .eq('tenant_id', tenantId).eq('id', invoice.service_ticket_id)
      .select('id').maybeSingle();
    if (ticketError || !updatedTicket) {
      await this.supabase.from('customer_service_invoices').update({
        billing_status: invoice.billing_status, payment_status: invoice.payment_status,
        balance_amount: invoice.balance_amount, collection_status: invoice.collection_status,
        cancelled_at: invoice.cancelled_at, cancelled_by: invoice.cancelled_by,
        cancellation_reason: invoice.cancellation_reason, updated_at: invoice.updated_at,
      }).eq('tenant_id', tenantId).eq('id', invoiceId).eq('cancelled_at', cancelledAt);
      throw new BadRequestException(ticketError?.message || 'Invoice cancellation was rolled back because the service ticket could not be reopened for billing');
    }
    return data;
  }

  async updateServicePartReturn(tenantId: string, partId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_parts_used')
      .select('*, ticket:service_tickets!inner(tenant_id, ticket_number)')
      .eq('id', partId).eq('ticket.tenant_id', tenantId).maybeSingle();
    if (!existing) throw new NotFoundException('Service part issue not found');
    if (!existing.return_required) throw new BadRequestException('This service part is not marked as returnable');
    const current = String(existing.return_status || 'EXPECTED').toUpperCase();
    const next = String(input?.return_status || '').toUpperCase();
    const transitions: Record<string, string[]> = {
      EXPECTED: ['RECEIVED'], RECEIVED: ['SENT_TO_VENDOR', 'SCRAPPED'],
      SENT_TO_VENDOR: ['CREDIT_RECEIVED'], CREDIT_RECEIVED: [], SCRAPPED: [],
    };
    if (!transitions[current]?.includes(next)) throw new BadRequestException(`Part return cannot move from ${current} to ${next}`);
    const reference = String(input?.return_reference || '').trim() || null;
    if (['SENT_TO_VENDOR', 'CREDIT_RECEIVED'].includes(next) && !reference) throw new BadRequestException('Return or credit reference is required');
    const { data, error } = await this.supabase.from('service_parts_used').update({
      return_status: next, return_reference: reference || existing.return_reference,
      returned_at: next === 'RECEIVED' ? new Date().toISOString() : existing.returned_at,
      notes: String(input?.notes || existing.notes || '').trim() || null,
    }).eq('id', partId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getWarrantyRecoveryClaims(tenantId: string, filters: any = {}) {
    let query = this.supabase.from('service_warranty_recovery_claims')
      .select('*, ticket:service_tickets(ticket_number, customer:customers(customer_name)), vendor:vendors(name, code), part:service_parts_used(part_code, part_name, return_status)')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
    if (filters.ticket_id) query = query.eq('service_ticket_id', filters.ticket_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createWarrantyRecoveryClaim(tenantId: string, userId: string, input: any) {
    const ticketId = String(input?.service_ticket_id || '').trim();
    const { data: ticket } = await this.supabase.from('service_tickets').select('id, ticket_number, entitlement_status').eq('tenant_id', tenantId).eq('id', ticketId).maybeSingle();
    if (!ticket) throw new BadRequestException('Select a valid service ticket');
    if (input?.service_part_used_id) {
      const { data: part } = await this.supabase.from('service_parts_used').select('id, service_ticket_id').eq('id', input.service_part_used_id).maybeSingle();
      if (!part || part.service_ticket_id !== ticketId) throw new BadRequestException('Selected part does not belong to this service ticket');
    }
    const claimedAmount = Number(input?.claimed_amount || 0);
    if (!Number.isFinite(claimedAmount) || claimedAmount < 0) throw new BadRequestException('Claimed amount cannot be negative');
    const type = String(input?.claim_type || 'PART').toUpperCase();
    if (!['PART', 'LABOUR', 'TRAVEL', 'OTHER'].includes(type)) throw new BadRequestException('Invalid recovery claim type');
    const sequence = await this.nextServiceDocumentSequence('SERVICE_WARRANTY_RECOVERY');
    const claimNumber = `WRC-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;
    const { data, error } = await this.supabase.from('service_warranty_recovery_claims').insert({
      tenant_id: tenantId, claim_number: claimNumber, service_ticket_id: ticketId,
      service_part_used_id: input?.service_part_used_id || null, vendor_id: input?.vendor_id || null,
      claim_type: type, claimed_amount: claimedAmount, status: 'DRAFT',
      vendor_reference: String(input?.vendor_reference || '').trim() || null,
      notes: String(input?.notes || '').trim() || null, created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateWarrantyRecoveryClaim(tenantId: string, claimId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_warranty_recovery_claims').select('*').eq('tenant_id', tenantId).eq('id', claimId).maybeSingle();
    if (!existing) throw new NotFoundException('Warranty recovery claim not found');
    const current = String(existing.status).toUpperCase();
    const next = String(input?.status || current).toUpperCase();
    const transitions: Record<string, string[]> = {
      DRAFT: ['DRAFT', 'SUBMITTED', 'CANCELLED'], SUBMITTED: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
      UNDER_REVIEW: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'], APPROVED: ['APPROVED', 'SETTLED'],
      REJECTED: ['REJECTED'], SETTLED: ['SETTLED'], CANCELLED: ['CANCELLED'],
    };
    if (!transitions[current]?.includes(next)) throw new BadRequestException(`Recovery claim cannot move from ${current} to ${next}`);
    const approvedAmount = input?.approved_amount === undefined ? Number(existing.approved_amount || 0) : Number(input.approved_amount);
    if (!Number.isFinite(approvedAmount) || approvedAmount < 0 || approvedAmount > Number(existing.claimed_amount || 0)) throw new BadRequestException('Approved amount must be between zero and the claimed amount');
    if (next === 'REJECTED' && !String(input?.rejection_reason || '').trim()) throw new BadRequestException('Rejection reason is required');
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('service_warranty_recovery_claims').update({
      status: next, approved_amount: approvedAmount,
      vendor_reference: String(input?.vendor_reference ?? existing.vendor_reference ?? '').trim() || null,
      rejection_reason: String(input?.rejection_reason ?? existing.rejection_reason ?? '').trim() || null,
      notes: String(input?.notes ?? existing.notes ?? '').trim() || null,
      submitted_at: next === 'SUBMITTED' && !existing.submitted_at ? now : existing.submitted_at,
      settled_at: next === 'SETTLED' ? now : existing.settled_at, updated_at: now,
    }).eq('tenant_id', tenantId).eq('id', claimId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ==================== Chargeable Service Estimates ====================

  async getServiceEstimates(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    await this.expirePendingServiceEstimates(tenantId, ticketId);
    const { data, error } = await this.supabase
      .from('service_estimates')
      .select('*, items:service_estimate_items(*), engagements:service_estimate_engagements(*)')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .order('revision_no', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((estimate: any) => ({
      ...estimate,
      items: [...(estimate.items || [])].sort((a: any, b: any) => Number(a.line_no) - Number(b.line_no)),
      engagements: [...(estimate.engagements || [])].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))),
    }));
  }

  async renderServiceEstimatePdf(tenantId: string, estimateId: string): Promise<{ buffer: Buffer; fileName: string }> {
    if (!this.quotePdfService) throw new BadRequestException('Service estimate PDF generator is not configured');
    const estimate = await this.getOwnedServiceEstimate(tenantId, estimateId);
    const [{ data: estimateItems, error: itemsError }, ticket] = await Promise.all([
      this.supabase.from('service_estimate_items').select('*').eq('estimate_id', estimateId).order('line_no'),
      this.getOwnedTicket(tenantId, estimate.service_ticket_id),
    ]);
    if (itemsError) throw new BadRequestException(itemsError.message);
    (estimate as any).items = estimateItems || [];
    (estimate as any).ticket = ticket;

    const items = [...((estimate as any).items || [])]
      .sort((a: any, b: any) => Number(a.line_no || 0) - Number(b.line_no || 0))
      .map((item: any) => {
        const quantity = Number(item.quantity || 0);
        const lineTotal = Number(item.line_total ?? (quantity * Number(item.unit_price || 0) * (1 - Number(item.discount_percent || 0) / 100)));
        return {
          description: `${item.description || 'Service charge'}${Number(item.discount_percent || 0) > 0 ? ` (discount ${Number(item.discount_percent)}%)` : ''}`,
          quantity,
          unit: item.uom || 'NOS',
          unit_price: quantity > 0 ? lineTotal / quantity : 0,
        };
      });
    const customer = (estimate as any).ticket?.customer || {};
    const notes = [
      `Service Ticket: ${(estimate as any).ticket?.ticket_number || '-'}`,
      `Revision: R${Number((estimate as any).revision_no || 0)}`,
      `Status: ${(estimate as any).status || '-'}`,
      (estimate as any).valid_until ? `Valid Until: ${String((estimate as any).valid_until).slice(0, 10)}` : '',
      (estimate as any).ticket?.product_name ? `Product: ${(estimate as any).ticket.product_name}` : '',
      (estimate as any).ticket?.complaint_description ? `Complaint: ${(estimate as any).ticket.complaint_description}` : '',
    ].filter(Boolean).join('\n');
    const buffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      document_label: 'SERVICE ESTIMATE',
      quote_number: (estimate as any).estimate_number,
      quote_date_iso: (estimate as any).estimate_date,
      title: (estimate as any).estimate_number,
      company: { name: 'SAK ERP' },
      customer: {
        name: customer.customer_name || 'Customer',
        address: customer.billing_address || '',
        phone: customer.phone || '',
        email: customer.email || '',
      },
      items,
      currency: 'INR',
      tax_rate: Number((estimate as any).tax_percentage || 0) / 100,
      notes,
      terms: (estimate as any).terms_and_conditions || '',
    });
    return { buffer, fileName: `${String((estimate as any).estimate_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf` };
  }

  async createServiceEstimate(tenantId: string, userId: string, ticketId: string, input: any) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(String(ticket.status).toUpperCase())) {
      throw new BadRequestException(`Cannot estimate a ${ticket.status} service ticket`);
    }
    if (!ticket.commercial_approval_required && ['CONTRACT', 'WARRANTY'].includes(String(ticket.entitlement_status || '').toUpperCase())) {
      throw new BadRequestException('This ticket is covered by warranty or contract and does not require a chargeable estimate');
    }
    await this.expirePendingServiceEstimates(tenantId, ticketId);
    const { data: active } = await this.supabase.from('service_estimates').select('estimate_number')
      .eq('tenant_id', tenantId).eq('service_ticket_id', ticketId)
      .in('status', ['PENDING_APPROVAL', 'APPROVED']).limit(1);
    if ((active || []).length) throw new BadRequestException(`Active estimate ${active![0].estimate_number} already exists; revise or decide it first`);
    return this.insertServiceEstimate(tenantId, userId, ticket, input, 0);
  }

  async reviseServiceEstimate(tenantId: string, userId: string, estimateId: string, input: any) {
    const source = await this.getOwnedServiceEstimate(tenantId, estimateId);
    if (this.isServiceEstimateExpired(source)) {
      await this.expirePendingServiceEstimates(tenantId, source.service_ticket_id);
      source.status = 'EXPIRED';
    }
    if (['APPROVED', 'CANCELLED', 'SUPERSEDED'].includes(source.status)) {
      throw new BadRequestException(`A ${source.status} estimate cannot be revised`);
    }
    const ticket = await this.getOwnedTicket(tenantId, source.service_ticket_id);
    const nextRevision = Number(source.revision_no || 0) + 1;
    const created = await this.insertServiceEstimate(tenantId, userId, ticket, input, nextRevision, source.estimate_number.split('-R')[0]);
    const { error } = await this.supabase.from('service_estimates')
      .update({ status: 'SUPERSEDED', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', estimateId);
    if (error) throw new BadRequestException(error.message);
    return created;
  }

  async decideServiceEstimate(tenantId: string, userId: string, estimateId: string, input: any) {
    const estimate = await this.getOwnedServiceEstimate(tenantId, estimateId);
    if (this.isServiceEstimateExpired(estimate)) {
      await this.expirePendingServiceEstimates(tenantId, estimate.service_ticket_id);
      throw new BadRequestException(`Service estimate ${estimate.estimate_number} has expired; create a revision before recording customer approval`);
    }
    if (estimate.status !== 'PENDING_APPROVAL') throw new BadRequestException('Only a pending service estimate can be approved or rejected');
    const { decision, comments, approvalReference, approvalAttachmentUrl } = this.validateServiceEstimateDecisionInput(input);
    const now = new Date().toISOString();
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { data: updated, error } = await this.supabase.from('service_estimates').update({
      status,
      customer_comments: comments || null,
      approval_reference: approvalReference || null,
      approval_attachment_url: approvalAttachmentUrl || null,
      approval_recorded_by: userId,
      approved_at: decision === 'APPROVE' ? now : null,
      approved_by: decision === 'APPROVE' ? userId : null,
      rejected_at: decision === 'REJECT' ? now : null,
      rejected_by: decision === 'REJECT' ? userId : null,
      updated_at: now,
    }).eq('tenant_id', tenantId).eq('id', estimateId).eq('status', 'PENDING_APPROVAL').select().single();
    if (error || !updated) throw new BadRequestException(error?.message || 'Estimate decision was already recorded');
    const { error: ticketError } = await this.supabase.from('service_tickets').update({
      commercial_approval_required: true,
      commercial_approval_status: status,
      approved_estimate_id: decision === 'APPROVE' ? estimateId : null,
      estimated_cost: decision === 'APPROVE' ? Number(estimate.total_amount || 0) : Number(estimate.total_amount || 0),
      updated_at: now,
    }).eq('tenant_id', tenantId).eq('id', estimate.service_ticket_id);
    if (ticketError) throw new BadRequestException(ticketError.message);
    return updated;
  }

  private validateServiceEstimateDecisionInput(input: any) {
    const decision = String(input?.decision || '').trim().toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw new BadRequestException('Decision must be APPROVE or REJECT');
    const comments = String(input?.customer_comments || '').trim();
    if (decision === 'REJECT' && !comments) throw new BadRequestException('Customer comments are required when rejecting an estimate');
    const approvalReference = String(input?.approval_reference || '').trim();
    const approvalAttachmentUrl = String(input?.approval_attachment_url || '').trim();
    if (decision === 'APPROVE' && !approvalReference && !approvalAttachmentUrl) {
      throw new BadRequestException('Customer approval reference or supporting authorization document is required');
    }
    if (approvalAttachmentUrl && !approvalAttachmentUrl.startsWith('/uploads/service/')) {
      throw new BadRequestException('Invalid customer authorization attachment');
    }
    return { decision, comments, approvalReference, approvalAttachmentUrl };
  }

  async sendServiceEstimateEmail(tenantId: string, userId: string, estimateId: string, input: any = {}) {
    const { data: estimate, error } = await this.supabase
      .from('service_estimates')
      .select('*, items:service_estimate_items(*), ticket:service_tickets!inner(ticket_number, complaint_description, customer:customers(customer_name, contact_person, email))')
      .eq('tenant_id', tenantId)
      .eq('id', estimateId)
      .eq('ticket.tenant_id', tenantId)
      .single();
    if (error || !estimate) throw new NotFoundException('Service estimate not found');
    if (this.isServiceEstimateExpired(estimate)) {
      await this.expirePendingServiceEstimates(tenantId, (estimate as any).service_ticket_id);
      throw new BadRequestException(`Service estimate ${estimate.estimate_number} has expired; create a revision before emailing it`);
    }
    if (['CANCELLED', 'SUPERSEDED'].includes(String(estimate.status || '').toUpperCase())) {
      throw new BadRequestException(`A ${estimate.status} estimate cannot be emailed`);
    }

    const eventType = String(input?.event_type || 'EMAIL_SENT').trim().toUpperCase();
    if (!['EMAIL_SENT', 'REMINDER_SENT'].includes(eventType)) throw new BadRequestException('Invalid estimate email event type');
    if (eventType === 'REMINDER_SENT' && String(estimate.status).toUpperCase() !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only a pending estimate can receive a response reminder');
    }
    const nextFollowUpDate = String(input?.next_follow_up_date || '').trim() || null;
    if (nextFollowUpDate && (!/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate) || nextFollowUpDate < new Date().toISOString().slice(0, 10))) {
      throw new BadRequestException('Next follow-up date cannot be in the past');
    }

    const customer = (estimate as any).ticket?.customer || {};
    const recipient = String(input?.to || customer.email || '').trim().toLowerCase();
    if (!recipient) throw new BadRequestException('Customer email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new BadRequestException('Enter a valid customer email address');
    if (!this.emailService) throw new BadRequestException('Email service is not configured');

    const escapeHtml = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const money = (value: unknown) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = [...((estimate as any).items || [])]
      .sort((a: any, b: any) => Number(a.line_no || 0) - Number(b.line_no || 0))
      .map((item: any, index: number) => `<tr><td style="border:1px solid #ddd;padding:8px">${index + 1}</td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(item.description)}</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${Number(item.quantity || 0)} ${escapeHtml(item.uom || '')}</td><td style="border:1px solid #ddd;padding:8px;text-align:right">Rs. ${money(item.unit_price)}</td><td style="border:1px solid #ddd;padding:8px;text-align:right">${Number(item.discount_percent || 0)}%</td><td style="border:1px solid #ddd;padding:8px;text-align:right">Rs. ${money(item.line_total)}</td></tr>`)
      .join('');
    const subject = String(input?.subject || `${eventType === 'REMINDER_SENT' ? 'Reminder: ' : ''}Service estimate ${estimate.estimate_number}`).trim();
    const html = `<div style="font-family:Arial,sans-serif;color:#2f241c"><h2>Service Estimate ${escapeHtml(estimate.estimate_number)}</h2><p>Dear ${escapeHtml(customer.contact_person || customer.customer_name || 'Customer')},</p><p>Please find our service estimate for ticket <strong>${escapeHtml((estimate as any).ticket?.ticket_number || '-')}</strong>.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th style="border:1px solid #ddd;padding:8px">No.</th><th style="border:1px solid #ddd;padding:8px">Description</th><th style="border:1px solid #ddd;padding:8px">Quantity</th><th style="border:1px solid #ddd;padding:8px">Rate</th><th style="border:1px solid #ddd;padding:8px">Discount</th><th style="border:1px solid #ddd;padding:8px">Amount</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Taxable value: Rs. ${money(estimate.subtotal)}</strong><br>GST (${money(estimate.tax_percentage)}%): Rs. ${money(estimate.tax_amount)}<br><strong>Estimate total: Rs. ${money(estimate.total_amount)}</strong></p><p>Estimate date: ${escapeHtml(String(estimate.estimate_date || '-').slice(0, 10))}<br>Valid until: ${escapeHtml(String(estimate.valid_until || '-').slice(0, 10))}<br>Revision: ${Number(estimate.revision_no || 0)}</p>${estimate.terms_and_conditions ? `<p style="white-space:pre-wrap"><strong>Terms &amp; Conditions</strong><br>${escapeHtml(estimate.terms_and_conditions)}</p>` : ''}</div>`;
    const { data: engagement, error: engagementError } = await this.supabase.from('service_estimate_engagements').insert({
      tenant_id: tenantId,
      estimate_id: estimateId,
      service_ticket_id: (estimate as any).service_ticket_id,
      event_type: eventType,
      recipient,
      notes: String(input?.notes || '').trim() || null,
      next_follow_up_date: nextFollowUpDate,
      created_by: userId,
    }).select('id').single();
    if (engagementError || !engagement) throw new BadRequestException(engagementError?.message || 'Estimate communication could not be recorded');
    try {
      const pdf = this.quotePdfService ? await this.renderServiceEstimatePdf(tenantId, estimateId) : null;
      await this.emailService.sendEmail({
        to: recipient,
        subject,
        html,
        from: 'support',
        tenantId,
        attachments: pdf ? [{ filename: pdf.fileName, content: pdf.buffer, contentType: 'application/pdf' }] : [],
      });
      // Central, tenant-scoped communication history complements the estimate
      // engagement trail. It is best-effort so an audit-reporting issue never
      // causes a successfully delivered customer email to be reported as failed.
      await this.supabase.from('communication_log').insert({
        tenant_id: tenantId,
        module: 'SERVICE',
        document_type: 'SERVICE_ESTIMATE',
        document_id: estimateId,
        document_number: estimate.estimate_number,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        recipient,
        subject,
        message_preview: String(input?.notes || input?.message || '').slice(0, 1000) || null,
        delivery_status: 'SENT',
        metadata: { event: eventType, service_ticket_id: estimate.service_ticket_id, revision_no: Number(estimate.revision_no || 0) },
        created_by: userId,
      }).then(({ error }: any) => {
        if (error) console.warn('Service estimate communication log not written:', error.message);
      });
    } catch (error) {
      await this.supabase.from('service_estimate_engagements').delete().eq('tenant_id', tenantId).eq('id', engagement.id);
      throw error;
    }
    return { message: `${eventType === 'REMINDER_SENT' ? 'Reminder for' : 'Service estimate'} ${estimate.estimate_number} emailed successfully`, recipient };
  }

  async recordServiceEstimateCustomerComment(tenantId: string, userId: string, estimateId: string, input: any = {}) {
    const estimate = await this.getOwnedServiceEstimate(tenantId, estimateId);
    if (['CANCELLED', 'SUPERSEDED'].includes(String(estimate.status || '').toUpperCase())) {
      throw new BadRequestException(`A ${estimate.status} estimate cannot receive customer comments`);
    }
    const notes = String(input?.notes || '').trim();
    if (!notes) throw new BadRequestException('Customer comment is required');
    const nextFollowUpDate = String(input?.next_follow_up_date || '').trim() || null;
    if (nextFollowUpDate && (!/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate) || nextFollowUpDate < new Date().toISOString().slice(0, 10))) {
      throw new BadRequestException('Next follow-up date cannot be in the past');
    }
    const { data, error } = await this.supabase.from('service_estimate_engagements').insert({
      tenant_id: tenantId,
      estimate_id: estimateId,
      service_ticket_id: estimate.service_ticket_id,
      event_type: 'CUSTOMER_COMMENT',
      notes,
      next_follow_up_date: nextFollowUpDate,
      created_by: userId,
    }).select().single();
    if (error || !data) throw new BadRequestException(error?.message || 'Customer comment could not be recorded');
    return data;
  }

  private isServiceEstimateExpired(estimate: any, today = this.getCurrentBusinessDate()) {
    return String(estimate?.status || '').toUpperCase() === 'PENDING_APPROVAL'
      && Boolean(estimate?.valid_until)
      && String(estimate.valid_until).slice(0, 10) < today;
  }

  private async expirePendingServiceEstimates(tenantId: string, ticketId?: string) {
    const today = this.getCurrentBusinessDate();
    let query = this.supabase.from('service_estimates')
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('status', 'PENDING_APPROVAL')
      .lt('valid_until', today);
    if (ticketId) query = query.eq('service_ticket_id', ticketId);
    const { data, error } = await query.select('id, service_ticket_id');
    if (error) throw new BadRequestException(error.message);
    const ticketIds = [...new Set((data || []).map((row: any) => row.service_ticket_id).filter(Boolean))];
    await Promise.all(ticketIds.map(async (expiredTicketId) => {
      const { error: ticketError } = await this.supabase.from('service_tickets').update({
        commercial_approval_required: true,
        commercial_approval_status: 'EXPIRED',
        approved_estimate_id: null,
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('id', expiredTicketId).eq('commercial_approval_status', 'PENDING_APPROVAL');
      if (ticketError) throw new BadRequestException(ticketError.message);
    }));
    return data || [];
  }

  async reverseCustomerServicePayment(tenantId: string, userId: string, invoiceId: string, paymentId: string, input: any) {
    const reason = String(input?.reason || '').trim();
    if (!reason) throw new BadRequestException('Reversal reason is required');
    const { data: invoice, error: invoiceError } = await this.supabase.from('customer_service_invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).single();
    if (invoiceError || !invoice) throw new NotFoundException('Customer service invoice not found');
    if (invoice.billing_status === 'CANCELLED') throw new BadRequestException('A receipt on a cancelled invoice cannot be reversed');
    const { data: payment, error: paymentError } = await this.supabase.from('customer_service_payments').select('*').eq('tenant_id', tenantId).eq('invoice_id', invoiceId).eq('id', paymentId).single();
    if (paymentError || !payment) throw new NotFoundException('Customer service receipt not found');
    if (payment.reversed_at) throw new BadRequestException('Customer service receipt is already reversed');
    const reversedAt = new Date().toISOString();
    const { data: reversedPayment, error: reverseError } = await this.supabase.from('customer_service_payments')
      .update({ reversed_at: reversedAt, reversed_by: userId, reversal_reason: reason })
      .eq('tenant_id', tenantId).eq('id', paymentId).is('reversed_at', null)
      .select('id').maybeSingle();
    if (reverseError) throw new BadRequestException(reverseError.message);
    if (!reversedPayment) throw new BadRequestException('Customer service receipt is already reversed');
    const paidAmount = this.roundAmount(Math.max(0, Number(invoice.paid_amount || 0) - Number(payment.amount || 0)));
    const balanceAmount = this.roundAmount(Number(invoice.net_amount || 0) - paidAmount);
    const paymentStatus = paidAmount <= 0 ? 'PENDING' : balanceAmount <= 0 ? 'PAID' : 'PARTIAL';
    const { data: updatedInvoice, error: updateError } = await this.supabase.from('customer_service_invoices')
      .update({ paid_amount: paidAmount, balance_amount: balanceAmount, payment_status: paymentStatus, collection_status: balanceAmount > 0 ? 'NOT_STARTED' : invoice.collection_status, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', invoiceId)
      .eq('paid_amount', Number(invoice.paid_amount || 0))
      .eq('balance_amount', Number(invoice.balance_amount || 0))
      .select('id').maybeSingle();
    if (updateError || !updatedInvoice) {
      await this.supabase.from('customer_service_payments').update({ reversed_at: null, reversed_by: null, reversal_reason: null }).eq('tenant_id', tenantId).eq('id', paymentId).eq('reversed_at', reversedAt);
      throw new BadRequestException(updateError?.message || 'Invoice balance changed while reversing. Reload the invoice and try again.');
    }
    return { ...payment, reversed_at: reversedAt, reversal_reason: reason, invoice_number: invoice.invoice_number, paid_amount: paidAmount, balance_amount: balanceAmount, payment_status: paymentStatus };
  }

  async getServiceDocumentFlow(tenantId: string, ticketId: string) {
    const ticket = await this.getServiceTicketById(tenantId, ticketId);
    const [{ data: estimates }, { data: confirmations }, { data: invoices }, { data: history }, { data: parts }, { data: visits }, { data: checklist }, { data: feedback }] = await Promise.all([
      this.supabase.from('service_estimates').select('*, items:service_estimate_items(*)').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('revision_no'),
      this.supabase.from('service_confirmations').select('*').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('created_at'),
      this.supabase.from('customer_service_invoices').select('*, payments:customer_service_payments(*)').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('created_at'),
      this.supabase.from('service_history').select('*').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('created_at'),
      this.supabase.from('service_parts_used').select('*, stock_movement:stock_movements(movement_number, movement_type, movement_date)').eq('service_ticket_id', ticketId).order('issued_at', { ascending: true }),
      this.supabase.from('service_site_visits').select('*, assignment:service_assignments(id, status, technician:technicians(id, technician_code, technician_name, contact_number))').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('visit_number'),
      this.supabase.from('service_ticket_checklist_items').select('*').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).order('sort_order'),
      this.supabase.from('service_feedback').select('*').eq('tenant_id', tenantId).eq('service_ticket_id', ticketId).maybeSingle(),
    ]);
    return { ticket, estimates: estimates || [], assignments: ticket.assignments || [], visits: visits || [], checklist: checklist || [], parts: parts || ticket.parts_used || [], confirmations: confirmations || [], invoices: invoices || [], history: history || [], feedback: feedback || null };
  }

  async getServiceFeedback(tenantId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase
      .from('service_feedback')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data || null;
  }

  async recordServiceFeedback(tenantId: string, userId: string, ticketId: string, input: any) {
    const ticket = await this.getOwnedTicket(tenantId, ticketId);
    if (!['COMPLETED', 'CLOSED'].includes(String(ticket.status || '').toUpperCase())) {
      throw new BadRequestException('Customer feedback can be recorded only after service completion');
    }
    const feedback = this.validateServiceFeedbackInput(input);
    const { data: existing, error: existingError } = await this.supabase
      .from('service_feedback')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('service_ticket_id', ticketId)
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (existing) throw new BadRequestException('Customer feedback is already recorded for this service ticket');

    const { data, error } = await this.supabase.from('service_feedback').insert({
      tenant_id: tenantId,
      service_ticket_id: ticketId,
      customer_id: ticket.customer_id,
      recorded_by: userId,
      ...feedback,
    }).select().single();
    if (error) {
      if (error.code === '23505') throw new BadRequestException('Customer feedback is already recorded for this service ticket');
      throw new BadRequestException(error.message);
    }
    return data;
  }

  // ==================== Installed Base / Service Contracts ====================

  async getInstalledAssets(tenantId: string, filters: any = {}) {
    let query = this.supabase
      .from('service_installed_assets')
      .select('*, customer:customers(id, customer_code, customer_name), item:items(id, code, name)')
      .eq('tenant_id', tenantId)
      .order('asset_number', { ascending: true });
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
    if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createInstalledAsset(tenantId: string, userId: string, input: any) {
    const customerId = String(input.customer_id || '').trim();
    const assetName = String(input.asset_name || '').trim();
    if (!customerId || !assetName) throw new BadRequestException('Customer and asset name are required');
    const { data: customer } = await this.supabase.from('customers').select('id').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
    if (!customer) throw new BadRequestException('Customer does not belong to this company');
    const assetNumber = String(input.asset_number || await this.generateInstalledAssetNumber(tenantId)).trim().toUpperCase();
    const parentAssetId = String(input.parent_asset_id || '').trim() || null;
    if (parentAssetId) {
      const { data: parent } = await this.supabase.from('service_installed_assets').select('id, customer_id').eq('tenant_id', tenantId).eq('id', parentAssetId).maybeSingle();
      if (!parent || parent.customer_id !== customerId) throw new BadRequestException('Parent equipment must belong to the same customer');
    }
    const payload = {
      tenant_id: tenantId, asset_number: assetNumber, customer_id: customerId,
      item_id: input.item_id || null, uid: String(input.uid || '').trim() || null,
      serial_number: String(input.serial_number || '').trim() || null, asset_name: assetName,
      installation_date: input.installation_date || null, warranty_until: input.warranty_until || null,
      location: String(input.location || '').trim() || null, status: String(input.status || 'ACTIVE').toUpperCase(),
      parent_asset_id: parentAssetId, functional_location: String(input.functional_location || '').trim() || null,
      criticality: String(input.criticality || 'MEDIUM').toUpperCase(), manufacturer: String(input.manufacturer || '').trim() || null,
      model_number: String(input.model_number || '').trim() || null,
      notes: String(input.notes || '').trim() || null, created_by: userId,
    };
    const { data, error } = await this.supabase.from('service_installed_assets').insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateInstalledAsset(tenantId: string, assetId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_installed_assets').select('*').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
    if (!existing) throw new NotFoundException('Installed asset not found');
    const nextCustomerId = input.customer_id || existing.customer_id;
    if (nextCustomerId !== existing.customer_id) {
      const { count: ticketCount } = await this.supabase.from('service_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('installed_asset_id', assetId);
      if ((ticketCount || 0) > 0) throw new BadRequestException('An installed asset with service history cannot be transferred to another customer');
    }
    const { data: customer } = await this.supabase.from('customers').select('id').eq('tenant_id', tenantId).eq('id', nextCustomerId).maybeSingle();
    if (!customer) throw new BadRequestException('Customer does not belong to this company');
    const update: any = { updated_at: new Date().toISOString() };
    for (const field of ['customer_id', 'item_id', 'installation_date', 'warranty_until', 'parent_asset_id']) if (field in input) update[field] = input[field] || null;
    for (const field of ['asset_name', 'uid', 'serial_number', 'location', 'notes', 'functional_location', 'manufacturer', 'model_number']) if (field in input) update[field] = String(input[field] || '').trim() || null;
    if (update.parent_asset_id === assetId) throw new BadRequestException('Equipment cannot be its own parent');
    if (update.parent_asset_id) {
      const { data: parent } = await this.supabase.from('service_installed_assets').select('id, customer_id, parent_asset_id').eq('tenant_id', tenantId).eq('id', update.parent_asset_id).maybeSingle();
      if (!parent || parent.customer_id !== nextCustomerId) throw new BadRequestException('Parent equipment must belong to the same customer');
      if (parent.parent_asset_id === assetId) throw new BadRequestException('Equipment hierarchy cannot contain a cycle');
    }
    if (input.criticality) update.criticality = String(input.criticality).toUpperCase();
    if (input.status) update.status = String(input.status).toUpperCase();
    if (!String(update.asset_name ?? input.asset_name ?? 'x').trim()) throw new BadRequestException('Asset name is required');
    const { data, error } = await this.supabase.from('service_installed_assets').update(update).eq('tenant_id', tenantId).eq('id', assetId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteInstalledAsset(tenantId: string, assetId: string) {
    const { count: ticketCount } = await this.supabase.from('service_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('installed_asset_id', assetId);
    if ((ticketCount || 0) > 0) throw new BadRequestException('Asset has service history and cannot be deleted; set it inactive instead');
    const { error } = await this.supabase.from('service_installed_assets').delete().eq('tenant_id', tenantId).eq('id', assetId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Installed asset deleted' };
  }

  async getAssetMeters(tenantId: string, assetId: string) {
    const { data: asset } = await this.supabase.from('service_installed_assets').select('id').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
    if (!asset) throw new NotFoundException('Installed asset not found');
    const { data: meters, error } = await this.supabase.from('service_asset_meters').select('*')
      .eq('tenant_id', tenantId).eq('installed_asset_id', assetId).order('meter_name');
    if (error) throw new BadRequestException(error.message);
    const meterIds = (meters || []).map((meter: any) => meter.id);
    const { data: readings, error: readingError } = meterIds.length
      ? await this.supabase.from('service_asset_meter_readings').select('*').eq('tenant_id', tenantId).in('meter_id', meterIds).order('reading_at', { ascending: false })
      : { data: [], error: null } as any;
    if (readingError) throw new BadRequestException(readingError.message);
    return (meters || []).map((meter: any) => ({ ...meter, readings: (readings || []).filter((row: any) => row.meter_id === meter.id), latest_reading: (readings || []).find((row: any) => row.meter_id === meter.id) || null }));
  }

  async createAssetMeter(tenantId: string, userId: string, assetId: string, input: any) {
    const { data: asset } = await this.supabase.from('service_installed_assets').select('id').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
    if (!asset) throw new NotFoundException('Installed asset not found');
    const meterName = String(input?.meter_name || '').trim();
    const uom = String(input?.uom || '').trim().toUpperCase();
    if (!meterName || !uom) throw new BadRequestException('Meter name and UOM are required');
    const rollover = input?.rollover_value === '' || input?.rollover_value === undefined ? null : Number(input.rollover_value);
    if (rollover !== null && (!Number.isFinite(rollover) || rollover <= 0)) throw new BadRequestException('Meter rollover value must be greater than zero');
    const { data, error } = await this.supabase.from('service_asset_meters').insert({ tenant_id: tenantId, installed_asset_id: assetId, meter_name: meterName, uom, rollover_value: rollover, created_by: userId }).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'This equipment already has a meter with that name' : error.message);
    const initialReading = Number(input?.initial_reading || 0);
    if (!Number.isFinite(initialReading) || initialReading < 0) throw new BadRequestException('Initial meter reading must be zero or greater');
    const { error: readingError } = await this.supabase.from('service_asset_meter_readings').insert({ tenant_id: tenantId, meter_id: data.id, reading_value: initialReading, reading_at: new Date().toISOString(), source: 'MANUAL', notes: 'Initial meter reading', recorded_by: userId });
    if (readingError) {
      await this.supabase.from('service_asset_meters').delete().eq('tenant_id', tenantId).eq('id', data.id);
      throw new BadRequestException(readingError.message);
    }
    return data;
  }

  async recordAssetMeterReading(tenantId: string, userId: string, meterId: string, input: any) {
    const { data: meter } = await this.supabase.from('service_asset_meters').select('*').eq('tenant_id', tenantId).eq('id', meterId).eq('is_active', true).maybeSingle();
    if (!meter) throw new NotFoundException('Active equipment meter not found');
    const value = Number(input?.reading_value);
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Meter reading must be zero or greater');
    const readingAt = new Date(input?.reading_at || new Date());
    if (!Number.isFinite(readingAt.getTime()) || readingAt.getTime() > Date.now() + 300000) throw new BadRequestException('Meter reading date cannot be in the future');
    const { data: latest } = await this.supabase.from('service_asset_meter_readings').select('reading_value, reading_at').eq('tenant_id', tenantId).eq('meter_id', meterId).order('reading_at', { ascending: false }).limit(1).maybeSingle();
    if (latest && readingAt.getTime() <= new Date(latest.reading_at).getTime()) throw new BadRequestException('Meter reading date must be after the latest reading');
    if (latest && value < Number(latest.reading_value) && !meter.rollover_value) throw new BadRequestException('Meter reading cannot decrease unless a rollover value is configured');
    const source = String(input?.source || 'MANUAL').toUpperCase();
    if (!['MANUAL', 'SERVICE_VISIT', 'IOT', 'IMPORT'].includes(source)) throw new BadRequestException('Invalid meter-reading source');
    const { data, error } = await this.supabase.from('service_asset_meter_readings').insert({ tenant_id: tenantId, meter_id: meterId, reading_value: value, reading_at: readingAt.toISOString(), source, service_ticket_id: input?.service_ticket_id || null, notes: String(input?.notes || '').trim() || null, recorded_by: userId }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getServiceContracts(tenantId: string, filters: any = {}) {
    let query = this.supabase
      .from('service_contracts')
      .select('*, customer:customers(id, customer_code, customer_name), contract_assets:service_contract_assets(asset_id, asset:service_installed_assets(id, asset_number, asset_name, uid, serial_number))')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
    if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const contractIds = (data || []).map((contract: any) => contract.id);
    const { data: consumption, error: consumptionError } = contractIds.length
      ? await this.supabase
        .from('service_contract_consumption')
        .select('service_contract_id, visits_used, labor_hours_used')
        .eq('tenant_id', tenantId)
        .in('service_contract_id', contractIds)
      : { data: [], error: null } as any;
    if (consumptionError) throw new BadRequestException(consumptionError.message);
    const usage = new Map<string, { visits: number; laborHours: number }>();
    for (const row of consumption || []) {
      const current = usage.get(row.service_contract_id) || { visits: 0, laborHours: 0 };
      current.visits += Number(row.visits_used || 0);
      current.laborHours += Number(row.labor_hours_used || 0);
      usage.set(row.service_contract_id, current);
    }
    const today = new Date().toISOString().slice(0, 10);
    return (data || []).map((contract: any) => {
      const consumed = usage.get(contract.id) || { visits: 0, laborHours: 0 };
      return {
        ...contract,
        effective_status: contract.status === 'ACTIVE' && contract.end_date < today ? 'EXPIRED' : contract.status,
        entitlement_usage: {
          visits_used: consumed.visits,
          visits_remaining: contract.included_visits == null ? null : Math.max(0, Number(contract.included_visits) - consumed.visits),
          labor_hours_used: this.roundAmount(consumed.laborHours),
          labor_hours_remaining: contract.included_labor_hours == null ? null : Math.max(0, this.roundAmount(Number(contract.included_labor_hours) - consumed.laborHours)),
        },
      };
    });
  }

  async createServiceContract(tenantId: string, userId: string, input: any) {
    const customerId = String(input.customer_id || '').trim();
    const startDate = String(input.start_date || '').trim();
    const endDate = String(input.end_date || '').trim();
    if (!customerId || !startDate || !endDate) throw new BadRequestException('Customer, start date and end date are required');
    if (endDate < startDate) throw new BadRequestException('Contract end date cannot be before start date');
    const responseHours = Number(input.response_hours || 0);
    const resolutionHours = Number(input.resolution_hours || 0);
    if (!(responseHours > 0) || !(resolutionHours > 0)) throw new BadRequestException('SLA response and resolution hours must be positive');
    const contractNumber = String(input.contract_number || await this.generateServiceContractNumber(tenantId)).trim().toUpperCase();
    const payload = {
      tenant_id: tenantId, contract_number: contractNumber, customer_id: customerId,
      contract_type: String(input.contract_type || 'AMC').toUpperCase(), start_date: startDate, end_date: endDate,
      status: String(input.status || 'DRAFT').toUpperCase(), response_hours: responseHours, resolution_hours: resolutionHours,
      included_visits: input.included_visits === '' || input.included_visits == null ? null : Number(input.included_visits),
      included_labor_hours: input.included_labor_hours === '' || input.included_labor_hours == null ? null : Number(input.included_labor_hours),
      contract_value: this.roundAmount(input.contract_value || 0), tax_percentage: Number(input.tax_percentage ?? 18),
      notes: String(input.notes || '').trim() || null, created_by: userId,
    };
    const { data: contract, error } = await this.supabase.from('service_contracts').insert(payload).select().single();
    if (error) throw new BadRequestException(error.message);
    const assetIds = [...new Set((input.asset_ids || []).map((id: any) => String(id).trim()).filter(Boolean))];
    if (assetIds.length) {
      const { data: assets } = await this.supabase.from('service_installed_assets').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId).in('id', assetIds);
      if ((assets || []).length !== assetIds.length) {
        await this.supabase.from('service_contracts').delete().eq('tenant_id', tenantId).eq('id', contract.id);
        throw new BadRequestException('Every linked asset must belong to the selected customer');
      }
      const { error: linkError } = await this.supabase.from('service_contract_assets').insert(assetIds.map((assetId) => ({ contract_id: contract.id, asset_id: assetId })));
      if (linkError) {
        await this.supabase.from('service_contracts').delete().eq('tenant_id', tenantId).eq('id', contract.id);
        throw new BadRequestException(linkError.message);
      }
    }
    return contract;
  }

  async updateServiceContract(tenantId: string, contractId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_contracts').select('*').eq('tenant_id', tenantId).eq('id', contractId).maybeSingle();
    if (!existing) throw new NotFoundException('Service contract not found');
    const startDate = input.start_date || existing.start_date;
    const endDate = input.end_date || existing.end_date;
    if (endDate < startDate) throw new BadRequestException('Contract end date cannot be before start date');
    const protectedFields = ['customer_id', 'contract_type', 'start_date', 'end_date', 'response_hours', 'resolution_hours', 'included_visits', 'included_labor_hours', 'contract_value', 'tax_percentage', 'asset_ids'];
    const { count: governedTicketCount } = await this.supabase.from('service_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('service_contract_id', contractId);
    if ((governedTicketCount || 0) > 0 && protectedFields.some((field) => field in input)) {
      throw new BadRequestException('This contract already governs service tickets. Its customer, coverage, SLA, dates and commercial terms are frozen; update only status or notes, or create a new contract revision');
    }
    const customerId = input.customer_id || existing.customer_id;
    const { data: customer } = await this.supabase.from('customers').select('id').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
    if (!customer) throw new BadRequestException('Customer does not belong to this company');
    let assetIds: string[] | null = null;
    if (Array.isArray(input.asset_ids)) {
      assetIds = [...new Set(input.asset_ids.map((id: any) => String(id).trim()).filter(Boolean))] as string[];
    } else if (customerId !== existing.customer_id) {
      const { data: links } = await this.supabase.from('service_contract_assets').select('asset_id').eq('contract_id', contractId);
      assetIds = (links || []).map((link: any) => link.asset_id);
    }
    if (assetIds?.length) {
      const { data: assets } = await this.supabase.from('service_installed_assets').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId).in('id', assetIds);
      if ((assets || []).length !== assetIds.length) throw new BadRequestException('Every linked asset must belong to the selected customer');
    }
    const update: any = { updated_at: new Date().toISOString() };
    for (const field of ['customer_id', 'start_date', 'end_date', 'included_visits', 'included_labor_hours', 'contract_value', 'tax_percentage']) if (field in input) update[field] = input[field] === '' ? null : input[field];
    for (const field of ['notes']) if (field in input) update[field] = String(input[field] || '').trim() || null;
    for (const field of ['contract_type', 'status']) if (input[field]) update[field] = String(input[field]).toUpperCase();
    for (const field of ['response_hours', 'resolution_hours']) if (field in input) {
      const value = Number(input[field]);
      if (!(value > 0)) throw new BadRequestException('SLA hours must be positive');
      update[field] = value;
    }
    const { data, error } = await this.supabase.from('service_contracts').update(update).eq('tenant_id', tenantId).eq('id', contractId).select().single();
    if (error) throw new BadRequestException(error.message);
    if (Array.isArray(input.asset_ids) && assetIds) {
      await this.supabase.from('service_contract_assets').delete().eq('contract_id', contractId);
      if (assetIds.length) {
        const { error: linkError } = await this.supabase.from('service_contract_assets').insert(assetIds.map((assetId) => ({ contract_id: contractId, asset_id: assetId })));
        if (linkError) throw new BadRequestException(linkError.message);
      }
    }
    return data;
  }

  async deleteServiceContract(tenantId: string, contractId: string) {
    const { data: contract } = await this.supabase.from('service_contracts').select('status').eq('tenant_id', tenantId).eq('id', contractId).maybeSingle();
    if (!contract) throw new NotFoundException('Service contract not found');
    if (contract.status !== 'DRAFT') throw new BadRequestException('Only draft service contracts can be deleted; cancel active contracts instead');
    const { error } = await this.supabase.from('service_contracts').delete().eq('tenant_id', tenantId).eq('id', contractId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Service contract deleted' };
  }

  async renewServiceContract(tenantId: string, userId: string, contractId: string, input: any) {
    const { data: source, error: sourceError } = await this.supabase
      .from('service_contracts')
      .select('*, contract_assets:service_contract_assets(asset_id)')
      .eq('tenant_id', tenantId)
      .eq('id', contractId)
      .maybeSingle();
    if (sourceError) throw new BadRequestException(sourceError.message);
    if (!source) throw new NotFoundException('Service contract not found');
    if (!['ACTIVE', 'EXPIRED'].includes(source.status)) {
      throw new BadRequestException('Only an active or expired service contract can be renewed');
    }

    const { data: existingRenewal, error: renewalLookupError } = await this.supabase
      .from('service_contracts')
      .select('id, contract_number, status')
      .eq('tenant_id', tenantId)
      .eq('renewed_from_contract_id', contractId)
      .neq('status', 'CANCELLED')
      .maybeSingle();
    if (renewalLookupError) throw new BadRequestException(renewalLookupError.message);
    if (existingRenewal) {
      throw new BadRequestException(`Renewal ${existingRenewal.contract_number} already exists with status ${existingRenewal.status}`);
    }

    const startDate = String(input.start_date || '').trim();
    const endDate = String(input.end_date || '').trim();
    if (!startDate || !endDate) throw new BadRequestException('Renewal start date and end date are required');
    if (startDate <= source.end_date) throw new BadRequestException('Renewal must start after the source contract ends');
    if (endDate < startDate) throw new BadRequestException('Renewal end date cannot be before start date');

    const payload = {
      tenant_id: tenantId,
      contract_number: await this.generateServiceContractNumber(tenantId),
      customer_id: source.customer_id,
      contract_type: String(input.contract_type || source.contract_type).toUpperCase(),
      start_date: startDate,
      end_date: endDate,
      status: 'DRAFT',
      response_hours: Number(input.response_hours ?? source.response_hours),
      resolution_hours: Number(input.resolution_hours ?? source.resolution_hours),
      included_visits: input.included_visits === '' ? null : (input.included_visits ?? source.included_visits),
      included_labor_hours: input.included_labor_hours === '' ? null : (input.included_labor_hours ?? source.included_labor_hours),
      contract_value: this.roundAmount(input.contract_value ?? source.contract_value),
      tax_percentage: Number(input.tax_percentage ?? source.tax_percentage),
      notes: String(input.notes ?? source.notes ?? '').trim() || null,
      renewed_from_contract_id: source.id,
      renewal_sequence: Number(source.renewal_sequence || 0) + 1,
      created_by: userId,
    };
    if (!(payload.response_hours > 0) || !(payload.resolution_hours > 0)) {
      throw new BadRequestException('SLA response and resolution hours must be positive');
    }

    const { data: renewal, error: createError } = await this.supabase
      .from('service_contracts')
      .insert(payload)
      .select()
      .single();
    if (createError || !renewal) throw new BadRequestException(createError?.message || 'Contract renewal could not be created');

    const assetIds = (source.contract_assets || []).map((link: any) => link.asset_id).filter(Boolean);
    if (assetIds.length) {
      const { error: linkError } = await this.supabase
        .from('service_contract_assets')
        .insert(assetIds.map((assetId: string) => ({ contract_id: renewal.id, asset_id: assetId })));
      if (linkError) {
        await this.supabase.from('service_contracts').delete().eq('tenant_id', tenantId).eq('id', renewal.id);
        throw new BadRequestException(linkError.message);
      }
    }
    return renewal;
  }

  // ==================== Preventive Maintenance ====================

  private validateMaintenanceScheduleInput(input: any, existing?: any) {
    const scheduleName = String(input.schedule_name ?? existing?.schedule_name ?? '').trim();
    const customerId = String(input.customer_id ?? existing?.customer_id ?? '').trim();
    const uid = String(input.uid ?? existing?.uid ?? '').trim();
    const frequencyDays = Number(input.frequency_days ?? existing?.frequency_days);
    const notifyBeforeDays = Number(input.notify_before_days ?? existing?.notify_before_days ?? 7);
    const nextServiceDate = String(input.next_service_date ?? existing?.next_service_date ?? '').trim();
    if (!scheduleName || !customerId || !uid || !nextServiceDate) {
      throw new BadRequestException('Schedule name, customer, equipment UID and next service date are required');
    }
    if (!Number.isInteger(frequencyDays) || frequencyDays <= 0) throw new BadRequestException('Frequency must be a positive whole number of days');
    if (!Number.isInteger(notifyBeforeDays) || notifyBeforeDays < 0) throw new BadRequestException('Notification lead time must be zero or a positive whole number of days');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextServiceDate)) throw new BadRequestException('Next service date is invalid');
    return { scheduleName, customerId, uid, frequencyDays, notifyBeforeDays, nextServiceDate };
  }

  private maintenanceStatus(schedule: any) {
    if (!schedule.is_active) return 'INACTIVE';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(`${schedule.next_service_date}T00:00:00`);
    const notify = new Date(today); notify.setDate(notify.getDate() + Number(schedule.notify_before_days || 0));
    const triggerType = String(schedule.trigger_type || 'CALENDAR').toUpperCase();
    const currentMeter = Number(schedule.current_meter_reading);
    const nextMeter = Number(schedule.next_service_meter);
    if (['METER', 'WHICHEVER_FIRST'].includes(triggerType) && Number.isFinite(currentMeter) && Number.isFinite(nextMeter) && nextMeter > 0 && currentMeter >= nextMeter) return 'OVERDUE';
    if (triggerType === 'METER') return 'SCHEDULED';
    if (due < today) return 'OVERDUE';
    if (due <= notify) return 'DUE';
    return 'SCHEDULED';
  }

  async getMaintenanceSchedules(tenantId: string, filters: any = {}) {
    let query = this.supabase.from('preventive_maintenance_schedule')
      .select('*')
      .eq('tenant_id', tenantId).order('next_service_date', { ascending: true });
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id);
    if (filters.active === 'true') query = query.eq('is_active', true);
    if (filters.active === 'false') query = query.eq('is_active', false);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const rows = data || [];
    const customerIds = [...new Set(rows.map((row: any) => row.customer_id).filter(Boolean))];
    const assetIds = [...new Set(rows.map((row: any) => row.installed_asset_id).filter(Boolean))];
    const ticketIds = [...new Set(rows.map((row: any) => row.last_generated_ticket_id).filter(Boolean))];
    const meterIds = [...new Set(rows.map((row: any) => row.meter_id).filter(Boolean))];
    const [{ data: customers }, { data: assets }, { data: tickets }, { data: readings }] = await Promise.all([
      customerIds.length ? this.supabase.from('customers').select('id, customer_code, customer_name').eq('tenant_id', tenantId).in('id', customerIds) : Promise.resolve({ data: [] }),
      assetIds.length ? this.supabase.from('service_installed_assets').select('id, asset_number, asset_name, uid, serial_number').eq('tenant_id', tenantId).in('id', assetIds) : Promise.resolve({ data: [] }),
      ticketIds.length ? this.supabase.from('service_tickets').select('id, ticket_number, status').eq('tenant_id', tenantId).in('id', ticketIds) : Promise.resolve({ data: [] }),
      meterIds.length ? this.supabase.from('service_asset_meter_readings').select('meter_id, reading_value, reading_at').eq('tenant_id', tenantId).in('meter_id', meterIds).order('reading_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ] as any);
    const customerMap = new Map((customers || []).map((row: any) => [row.id, row]));
    const assetMap = new Map((assets || []).map((row: any) => [row.id, row]));
    const ticketMap = new Map((tickets || []).map((row: any) => [row.id, row]));
    const readingMap = new Map<string, any>();
    for (const reading of readings || []) if (!readingMap.has(reading.meter_id)) readingMap.set(reading.meter_id, reading);
    return rows.map((row: any) => { const latest = readingMap.get(row.meter_id); const enriched = { ...row, current_meter_reading: latest?.reading_value ?? null, latest_meter_reading_at: latest?.reading_at ?? null }; return { ...enriched, customer: customerMap.get(row.customer_id) || null, installed_asset: assetMap.get(row.installed_asset_id) || null, last_ticket: ticketMap.get(row.last_generated_ticket_id) || null, maintenance_status: this.maintenanceStatus(enriched) }; });
  }

  private async validateMaintenanceOwnership(tenantId: string, customerId: string, uid: string, assetId?: string | null) {
    const { data: customer } = await this.supabase.from('customers').select('id').eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
    if (!customer) throw new BadRequestException('Customer does not belong to this company');
    if (!assetId) return null;
    const { data: asset } = await this.supabase.from('service_installed_assets').select('*').eq('tenant_id', tenantId).eq('id', assetId).maybeSingle();
    if (!asset || asset.customer_id !== customerId || asset.status !== 'ACTIVE') throw new BadRequestException('Installed asset must be active and belong to the selected customer');
    if (asset.uid && String(asset.uid).trim() !== uid) throw new BadRequestException('Equipment UID must match the selected installed asset');
    return asset;
  }

  async createMaintenanceSchedule(tenantId: string, userId: string, input: any) {
    const valid = this.validateMaintenanceScheduleInput(input);
    const asset = await this.validateMaintenanceOwnership(tenantId, valid.customerId, valid.uid, input.installed_asset_id);
    const triggerType = String(input.trigger_type || 'CALENDAR').toUpperCase();
    if (!['CALENDAR', 'METER', 'WHICHEVER_FIRST'].includes(triggerType)) throw new BadRequestException('Invalid maintenance trigger type');
    if (triggerType !== 'CALENDAR' && (!input.meter_id || !(Number(input.meter_interval) > 0))) throw new BadRequestException('Meter and positive meter interval are required for meter-based maintenance');
    const { data, error } = await this.supabase.from('preventive_maintenance_schedule').insert({
      tenant_id: tenantId, customer_id: valid.customerId, uid: valid.uid,
      installed_asset_id: asset?.id || null, schedule_name: valid.scheduleName,
      frequency_days: valid.frequencyDays, last_service_date: input.last_service_date || null,
      next_service_date: valid.nextServiceDate, service_checklist: String(input.service_checklist || '').trim() || null,
      notify_before_days: valid.notifyBeforeDays, is_active: input.is_active !== false, created_by: userId,
      trigger_type: triggerType, meter_id: input.meter_id || null,
      meter_interval: input.meter_interval === '' ? null : Number(input.meter_interval),
      last_service_meter: input.last_service_meter === '' ? null : Number(input.last_service_meter),
      next_service_meter: input.next_service_meter === '' ? (input.meter_interval === '' ? null : Number(input.last_service_meter || 0) + Number(input.meter_interval)) : Number(input.next_service_meter),
    }).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'An active maintenance schedule with this name already exists for the equipment' : error.message);
    return { ...data, maintenance_status: this.maintenanceStatus(data) };
  }

  async updateMaintenanceSchedule(tenantId: string, scheduleId: string, input: any) {
    const { data: existing } = await this.supabase.from('preventive_maintenance_schedule').select('*').eq('tenant_id', tenantId).eq('id', scheduleId).maybeSingle();
    if (!existing) throw new NotFoundException('Maintenance schedule not found');
    const valid = this.validateMaintenanceScheduleInput(input, existing);
    const assetId = 'installed_asset_id' in input ? input.installed_asset_id : existing.installed_asset_id;
    await this.validateMaintenanceOwnership(tenantId, valid.customerId, valid.uid, assetId);
    const update: any = {
      customer_id: valid.customerId, uid: valid.uid, installed_asset_id: assetId || null,
      schedule_name: valid.scheduleName, frequency_days: valid.frequencyDays,
      next_service_date: valid.nextServiceDate, notify_before_days: valid.notifyBeforeDays,
      service_checklist: String(input.service_checklist ?? existing.service_checklist ?? '').trim() || null,
      is_active: input.is_active ?? existing.is_active, updated_at: new Date().toISOString(),
      trigger_type: String(input.trigger_type || existing.trigger_type || 'CALENDAR').toUpperCase(),
      meter_id: input.meter_id || null,
      meter_interval: input.meter_interval === '' ? null : Number(input.meter_interval ?? existing.meter_interval),
      last_service_meter: input.last_service_meter === '' ? null : Number(input.last_service_meter ?? existing.last_service_meter),
      next_service_meter: input.next_service_meter === '' ? null : Number(input.next_service_meter ?? existing.next_service_meter),
    };
    if (!['CALENDAR', 'METER', 'WHICHEVER_FIRST'].includes(update.trigger_type)) throw new BadRequestException('Invalid maintenance trigger type');
    if (update.trigger_type !== 'CALENDAR' && (!update.meter_id || !(update.meter_interval > 0))) throw new BadRequestException('Meter and positive meter interval are required for meter-based maintenance');
    if ('last_service_date' in input) update.last_service_date = input.last_service_date || null;
    const { data, error } = await this.supabase.from('preventive_maintenance_schedule').update(update).eq('tenant_id', tenantId).eq('id', scheduleId).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'An active maintenance schedule with this name already exists for the equipment' : error.message);
    return { ...data, maintenance_status: this.maintenanceStatus(data) };
  }

  async deleteMaintenanceSchedule(tenantId: string, scheduleId: string) {
    const { count } = await this.supabase.from('service_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('pm_schedule_id', scheduleId);
    if ((count || 0) > 0) throw new BadRequestException('Schedule has service history and cannot be deleted; deactivate it instead');
    const { error } = await this.supabase.from('preventive_maintenance_schedule').delete().eq('tenant_id', tenantId).eq('id', scheduleId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Maintenance schedule deleted' };
  }

  async generateMaintenanceTicket(tenantId: string, userId: string, scheduleId: string) {
    const { data: schedule, error } = await this.supabase.from('preventive_maintenance_schedule').select('*').eq('tenant_id', tenantId).eq('id', scheduleId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!schedule) throw new NotFoundException('Maintenance schedule not found');
    if (!schedule.is_active) throw new BadRequestException('Inactive maintenance schedules cannot generate service tickets');
    if (!['DUE', 'OVERDUE'].includes(this.maintenanceStatus(schedule))) throw new BadRequestException('A service ticket can be generated only when maintenance is due or overdue');
    const { data: openTicket } = await this.supabase.from('service_tickets').select('ticket_number, status').eq('tenant_id', tenantId).eq('pm_schedule_id', scheduleId).in('status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PARTS_PENDING']).maybeSingle();
    if (openTicket) throw new BadRequestException(`Maintenance ticket ${openTicket.ticket_number} is already ${openTicket.status}`);
    const { data: asset } = schedule.installed_asset_id
      ? await this.supabase.from('service_installed_assets').select('*').eq('tenant_id', tenantId).eq('id', schedule.installed_asset_id).maybeSingle()
      : { data: null };
    const ticket = await this.createServiceTicket(tenantId, userId, {
      customer_id: schedule.customer_id, uid: schedule.uid, installed_asset_id: schedule.installed_asset_id,
      pm_schedule_id: schedule.id, service_type: 'PAID', priority: 'MEDIUM',
      complaint_description: `Preventive maintenance: ${schedule.schedule_name}${schedule.service_checklist ? `\nChecklist: ${schedule.service_checklist}` : ''}`,
      product_name: asset?.asset_name || schedule.schedule_name, serial_number: asset?.serial_number,
      service_location: asset?.location, expected_completion_date: schedule.next_service_date,
    });
    const { error: updateError } = await this.supabase.from('preventive_maintenance_schedule').update({ last_generated_ticket_id: ticket.id, last_generated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('id', scheduleId);
    if (updateError) {
      await this.supabase.from('service_tickets').delete().eq('tenant_id', tenantId).eq('id', ticket.id);
      throw new BadRequestException(updateError.message);
    }
    return ticket;
  }

  // ==================== Enterprise Service Controls ====================

  async getServiceFailureCodes(tenantId: string, activeOnly = true) {
    let query = this.supabase.from('service_failure_codes').select('*')
      .eq('tenant_id', tenantId).order('category').order('code');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createServiceFailureCode(tenantId: string, userId: string, input: any) {
    const code = String(input?.code || '').trim().toUpperCase();
    const category = String(input?.category || '').trim().toUpperCase();
    const description = String(input?.description || '').trim();
    if (!code || !category || !description) {
      throw new BadRequestException('Failure code, category and description are required');
    }
    const { data, error } = await this.supabase.from('service_failure_codes').insert({
      tenant_id: tenantId, code, category, description,
      default_corrective_action: String(input?.default_corrective_action || '').trim() || null,
      is_active: input?.is_active !== false, created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? `Failure code ${code} already exists` : error.message);
    return data;
  }

  async updateServiceFailureCode(tenantId: string, failureCodeId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_failure_codes').select('*')
      .eq('tenant_id', tenantId).eq('id', failureCodeId).maybeSingle();
    if (!existing) throw new NotFoundException('Failure code not found');
    const update: any = { updated_at: new Date().toISOString() };
    if ('code' in input) update.code = String(input.code || '').trim().toUpperCase();
    if ('category' in input) update.category = String(input.category || '').trim().toUpperCase();
    if ('description' in input) update.description = String(input.description || '').trim();
    if ('default_corrective_action' in input) update.default_corrective_action = String(input.default_corrective_action || '').trim() || null;
    if ('is_active' in input) update.is_active = Boolean(input.is_active);
    if (!String(update.code ?? existing.code).trim() || !String(update.category ?? existing.category).trim() || !String(update.description ?? existing.description).trim()) {
      throw new BadRequestException('Failure code, category and description are required');
    }
    const { data, error } = await this.supabase.from('service_failure_codes').update(update)
      .eq('tenant_id', tenantId).eq('id', failureCodeId).select().single();
    if (error) throw new BadRequestException(error.code === '23505' ? 'Failure code already exists' : error.message);
    return data;
  }

  async deleteServiceFailureCode(tenantId: string, failureCodeId: string) {
    const { count } = await this.supabase.from('service_confirmations').select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('failure_code_id', failureCodeId);
    if ((count || 0) > 0) {
      const { data, error } = await this.supabase.from('service_failure_codes')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', failureCodeId).select().single();
      if (error) throw new BadRequestException(error.message);
      return { ...data, message: 'Failure code has service history and was deactivated' };
    }
    const { error } = await this.supabase.from('service_failure_codes').delete()
      .eq('tenant_id', tenantId).eq('id', failureCodeId);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Failure code deleted' };
  }

  async getServiceEscalations(tenantId: string, filters: any = {}) {
    let query = this.supabase.from('service_escalations')
      .select('*, ticket:service_tickets(id, ticket_number, status, priority, customer:customers(customer_name))')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
    if (filters.ticket_id) query = query.eq('service_ticket_id', filters.ticket_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createServiceEscalation(tenantId: string, userId: string, ticketId: string, input: any) {
    const { data: ticket } = await this.supabase.from('service_tickets').select('id, ticket_number, status')
      .eq('tenant_id', tenantId).eq('id', ticketId).maybeSingle();
    if (!ticket) throw new NotFoundException('Service ticket not found');
    if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(String(ticket.status).toUpperCase())) {
      throw new BadRequestException('A completed or cancelled service ticket cannot be escalated');
    }
    const escalationLevel = Number(input?.escalation_level || 1);
    const reason = String(input?.reason || '').trim();
    if (!Number.isInteger(escalationLevel) || escalationLevel < 1 || escalationLevel > 5) throw new BadRequestException('Escalation level must be between 1 and 5');
    if (!reason) throw new BadRequestException('Escalation reason is required');
    const dueAt = input?.due_at ? new Date(input.due_at) : null;
    if (dueAt && (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now())) throw new BadRequestException('Escalation due date must be in the future');
    const { data, error } = await this.supabase.from('service_escalations').insert({
      tenant_id: tenantId, service_ticket_id: ticketId, escalation_level: escalationLevel,
      reason, owner_user_id: input?.owner_user_id || null, due_at: dueAt?.toISOString() || null,
      status: 'OPEN', created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateServiceEscalation(tenantId: string, escalationId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_escalations').select('*')
      .eq('tenant_id', tenantId).eq('id', escalationId).maybeSingle();
    if (!existing) throw new NotFoundException('Service escalation not found');
    const current = String(existing.status).toUpperCase();
    const next = String(input?.status || current).toUpperCase();
    const transitions: Record<string, string[]> = {
      OPEN: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
      ACKNOWLEDGED: ['ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'],
      RESOLVED: ['RESOLVED'], CANCELLED: ['CANCELLED'],
    };
    if (!transitions[current]?.includes(next)) throw new BadRequestException(`Escalation cannot move from ${current} to ${next}`);
    const resolutionNotes = String(input?.resolution_notes ?? existing.resolution_notes ?? '').trim() || null;
    if (next === 'RESOLVED' && !resolutionNotes) throw new BadRequestException('Resolution notes are required to resolve an escalation');
    const update: any = {
      status: next, resolution_notes: resolutionNotes,
      owner_user_id: 'owner_user_id' in input ? input.owner_user_id || null : existing.owner_user_id,
      due_at: 'due_at' in input ? input.due_at || null : existing.due_at,
      updated_at: new Date().toISOString(), resolved_at: next === 'RESOLVED' ? new Date().toISOString() : null,
    };
    const { data, error } = await this.supabase.from('service_escalations').update(update)
      .eq('tenant_id', tenantId).eq('id', escalationId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getTechnicianCapacity(tenantId: string, dateValue?: string) {
    const date = String(dateValue || this.getCurrentBusinessDate()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Capacity date must be YYYY-MM-DD');
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    const [{ data: technicians, error: technicianError }, { data: assignments, error: assignmentError }, { data: unavailable, error: unavailableError }] = await Promise.all([
      this.supabase.from('technicians').select('*').eq('tenant_id', tenantId).eq('is_active', true).order('technician_name'),
      this.supabase.from('service_assignments')
        .select('*, ticket:service_tickets!inner(id, tenant_id, ticket_number, priority, status, service_location)')
        .eq('ticket.tenant_id', tenantId)
        .not('status', 'in', '(COMPLETED,REASSIGNED,CANCELLED)'),
      this.supabase.from('service_technician_unavailability').select('*').eq('tenant_id', tenantId)
        .lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString()),
    ]);
    if (technicianError) throw new BadRequestException(technicianError.message);
    if (assignmentError) throw new BadRequestException(assignmentError.message);
    if (unavailableError) throw new BadRequestException(unavailableError.message);
    return (technicians || []).map((technician: any) => {
      const rows = (assignments || []).filter((row: any) => row.technician_id === technician.id && this.assignmentTouchesDate(row, date));
      const bookedHours = rows.reduce((sum: number, row: any) => {
        const start = row.scheduled_start_at ? new Date(row.scheduled_start_at).getTime() : row.actual_start_date ? new Date(row.actual_start_date).getTime() : Number.NaN;
        const end = row.scheduled_end_at ? new Date(row.scheduled_end_at).getTime() : row.actual_end_date ? new Date(row.actual_end_date).getTime() : Number.NaN;
        return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 3600000 : 8);
      }, 0);
      const technicianBlocks = (unavailable || []).filter((row: any) => row.technician_id === technician.id);
      const weekday = dayStart.getUTCDay();
      const isWorkingDay = this.validateWorkingDays(technician.working_days).includes(weekday);
      const blockedHours = technicianBlocks.reduce((sum: number, row: any) => {
        const start = Math.max(dayStart.getTime(), new Date(row.starts_at).getTime());
        const end = Math.min(dayEnd.getTime(), new Date(row.ends_at).getTime());
        return sum + Math.max(0, end - start) / 3600000;
      }, 0);
      const nominalCapacity = isWorkingDay ? Number(technician.daily_capacity_hours || 8) : 0;
      const capacity = Math.max(0, nominalCapacity - blockedHours);
      return {
        ...technician, capacity_date: date, booked_hours: Math.round(bookedHours * 100) / 100,
        available_hours: Math.round(Math.max(0, capacity - bookedHours) * 100) / 100,
        utilization_percent: capacity > 0 ? Math.round((bookedHours / capacity) * 10000) / 100 : 0,
        blocked_hours: Math.round(blockedHours * 100) / 100, is_working_day: isWorkingDay,
        is_overbooked: bookedHours > capacity, assignments: rows, unavailability: technicianBlocks,
      };
    });
  }

  async getTechnicianCalendar(tenantId: string, technicianId: string, fromValue?: string, toValue?: string) {
    const from = String(fromValue || this.getCurrentBusinessDate());
    const to = String(toValue || from);
    const { data: technician } = await this.supabase.from('technicians').select('*').eq('tenant_id', tenantId).eq('id', technicianId).maybeSingle();
    if (!technician) throw new NotFoundException('Technician not found');
    const fromAt = new Date(`${from}T00:00:00.000Z`).toISOString();
    const toAt = new Date(`${to}T23:59:59.999Z`).toISOString();
    const [{ data: assignments, error: assignmentError }, { data: unavailability, error: unavailableError }] = await Promise.all([
      this.supabase.from('service_assignments').select('*, ticket:service_tickets!inner(id, tenant_id, ticket_number, priority, status, service_location)')
        .eq('ticket.tenant_id', tenantId).eq('technician_id', technicianId),
      this.supabase.from('service_technician_unavailability').select('*').eq('tenant_id', tenantId).eq('technician_id', technicianId)
        .lt('starts_at', toAt).gt('ends_at', fromAt).order('starts_at'),
    ]);
    if (assignmentError) throw new BadRequestException(assignmentError.message);
    if (unavailableError) throw new BadRequestException(unavailableError.message);
    const visibleAssignments = (assignments || []).filter((row: any) => {
      if (row.scheduled_start_at && row.scheduled_end_at) {
        return new Date(row.scheduled_start_at).getTime() < new Date(toAt).getTime()
          && new Date(row.scheduled_end_at).getTime() > new Date(fromAt).getTime();
      }
      return (!row.scheduled_start_date || row.scheduled_start_date <= to)
        && (!row.scheduled_end_date || row.scheduled_end_date >= from);
    });
    return { technician, from, to, assignments: visibleAssignments, unavailability: unavailability || [] };
  }

  async createTechnicianUnavailability(tenantId: string, userId: string, technicianId: string, input: any) {
    const { data: technician } = await this.supabase.from('technicians').select('id').eq('tenant_id', tenantId).eq('id', technicianId).maybeSingle();
    if (!technician) throw new NotFoundException('Technician not found');
    const startsAt = new Date(input?.starts_at);
    const endsAt = new Date(input?.ends_at);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Enter a valid unavailability start and end');
    }
    const reason = String(input?.reason || 'LEAVE').toUpperCase();
    if (!['LEAVE', 'TRAINING', 'TRAVEL', 'WEEKLY_OFF', 'OTHER'].includes(reason)) throw new BadRequestException('Invalid unavailability reason');
    const { data: overlapping } = await this.supabase.from('service_assignments').select('id, ticket:service_tickets!inner(tenant_id, ticket_number)')
      .eq('ticket.tenant_id', tenantId).eq('technician_id', technicianId)
      .not('status', 'in', '(COMPLETED,REASSIGNED,CANCELLED)')
      .lt('scheduled_start_at', endsAt.toISOString()).gt('scheduled_end_at', startsAt.toISOString()).limit(1);
    if ((overlapping || []).length) throw new BadRequestException('The technician has an active appointment during this period');
    const { data, error } = await this.supabase.from('service_technician_unavailability').insert({
      tenant_id: tenantId, technician_id: technicianId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      reason, notes: String(input?.notes || '').trim() || null, created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.code === '23P01' ? 'This period overlaps another unavailability entry' : error.message);
    return data;
  }

  async deleteTechnicianUnavailability(tenantId: string, entryId: string) {
    const { data, error } = await this.supabase.from('service_technician_unavailability').delete()
      .eq('tenant_id', tenantId).eq('id', entryId).select('id').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Technician unavailability entry not found');
    return { success: true };
  }

  async getServiceRmaOrders(tenantId: string, filters: any = {}) {
    let query = this.supabase.from('service_rma_orders')
      .select('*, ticket:service_tickets(id, ticket_number, status, product_name, serial_number, uid, customer:customers(customer_name)), installed_asset:service_installed_assets(asset_number, asset_name, serial_number)')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (filters.status) query = query.eq('status', String(filters.status).toUpperCase());
    if (filters.ticket_id) query = query.eq('service_ticket_id', filters.ticket_id);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async createServiceRmaOrder(tenantId: string, userId: string, input: any) {
    const ticketId = String(input?.service_ticket_id || '').trim();
    const { data: ticket } = await this.supabase.from('service_tickets').select('id, installed_asset_id')
      .eq('tenant_id', tenantId).eq('id', ticketId).maybeSingle();
    if (!ticket) throw new BadRequestException('Select a valid service ticket');
    const disposition = String(input?.disposition || 'REPAIR').toUpperCase();
    if (!['REPAIR', 'REPLACE', 'RETURN_UNREPAIRED', 'SCRAP'].includes(disposition)) throw new BadRequestException('Invalid RMA disposition');
    const receivedDate = String(input?.received_date || '').trim() || null;
    if (receivedDate && receivedDate > this.getCurrentBusinessDate()) throw new BadRequestException('RMA received date cannot be in the future');
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_RMA');
    const rmaNumber = `RMA-${year}-${String(sequence).padStart(6, '0')}`;
    const { data, error } = await this.supabase.from('service_rma_orders').insert({
      tenant_id: tenantId, rma_number: rmaNumber, service_ticket_id: ticketId,
      installed_asset_id: input?.installed_asset_id || ticket.installed_asset_id || null,
      received_date: receivedDate, received_condition: String(input?.received_condition || '').trim() || null,
      repair_location: String(input?.repair_location || '').trim() || null, disposition,
      status: receivedDate ? 'RECEIVED' : 'AWAITING_RECEIPT', notes: String(input?.notes || '').trim() || null,
      created_by: userId,
    }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateServiceRmaOrder(tenantId: string, rmaId: string, input: any) {
    const { data: existing } = await this.supabase.from('service_rma_orders').select('*')
      .eq('tenant_id', tenantId).eq('id', rmaId).maybeSingle();
    if (!existing) throw new NotFoundException('RMA order not found');
    const current = String(existing.status).toUpperCase();
    const next = String(input?.status || current).toUpperCase();
    const transitions: Record<string, string[]> = {
      AWAITING_RECEIPT: ['AWAITING_RECEIPT', 'RECEIVED', 'CANCELLED'],
      RECEIVED: ['RECEIVED', 'UNDER_DIAGNOSIS', 'CANCELLED'],
      UNDER_DIAGNOSIS: ['UNDER_DIAGNOSIS', 'UNDER_REPAIR', 'READY_TO_RETURN'],
      UNDER_REPAIR: ['UNDER_REPAIR', 'READY_TO_RETURN'],
      READY_TO_RETURN: ['READY_TO_RETURN', 'RETURNED'], RETURNED: ['RETURNED'], CANCELLED: ['CANCELLED'],
    };
    if (!transitions[current]?.includes(next)) throw new BadRequestException(`RMA cannot move from ${current} to ${next}`);
    const disposition = 'disposition' in input ? String(input.disposition || '').toUpperCase() : String(existing.disposition || 'REPAIR').toUpperCase();
    if (!['REPAIR', 'REPLACE', 'RETURN_UNREPAIRED', 'SCRAP'].includes(disposition)) {
      throw new BadRequestException('Invalid RMA disposition');
    }
    const update: any = {
      status: next, updated_at: new Date().toISOString(),
      received_date: 'received_date' in input ? input.received_date || null : existing.received_date,
      received_condition: 'received_condition' in input ? String(input.received_condition || '').trim() || null : existing.received_condition,
      repair_location: 'repair_location' in input ? String(input.repair_location || '').trim() || null : existing.repair_location,
      disposition,
      outbound_date: 'outbound_date' in input ? input.outbound_date || null : existing.outbound_date,
      courier_reference: 'courier_reference' in input ? String(input.courier_reference || '').trim() || null : existing.courier_reference,
      notes: 'notes' in input ? String(input.notes || '').trim() || null : existing.notes,
    };
    if (next === 'RECEIVED' && !update.received_date) update.received_date = this.getCurrentBusinessDate();
    if (update.received_date && update.received_date > this.getCurrentBusinessDate()) throw new BadRequestException('RMA received date cannot be in the future');
    if (update.outbound_date && update.received_date && update.outbound_date < update.received_date) throw new BadRequestException('RMA return date cannot be before its received date');
    if (update.outbound_date && update.outbound_date > this.getCurrentBusinessDate()) throw new BadRequestException('RMA return date cannot be in the future');
    if (next === 'RETURNED' && (!update.outbound_date || !update.courier_reference)) throw new BadRequestException('Return date and courier reference are required to complete an RMA');
    const { data, error } = await this.supabase.from('service_rma_orders').update(update)
      .eq('tenant_id', tenantId).eq('id', rmaId).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ==================== Mobile / Offline Field Sync ====================

  async getMobileBootstrap(tenantId: string, filters: any = {}) {
    const technicianId = String(filters?.technician_id || '').trim();
    if (!technicianId) throw new BadRequestException('technician_id is required');
    const since = filters?.since ? new Date(filters.since) : null;
    if (since && Number.isNaN(since.getTime())) throw new BadRequestException('since must be a valid date-time');
    const { data: technician } = await this.supabase.from('service_technicians').select('*').eq('tenant_id', tenantId).eq('id', technicianId).maybeSingle();
    if (!technician) throw new BadRequestException('Select a valid technician');
    let assignmentQuery = this.supabase.from('service_assignments')
      .select('*, ticket:service_tickets(*, customer:customers(id, customer_code, customer_name, contact_person, mobile, email), installed_asset:service_installed_assets(*))')
      .eq('tenant_id', tenantId).eq('technician_id', technicianId).order('scheduled_start_at', { ascending: true });
    if (since) assignmentQuery = assignmentQuery.gte('updated_at', since.toISOString());
    const { data: assignments, error } = await assignmentQuery;
    if (error) throw new BadRequestException(error.message);
    const ticketIds = (assignments || []).map((row: any) => row.service_ticket_id).filter(Boolean);
    const [{ data: visits }, { data: checklist }, { data: parts }] = await Promise.all([
      ticketIds.length ? this.supabase.from('service_site_visits').select('*').eq('tenant_id', tenantId).in('service_ticket_id', ticketIds) : Promise.resolve({ data: [] }),
      ticketIds.length ? this.supabase.from('service_ticket_checklist_items').select('*').eq('tenant_id', tenantId).in('service_ticket_id', ticketIds) : Promise.resolve({ data: [] }),
      ticketIds.length ? this.supabase.from('service_parts_used').select('*').in('service_ticket_id', ticketIds) : Promise.resolve({ data: [] }),
    ]);
    return { generated_at: new Date().toISOString(), technician, assignments: assignments || [], visits: visits || [], checklist: checklist || [], parts: parts || [] };
  }

  async syncMobileEvents(tenantId: string, userId: string, input: any) {
    const events = Array.isArray(input?.events) ? input.events : [];
    if (!events.length || events.length > 100) throw new BadRequestException('Provide between 1 and 100 mobile sync events');
    const results: any[] = [];
    for (const event of events) {
      const key = String(event?.idempotency_key || '').trim();
      if (!key) { results.push({ status: 'FAILED', error: 'idempotency_key is required' }); continue; }
      const { data: prior } = await this.supabase.from('service_mobile_sync_events').select('*').eq('tenant_id', tenantId).eq('idempotency_key', key).maybeSingle();
      if (prior) { results.push({ idempotency_key: key, status: prior.status, entity_id: prior.entity_id, duplicate: true, error: prior.error_message }); continue; }
      const operation = String(event?.operation || '').toUpperCase();
      const eventRow: any = { tenant_id: tenantId, idempotency_key: key, technician_id: event?.technician_id || null, entity_type: String(event?.entity_type || operation), entity_id: event?.entity_id || null, operation, payload: event?.payload || {}, client_created_at: event?.client_created_at || null, created_by: userId };
      const { data: inserted, error: insertError } = await this.supabase.from('service_mobile_sync_events').insert(eventRow).select().single();
      if (insertError) { results.push({ idempotency_key: key, status: 'FAILED', error: insertError.message }); continue; }
      try {
        let applied: any;
        if (operation === 'VISIT_CHECK_IN') applied = await this.checkInServiceVisit(tenantId, userId, String(event.entity_id || ''), event.payload || {});
        else if (operation === 'VISIT_CHECK_OUT') applied = await this.checkOutServiceVisit(tenantId, userId, String(event.entity_id || ''), event.payload || {});
        else if (operation === 'METER_READING') applied = await this.recordAssetMeterReading(tenantId, userId, String(event.entity_id || ''), { ...(event.payload || {}), source: 'SERVICE_VISIT' });
        else throw new BadRequestException(`Unsupported mobile operation ${operation}`);
        await this.supabase.from('service_mobile_sync_events').update({ status: 'APPLIED', applied_at: new Date().toISOString(), entity_id: applied?.id || event.entity_id || null }).eq('id', inserted.id);
        results.push({ idempotency_key: key, status: 'APPLIED', result: applied });
      } catch (error: any) {
        const message = error?.message || 'Mobile event could not be applied';
        await this.supabase.from('service_mobile_sync_events').update({ status: 'FAILED', error_message: message }).eq('id', inserted.id);
        results.push({ idempotency_key: key, status: 'FAILED', error: message });
      }
    }
    return { synchronized_at: new Date().toISOString(), results };
  }

  async createCustomerPortalLink(tenantId: string, userId: string, ticketId: string) {
    await this.getOwnedTicket(tenantId, ticketId);
    const { data, error } = await this.supabase.from('service_customer_portal_tokens').insert({ tenant_id: tenantId, service_ticket_id: ticketId, created_by: userId }).select('token, expires_at').single();
    if (error) throw new BadRequestException(error.message);
    const baseUrl = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return { ...data, portal_url: `${baseUrl}/service/track/${data.token}` };
  }

  async getCustomerPortalTicket(token: string) {
    const { data: access } = await this.supabase.from('service_customer_portal_tokens').select('*').eq('token', token).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!access) throw new NotFoundException('This service tracking link is invalid or has expired');
    const [{ data: ticket }, { data: assignments }, { data: visits }, { data: updates }] = await Promise.all([
      this.supabase.from('service_tickets').select('id, ticket_number, complaint_date, service_type, priority, status, product_name, serial_number, uid, problem_description, expected_completion_date, actual_completion_date, customer:customers(customer_name)').eq('tenant_id', access.tenant_id).eq('id', access.service_ticket_id).single(),
      this.supabase.from('service_assignments').select('status, scheduled_start_at, scheduled_end_at, technician:service_technicians(technician_name)').eq('tenant_id', access.tenant_id).eq('service_ticket_id', access.service_ticket_id).order('created_at'),
      this.supabase.from('service_site_visits').select('status, checked_in_at, checked_out_at, customer_contact_name, work_summary').eq('tenant_id', access.tenant_id).eq('service_ticket_id', access.service_ticket_id).order('created_at'),
      this.supabase.from('service_customer_portal_updates').select('update_type, customer_name, message, created_at').eq('tenant_id', access.tenant_id).eq('service_ticket_id', access.service_ticket_id).order('created_at', { ascending: false }),
    ]);
    if (!ticket) throw new NotFoundException('Service ticket not found');
    return { ticket, assignments: assignments || [], visits: visits || [], customer_updates: updates || [], link_expires_at: access.expires_at };
  }

  async addCustomerPortalUpdate(token: string, input: any) {
    const portal = await this.getCustomerPortalTicket(token);
    const message = String(input?.message || '').trim();
    if (!message || message.length > 2000) throw new BadRequestException('Enter a message of up to 2,000 characters');
    const type = String(input?.update_type || 'COMMENT').toUpperCase();
    if (!['COMMENT', 'APPROVAL', 'QUERY'].includes(type)) throw new BadRequestException('Invalid customer update type');
    const { data: access } = await this.supabase.from('service_customer_portal_tokens').select('tenant_id, service_ticket_id').eq('token', token).single();
    const { data, error } = await this.supabase.from('service_customer_portal_updates').insert({ tenant_id: access.tenant_id, service_ticket_id: access.service_ticket_id, update_type: type, customer_name: String(input?.customer_name || '').trim() || null, customer_email: String(input?.customer_email || '').trim() || null, message }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ==================== Reports ====================

  async getServiceReports(tenantId: string, filters?: any) {
    // Get open vs closed tickets
    const { data: statusCounts, error: statusError } = await this.supabase
      .from('service_tickets')
      .select('id, status, uid, complaint_date, resolved_at, actual_cost, parts_cost, labor_cost')
      .eq('tenant_id', tenantId);

    if (statusError) throw new BadRequestException(statusError.message);

    const activeStatuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PARTS_PENDING'];
    const openCount = statusCounts.filter(t => activeStatuses.includes(t.status)).length;
    const closedCount = statusCounts.filter(t => ['COMPLETED', 'CLOSED'].includes(t.status)).length;

    // Get warranty claim costs
    const { data: warrantyClaims, error: claimsError } = await this.supabase
      .from('service_tickets')
      .select('actual_cost, parts_cost, labor_cost')
      .eq('tenant_id', tenantId)
      .eq('service_type', 'WARRANTY');

    if (claimsError) throw new BadRequestException(claimsError.message);

    const totalWarrantyCost = warrantyClaims.reduce((sum, claim) => sum + (claim.actual_cost || 0), 0);
    const totalWarrantyPartsCost = warrantyClaims.reduce((sum, claim) => sum + (claim.parts_cost || 0), 0);

    // Get top issues (product reliability)
    const { data: tickets, error: ticketsError } = await this.supabase
      .from('service_tickets')
      .select('product_name, uid')
      .eq('tenant_id', tenantId);

    if (ticketsError) throw new BadRequestException(ticketsError.message);

    const productIssues: Record<string, number> = {};
    tickets.forEach(t => {
      if (t.product_name) {
        productIssues[t.product_name] = (productIssues[t.product_name] || 0) + 1;
      }
    });

    const { data: slaTickets, error: slaError } = await this.supabase
      .from('service_tickets')
      .select('id, ticket_number, priority, status, response_due_at, resolution_due_at, response_acknowledged_at, resolved_at')
      .eq('tenant_id', tenantId)
      .in('status', activeStatuses);
    if (slaError) throw new BadRequestException(slaError.message);

    const now = Date.now();
    const evaluatedSlaTickets = (slaTickets || []).map((ticket: any) => ({
      ...ticket,
      sla: this.calculateTicketSla(ticket, now),
    }));
    const responseBreaches = evaluatedSlaTickets.filter((ticket: any) => ticket.sla.response_status === 'BREACHED');
    const resolutionBreaches = evaluatedSlaTickets.filter((ticket: any) => ticket.sla.resolution_status === 'BREACHED');

    const today = new Date().toISOString().slice(0, 10);
    const expiryLimit = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const [{ data: assets, error: assetsError }, { data: contracts, error: contractsError }, { data: feedback, error: feedbackError }, { data: visits, error: visitsError }, { data: invoices, error: invoicesError }] = await Promise.all([
      this.supabase.from('service_installed_assets').select('status').eq('tenant_id', tenantId),
      this.supabase.from('service_contracts').select('contract_number, status, start_date, end_date, customer:customers(customer_name)').eq('tenant_id', tenantId),
      this.supabase.from('service_feedback').select('overall_rating, would_recommend').eq('tenant_id', tenantId),
      this.supabase.from('service_site_visits').select('service_ticket_id').eq('tenant_id', tenantId).eq('status', 'COMPLETED'),
      this.supabase.from('customer_service_invoices').select('service_ticket_id, net_amount, balance_amount, payment_status').eq('tenant_id', tenantId).neq('billing_status', 'CANCELLED'),
    ]);
    if (assetsError) throw new BadRequestException(assetsError.message);
    if (contractsError) throw new BadRequestException(contractsError.message);
    if (feedbackError) throw new BadRequestException(feedbackError.message);
    if (visitsError) throw new BadRequestException(visitsError.message);
    if (invoicesError) throw new BadRequestException(invoicesError.message);
    const activeContracts = (contracts || []).filter((contract: any) => contract.status === 'ACTIVE' && contract.start_date <= today && contract.end_date >= today);
    const expiringContracts = activeContracts.filter((contract: any) => contract.end_date <= expiryLimit);
    const completedTickets = statusCounts.filter((ticket: any) => ['COMPLETED', 'CLOSED'].includes(ticket.status));
    const resolvedDurations = completedTickets.map((ticket: any) => ticket.complaint_date && ticket.resolved_at ? (new Date(ticket.resolved_at).getTime() - new Date(ticket.complaint_date).getTime()) / 3600000 : null).filter((value: any) => Number.isFinite(value) && value >= 0) as number[];
    const visitCounts = new Map<string, number>();
    for (const visit of visits || []) visitCounts.set(visit.service_ticket_id, (visitCounts.get(visit.service_ticket_id) || 0) + 1);
    const uidCounts = new Map<string, number>();
    for (const ticket of statusCounts as any[]) if (ticket.uid) uidCounts.set(ticket.uid, (uidCounts.get(ticket.uid) || 0) + 1);
    const totalRevenue = (invoices || []).reduce((sum: number, invoice: any) => sum + Number(invoice.net_amount || 0), 0);
    const totalActualCost = statusCounts.reduce((sum: number, ticket: any) => sum + Number(ticket.actual_cost || ticket.parts_cost || 0) + (ticket.actual_cost ? 0 : Number(ticket.labor_cost || 0)), 0);

    return {
      open_tickets: openCount,
      closed_tickets: closedCount,
      total_tickets: statusCounts.length,
      warranty_claims_count: warrantyClaims.length,
      warranty_claims_cost: totalWarrantyCost,
      warranty_parts_cost: totalWarrantyPartsCost,
      installed_base: {
        total_assets: (assets || []).length,
        active_assets: (assets || []).filter((asset: any) => asset.status === 'ACTIVE').length,
      },
      contracts: {
        total_contracts: (contracts || []).length,
        active_contracts: activeContracts.length,
        expiring_within_30_days: expiringContracts.map((contract: any) => ({
          contract_number: contract.contract_number,
          customer_name: contract.customer?.customer_name || '-',
          end_date: contract.end_date,
        })),
      },
      sla: {
        active_tickets: evaluatedSlaTickets.length,
        response_overdue: responseBreaches.length,
        resolution_overdue: resolutionBreaches.length,
        overdue_tickets: evaluatedSlaTickets.filter((ticket: any) => ticket.sla.overall_status === 'BREACHED').map((ticket: any) => ({
          ticket_number: ticket.ticket_number,
          priority: ticket.priority,
          status: ticket.status,
          response_due_at: ticket.response_due_at,
          resolution_due_at: ticket.resolution_due_at,
          response_status: ticket.sla.response_status,
          resolution_status: ticket.sla.resolution_status,
        })),
      },
      customer_satisfaction: {
        responses: (feedback || []).length,
        average_rating: (feedback || []).length
          ? this.roundAmount((feedback || []).reduce((sum: number, row: any) => sum + Number(row.overall_rating || 0), 0) / (feedback || []).length)
          : null,
        recommend_percentage: (feedback || []).length
          ? this.roundAmount(((feedback || []).filter((row: any) => row.would_recommend === true).length / (feedback || []).length) * 100)
          : null,
      },
      operational_kpis: {
        mean_time_to_resolve_hours: resolvedDurations.length ? this.roundAmount(resolvedDurations.reduce((sum, value) => sum + value, 0) / resolvedDurations.length) : null,
        first_time_fix_percentage: completedTickets.length ? this.roundAmount((completedTickets.filter((ticket: any) => (visitCounts.get(ticket.id) || 0) <= 1).length / completedTickets.length) * 100) : null,
        repeat_failure_assets: [...uidCounts.entries()].filter(([, count]) => count > 1).map(([uid, count]) => ({ uid, ticket_count: count })).sort((a, b) => b.ticket_count - a.ticket_count).slice(0, 10),
      },
      profitability: {
        service_revenue: this.roundAmount(totalRevenue),
        actual_service_cost: this.roundAmount(totalActualCost),
        gross_margin: this.roundAmount(totalRevenue - totalActualCost),
        gross_margin_percentage: totalRevenue > 0 ? this.roundAmount(((totalRevenue - totalActualCost) / totalRevenue) * 100) : null,
        outstanding_receivables: this.roundAmount((invoices || []).filter((invoice: any) => invoice.payment_status !== 'PAID').reduce((sum: number, invoice: any) => sum + Number(invoice.balance_amount || 0), 0)),
      },
      product_reliability: Object.entries(productIssues)
        .map(([product, count]) => ({ product, issue_count: count }))
        .sort((a, b) => b.issue_count - a.issue_count)
        .slice(0, 10),
    };
  }

  // ==================== Helper Methods ====================

  private getWarrantyAdjustedLaborRate(ticket: any, requestedLaborRate: number) {
    const warrantyCovered = Boolean(ticket?.is_under_warranty)
      || String(ticket?.entitlement_status || '').toUpperCase() === 'WARRANTY'
      || String(ticket?.service_type || '').toUpperCase() === 'WARRANTY';
    return warrantyCovered ? 0 : requestedLaborRate;
  }

  private validateServiceFeedbackInput(input: any) {
    const rating = (field: string, required = false) => {
      const raw = input?.[field];
      if (raw === '' || raw == null) {
        if (required) throw new BadRequestException('Overall customer rating is required');
        return null;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new BadRequestException('Customer satisfaction ratings must be whole numbers from 1 to 5');
      }
      return value;
    };
    return {
      overall_rating: rating('overall_rating', true),
      technician_rating: rating('technician_rating'),
      response_time_rating: rating('response_time_rating'),
      quality_rating: rating('quality_rating'),
      feedback_text: String(input?.feedback_text || '').trim() || null,
      suggestions: String(input?.suggestions || '').trim() || null,
      would_recommend: typeof input?.would_recommend === 'boolean' ? input.would_recommend : null,
    };
  }

  private getSlaTargets(priority: string, serviceType: string) {
    // Hours are deliberately conservative defaults.  They are recorded on the
    // ticket and may be replaced by a per-contract SLA in the next layer.
    const priorityKey = String(priority || 'MEDIUM').toUpperCase();
    const standard: Record<string, { responseHours: number; resolutionHours: number }> = {
      CRITICAL: { responseHours: 4, resolutionHours: 24 },
      HIGH: { responseHours: 8, resolutionHours: 48 },
      MEDIUM: { responseHours: 24, resolutionHours: 72 },
      LOW: { responseHours: 48, resolutionHours: 120 },
    };
    const target = standard[priorityKey] || standard.MEDIUM;
    // Warranty claims follow the same operational response commitment; pricing
    // is handled independently by the billable/non-billable service flow.
    void serviceType;
    return target;
  }

  private calculateTicketSla(ticket: any, nowValue = Date.now()) {
    const ticketStatus = String(ticket?.status || '').toUpperCase();
    const terminal = ['COMPLETED', 'CLOSED'].includes(ticketStatus);
    const cancelled = ticketStatus === 'CANCELLED';
    const evaluate = (dueValue: any, actualValue: any) => {
      const due = dueValue ? new Date(dueValue).getTime() : Number.NaN;
      const actual = actualValue ? new Date(actualValue).getTime() : Number.NaN;
      if (!Number.isFinite(due)) return { status: 'NOT_SET', remaining_minutes: null };
      if (Number.isFinite(actual)) {
        return {
          status: actual <= due ? 'MET' : 'BREACHED',
          remaining_minutes: Math.round((due - actual) / 60000),
        };
      }
      return {
        status: nowValue <= due ? 'PENDING' : 'BREACHED',
        remaining_minutes: Math.round((due - nowValue) / 60000),
      };
    };
    // Historical completed tickets may pre-date explicit acknowledgement
    // capture. Their persisted resolution is the latest defensible response
    // timestamp, preventing a closed document from appearing perpetually pending.
    const responseActual = ticket?.response_acknowledged_at || (terminal ? ticket?.resolved_at : null);
    const response = evaluate(ticket?.response_due_at, responseActual);
    const resolution = evaluate(ticket?.resolution_due_at, ticket?.resolved_at);
    const overallStatus = cancelled
      ? 'CANCELLED'
      : response.status === 'BREACHED' || resolution.status === 'BREACHED'
        ? 'BREACHED'
        : response.status === 'NOT_SET' || resolution.status === 'NOT_SET'
          ? 'NOT_SET'
          : terminal ? 'MET' : 'ON_TRACK';
    return {
      response_status: response.status,
      resolution_status: resolution.status,
      overall_status: overallStatus,
      response_remaining_minutes: response.remaining_minutes,
      resolution_remaining_minutes: resolution.remaining_minutes,
    };
  }

  private async generateTicketNumber(tenantId: string): Promise<string> {
    void tenantId;
    const nextNumber = await this.nextServiceDocumentSequence('SERVICE_TICKET');
    return `ST-${String(nextNumber).padStart(6, '0')}`;
  }

  private async generateTechnicianCode(tenantId: string): Promise<string> {
    void tenantId;
    const nextNumber = await this.nextServiceDocumentSequence('TECHNICIAN');
    return `TECH-${String(nextNumber).padStart(4, '0')}`;
  }

  private async generateInstalledAssetNumber(tenantId: string): Promise<string> {
    void tenantId;
    const sequence = await this.nextServiceDocumentSequence('INSTALLED_ASSET');
    return `AST-${String(sequence).padStart(6, '0')}`;
  }

  private async generateServiceContractNumber(tenantId: string): Promise<string> {
    void tenantId;
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_CONTRACT');
    return `SC-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private roundAmount(value: any) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) throw new BadRequestException('Invalid amount');
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  private getCurrentBusinessDate() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  private validateDailyCapacity(value: any) {
    const hours = value === '' || value === undefined || value === null ? 8 : Number(value);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      throw new BadRequestException('Daily technician capacity must be greater than 0 and no more than 24 hours');
    }
    return Math.round(hours * 100) / 100;
  }

  private normalizeTextList(value: any): string[] {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return Array.from(new Set(values.map((entry: any) => String(entry || '').trim()).filter(Boolean)));
  }

  private validateWorkingDays(value: any): number[] {
    const source = value === undefined || value === null || value === '' ? [1, 2, 3, 4, 5, 6] : value;
    const values = Array.isArray(source) ? source : String(source).split(',');
    const days = Array.from(new Set(values.map((entry: any) => Number(entry))));
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new BadRequestException('Select at least one valid technician working day');
    }
    return days.sort((a, b) => a - b);
  }

  private validateShiftTime(value: any, fallback: string): string {
    const time = String(value || fallback).trim().slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new BadRequestException('Technician shift time must be HH:mm');
    return time;
  }

  private assertValidShift(start: string, end: string) {
    if (start >= end) throw new BadRequestException('Technician shift end must be after shift start');
  }

  private assignmentTouchesDate(row: any, date: string): boolean {
    if (row.scheduled_start_at && row.scheduled_end_at) {
      const start = new Date(row.scheduled_start_at).toISOString().slice(0, 10);
      const end = new Date(row.scheduled_end_at).toISOString().slice(0, 10);
      return start <= date && end >= date;
    }
    return (!row.scheduled_start_date || row.scheduled_start_date <= date)
      && (!row.scheduled_end_date || row.scheduled_end_date >= date);
  }

  private async assertTechnicianAvailability(tenantId: string, technician: any, startValue: any, endValue: any) {
    const startsAt = new Date(startValue);
    const endsAt = new Date(endValue);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Scheduled end must be after scheduled start');
    }
    const workingDays = this.validateWorkingDays(technician.working_days);
    if (!workingDays.includes(startsAt.getDay())) throw new BadRequestException('The selected date is not a working day for this technician');
    const localStart = `${String(startsAt.getHours()).padStart(2, '0')}:${String(startsAt.getMinutes()).padStart(2, '0')}`;
    const localEnd = `${String(endsAt.getHours()).padStart(2, '0')}:${String(endsAt.getMinutes()).padStart(2, '0')}`;
    const shiftStart = this.validateShiftTime(technician.shift_start, '09:00');
    const shiftEnd = this.validateShiftTime(technician.shift_end, '18:00');
    if (localStart < shiftStart || localEnd > shiftEnd) throw new BadRequestException(`Appointment must be within the technician shift (${shiftStart}-${shiftEnd})`);
    const [{ data: assignments, error: assignmentError }, { data: unavailable, error: unavailableError }] = await Promise.all([
      this.supabase.from('service_assignments').select('id, ticket:service_tickets!inner(tenant_id, ticket_number)')
        .eq('ticket.tenant_id', tenantId).eq('technician_id', technician.id)
        .not('status', 'in', '(COMPLETED,REASSIGNED,CANCELLED)')
        .lt('scheduled_start_at', endsAt.toISOString()).gt('scheduled_end_at', startsAt.toISOString()).limit(1),
      this.supabase.from('service_technician_unavailability').select('id, reason').eq('tenant_id', tenantId).eq('technician_id', technician.id)
        .lt('starts_at', endsAt.toISOString()).gt('ends_at', startsAt.toISOString()).limit(1),
    ]);
    if (assignmentError) throw new BadRequestException(assignmentError.message);
    if (unavailableError) throw new BadRequestException(unavailableError.message);
    if ((assignments || []).length) throw new BadRequestException('Technician already has an appointment during this period');
    if ((unavailable || []).length) throw new BadRequestException(`Technician is unavailable (${unavailable?.[0]?.reason || 'blocked'}) during this period`);
  }

  private validateServiceInvoiceDates(invoiceDateValue: any, dueDateValue: any, confirmationDateValue: any) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const isRealDate = (value: string) => {
      if (!datePattern.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    const invoiceDate = String(invoiceDateValue || this.getCurrentBusinessDate()).trim();
    const dueDate = String(dueDateValue || '').trim() || null;
    const confirmationDate = String(confirmationDateValue || '').slice(0, 10);
    if (!isRealDate(invoiceDate)) throw new BadRequestException('Service invoice date must be a valid date');
    if (invoiceDate > this.getCurrentBusinessDate()) throw new BadRequestException('Service invoice date cannot be in the future');
    if (confirmationDate && isRealDate(confirmationDate) && invoiceDate < confirmationDate) throw new BadRequestException('Service invoice date cannot be before the confirmation date');
    if (dueDate && !isRealDate(dueDate)) throw new BadRequestException('Service invoice due date must be a valid date');
    if (dueDate && dueDate < invoiceDate) throw new BadRequestException('Service invoice due date must be on or after the invoice date');
    return { invoiceDate, dueDate };
  }

  private validateServiceConfirmationDate(confirmationDateValue: any, complaintDateValue: any) {
    const value = String(confirmationDateValue || this.getCurrentBusinessDate()).trim();
    const complaintDate = String(complaintDateValue || '').slice(0, 10);
    const pattern = /^\d{4}-\d{2}-\d{2}$/;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!pattern.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Confirmation date must be a valid date');
    }
    if (value > this.getCurrentBusinessDate()) throw new BadRequestException('Confirmation date cannot be in the future');
    if (pattern.test(complaintDate) && value < complaintDate) throw new BadRequestException('Confirmation date cannot be before the complaint date');
    return value;
  }

  private assertNonNegativeServiceCharges(charges: Record<string, number>) {
    if (Object.values(charges).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new BadRequestException('Labor hours, rates and service charges cannot be negative');
    }
  }

  private validateServiceReceiptDate(receiptDateValue: any, invoiceDateValue: any) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const receiptDate = String(receiptDateValue || this.getCurrentBusinessDate()).trim();
    const invoiceDate = String(invoiceDateValue || '').slice(0, 10);
    const parsed = new Date(`${receiptDate}T00:00:00.000Z`);
    if (!datePattern.test(receiptDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== receiptDate) throw new BadRequestException('Service receipt date must be a valid date');
    if (receiptDate > this.getCurrentBusinessDate()) throw new BadRequestException('Service receipt date cannot be in the future');
    if (datePattern.test(invoiceDate) && receiptDate < invoiceDate) throw new BadRequestException('Service receipt date cannot be before the invoice date');
    return receiptDate;
  }

  private validateServiceCollectionDates(nextFollowUpValue: any, promiseToPayValue: any) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const validateOptionalFutureDate = (rawValue: any, label: string) => {
      const value = String(rawValue || '').trim();
      if (!value) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (!datePattern.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException(`${label} must be a valid date`);
      }
      if (value < this.getCurrentBusinessDate()) throw new BadRequestException(`${label} cannot be in the past`);
      return value;
    };
    return {
      nextFollowUpDate: validateOptionalFutureDate(nextFollowUpValue, 'Next follow-up date'),
      promiseToPayDate: validateOptionalFutureDate(promiseToPayValue, 'Promise-to-pay date'),
    };
  }

  private assertServiceInvoiceCancellable(invoice: any, activePaymentCount: number) {
    if (invoice?.billing_status === 'CANCELLED') throw new BadRequestException('Invoice is already cancelled');
    if (activePaymentCount > 0 || Number(invoice?.paid_amount || 0) > 0) {
      throw new BadRequestException('Reverse all customer receipts before cancelling this invoice');
    }
  }

  private withReceivableAgeing(invoice: any) {
    const balance = Number(invoice?.balance_amount || 0);
    if (balance <= 0 || invoice?.billing_status === 'CANCELLED') return { ...invoice, days_overdue: 0, ageing_bucket: 'CLOSED' };
    const due = invoice?.due_date ? new Date(`${invoice.due_date}T00:00:00`) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysOverdue = due && Number.isFinite(due.getTime()) ? Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000)) : 0;
    const ageingBucket = !due || due >= today ? 'CURRENT' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
    return { ...invoice, days_overdue: daysOverdue, ageing_bucket: ageingBucket };
  }

  private async generateServiceConfirmationNumber(tenantId: string) {
    void tenantId;
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_CONFIRMATION');
    return `SCF-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private async generateServiceEstimateNumber(tenantId: string) {
    void tenantId;
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_ESTIMATE');
    return `SE-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private assertCommercialApproval(ticket: any) {
    if (ticket?.commercial_approval_required && String(ticket?.commercial_approval_status || '').toUpperCase() !== 'APPROVED') {
      throw new BadRequestException('Customer approval of the chargeable service estimate is required before work can start');
    }
  }

  private validateServiceConfirmationVariance(ticket: any, approvedEstimate: any, totalAmountValue: any, input: any) {
    const approvalRequired = Boolean(ticket?.commercial_approval_required);
    const approvedEstimateAmount = approvalRequired ? this.roundAmount(approvedEstimate?.total_amount) : 0;
    if (approvalRequired && (!approvedEstimate?.id || approvedEstimateAmount < 0)) {
      throw new BadRequestException('The customer-approved estimate could not be verified');
    }
    const totalAmount = this.roundAmount(totalAmountValue);
    const varianceAmount = approvalRequired ? this.roundAmount(Math.max(0, totalAmount - approvedEstimateAmount)) : 0;
    const varianceReason = String(input?.variance_reason || '').trim() || null;
    const varianceApprovalReference = String(input?.variance_approval_reference || '').trim() || null;
    const varianceApprovalAttachmentUrl = String(input?.variance_approval_attachment_url || '').trim() || null;
    if (varianceApprovalAttachmentUrl && !varianceApprovalAttachmentUrl.startsWith('/uploads/service/')) {
      throw new BadRequestException('Invalid service variance authorization attachment');
    }
    if (varianceAmount > 0 && !varianceReason) {
      throw new BadRequestException(`Actual service value exceeds the approved estimate by ${varianceAmount.toFixed(2)}; enter a variance reason`);
    }
    if (varianceAmount > 0 && !varianceApprovalReference && !varianceApprovalAttachmentUrl) {
      throw new BadRequestException('Customer change authorization reference or supporting document is required for the estimate overrun');
    }
    return {
      approvedEstimateId: approvalRequired ? approvedEstimate.id : null,
      approvedEstimateAmount,
      varianceAmount,
      varianceReason: varianceAmount > 0 ? varianceReason : null,
      varianceApprovalReference: varianceAmount > 0 ? varianceApprovalReference : null,
      varianceApprovalAttachmentUrl: varianceAmount > 0 ? varianceApprovalAttachmentUrl : null,
    };
  }

  private validateServiceEstimateInput(input: any, defaultTaxRate = 18) {
    const rows = Array.isArray(input?.items) ? input.items : [];
    if (!rows.length) throw new BadRequestException('At least one estimate line is required');
    const items = rows.map((row: any, index: number) => {
      const description = String(row.description || '').trim();
      const quantity = Number(row.quantity);
      const unitPrice = this.roundAmount(row.unit_price);
      const discountPercent = Number(row.discount_percent || 0);
      if (!description) throw new BadRequestException(`Description is required on estimate line ${index + 1}`);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new BadRequestException(`Quantity must be greater than zero on estimate line ${index + 1}`);
      if (unitPrice < 0) throw new BadRequestException(`Rate cannot be negative on estimate line ${index + 1}`);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new BadRequestException(`Discount must be between 0 and 100 on estimate line ${index + 1}`);
      const gross = this.roundAmount(quantity * unitPrice);
      const discountAmount = this.roundAmount(gross * discountPercent / 100);
      return {
        line_no: index + 1,
        item_id: row.item_id || null,
        description,
        quantity,
        uom: String(row.uom || 'NOS').trim().toUpperCase(),
        unit_price: unitPrice,
        discount_percent: discountPercent,
        line_total: this.roundAmount(gross - discountAmount),
        discount_amount: discountAmount,
      };
    });
    const taxPercentage = input.tax_percentage === undefined || input.tax_percentage === null || input.tax_percentage === ''
      ? defaultTaxRate
      : Number(input.tax_percentage);
    if (!Number.isFinite(taxPercentage) || taxPercentage < 0 || taxPercentage > 100) throw new BadRequestException('Tax percentage must be between 0 and 100');
    const estimateDate = String(input.estimate_date || this.getCurrentBusinessDate()).trim();
    const validUntil = String(input.valid_until || '').trim() || null;
    if (estimateDate > this.getCurrentBusinessDate()) throw new BadRequestException('Estimate date cannot be in the future');
    if (validUntil && validUntil < estimateDate) throw new BadRequestException('Estimate validity cannot end before the estimate date');
    const subtotal = this.roundAmount(items.reduce((sum: number, row: any) => sum + row.line_total, 0));
    const discountAmount = this.roundAmount(items.reduce((sum: number, row: any) => sum + row.discount_amount, 0));
    const taxAmount = this.roundAmount(subtotal * taxPercentage / 100);
    return { items, taxPercentage, estimateDate, validUntil, subtotal, discountAmount, taxAmount, totalAmount: this.roundAmount(subtotal + taxAmount) };
  }

  private async insertServiceEstimate(tenantId: string, userId: string, ticket: any, input: any, revisionNo: number, baseNumber?: string) {
    const regional = await this.getTenantRegionalDefaults(tenantId);
    const calculation = this.validateServiceEstimateInput(input, regional.defaultTaxRate);
    const estimateNumber = revisionNo > 0 && baseNumber
      ? `${baseNumber}-R${revisionNo}`
      : await this.generateServiceEstimateNumber(tenantId);
    const { data: estimate, error } = await this.supabase.from('service_estimates').insert({
      tenant_id: tenantId,
      estimate_number: estimateNumber,
      service_ticket_id: ticket.id,
      revision_no: revisionNo,
      status: 'PENDING_APPROVAL',
      estimate_date: calculation.estimateDate,
      valid_until: calculation.validUntil,
      currency: String(input.currency || regional.currency).trim().toUpperCase(),
      subtotal: calculation.subtotal,
      discount_amount: calculation.discountAmount,
      tax_percentage: calculation.taxPercentage,
      tax_amount: calculation.taxAmount,
      total_amount: calculation.totalAmount,
      terms_and_conditions: String(input.terms_and_conditions || '').trim() || null,
      created_by: userId,
    }).select().single();
    if (error || !estimate) throw new BadRequestException(error?.message || 'Service estimate could not be created');
    const itemPayload = calculation.items.map(({ discount_amount, ...row }: any) => ({ ...row, estimate_id: estimate.id }));
    const { data: items, error: itemError } = await this.supabase.from('service_estimate_items').insert(itemPayload).select();
    if (itemError) {
      await this.supabase.from('service_estimates').delete().eq('id', estimate.id).eq('tenant_id', tenantId);
      throw new BadRequestException(itemError.message);
    }
    const { error: ticketError } = await this.supabase.from('service_tickets').update({
      commercial_approval_required: true,
      commercial_approval_status: 'PENDING_APPROVAL',
      approved_estimate_id: null,
      estimated_cost: calculation.totalAmount,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('id', ticket.id);
    if (ticketError) throw new BadRequestException(ticketError.message);
    return { ...estimate, items };
  }

  private async getTenantRegionalDefaults(tenantId: string): Promise<RegionalDefaults> {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('market_profile')
      .eq('id', tenantId)
      .single();
    if (error || !data) throw new BadRequestException('Tenant regional settings could not be loaded');
    return regionalDefaults(data.market_profile);
  }

  private async getOwnedServiceEstimate(tenantId: string, estimateId: string) {
    const { data, error } = await this.supabase.from('service_estimates').select('*')
      .eq('tenant_id', tenantId).eq('id', estimateId).maybeSingle();
    if (error || !data) throw new NotFoundException('Service estimate not found');
    return data;
  }

  private async generateCustomerServiceInvoiceNumber(tenantId: string) {
    void tenantId;
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_INVOICE');
    return `SINV-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private async generateCustomerServiceReceiptNumber(tenantId: string) {
    void tenantId;
    const year = new Date().getFullYear();
    const sequence = await this.nextServiceDocumentSequence('SERVICE_RECEIPT');
    return `SRCPT-${year}-${String(sequence).padStart(6, '0')}`;
  }

  private async nextServiceDocumentSequence(documentType: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('next_service_document_number', {
      p_document_type: documentType,
    });
    const value = Number(data);
    if (error || !Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException(error?.message || `Unable to allocate ${documentType} document number`);
    }
    return value;
  }

  private validateServiceEvidence(value: any): string[] {
    const attachments = Array.isArray(value) ? value : [];
    if (attachments.length > 10) throw new BadRequestException('A site-visit stage supports a maximum of 10 attachments');
    return attachments.map((entry: any) => {
      const url = String(entry || '').trim();
      if (!url.startsWith('/uploads/service/')) throw new BadRequestException('Invalid site-visit evidence attachment');
      return url;
    });
  }

  private validateChecklistTemplateItems(value: any) {
    const rows = Array.isArray(value) ? value : [];
    if (!rows.length) throw new BadRequestException('Add at least one checklist item');
    if (rows.length > 100) throw new BadRequestException('A checklist template supports a maximum of 100 items');
    const seen = new Set<string>();
    return rows.map((row: any, index: number) => {
      const itemText = String(row.item_text || '').trim();
      if (!itemText) throw new BadRequestException(`Checklist item ${index + 1} is blank`);
      const normalized = itemText.toLowerCase();
      if (seen.has(normalized)) throw new BadRequestException(`Checklist item ${index + 1} is duplicated`);
      seen.add(normalized);
      return { item_text: itemText, is_required: row.is_required !== false };
    });
  }

  private validateServiceCoordinates(latValue: any, lngValue: any, label: string) {
    const hasLat = latValue !== undefined && latValue !== null && latValue !== '';
    const hasLng = lngValue !== undefined && lngValue !== null && lngValue !== '';
    if (hasLat !== hasLng) throw new BadRequestException(`Both latitude and longitude are required for ${label} location evidence`);
    if (!hasLat) return { lat: null, lng: null };
    const lat = Number(latValue);
    const lng = Number(lngValue);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new BadRequestException(`Invalid ${label} coordinates`);
    }
    return { lat, lng };
  }

  private async getOwnedTicket(tenantId: string, ticketId: string) {
    const { data, error } = await this.supabase
      .from('service_tickets')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', ticketId)
      .single();
    if (error || !data) throw new NotFoundException('Service ticket not found');
    return data;
  }

  private assertTicketStatusTransition(currentStatus: string, nextStatus: string) {
    const allowed: Record<string, string[]> = {
      OPEN: ['ASSIGNED', 'CANCELLED'],
      ASSIGNED: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
      IN_PROGRESS: ['PARTS_PENDING', 'CANCELLED'],
      PARTS_PENDING: ['IN_PROGRESS', 'CANCELLED'],
      COMPLETED: ['CLOSED'],
      CLOSED: [],
      CANCELLED: [],
    };
    if (!allowed[currentStatus]?.includes(nextStatus)) {
      throw new BadRequestException(`Invalid service status transition: ${currentStatus} → ${nextStatus}`);
    }
  }

  private assertAssignmentStatusTransition(currentStatus: string, nextStatus: string) {
    const allowed: Record<string, string[]> = {
      ASSIGNED: ['ACCEPTED', 'IN_PROGRESS', 'REASSIGNED'],
      ACCEPTED: ['IN_PROGRESS', 'REASSIGNED'],
      IN_PROGRESS: ['COMPLETED', 'REASSIGNED'],
      COMPLETED: [],
      REASSIGNED: [],
    };
    if (!allowed[currentStatus]?.includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid technician-assignment status transition: ${currentStatus} -> ${nextStatus}`,
      );
    }
  }
}
