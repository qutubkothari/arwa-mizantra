# World-Class Purchase Order Template

A professional, GST-compliant Purchase Order template with letterhead integration for SAK ERP.

## Features

### 🎨 Professional Design
- **Letterhead Integration**: Automatically uses your company letterhead PDF
- **Modern Layout**: Clean, organized sections with proper spacing
- **Color Scheme**: Professional brown/gold palette matching your brand
- **Multi-page Support**: Automatic pagination for large orders

### 📋 GST Compliance
- **HSN/SAC Codes**: Proper HSN code display for each item
- **Tax Breakdown**: Separate CGST/SGST/IGST calculations
- **GSTIN Display**: Both buyer and vendor GSTIN
- **Taxable Amount**: Clear breakdown of pre-tax and post-tax amounts

### 💼 Business Features
- **Vendor Details**: Complete vendor information with contact details
- **Delivery Address**: Separate delivery location display
- **Financial Summary**: 
  - Subtotal with discounts
  - Tax calculations (CGST/SGST/IGST)
  - TCS if applicable
  - Round-off adjustments
  - **Amount in Words**: Indian numbering system (Crores, Lakhs)

### 📜 Terms & Conditions
- Payment terms
- Delivery terms
- Freight and insurance terms
- Warranty conditions
- Inspection requirements
- Packaging specifications
- Validity period
- Custom special instructions

### ✍️ Authorization
- Three-level approval: Prepared By, Reviewed By, Approved By
- Digital signature support
- Company seal placeholder
- Professional footer with page numbers

## Setup Instructions

### 1. Place Your Letterhead

```bash
# Create assets directory
mkdir -p apps/api/assets

# Copy your letterhead PDF
cp "Downloads/Letter Head_260209_114851.pdf" apps/api/assets/letterhead.pdf
```

Or run the automated setup:

```bash
node setup-po-template.js
```

### 2. Update Purchase Module

The `WorldClassPoPdfService` is already created. To integrate:

```typescript
// In apps/api/src/purchase/purchase.module.ts
import { WorldClassPoPdfService } from './services/world-class-po-pdf.service';

@Module({
  providers: [
    // ... existing services
    WorldClassPoPdfService,
  ],
})
```

### 3. Add Controller Endpoint

```typescript
// In apps/api/src/purchase/controllers/purchase-orders.controller.ts
@Get(':id/pdf/v2')
async generateWorldClassPdf(@Param('id') id: string, @Res() res: Response) {
  const po = await this.purchaseOrdersService.findOne(id);
  
  const pdfData = {
    // Map your PO data to POPdfData interface
    poNumber: po.po_number,
    poDate: po.po_date,
    vendorName: po.vendor.name,
    // ... map all fields
  };
  
  const pdfBuffer = await this.worldClassPoPdfService.generatePOPdf(pdfData);
  const filename = this.worldClassPoPdfService.generateFilename(po.po_number);
  
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  
  res.send(pdfBuffer);
}
```

## Data Structure

### Required Fields

```typescript
{
  poNumber: string;          // PO-2026-001
  poDate: string;            // ISO date string
  vendorName: string;        // Vendor company name
  companyName: string;       // Your company name
  companyAddress: string;    // Your company address
  items: POItem[];           // Array of line items
  subtotal: number;          // Pre-discount subtotal
  taxableAmount: number;     // Post-discount, pre-tax amount
  grandTotal: number;        // Final amount including all taxes
}
```

### Optional but Recommended

```typescript
{
  // Vendor details
  vendorGSTIN: string;
  vendorAddress: string;
  vendorContactPerson: string;
  vendorEmail: string;
  vendorPhone: string;
  
  // Company details
  companyGSTIN: string;
  companyPAN: string;
  companyEmail: string;
  companyPhone: string;
  companyWebsite: string;
  
  // Terms
  paymentTerms: string;      // "30 days from invoice"
  deliveryDate: string;      // Expected delivery date
  terms: {
    delivery_terms: string;
    freight_terms: string;
    warranty_terms: string;
    // ... more terms
  };
  
  // Authorization
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
}
```

### Item Structure

```typescript
{
  item_code: string;
  item_name: string;
  hsn_code: string;          // For GST compliance
  quantity: number;
  uom: string;               // Unit of measure
  unit_price: number;
  discount_percent: number;
  cgst_rate: number;         // e.g., 9 for 9%
  sgst_rate: number;         // e.g., 9 for 9%
  igst_rate: number;         // For interstate, e.g., 18
  total_price: number;       // Final amount for this line
}
```

## Usage Examples

### Basic PO

