"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Download,
  Edit,
  ExternalLink,
  Eye,
  FileText,
  Plus,
  Save,
  Paperclip,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "../../../../../lib/api-client";
import DuplicateWarning, {
  useDuplicateDetection,
} from "../../../../components/DuplicateWarning";
import SearchableSelect from "../../../../components/SearchableSelect";
import { confirmDialog } from "../../../../components/ui/ConfirmDialog";
import {
  ErpButton,
  ErpMetricStrip,
  ErpPageHeader,
  ErpStatusBadge,
} from "../../../../components/ui/ErpPrimitives";
import {
  ListTable,
  type ListTableColumn,
} from "../../../../components/ui/ListTable";
import { SlidePanel } from "../../../../components/ui/SlidePanel";
import { exportToExcel } from "../../../../lib/export-excel";
import { hasMakerCheckerOverride, hasModulePermission, isAdminLike } from "@/lib/rbac";
import { useAuthStore } from "@/stores/auth.store";

interface VendorContact {
  salutation?: string;
  name: string;
  phone: string;
  email: string;
  isDefault?: boolean;
}

interface GstVerificationResult {
  gstin?: string;
  valid?: boolean;
  portalVerified?: boolean;
  legalNameMatch?: boolean | null;
  verificationMode?: string;
  message?: string;
  details?: {
    stateName?: string | null;
    pan?: string | null;
    portalLegalName?: string | null;
    portalTradeName?: string | null;
    portalStatus?: string | null;
    portalAddress?: {
      addressLine?: string;
      street?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
      fullAddress?: string;
    } | null;
  };
}

interface Vendor {
  id: string;
  code: string;
  name: string;
  legal_name: string;
  tax_id?: string;
  category: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  billing_line2?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  payment_terms: string;
  credit_limit: number;
  rating: number;
  is_active: boolean;
  is_verified?: boolean;
  verified_at?: string | null;
  verified_by?: string | null;
  approval_status?: string;
  approval_reason?: string | null;
  approval_trail?: Array<Record<string, any>>;
  approval_history?: Array<Record<string, any>>;
  attachments?: Array<{
    id: string;
    document_type: string;
    file_name: string;
    file_url: string;
    uploaded_at?: string;
    status?: string;
  }>;
  created_by?: string | null;
  bank_verification_status?: string;
  bank_verification?: {
    status?: string;
    message?: string;
    bankName?: string | null;
    branch?: string | null;
    source?: string;
    verifiedAt?: string;
  } | null;
  contacts?: VendorContact[];
  gst_verification?: GstVerificationResult | null;
  salutation?: string;
  country_code?: string;
  bank_name?: string;
  bank_account_number?: string;
  bank_ifsc_code?: string;
  bank_branch?: string;
  bank_account_type?: string;
  metadata?: Record<string, any>;
}

type VendorImportFile = {
  id: string;
  import_number?: string;
  status?: string;
  currency?: string;
  final_landed_cost?: number;
  po?: { po_number?: string };
  costs?: any[];
  documents?: any[];
  grns?: any[];
  payments?: any[];
};

type VendorContactForm = Required<
  Pick<VendorContact, "name" | "phone" | "email" | "isDefault">
> & {
  salutation: string;
};

type VendorFormState = {
  salutation: string;
  name: string;
  legalName: string;
  taxId: string;
  category: string;
  address: string;
  billingLine2: string;
  street: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  pincode: string;
  paymentTerms: string;
  creditLimit: number;
  rating: number;
  isActive: boolean;
  contacts: VendorContactForm[];
  gstVerification: GstVerificationResult | null;
  bankName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  bankBranch: string;
  bankAccountType: string;
};

type FormSection =
  | "business"
  | "tax-address"
  | "contacts"
  | "commercial"
  | "bank"
  | "review";

const FORM_SECTIONS: Array<{ id: FormSection; label: string }> = [
  { id: "business", label: "Business" },
  { id: "tax-address", label: "Tax & Address" },
  { id: "contacts", label: "Contacts / Email" },
  { id: "commercial", label: "Commercial" },
  { id: "bank", label: "Bank" },
  { id: "review", label: "Review" },
];

const CATEGORY_OPTIONS = [
  { value: "RAW_MATERIAL", label: "Raw Material" },
  { value: "COMPONENTS", label: "Components" },
  { value: "COMPONENT", label: "Component" },
  { value: "SERVICE", label: "Service" },
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "SUBCONTRACTOR", label: "Subcontractor" },
  { value: "OTHER", label: "Other" },
];

const PAYMENT_TERM_OPTIONS = [
  { value: "NET_30", label: "Net 30" },
  { value: "NET_60", label: "Net 60" },
  { value: "NET_90", label: "Net 90" },
  { value: "ADVANCE", label: "Advance" },
  { value: "COD", label: "Cash on Delivery" },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: "CURRENT", label: "Current" },
  { value: "SAVINGS", label: "Savings" },
  { value: "CC", label: "Cash Credit" },
  { value: "OD", label: "Overdraft" },
];

const BUSINESS_PREFIX_OPTIONS = ["", "M/s.", "Messrs.", "The"].map((value) => ({
  value,
  label: value || "No prefix",
}));

const CONTACT_TITLE_OPTIONS = ["", "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "Er.", "Adv.", "CA"].map((value) => ({
  value,
  label: value || "No title",
}));

const COUNTRY_CODE_OPTIONS = [
  "+91",
  "+1",
  "+44",
  "+971",
  "+65",
  "+60",
  "+61",
  "+49",
  "+81",
  "+86",
].map((value) => ({
  value,
  label: value,
}));

const FILTER_CATEGORY_OPTIONS = [
  { value: "ALL", label: "All categories" },
  ...CATEGORY_OPTIONS,
];
const FILTER_STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];
const FILTER_VERIFICATION_OPTIONS = [
  { value: "ALL", label: "All verification" },
  { value: "VERIFIED", label: "Verified" },
  { value: "PENDING", label: "Pending verification" },
  { value: "REJECTED", label: "Rejected" },
];

const VENDOR_DOCUMENT_CHECKLIST = [
  { type: "GST", label: "GST Certificate" },
  { type: "PAN", label: "PAN" },
  { type: "MSME", label: "MSME" },
  { type: "CANCELLED_CHEQUE", label: "Cancelled Cheque" },
];

const inputClass =
  "min-h-10 w-full rounded-md border border-[#D8C8AA] bg-white px-3 py-2 text-sm text-[#4A3426] outline-none transition focus:border-[#8B6F47] focus:ring-2 focus:ring-[#F5EFE3] disabled:bg-[#F5EFE3]";
const labelClass = "mb-1.5 block text-sm font-medium text-[#5E4635]";
const MAX_VENDOR_CREDIT_LIMIT = 9999999999999.99;

function toBoundedNumber(value: string, min: number, max: number) {
  if (value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(min, parsed));
}

function createEmptyContact(isDefault = false): VendorContactForm {
  return { salutation: "", name: "", phone: "", email: "", isDefault };
}

function createInitialFormState(): VendorFormState {
  return {
    salutation: "",
    name: "",
    legalName: "",
    taxId: "",
    category: "RAW_MATERIAL",
    address: "",
    billingLine2: "",
    street: "",
    city: "",
    state: "",
    country: "India",
    countryCode: "+91",
    pincode: "",
    paymentTerms: "NET_30",
    creditLimit: 0,
    rating: 0,
    isActive: true,
    contacts: [createEmptyContact(true)],
    gstVerification: null,
    bankName: "",
    bankAccountNumber: "",
    bankIfscCode: "",
    bankBranch: "",
    bankAccountType: "CURRENT",
  };
}

