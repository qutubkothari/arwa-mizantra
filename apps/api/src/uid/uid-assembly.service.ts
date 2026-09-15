import { Injectable, ForbiddenException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service';

interface UidConfig {
  tenantCode: string;
  plantCode: string;
  entityType: string;
  sequence?: number;
}

interface AssemblyConfig {
  parentUids: string[];  // Parts being assembled
  workstation: string;
  assembledBy: string;   // User ID
  outputEntityType: string;
  outputEntityId: string;
}

interface UidTreeNode {
  uid: string;
  level: number;
  supplier?: {
    id: string;
    name: string;
  };
  purchaseDetails?: {
    poNumber: string;
    date: string;
    price: number;  // Only shown if user has permission
  };
  children: UidTreeNode[];
  qualityStatus?: string;
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
   * CRITICAL: Create UID from assembly of multiple parent parts
   * This tracks the hierarchical assembly process
   */
  async createAssemblyUid(
    tenantId: string,
    plantId: string,
    config: AssemblyConfig,
  ): Promise<string> {
    const { parentUids, workstation, assembledBy, outputEntityType, outputEntityId } = config;

    // Validate all parent UIDs exist
    const parents = await this.prisma.uidRegistry.findMany({
      where: {
        uid: { in: parentUids },
        tenantId,
      },
    });

    if (parents.length !== parentUids.length) {
      throw new Error('One or more parent UIDs not found');
    }

    // Calculate assembly level (max parent level + 1)
    const maxParentLevel = Math.max(...parents.map((p: any) => (p.assemblyLevel as number) || 0));
    const assemblyLevel = maxParentLevel + 1;

    // Get tenant and plant codes for UID generation
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const plant = await this.prisma.plant.findUnique({ where: { id: plantId } });

    if (!tenant || !plant) {
      throw new Error('Tenant or plant not found');
    }

    // Generate new UID for assembled part
    const newUid = await this.generateUid({
      tenantCode: tenant.code,
      plantCode: plant.code,
      entityType: outputEntityType,
    });

    // Create UID registry entry with assembly tracking
    await this.prisma.uidRegistry.create({
      data: {
        uid: newUid,
        tenantId,
        plantId,
        entityType: outputEntityType as any,
        entityId: outputEntityId,
        parentUids: parentUids,
        assemblyLevel,
        workstation,
        assembledBy,
        assemblyDate: new Date(),
        status: 'ACTIVE',
        lifecycle: [
          {
            stage: 'ASSEMBLY',
            timestamp: new Date().toISOString(),
            workstation,
            assembledBy,
            parentUids,
          },
        ],
      },
    });

    // Update parent UIDs to add this as a child
    await Promise.all(
      parentUids.map(async (parentUid) => {
        const parent = await this.prisma.uidRegistry.findUnique({
          where: { uid: parentUid },
        });
        
        if (!parent) {
          throw new Error(`Parent UID ${parentUid} not found`);
        }
        
        const currentChildren = Array.isArray(parent.childUids) ? parent.childUids : [];
        
        await this.prisma.uidRegistry.update({
          where: { uid: parentUid },
          data: {
            childUids: [...currentChildren, newUid],
            status: 'CONSUMED', // Mark as consumed in assembly
          },
        });
      }),
    );

    return newUid;
  }

  /**
   * Get complete assembly tree (hierarchical view)
   * Shows all parent parts down to raw materials
   */
  async getAssemblyTree(uid: string, userId: string, tenantId: string): Promise<UidTreeNode> {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord || uidRecord.tenantId !== tenantId) {
      throw new Error('UID not found');
    }

    // Check user permissions for price visibility
    const canViewPrice = await this.canViewPrice(userId, tenantId);

    return this.buildTreeNode(uidRecord, canViewPrice);
  }

  /**
   * Recursively build tree structure
   */
  private async buildTreeNode(uidRecord: any, canViewPrice: boolean): Promise<UidTreeNode> {
    const node: UidTreeNode = {
      uid: uidRecord.uid,
      level: uidRecord.assemblyLevel || 0,
      children: [],
      qualityStatus: uidRecord.qualityStatus,
    };

    // Add supplier info if this is a raw material (level 0)
    if (uidRecord.supplierId) {
      const supplier = await this.prisma.vendor.findUnique({
        where: { id: uidRecord.supplierId },
      });

      if (supplier) {
        node.supplier = {
          id: supplier.id,
          name: supplier.name,
        };

        // Add purchase details (with price only if permitted)
        if (uidRecord.purchaseOrderId) {
          const po = await this.prisma.purchaseOrder.findUnique({
            where: { id: uidRecord.purchaseOrderId },
          });

          if (po) {
            node.purchaseDetails = {
              poNumber: po.poNumber,
              date: po.orderDate.toISOString(),
              price: canViewPrice ? parseFloat(uidRecord.unitPrice?.toString() || '0') : undefined,
            } as any;
          }
        }
      }
    }

    // Recursively get parent parts
    const parentUids = Array.isArray(uidRecord.parentUids) ? uidRecord.parentUids : [];
    
    for (const parentUid of parentUids) {
      const parent = await this.prisma.uidRegistry.findUnique({
        where: { uid: parentUid as string },
      });

      if (parent) {
        const childNode = await this.buildTreeNode(parent, canViewPrice);
        node.children.push(childNode);
      }
    }

    return node;
  }

  /**
   * Find all products that used a specific faulty part
   * CRITICAL for recalls and quality issues
   */
  async findProductsUsingPart(faultyUid: string, tenantId: string): Promise<string[]> {
    const affectedProducts: string[] = [];

    // Get all UIDs that have this as a parent (direct children)
    const directChildren = await this.prisma.uidRegistry.findMany({
      where: {
        tenantId,
        parentUids: {
          array_contains: faultyUid,
        },
      },
    });

    for (const child of directChildren) {
      affectedProducts.push(child.uid);

      // Recursively find products that used this child
      const descendants = await this.findProductsUsingPart(child.uid, tenantId);
      affectedProducts.push(...descendants);
    }

    return [...new Set(affectedProducts)]; // Remove duplicates
  }

  /**
   * Track which supplier provided faulty part
   */
  async traceFaultyPartToSupplier(faultyUid: string, tenantId: string): Promise<any[]> {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid: faultyUid },
    });

    if (!uidRecord || uidRecord.tenantId !== tenantId) {
      throw new Error('UID not found');
    }

    // If this is an assembled part, trace back to raw materials
    if (uidRecord.assemblyLevel > 0) {
      const parentUids = Array.isArray(uidRecord.parentUids) ? uidRecord.parentUids : [];
      
      const suppliers: any[] = await Promise.all(
        parentUids.map(async (parentUid: string): Promise<any[]> => {
          return this.traceFaultyPartToSupplier(parentUid as string, tenantId);
        }),
      );

      return suppliers.flat();
    }

    // This is a raw material, get supplier
    if (uidRecord.supplierId) {
      const supplier = await this.prisma.vendor.findUnique({
        where: { id: uidRecord.supplierId },
      });

      if (!supplier) {
        return [];
      }

      const po = uidRecord.purchaseOrderId
        ? await this.prisma.purchaseOrder.findUnique({
            where: { id: uidRecord.purchaseOrderId },
          })
        : null;

      return [
        {
          uid: faultyUid,
          supplier: {
            id: supplier.id,
            name: supplier.name,
            code: supplier.code,
          },
          purchaseOrder: po
            ? {
                poNumber: po.poNumber,
                date: po.orderDate,
              }
            : null,
        },
      ];
    }

    return [];
  }

  /**
   * Mark part as defective and update quality status
   */
  async markAsDefective(
    uid: string,
    tenantId: string,
    defectDetails: {
      reason: string;
      detectedBy: string;
      detectedAt: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    },
  ) {
    const uidRecord = await this.prisma.uidRegistry.findUnique({
      where: { uid },
    });

    if (!uidRecord || uidRecord.tenantId !== tenantId) {
      throw new Error('UID not found');
    }

    const currentDefects = Array.isArray(uidRecord.defectNotes) ? uidRecord.defectNotes : [];

    await this.prisma.uidRegistry.update({
      where: { uid },
      data: {
        qualityStatus: 'FAILED',
        defectNotes: [
          ...currentDefects,
          {
            ...defectDetails,
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });

    // Find all products that used this part
    const affectedProducts = await this.findProductsUsingPart(uid, tenantId);

    return {
      markedAsDefective: uid,
      affectedProducts,
      affectedCount: affectedProducts.length,
    };
  }

  /**
   * Check if user can view price information
   */
  private async canViewPrice(userId: string, tenantId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });

    if (!user || user.tenantId !== tenantId) {
      return false;
    }

    // Check if user has OWNER, MANAGER, or ACCOUNTS role
    const canViewPriceRoles = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'ADMIN'];
    
    return user.roles.some((userRole: any) =>
      canViewPriceRoles.includes(userRole.role.code),
    );
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
      assemblyLevel: uidRecord.assemblyLevel,
      workstation: uidRecord.workstation,
      currentLocation: uidRecord.location,
      qualityStatus: uidRecord.qualityStatus,
      lifecycle: uidRecord.lifecycle,
      metadata: uidRecord.metadata,
      createdAt: uidRecord.createdAt,
    };
  }
}
