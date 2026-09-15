import { Injectable } from '@nestjs/common';
import Fuse from 'fuse.js';

export interface DuplicateMatch {
  id: string;
  matchScore: number;
  matchedFields: string[];
  data: any;
}

export interface DuplicateCheckResult {
  hasDuplicates: boolean;
  exactMatches: DuplicateMatch[];
  fuzzyMatches: DuplicateMatch[];
  message?: string;
}

@Injectable()
export class DuplicateDetectionService {
  /**
   * Check for exact matches on specified fields
   */
  checkExactDuplicates(
    newRecord: any,
    existingRecords: any[],
    exactMatchFields: string[],
    idField: string = 'id',
  ): DuplicateMatch[] {
    const duplicates: DuplicateMatch[] = [];

    for (const existing of existingRecords) {
      const matchedFields: string[] = [];

      for (const field of exactMatchFields) {
        const newValue = this.normalizeValue(newRecord[field]);
        const existingValue = this.normalizeValue(existing[field]);

        if (newValue && existingValue && newValue === existingValue) {
          matchedFields.push(field);
        }
      }

      if (matchedFields.length > 0) {
        duplicates.push({
          id: existing[idField],
          matchScore: 100,
          matchedFields,
          data: existing,
        });
      }
    }

    return duplicates;
  }

  /**
   * Check for fuzzy matches using Fuse.js (AI-based similarity)
   */
  checkFuzzyDuplicates(
    newRecord: any,
    existingRecords: any[],
    fuzzyMatchFields: string[],
    threshold: number = 0.3, // Lower = stricter (0.0 = exact, 1.0 = anything)
    idField: string = 'id',
  ): DuplicateMatch[] {
    if (existingRecords.length === 0) return [];

    const duplicates: DuplicateMatch[] = [];

    for (const field of fuzzyMatchFields) {
      const searchValue = newRecord[field];
      if (!searchValue) continue;

      const fuse = new Fuse(existingRecords, {
        keys: [field],
        threshold,
        includeScore: true,
      });

      const results = fuse.search(searchValue.toString());

      for (const result of results) {
        const matchScore = Math.round((1 - (result.score || 0)) * 100);
        
        // Only consider matches above 70% similarity
        if (matchScore >= 70) {
          const existingDuplicate = duplicates.find(d => d.id === result.item[idField]);
          
          if (existingDuplicate) {
            // Add field to existing duplicate
            if (!existingDuplicate.matchedFields.includes(field)) {
              existingDuplicate.matchedFields.push(field);
            }
            // Update score to highest match
            existingDuplicate.matchScore = Math.max(existingDuplicate.matchScore, matchScore);
          } else {
            duplicates.push({
              id: result.item[idField],
              matchScore,
              matchedFields: [field],
              data: result.item,
            });
          }
        }
      }
    }

    return duplicates;
  }

  /**
   * Comprehensive duplicate check combining exact and fuzzy matching
   */
  async checkDuplicates(
    newRecord: any,
    existingRecords: any[],
    config: {
      exactMatchFields?: string[];
      fuzzyMatchFields?: string[];
      fuzzyThreshold?: number;
      idField?: string;
      excludeId?: string; // Exclude this ID (for updates)
    },
  ): Promise<DuplicateCheckResult> {
    const {
      exactMatchFields = [],
      fuzzyMatchFields = [],
      fuzzyThreshold = 0.3,
      idField = 'id',
      excludeId,
    } = config;

    // Filter out the record being updated
    let records = existingRecords;
    if (excludeId) {
      records = records.filter(r => r[idField] !== excludeId);
    }

    if (records.length === 0) {
      return {
        hasDuplicates: false,
        exactMatches: [],
        fuzzyMatches: [],
      };
    }

    const exactMatches = exactMatchFields.length > 0
      ? this.checkExactDuplicates(newRecord, records, exactMatchFields, idField)
      : [];

    const fuzzyMatches = fuzzyMatchFields.length > 0
      ? this.checkFuzzyDuplicates(newRecord, records, fuzzyMatchFields, fuzzyThreshold, idField)
      : [];

    const hasDuplicates = exactMatches.length > 0 || fuzzyMatches.length > 0;

    let message = '';
    if (exactMatches.length > 0) {
      const fields = [...new Set(exactMatches.flatMap(m => m.matchedFields))];
      message = `Exact match found on: ${fields.join(', ')}`;
    } else if (fuzzyMatches.length > 0) {
      const topMatch = fuzzyMatches.reduce((max, m) => m.matchScore > max.matchScore ? m : max);
      message = `Similar record found (${topMatch.matchScore}% match)`;
    }

    return {
      hasDuplicates,
      exactMatches,
      fuzzyMatches,
      message,
    };
  }

  /**
   * Normalize value for comparison (trim, lowercase, remove special chars)
   */
  private normalizeValue(value: any): string {
    if (!value) return '';
    return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Check for duplicate items in an array (e.g., PO items)
   */
  checkArrayDuplicates(
    newItems: any[],
    existingItemsArray: any[][],
    itemMatchFields: string[],
  ): boolean {
    // Sort and stringify for comparison
    const normalizeItems = (items: any[]) => {
      return items
        .map(item => {
          const normalized: any = {};
          for (const field of itemMatchFields) {
            normalized[field] = this.normalizeValue(item[field]);
          }
          return JSON.stringify(normalized);
        })
        .sort()
        .join('|');
    };

    const newItemsStr = normalizeItems(newItems);

    for (const existingItems of existingItemsArray) {
      const existingItemsStr = normalizeItems(existingItems);
      if (newItemsStr === existingItemsStr) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate similarity percentage between two strings
   */
  calculateSimilarity(str1: string, str2: string): number {
    const s1 = this.normalizeValue(str1);
    const s2 = this.normalizeValue(str2);

    if (s1 === s2) return 100;
    if (!s1 || !s2) return 0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    const editDistance = this.levenshteinDistance(longer, shorter);
    const similarity = ((longer.length - editDistance) / longer.length) * 100;

    return Math.round(similarity);
  }

  /**
   * Levenshtein distance algorithm for string similarity
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}
