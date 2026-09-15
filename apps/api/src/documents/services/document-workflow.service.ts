import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { EmailService } from '../../email/email.service';
import { EmailConfigService } from '../../email/email-config.service';
import { SupabaseStorageService } from './supabase-storage.service';
import * as crypto from 'crypto';

@Injectable()
export class DocumentWorkflowService {
  private readonly logger = new Logger(DocumentWorkflowService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(
    private readonly emailService: EmailService,
    private readonly emailConfig: EmailConfigService,
    private readonly storageService: SupabaseStorageService,
  ) {}

  private async resolveTargetUserId(
    tenantId: string,
    dto: any,
  ): Promise<string | null> {
    const directId = dto?.target_user_id || dto?.targetUserId;
    if (typeof directId === 'string' && directId.trim()) return directId;

    const email = dto?.recipientEmail || dto?.recipient_email || dto?.target_email;
    if (typeof email !== 'string' || !email.trim()) return null;

    const { data: user } = await this.supabase
      .from('users')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('email', email.trim())
      .maybeSingle();

    return user?.id || null;
  }

  private normalizeClientDetails(dto: any): { email?: string; name?: string } {
    const email = dto?.client_email || dto?.clientEmail;
    const name = dto?.client_name || dto?.clientName;

    return {
      email: typeof email === 'string' ? email.trim() : undefined,
      name: typeof name === 'string' ? name.trim() : undefined,
    };
  }

  async forwardToStaff(req: any, documentId: string, dto: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const targetUserId = await this.resolveTargetUserId(tenantId, dto);

    const { data: doc } = await this.supabase
      .from('documents')
      .select('*, created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email)')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error('Document not found');

    // Update document status
    await this.supabase
      .from('documents')
      .update({ 
        status: 'PENDING_REVIEW',
        reviewed_by: targetUserId,
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    // Log workflow action
    await this.logWorkflowAction(tenantId, documentId, userId, 'FORWARDED_TO_STAFF', {
      target_user_id: targetUserId,
      comments: dto.comments,
    });

    // Send email notification
    if (targetUserId) {
      const { data: targetUser } = await this.supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', targetUserId)
        .eq('tenant_id', tenantId)
        .single();

      if (targetUser?.email) {
        await this.sendReviewRequestEmail(targetUser.email, doc, req.user);
      }
    }

    return { ok: true, message: 'Document forwarded to staff for review' };
  }

  async returnToAdmin(req: any, documentId: string, dto: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const comments =
      typeof dto === 'string'
        ? dto
        : typeof dto?.comments === 'string'
          ? dto.comments
          : undefined;

    const { data: doc } = await this.supabase
      .from('documents')
      .select('*, created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email)')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error('Document not found');

    await this.supabase
      .from('documents')
      .update({ 
        status: 'PENDING_APPROVAL',
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    await this.logWorkflowAction(tenantId, documentId, userId, 'RETURNED_TO_ADMIN', {
      comments,
    });

    // Notify admin (creator)
    if (doc.created_by_user?.email) {
      await this.sendApprovalRequestEmail(doc.created_by_user.email, doc, req.user);
    }

    return { ok: true, message: 'Document returned to admin for approval' };
  }

  async forwardToManager(req: any, documentId: string, dto: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const targetUserId = await this.resolveTargetUserId(tenantId, dto);

    const { data: doc } = await this.supabase
      .from('documents')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error('Document not found');

    await this.supabase
      .from('documents')
      .update({ 
        status: 'PENDING_APPROVAL',
        approved_by: targetUserId,
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    await this.logWorkflowAction(tenantId, documentId, userId, 'FORWARDED_TO_MANAGER', {
      target_user_id: targetUserId,
      comments: dto.comments,
    });

    // Send email to manager
    if (targetUserId) {
      const { data: manager } = await this.supabase
        .from('users')
        .select('email, first_name, last_name')
        .eq('id', targetUserId)
        .eq('tenant_id', tenantId)
        .single();

      if (manager?.email) {
        await this.sendApprovalRequestEmail(manager.email, doc, req.user);
      }
    }

    return { ok: true, message: 'Document forwarded to manager for approval' };
  }

  async sendToClient(req: any, documentId: string, dto: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const { data: doc } = await this.supabase
      .from('documents')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error('Document not found');

    const client = this.normalizeClientDetails(dto);
    if (!client.email || !client.name) {
      throw new Error('client_email and client_name are required');
    }

    // Generate client upload token (valid for X days)
    const expiryDays = dto.expiry_days || 15;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    const token = crypto.randomBytes(32).toString('hex');

    // Store token in metadata
    const metadata = doc.metadata || {};
    metadata.client_access = {
      token,
      client_email: client.email,
      client_name: client.name,
      expires_at: expiresAt.toISOString(),
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    await this.supabase
      .from('documents')
      .update({ 
        status: 'SENT_TO_CLIENT',
        metadata,
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    await this.logWorkflowAction(tenantId, documentId, userId, 'SENT_TO_CLIENT', {
      client_email: client.email,
      client_name: client.name,
    });

    // Get signed URL for document (long expiry for client)
    const viewUrl = doc.file_path
      ? await this.storageService.getSignedUrl(
          doc.file_path,
          expiryDays * 24 * 60 * 60,
        )
      : doc.file_url;

    // Send email to client
    await this.sendClientReviewEmail(client.email, doc, {
      client_name: client.name,
      message: dto.message,
      view_url: viewUrl,
      upload_url: `${process.env.FRONTEND_URL || 'http://3.110.100.60'}/client/upload/${token}`,
    });

    return { 
      ok: true, 
      message: 'Document sent to client',
      token,
      expires_at: expiresAt.toISOString(),
    };
  }

  async rejectDocument(req: any, documentId: string, dto: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const { data: doc } = await this.supabase
      .from('documents')
      .select('*, created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email)')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .single();

    if (!doc) throw new Error('Document not found');

    await this.supabase
      .from('documents')
      .update({ 
        status: 'REJECTED',
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    await this.logWorkflowAction(tenantId, documentId, userId, 'REJECTED', {
      reason: dto.reason,
    });

    // Notify creator
    if (doc.created_by_user?.email) {
      await this.sendRejectionEmail(doc.created_by_user.email, doc, dto.reason, req.user);
    }

    return { ok: true, message: 'Document rejected' };
  }

  async finalApprove(req: any, documentId: string) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    await this.supabase
      .from('documents')
      .update({ 
        status: 'APPROVED',
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    await this.logWorkflowAction(tenantId, documentId, userId, 'FINAL_APPROVED', {});

    return { ok: true, message: 'Document approved' };
  }

  async clientUploadRevision(token: string, file: Express.Multer.File, body: any) {
    // Find document by token
    const { data: docs } = await this.supabase
      .from('documents')
      .select('*')
      .not('metadata', 'is', null);

    const doc = docs?.find((d: any) => {
      const clientAccess = d.metadata?.client_access;
      if (!clientAccess) return false;
      if (clientAccess.token !== token) return false;
      
      // Check expiry
      const expiresAt = new Date(clientAccess.expires_at);
      if (expiresAt < new Date()) return false;
      
      return true;
    });

    if (!doc) {
      throw new UnauthorizedException('Invalid or expired upload token');
    }

    // Upload new file
    const upload = await this.storageService.uploadFile(file, 'documents', doc.id);

    // Calculate next revision number
    const { data: revisions } = await this.supabase
      .from('document_revisions')
      .select('revision_number')
      .eq('document_id', doc.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const lastRevision = revisions?.[0]?.revision_number || '1.0';
    const [major, minor] = lastRevision.split('.').map(Number);
    const nextRevision = `${major}.${minor + 1}`;

    // Create new revision
    await this.supabase
      .from('document_revisions')
      .insert({
        tenant_id: doc.tenant_id,
        document_id: doc.id,
        revision_number: nextRevision,
        file_url: upload.url,
        file_path: upload.path,
        file_name: file.originalname,
        file_size: file.size,
        file_type: file.mimetype,
        change_description: `Client revision: ${body.comments || 'Updated by client'}`,
        revision_type: 'MINOR',
        status: 'ACTIVE',
        created_by: null, // Client upload
      });

    // Mark previous revisions as superseded
    await this.supabase
      .from('document_revisions')
      .update({ status: 'SUPERSEDED' })
      .eq('document_id', doc.id)
      .neq('revision_number', nextRevision);

    // Update document
    await this.supabase
      .from('documents')
      .update({
        current_revision: nextRevision,
        file_url: upload.url,
        file_path: upload.path,
        file_name: file.originalname,
        file_size: file.size,
        file_type: file.mimetype,
        status: 'PENDING_REVIEW', // Back to review cycle
      })
      .eq('id', doc.id);

    await this.logWorkflowAction(doc.tenant_id, doc.id, null, 'CLIENT_UPLOADED_REVISION', {
      revision_number: nextRevision,
      client_email: doc.metadata.client_access.client_email,
      comments: body.comments,
    });

    // Notify the manager who sent it to client
    if (doc.metadata.client_access.created_by) {
      const { data: manager } = await this.supabase
        .from('users')
        .select('email, first_name')
        .eq('id', doc.metadata.client_access.created_by)
        .single();

      if (manager?.email) {
        await this.sendClientUploadNotification(manager.email, doc, nextRevision);
      }
    }

    return { 
      ok: true, 
      message: 'Revision uploaded successfully',
      revision_number: nextRevision,
    };
  }

  private async logWorkflowAction(
    tenantId: string,
    documentId: string,
    userId: string | null,
    action: string,
    metadata: any,
  ) {
    // Log to document_access_logs (existing)
    await this.supabase
      .from('document_access_logs')
      .insert({
        tenant_id: tenantId,
        document_id: documentId,
        user_id: userId,
        action: `WORKFLOW_${action}`,
        metadata,
      });

    // Log to document_workflow_history (new detailed history table)
    try {
      const { data: doc } = await this.supabase
        .from('documents')
        .select('status')
        .eq('id', documentId)
        .single();

      let actorName = 'System';
      let actorEmail = '';
      if (userId) {
        const { data: user } = await this.supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', userId)
          .single();
        
        if (user) {
          actorName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
          actorEmail = user.email || '';
        }
      }

      await this.supabase
        .from('document_workflow_history')
        .insert({
          tenant_id: tenantId,
          document_id: documentId,
          action,
          from_status: doc?.status || null,
          to_status: metadata.to_status || doc?.status || null,
          actor_name: actorName,
          actor_email: actorEmail,
          recipient_name: metadata.recipientName || metadata.recipient_name || null,
          recipient_email: metadata.recipientEmail || metadata.recipient_email || null,
          comments: metadata.comments || null,
        });
    } catch (error) {
      this.logger.warn(`Failed to log workflow history: ${error.message}`);
      // Don't throw - this is supplementary logging
    }
  }

  async getWorkflowHistory(req: any, documentId: string) {
    const tenantId = req.user.tenantId;
    
    const { data, error } = await this.supabase
      .from('document_workflow_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to get workflow history: ${error.message}`);
      // If table doesn't exist yet, return empty array
      if (error.message.includes('does not exist')) {
        return [];
      }
      throw new Error(error.message);
    }

    return data || [];
  }

  private async sendReviewRequestEmail(email: string, doc: any, requestedBy: any) {
    const subject = `Document Review Request: ${doc.title}`;
    const html = `
      <h2>Document Review Request</h2>
      <p>Hello,</p>
      <p><strong>${requestedBy.firstName || ''} ${requestedBy.lastName || ''}</strong> has requested your review for:</p>
      <ul>
        <li><strong>Document:</strong> ${doc.title}</li>
        <li><strong>Number:</strong> ${doc.document_number}</li>
        <li><strong>Type:</strong> ${doc.document_type}</li>
      </ul>
      <p>Please log in to the system to review and approve/reject this document.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://3.110.100.60'}/dashboard/documents" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Review Document</a></p>
    `;

    await this.emailService.sendEmail({ to: email, subject, html, from: 'admin', tenantId: doc.tenant_id });
  }

  private async sendApprovalRequestEmail(email: string, doc: any, requestedBy: any) {
    const subject = `Approval Request: ${doc.title}`;
    const html = `
      <h2>Document Approval Request</h2>
      <p>Hello,</p>
      <p><strong>${requestedBy.firstName || ''} ${requestedBy.lastName || ''}</strong> has submitted a document for your approval:</p>
      <ul>
        <li><strong>Document:</strong> ${doc.title}</li>
        <li><strong>Number:</strong> ${doc.document_number}</li>
        <li><strong>Type:</strong> ${doc.document_type}</li>
      </ul>
      <p>Please log in to the system to review and approve/reject this document.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://3.110.100.60'}/dashboard/documents" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Review Document</a></p>
    `;

    await this.emailService.sendEmail({ to: email, subject, html, from: 'admin', tenantId: doc.tenant_id });
  }

  private async sendClientReviewEmail(email: string, doc: any, options: any) {
    const subject = `Document for Review: ${doc.title}`;
    const html = `
      <h2>Document Review Request</h2>
      <p>Dear ${options.client_name},</p>
      ${options.message ? `<p>${options.message}</p>` : ''}
      <p>We have prepared a document for your review:</p>
      <ul>
        <li><strong>Document:</strong> ${doc.title}</li>
        <li><strong>Number:</strong> ${doc.document_number}</li>
      </ul>
      <p><strong>Actions you can take:</strong></p>
      <ol>
        <li><strong>View Document:</strong> <a href="${options.view_url}" style="color: #4F46E5;">Click here to view</a></li>
        <li><strong>Upload Revised Version:</strong> <a href="${options.upload_url}" style="color: #4F46E5;">Click here to upload</a></li>
        <li><strong>Reply to approve:</strong> Reply to this email with "APPROVED" to approve the document as-is</li>
      </ol>
      <p style="color: #666; font-size: 12px; margin-top: 30px;">This link will expire in 15 days.</p>
      <hr style="margin: 20px 0;">
    `;

    await this.emailService.sendEmail({ to: email, subject, html, from: 'admin', tenantId: doc.tenant_id });
  }

  private async sendRejectionEmail(email: string, doc: any, reason: string, rejectedBy: any) {
    const subject = `Document Rejected: ${doc.title}`;
    const html = `
      <h2 style="color: #DC2626;">Document Rejected</h2>
      <p>Hello,</p>
      <p>Your document has been rejected by <strong>${rejectedBy.firstName || ''} ${rejectedBy.lastName || ''}</strong>:</p>
      <ul>
        <li><strong>Document:</strong> ${doc.title}</li>
        <li><strong>Number:</strong> ${doc.document_number}</li>
      </ul>
      <p><strong>Reason:</strong></p>
      <p style="background-color: #FEE2E2; padding: 15px; border-left: 4px solid #DC2626;">${reason}</p>
      <p>Please make the necessary changes and resubmit.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://3.110.100.60'}/dashboard/documents" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Document</a></p>
    `;

    await this.emailService.sendEmail({ to: email, subject, html, from: 'admin', tenantId: doc.tenant_id });
  }

  private async sendClientUploadNotification(email: string, doc: any, revisionNumber: string) {
    const subject = `Client Uploaded New Version: ${doc.title}`;
    const html = `
      <h2>Client Upload Notification</h2>
      <p>Hello,</p>
      <p>The client has uploaded a new version of the document:</p>
      <ul>
        <li><strong>Document:</strong> ${doc.title}</li>
        <li><strong>Number:</strong> ${doc.document_number}</li>
        <li><strong>New Revision:</strong> ${revisionNumber}</li>
        <li><strong>Client:</strong> ${doc.metadata?.client_access?.client_name || 'Unknown'}</li>
      </ul>
      <p>The document status has been reset to "Pending Review". Please review the updated version.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://3.110.100.60'}/dashboard/documents" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Review Document</a></p>
    `;

    await this.emailService.sendEmail({ to: email, subject, html, from: 'admin', tenantId: doc.tenant_id });
  }
}
