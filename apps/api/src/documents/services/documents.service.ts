import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStorageService } from './supabase-storage.service';
import { OpenAIDocumentService } from './openai-document.service';
import { QuotePdfService } from './quote-pdf.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  constructor(
    private readonly storageService: SupabaseStorageService,
    private readonly openaiDocumentService: OpenAIDocumentService,
    private readonly quotePdfService: QuotePdfService,
  ) {}

  private async uploadBufferAsFile(params: {
    buffer: Buffer;
    fileName: string;
    mimetype: string;
    entityType: string;
    entityId: string;
  }) {
    const fakeFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: params.fileName,
      encoding: '7bit',
      mimetype: params.mimetype,
      size: params.buffer.length,
      buffer: params.buffer,
      destination: '',
      filename: '',
      path: '',
      stream: undefined as any,
    };

    return this.storageService.uploadFile(fakeFile, params.entityType, params.entityId);
  }

  private parseTags(tagsValue: any): string[] {
    if (Array.isArray(tagsValue)) return tagsValue;
    if (typeof tagsValue === 'string' && tagsValue.trim().length > 0) {
      return tagsValue
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    return [];
  }

  async generateQuote(req: any, dto: any) {
    const tenantId = req.user.tenantId;

    const nowIso = new Date().toISOString();
    const quoteDate = (dto.quote_date_iso || nowIso).toString();

    // Generate quote number if not provided
    let quoteNumber = (dto.quote_number || '').toString().trim();
    if (!quoteNumber) {
      // Use doc-number format but with QTE prefix
      const { data: lastDoc } = await this.supabase
        .from('documents')
        .select('document_number')
        .eq('tenant_id', tenantId)
        .like('document_number', 'QTE-%')
        .order('document_number', { ascending: false })
        .limit(1)
        .single();

      const lastNumber = lastDoc?.document_number
        ? parseInt(String(lastDoc.document_number).split('-')[1])
        : 0;
      quoteNumber = `QTE-${String(lastNumber + 1).padStart(6, '0')}`;
    }

    const title = (dto.title || 'Quotation').toString();
    const tags = this.parseTags(dto.tags);

    const pdfBuffer = await this.quotePdfService.renderQuotePdf(tenantId, {
      quote_number: quoteNumber,
      quote_date_iso: quoteDate,
      title,
      company: dto.company,
      customer: dto.customer,
      items: dto.items,
      currency: dto.currency,
      tax_rate: dto.tax_rate,
      discount: dto.discount,
      notes: dto.notes,
      terms: dto.terms,
    });

    const fileName = `${quoteNumber}.pdf`;
    const relatedEntityType = (dto.related_entity_type || 'quotes').toString() || 'quotes';
    const relatedEntityId = (dto.related_entity_id || quoteNumber).toString() || quoteNumber;

    const upload = await this.uploadBufferAsFile({
      buffer: pdfBuffer,
      fileName,
      mimetype: 'application/pdf',
      entityType: relatedEntityType,
      entityId: relatedEntityId,
    });

    const createDto = {
      title,
      description: dto.notes || '',
      document_type: 'QUOTE',
      category_id: dto.category_id || null,
      related_entity_type: dto.related_entity_type || relatedEntityType,
      related_entity_id: dto.related_entity_id || relatedEntityId,
      access_level: dto.access_level || 'INTERNAL',
      tags,
      file_url: upload.url,
      file_name: fileName,
      file_size: pdfBuffer.length,
      file_type: 'application/pdf',
      file_path: upload.path,
      document_number: quoteNumber,
      // Store the inputs for traceability
      metadata: {
        quote: {
          company: dto.company,
          customer: dto.customer,
          items: dto.items,
          currency: dto.currency,
          tax_rate: dto.tax_rate,
          discount: dto.discount,
          terms: dto.terms,
          notes: dto.notes,
          quote_date_iso: quoteDate,
        },
      },
    };

    // Create doc + initial revision, then enrich via PDF text extraction
    const doc = await this.create(req, createDto);

    try {
      const extractedText = await this.openaiDocumentService.extractTextFromPdfBuffer(pdfBuffer);
      if (extractedText) {
        const updatePayload: any = {
          ocr_text: extractedText,
          ocr_processed_at: new Date().toISOString(),
        };

        if (this.openaiDocumentService.isEnabled()) {
          const analysis = await this.openaiDocumentService.analyzeDocumentFromText(
            extractedText,
            fileName,
          );
          updatePayload.ai_classification = analysis.classification;
          updatePayload.ai_extracted_data = analysis.extractedData;
          updatePayload.ai_suggested_tags = analysis.suggestedTags;
        }

        await this.supabase
          .from('documents')
          .update(updatePayload)
          .eq('tenant_id', tenantId)
          .eq('id', doc.id);
      }
    } catch (error: any) {
      this.logger.warn(`Quote enrichment skipped/failed: ${error?.message || error}`);
    }

    return doc;
  }

  private async tryExtractTextFromFile(file: Express.Multer.File): Promise<string> {
    const mime = (file?.mimetype || '').toLowerCase();

    if (mime === 'application/pdf') {
      try {
        const mod: any = await import('pdf-parse');
        const pdfParse = mod?.default || mod;
        const parsed = await pdfParse(file.buffer);
        return String(parsed?.text || '').trim();
      } catch (error: any) {
        this.logger.warn(`PDF text extraction unavailable/failed: ${error?.message || error}`);
        return '';
      }
    }

    if (mime === 'text/plain') {
      try {
        return file.buffer.toString('utf8').trim();
      } catch {
        return '';
      }
    }

    return '';
  }

  private guessMimeType(fileName?: string, fileType?: string): string {
    if (fileType && String(fileType).trim().length > 0) {
      return String(fileType).toLowerCase();
    }
    const name = (fileName || '').toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.txt')) return 'text/plain';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    return '';
  }

  private async getDocumentForTenant(tenantId: string, id: string) {
    // Deployments may have slightly different schemas.
    // In particular, `documents.file_path` and `documents.metadata` may be absent.
    // We progressively retry with a smaller select list when PostgREST reports missing columns.
    const baseColumns = ['id', 'tenant_id', 'file_url', 'file_name', 'file_type', 'ocr_text'];
    const optionalColumns = ['file_path', 'metadata'];
    let columns = [...baseColumns, ...optionalColumns];

    for (let attempt = 0; attempt < 3; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await this.supabase
        .from('documents')
        .select(columns.join(', '))
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (!error) {
        if (!data) throw new Error('Document not found');
        return data as any;
      }

      const message = String((error as any)?.message || '').toLowerCase();
      const dropable = optionalColumns.find((col) => message.includes(col.toLowerCase()));
      if (dropable) {
        columns = columns.filter((c) => c !== dropable);
        continue;
      }

      throw new Error((error as any).message);
    }

    throw new Error('Failed to fetch document (schema mismatch)');
  }

  async getSignedUrl(req: any, id: string, expiresIn?: any) {
    const tenantId = req.user.tenantId;
    const doc = await this.getDocumentForTenant(tenantId, id);

    const requested = Number(expiresIn);
    const safeExpiresIn = Number.isFinite(requested)
      ? Math.min(60 * 60, Math.max(60, Math.floor(requested)))
      : 15 * 60;

    if (doc.file_path) {
      const url = await this.storageService.getSignedUrl(doc.file_path, safeExpiresIn);
      await this.logAccess(tenantId, id, req.user.userId, 'VIEW');
      return { url, expires_in: safeExpiresIn };
    }

    if (doc.file_url) {
      await this.logAccess(tenantId, id, req.user.userId, 'VIEW');
      return { url: doc.file_url, expires_in: safeExpiresIn };
    }

    throw new Error('No file_path or file_url available for this document');
  }

  async reanalyze(req: any, id: string) {
    const tenantId = req.user.tenantId;
    const doc = await this.getDocumentForTenant(tenantId, id);

    const mime = this.guessMimeType(doc.file_name, doc.file_type);
    const fileUrl = doc.file_url;
    const filePath = doc.file_path;
    const fileName = doc.file_name || 'document';

    const updatePayload: any = {};

    if (mime === 'application/pdf') {
      if (!filePath) {
        throw new Error('file_path is missing; cannot download PDF for analysis');
      }
      const buf = await this.storageService.downloadFile(filePath);
      const extractedText = await this.openaiDocumentService.extractTextFromPdfBuffer(buf);
      if (extractedText) {
        updatePayload.ocr_text = extractedText;
        updatePayload.ocr_processed_at = new Date().toISOString();
      }
      if (this.openaiDocumentService.isEnabled() && extractedText) {
        const analysis = await this.openaiDocumentService.analyzeDocumentFromText(
          extractedText,
          fileName,
        );
        updatePayload.ai_classification = analysis.classification;
        updatePayload.ai_extracted_data = analysis.extractedData;
        updatePayload.ai_suggested_tags = analysis.suggestedTags;
      }
    } else if (mime.startsWith('image/')) {
      if (!this.openaiDocumentService.isEnabled()) {
        throw new Error('OpenAI not configured; cannot OCR images');
      }

      const urlToUse = filePath
        ? await this.storageService.getSignedUrl(filePath, 15 * 60)
        : fileUrl;
      if (!urlToUse) {
        throw new Error('file_path/file_url is missing; cannot OCR image');
      }

      const ocrText = await this.openaiDocumentService.extractTextFromDocument(urlToUse);
      const analysis = await this.openaiDocumentService.analyzeDocument(urlToUse, fileName);
      updatePayload.ocr_text = ocrText;
      updatePayload.ocr_processed_at = new Date().toISOString();
      updatePayload.ai_classification = analysis.classification;
      updatePayload.ai_extracted_data = analysis.extractedData;
      updatePayload.ai_suggested_tags = analysis.suggestedTags;
    } else if (doc.ocr_text && this.openaiDocumentService.isEnabled()) {
      // Fallback: re-run analysis using existing extracted text
      const analysis = await this.openaiDocumentService.analyzeDocumentFromText(
        String(doc.ocr_text),
        fileName,
      );
      updatePayload.ai_classification = analysis.classification;
      updatePayload.ai_extracted_data = analysis.extractedData;
      updatePayload.ai_suggested_tags = analysis.suggestedTags;
    }

    if (Object.keys(updatePayload).length === 0) {
      return {
        ok: true,
        message:
          'Nothing to reanalyze (no supported file type or no extracted text available).',
      };
    }

    const { data, error } = await this.supabase
      .from('documents')
      .update(updatePayload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async qualityCheck(req: any, id: string) {
    try {
      const tenantId = req.user.tenantId;
      const doc = await this.getDocumentForTenant(tenantId, id);

      if (!this.openaiDocumentService.isEnabled()) {
        throw new ServiceUnavailableException(
          'OpenAI not configured; quality check is unavailable',
        );
      }

      const mime = this.guessMimeType(doc.file_name, doc.file_type);
      const fileName = doc.file_name || 'document';

      let text = (doc.ocr_text || '').trim();
      const extractionUpdate: any = {};

      if (!text) {
        if (mime === 'application/pdf' && doc.file_path) {
          const buf = await this.storageService.downloadFile(doc.file_path);
          text = (await this.openaiDocumentService.extractTextFromPdfBuffer(buf)).trim();
        } else if (mime.startsWith('image/')) {
          const urlToUse = doc.file_path
            ? await this.storageService.getSignedUrl(doc.file_path, 15 * 60)
            : doc.file_url;

          if (urlToUse) {
            text = (await this.openaiDocumentService.extractTextFromDocument(urlToUse)).trim();
          }
        }

        if (text) {
          extractionUpdate.ocr_text = text;
          extractionUpdate.ocr_processed_at = new Date().toISOString();
        }
      }

      const result = await this.openaiDocumentService.qualityCheckFromText(text, fileName);

    const qualityCheckedAt = new Date().toISOString();

    // Primary: store in `documents.metadata` if available.
    const existingMetadata =
      doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
    const newMetadata = {
      ...existingMetadata,
      quality_check: result,
      quality_checked_at: qualityCheckedAt,
    };

    let { error } = await this.supabase
      .from('documents')
      .update({
        ...extractionUpdate,
        metadata: newMetadata,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    // Backward-compat: some deployments don't have `documents.metadata`.
    // Fall back to storing the result in `ai_extracted_data`.
    if (
      error &&
      String((error as any).message || '').toLowerCase().includes('documents.metadata')
    ) {
      ({ error } = await this.supabase
        .from('documents')
        .update({
          ...extractionUpdate,
          ai_extracted_data: {
            quality_check: result,
            quality_checked_at: qualityCheckedAt,
          },
        })
        .eq('tenant_id', tenantId)
        .eq('id', id));
    }

    // Last resort: don't block the user from seeing results.
    if (error) {
      const msg = String((error as any).message || '').toLowerCase();
      if (msg.includes("could not find the") || msg.includes('does not exist')) {
        this.logger.warn(`Quality check result not persisted: ${(error as any).message}`);
      } else {
        throw new Error((error as any).message);
      }
    }

    return {
      ok: true,
      result,
    };
    } catch (error) {
      this.logger.error(`Quality check failed: ${error.message}`, error.stack);
      
      // Return a user-friendly error response instead of throwing
      if (error instanceof ServiceUnavailableException) {
        throw error; // Let NestJS handle this properly
      }
      
      throw new Error(`Quality check failed: ${error.message || 'Unknown error'}`);
    }
  }

  async uploadAndCreate(req: any, file: Express.Multer.File, body: any) {
    if (!file) {
      throw new Error('File is required');
    }

    const entityTypeRaw =
      body.related_entity_type || body.entityType || body.entity_type || 'general';
    const entityIdRaw =
      body.related_entity_id || body.entityId || body.entity_id || 'unlinked';

    const entityType = String(entityTypeRaw).trim() || 'general';
    const entityId = String(entityIdRaw).trim() || 'unlinked';

    const upload = await this.storageService.uploadFile(file, entityType, entityId);

    const tagsValue = body.tags;
    const tags = Array.isArray(tagsValue)
      ? tagsValue
      : typeof tagsValue === 'string' && tagsValue.trim().length > 0
        ? tagsValue
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

    const titleFromBody = typeof body.title === 'string' ? body.title.trim() : '';
    const createDto = {
      title: titleFromBody || file.originalname || 'Untitled',
      description: body.description,
      document_type: body.document_type || body.documentType || 'OTHER',
      category_id: body.category_id || body.categoryId || null,
      related_entity_type: body.related_entity_type || body.entityType || null,
      related_entity_id: body.related_entity_id || body.entityId || null,
      access_level: body.access_level || body.accessLevel || 'INTERNAL',
      tags,
      file_url: upload.url,
      file_name: file.originalname,
      file_size: file.size,
      file_type: file.mimetype,
      file_path: upload.path,
    };

    const doc = await this.create(req, createDto);

    // Best-effort text extraction + AI enrichment (do not fail upload if AI fails)
    try {
      const mime = (file.mimetype || '').toLowerCase();
      const extractedText = await this.tryExtractTextFromFile(file);
      const updatePayload: any = {};

      if (extractedText) {
        updatePayload.ocr_text = extractedText;
        updatePayload.ocr_processed_at = new Date().toISOString();
      }

      if (this.openaiDocumentService.isEnabled()) {
        if (mime.startsWith('image/')) {
          const signedUrl = await this.storageService.getSignedUrl(upload.path, 15 * 60);
          const ocrText = await this.openaiDocumentService.extractTextFromDocument(signedUrl);
          const analysis = await this.openaiDocumentService.analyzeDocument(signedUrl, file.originalname);
          updatePayload.ocr_text = ocrText;
          updatePayload.ocr_processed_at = new Date().toISOString();
          updatePayload.ai_classification = analysis.classification;
          updatePayload.ai_extracted_data = analysis.extractedData;
          updatePayload.ai_suggested_tags = analysis.suggestedTags;
        } else if (extractedText) {
          const analysis = await this.openaiDocumentService.analyzeDocumentFromText(extractedText, file.originalname);
          updatePayload.ai_classification = analysis.classification;
          updatePayload.ai_extracted_data = analysis.extractedData;
          updatePayload.ai_suggested_tags = analysis.suggestedTags;
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error } = await this.supabase
          .from('documents')
          .update(updatePayload)
          .eq('tenant_id', req.user.tenantId)
          .eq('id', doc.id);

        if (error) {
          this.logger.warn(`Document enrichment update failed: ${error.message}`);
          return doc;
        }

        return { ...doc, ...updatePayload };
      }
    } catch (error: any) {
      this.logger.warn(`Enrichment skipped/failed: ${error?.message || error}`);
    }

    return doc;
  }

  async uploadAndAddRevision(
    req: any,
    documentId: string,
    file: Express.Multer.File,
    body: any,
  ) {
    if (!file) {
      throw new Error('File is required');
    }

    const tenantId = req.user.tenantId;

    // Store revisions under documents/{documentId}/...
    const upload = await this.storageService.uploadFile(file, 'documents', documentId);

    const revisionNumber =
      body.revision_number || body.revisionNumber || body.revision || null;
    if (!revisionNumber) {
      throw new Error('revision_number is required');
    }

    const changeDescription = body.change_description || body.changeDescription || '';
    const revisionType = body.revision_type || body.revisionType || 'MINOR';

    const revision = await this.createRevision(tenantId, documentId, {
      revision_number: String(revisionNumber),
      file_url: upload.url,
      file_name: file.originalname,
      file_size: file.size,
      file_type: file.mimetype,
      file_path: upload.path,
      change_description: changeDescription,
      revision_type: revisionType,
      status: 'ACTIVE',
      created_by: req.user.userId,
      metadata: {
        file_path: upload.path,
        file_type: file.mimetype,
      },
    });

    // Update document with new revision number and file
    await this.supabase
      .from('documents')
      .update({
        current_revision: String(revisionNumber),
        file_url: upload.url,
        file_name: file.originalname,
        file_size: file.size,
        file_type: file.mimetype,
        file_path: upload.path,
      })
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    // Log access
    await this.logAccess(tenantId, documentId, req.user.userId, 'EDIT');

    // Best-effort AI enrichment on the document record
    try {
      const mime = (file.mimetype || '').toLowerCase();
      const extractedText = await this.tryExtractTextFromFile(file);
      const updatePayload: any = {};

      if (extractedText) {
        updatePayload.ocr_text = extractedText;
        updatePayload.ocr_processed_at = new Date().toISOString();
      }

      if (this.openaiDocumentService.isEnabled()) {
        if (mime.startsWith('image/')) {
          const signedUrl = await this.storageService.getSignedUrl(upload.path, 15 * 60);
          const ocrText = await this.openaiDocumentService.extractTextFromDocument(signedUrl);
          const analysis = await this.openaiDocumentService.analyzeDocument(signedUrl, file.originalname);
          updatePayload.ocr_text = ocrText;
          updatePayload.ocr_processed_at = new Date().toISOString();
          updatePayload.ai_classification = analysis.classification;
          updatePayload.ai_extracted_data = analysis.extractedData;
          updatePayload.ai_suggested_tags = analysis.suggestedTags;
        } else if (extractedText) {
          const analysis = await this.openaiDocumentService.analyzeDocumentFromText(extractedText, file.originalname);
          updatePayload.ai_classification = analysis.classification;
          updatePayload.ai_extracted_data = analysis.extractedData;
          updatePayload.ai_suggested_tags = analysis.suggestedTags;
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        await this.supabase
          .from('documents')
          .update(updatePayload)
          .eq('tenant_id', tenantId)
          .eq('id', documentId);
      }
    } catch (error: any) {
      this.logger.warn(
        `Enrichment skipped/failed (revision upload): ${error?.message || error}`,
      );
    }

    return revision;
  }

  async create(req: any, createDto: any) {
    const tenantId = req.user.tenantId;

    // Some deployments enforce NOT NULL on documents.title.
    // Ensure we always send a reasonable fallback.
    if (!createDto?.title || String(createDto.title).trim().length === 0) {
      createDto.title = createDto?.file_name || 'Untitled';
    }

    // Some deployments enforce NOT NULL on documents.document_type.
    if (!createDto?.document_type || String(createDto.document_type).trim().length === 0) {
      createDto.document_type = 'OTHER';
    }

    // Auto-generate document number if not provided
    if (!createDto.document_number) {
      const { data: lastDoc } = await this.supabase
        .from('documents')
        .select('document_number')
        .eq('tenant_id', tenantId)
        .like('document_number', 'DOC-%')
        .order('document_number', { ascending: false })
        .limit(1)
        .single();

      const lastNumber = lastDoc?.document_number
        ? parseInt(lastDoc.document_number.split('-')[1])
        : 0;
      createDto.document_number = `DOC-${String(lastNumber + 1).padStart(6, '0')}`;
    }

    const buildInsertRow = (payload: any) => ({
      ...payload,
      tenant_id: tenantId,
      created_by: req.user.userId,
      status: payload.status || 'DRAFT',
      current_revision: payload.current_revision || '1.0',
    });

    const stripKeyIfPresent = (obj: any, key: string) => {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete obj[key];
      }
    };

    const insertPayload: any = { ...createDto };
    let data: any;
    for (let attempt = 0; attempt < 4; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const { data: inserted, error } = await this.supabase
        .from('documents')
        .insert([buildInsertRow(insertPayload)])
        .select()
        .single();

      if (!error) {
        data = inserted;
        break;
      }

      const msg = String((error as any)?.message || '');
      const lower = msg.toLowerCase();
      // Common schema drift cases
      if (lower.includes('documents.metadata') || lower.includes("'metadata'") || lower.includes(' metadata ')) {
        stripKeyIfPresent(insertPayload, 'metadata');
        continue;
      }

      // Generic missing-column fallback: "column documents.<x> does not exist" or "Could not find the '<x>' column"
      const m1 = msg.match(/column\s+documents\.([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
      const m2 = msg.match(/Could not find the '([^']+)' column/i);
      const missing = (m1?.[1] || m2?.[1] || '').trim();
      if (missing) {
        stripKeyIfPresent(insertPayload, missing);
        continue;
      }

      throw new Error((error as any).message);
    }

    if (!data) throw new Error('Failed to create document');

    // Log access
    await this.logAccess(tenantId, data.id, req.user.userId, 'CREATE');

    // Create initial revision
    await this.createRevision(tenantId, data.id, {
      revision_number: data.current_revision,
      file_url: data.file_url,
      file_name: data.file_name,
      file_size: data.file_size,
      file_type: (data as any).file_type,
      file_path: (data as any).file_path,
      change_description: 'Initial version',
      revision_type: 'MAJOR',
      status: 'ACTIVE',
      created_by: req.user.userId,
    });

    return data;
  }

  async findAll(req: any, filters?: any) {
    const tenantId = req.user.tenantId;

    let query = this.supabase
      .from('documents')
      .select(`
        *,
        category:document_categories(id, name, code),
        created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email),
        approved_by_user:users!documents_approved_by_fkey(id, first_name, last_name, email)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.document_type) {
      query = query.eq('document_type', filters.document_type);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.category_id) {
      query = query.eq('category_id', filters.category_id);
    }

    if (filters?.related_entity_type) {
      query = query.eq('related_entity_type', filters.related_entity_type);
    }

    if (filters?.related_entity_id) {
      query = query.eq('related_entity_id', filters.related_entity_id);
    }

    if (filters?.uid_reference) {
      query = query.eq('uid_reference', filters.uid_reference);
    }

    if (filters?.search) {
      query = query.or(
        `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%,document_number.ilike.%${filters.search}%`,
      );
    }

    // Backward-compatible archive filter:
    // Production schema uses archived_at (timestamp) instead of is_archived (boolean).
    if (filters?.is_archived === true) {
      query = query.not('archived_at', 'is', null);
    } else {
      // Default: exclude archived
      query = query.is('archived_at', null);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return data;
  }

  async findOne(req: any, id: string) {
    const tenantId = req.user.tenantId;

    // `document_revisions.file_type` may not exist in some deployments.
    const selectWithFileType = `
        *,
        category:document_categories(id, name, code),
        created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email),
        reviewed_by_user:users!documents_reviewed_by_fkey(id, first_name, last_name, email),
        approved_by_user:users!documents_approved_by_fkey(id, first_name, last_name, email),
        revisions:document_revisions(
          id, revision_number, file_url, file_type, file_name, file_size,
          change_description, status, created_at,
          created_by_user:users(id, first_name, last_name)
        )
      `;

    const selectWithoutFileType = `
        *,
        category:document_categories(id, name, code),
        created_by_user:users!documents_created_by_fkey(id, first_name, last_name, email),
        reviewed_by_user:users!documents_reviewed_by_fkey(id, first_name, last_name, email),
        approved_by_user:users!documents_approved_by_fkey(id, first_name, last_name, email),
        revisions:document_revisions(
          id, revision_number, file_url, file_name, file_size,
          change_description, status, created_at,
          created_by_user:users(id, first_name, last_name)
        )
      `;

    let { data, error } = await this.supabase
      .from('documents')
      .select(selectWithFileType)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error && String((error as any).message || '').toLowerCase().includes('file_type')) {
      ({ data, error } = await this.supabase
        .from('documents')
        .select(selectWithoutFileType)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single());
    }

    if (error) throw new Error((error as any).message);

    // Log access
    await this.logAccess(tenantId, id, req.user.userId, 'VIEW');

    return data;
  }

  async update(req: any, id: string, updateDto: any) {
    const tenantId = req.user.tenantId;

    const { data, error } = await this.supabase
      .from('documents')
      .update(updateDto)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Log access
    await this.logAccess(tenantId, id, req.user.userId, 'EDIT');

    return data;
  }

  async delete(req: any, id: string) {
    const tenantId = req.user.tenantId;

    // Best-effort audit log (may fail if FK constraints exist and we delete rows later)
    try {
      await this.logAccess(tenantId, id, req.user.userId, 'DELETE');
    } catch {
      // ignore
    }

    const tryDeleteByDocumentId = async (table: string) => {
      // Some deployments don't have `tenant_id` on child tables, and some don't have `document_access_logs` at all.
      let { error } = await this.supabase
        .from(table)
        .delete()
        .eq('tenant_id', tenantId)
        .eq('document_id', id);

      const msg = String((error as any)?.message || '').toLowerCase();
      if (error && (msg.includes('tenant_id') || msg.includes("'tenant_id'"))) {
        ({ error } = await this.supabase.from(table).delete().eq('document_id', id));
      }

      // Ignore missing table/schema cache errors
      if (error) {
        const m = String((error as any)?.message || '').toLowerCase();
        if (m.includes("could not find the table") || m.includes('schema cache')) {
          return;
        }
        this.logger.warn(`Child delete warning for document ${id}: ${error.message}`);
      }
    };

    await tryDeleteByDocumentId('document_approvals');
    await tryDeleteByDocumentId('document_revisions');
    await tryDeleteByDocumentId('document_access_logs');

    const { error } = await this.supabase
      .from('documents')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new Error(error.message);

    return { message: 'Document deleted successfully' };
  }

  async createRevision(tenantId: string, documentId: string, revisionDto: any) {
    const insertPayload: any = {
      ...revisionDto,
      tenant_id: tenantId,
      document_id: documentId,
    };

    const stripKeyIfPresent = (obj: any, key: string) => {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete obj[key];
      }
    };

    let data: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      const { data: inserted, error } = await this.supabase
        .from('document_revisions')
        .insert([insertPayload])
        .select()
        .single();

      if (!error) {
        data = inserted;
        break;
      }

      const msg = String((error as any)?.message || '');
      const lower = msg.toLowerCase();
      if (lower.includes("'file_path'") || lower.includes('file_path')) {
        stripKeyIfPresent(insertPayload, 'file_path');
        continue;
      }
      if (lower.includes("'file_type'") || lower.includes('file_type')) {
        stripKeyIfPresent(insertPayload, 'file_type');
        continue;
      }
      if (lower.includes("'tenant_id'") || lower.includes('tenant_id')) {
        stripKeyIfPresent(insertPayload, 'tenant_id');
        continue;
      }

      const m2 = msg.match(/Could not find the '([^']+)' column/i);
      const missing = (m2?.[1] || '').trim();
      if (missing) {
        stripKeyIfPresent(insertPayload, missing);
        continue;
      }

      throw new Error((error as any).message);
    }

    if (!data) throw new Error('Failed to create document revision');

    // Mark previous revisions as superseded
    if (revisionDto.status === 'ACTIVE') {
      let { error } = await this.supabase
        .from('document_revisions')
        .update({ status: 'SUPERSEDED' })
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .neq('id', data.id);

      if (error && String((error as any).message || '').toLowerCase().includes('tenant_id')) {
        ({ error } = await this.supabase
          .from('document_revisions')
          .update({ status: 'SUPERSEDED' })
          .eq('document_id', documentId)
          .neq('id', data.id));
      }

      if (error) {
        this.logger.warn(`Failed to mark previous revisions as superseded: ${error.message}`);
      }
    }

    return data;
  }

  async addRevision(req: any, id: string, revisionDto: any) {
    const tenantId = req.user.tenantId;

    // Get current document
    const { data: doc } = await this.supabase
      .from('documents')
      .select('current_revision')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (!doc) throw new Error('Document not found');

    // Create new revision
    const revision = await this.createRevision(tenantId, id, {
      ...revisionDto,
      created_by: req.user.userId,
      status: 'ACTIVE',
    });

    // Update document with new revision number and file
    await this.supabase
      .from('documents')
      .update({
        current_revision: revisionDto.revision_number,
        file_url: revisionDto.file_url,
        file_name: revisionDto.file_name,
        file_size: revisionDto.file_size,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    // Log access
    await this.logAccess(tenantId, id, req.user.userId, 'EDIT');

    return revision;
  }

  async submitForApproval(req: any, id: string, approvalWorkflow: any) {
    const tenantId = req.user.tenantId;

    // Update document status
    await this.supabase
      .from('documents')
      .update({ status: 'PENDING_APPROVAL' })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    // Create approval workflow
    const approvalRecords = approvalWorkflow.approvers.map(
      (approver: any, index: number) => ({
        tenant_id: tenantId,
        document_id: id,
        approval_sequence: index + 1,
        approver_role_id: approver.role_id,
        approver_user_id: approver.user_id,
        is_mandatory: approver.is_mandatory ?? true,
        sla_hours: approver.sla_hours || 48,
        due_date: new Date(Date.now() + (approver.sla_hours || 48) * 60 * 60 * 1000),
        status: 'PENDING',
      }),
    );

    const { data, error } = await this.supabase
      .from('document_approvals')
      .insert(approvalRecords)
      .select();

    if (error) throw new Error(error.message);

    return data;
  }

  async approveDocument(req: any, id: string, approvalId: string, comments?: string) {
    const tenantId = req.user.tenantId;

    // Update approval record
    await this.supabase
      .from('document_approvals')
      .update({
        status: 'APPROVED',
        comments,
        responded_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', approvalId)
      .eq('approver_user_id', req.user.userId);

    // Check if all approvals are complete
    const { data: allApprovals } = await this.supabase
      .from('document_approvals')
      .select('status, is_mandatory')
      .eq('tenant_id', tenantId)
      .eq('document_id', id);

    const allApproved = allApprovals?.every(
      (a) => !a.is_mandatory || a.status === 'APPROVED' || a.status === 'SKIPPED',
    );

    if (allApproved) {
      // Update document status to approved
      await this.supabase
        .from('documents')
        .update({
          status: 'APPROVED',
          approved_by: req.user.userId,
          approved_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('id', id);
    }

    return { message: 'Document approved successfully' };
  }

  async rejectDocument(req: any, id: string, approvalId: string, reason: string) {
    const tenantId = req.user.tenantId;

    // Update approval record
    await this.supabase
      .from('document_approvals')
      .update({
        status: 'REJECTED',
        comments: reason,
        responded_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', approvalId)
      .eq('approver_user_id', req.user.userId);

    // Update document status
    await this.supabase
      .from('documents')
      .update({
        status: 'REJECTED',
        rejection_reason: reason,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    return { message: 'Document rejected' };
  }

  async archiveDocument(req: any, id: string) {
    const tenantId = req.user.tenantId;

    const { data, error } = await this.supabase
      .from('documents')
      .update({
        status: 'ARCHIVED',
        archived_at: new Date().toISOString(),
        archived_by: req.user.userId,
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Log access
    await this.logAccess(tenantId, id, req.user.userId, 'EDIT');

    return data;
  }

  async logAccess(
    tenantId: string,
    documentId: string,
    userId: string,
    action: string,
  ) {
    // Best-effort: some deployments don't have `document_access_logs`.
    try {
      const { error } = await this.supabase.from('document_access_logs').insert([
        {
          tenant_id: tenantId,
          document_id: documentId,
          user_id: userId,
          action,
        },
      ]);

      if (error) {
        const msg = String(error.message || '').toLowerCase();
        if (msg.includes("could not find the table") || msg.includes('schema cache')) return;
        // Don't throw; this should never block the main operation.
        this.logger.warn(`Access log insert skipped/failed: ${error.message}`);
      }
    } catch (e: any) {
      this.logger.warn(`Access log insert skipped/failed: ${e?.message || e}`);
    }
  }

  async getAccessLogs(req: any, documentId: string) {
    const tenantId = req.user.tenantId;

    const { data, error } = await this.supabase
      .from('document_access_logs')
      .select(`
        *,
        user:users(id, first_name, last_name, email)
      `)
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });

    if (error) {
      const msg = String((error as any).message || '').toLowerCase();
      if (msg.includes("could not find the table") || msg.includes('schema cache')) return [];
      throw new Error((error as any).message);
    }
    return data || [];
  }

  async getPendingApprovals(req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const { data, error } = await this.supabase
      .from('document_approvals')
      .select(`
        *,
        document:documents(id, document_number, title, document_type, current_revision)
      `)
      .eq('tenant_id', tenantId)
      .eq('approver_user_id', userId)
      .eq('status', 'PENDING')
      .order('due_date', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
  }
}
