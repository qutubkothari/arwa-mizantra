import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface QueryResult {
  rows: any[];
}

@Injectable()
export class DatabaseService {
  constructor(private readonly prisma: PrismaService) {}

  async executeQuery(query: string, params: any[] = []): Promise<QueryResult> {
    try {
      // Convert PostgreSQL $1, $2, etc. to actual values for Prisma
      const result = await this.prisma.$queryRawUnsafe(query, ...params);
      return { rows: Array.isArray(result) ? result : [result] };
    } catch (error) {
      throw error;
    }
  }
}
