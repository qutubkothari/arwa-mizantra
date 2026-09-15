export class ForwardDocumentDto {
  target_user_id?: string;
  target_role?: string;
  comments?: string;
}

export class RejectDocumentDto {
  reason: string;
  send_back_to?: string; // 'creator' | 'previous_reviewer'
}

export class SendToClientDto {
  client_email: string;
  client_name: string;
  message?: string;
  expiry_days?: number; // How many days the client link is valid
}

export class ClientUploadDto {
  token: string;
  comments?: string;
}
