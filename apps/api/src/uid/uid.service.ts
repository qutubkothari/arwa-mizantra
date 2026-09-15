import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';

interface UidConfig {
  tenantCode: string;
  plantCode: string;
  entityType: string;
  sequence?: number;
}

@Injectable()
export class UidService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a unique UID with format:
   * UID-{TENANT}-{PLANT}-{TYPE}-{SEQUENCE}-{CHECKSUM}
    * Example: UID-TEN-KOL-RM-000001-A7
   */
  async generateUid(config: UidConfig): Promise<string> {
    const { tenantCode, plantCode, entityType, sequence } = config;

    // Get next sequence number if not provided
    const seq = sequence || (await this.getNextSequence(tenantCode, plantCode, entityType));

    // Format sequence with leading zeros (6 digits)
    const seqStr = seq.toString().padStart(6, '0');

    // Generate checksum (simple 2-char hash for validation)
    const checksum = this.generateChecksum(`${tenantCode}${plantCode}${entityType}${seqStr}`);

    const uid = `UID-${tenantCode}-${plantCode}-${entityType}-${seqStr}-${checksum}`;

    return uid;
  }

  /**
   * Get next sequence number for entity type
   */
  private async getNextSequence(tenantCode: string, plantCode: string, entityType: string): Promise<number> {
    // In production, use atomic counter in Redis
    // For now, count from database
    const count = await this.prisma.uidRegistry.count({
      where: {
        uid: {
          startsWith: `UID-${tenantCode}-${plantCode}-${entityType}`,
        },
      },
    });
    return count + 1;
  }

  /**
   * Generate 2-character checksum
   */
  private generateChecksum(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash;
    }
    const checksum = Math.abs(hash).toString(36).toUpperCase().substring(0, 2);
    return checksum.padEnd(2, '0');
  }

  /**
   * Validate UID format and checksum
   */
  validateUid(uid: string): boolean {
    const uidPattern = /^UID-([A-Z0-9]{2,4})-([A-Z0-9]{2,3})-([A-Z0-9]{2})-(\d{6})-([A-Z0-9]{2})$/;
    const match = uid.match(uidPattern);

    if (!match) return false;

    const [, tenant, plant, type, seq, checksum] = match;
    const expectedChecksum = this.generateChecksum(`${tenant}${plant}${type}${seq}`);

    return checksum === expectedChecksum;
  }

  /**
   * Track UID lifecycle event
   */
  async trackLifecycleEvent(
    uid: string,
    stage: string,
    reference: string,
    location: string,
    metadata?: any,
  ): Promise<void> {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord) {
      throw new Error(`UID ${uid} not found`);
    }

    const lifecycle = Array.isArray(uidRecord.lifecycle) ? uidRecord.lifecycle : [];

    lifecycle.push({
      stage,
      timestamp: new Date().toISOString(),
      reference,
      location,
      metadata,
    });

    await this.prisma.uidRegistry.update({
      where: { uid },
      data: {
        lifecycle,
        location,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get all UIDs with filtering options
   */
  async getAllUids(status?: string, entityType?: string, itemId?: string) {
    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (itemId) {
      where.entityId = itemId;
    }

    const uids = await this.prisma.uidRegistry.findMany({
      where,
      select: {
        uid: true,
        entityType: true,
        entityId: true,
        status: true,
        location: true,
        batchNumber: true,
        qualityStatus: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 1000, // Limit for performance
    });

    return uids;
  }

  /**
   * Get UID details with vendor and item information for quality inspection
   */
  async getUidDetails(uid: string) {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord) {
      throw new Error(`UID ${uid} not found`);
    }

    // Fetch item details
    let itemDetails = null;
    if (uidRecord.entityId) {
      itemDetails = await this.prisma.item.findUnique({
        where: { id: uidRecord.entityId },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
        },
      });
    }

    // Fetch vendor details
    let vendorDetails = null;
    if (uidRecord.supplierId) {
      vendorDetails = await this.prisma.vendor.findUnique({
        where: { id: uidRecord.supplierId },
        select: {
          id: true,
          name: true,
          code: true,
        },
      });
    }

    // Return complete UID information for quality inspection
    return {
      uid: uidRecord.uid,
      grnId: uidRecord.grnId,
      itemId: uidRecord.entityId,
      itemName: itemDetails?.name || '',
      itemCode: itemDetails?.code || '',
      vendorId: uidRecord.supplierId,
      vendorName: vendorDetails?.name || '',
      vendorCode: vendorDetails?.code || '',
      batchNumber: uidRecord.batchNumber || '',
      lotNumber: '', // Add if you have lot_number field in uid_registry
      entityType: uidRecord.entityType,
      status: uidRecord.status,
      location: uidRecord.location,
      assemblyLevel: uidRecord.assemblyLevel,
      parentUids: uidRecord.parentUids,
      childUids: uidRecord.childUids,
      qualityStatus: uidRecord.qualityStatus,
      createdAt: uidRecord.createdAt,
    };
  }

  /**
   * Get UID history/traceability
   */
  async getUidHistory(uid: string) {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord) {
      throw new Error(`UID ${uid} not found`);
    }

    return {
      uid: uidRecord.uid,
      entityType: uidRecord.entityType,
      status: uidRecord.status,
      currentLocation: uidRecord.location,
      lifecycle: uidRecord.lifecycle,
      metadata: uidRecord.metadata,
      createdAt: uidRecord.createdAt,
    };
  }

  /**
   * Update client part number for UID
   */
  async updatePartNumber(
    uid: string,
    clientPartNumber: string,
    assignedBy: string,
  ): Promise<void> {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord) {
      throw new Error(`UID ${uid} not found`);
    }

    // Note: Requires database migration to add client_part_number field
    // Temporarily commented out until schema is updated
    // await this.prisma.uidRegistry.update({
    //   where: { uid },
    //   data: {
    //     clientPartNumber,
    //     partNumberAssignedAt: new Date(),
    //     partNumberAssignedBy: assignedBy,
    //     updatedAt: new Date(),
    //   },
    // });
  }

  /**
   * Search UIDs by part number
   */
  async searchByPartNumber(partNumber: string) {
    // Note: Requires database migration to add client_part_number field
    // Temporarily return empty array until schema is updated
    return [];
    
    // const uids = await this.prisma.uidRegistry.findMany({
    //   where: {
    //     clientPartNumber: {
    //       contains: partNumber,
    //       mode: 'insensitive',
    //     },
    //   },
    //   select: {
    //     uid: true,
    //     clientPartNumber: true,
    //     entityType: true,
    //     entityId: true,
    //     status: true,
    //     location: true,
    //     createdAt: true,
    //   },
    //   orderBy: {
    //     createdAt: 'desc',
    //   },
    // });
    // return uids;
  }
}
