'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { apiClient } from '../../lib/api-client';
import { getTodayDateInputValue } from '@/lib/date';
import SearchableSelect from './SearchableSelect';
import DateInput from './ui/DateInput';

export type RndVendorOption = {
  id: string;
  name: string;
  code?: string;
};

export type RndTemporaryItem = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  oem_part_no?: string | null;
  oem_name?: string | null;
  uom?: string;
  hsn_code?: string | null;
  standard_cost?: number | null;
  preferred_vendor_id?: string;
  preferred_vendor_name?: string;
  preferred_price?: number | null;
  effective_date?: string;
  is_temporary?: boolean;
};

type Props = {
  open: boolean;
  vendors: RndVendorOption[];
  onClose: () => void;
  onCreated: (item: RndTemporaryItem) => void | Promise<void>;
};

export default function RndTemporaryItemModal({ open, vendors, onClose, onCreated }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [oemName, setOemName] = useState('');
  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [preferredPrice, setPreferredPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setIdentifier('');
    setOemName('');
    setDescription('');
    setVendorId('');
    setEffectiveDate(getTodayDateInputValue());
    setHsnCode('');
    setPreferredPrice('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose, saving]);

  if (!open) return null;

  const temporaryItemNo = identifier.trim()
    ? `TEMP-${identifier.trim().replace(/\s+/g, '').replace(/^temp[-_]?/i, '')}`.toUpperCase()
    : 'TEMP-<OEM PART NUMBER>';

  const submit = async () => {
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier) {
      setError('Enter the SKU, Part No. or OEM No.');
      return;
    }
    const price = preferredPrice.trim() === '' ? null : Number(preferredPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError('Enter a valid preferred price');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const item = await apiClient.post<RndTemporaryItem>('/items/rnd-temporary', {
        identifier: cleanIdentifier,
        oem_name: oemName.trim() || null,
        description: description.trim() || null,
        vendor_id: vendorId || null,
        effective_date: effectiveDate || getTodayDateInputValue(),
        hsn_code: hsnCode.replace(/\D/g, ''),
        preferred_price: price,
      });
      await onCreated(item);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Unable to create the temporary R&D item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#3B2A1F]/55 p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-[#D8C8AA] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#E8DCC4] bg-[#FAF7F1] px-5 py-4">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg bg-[#E9F7F1] p-2 text-[#087A55]">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#3D2B1F]">Add Temporary R&amp;D Item</h2>
              <p className="mt-0.5 text-xs text-[#7A6555]">
                Lightweight purchasing item. Material Master, UID, drawing and reorder rules do not apply.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded p-1 text-[#7A6555] hover:bg-[#EFE7DA]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">OEM Part Number *</label>
            <input
              autoFocus
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Enter OEM / client part reference"
              className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#8B6F47]/20"
            />
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Temporary Item No.: <span className="font-mono font-semibold">{temporaryItemNo}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">OEM Name</label>
            <input
              value={oemName}
              onChange={(event) => setOemName(event.target.value)}
              placeholder="Enter OEM / manufacturer name"
              className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#8B6F47]/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Item Description</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Enter a short description of the R&D item"
              rows={3}
              className="w-full resize-y rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm focus:border-[#8B6F47] focus:outline-none focus:ring-2 focus:ring-[#8B6F47]/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Preferred Vendor</label>
            <SearchableSelect
              value={vendorId}
              onChange={setVendorId}
              options={vendors.map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
                subtitle: vendor.code || '',
              }))}
              placeholder="Optional: search active vendor"
              showSubtitleInInput={false}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Date</label>
              <DateInput
                value={effectiveDate}
                onChange={setEffectiveDate}
                className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">HSN Code</label>
              <input
                inputMode="numeric"
                maxLength={8}
                value={hsnCode}
                onChange={(event) => setHsnCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="Optional"
                className="w-full rounded-lg border border-[#D8C8AA] px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#5E4635]">Preferred Price</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm text-[#7A6555]">₹</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={preferredPrice}
                onChange={(event) => setPreferredPrice(event.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-[#D8C8AA] py-2.5 pl-8 pr-3 text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            This temporary item can be added to and submitted with an R&amp;D PR. The PR cannot be approved until the item is verified and active.
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#E8DCC4] bg-[#FAF9F6] px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[#D8C8AA] px-4 py-2 text-sm font-medium text-[#5E4635] hover:bg-white disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={saving} className="rounded-lg bg-[#8B6F47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6F5638] disabled:opacity-50">
            {saving ? 'Adding…' : 'Add & Select Item'}
          </button>
        </div>
      </div>
    </div>
  );
}
