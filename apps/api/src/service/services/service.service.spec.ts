import { BadRequestException } from '@nestjs/common';
import { ServiceService } from './service.service';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';

describe('ServiceService ERP controls', () => {
  let service: ServiceService;

  beforeEach(() => {
    service = new ServiceService();
  });

  it('allows the normal assignment-to-work transition', () => {
    expect(() => (service as any).assertTicketStatusTransition('ASSIGNED', 'IN_PROGRESS')).not.toThrow();
  });

  it('blocks reopening a closed ticket through an uncontrolled status update', () => {
    expect(() => (service as any).assertTicketStatusTransition('CLOSED', 'IN_PROGRESS'))
      .toThrow(BadRequestException);
  });

  it('blocks skipping directly from OPEN to COMPLETED', () => {
    expect(() => (service as any).assertTicketStatusTransition('OPEN', 'COMPLETED'))
      .toThrow('Invalid service status transition');
  });

  it('requires final service confirmation instead of manual ticket completion', () => {
    expect(() => (service as any).assertTicketStatusTransition('IN_PROGRESS', 'COMPLETED'))
      .toThrow('Invalid service status transition');
    expect(() => (service as any).assertTicketStatusTransition('COMPLETED', 'CLOSED'))
      .not.toThrow();
  });

  it('enforces the technician assignment lifecycle', () => {
    expect(() => (service as any).assertAssignmentStatusTransition('ASSIGNED', 'IN_PROGRESS'))
      .not.toThrow();
    expect(() => (service as any).assertAssignmentStatusTransition('IN_PROGRESS', 'COMPLETED'))
      .not.toThrow();
    expect(() => (service as any).assertAssignmentStatusTransition('ASSIGNED', 'COMPLETED'))
      .toThrow('Invalid technician-assignment status transition');
    expect(() => (service as any).assertAssignmentStatusTransition('COMPLETED', 'IN_PROGRESS'))
      .toThrow('Invalid technician-assignment status transition');
  });

  it('accepts only service-upload URLs as site-visit evidence', () => {
    expect((service as any).validateServiceEvidence(['/uploads/service/2026-08-19/t/u/photo.jpg']))
      .toEqual(['/uploads/service/2026-08-19/t/u/photo.jpg']);
    expect(() => (service as any).validateServiceEvidence(['https://untrusted.example/photo.jpg']))
      .toThrow('Invalid site-visit evidence attachment');
  });

  it('validates complete field-service coordinates', () => {
    expect((service as any).validateServiceCoordinates('17.72', '83.30', 'check-in'))
      .toEqual({ lat: 17.72, lng: 83.3 });
    expect(() => (service as any).validateServiceCoordinates('17.72', '', 'check-in'))
      .toThrow('Both latitude and longitude are required');
    expect(() => (service as any).validateServiceCoordinates('91', '83.30', 'check-in'))
      .toThrow('Invalid check-in coordinates');
  });

  it('measures SLA against persisted response and resolution events', () => {
    const now = new Date('2026-08-17T12:00:00Z').getTime();
    expect((service as any).calculateTicketSla({
      status: 'IN_PROGRESS',
      response_due_at: '2026-08-17T10:00:00Z',
      response_acknowledged_at: '2026-08-17T09:30:00Z',
      resolution_due_at: '2026-08-18T12:00:00Z',
    }, now)).toMatchObject({ response_status: 'MET', resolution_status: 'PENDING', overall_status: 'ON_TRACK' });
  });

  it('retains a response breach even after a late acknowledgement', () => {
    const sla = (service as any).calculateTicketSla({
      status: 'COMPLETED',
      response_due_at: '2026-08-17T10:00:00Z',
      response_acknowledged_at: '2026-08-17T10:01:00Z',
      resolution_due_at: '2026-08-17T14:00:00Z',
      resolved_at: '2026-08-17T13:00:00Z',
    }, new Date('2026-08-17T15:00:00Z').getTime());
    expect(sla).toMatchObject({ response_status: 'BREACHED', resolution_status: 'MET', overall_status: 'BREACHED' });
  });

  it('does not leave historical completed tickets response-pending', () => {
    const sla = (service as any).calculateTicketSla({
      status: 'COMPLETED',
      response_due_at: '2026-08-17T10:00:00Z',
      resolution_due_at: '2026-08-17T14:00:00Z',
      resolved_at: '2026-08-17T13:00:00Z',
    }, new Date('2026-08-17T15:00:00Z').getTime());
    expect(sla.response_status).not.toBe('PENDING');
  });

  it('does not claim SLA compliance when historical targets are absent', () => {
    expect((service as any).calculateTicketSla({ status: 'COMPLETED' }).overall_status).toBe('NOT_SET');
  });

  it('rounds customer billing amounts to two decimals', () => {
    expect((service as any).roundAmount(101697.115)).toBe(101697.12);
  });

  it('waives service labour charges for warranty-covered calls', () => {
    expect((service as any).getWarrantyAdjustedLaborRate({ is_under_warranty: true }, 2500)).toBe(0);
    expect((service as any).getWarrantyAdjustedLaborRate({ entitlement_status: 'WARRANTY' }, 2500)).toBe(0);
    expect((service as any).getWarrantyAdjustedLaborRate({ service_type: 'PAID' }, 2500)).toBe(2500);
  });

  it('validates technician daily capacity within one business day', () => {
    expect((service as any).validateDailyCapacity(undefined)).toBe(8);
    expect((service as any).validateDailyCapacity('7.755')).toBe(7.76);
    expect(() => (service as any).validateDailyCapacity(0)).toThrow('Daily technician capacity');
    expect(() => (service as any).validateDailyCapacity(25)).toThrow('Daily technician capacity');
  });

  it('rejects invalid technician-capacity dates before querying assignments', async () => {
    await expect(service.getTechnicianCapacity('tenant-1', '19-08-2026'))
      .rejects.toThrow('Capacity date must be YYYY-MM-DD');
  });

  it('validates service invoice and due-date chronology', () => {
    jest.spyOn(service as any, 'getCurrentBusinessDate').mockReturnValue('2026-08-17');
    expect((service as any).validateServiceInvoiceDates('2026-08-17', '2026-09-17', '2026-08-16'))
      .toEqual({ invoiceDate: '2026-08-17', dueDate: '2026-09-17' });
    expect(() => (service as any).validateServiceInvoiceDates('2026-08-15', null, '2026-08-16'))
      .toThrow('Service invoice date cannot be before the confirmation date');
    expect(() => (service as any).validateServiceInvoiceDates('2026-08-17', '2026-08-16', '2026-08-16'))
      .toThrow('Service invoice due date must be on or after the invoice date');
  });

  it('blocks future service receipts and receipts before invoice date', () => {
    jest.spyOn(service as any, 'getCurrentBusinessDate').mockReturnValue('2026-08-17');
    expect(() => (service as any).validateServiceReceiptDate('2026-08-18', '2026-08-16'))
      .toThrow('Service receipt date cannot be in the future');
    expect(() => (service as any).validateServiceReceiptDate('2026-08-15', '2026-08-16'))
      .toThrow('Service receipt date cannot be before the invoice date');
  });

  it('allocates service document numbers through the atomic database range', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 42, error: null });
    (service as any).supabase = { rpc };

    await expect((service as any).generateCustomerServiceInvoiceNumber('tenant-1'))
      .resolves.toMatch(/^SINV-\d{4}-000042$/);
    expect(rpc).toHaveBeenCalledWith('next_service_document_number', {
      p_document_type: 'SERVICE_INVOICE',
    });
  });

  it('fails clearly when a service number range cannot be allocated', async () => {
    (service as any).supabase = {
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'number range unavailable' } }),
    };

    await expect((service as any).generateTicketNumber('tenant-1'))
      .rejects.toThrow('number range unavailable');
  });

  it('validates service collection follow-up and promise dates', () => {
    jest.spyOn(service as any, 'getCurrentBusinessDate').mockReturnValue('2026-08-17');
    expect((service as any).validateServiceCollectionDates('2026-08-20', '2026-08-25'))
      .toEqual({ nextFollowUpDate: '2026-08-20', promiseToPayDate: '2026-08-25' });
    expect(() => (service as any).validateServiceCollectionDates('2026-08-16', null))
      .toThrow('Next follow-up date cannot be in the past');
  });

  it('requires all service receipts to be reversed before invoice cancellation', () => {
    expect(() => (service as any).assertServiceInvoiceCancellable({ billing_status: 'POSTED', paid_amount: 100 }, 0))
      .toThrow('Reverse all customer receipts before cancelling this invoice');
    expect(() => (service as any).assertServiceInvoiceCancellable({ billing_status: 'POSTED', paid_amount: 0 }, 0))
      .not.toThrow();
  });

  it('validates service confirmation chronology', () => {
    jest.spyOn(service as any, 'getCurrentBusinessDate').mockReturnValue('2026-08-17');
    expect((service as any).validateServiceConfirmationDate('2026-08-17', '2026-08-01')).toBe('2026-08-17');
    expect(() => (service as any).validateServiceConfirmationDate('2026-08-18', '2026-08-01'))
      .toThrow('Confirmation date cannot be in the future');
    expect(() => (service as any).validateServiceConfirmationDate('2026-07-31', '2026-08-01'))
      .toThrow('Confirmation date cannot be before the complaint date');
  });

  it('rejects negative labor and service charges', () => {
    expect(() => (service as any).assertNonNegativeServiceCharges({ laborHours: 1, laborRate: 100, travelCost: 0 }))
      .not.toThrow();
    expect(() => (service as any).assertNonNegativeServiceCharges({ laborHours: -1, laborRate: 100 }))
      .toThrow('Labor hours, rates and service charges cannot be negative');
  });

  it('calculates replacement warranty dates using UTC calendar months', () => {
    expect((service as any).validateReplacementWarranty('2026-08-17', 6))
      .toEqual({ start: '2026-08-17', months: 6, end: '2027-02-17' });
  });

  it('rejects invalid replacement warranty controls', () => {
    expect(() => (service as any).validateReplacementWarranty('not-a-date', 6))
      .toThrow('Replacement warranty start date is invalid');
    expect(() => (service as any).validateReplacementWarranty('2026-08-17', 6.5))
      .toThrow('Replacement warranty months must be a whole number');
  });

  it('aggregates service-part stock across warehouse locations by category', () => {
    const rows = [
      { category: 'SERVICE_SPARES', available_quantity: 2 },
      { category: 'SERVICE_SPARES', available_quantity: 3 },
      { category: 'RAW_MATERIAL', available_quantity: 4 },
    ];
    expect((service as any).selectServicePartStockCategory(rows, 5)).toBe('SERVICE_SPARES');
    expect((service as any).selectServicePartStockCategory(rows, 6)).toBeNull();
  });

  it('requires a positive price only for customer-billable service parts', () => {
    expect(() => (service as any).assertServicePartPricing(125, true)).not.toThrow();
    expect(() => (service as any).assertServicePartPricing(0, false)).not.toThrow();
    expect(() => (service as any).assertServicePartPricing(0, true))
      .toThrow('Enter a positive unit price for a billable service part');
  });

  it('validates a complete customer satisfaction response', () => {
    expect((service as any).validateServiceFeedbackInput({
      overall_rating: 5,
      technician_rating: 4,
      response_time_rating: 3,
      quality_rating: 5,
      feedback_text: '  Good work  ',
      would_recommend: true,
    })).toEqual({
      overall_rating: 5,
      technician_rating: 4,
      response_time_rating: 3,
      quality_rating: 5,
      feedback_text: 'Good work',
      suggestions: null,
      would_recommend: true,
    });
  });

  it('rejects invalid customer satisfaction ratings', () => {
    expect(() => (service as any).validateServiceFeedbackInput({ overall_rating: 0 }))
      .toThrow('Customer satisfaction ratings must be whole numbers from 1 to 5');
    expect(() => (service as any).validateServiceFeedbackInput({ overall_rating: 4.5 }))
      .toThrow('Customer satisfaction ratings must be whole numbers from 1 to 5');
  });

  it('emails a posted customer service invoice to the customer master address', async () => {
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    service = new ServiceService(undefined, { sendEmail } as any);
    jest.spyOn(service, 'getCustomerServiceInvoiceById').mockResolvedValue({
      id: 'invoice-1',
      invoice_number: 'CSI-2026-000001',
      billing_status: 'POSTED',
      taxable_amount: 1000,
      tax_amount: 180,
      net_amount: 1180,
      balance_amount: 1180,
      due_date: '2026-08-31',
      customer: { customer_name: 'Test Customer', email: 'accounts@example.com' },
      ticket: { ticket_number: 'ST-000001' },
      confirmation: { confirmation_number: 'SCF-000001', work_performed: 'Preventive service' },
      service_parts: [],
    } as any);

    const result = await service.sendCustomerServiceInvoiceEmail('tenant-1', 'invoice-1');

    expect(result.recipient).toBe('accounts@example.com');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'accounts@example.com',
      from: 'support',
      tenantId: 'tenant-1',
    }));
  });

  it('does not email a cancelled customer service invoice', async () => {
    service = new ServiceService(undefined, { sendEmail: jest.fn() } as any);
    jest.spyOn(service, 'getCustomerServiceInvoiceById').mockResolvedValue({
      invoice_number: 'CSI-2026-000002',
      billing_status: 'CANCELLED',
      customer: { email: 'accounts@example.com' },
    } as any);

    await expect(service.sendCustomerServiceInvoiceEmail('tenant-1', 'invoice-2'))
      .rejects.toThrow('cancelled service invoice');
  });

  it('calculates chargeable service estimate lines, discounts and GST on the server', () => {
    jest.spyOn(service as any, 'getCurrentBusinessDate').mockReturnValue('2026-08-18');
    const result = (service as any).validateServiceEstimateInput({
      estimate_date: '2026-08-18', valid_until: '2026-08-31', tax_percentage: 18,
      items: [
        { description: 'Labour', quantity: 2, uom: 'HOUR', unit_price: 1000, discount_percent: 10 },
        { description: 'Travel', quantity: 1, uom: 'JOB', unit_price: 500, discount_percent: 0 },
      ],
    });
    expect(result).toMatchObject({ subtotal: 2300, discountAmount: 200, taxAmount: 414, totalAmount: 2714 });
  });

  it('recognizes only pending estimates whose validity has elapsed as expired', () => {
    expect((service as any).isServiceEstimateExpired({ status: 'PENDING_APPROVAL', valid_until: '2026-08-17' }, '2026-08-18')).toBe(true);
    expect((service as any).isServiceEstimateExpired({ status: 'PENDING_APPROVAL', valid_until: '2026-08-18' }, '2026-08-18')).toBe(false);
    expect((service as any).isServiceEstimateExpired({ status: 'APPROVED', valid_until: '2026-08-17' }, '2026-08-18')).toBe(false);
    expect((service as any).isServiceEstimateExpired({ status: 'PENDING_APPROVAL', valid_until: null }, '2026-08-18')).toBe(false);
  });

  it('requires auditable customer authorization for service estimate approval', () => {
    expect(() => (service as any).validateServiceEstimateDecisionInput({ decision: 'APPROVE' }))
      .toThrow('Customer approval reference or supporting authorization document is required');
    expect((service as any).validateServiceEstimateDecisionInput({ decision: 'APPROVE', approval_reference: 'PO-7788' }))
      .toMatchObject({ decision: 'APPROVE', approvalReference: 'PO-7788' });
    expect((service as any).validateServiceEstimateDecisionInput({ decision: 'APPROVE', approval_attachment_url: '/uploads/service/2026-08-18/file.pdf' }))
      .toMatchObject({ approvalAttachmentUrl: '/uploads/service/2026-08-18/file.pdf' });
  });

  it('requires a rejection reason and rejects external authorization URLs', () => {
    expect(() => (service as any).validateServiceEstimateDecisionInput({ decision: 'REJECT' }))
      .toThrow('Customer comments are required when rejecting an estimate');
    expect(() => (service as any).validateServiceEstimateDecisionInput({ decision: 'APPROVE', approval_attachment_url: 'https://example.com/file.pdf' }))
      .toThrow('Invalid customer authorization attachment');
  });

  it('blocks chargeable work until the customer-approved estimate exists', () => {
    expect(() => (service as any).assertCommercialApproval({ commercial_approval_required: true, commercial_approval_status: 'PENDING_APPROVAL' }))
      .toThrow('Customer approval of the chargeable service estimate is required');
    expect(() => (service as any).assertCommercialApproval({ commercial_approval_required: true, commercial_approval_status: 'APPROVED' }))
      .not.toThrow();
    expect(() => (service as any).assertCommercialApproval({ commercial_approval_required: false, commercial_approval_status: 'NOT_REQUIRED' }))
      .not.toThrow();
  });

  it('requires customer change authorization when actual service value exceeds the approved estimate', () => {
    const ticket = { commercial_approval_required: true };
    const estimate = { id: 'estimate-1', total_amount: 1000 };
    expect(() => (service as any).validateServiceConfirmationVariance(ticket, estimate, 1200, {}))
      .toThrow('enter a variance reason');
    expect(() => (service as any).validateServiceConfirmationVariance(ticket, estimate, 1200, { variance_reason: 'Additional repair' }))
      .toThrow('Customer change authorization reference or supporting document is required');
    expect((service as any).validateServiceConfirmationVariance(ticket, estimate, 1200, {
      variance_reason: 'Additional repair', variance_approval_reference: 'CO-009',
    })).toMatchObject({ approvedEstimateAmount: 1000, varianceAmount: 200, varianceApprovalReference: 'CO-009' });
  });

  it('does not require variance authorization within the approved estimate', () => {
    expect((service as any).validateServiceConfirmationVariance(
      { commercial_approval_required: true }, { id: 'estimate-1', total_amount: 1000 }, 999.999, {},
    )).toMatchObject({ approvedEstimateAmount: 1000, varianceAmount: 0 });
    expect(() => (service as any).validateServiceConfirmationVariance(
      { commercial_approval_required: true }, { id: 'estimate-1', total_amount: 1000 }, 1200,
      { variance_reason: 'Extra work', variance_approval_attachment_url: 'https://example.com/change.pdf' },
    )).toThrow('Invalid service variance authorization attachment');
  });
});