```typescript
const basicPO = await worldClassPoPdfService.generatePOPdf({
  poNumber: 'PO-2026-001',
  poDate: new Date().toISOString(),
  vendorName: 'ABC Suppliers',
  companyName: 'SAK Automations',
  companyAddress: 'Your Address Here',
  items: [
    {
      item_code: 'ITEM-001',
      item_name: 'Steel Plate',
      hsn_code: '7208',
      quantity: 100,
      uom: 'Kg',
      unit_price: 50,
      cgst_rate: 9,
      sgst_rate: 9,
      taxable_amount: 5000,
      cgst_amount: 450,
      sgst_amount: 450,
      total_price: 5900,
    },
  ],
  subtotal: 5000,
  taxableAmount: 5000,
  cgstTotal: 450,
  sgstTotal: 450,
  grandTotal: 5900,
});
```

### Complete PO with All Features

```typescript
const completePO = await worldClassPoPdfService.generatePOPdf({
  poNumber: 'PO-2026-001',
  poDate: '2026-02-09',
  revision: 1,
  quotationRef: 'QUOT-2026-045',
  prNumber: 'PR-2026-123',
  
  vendorName: 'ABC Suppliers Ltd',
  vendorCode: 'VEND-001',
  vendorAddress: '123 Industrial Area',
  vendorCity: 'Mumbai',
  vendorState: 'Maharashtra',
  vendorPincode: '400001',
  vendorGSTIN: '27AABCU1234F1Z5',
  vendorContactPerson: 'Mr. John Doe',
  vendorEmail: 'john@abc.com',
  vendorPhone: '+91 98765 43210',
  
  companyName: 'SAK Automations',
  companyAddress: 'Your Company Address',
  companyCity: 'Chennai',
  companyState: 'Tamil Nadu',
  companyPincode: '600001',
  companyGSTIN: '33AABCS1234F1Z5',
  companyEmail: 'info@sakautomations.com',
  companyPhone: '+91 44 1234 5678',
  
  deliveryDate: '2026-03-15',
  paymentTerms: '30 days from invoice date',
  
  terms: {
    delivery_terms: 'FOB Destination',
    freight_terms: 'Prepaid and Add',
    warranty_terms: '12 months from installation',
    inspection_terms: 'Subject to final inspection',
    validity_days: 30,
  },
  
  items: [/* array of items */],
  
  subtotal: 100000,
  totalDiscount: 5000,
  taxableAmount: 95000,
  cgstTotal: 8550,
  sgstTotal: 8550,
  grandTotal: 112100,
  
  preparedBy: 'Purchase Manager',
  reviewedBy: 'Finance Manager',
  approvedBy: 'Managing Director',
  
  specialInstructions: 'Please ensure proper packaging for fragile items.',
  currency: 'INR',
});
```

## Output Features

The generated PDF includes:

1. **Professional Header** with company letterhead
2. **PO Reference Section** with PO number, date, quotation reference
3. **Two-column layout** for Vendor and Delivery address
4. **Detailed item table** with:
   - Serial number
   - Item code
   - Description
   - HSN code
   - Quantity and UOM
   - Rate
   - Discount %
   - Tax %
   - Amount
5. **Financial summary** with tax breakdown
6. **Amount in words** (Indian numbering)
7. **Terms & conditions** section
8. **Authorization signatures** (3-level approval)
9. **Professional footer** with page numbers
10. **Company seal** placeholder

## API Endpoints

### Generate PO PDF

```http
GET /api/purchase/orders/:id/pdf/v2
Authorization: Bearer <token>
```

Response: PDF file download

### Preview PO Data

```http
GET /api/purchase/orders/:id
Authorization: Bearer <token>
```

Returns JSON with all PO data that can be mapped to the PDF template.

## Customization

### Colors

Edit the `COLORS` object in `world-class-po-pdf.service.ts`:

```typescript
private readonly COLORS = {
  primary: rgb(0.435, 0.306, 0.216),    // Main heading color
  secondary: rgb(0.573, 0.251, 0.024),  // Accent color
  accent: rgb(0.851, 0.647, 0.125),     // Gold highlight
  // ... more colors
};
```

### Terms & Conditions

Modify the `standardTerms` array in `drawTermsAndConditions()` method.

### Signature Layout

Adjust the `drawSignatureSection()` method for different signature arrangements.

## Troubleshooting

### Letterhead not showing
- Check that `letterhead.pdf` exists in `apps/api/assets/`
- Ensure the PDF is not corrupted
- Check file permissions

### Missing fonts
- The service uses standard PDF fonts (Helvetica family)
- No external fonts need to be installed

### Tax calculations wrong
- Ensure all tax rates are passed correctly
- Check that taxable_amount is calculated properly
- Verify CGST + SGST = IGST rate for consistency

## License

Part of SAK ERP System - © 2026 SAK Automations
