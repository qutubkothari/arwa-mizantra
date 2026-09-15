import { formatVendorContactName, resolveVendorContactSalutation } from './world-class-po-pdf.service';

describe('PO vendor contact salutation', () => {
  it('uses the salutation belonging to the PO contact person', () => {
    const vendor = {
      contact_person: 'Kamlesh Gupta',
      metadata: {
        contacts: [
          { salutation: 'Ms.', name: 'Accounts Desk', isDefault: true },
          { salutation: 'Mr.', name: 'Kamlesh Gupta', isDefault: false },
        ],
      },
    };

    expect(resolveVendorContactSalutation(vendor)).toBe('Mr.');
    expect(formatVendorContactName(resolveVendorContactSalutation(vendor), vendor.contact_person))
      .toBe('Mr. Kamlesh Gupta');
  });

  it('falls back to the default contact and does not duplicate an existing salutation', () => {
    const vendor = {
      contact_person: 'Ms. Asha Khan',
      metadata: { contacts: [{ salutation: 'Ms.', name: 'Asha Khan', isDefault: true }] },
    };

    expect(resolveVendorContactSalutation(vendor)).toBe('Ms.');
    expect(formatVendorContactName('Ms.', vendor.contact_person)).toBe('Ms. Asha Khan');
  });
});
