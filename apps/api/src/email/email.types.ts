// Helper file to make email services compile quickly
// TODO: Replace these with proper Prisma queries later

export interface EmailInboxRow {
  id: number;
  message_id: string;
  from_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  parsed_type?: string;
  related_entity?: string;
  related_entity_id?: number;
  [key: string]: any;
}

export interface EmailAttachmentRow {
  id: number;
  email_id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  storage_url?: string;
  is_parsed: boolean;
  [key: string]: any;
}
