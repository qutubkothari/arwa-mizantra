import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';

@Injectable()
export class OpenAIDocumentService {
  private readonly logger = new Logger(OpenAIDocumentService.name);
  private openai: OpenAI;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    
    if (apiKey && apiKey !== 'your_key_here') {
      this.openai = new OpenAI({ apiKey });
      this.enabled = true;
      this.logger.log('OpenAI document processing enabled');
    } else {
      this.enabled = false;
      this.logger.warn('OpenAI API key not configured - AI features disabled');
    }
  }

  /**
   * Check if OpenAI is configured and enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Extract text from document using GPT-4 Vision OCR
   * Only charges when called - pay per use
   */
  async extractTextFromDocument(fileUrl: string): Promise<string> {
    if (!this.enabled) {
      throw new Error('OpenAI not configured');
    }

    try {
      this.logger.log(`Starting OCR for document: ${fileUrl}`);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // Latest model with vision - cheaper than gpt-4-vision-preview
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract ALL text from this document. Return only the raw text content, maintaining the original structure and formatting as much as possible. Do not add any commentary or explanations.',
              },
              {
                type: 'image_url',
                image_url: { url: fileUrl },
              },
            ],
          },
        ],
        max_tokens: 4000,
      });

      const extractedText = response.choices[0]?.message?.content || '';
      
      this.logger.log(`OCR completed: ${extractedText.length} characters extracted`);
      
      return extractedText;
    } catch (error) {
      this.logger.error(`OCR extraction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract embedded text from a PDF buffer (no OpenAI required).
   * Note: This does not OCR scanned PDFs; it only extracts selectable text.
   */
  async extractTextFromPdfBuffer(pdfBuffer: Buffer): Promise<string> {
    try {
      const parsed = await pdfParse(pdfBuffer);
      return (parsed.text || '').trim();
    } catch (error: any) {
      this.logger.error(`PDF text extraction failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Classify document and extract structured data
   * Intelligent analysis with automatic classification
   */
  async analyzeDocument(fileUrl: string, fileName: string): Promise<{
    classification: {
      documentType: string;
      category: string;
      confidence: number;
    };
    extractedData: Record<string, any>;
    suggestedTags: string[];
  }> {
    if (!this.enabled) {
      throw new Error('OpenAI not configured');
    }

    try {
      this.logger.log(`Starting AI analysis for: ${fileName}`);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert document classifier for a manufacturing ERP system. Analyze documents and extract structured data.

CRITICAL CLASSIFICATION RULES:
1. **Technical Drawings/CAD Files**: If the document contains technical specifications, dimensions, tolerances, part numbers, assembly diagrams, circuit diagrams, or engineering drawings - classify as TECHNICAL_DRAWING, NOT as invoice/quotation/contract.
2. **Visual Indicators**: Technical drawings often have: dimension lines, views (front/side/top), material specifications, drawing numbers, revision history, tolerance callouts.
3. **Context Matters**: A document about a "drawing" or containing technical specifications is engineering documentation, not business documentation.

Document types to classify:
- TECHNICAL_DRAWING: CAD drawings, blueprints, engineering drawings, schematics, circuit diagrams, assembly drawings, part drawings (PRIORITY for any technical specs with dimensions)
- SPECIFICATION: Technical specs, datasheets, material specifications, design specifications
- QUOTATION: Price quotes, RFQs (only if primarily about pricing)
- PURCHASE_ORDER: Purchase orders (only if primarily about purchasing)
- INVOICE: Invoices, bills (only if primarily about billing)
- CONTRACT: Contracts, agreements
- REPORT: Reports, analysis
- CERTIFICATE: Quality certificates, test reports
- WARRANTY: Warranty documents
- CORRESPONDENCE: Emails, letters
- OTHER: Anything else

For TECHNICAL_DRAWING documents, extract:
- drawingNumber: Drawing or part number
- revisionNumber: Revision/version
- partName: Part or assembly name
- material: Material specifications
- dimensions: Key dimensions (if clearly stated)
- tolerances: Tolerance specifications
- views: Drawing views (front, side, top, etc.)
- scale: Drawing scale
- DO NOT extract: GST numbers, invoice dates, payment terms (these don't apply to technical drawings)

Return response as JSON:
{
  "documentType": "TECHNICAL_DRAWING",
  "category": "engineering",
  "confidence": 0.95,
  "extractedData": {
    "drawingNumber": "DRG-2025-001",
    "revisionNumber": "REV-B",
    "partName": "Motor Mount Assembly",
    "material": "Aluminum 6061-T6",
    "scale": "1:2",
    "dimensions": "100mm x 50mm x 25mm",
    "tolerances": "±0.1mm",
    "views": ["Front", "Side", "Top", "Isometric"]
  },
  "suggestedTags": ["mechanical", "assembly", "aluminum"]
}

For business documents (quotation/invoice/PO), extract:
{
  "documentType": "PURCHASE_ORDER",
  "category": "procurement",
  "confidence": 0.95,
  "extractedData": {
    "documentNumber": "PO-2025-001",
    "date": "2025-12-24",
    "vendor": "ABC Supplies",
    "amount": 15000,
    "currency": "USD",
    "items": [...],
    "dueDate": "2026-01-24",
    "gstNumber": "29XXXXX1234X1Z5" // Only for business docs
  },
  "suggestedTags": ["urgent", "electronics", "Q1-2026"]
}`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this document (filename: ${fileName}) and extract all relevant data. Return JSON only, no explanation.`,
              },
              {
                type: 'image_url',
                image_url: { url: fileUrl },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');

      this.logger.log(`AI analysis completed: ${result.documentType} (${result.confidence})`);

      return {
        classification: {
          documentType: result.documentType || 'OTHER',
          category: result.category || 'general',
          confidence: result.confidence || 0.5,
        },
        extractedData: result.extractedData || {},
        suggestedTags: result.suggestedTags || [],
      };
    } catch (error) {
      this.logger.error(`AI analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze a document from extracted text (useful for PDFs with embedded text)
   */
  async analyzeDocumentFromText(text: string, fileName: string): Promise<{
    classification: {
      documentType: string;
      category: string;
      confidence: number;
    };
    extractedData: Record<string, any>;
    suggestedTags: string[];
  }> {
    if (!this.enabled) {
      throw new Error('OpenAI not configured');
    }

    const clippedText = (text || '').trim().slice(0, 12000);
    if (!clippedText) {
      return {
        classification: { documentType: 'OTHER', category: 'general', confidence: 0.2 },
        extractedData: {},
        suggestedTags: [],
      };
    }

    try {
      this.logger.log(`Starting AI text analysis for: ${fileName}`);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert document classifier for a manufacturing ERP system. Analyze document text and extract structured data.

CRITICAL CLASSIFICATION RULES:
1. **Technical Drawings/CAD Files**: If the document contains technical specifications, dimensions, tolerances, part numbers, assembly diagrams, circuit diagrams, or engineering drawings - classify as TECHNICAL_DRAWING, NOT as invoice/quotation/contract.
2. **Visual Indicators**: Technical drawings often have: dimension lines, views (front/side/top), material specifications, drawing numbers, revision history, tolerance callouts.
3. **Context Matters**: A document about a "drawing" or containing technical specifications is engineering documentation, not business documentation.

Document types to classify:
- TECHNICAL_DRAWING: CAD drawings, blueprints, engineering drawings, schematics, circuit diagrams, assembly drawings, part drawings (PRIORITY for any technical specs with dimensions)
- SPECIFICATION: Technical specs, datasheets, material specifications, design specifications
- QUOTATION: Price quotes, RFQs (only if primarily about pricing)
- PURCHASE_ORDER: Purchase orders (only if primarily about purchasing)
- INVOICE: Invoices, bills (only if primarily about billing)
- CONTRACT: Contracts, agreements
- REPORT: Reports, analysis
- CERTIFICATE: Quality certificates, test reports
- WARRANTY: Warranty documents
- CORRESPONDENCE: Emails, letters
- OTHER: Anything else

For TECHNICAL_DRAWING documents, extract:
- drawingNumber: Drawing or part number
- revisionNumber: Revision/version
- partName: Part or assembly name
- material: Material specifications
- dimensions: Key dimensions (if clearly stated)
- tolerances: Tolerance specifications
- views: Drawing views (front, side, top, etc.)
- scale: Drawing scale
- DO NOT extract: GST numbers, invoice dates, payment terms (these don't apply to technical drawings)

Return response as JSON:
{
  "documentType": "TECHNICAL_DRAWING",
  "category": "engineering",
  "confidence": 0.95,
  "extractedData": {
    "drawingNumber": "DRG-2025-001",
    "revisionNumber": "REV-B",
    "partName": "Motor Mount Assembly",
    "material": "Aluminum 6061-T6",
    "scale": "1:2",
    "dimensions": "100mm x 50mm x 25mm",
    "tolerances": "±0.1mm",
    "views": ["Front", "Side", "Top", "Isometric"]
  },
  "suggestedTags": ["mechanical", "assembly", "aluminum"]
}

For business documents (quotation/invoice/PO), extract:
{
  "documentType": "PURCHASE_ORDER",
  "category": "procurement",
  "confidence": 0.95,
  "extractedData": {
    "documentNumber": "PO-2025-001",
    "date": "2025-12-24",
    "vendor": "ABC Supplies",
    "amount": 15000,
    "currency": "USD",
    "items": [],
    "dueDate": "2026-01-24",
    "gstNumber": "29XXXXX1234X1Z5" // Only for business docs
  },
  "suggestedTags": ["urgent", "electronics", "Q1-2026"]
}`,
          },
          {
            role: 'user',
            content: `Filename: ${fileName}

Analyze this extracted document text and return JSON only:

${clippedText}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{}');

      return {
        classification: {
          documentType: result.documentType || 'OTHER',
          category: result.category || 'general',
          confidence: result.confidence || 0.5,
        },
        extractedData: result.extractedData || {},
        suggestedTags: result.suggestedTags || [],
      };
    } catch (error) {
      this.logger.error(`AI text analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run a professionalism + consistency + compliance-ish quality check on text.
   * This is NOT legal advice; it flags potential issues for human review.
   */
  async qualityCheckFromText(
    text: string,
    fileName: string,
  ): Promise<{
    isSendable: boolean;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    summary: string;
    issues: Array<{
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
      type: string;
      message: string;
      quote?: string;
      suggestion?: string;
    }>;
    missingInfo: string[];
    disclaimers: string[];
  }> {
    if (!this.enabled) {
      throw new Error('OpenAI not configured');
    }

    const clippedText = (text || '').trim().slice(0, 16000);
    if (!clippedText) {
      return {
        isSendable: false,
        riskLevel: 'HIGH',
        summary: 'No text content available to review.',
        issues: [
          {
            severity: 'HIGH',
            type: 'missing_text',
            message: 'No readable text was extracted from the document.',
            suggestion: 'Upload an exported (text) PDF or provide a text version.',
          },
        ],
        missingInfo: ['Document text'],
        disclaimers: ['Not legal advice; requires human review.'],
      };
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional document QA reviewer.

Your job: Review ANY type of document (business, academic, technical, proposals, etc.) for quality, consistency, and professionalism.

CRITICAL INSTRUCTIONS:
1. FIRST identify the document type (invoice, proposal, technical spec, academic material, etc.)
2. THEN check for issues RELEVANT TO THAT DOCUMENT TYPE
3. Do NOT expect business fields (PO number, GSTIN, etc.) in non-business documents
4. Check dates carefully - today is ${new Date().toISOString().split('T')[0]}
5. Use cautious language ("may", "potential", "suggest")
6. Do NOT claim legal compliance or give legal advice

Return JSON only in this shape:
{
  "isSendable": true,
  "riskLevel": "LOW",
  "summary": "One-paragraph summary mentioning document type and key findings.",
  "issues": [
    {
      "severity": "LOW|MEDIUM|HIGH",
      "type": "inconsistency|missing_info|formatting|unprofessional|date_error|other",
      "message": "Describe the issue clearly.",
      "quote": "Optional short quote.",
      "suggestion": "Concrete fix if applicable."
    }
  ],
  "missingInfo": ["Only list missing fields that are REQUIRED for THIS document type"],
  "disclaimers": ["Context-appropriate disclaimer"]
}`,
        },
        {
          role: 'user',
          content: `Review this document for quality (filename: ${fileName}). Return JSON only.\n\nTEXT:\n${clippedText}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');

    return {
      isSendable: Boolean(result.isSendable),
      riskLevel: (result.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH') || 'MEDIUM',
      summary: result.summary || '',
      issues: Array.isArray(result.issues) ? result.issues : [],
      missingInfo: Array.isArray(result.missingInfo) ? result.missingInfo : [],
      disclaimers: Array.isArray(result.disclaimers)
        ? result.disclaimers
        : ['Not legal advice; requires human review.'],
    };
  }

  /**
   * Search documents by content similarity
   * Uses embeddings for semantic search
   */
  async searchBySimilarity(query: string, documents: Array<{ id: string; text: string }>): Promise<Array<{ id: string; score: number }>> {
    if (!this.enabled || documents.length === 0) {
      return [];
    }

    try {
      // Get embedding for search query
      const queryEmbedding = await this.openai.embeddings.create({
        model: 'text-embedding-3-small', // Cheaper embedding model
        input: query,
      });

      // Get embeddings for all documents (batch)
      const docTexts = documents.map(d => d.text.substring(0, 8000)); // Limit token count
      const docEmbeddings = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: docTexts,
      });

      // Calculate cosine similarity
      const queryVec = queryEmbedding.data[0].embedding;
      const results = documents.map((doc, idx) => {
        const docVec = docEmbeddings.data[idx].embedding;
        const similarity = this.cosineSimilarity(queryVec, docVec);
        return { id: doc.id, score: similarity };
      });

      // Sort by similarity score
      return results.sort((a, b) => b.score - a.score);
    } catch (error) {
      this.logger.error(`Similarity search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Auto-generate tags from document content
   */
  async generateTags(text: string, maxTags = 10): Promise<string[]> {
    if (!this.enabled || !text) {
      return [];
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Cheaper model for simple tasks
        messages: [
          {
            role: 'system',
            content: 'Extract relevant tags/keywords from document content. Return as JSON array of strings. Max 10 tags. Focus on: topics, entities, categories, industries, urgency.',
          },
          {
            role: 'user',
            content: `Extract tags from this text:\n\n${text.substring(0, 2000)}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 200,
      });

      const result = JSON.parse(response.choices[0]?.message?.content || '{"tags":[]}');
      return (result.tags || []).slice(0, maxTags);
    } catch (error) {
      this.logger.error(`Tag generation failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Estimate cost for OCR processing
   */
  estimateCost(pageCount: number): { ocr: number; analysis: number; total: number } {
    // gpt-4o pricing (as of Dec 2024):
    // Input: $2.50 per 1M tokens
    // Output: $10 per 1M tokens
    // Average: ~2000 tokens per page for OCR
    // Average: ~500 output tokens per page
    
    const inputTokensPerPage = 2000;
    const outputTokensPerPage = 500;
    
    const ocrCost = pageCount * ((inputTokensPerPage * 2.50 / 1000000) + (outputTokensPerPage * 10 / 1000000));
    const analysisCost = pageCount * ((inputTokensPerPage * 2.50 / 1000000) + (1000 * 10 / 1000000));
    
    return {
      ocr: Math.round(ocrCost * 100) / 100,
      analysis: Math.round(analysisCost * 100) / 100,
      total: Math.round((ocrCost + analysisCost) * 100) / 100,
    };
  }
}