function normalizeContacts(contacts?: VendorContact[]): VendorContactForm[] {
  const normalized = (contacts || [])
    .map((contact) => ({
      salutation: String(contact.salutation || ""),
      name: String(contact.name || ""),
      phone: String(contact.phone || ""),
      email: String(contact.email || ""),
      isDefault: Boolean(contact.isDefault),
    }))
    .filter((contact) => contact.name || contact.phone || contact.email);
  if (!normalized.length) return [createEmptyContact(true)];
  const defaultIndex = normalized.findIndex((contact) => contact.isDefault);
  return normalized.map((contact, index) => ({
    ...contact,
    isDefault: index === (defaultIndex < 0 ? 0 : defaultIndex),
  }));
}

function buildPayload(form: VendorFormState) {
  const name = form.name.trim();
  return {
    ...form,
    name,
    legalName: form.legalName.trim() || name,
    taxId: form.taxId.trim().toUpperCase(),
    address: form.address.trim(),
    billingLine2: form.billingLine2.trim(),
    street: form.street.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    country: form.country.trim() || "India",
    pincode: form.pincode.trim(),
    bankName: form.bankName.trim(),
    bankAccountNumber: form.bankAccountNumber.trim(),
    bankIfscCode: form.bankIfscCode.trim().toUpperCase(),
    bankBranch: form.bankBranch.trim(),
    contacts: form.contacts
      .map((contact) => {
        const phone = contact.phone.trim();
        return {
          ...contact,
          salutation: contact.salutation.trim(),
          name: contact.name.trim(),
          phone:
            phone && !phone.startsWith("+")
              ? `${form.countryCode}${phone.replace(/\D/g, "")}`
              : phone,
          email: contact.email.trim(),
        };
      })
      .filter((contact) => contact.name || contact.phone || contact.email),
  };
}

