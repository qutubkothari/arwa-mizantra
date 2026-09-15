import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

interface RFQItem {
  item_id: string;
  item_code: string;
  item_name: string;
  description?: string;
  requested_qty: number;
  uom: string;
  required_date?: string;
  specifications?: string;
}

interface RFQExcelData {
  prNumber: string;
  department: string;
  requiredDate: string;
  vendorName: string;
  vendorEmail: string;
  items: RFQItem[];
  responseDeadline?: string;
  remarks?: string;
}

@Injectable()
export class RfqExcelService {
  private formatDate(value?: string): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = String(date.getUTCFullYear()).slice(2);
    return `${day}/${month}/${year}`;
  }

  async generateRFQExcel(data: RFQExcelData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('RFQ Details');

    // Set column widths
    worksheet.columns = [
      { width: 5 },   // S.No
      { width: 15 },  // SAS Part Number
      { width: 30 },  // Item Name
      { width: 35 },  // Description
      { width: 12 },  // Quantity
      { width: 10 },  // UOM
      { width: 15 },  // Unit Price
      { width: 15 },  // Total Price
      { width: 20 },  // Remarks
    ];

    // Header Section
    worksheet.mergeCells('A1:I1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'REQUEST FOR QUOTATION';
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD97706' }, // Amber color
    };

    // RFQ Details
    let currentRow = 3;
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = 'PR Number:';
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.mergeCells(`C${currentRow}:E${currentRow}`);
    worksheet.getCell(`C${currentRow}`).value = data.prNumber;

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = 'Department:';
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.mergeCells(`C${currentRow}:E${currentRow}`);
    worksheet.getCell(`C${currentRow}`).value = data.department;

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = 'Required Date:';
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.mergeCells(`C${currentRow}:E${currentRow}`);
    worksheet.getCell(`C${currentRow}`).value = this.formatDate(data.requiredDate);

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = 'Vendor:';
    worksheet.getCell(`A${currentRow}`).font = { bold: true };
    worksheet.mergeCells(`C${currentRow}:E${currentRow}`);
    worksheet.getCell(`C${currentRow}`).value = data.vendorName;

    if (data.responseDeadline) {
      currentRow++;
      worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = 'Response Deadline:';
      worksheet.getCell(`A${currentRow}`).font = { bold: true };
      worksheet.mergeCells(`C${currentRow}:E${currentRow}`);
      worksheet.getCell(`C${currentRow}`).value = this.formatDate(data.responseDeadline);
    }

    // Items Table Header
    currentRow += 2;
    const headerRow = worksheet.getRow(currentRow);
    const headers = ['S.No', 'SAS Part Number', 'Item Name', 'Description', 'Quantity', 'UOM', 'Unit Price', 'Total Price', 'Remarks'];
    
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF92400E' }, // Dark amber
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Items Data
    currentRow++;
    data.items.forEach((item, index) => {
      const row = worksheet.getRow(currentRow + index);
      
      row.getCell(1).value = index + 1;
      row.getCell(2).value = item.item_code;
      row.getCell(3).value = item.item_name;
      row.getCell(4).value = item.description || item.specifications || '';
      row.getCell(5).value = item.requested_qty;
      row.getCell(6).value = item.uom;
      row.getCell(7).value = ''; // Unit Price - to be filled by vendor
      row.getCell(8).value = ''; // Total Price - to be filled by vendor
      row.getCell(9).value = ''; // Remarks - to be filled by vendor

      // Apply borders to all cells
      for (let col = 1; col <= 9; col++) {
        const cell = row.getCell(col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        
        // Center align S.No, Quantity, UOM
        if (col === 1 || col === 5 || col === 6) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      // Highlight editable cells (Unit Price, Total Price, Remarks)
      row.getCell(7).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' }, // Light yellow
      };
      row.getCell(8).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };
      row.getCell(9).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };
    });

    // Footer instructions
    currentRow += data.items.length + 2;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    const instructionCell = worksheet.getCell(`A${currentRow}`);
    instructionCell.value = 'Please fill in the Unit Price, Total Price, and Remarks columns and return this file.';
    instructionCell.font = { italic: true, color: { argb: 'FF92400E' } };
    instructionCell.alignment = { horizontal: 'center' };

    if (data.remarks) {
      currentRow += 2;
      worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = 'Additional Notes:';
      worksheet.getCell(`A${currentRow}`).font = { bold: true };
      worksheet.mergeCells(`C${currentRow}:I${currentRow}`);
      worksheet.getCell(`C${currentRow}`).value = data.remarks;
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  generateFilename(prNumber: string, vendorName: string): string {
    const sanitizedVendor = vendorName.replace(/[^a-z0-9]/gi, '_');
    const timestamp = new Date().toISOString().split('T')[0];
    return `RFQ_${prNumber}_${sanitizedVendor}_${timestamp}.xlsx`;
  }
}
