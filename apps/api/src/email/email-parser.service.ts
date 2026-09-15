import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../common/database.service';

export interface ParsedEmailData {
  type: string; // 'rfq_response', 'po_acknowledgment', 'customer_inquiry', etc.
  relatedEntity: string; // 'purchase_order', 'rfq', 'sales_order', etc.
  relatedEntityId: number | null;
  confidenceScore: number; // 0.00 to 1.00
  extractedData: any;
  suggestedActions: string[];
}

export interface ParsingRule {
  id: number;
  name: string;
  fromPattern: string;
  subjectPattern: string;
  bodyPattern: string;
  parsedType: string;
  relatedEntity: string;
  extractionRules: any;
  autoActions: any;
  priority: number;
}

@Injectable()
export class EmailParserService {
  private readonly logger = new Logger(EmailParserService.name);
  private parsingRules: ParsingRule[] = [];
  private rulesLoaded = false;

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Load parsing rules from database
   */
  async loadParsingRules(): Promise<void> {
    if (this.rulesLoaded) {
      return; // Already loaded
    }
    try {
      const result = await this.databaseService.executeQuery(
        `SELECT id, name, from_pattern, subject_pattern, body_pattern, 
                parsed_type, related_entity, extraction_rules, auto_actions, priority
         FROM email_parsing_rules 
         WHERE is_active = true 
         ORDER BY priority DESC`,
      );

      this.parsingRules = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fromPattern: row.from_pattern,
        subjectPattern: row.subject_pattern,
        bodyPattern: row.body_pattern,
        parsedType: row.parsed_type,
        relatedEntity: row.related_entity,
        extractionRules: row.extraction_rules,
        autoActions: row.auto_actions,
        priority: row.priority,
      }));

      this.rulesLoaded = true;
      this.logger.log(`Loaded ${this.parsingRules.length} email parsing rules`);
    } catch (error) {
      this.logger.error('Error loading parsing rules:', error);
      // Don't throw - allow service to continue with empty rules
    }
  }

  /**
   * Parse email and extract intelligent data
   */
  async parseEmail(emailId: number): Promise<ParsedEmailData> {
    // Ensure rules are loaded
    await this.loadParsingRules();
    try {
      // Get email from database
      const emailResult = await this.databaseService.executeQuery(
        `SELECT from_address, subject, body_text, body_html 
         FROM email_inbox 
         WHERE id = $1`,
        [emailId],
      );

      if (emailResult.rows.length === 0) {
        throw new Error(`Email ${emailId} not found`);
      }

      const email = emailResult.rows[0];
      const parsedData = await this.intelligentParse(
        email.from_address,
        email.subject,
        email.body_text || email.body_html,
      );

      // Update email with parsed data
      await this.databaseService.executeQuery(
        `UPDATE email_inbox 
         SET parsed_type = $1, 
             related_entity = $2, 
             related_entity_id = $3, 
             confidence_score = $4,
             parsed_data = $5,
             processing_status = $6,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [
          parsedData.type,
          parsedData.relatedEntity,
          parsedData.relatedEntityId,
          parsedData.confidenceScore,
          JSON.stringify(parsedData.extractedData),
          parsedData.confidenceScore > 0.7 ? 'processed' : 'manual_review',
          emailId,
        ],
      );

      this.logger.log(
        `Parsed email ${emailId}: type=${parsedData.type}, confidence=${parsedData.confidenceScore}`,
      );

      return parsedData;
    } catch (error) {
      this.logger.error(`Error parsing email ${emailId}:`, error);
      
      // Mark as failed
      await this.databaseService.executeQuery(
        `UPDATE email_inbox 
         SET processing_status = 'failed', 
             processing_notes = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [error.message, emailId],
      );

      throw error;
    }
  }

  /**
   * Intelligent parsing using rules
   */
  private async intelligentParse(
    fromAddress: string,
    subject: string,
    body: string,
  ): Promise<ParsedEmailData> {
    let bestMatch: ParsedEmailData | null = null;
    let highestConfidence = 0;

    // Try each parsing rule
    for (const rule of this.parsingRules) {
      const confidence = this.calculateRuleMatch(rule, fromAddress, subject, body);

      if (confidence > highestConfidence) {
        highestConfidence = confidence;

        // Extract data using rule's extraction rules
        const extractedData = this.extractDataUsingRule(rule, subject, body);

        // Find related entity ID
        const relatedEntityId = await this.findRelatedEntityId(
          rule.relatedEntity,
          extractedData,
        );

        bestMatch = {
          type: rule.parsedType,
          relatedEntity: rule.relatedEntity,
          relatedEntityId,
          confidenceScore: confidence,
          extractedData,
          suggestedActions: this.getSuggestedActions(rule),
        };
      }
    }

    // If no rule matched well, classify as generic
    if (!bestMatch || highestConfidence < 0.3) {
      return {
        type: 'general',
        relatedEntity: 'none',
        relatedEntityId: null,
        confidenceScore: 0.1,
        extractedData: { subject, preview: body.substring(0, 200) },
        suggestedActions: ['manual_review'],
      };
    }

    return bestMatch;
  }

  /**
   * Calculate how well a rule matches the email
   */
  private calculateRuleMatch(
    rule: ParsingRule,
    fromAddress: string,
    subject: string,
    body: string,
  ): number {
    let score = 0;
    let totalChecks = 0;

    // Check from pattern
    if (rule.fromPattern) {
      totalChecks++;
      try {
        const regex = new RegExp(rule.fromPattern, 'i');
        if (regex.test(fromAddress)) {
          score += 1;
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    // Check subject pattern
    if (rule.subjectPattern) {
      totalChecks++;
      try {
        const regex = new RegExp(rule.subjectPattern, 'i');
        if (regex.test(subject)) {
          score += 1;
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    // Check body pattern
    if (rule.bodyPattern) {
      totalChecks++;
      try {
        const regex = new RegExp(rule.bodyPattern, 'i');
        if (regex.test(body)) {
          score += 1;
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    return totalChecks > 0 ? score / totalChecks : 0;
  }

  /**
   * Extract structured data from email using rule's extraction patterns
   */
  private extractDataUsingRule(rule: ParsingRule, subject: string, body: string): any {
    const extracted: any = {};
    const extractionRules = rule.extractionRules || {};
    const combinedText = `${subject} ${body}`;

    for (const [key, pattern] of Object.entries(extractionRules)) {
      try {
        const regex = new RegExp(pattern as string, 'i');
        const match = combinedText.match(regex);
        if (match) {
          extracted[key] = match[0];
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    return extracted;
  }

  /**
   * Find related entity ID in database
   */
  private async findRelatedEntityId(
    entityType: string,
    extractedData: any,
  ): Promise<number | null> {
    try {
      switch (entityType) {
        case 'purchase_order':
          return await this.findPurchaseOrderId(extractedData);
        case 'rfq':
          return await this.findRFQId(extractedData);
        case 'sales_order':
          return await this.findSalesOrderId(extractedData);
        case 'grn':
          return await this.findGRNId(extractedData);
        default:
          return null;
      }
    } catch (error) {
      this.logger.error(`Error finding ${entityType} ID:`, error);
      return null;
    }
  }

  private async findPurchaseOrderId(data: any): Promise<number | null> {
    if (data.po_number) {
      const result = await this.databaseService.executeQuery(
        'SELECT id FROM purchase_orders WHERE po_number = $1',
        [data.po_number],
      );
      return result.rows[0]?.id || null;
    }
    return null;
  }

  private async findRFQId(data: any): Promise<number | null> {
    if (data.rfq_number) {
      const result = await this.databaseService.executeQuery(
        'SELECT id FROM purchase_requisitions WHERE pr_number = $1',
        [data.rfq_number],
      );
      return result.rows[0]?.id || null;
    }
    return null;
  }

  private async findSalesOrderId(data: any): Promise<number | null> {
    if (data.so_number) {
      const result = await this.databaseService.executeQuery(
        'SELECT id FROM sales_orders WHERE so_number = $1',
        [data.so_number],
      );
      return result.rows[0]?.id || null;
    }
    return null;
  }

  private async findGRNId(data: any): Promise<number | null> {
    if (data.grn_number || data.invoice_number) {
      const result = await this.databaseService.executeQuery(
        'SELECT id FROM grns WHERE grn_number = $1 OR invoice_number = $2',
        [data.grn_number, data.invoice_number],
      );
      return result.rows[0]?.id || null;
    }
    return null;
  }

  /**
   * Get suggested actions from rule
   */
  private getSuggestedActions(rule: ParsingRule): string[] {
    const actions: string[] = [];
    const autoActions = rule.autoActions || {};

    if (autoActions.notify_purchase_team) actions.push('notify_purchase_team');
    if (autoActions.notify_sales_team) actions.push('notify_sales_team');
    if (autoActions.notify_accounts_team) actions.push('notify_accounts_team');
    if (autoActions.create_task) actions.push('create_task');
    if (autoActions.update_po_status) actions.push('update_po_status');
    if (autoActions.create_payable) actions.push('create_payable');

    return actions;
  }

  /**
   * Execute auto actions
   */
  async executeAutoActions(emailId: number, actions: string[]): Promise<void> {
    this.logger.log(`Executing ${actions.length} auto actions for email ${emailId}`);

    for (const action of actions) {
      try {
        switch (action) {
          case 'notify_purchase_team':
            // TODO: Send notification to purchase team
            this.logger.log('Would notify purchase team');
            break;
          case 'notify_sales_team':
            // TODO: Send notification to sales team
            this.logger.log('Would notify sales team');
            break;
          case 'create_task':
            // TODO: Create task in task management system
            this.logger.log('Would create task');
            break;
          default:
            this.logger.warn(`Unknown action: ${action}`);
        }
      } catch (error) {
        this.logger.error(`Error executing action ${action}:`, error);
      }
    }
  }

  /**
   * Batch parse pending emails
   */
  async batchParsePendingEmails(limit: number = 50): Promise<number> {
    try {
      const result = await this.databaseService.executeQuery(
        `SELECT id FROM email_inbox 
         WHERE processing_status = 'pending' 
         ORDER BY received_date DESC 
         LIMIT $1`,
        [limit],
      );

      let parsedCount = 0;

      for (const row of result.rows) {
        try {
          const parsedData = await this.parseEmail(row.id);
          
          // Execute auto actions if confidence is high
          if (parsedData.confidenceScore > 0.7) {
            await this.executeAutoActions(row.id, parsedData.suggestedActions);
          }

          parsedCount++;
        } catch (error) {
          this.logger.error(`Failed to parse email ${row.id}:`, error);
        }
      }

      this.logger.log(`Batch parsed ${parsedCount} emails`);
      return parsedCount;
    } catch (error) {
      this.logger.error('Error in batch parsing:', error);
      throw error;
    }
  }
}