function formatAddress(vendor: Vendor): string {
  return [
    vendor.billing_line2,
    vendor.street || vendor.address,
    vendor.city,
    vendor.state,
    vendor.pincode,
    vendor.country,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function formatCategory(value: string): string {
  return (
    CATEGORY_OPTIONS.find((option) => option.value === value)?.label ||
    value?.replace(/_/g, " ") ||
    "-"
  );
}

function getVendorApprovalStatus(vendor: Vendor): "APPROVED" | "REJECTED" | "PENDING" {
  if (vendor.is_verified) return "APPROVED";
  const status = String(
    vendor.approval_status ||
      vendor.metadata?.vendorApproval?.status ||
      "",
  ).toUpperCase();
  return status === "REJECTED" ? "REJECTED" : "PENDING";
}

function getVendorApprovalLabel(vendor: Vendor): string {
  const status = getVendorApprovalStatus(vendor);
  if (status === "APPROVED") return "Approved";
  if (status === "REJECTED") return "Rejected";
  return "Pending";
}

function getVendorApprovalReason(vendor: Vendor): string {
  return String(
    vendor.approval_reason ||
      vendor.metadata?.vendorApproval?.reason ||
      "",
  ).trim();
}

function isVendorCreator(vendor: Vendor, user: any): boolean {
  return Boolean(vendor.created_by && user?.id && String(vendor.created_by) === String(user.id));
}

function getAttachmentForType(vendor: Vendor, type: string) {
  return (vendor.attachments || []).find((attachment) => attachment.document_type === type);
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-[#F5EFE3] py-2.5 last:border-b-0">
      <div className="text-xs font-medium text-[#7A6555]">{label}</div>
      <div className="mt-0.5 break-words text-sm font-medium text-[#4A3426]">
        {value || "-"}
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4 border-b border-[#E8DCC4] pb-2">
      <h3 className="text-base font-semibold text-[#4A3426]">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-xs text-[#7A6555]">{description}</p>
      ) : null}
    </div>
  );
}

export default function VendorsPage() {
  const { user, hydrate } = useAuthStore();
  const canCreate = hasModulePermission(user, "Purchase Management", "create");
  const canEdit = hasModulePermission(user, "Purchase Management", "edit");
  const canDelete = hasModulePermission(user, "Purchase Management", "delete");
  const canVerify =
    isAdminLike(user) &&
    hasModulePermission(user, "Purchase Management", "approve");
  const canExport = isAdminLike(user);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [verificationFilter, setVerificationFilter] = useState("ALL");
  const [viewingVendor, setViewingVendor] = useState<Vendor | null>(null);
  const [vendorImportFiles, setVendorImportFiles] = useState<VendorImportFile[]>([]);
  const [vendorImportLoading, setVendorImportLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [formSection, setFormSection] = useState<FormSection>("business");
  const [form, setForm] = useState<VendorFormState>(createInitialFormState());
  const { duplicateState, checkDuplicates, handleProceed, handleCancel } =
    useDuplicateDetection();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Vendor[]>("/purchase/vendors");
      setVendors(Array.isArray(data) ? data : []);
    } catch (error: any) {
      toast.error(error?.message || "Failed to load vendors");
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  useEffect(() => {
    if (!viewingVendor?.id) {
      setVendorImportFiles([]);
      return;
    }
    let active = true;
    setVendorImportLoading(true);
    apiClient
      .get<VendorImportFile[]>(`/purchase/import-files/by-vendor/${viewingVendor.id}`)
      .then((data) => {
        if (active) setVendorImportFiles(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setVendorImportFiles([]);
      })
      .finally(() => {
        if (active) setVendorImportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [viewingVendor?.id]);

  const filteredVendors = useMemo(
    () =>
      vendors.filter((vendor) => {
        if (categoryFilter !== "ALL" && vendor.category !== categoryFilter)
          return false;
        if (statusFilter === "ACTIVE" && !vendor.is_active) return false;
        if (statusFilter === "INACTIVE" && vendor.is_active) return false;
        const approvalStatus = getVendorApprovalStatus(vendor);
        if (verificationFilter === "VERIFIED" && approvalStatus !== "APPROVED")
          return false;
        if (verificationFilter === "PENDING" && approvalStatus !== "PENDING")
          return false;
        if (verificationFilter === "REJECTED" && approvalStatus !== "REJECTED")
          return false;
        return true;
      }),
    [categoryFilter, statusFilter, verificationFilter, vendors],
  );

  const metrics = useMemo(
    () => [
      { label: "Total Vendors", value: vendors.length },
      {
        label: "Active",
        value: vendors.filter((vendor) => vendor.is_active).length,
        tone: "success" as const,
      },
      {
        label: "Verified",
        value: vendors.filter((vendor) => getVendorApprovalStatus(vendor) === "APPROVED").length,
        tone: "success" as const,
      },
      {
        label: "Pending Verification",
        value: vendors.filter((vendor) => getVendorApprovalStatus(vendor) === "PENDING").length,
        tone: "warning" as const,
      },
      {
        label: "Rejected",
        value: vendors.filter((vendor) => getVendorApprovalStatus(vendor) === "REJECTED").length,
        tone: "danger" as const,
      },
    ],
    [vendors],
  );

  const openCreate = () => {
    setEditingVendor(null);
    setForm(createInitialFormState());
    setFormSection("business");
    setEditorOpen(true);
  };

  const openEdit = (vendor: Vendor) => {
    const metadata = vendor.metadata || {};
    setEditingVendor(vendor);
    setForm({
      salutation: vendor.salutation || metadata.salutation || "",
      name: vendor.name || "",
      legalName: vendor.legal_name || "",
      taxId: vendor.tax_id || "",
      category: vendor.category || "RAW_MATERIAL",
      address: vendor.address || "",
      billingLine2: vendor.billing_line2 || metadata.billingLine2 || "",
      street: vendor.street || "",
      city: vendor.city || "",
      state: vendor.state || "",
      country: vendor.country || "India",
      countryCode: vendor.country_code || metadata.countryCode || "+91",
      pincode: vendor.pincode || "",
      paymentTerms: vendor.payment_terms || "NET_30",
      creditLimit: Number(vendor.credit_limit || 0),
      rating: Number(vendor.rating || 0),
      isActive: vendor.is_active !== false,
      contacts: normalizeContacts(vendor.contacts),
      gstVerification: vendor.gst_verification || null,
      bankName: vendor.bank_name || metadata.bankName || "",
      bankAccountNumber:
        vendor.bank_account_number || metadata.bankAccountNumber || "",
      bankIfscCode: vendor.bank_ifsc_code || metadata.bankIfscCode || "",
      bankBranch: vendor.bank_branch || metadata.bankBranch || "",
      bankAccountType:
        vendor.bank_account_type || metadata.bankAccountType || "CURRENT",
    });
    setFormSection("business");
    setEditorOpen(true);
  };

  const persistVendor = async (payload: ReturnType<typeof buildPayload>) => {
    setSaving(true);
    try {
      if (editingVendor) {
        await apiClient.put(`/purchase/vendors/${editingVendor.id}`, payload);
        toast.success("Vendor updated successfully");
      } else {
        await apiClient.post("/purchase/vendors", payload);
        toast.success("Vendor created successfully");
      }
      setEditorOpen(false);
      setEditingVendor(null);
      await fetchVendors();
    } catch (error: any) {
      toast.error(error?.message || "Failed to save vendor");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (editingVendor ? !canEdit : !canCreate) {
      toast.error("You do not have permission to save this vendor");
      return;
    }
    const payload = buildPayload(form);
    if (!payload.name) {
      setFormSection("business");
      toast.error("Vendor name is required");
      return;
    }
    setForm(payload);
    if (editingVendor) {
      await persistVendor(payload);
      return;
    }
    await checkDuplicates(
      () => apiClient.post("/purchase/vendors/check-duplicates", payload),
      () => persistVendor(payload),
    );
  };

  const handleDelete = async (ids: string[]) => {
    if (!canDelete || !ids.length) return;
    const confirmed = await confirmDialog({
      title:
        ids.length === 1 ? "Delete Vendor" : `Delete ${ids.length} Vendors`,
      message:
        "This permanently removes the selected vendor master records. Continue?",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await Promise.all(
        ids.map((id) => apiClient.delete(`/purchase/vendors/${id}`)),
      );
      setSelectedIds([]);
      if (viewingVendor && ids.includes(viewingVendor.id))
        setViewingVendor(null);
      toast.success(
        ids.length === 1 ? "Vendor deleted" : `${ids.length} vendors deleted`,
      );
      await fetchVendors();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete vendor");
    }
  };

  const handleVerification = async (vendor: Vendor, verify: boolean) => {
    if (verify && isVendorCreator(vendor, user) && !hasMakerCheckerOverride(user)) {
      toast.error("Maker-checker: vendor creator cannot approve their own vendor");
      return;
    }
    const confirmed = await confirmDialog({
      title: verify ? "Verify Vendor" : "Remove Verification",
      message: verify
        ? `Allow ${vendor.name} for new purchasing transactions?`
        : `Block ${vendor.name} from new purchasing transactions until verified again?`,
      confirmLabel: verify ? "Verify" : "Unverify",
      variant: verify ? "info" : "warning",
    });
    if (!confirmed) return;
    try {
      const updated = await apiClient.put<Vendor>(
        `/purchase/vendors/${vendor.id}/${verify ? "verify" : "unverify"}`,
        {},
      );
      toast.success(verify ? "Vendor verified" : "Vendor verification removed");
      if (viewingVendor?.id === vendor.id) setViewingVendor(updated);
      await fetchVendors();
    } catch (error: any) {
      toast.error(error?.message || "Failed to update verification");
    }
  };

  const handleRejectVendor = async (vendor: Vendor) => {
    if (isVendorCreator(vendor, user) && !hasMakerCheckerOverride(user)) {
      toast.error("Maker-checker: vendor creator cannot reject their own vendor");
      return;
    }
    const reason = window.prompt(
      `Enter rejection reason for ${vendor.name}. This will be saved in the vendor approval trail.`,
    );
    if (reason === null) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      toast.error("A rejection reason is required");
      return;
    }

    const confirmed = await confirmDialog({
      title: "Reject Vendor",
      message: `Reject ${vendor.name} and block it from verified purchasing?`,
      confirmLabel: "Reject",
      variant: "danger",
    });
    if (!confirmed) return;

    try {
      const updated = await apiClient.put<Vendor>(
        `/purchase/vendors/${vendor.id}/reject`,
        { reason: normalizedReason },
      );
      toast.success("Vendor rejected");
      if (viewingVendor?.id === vendor.id) setViewingVendor(updated);
      await fetchVendors();
    } catch (error: any) {
      toast.error(error?.message || "Failed to reject vendor");
    }
  };

  const handleVendorAttachmentUpload = async (
    vendor: Vendor,
    documentType: string,
    file: File | null,
  ) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiClient.postForm(
        `/purchase/vendors/${vendor.id}/attachments/${documentType}`,
        formData,
      );
      toast.success("Document uploaded");
      const refreshed = await apiClient.get<Vendor>(`/purchase/vendors/${vendor.id}`);
      setViewingVendor(refreshed);
      await fetchVendors();
    } catch (error: any) {
      toast.error(error?.message || "Failed to upload document");
    }
  };

  const verifyGstin = async () => {
    if (!form.taxId.trim()) {
      toast.error("Enter GSTIN first");
      return;
    }
    try {
      setVerifyingGstin(true);
      const result = await apiClient.post<GstVerificationResult>(
        "/purchase/vendors/verify-gstin",
        {
          gstin: form.taxId.trim().toUpperCase(),
          legalName: (form.legalName || form.name).trim(),
        },
      );
      const address = result.details?.portalAddress;
      setForm((current) => ({
        ...current,
        legalName: result.details?.portalLegalName || current.legalName,
        taxId: result.gstin || current.taxId,
        billingLine2: address?.addressLine || current.billingLine2,
        street: address?.street || current.street,
        city: address?.city || current.city,
        state: address?.state || result.details?.stateName || current.state,
        country: address?.country || current.country,
        pincode: address?.pincode || current.pincode,
        address: address?.fullAddress || current.address,
        gstVerification: result,
      }));
      toast[result.valid ? "success" : "error"](
        result.message ||
          (result.valid ? "GSTIN verified" : "GSTIN verification failed"),
      );
    } catch (error: any) {
      toast.error(error?.message || "Failed to verify GSTIN");
    } finally {
      setVerifyingGstin(false);
    }
  };

  const updateContact = (
    index: number,
    key: keyof VendorContactForm,
    value: string | boolean,
  ) => {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, contactIndex) => ({
        ...contact,
        ...(key === "isDefault" && value === true
          ? { isDefault: contactIndex === index }
          : {}),
        ...(contactIndex === index ? { [key]: value } : {}),
      })),
    }));
  };

  const removeContact = (index: number) => {
    setForm((current) => {
      const contacts = current.contacts.filter(
        (_, contactIndex) => contactIndex !== index,
      );
      if (!contacts.length)
        return { ...current, contacts: [createEmptyContact(true)] };
      if (!contacts.some((contact) => contact.isDefault))
        contacts[0] = { ...contacts[0], isDefault: true };
      return { ...current, contacts };
    });
  };

  const updateDefaultContact = (
    key: keyof Pick<VendorContactForm, "name" | "phone" | "email">,
    value: string,
  ) => {
    setForm((current) => {
      const contacts = current.contacts.length
        ? current.contacts
        : [createEmptyContact(true)];
      const defaultIndex = Math.max(
        0,
        contacts.findIndex((contact) => contact.isDefault),
      );

      return {
        ...current,
        contacts: contacts.map((contact, index) => ({
          ...contact,
          isDefault: index === defaultIndex,
          ...(index === defaultIndex ? { [key]: value } : {}),
        })),
      };
    });
  };

  const exportVendors = () =>
    exportToExcel(
      vendors,
      [
        { header: "Code", key: "code" },
        { header: "Name", key: "name" },
        { header: "Legal Name", key: "legal_name" },
        { header: "Category", key: "category" },
        { header: "GST / Tax ID", key: "tax_id" },
        { header: "Contact Person", key: "contact_person" },
        { header: "Email", key: "email" },
        { header: "Phone", key: "phone" },
        { header: "City", key: "city" },
        { header: "State", key: "state" },
        { header: "Country", key: "country" },
        { header: "Payment Terms", key: "payment_terms" },
        { header: "Credit Limit", key: "credit_limit" },
        { header: "Rating", key: "rating" },
        { header: "Active", key: "is_active" },
        { header: "Verified", key: "is_verified" },
      ],
      `Vendors_${new Date().toISOString().slice(0, 10)}.csv`,
    );

  const columns = useMemo<Array<ListTableColumn<Vendor>>>(
    () => [
      {
        id: "code",
        label: "Code",
        accessor: (vendor) => vendor.code,
        sortable: true,
        minWidth: 110,
        cell: (vendor) => (
          <button
            className="font-semibold text-[#8B6F47] hover:underline"
            onClick={() => setViewingVendor(vendor)}
          >
            {vendor.code || "-"}
          </button>
        ),
      },
      {
        id: "name",
        label: "Vendor",
        accessor: (vendor) => vendor.name,
        sortable: true,
        minWidth: 250,
        searchAccessor: (vendor) =>
          `${vendor.name} ${vendor.legal_name} ${vendor.tax_id || ""}`,
        cell: (vendor) => (
          <div>
            <div className="font-semibold text-[#4A3426]">{vendor.name}</div>
            <div className="text-xs text-[#7A6555]">
              {vendor.legal_name || vendor.tax_id || "-"}
            </div>
          </div>
        ),
      },
      {
        id: "category",
        label: "Category",
        accessor: (vendor) => vendor.category,
        sortable: true,
        minWidth: 140,
        cell: (vendor) => formatCategory(vendor.category),
      },
      {
        id: "contact",
        label: "Primary Contact",
        accessor: (vendor) => vendor.contact_person || "",
        sortable: true,
        minWidth: 190,
        searchAccessor: (vendor) =>
          `${vendor.contact_person || ""} ${vendor.email || ""} ${vendor.phone || ""}`,
        cell: (vendor) => (
          <div>
            <div>{vendor.contact_person || "-"}</div>
            <div className="text-xs text-[#7A6555]">
              {vendor.email || vendor.phone || ""}
            </div>
          </div>
        ),
      },
      {
        id: "location",
        label: "Location",
        accessor: (vendor) => `${vendor.city || ""} ${vendor.state || ""}`,
        sortable: true,
        minWidth: 170,
        searchAccessor: formatAddress,
        cell: (vendor) =>
          [vendor.city, vendor.state].filter(Boolean).join(", ") || "-",
      },
      {
        id: "payment_terms",
        label: "Payment Terms",
        accessor: (vendor) => vendor.payment_terms,
        sortable: true,
        minWidth: 130,
        defaultVisible: false,
      },
      {
        id: "credit_limit",
        label: "Credit Limit",
        accessor: (vendor) => vendor.credit_limit,
        sortable: true,
        minWidth: 130,
        defaultVisible: false,
        align: "right",
        cell: (vendor) =>
          vendor.credit_limit
            ? `INR ${Number(vendor.credit_limit).toLocaleString("en-IN")}`
            : "-",
      },
      {
        id: "rating",
        label: "Rating",
        accessor: (vendor) => vendor.rating,
        sortable: true,
        minWidth: 90,
        align: "center",
        cell: (vendor) =>
          vendor.rating ? Number(vendor.rating).toFixed(1) : "-",
      },
      {
        id: "status",
        label: "Status",
        accessor: (vendor) => (vendor.is_active ? "Active" : "Inactive"),
        sortable: true,
        minWidth: 105,
        align: "center",
        cell: (vendor) => (
          <ErpStatusBadge
            status={vendor.is_active ? "ACTIVE" : "INACTIVE"}
            label={vendor.is_active ? "Active" : "Inactive"}
            tone={vendor.is_active ? "success" : "danger"}
          />
        ),
      },
      {
        id: "verification",
        label: "Verification",
        accessor: (vendor) => getVendorApprovalLabel(vendor),
        sortable: true,
        minWidth: 125,
        align: "center",
        cell: (vendor) => {
          const approvalStatus = getVendorApprovalStatus(vendor);
          return (
            <ErpStatusBadge
              status={
                approvalStatus === "APPROVED"
                  ? "APPROVED"
                  : approvalStatus === "REJECTED"
                    ? "REJECTED"
                    : "AWAITING_APPROVAL"
              }
              label={getVendorApprovalLabel(vendor)}
              tone={approvalStatus === "REJECTED" ? "danger" : undefined}
            />
          );
        },
      },
      {
        id: "gst",
        label: "GST Status",
        accessor: (vendor) =>
          vendor.gst_verification?.valid ? "Verified" : "Not verified",
        sortable: true,
        minWidth: 120,
        defaultVisible: false,
        cell: (vendor) => (vendor.gst_verification?.valid ? "Verified" : "-"),
      },
      {
        id: "actions",
        label: "Actions",
        hideable: false,
        sortable: false,
        minWidth: 176,
        align: "right",
        cell: (vendor) => (
          <div className="flex items-center justify-end gap-1">
            <ErpButton
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="View vendor"
              aria-label="View vendor"
              onClick={() => setViewingVendor(vendor)}
            >
              <Eye className="h-4 w-4" />
            </ErpButton>
            {canEdit ? (
              <ErpButton
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                title="Edit vendor"
                aria-label="Edit vendor"
                onClick={() => openEdit(vendor)}
              >
                <Edit className="h-4 w-4" />
              </ErpButton>
            ) : null}
            {canVerify ? (
              <>
                <ErpButton
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title={
                    vendor.is_verified ? "Remove verification" : "Approve vendor"
                  }
                  aria-label={
                    vendor.is_verified ? "Remove verification" : "Approve vendor"
                  }
                  onClick={() => handleVerification(vendor, !vendor.is_verified)}
                >
                  {vendor.is_verified ? (
                    <ShieldOff className="h-4 w-4" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  )}
                </ErpButton>
                {!vendor.is_verified ? (
                  <ErpButton
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-red-700"
                    title="Reject vendor"
                    aria-label="Reject vendor"
                    onClick={() => handleRejectVendor(vendor)}
                  >
                    <XCircle className="h-4 w-4" />
                  </ErpButton>
                ) : null}
              </>
            ) : null}
            {canDelete ? (
              <ErpButton
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-red-700"
                title="Delete vendor"
                aria-label="Delete vendor"
                onClick={() => handleDelete([vendor.id])}
              >
                <Trash2 className="h-4 w-4" />
              </ErpButton>
            ) : null}
          </div>
        ),
      },
    ],
    [canDelete, canEdit, canVerify, viewingVendor],
  );

  const sectionIndex = FORM_SECTIONS.findIndex(
    (section) => section.id === formSection,
  );
  const defaultContact =
    form.contacts.find((contact) => contact.isDefault) || form.contacts[0];

  return (
    <div className="space-y-4">
      <ErpPageHeader
        eyebrow="PROCUREMENT MASTER DATA"
        title="Vendors"
        description="Maintain supplier identity, tax, contact, commercial, banking, and verification data."
        actions={
          <>
            {canExport && vendors.length ? (
              <ErpButton variant="secondary" onClick={exportVendors}>
                <Download className="h-4 w-4" />
                Export
              </ErpButton>
            ) : null}
            {selectedIds.length && canDelete ? (
              <ErpButton
                variant="danger"
                onClick={() => handleDelete(selectedIds)}
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedIds.length})
              </ErpButton>
            ) : null}
            {canCreate ? (
              <ErpButton variant="primary" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Vendor
              </ErpButton>
            ) : null}
          </>
        }
      />

      <ErpMetricStrip metrics={metrics} loading={loading} />

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#4A3426]">
            Vendor Master
          </h2>
          <span className="text-xs text-[#7A6555]">
            {filteredVendors.length} records
          </span>
        </div>
        <ListTable
          storageKey="vendorsTable:sap:v1"
          rows={filteredVendors}
          columns={columns}
          getRowId={(vendor) => vendor.id}
          selectable
          selectedRowIds={selectedIds}
          onSelectionChange={setSelectedIds}
          defaultPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          searchPlaceholder="Search vendor, code, GSTIN, contact, email, or location..."
          emptyState="No vendors match the current filters"
          variantContext={{
            category: categoryFilter,
            status: statusFilter,
            verification: verificationFilter,
          }}
          onApplyVariantContext={(context) => {
            setCategoryFilter(context.category || "ALL");
            setStatusFilter(context.status || "ALL");
            setVerificationFilter(context.verification || "ALL");
          }}
          toolbarRight={
            <div className="grid w-full gap-2 sm:grid-cols-3 2xl:w-[42rem] 2xl:shrink-0">
              <SearchableSelect
                options={FILTER_CATEGORY_OPTIONS}
                value={categoryFilter}
                onChange={setCategoryFilter}
                placeholder="Category"
              />
              <SearchableSelect
                options={FILTER_STATUS_OPTIONS}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Status"
              />
              <SearchableSelect
                options={FILTER_VERIFICATION_OPTIONS}
                value={verificationFilter}
                onChange={setVerificationFilter}
                placeholder="Verification"
              />
            </div>
          }
        />
      </section>

      <SlidePanel
        open={Boolean(viewingVendor)}
        onClose={() => setViewingVendor(null)}
        title={viewingVendor?.name || "Vendor"}
        subtitle={viewingVendor?.code || ""}
        width="full"
      >
        {viewingVendor ? (
          <div className="mx-auto w-full max-w-[1600px] space-y-6">
            <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-[#E8DCC4] bg-white px-4 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <ErpStatusBadge
                  status={viewingVendor.is_active ? "ACTIVE" : "INACTIVE"}
                  label={viewingVendor.is_active ? "Active" : "Inactive"}
                  tone={viewingVendor.is_active ? "success" : "danger"}
                />
                <ErpStatusBadge
                  status={
                    getVendorApprovalStatus(viewingVendor) === "APPROVED"
                      ? "APPROVED"
                      : getVendorApprovalStatus(viewingVendor) === "REJECTED"
                        ? "REJECTED"
                        : "AWAITING_APPROVAL"
                  }
                  label={
                    getVendorApprovalStatus(viewingVendor) === "APPROVED"
                      ? "Verified for Purchasing"
                      : getVendorApprovalStatus(viewingVendor) === "REJECTED"
                        ? "Rejected"
                        : "Verification Pending"
                  }
                  tone={
                    getVendorApprovalStatus(viewingVendor) === "REJECTED"
                      ? "danger"
                      : undefined
                  }
                />
                {viewingVendor.gst_verification?.valid ? (
                  <ErpStatusBadge status="APPROVED" label="GST Verified" />
                ) : null}
              </div>
              {getVendorApprovalStatus(viewingVendor) === "REJECTED" ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Vendor is rejected and is blocked from verified purchasing.
                  {getVendorApprovalReason(viewingVendor)
                    ? ` Reason: ${getVendorApprovalReason(viewingVendor)}`
                    : ""}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {canEdit ? (
                  <ErpButton
                    variant="secondary"
                    onClick={() => {
                      const vendor = viewingVendor;
                      setViewingVendor(null);
                      openEdit(vendor);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </ErpButton>
                ) : null}
                {canVerify ? (
                  <>
                    <ErpButton
                      variant={
                        viewingVendor.is_verified ? "secondary" : "approve"
                      }
                      disabled={!viewingVendor.is_verified && isVendorCreator(viewingVendor, user) && !hasMakerCheckerOverride(user)}
                      onClick={() =>
                        handleVerification(
                          viewingVendor,
                          !viewingVendor.is_verified,
                        )
                      }
                    >
                      {viewingVendor.is_verified ? (
                        <ShieldOff className="h-4 w-4" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      {viewingVendor.is_verified ? "Unverify" : "Approve"}
                    </ErpButton>
                    {!viewingVendor.is_verified ? (
                      <ErpButton
                        variant="danger"
                        disabled={isVendorCreator(viewingVendor, user) && !hasMakerCheckerOverride(user)}
                        onClick={() => handleRejectVendor(viewingVendor)}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </ErpButton>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            <section>
              <SectionTitle title="Business Identity" />
              <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Vendor Code" value={viewingVendor.code} />
                <DetailField label="Trade Name" value={viewingVendor.name} />
                <DetailField
                  label="Legal Name"
                  value={viewingVendor.legal_name}
                />
                <DetailField
                  label="Category"
                  value={formatCategory(viewingVendor.category)}
                />
                <DetailField
                  label="Rating"
                  value={
                    viewingVendor.rating
                      ? `${Number(viewingVendor.rating).toFixed(1)} / 5`
                      : "-"
                  }
                />
                <DetailField
                  label="Account Status"
                  value={viewingVendor.is_active ? "Active" : "Inactive"}
                />
                <DetailField
                  label="Approval Status"
                  value={getVendorApprovalLabel(viewingVendor)}
                />
                {getVendorApprovalReason(viewingVendor) ? (
                  <DetailField
                    label="Rejection Reason"
                    value={getVendorApprovalReason(viewingVendor)}
                  />
                ) : null}
              </div>
            </section>

            <section>
              <SectionTitle title="Tax & Address" />
              <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField
                  label="GSTIN / Tax ID"
                  value={viewingVendor.tax_id}
                />
                <DetailField
                  label="GST State"
                  value={
                    viewingVendor.gst_verification?.details?.stateName ||
                    viewingVendor.state
                  }
                />
                <DetailField
                  label="PAN"
                  value={viewingVendor.gst_verification?.details?.pan}
                />
                <DetailField
                  label="Verification Mode"
                  value={viewingVendor.gst_verification?.verificationMode}
                />
                <div className="sm:col-span-2 lg:col-span-4">
                  <DetailField
                    label="Registered Address"
                    value={formatAddress(viewingVendor)}
                  />
                </div>
              </div>
            </section>

            <section>
              <SectionTitle title="Contacts" />
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#FAF9F6] text-left text-xs uppercase text-[#7A6555]">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Default</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F5EFE3]">
                    {(viewingVendor.contacts?.length
                      ? viewingVendor.contacts
                      : [
                          {
                            name: viewingVendor.contact_person || "",
                            phone: viewingVendor.phone || "",
                            email: viewingVendor.email || "",
                            isDefault: true,
                          },
                        ]
                    ).map((contact, index) => (
                      <tr key={`${contact.email}-${index}`}>
                        <td className="px-3 py-2 font-medium">
                          {[contact.salutation, contact.name]
                            .filter(Boolean)
                            .join(" ") || "-"}
                        </td>
                        <td className="px-3 py-2">{contact.phone || "-"}</td>
                        <td className="px-3 py-2 break-all">
                          {contact.email || "-"}
                        </td>
                        <td className="px-3 py-2">
                          {contact.isDefault ? "Yes" : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-8 lg:grid-cols-2">
              <section>
                <SectionTitle title="Commercial" />
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <DetailField
                    label="Payment Terms"
                    value={viewingVendor.payment_terms}
                  />
                  <DetailField
                    label="Credit Limit"
                    value={
                      viewingVendor.credit_limit
                        ? `INR ${Number(viewingVendor.credit_limit).toLocaleString("en-IN")}`
                        : "-"
                    }
                  />
                </div>
              </section>
              <section>
                <SectionTitle title="Bank Details" />
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <DetailField
                    label="Bank"
                    value={
                      viewingVendor.bank_name ||
                      viewingVendor.metadata?.bankName
                    }
                  />
                  <DetailField
                    label="Account Type"
                    value={
                      viewingVendor.bank_account_type ||
                      viewingVendor.metadata?.bankAccountType
                    }
                  />
                  <DetailField
                    label="Account Number"
                    value={
                      viewingVendor.bank_account_number ||
                      viewingVendor.metadata?.bankAccountNumber
                    }
                  />
                  <DetailField
                    label="IFSC"
                    value={
                      viewingVendor.bank_ifsc_code ||
                      viewingVendor.metadata?.bankIfscCode
                    }
                  />
                  <DetailField
                    label="Branch"
                    value={
                      viewingVendor.bank_branch ||
                      viewingVendor.metadata?.bankBranch
                    }
                  />
                </div>
                <p className="mt-3 text-xs text-[#7A6555]">
                  Bank details are maintained for payment records. Live bank account verification is not enabled.
                </p>
              </section>
            </div>

            <section>
              <SectionTitle
                title="Onboarding Documents"
                description="GST, PAN, MSME, and cancelled cheque checklist for supplier onboarding."
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {VENDOR_DOCUMENT_CHECKLIST.map((document) => {
                  const attachment = getAttachmentForType(viewingVendor, document.type);
                  return (
                    <div
                      key={document.type}
                      className="rounded-md border border-[#E8DCC4] bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-[#4A3426]">
                            {document.label}
                          </div>
                          <div className="mt-1 text-xs text-[#7A6555]">
                            {attachment ? "Uploaded" : "Missing"}
                          </div>
                        </div>
                        <ErpStatusBadge
                          status={attachment ? "APPROVED" : "AWAITING_APPROVAL"}
                          label={attachment ? "Available" : "Required"}
                          tone={attachment ? "success" : "warning"}
                        />
                      </div>
                      {attachment ? (
                        <a
                          href={attachment.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#6F4E37] underline"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {attachment.file_name}
                        </a>
                      ) : null}
                      {canEdit ? (
                        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#D8C8AA] px-3 py-2 text-xs font-semibold text-[#6F4E37] hover:bg-[#F5EFE3]">
                          <Paperclip className="h-3.5 w-3.5" />
                          Upload
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.png,.jpg,.jpeg"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              event.target.value = "";
                              handleVendorAttachmentUpload(viewingVendor, document.type, file);
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <SectionTitle
                title="Supplier Activity Trail"
                description="Import files, inward charges, GRN links, documents, and supplier/agency payments tied to this vendor."
              />
              <div className="rounded-md border border-[#E8DCC4] bg-white">
                <div className="grid gap-3 border-b border-[#F5EFE3] bg-[#FAF9F6] p-3 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Import Files</div>
                    <div className="text-xl font-bold text-[#4A3426]">{vendorImportFiles.length}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">GRNs Linked</div>
                    <div className="text-xl font-bold text-[#4A3426]">
                      {vendorImportFiles.reduce((sum, row) => sum + (row.grns?.length || 0), 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Documents</div>
                    <div className="text-xl font-bold text-[#4A3426]">
                      {vendorImportFiles.reduce((sum, row) => sum + (row.documents?.length || 0), 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-[#7A6555]">Landed Cost</div>
                    <div className="text-xl font-bold text-[#4A3426]">
                      INR {vendorImportFiles.reduce((sum, row) => sum + Number(row.final_landed_cost || 0), 0).toLocaleString("en-IN")}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white text-left text-xs uppercase text-[#7A6555]">
                      <tr>
                        <th className="px-3 py-2">Import File</th>
                        <th className="px-3 py-2">PO</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Charges</th>
                        <th className="px-3 py-2 text-right">Payments</th>
                        <th className="px-3 py-2 text-right">Landed Cost</th>
                        <th className="px-3 py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5EFE3]">
                      {vendorImportLoading ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-4 text-[#7A6555]">Loading supplier activity...</td>
                        </tr>
                      ) : vendorImportFiles.length ? (
                        vendorImportFiles.map((row) => (
                          <tr key={row.id}>
                            <td className="px-3 py-2 font-semibold">
                              <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-[#8B6F47]" />
                                {row.import_number || row.id}
                              </div>
                              <div className="text-xs font-normal text-[#7A6555]">{row.currency || "INR"}</div>
                            </td>
                            <td className="px-3 py-2">{row.po?.po_number || "-"}</td>
                            <td className="px-3 py-2"><ErpStatusBadge status={row.status || "DRAFT"} /></td>
                            <td className="px-3 py-2 text-right">{row.costs?.length || 0}</td>
                            <td className="px-3 py-2 text-right">{row.payments?.length || 0}</td>
                            <td className="px-3 py-2 text-right font-semibold">INR {Number(row.final_landed_cost || 0).toLocaleString("en-IN")}</td>
                            <td className="px-3 py-2">
                              <a
                                href={`/dashboard/purchase/import-files/${row.id}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-[#6F4E37] underline"
                              >
                                Open trail
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-3 py-4 text-[#7A6555]">
                            No import files or inward-cost trails recorded for this supplier yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section>
              <SectionTitle
                title="Approval History"
                description="Maker-checker and vendor master change trail."
              />
              <div className="overflow-x-auto rounded-md border border-[#E8DCC4]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#FAF9F6] text-left text-xs uppercase text-[#7A6555]">
                    <tr>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F5EFE3]">
                    {(viewingVendor.approval_history?.length
                      ? viewingVendor.approval_history
                      : viewingVendor.approval_trail || []
                    ).map((entry, index) => (
                      <tr key={`${entry.id || entry.action}-${index}`}>
                        <td className="px-3 py-2 font-semibold">
                          {entry.action || "-"}
                        </td>
                        <td className="px-3 py-2">
                          {entry.actor_name || entry.user_name || entry.created_by_name || entry.actor_email || "-"}
                        </td>
                        <td className="px-3 py-2">{entry.from_status || "-"}</td>
                        <td className="px-3 py-2">{entry.to_status || "-"}</td>
                        <td className="px-3 py-2">{entry.reason || "-"}</td>
                        <td className="px-3 py-2">
                          {entry.created_at || entry.at
                            ? new Date(entry.created_at || entry.at).toLocaleString()
                            : "-"}
                        </td>
                      </tr>
                    ))}
                    {!viewingVendor.approval_history?.length &&
                    !viewingVendor.approval_trail?.length ? (
                      <tr>
                        <td className="px-3 py-4 text-[#7A6555]" colSpan={6}>
                          No approval history recorded yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </SlidePanel>

      <SlidePanel
        open={editorOpen}
        onClose={() => {
          if (!saving) setEditorOpen(false);
        }}
        title={editingVendor ? "Edit Vendor" : "Create Vendor"}
        subtitle={editingVendor?.code || "New supplier master record"}
        width="full"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <ErpButton
                variant="secondary"
                disabled={sectionIndex === 0}
                onClick={() =>
                  setFormSection(
                    FORM_SECTIONS[Math.max(0, sectionIndex - 1)].id,
                  )
                }
              >
                Previous
              </ErpButton>
              <ErpButton
                variant="secondary"
                disabled={sectionIndex === FORM_SECTIONS.length - 1}
                onClick={() =>
                  setFormSection(
                    FORM_SECTIONS[
                      Math.min(FORM_SECTIONS.length - 1, sectionIndex + 1)
                    ].id,
                  )
                }
              >
                Next
              </ErpButton>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton
                variant="secondary"
                onClick={() => setEditorOpen(false)}
              >
                Cancel
              </ErpButton>
              <ErpButton
                variant="primary"
                disabled={saving || !form.name.trim()}
                onClick={handleSave}
              >
                <Save className="h-4 w-4" />
                {saving
                  ? "Saving..."
                  : editingVendor
                    ? "Update Vendor"
                    : "Create Vendor"}
              </ErpButton>
            </div>
          </div>
        }
      >
        <div className="mx-auto w-full max-w-[1600px]">
          <nav
            className="sticky -top-3 z-20 -mx-4 -mt-3 mb-5 overflow-x-auto border-b border-[#E8DCC4] bg-white px-4"
            aria-label="Vendor form sections"
          >
            <div className="flex min-w-max gap-6">
              {FORM_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setFormSection(section.id)}
                  className={`border-b-2 px-1 py-3 text-sm font-semibold ${formSection === section.id ? "border-[#8B6F47] text-[#5E4635]" : "border-transparent text-[#7A6555] hover:text-[#4A3426]"}`}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </nav>

          {formSection === "business" ? (
            <section>
              <SectionTitle
                title="Business Identity"
                description="Core supplier identity and classification."
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelClass}>Trade Name *</label>
                  <div className="flex gap-2">
                    <div className="w-32">
                      <SearchableSelect
                        options={BUSINESS_PREFIX_OPTIONS}
                        value={form.salutation}
                        onChange={(value) =>
                          setForm({ ...form, salutation: value })
                        }
                        placeholder="Prefix"
                      />
                    </div>
                    <input
                      className={inputClass}
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Legal Name</label>
                  <input
                    className={inputClass}
                    value={form.legalName}
                    onChange={(event) =>
                      setForm({ ...form, legalName: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Category *</label>
                  <SearchableSelect
                    options={CATEGORY_OPTIONS}
                    value={form.category}
                    onChange={(value) => setForm({ ...form, category: value })}
                    placeholder="Select category"
                  />
                </div>
                <div>
                  <label className={labelClass}>Quality Rating</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    className={inputClass}
                    value={form.rating}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        rating: Number(event.target.value) || 0,
                      })
                    }
                  />
                </div>
                <label className="flex min-h-10 items-center gap-3 rounded-md border border-[#E8DCC4] px-3">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) =>
                      setForm({ ...form, isActive: event.target.checked })
                    }
                  />
                  <span className="text-sm font-medium text-[#5E4635]">
                    Active vendor
                  </span>
                </label>
                <div className="md:col-span-2 xl:col-span-4 rounded-md border border-[#E8DCC4] bg-[#FFFCF7] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[#4A3426]">
                        Primary Contact / Email
                      </h3>
                      <p className="text-xs text-[#7A6555]">
                        This email is used for PO, RFQ, debit note, and supplier communication.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-[#8B6F47] hover:text-[#4A3426]"
                      onClick={() => setFormSection("contacts")}
                    >
                      Manage all contacts
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className={labelClass}>Contact Person</label>
                      <input
                        className={inputClass}
                        value={defaultContact?.name || ""}
                        onChange={(event) =>
                          updateDefaultContact("name", event.target.value)
                        }
                        placeholder="Purchasing contact name"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Email</label>
                      <input
                        type="email"
                        className={inputClass}
                        value={defaultContact?.email || ""}
                        onChange={(event) =>
                          updateDefaultContact("email", event.target.value)
                        }
                        placeholder="supplier@example.com"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Phone</label>
                      <input
                        type="tel"
                        className={inputClass}
                        value={defaultContact?.phone || ""}
                        onChange={(event) =>
                          updateDefaultContact("phone", event.target.value)
                        }
                        placeholder="Supplier phone"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {formSection === "tax-address" ? (
            <section>
              <SectionTitle
                title="Tax & Registered Address"
                description="Verify GSTIN to populate registered legal and address information."
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="md:col-span-2">
                  <label className={labelClass}>GSTIN / Tax ID</label>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      value={form.taxId}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          taxId: event.target.value.toUpperCase(),
                          gstVerification: null,
                        })
                      }
                    />
                    <ErpButton
                      variant="secondary"
                      disabled={verifyingGstin || !form.taxId.trim()}
                      onClick={verifyGstin}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {verifyingGstin ? "Checking..." : "Verify GSTIN"}
                    </ErpButton>
                  </div>
                  {form.gstVerification ? (
                    <p
                      className={`mt-2 text-xs font-medium ${form.gstVerification.valid ? "text-emerald-700" : "text-red-700"}`}
                    >
                      {form.gstVerification.message ||
                        (form.gstVerification.valid
                          ? "GSTIN verified"
                          : "GSTIN invalid")}
                    </p>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>Address Line</label>
                  <input
                    className={inputClass}
                    value={form.billingLine2}
                    onChange={(event) =>
                      setForm({ ...form, billingLine2: event.target.value })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>Street / Building</label>
                  <input
                    className={inputClass}
                    value={form.street}
                    onChange={(event) =>
                      setForm({ ...form, street: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>City</label>
                  <input
                    className={inputClass}
                    value={form.city}
                    onChange={(event) =>
                      setForm({ ...form, city: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    className={inputClass}
                    value={form.state}
                    onChange={(event) =>
                      setForm({ ...form, state: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>PIN Code</label>
                  <input
                    className={inputClass}
                    value={form.pincode}
                    onChange={(event) =>
                      setForm({ ...form, pincode: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Country</label>
                  <input
                    className={inputClass}
                    value={form.country}
                    onChange={(event) =>
                      setForm({ ...form, country: event.target.value })
                    }
                  />
                </div>
                <div className="md:col-span-2 xl:col-span-4">
                  <label className={labelClass}>
                    Additional Address Details
                  </label>
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={form.address}
                    onChange={(event) =>
                      setForm({ ...form, address: event.target.value })
                    }
                  />
                </div>
              </div>
            </section>
          ) : null}

          {formSection === "contacts" ? (
            <section>
              <div className="flex items-start justify-between gap-3">
                <SectionTitle
                  title="Contact Persons"
                  description="Maintain one default contact for purchasing communication."
                />
                <ErpButton
                  variant="secondary"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      contacts: [
                        ...current.contacts,
                        createEmptyContact(false),
                      ],
                    }))
                  }
                >
                  <UserPlus className="h-4 w-4" />
                  Add Contact
                </ErpButton>
              </div>
              <div className="space-y-3">
                {form.contacts.map((contact, index) => (
                  <div
                    key={`contact-${index}`}
                    className="rounded-md border border-[#E8DCC4] p-4"
                  >
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <label className={labelClass}>Name</label>
                        <div className="flex gap-2">
                          <div className="w-32">
                            <SearchableSelect
                              options={CONTACT_TITLE_OPTIONS}
                              value={contact.salutation}
                              onChange={(value) =>
                                updateContact(index, "salutation", value)
                              }
                              placeholder="Title"
                            />
                          </div>
                          <input
                            className={inputClass}
                            value={contact.name}
                            onChange={(event) =>
                              updateContact(index, "name", event.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Phone</label>
                        <div className="flex gap-2">
                          <div className="w-28">
                            <SearchableSelect
                              options={COUNTRY_CODE_OPTIONS}
                              value={form.countryCode}
                              onChange={(value) =>
                                setForm({ ...form, countryCode: value })
                              }
                            />
                          </div>
                          <input
                            type="tel"
                            className={inputClass}
                            value={contact.phone}
                            onChange={(event) =>
                              updateContact(index, "phone", event.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Email</label>
                        <input
                          type="email"
                          className={inputClass}
                          value={contact.email}
                          onChange={(event) =>
                            updateContact(index, "email", event.target.value)
                          }
                        />
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <label className="flex min-h-10 items-center gap-2 text-sm">
                          <input
                            type="radio"
                            checked={contact.isDefault}
                            onChange={() =>
                              updateContact(index, "isDefault", true)
                            }
                          />
                          Default contact
                        </label>
                        {form.contacts.length > 1 ? (
                          <ErpButton
                            variant="danger"
                            size="sm"
                            onClick={() => removeContact(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </ErpButton>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {formSection === "commercial" ? (
            <section>
              <SectionTitle
                title="Commercial Terms"
                description="Default terms used when creating purchasing documents."
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelClass}>Payment Terms</label>
                  <SearchableSelect
                    options={PAYMENT_TERM_OPTIONS}
                    value={form.paymentTerms}
                    onChange={(value) =>
                      setForm({ ...form, paymentTerms: value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Credit Limit (INR)</label>
                  <input
                    type="number"
                    min="0"
                    max={MAX_VENDOR_CREDIT_LIMIT}
                    step="0.01"
                    className={inputClass}
                    value={form.creditLimit}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        creditLimit: toBoundedNumber(
                          event.target.value,
                          0,
                          MAX_VENDOR_CREDIT_LIMIT,
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Quality Rating</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    className={inputClass}
                    value={form.rating}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        rating: toBoundedNumber(event.target.value, 0, 5),
                      })
                    }
                  />
                </div>
              </div>
            </section>
          ) : null}

          {formSection === "bank" ? (
            <section>
              <SectionTitle
                title="Bank Details"
                description="Payment destination maintained for accounts payable."
              />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelClass}>Bank Name</label>
                  <input
                    className={inputClass}
                    value={form.bankName}
                    onChange={(event) =>
                      setForm({ ...form, bankName: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Account Type</label>
                  <SearchableSelect
                    options={ACCOUNT_TYPE_OPTIONS}
                    value={form.bankAccountType}
                    onChange={(value) =>
                      setForm({ ...form, bankAccountType: value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Account Number</label>
                  <input
                    className={inputClass}
                    value={form.bankAccountNumber}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        bankAccountNumber: event.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>IFSC Code</label>
                  <input
                    className={inputClass}
                    value={form.bankIfscCode}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        bankIfscCode: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>Branch</label>
                  <input
                    className={inputClass}
                    value={form.bankBranch}
                    onChange={(event) =>
                      setForm({ ...form, bankBranch: event.target.value })
                    }
                  />
                </div>
              </div>
            </section>
          ) : null}

          {formSection === "review" ? (
            <section>
              <SectionTitle
                title="Review Vendor"
                description="Confirm master data before saving."
              />
              <div className="grid gap-8 lg:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#4A3426]">
                    Business & Tax
                  </h4>
                  <DetailField
                    label="Trade Name"
                    value={form.name || "Required"}
                  />
                  <DetailField
                    label="Legal Name"
                    value={form.legalName || form.name}
                  />
                  <DetailField
                    label="Category"
                    value={formatCategory(form.category)}
                  />
                  <DetailField label="GSTIN" value={form.taxId} />
                  <DetailField
                    label="Address"
                    value={[
                      form.billingLine2,
                      form.street,
                      form.city,
                      form.state,
                      form.pincode,
                      form.country,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  />
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#4A3426]">
                    Commercial & Contact
                  </h4>
                  <DetailField
                    label="Default Contact"
                    value={
                      defaultContact
                        ? `${defaultContact.name || "-"}${defaultContact.email ? ` | ${defaultContact.email}` : ""}`
                        : "-"
                    }
                  />
                  <DetailField
                    label="Payment Terms"
                    value={form.paymentTerms}
                  />
                  <DetailField
                    label="Credit Limit"
                    value={`INR ${form.creditLimit.toLocaleString("en-IN")}`}
                  />
                  <DetailField
                    label="Bank"
                    value={[form.bankName, form.bankIfscCode]
                      .filter(Boolean)
                      .join(" | ")}
                  />
                  <DetailField
                    label="Status"
                    value={form.isActive ? "Active" : "Inactive"}
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </SlidePanel>

      <DuplicateWarning
        isOpen={duplicateState.isOpen}
        exactMatches={duplicateState.exactMatches}
        fuzzyMatches={duplicateState.fuzzyMatches}
        entityType="Vendor"
        onProceed={handleProceed}
        onCancel={handleCancel}
        formatRecord={(data) => (
          <div className="text-sm">
            <p className="font-semibold">{data.name || data.legal_name}</p>
            <p className="text-xs text-[#7A6555]">
              GST: {data.tax_id || "N/A"}
            </p>
          </div>
        )}
      />
    </div>
  );
}
