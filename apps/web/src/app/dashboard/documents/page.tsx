'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import { confirmDialog } from '../../../components/ui/ConfirmDialog';
import WorkflowActions from './WorkflowActions';
import WorkflowHistory from './WorkflowHistory';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface UserRef {
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface Document {
  id: string;
  document_number: string;
  title: string;
  description?: string;
  document_type: string;
  file_url: string;
  file_name: string;
  file_size?: number;
  current_revision: string;
  status: string;
  category?: { id: string; name: string; code: string };
  created_at: string;
  created_by_user?: UserRef;
  approved_by_user?: UserRef;
  approved_at?: string;
  tags?: string[];
  related_entity_type?: string;
  related_entity_id?: string;
}

interface AccessLog {
  id: string;
  action: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  user?: UserRef | null;
}

interface DocumentRevision {
  id: string;
  revision_number: string;
  revision_type?: string;
  change_description?: string;
  file_name?: string;
  file_size?: number;
  file_url?: string;
  created_at: string;
  created_by_user?: UserRef | null;
  approved_by_user?: UserRef | null;
}

type QualityCheckResponse = {
  ok: boolean;
  result?: {
    isSendable?: boolean;
    riskLevel?: string;
    summary?: string;
    issues?: Array<{
      severity?: string;
      type?: string;
      message?: string;
      suggestion?: string;
    }>;
    missingInfo?: string[];
    disclaimers?: string[];
  };
};

interface Category {
  id: string;
  code: string;
  name: string;
  description?: string;
}

const documentTypes = [
  { value: 'QUOTATION', label: 'Quotation', icon: '🧾' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order', icon: '🛒' },
  { value: 'INVOICE', label: 'Invoice', icon: '💳' },
  { value: 'CONTRACT', label: 'Contract', icon: '📑' },
  { value: 'CORRESPONDENCE', label: 'Correspondence', icon: '✉️' },
  { value: 'WARRANTY', label: 'Warranty', icon: '🛡️' },
  { value: 'OTHER', label: 'Other', icon: '📦' },
  { value: 'DRAWING', label: 'Engineering Drawing', icon: '📐' },
  { value: 'TECHNICAL_DRAWING', label: 'Technical Drawing', icon: '📐' },
  { value: 'MANUAL', label: 'User Manual', icon: '📖' },
  { value: 'REPORT', label: 'Technical Report', icon: '📊' },
  { value: 'CERTIFICATE', label: 'Certificate', icon: '🏆' },
  { value: 'SPECIFICATION', label: 'Specification', icon: '📋' },
  { value: 'SOP', label: 'SOP', icon: '📝' },
  { value: 'TEMPLATE', label: 'Template', icon: '📄' },
];

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PENDING_REVIEW: 'bg-amber-100 text-amber-800',
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  SENT_TO_CLIENT: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  OBSOLETE: 'bg-gray-100 text-gray-600',
};

export default function DocumentsPage() {
  const router = useRouter();
  const currentUser = readStoredUser();
  const canCreate = hasModulePermission(currentUser, 'Documents', 'create');
  const canDelete = hasModulePermission(currentUser, 'Documents', 'delete');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [expandedAnalysisId, setExpandedAnalysisId] = useState<string | null>(null);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [expandedRevisionsId, setExpandedRevisionsId] = useState<string | null>(null);
  const [analysisById, setAnalysisById] = useState<
    Record<string, { loading: boolean; data?: QualityCheckResponse; error?: string }>
  >({});
  const [activityById, setActivityById] = useState<
    Record<string, { loading: boolean; data?: AccessLog[]; error?: string }>
  >({});
  const [revisionsById, setRevisionsById] = useState<
    Record<string, { loading: boolean; data?: DocumentRevision[]; error?: string }>
  >({});
  const [showModal, setShowModal] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');

  const formatUser = (user?: UserRef | null) => {
    if (!user) return 'N/A';
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.email || 'N/A';
  };

  const getErrorMessage = (err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === 'string') return msg;
    }
    return fallback;
  };

  const formatAccessLogMeta = (metadata?: Record<string, unknown> | null) => {
    if (!metadata) return '';

    const readString = (key: string) => {
      const v = (metadata as Record<string, unknown>)[key];
      return typeof v === 'string' ? v : '';
    };

    const clientEmail = readString('client_email');
    const clientName = readString('client_name');
    const comments = readString('comments');

    const parts: string[] = [];
    if (clientEmail) parts.push(clientName ? `${clientName} <${clientEmail}>` : clientEmail);
    if (comments) parts.push(comments);

    return parts.length ? ` • ${parts.join(' • ')}` : '';
  };

  const runQualityCheck = async (documentId: string) => {
    setAnalysisById((prev) => ({
      ...prev,
      [documentId]: { loading: true },
    }));

    try {
      const res = await apiClient.post<QualityCheckResponse>(
        `/documents/${documentId}/quality-check`,
        {},
      );
      setAnalysisById((prev) => ({
        ...prev,
        [documentId]: { loading: false, data: res },
      }));
    } catch (e: unknown) {
      const errorMsg = getErrorMessage(e, 'Analysis failed');
      const isConfigError = errorMsg.includes('not configured') || errorMsg.includes('unavailable');
      
      setAnalysisById((prev) => ({
        ...prev,
        [documentId]: { 
          loading: false, 
          error: isConfigError 
            ? 'AI analysis is not available. OpenAI API is not configured on the server.' 
            : errorMsg 
        },
      }));
    }
  };

  const loadAccessLogs = async (documentId: string) => {
    setActivityById((prev) => ({
      ...prev,
      [documentId]: { loading: true },
    }));

    try {
      const logs = await apiClient.get<AccessLog[]>(`/documents/${documentId}/access-logs`);
      setActivityById((prev) => ({
        ...prev,
        [documentId]: { loading: false, data: logs },
      }));
    } catch (e: unknown) {
      setActivityById((prev) => ({
        ...prev,
        [documentId]: { loading: false, error: getErrorMessage(e, 'Failed to load activity') },
      }));
    }
  };

  const loadRevisions = async (documentId: string) => {
    setRevisionsById((prev) => ({
      ...prev,
      [documentId]: { loading: true },
    }));

    try {
      const revs = await apiClient.get<DocumentRevision[]>(`/documents/${documentId}/revisions`);
      setRevisionsById((prev) => ({
        ...prev,
        [documentId]: { loading: false, data: revs },
      }));
    } catch (e: unknown) {
      setRevisionsById((prev) => ({
        ...prev,
        [documentId]: { loading: false, error: getErrorMessage(e, 'Failed to load revisions') },
      }));
    }
  };

  const getRevisionChangeSummary = (revs?: DocumentRevision[]) => {
    if (!revs || revs.length < 2) return null;
    const [latest, prev] = revs;
    const changes: string[] = [];

    if (latest.file_name && prev.file_name && latest.file_name !== prev.file_name) {
      changes.push(`File name changed: ${prev.file_name} → ${latest.file_name}`);
    }

    if (
      typeof latest.file_size === 'number' &&
      typeof prev.file_size === 'number' &&
      latest.file_size !== prev.file_size
    ) {
      changes.push(`File size changed: ${formatFileSize(prev.file_size)} → ${formatFileSize(latest.file_size)}`);
    }

    if (latest.revision_type && prev.revision_type && latest.revision_type !== prev.revision_type) {
      changes.push(`Revision type changed: ${prev.revision_type} → ${latest.revision_type}`);
    }

    if (latest.change_description && latest.change_description.trim()) {
      changes.push(`Change description: ${latest.change_description.trim()}`);
    }

    return changes.length ? changes : null;
  };

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    document_type: '',
    status: '',
    category_id: '',
  });

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    document_type: 'DRAWING',
    category_id: '',
    file_url: '',
    file_name: '',
    file_size: 0,
    tags: '',
    related_entity_type: '',
    related_entity_id: '',
    access_level: 'INTERNAL',
  });

  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Revision form
  const [revisionData, setRevisionData] = useState({
    revision_number: '',
    file_url: '',
    file_name: '',
    file_size: 0,
    change_description: '',
    revision_type: 'MINOR',
  });

  const [revisionFile, setRevisionFile] = useState<File | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const queryParams = new URLSearchParams();
      
      if (filters.search) queryParams.append('search', filters.search);
      if (filters.document_type) queryParams.append('document_type', filters.document_type);
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.category_id) queryParams.append('category_id', filters.category_id);

      const data = await apiClient.get<Document[]>(`/documents?${queryParams}`);
      setDocuments(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await apiClient.get<Category[]>('/document-categories');
      setCategories(data);
    } catch (error) {
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
    fetchCategories();
  }, [fetchDocuments, fetchCategories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!uploadFile && !formData.file_url) {
        alert('Please upload a file or provide a File URL');
        return;
      }

      let created: { id?: string } | null = null;

      if (uploadFile) {
        const fd = new FormData();
        fd.append('file', uploadFile);
        fd.append('title', formData.title);
        if (formData.description) fd.append('description', formData.description);
        fd.append('document_type', formData.document_type);
        if (formData.category_id) fd.append('category_id', formData.category_id);
        if (formData.access_level) fd.append('access_level', formData.access_level);

        created = await apiClient.postForm('/documents/upload', fd);
      } else {
        let inferredFileName = formData.file_name;
        if (!inferredFileName && formData.file_url) {
          try {
            const url = new URL(formData.file_url);
            inferredFileName = decodeURIComponent(url.pathname.split('/').pop() || '');
          } catch {
            inferredFileName = '';
          }
        }
        if (!inferredFileName) inferredFileName = `document-${Date.now()}`;

        const payload = {
          ...formData,
          file_name: inferredFileName,
          file_size: formData.file_size || 0,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
        };
        created = await apiClient.post('/documents', payload);
      }

      setShowModal(false);
      resetForm();

      await fetchDocuments();

      if (created?.id) {
        setExpandedAnalysisId(created.id);
        setExpandedActivityId(null);
        await runQualityCheck(created.id);
      }
    } catch (error) {
    }
  };

  const handleAddRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocument) return;

    try {
      if (!revisionFile && !revisionData.file_url) {
        alert('Please upload a file or provide a File URL');
        return;
      }

      if (revisionFile) {
        const fd = new FormData();
        fd.append('file', revisionFile);
        fd.append('revision_number', revisionData.revision_number);
        fd.append('revision_type', revisionData.revision_type);
        fd.append('change_description', revisionData.change_description);
        await apiClient.postForm(`/documents/${selectedDocument.id}/revisions/upload`, fd);
      } else {
        let inferredFileName = revisionData.file_name;
        if (!inferredFileName && revisionData.file_url) {
          try {
            const url = new URL(revisionData.file_url);
            inferredFileName = decodeURIComponent(url.pathname.split('/').pop() || '');
          } catch {
            inferredFileName = '';
          }
        }
        if (!inferredFileName) inferredFileName = `revision-${Date.now()}`;

        await apiClient.post(`/documents/${selectedDocument.id}/revisions`, {
          ...revisionData,
          file_name: inferredFileName,
          file_size: revisionData.file_size || 0,
        });
      }

      setShowRevisionModal(false);
      setRevisionData({
        revision_number: '',
        file_url: '',
        file_name: '',
        file_size: 0,
        change_description: '',
        revision_type: 'MINOR',
      });
      setRevisionFile(null);

      await fetchDocuments();

      setExpandedRevisionsId(selectedDocument.id);
      setExpandedAnalysisId(null);
      setExpandedActivityId(null);
      await loadRevisions(selectedDocument.id);
      // Keep intelligence up to date in the background
      void runQualityCheck(selectedDocument.id);
    } catch (error) {
      alert(getErrorMessage(error, 'Failed to add revision'));
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDialog({
      title: 'Delete Document',
      message: 'Are you sure you want to delete this document?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/documents/${id}`);
      fetchDocuments();
    } catch (error) {
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await apiClient.post(`/documents/${id}/archive`, {});
      fetchDocuments();
    } catch (error) {
    }
  };

  const handleView = async (id: string) => {
    try {
      setOpeningDocumentId(id);
      const res = await apiClient.get<{ url: string }>(`/documents/${id}/signed-url?expiresIn=3600`);
      if (!res?.url) {
        alert('No view URL available for this document');
        return;
      }
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      alert('Failed to open document');
    } finally {
      setOpeningDocumentId(null);
    }
  };

  const renderDocumentActionMenu = (doc: Document, compact = false) => (
    <details className="relative">
      <summary
        className={`cursor-pointer list-none rounded px-2 py-1 text-xs font-medium marker:hidden ${
          compact
            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        More actions
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-40 rounded border border-gray-200 bg-white p-1 shadow-lg">
        <button
          type="button"
          onClick={async () => {
            const next = expandedAnalysisId === doc.id ? null : doc.id;
            setExpandedAnalysisId(next);
            setExpandedActivityId(null);
            setExpandedRevisionsId(null);
            if (next) await runQualityCheck(doc.id);
          }}
          className="block w-full rounded px-2 py-1.5 text-left text-xs text-blue-700 hover:bg-blue-50"
        >
          Analyze
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedDocument(doc);
            setShowRevisionModal(true);
          }}
          className="block w-full rounded px-2 py-1.5 text-left text-xs text-purple-700 hover:bg-purple-50"
        >
          New revision
        </button>
        <button
          type="button"
          onClick={async () => {
            const next = expandedActivityId === doc.id ? null : doc.id;
            setExpandedActivityId(next);
            setExpandedAnalysisId(null);
            setExpandedRevisionsId(null);
            if (next) await loadAccessLogs(doc.id);
          }}
          className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
        >
          Activity
        </button>
        <button
          type="button"
          onClick={async () => {
            const next = expandedRevisionsId === doc.id ? null : doc.id;
            setExpandedRevisionsId(next);
            setExpandedAnalysisId(null);
            setExpandedActivityId(null);
            if (next) await loadRevisions(doc.id);
          }}
          className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
        >
          Revisions
        </button>
        <button
          type="button"
          onClick={() => handleArchive(doc.id)}
          className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
        >
          Archive
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => handleDelete(doc.id)}
            className="block w-full rounded px-2 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>
    </details>
  );

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      document_type: 'DRAWING',
      category_id: '',
      file_url: '',
      file_name: '',
      file_size: 0,
      tags: '',
      related_entity_type: '',
      related_entity_id: '',
      access_level: 'INTERNAL',
    });
    setUploadFile(null);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`;
  };

  const getDocumentTypeIcon = (type: string) => {
    return documentTypes.find(t => t.value === type)?.icon || '📄';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading documents...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Document Management
        </h1>
        <p className="text-gray-600">
          Centralized document control with version management and approval workflows
        </p>
      </div>

      {/* Action Bar */}
      <div className="mb-6 flex flex-wrap gap-4 items-center justify-between bg-white p-4 rounded-lg shadow">
        <div className="flex gap-2">
          {canCreate && (
          <button
            onClick={() => setShowModal(true)}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2"
          >
            <span>+</span> Upload Document
          </button>
          )}
          <button
            onClick={() => setViewMode(viewMode === 'table' ? 'cards' : 'table')}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            {viewMode === 'table' ? '📇 Cards' : '📋 Table'}
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search documents..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          
          <select
            value={filters.document_type}
            onChange={(e) => setFilters({ ...filters, document_type: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Types</option>
            {documentTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.icon} {type.label}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>

          <select
            value={filters.category_id}
            onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents Display */}
      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-5 border border-gray-200"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{getDocumentTypeIcon(doc.document_type)}</span>
                  <div>
                    <h3 className="font-semibold text-gray-900">{doc.title}</h3>
                    <p className="text-sm text-gray-500">{doc.document_number}</p>
                    <p className="text-xs text-gray-500">
                      Uploaded by {formatUser(doc.created_by_user)}
                      {doc.approved_by_user ? ` • Approved by ${formatUser(doc.approved_by_user)}` : ''}
                    </p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[doc.status]}`}>
                  {doc.status.replace('_', ' ')}
                </span>
              </div>

              {doc.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{doc.description}</p>
              )}

              <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                <span>Rev: {doc.current_revision}</span>
                <span>{formatFileSize(doc.file_size)}</span>
              </div>

              {doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {doc.tags.slice(0, 3).map((tag, idx) => (
                    <span key={idx} className="px-2 py-1 bg-amber-50 text-amber-600 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <details className="mt-3 rounded border border-gray-200 bg-gray-50 px-2 py-1">
                <summary className="cursor-pointer text-xs font-medium text-gray-700">Document actions</summary>
                <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => handleView(doc.id)}
                  disabled={openingDocumentId === doc.id}
                  className="bg-amber-50 text-amber-600 px-2 py-1 rounded text-xs hover:bg-amber-100 transition-colors disabled:opacity-60"
                >
                  {openingDocumentId === doc.id ? 'Opening…' : 'View'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const next = expandedAnalysisId === doc.id ? null : doc.id;
                    setExpandedAnalysisId(next);
                    setExpandedActivityId(null);
                    setExpandedRevisionsId(null);
                    if (next) await runQualityCheck(doc.id);
                  }}
                  className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs hover:bg-blue-100 transition-colors"
                >
                  Analyze
                </button>
                <button
                  onClick={() => {
                    setSelectedDocument(doc);
                    setShowRevisionModal(true);
                  }}
                  className="bg-purple-50 text-purple-600 px-2 py-1 rounded text-xs hover:bg-purple-100 transition-colors"
                >
                  New Rev
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const next = expandedActivityId === doc.id ? null : doc.id;
                    setExpandedActivityId(next);
                    setExpandedAnalysisId(null);
                    setExpandedRevisionsId(null);
                    if (next) await loadAccessLogs(doc.id);
                  }}
                  className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-200 transition-colors"
                >
                  Activity
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const next = expandedRevisionsId === doc.id ? null : doc.id;
                    setExpandedRevisionsId(next);
                    setExpandedAnalysisId(null);
                    setExpandedActivityId(null);
                    if (next) await loadRevisions(doc.id);
                  }}
                  className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-200 transition-colors"
                >
                  Revisions
                </button>
                <button
                  onClick={() => handleArchive(doc.id)}
                  className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs hover:bg-gray-200 transition-colors"
                >
                  Archive
                </button>
                {canDelete && (
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
                )}
                </div>
              </details>

              {expandedAnalysisId === doc.id && (
                <div className="mt-3 p-3 rounded border border-blue-100 bg-blue-50 text-sm text-gray-800">
                  {analysisById[doc.id]?.loading ? (
                    <div className="text-blue-800">Analyzing…</div>
                  ) : analysisById[doc.id]?.error ? (
                    <div className="text-red-700">{analysisById[doc.id]?.error}</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-blue-900">AI Analysis</div>
                        <div className="text-xs text-blue-900">
                          Risk: {analysisById[doc.id]?.data?.result?.riskLevel || 'N/A'}
                        </div>
                      </div>
                      <div className="mt-1 text-gray-700">
                        {analysisById[doc.id]?.data?.result?.summary || 'No summary returned.'}
                      </div>

                      {(analysisById[doc.id]?.data?.result?.issues || []).length > 0 && (
                        <div className="mt-2">
                          <div className="text-xs font-semibold text-gray-700">Issues</div>
                          <ul className="mt-1 list-disc pl-5 space-y-1 text-gray-700">
                            {(analysisById[doc.id]?.data?.result?.issues || []).slice(0, 6).map((issue, idx) => (
                              <li key={idx}>
                                <span className="font-medium">{issue.severity || 'INFO'}</span>
                                {issue.type ? ` • ${issue.type}` : ''}: {issue.message || 'Issue'}
                                {issue.suggestion ? ` (Suggestion: ${issue.suggestion})` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {expandedActivityId === doc.id && (
                <div className="mt-3 p-3 rounded border border-gray-200 bg-white text-sm text-gray-800">
                  <div className="font-semibold text-gray-900">Activity</div>
                  {activityById[doc.id]?.loading ? (
                    <div className="mt-1 text-gray-600">Loading…</div>
                  ) : activityById[doc.id]?.error ? (
                    <div className="mt-1 text-red-700">{activityById[doc.id]?.error}</div>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {(activityById[doc.id]?.data || []).slice(0, 6).map((log) => (
                        <li key={log.id} className="text-gray-700">
                          <span className="font-medium">{log.action}</span>{' '}
                          <span className="text-gray-500">({new Date(log.created_at).toLocaleString()})</span>{' '}
                          <span className="text-gray-600">by {formatUser(log.user || null)}</span>
                          <span className="text-gray-500">{formatAccessLogMeta(log.metadata)}</span>
                        </li>
                      ))}

                      {(activityById[doc.id]?.data || []).length === 0 && (
                        <li className="text-gray-600">No activity found.</li>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {expandedRevisionsId === doc.id && (
                <div className="mt-3 p-3 rounded border border-gray-200 bg-white text-sm text-gray-800">
                  <div className="font-semibold text-gray-900">Revisions</div>
                  {revisionsById[doc.id]?.loading ? (
                    <div className="mt-1 text-gray-600">Loading…</div>
                  ) : revisionsById[doc.id]?.error ? (
                    <div className="mt-1 text-red-700">{revisionsById[doc.id]?.error}</div>
                  ) : (
                    <>
                      {getRevisionChangeSummary(revisionsById[doc.id]?.data) && (
                        <div className="mt-2 rounded border border-amber-100 bg-amber-50 p-2">
                          <div className="text-xs font-semibold text-amber-900">What changed vs previous revision</div>
                          <ul className="mt-1 list-disc pl-5 space-y-1 text-amber-900">
                            {getRevisionChangeSummary(revisionsById[doc.id]?.data)!.map((c, idx) => (
                              <li key={idx}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <ul className="mt-2 space-y-2">
                        {(revisionsById[doc.id]?.data || []).slice(0, 6).map((rev) => (
                          <li key={rev.id} className="rounded border border-gray-100 bg-gray-50 p-2">
                            <div className="flex items-center justify-between">
                              <div className="font-medium text-gray-900">Rev {rev.revision_number}</div>
                              <div className="text-xs text-gray-500">{new Date(rev.created_at).toLocaleString()}</div>
                            </div>
                            <div className="text-xs text-gray-600">
                              Uploaded by {formatUser(rev.created_by_user || null)}
                              {rev.approved_by_user ? ` • Approved by ${formatUser(rev.approved_by_user)}` : ''}
                            </div>
                            <div className="mt-1 text-xs text-gray-600">
                              {rev.file_name ? `${rev.file_name} • ` : ''}{formatFileSize(rev.file_size)}
                            </div>
                            {rev.change_description ? (
                              <div className="mt-1 text-sm text-gray-700">{rev.change_description}</div>
                            ) : null}
                          </li>
                        ))}

                        {(revisionsById[doc.id]?.data || []).length === 0 && (
                          <li className="text-gray-600">No revisions found.</li>
                        )}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* Workflow Actions */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <WorkflowActions document={doc} onSuccess={fetchDocuments} />
                <WorkflowHistory documentId={doc.id} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Document
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Revision
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {documents.map((doc) => (
                <>
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900">{doc.title}</div>
                        <div className="text-sm text-gray-500">{doc.document_number}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <span className="flex items-center gap-2">
                        <span>{getDocumentTypeIcon(doc.document_type)}</span>
                        {doc.document_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {doc.current_revision}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[doc.status]}`}>
                        {doc.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {doc.category?.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">
                      <details className="relative inline-block">
                        <summary className="cursor-pointer rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">Actions</summary>
                        <div className="absolute right-0 z-20 mt-1 flex w-32 flex-col gap-1 rounded border border-gray-200 bg-white p-2 shadow-lg">
                      <button
                        type="button"
                        onClick={() => handleView(doc.id)}
                        className="text-amber-600 hover:text-amber-900"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = expandedAnalysisId === doc.id ? null : doc.id;
                          setExpandedAnalysisId(next);
                          setExpandedActivityId(null);
                          setExpandedRevisionsId(null);
                          if (next) await runQualityCheck(doc.id);
                        }}
                        className="text-blue-700 hover:text-blue-900"
                      >
                        Analyze
                      </button>
                      <button
                        onClick={() => {
                          setSelectedDocument(doc);
                          setShowRevisionModal(true);
                        }}
                        className="text-purple-600 hover:text-purple-900"
                      >
                        Revise
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = expandedActivityId === doc.id ? null : doc.id;
                          setExpandedActivityId(next);
                          setExpandedAnalysisId(null);
                          setExpandedRevisionsId(null);
                          if (next) await loadAccessLogs(doc.id);
                        }}
                        className="text-gray-700 hover:text-gray-900"
                      >
                        Activity
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const next = expandedRevisionsId === doc.id ? null : doc.id;
                          setExpandedRevisionsId(next);
                          setExpandedAnalysisId(null);
                          setExpandedActivityId(null);
                          if (next) await loadRevisions(doc.id);
                        }}
                        className="text-gray-700 hover:text-gray-900"
                      >
                        Revisions
                      </button>
                      {canDelete && (
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                      )}
                        </div>
                      </details>
                    </td>
                  </tr>

                  {(expandedAnalysisId === doc.id || expandedActivityId === doc.id || expandedRevisionsId === doc.id) && (
                    <tr>
                      <td colSpan={7} className="px-6 pb-3">
                        {expandedAnalysisId === doc.id && (
                          <div className="mt-2 p-3 rounded border border-blue-100 bg-blue-50 text-sm">
                            {analysisById[doc.id]?.loading ? (
                              <div className="text-blue-800">Analyzing…</div>
                            ) : analysisById[doc.id]?.error ? (
                              <div className="text-red-700">{analysisById[doc.id]?.error}</div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold text-blue-900">AI Analysis</div>
                                  <div className="text-xs text-blue-900">
                                    Risk: {analysisById[doc.id]?.data?.result?.riskLevel || 'N/A'}
                                  </div>
                                </div>
                                <div className="mt-1 text-gray-700">
                                  {analysisById[doc.id]?.data?.result?.summary || 'No summary returned.'}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {expandedActivityId === doc.id && (
                          <div className="mt-2 p-3 rounded border border-gray-200 bg-white text-sm">
                            <div className="font-semibold text-gray-900">Activity</div>
                            {activityById[doc.id]?.loading ? (
                              <div className="mt-1 text-gray-600">Loading…</div>
                            ) : activityById[doc.id]?.error ? (
                              <div className="mt-1 text-red-700">{activityById[doc.id]?.error}</div>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {(activityById[doc.id]?.data || []).slice(0, 6).map((log) => (
                                  <li key={log.id} className="text-gray-700">
                                    <span className="font-medium">{log.action}</span>{' '}
                                    <span className="text-gray-500">({new Date(log.created_at).toLocaleString()})</span>{' '}
                                    <span className="text-gray-600">by {formatUser(log.user || null)}</span>
                                    <span className="text-gray-500">{formatAccessLogMeta(log.metadata)}</span>
                                  </li>
                                ))}
                                {(activityById[doc.id]?.data || []).length === 0 && (
                                  <li className="text-gray-600">No activity found.</li>
                                )}
                              </ul>
                            )}
                          </div>
                        )}

                        {expandedRevisionsId === doc.id && (
                          <div className="mt-2 p-3 rounded border border-gray-200 bg-white text-sm">
                            <div className="font-semibold text-gray-900">Revisions</div>
                            {revisionsById[doc.id]?.loading ? (
                              <div className="mt-1 text-gray-600">Loading…</div>
                            ) : revisionsById[doc.id]?.error ? (
                              <div className="mt-1 text-red-700">{revisionsById[doc.id]?.error}</div>
                            ) : (
                              <>
                                {getRevisionChangeSummary(revisionsById[doc.id]?.data) && (
                                  <div className="mt-2 rounded border border-amber-100 bg-amber-50 p-2">
                                    <div className="text-xs font-semibold text-amber-900">What changed vs previous revision</div>
                                    <ul className="mt-1 list-disc pl-5 space-y-1 text-amber-900">
                                      {getRevisionChangeSummary(revisionsById[doc.id]?.data)!.map((c, idx) => (
                                        <li key={idx}>{c}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <ul className="mt-2 space-y-1">
                                  {(revisionsById[doc.id]?.data || []).slice(0, 6).map((rev) => (
                                    <li key={rev.id} className="text-gray-700">
                                      <span className="font-medium">Rev {rev.revision_number}</span>{' '}
                                      <span className="text-gray-500">({new Date(rev.created_at).toLocaleString()})</span>{' '}
                                      <span className="text-gray-600">by {formatUser(rev.created_by_user || null)}</span>
                                      {rev.change_description ? (
                                        <span className="text-gray-600"> • {rev.change_description}</span>
                                      ) : null}
                                    </li>
                                  ))}
                                  {(revisionsById[doc.id]?.data || []).length === 0 && (
                                    <li className="text-gray-600">No revisions found.</li>
                                  )}
                                </ul>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="px-6 py-2">
                      <WorkflowActions document={doc} onSuccess={fetchDocuments} />
                      <WorkflowHistory documentId={doc.id} />
                    </td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {documents.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No documents found. Upload your first document to get started.</p>
        </div>
      )}

      {/* Create Document Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-4">Upload Document</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload File
                </label>
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setUploadFile(f);
                    if (f) {
                      setFormData((prev) => ({
                        ...prev,
                        file_name: f.name,
                        file_size: f.size,
                        file_url: '',
                      }));
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Document Type *
                  </label>
                  <select
                    required
                    value={formData.document_type}
                    onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  >
                    {documentTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!uploadFile && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    File URL
                  </label>
                  <input
                    type="url"
                    value={formData.file_url}
                    onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
                    placeholder="https://example.com/document.pdf"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Provide URL only if you are not uploading a file.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700"
                >
                  Upload Document
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Revision Modal */}
      {showRevisionModal && selectedDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <h2 className="text-2xl font-bold mb-4">
              Add Revision - {selectedDocument.title}
            </h2>
            <form onSubmit={handleAddRevision} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Revision Number *
                </label>
                <input
                  type="text"
                  required
                  value={revisionData.revision_number}
                  onChange={(e) => setRevisionData({ ...revisionData, revision_number: e.target.value })}
                  placeholder="2.0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload File
                </label>
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setRevisionFile(f);
                    if (f) {
                      setRevisionData((prev) => ({
                        ...prev,
                        file_name: f.name,
                        file_size: f.size,
                        file_url: '',
                      }));
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {!revisionFile && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    File URL
                  </label>
                  <input
                    type="url"
                    value={revisionData.file_url}
                    onChange={(e) => setRevisionData({ ...revisionData, file_url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Provide URL only if you are not uploading a file.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Revision Type
                </label>
                <select
                  value={revisionData.revision_type}
                  onChange={(e) => setRevisionData({ ...revisionData, revision_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                >
                  <option value="MINOR">Minor</option>
                  <option value="MAJOR">Major</option>
                  <option value="CORRECTION">Correction</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Change Description *
                </label>
                <textarea
                  required
                  value={revisionData.change_description}
                  onChange={(e) => setRevisionData({ ...revisionData, change_description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
                >
                  Add Revision
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevisionModal(false);
                    setSelectedDocument(null);
                    setRevisionFile(null);
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
