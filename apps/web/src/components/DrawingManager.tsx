'use client';

import { useState, useEffect } from 'react';

interface Drawing {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  version: number;
  revision_notes: string;
  is_active: boolean;
  uploaded_by: string;
  created_at: string;
  document_id?: string | null;
  drawing_number?: string | null;
  revision_code?: string | null;
  lifecycle_status?: string | null;
  effective_from?: string | null;
}

interface DocumentOption {
  id: string;
  title?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  created_at?: string | null;
  document_type?: string | null;
}

interface DrawingManagerProps {
  itemId: string;
  itemCode: string;
  itemName: string;
  onClose: () => void;
  onChanged?: (drawings: Drawing[]) => void;
  mandatory?: boolean;
}

export default function DrawingManager({ itemId, itemCode, itemName, onClose, onChanged, mandatory = false }: DrawingManagerProps) {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [updatingActiveId, setUpdatingActiveId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [externalUrl, setExternalUrl] = useState('');
  const [externalUrlName, setExternalUrlName] = useState('');
  const [linkingUrl, setLinkingUrl] = useState(false);

  const dataUrlToBlob = (dataUrl: string) => {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];
    const base64Data = match[2];
    const byteString = atob(base64Data);
    const byteArray = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      byteArray[i] = byteString.charCodeAt(i);
    }

    return new Blob([byteArray], { type: mimeType });
  };

  const openDrawingInNewTab = async (drawing: Drawing) => {
    try {
      if (!drawing?.file_url) return;

      // Prefer Blob URLs for reliability (data: URLs can be too long / blocked in some browsers)
      if (drawing.file_url.startsWith('data:')) {
        const blob = dataUrlToBlob(drawing.file_url);
        if (!blob) {
          window.open(drawing.file_url, '_blank', 'noopener,noreferrer');
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return;
      }

      window.open(drawing.file_url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Error opening drawing:', error);
      alert('Failed to open drawing');
    }
  };

  const downloadDrawing = async (drawing: Drawing) => {
    try {
      if (!drawing?.file_url) return;

      if (drawing.file_url.startsWith('data:')) {
        const blob = dataUrlToBlob(drawing.file_url);
        if (!blob) {
          const link = document.createElement('a');
          link.href = drawing.file_url;
          link.download = drawing.file_name || 'drawing';
          document.body.appendChild(link);
          link.click();
          link.remove();
          return;
        }

        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = drawing.file_name || 'drawing';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        return;
      }

      const link = document.createElement('a');
      link.href = drawing.file_url;
      link.download = drawing.file_name || 'drawing';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading drawing:', error);
      alert('Failed to download drawing');
    }
  };

  useEffect(() => {
    fetchDrawings();
    fetchDocuments();
  }, [itemId]);

  const fetchDrawings = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/inventory/items/${itemId}/drawings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const normalized = Array.isArray(data) ? data : [];
        setDrawings(normalized);
        onChanged?.(normalized);
        return normalized;
      }
    } catch (error) {
      console.error('Error fetching drawings:', error);
    } finally {
      setLoading(false);
    }

    return [];
  };

  const fetchDocuments = async () => {
    try {
      setDocumentsLoading(true);
      const token = localStorage.getItem('accessToken');

      // We store drawings as Documents of type DRAWING (and sometimes TECHNICAL_DRAWING)
      const [drawingsRes, technicalRes] = await Promise.all([
        fetch('/api/v1/documents?document_type=DRAWING', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/v1/documents?document_type=TECHNICAL_DRAWING', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const results: DocumentOption[] = [];
      if (drawingsRes.ok) {
        const data = await drawingsRes.json();
        if (Array.isArray(data)) results.push(...data);
      }
      if (technicalRes.ok) {
        const data = await technicalRes.json();
        if (Array.isArray(data)) results.push(...data);
      }

      // Deduplicate by id, and keep newest first
      const byId = new Map<string, DocumentOption>();
      for (const doc of results) {
        if (doc?.id && !byId.has(doc.id)) byId.set(doc.id, doc);
      }

      const merged = Array.from(byId.values()).sort((a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bt - at;
      });

      setDocuments(merged);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  };

  const handleLinkExistingDocument = async () => {
    if (!selectedDocumentId) {
      alert('Please select a drawing document');
      return;
    }

    if (!revisionNotes.trim() && drawings.length > 0) {
      alert('Please add revision notes for new versions');
      return;
    }

    setLinking(true);
    try {
      const token = localStorage.getItem('accessToken');

      const response = await fetch(`/api/v1/inventory/items/${itemId}/drawings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          documentId: selectedDocumentId,
          revisionNotes: revisionNotes.trim() || (drawings.length > 0 ? 'Linked from Documents' : 'Initial version'),
        }),
      });

      if (response.ok) {
        alert('Drawing linked successfully!');
        setSelectedDocumentId('');
        setRevisionNotes('');
        await fetchDrawings();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(`Failed to link: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error linking document:', error);
      alert('Failed to link drawing');
    } finally {
      setLinking(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
      if (!validTypes.includes(file.type)) {
        alert('Please upload PNG, JPG, or PDF files only');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
      }

      setSelectedFile(file);

      // Create preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreviewUrl(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    if (!revisionNotes.trim() && drawings.length > 0) {
      alert('Please add revision notes for new versions');
      return;
    }

    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read drawing file'));
        reader.readAsDataURL(selectedFile);
      });

      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/v1/inventory/items/${itemId}/drawings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileUrl: base64,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          revisionNotes: revisionNotes.trim() || 'Initial version',
        }),
      });

      if (response.ok) {
        alert('Drawing uploaded successfully!');
        setSelectedFile(null);
        setRevisionNotes('');
        setPreviewUrl(null);
        await fetchDrawings();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(`Failed to upload: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error uploading drawing:', error);
      alert('Failed to upload drawing');
    } finally {
      setUploading(false);
    }
  };

  const handleTransition = async (drawing: Drawing, action: 'SUBMIT' | 'APPROVE' | 'REJECT') => {
    try {
      setUpdatingActiveId(drawing.id);
      const token = localStorage.getItem('accessToken');

      if (action === 'APPROVE') {
        const impactResponse = await fetch(`/api/v1/inventory/items/${itemId}/drawings/${drawing.id}/impact`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!impactResponse.ok) throw new Error('Unable to check revision impact');
        const impact = await impactResponse.json();
        const affected = Number(impact?.open_job_count || 0) + Number(impact?.open_project_demand_count || 0);
        if (affected > 0 && !window.confirm(`${impact.warning}\n\nOpen jobs: ${impact.open_job_count}\nOpen project demands: ${impact.open_project_demand_count}\n\nApprove this revision?`)) {
          return;
        }
      }

      const response = await fetch(`/api/v1/inventory/items/${itemId}/drawings/${drawing.id}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        await fetchDrawings();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(`Failed to ${action.toLowerCase()} drawing: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error changing drawing status:', error);
      alert('Failed to change drawing status');
    } finally {
      setUpdatingActiveId(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const canClose = !mandatory || drawings.length > 0;

  const activeDrawing = drawings.find(d => d.lifecycle_status === 'APPROVED' && d.is_active) || drawings.find(d => d.is_active) || null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[1200] p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Drawing Management</h2>
              <p className="text-gray-600 mt-1">
                {itemCode} - {itemName}
              </p>
              {mandatory && drawings.length === 0 && (
                <div className="mt-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-800">
                  ⚠️ Drawing upload is mandatory for this item before proceeding
                </div>
              )}
            </div>
            {canClose && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Upload Section */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="font-semibold text-amber-900 mb-3">
              {drawings.length > 0 ? `Upload New Version (v${drawings[0].version + 1})` : 'Upload First Drawing (v1)'}
            </h3>

            <div className="space-y-4">
              {/* Link existing Document */}
              <div className="bg-white border border-amber-200 rounded-lg p-3">
                <div className="text-sm font-medium text-amber-900 mb-2">Use Existing Drawing from Documents</div>
                <div className="flex gap-2 items-center">
                  <select
                    value={selectedDocumentId}
                    onChange={(e) => setSelectedDocumentId(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    disabled={documentsLoading || linking}
                  >
                    <option value="">{documentsLoading ? 'Loading drawings…' : 'Select a drawing document'}</option>
                    {documents.map((doc) => {
                      const label = (doc.title || doc.file_name || doc.id || '').toString();
                      return (
                        <option key={doc.id} value={doc.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>

                  <button
                    type="button"
                    onClick={handleLinkExistingDocument}
                    disabled={!selectedDocumentId || linking}
                    className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 disabled:bg-gray-400 text-sm"
                  >
                    {linking ? 'Linking…' : 'Link'}
                  </button>
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  This will create a new drawing version for this item using the selected Document.
                </div>
              </div>

              {/* External URL option */}
              <div className="bg-white border border-amber-200 rounded-lg p-3">
                <div className="text-sm font-medium text-amber-900 mb-2">Link External URL / Cloud Drive</div>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={externalUrlName}
                    onChange={(e) => setExternalUrlName(e.target.value)}
                    placeholder="Drawing name / description (e.g. Assembly Drawing Rev 2)"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                      placeholder="https://drive.google.com/... or any public URL"
                      className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!externalUrl.trim() || linkingUrl}
                      onClick={async () => {
                        if (!externalUrl.trim()) return;
                        setLinkingUrl(true);
                        try {
                          const token = localStorage.getItem('accessToken');
                          const res = await fetch(`/api/v1/inventory/items/${itemId}/drawings`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({
                              fileName: externalUrlName.trim() || new URL(externalUrl).pathname.split('/').pop() || 'external-link',
                              fileUrl: externalUrl.trim(),
                              fileType: 'application/external-link',
                              fileSize: 0,
                              revisionNotes: revisionNotes.trim() || 'Linked external URL',
                            }),
                          });
                          if (res.ok) {
                            alert('External URL linked successfully!');
                            setExternalUrl('');
                            setExternalUrlName('');
                            setRevisionNotes('');
                            await fetchDrawings();
                          } else {
                            const err = await res.json().catch(() => ({}));
                            alert(`Failed: ${err.message || 'Unknown error'}`);
                          }
                        } catch (e: any) {
                          alert(e.message || 'Failed to link URL');
                        } finally {
                          setLinkingUrl(false);
                        }
                      }}
                      className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      {linkingUrl ? 'Linking…' : 'Link URL'}
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Paste a Google Drive, SharePoint, or any accessible URL.</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload File (PNG, JPG, PDF - Max 10MB)
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,application/pdf"
                  onChange={handleFileSelect}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                />
              </div>

              {previewUrl && (
                <div className="border border-gray-300 rounded-lg p-2">
                  <img src={previewUrl} alt="Preview" className="max-h-48 mx-auto" />
                </div>
              )}

              {selectedFile && (
                <div className="text-sm text-gray-600">
                  Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </div>
              )}

              {drawings.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Revision Notes *
                  </label>
                  <textarea
                    value={revisionNotes}
                    onChange={(e) => setRevisionNotes(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    placeholder="What changed in this version..."
                  />
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
                className="w-full bg-amber-600 text-white px-6 py-3 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {uploading ? 'Uploading...' : 'Upload Drawing'}
              </button>
            </div>
          </div>

          {/* Existing Drawings */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">
              Drawing History ({drawings.length} versions)
            </h3>

            {activeDrawing && (
              <div className="mb-3 text-sm bg-green-50 border border-green-200 rounded px-3 py-2 text-green-900">
                Approved production drawing: <span className="font-semibold">{activeDrawing.drawing_number || `v${activeDrawing.version}`} {activeDrawing.revision_code || ''}</span> ({activeDrawing.file_name})
              </div>
            )}

            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading drawings...</div>
            ) : drawings.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                <div className="text-4xl mb-2">📄</div>
                <p className="text-gray-600">No drawings uploaded yet</p>
                <p className="text-sm text-gray-500 mt-1">Upload the first version above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {drawings.map((drawing) => (
                  <div
                    key={drawing.id}
                    className="border border-gray-300 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-semibold">
                            v{drawing.version}
                          </span>
                          <span className="font-medium text-gray-900">{drawing.file_name}</span>
                          <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-semibold">
                            {drawing.drawing_number || 'Drawing'} / {drawing.revision_code || `R${drawing.version}`}
                          </span>
                          {drawing.version === drawings[0].version && (
                            <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">
                              LATEST
                            </span>
                          )}
                          {(drawing.lifecycle_status || (drawing.is_active ? 'APPROVED' : 'SUPERSEDED')) && (
                            <span className="bg-amber-100 text-amber-900 px-2 py-1 rounded text-xs font-semibold">
                              {drawing.lifecycle_status || (drawing.is_active ? 'APPROVED' : 'SUPERSEDED')}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 text-sm text-gray-600 grid grid-cols-2 gap-x-4">
                          <div>Type: {drawing.file_type === 'application/external-link' ? <span className="text-blue-600 font-medium">🔗 External URL</span> : drawing.file_type}</div>
                          <div>{drawing.file_type === 'application/external-link' ? '' : `Size: ${formatFileSize(drawing.file_size)}`}</div>
                          <div className="col-span-2 mt-1">Uploaded: {formatDate(drawing.created_at)}</div>
                          {drawing.file_type === 'application/external-link' && (
                            <div className="col-span-2 mt-1 truncate text-blue-500 text-xs">{drawing.file_url}</div>
                          )}
                        </div>

                        {drawing.revision_notes && (
                          <div className="mt-2 text-sm bg-gray-50 rounded px-3 py-2">
                            <span className="font-medium">Notes:</span> {drawing.revision_notes}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openDrawingInNewTab(drawing)}
                          className="bg-blue-100 text-blue-700 px-4 py-2 rounded hover:bg-blue-200 text-sm font-medium"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadDrawing(drawing)}
                          className="bg-green-100 text-green-700 px-4 py-2 rounded hover:bg-green-200 text-sm font-medium"
                        >
                          Download
                        </button>
                        {(drawing.lifecycle_status || 'DRAFT') === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => handleTransition(drawing, 'SUBMIT')}
                            disabled={updatingActiveId === drawing.id}
                            className="bg-amber-100 text-amber-900 px-4 py-2 rounded hover:bg-amber-200 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {updatingActiveId === drawing.id ? 'Submitting...' : 'Submit'}
                          </button>
                        )}
                        {drawing.lifecycle_status === 'SUBMITTED' && (
                          <>
                            <button type="button" onClick={() => handleTransition(drawing, 'APPROVE')} disabled={updatingActiveId === drawing.id} className="bg-emerald-100 text-emerald-800 px-4 py-2 rounded hover:bg-emerald-200 text-sm font-medium disabled:opacity-50">Approve</button>
                            <button type="button" onClick={() => handleTransition(drawing, 'REJECT')} disabled={updatingActiveId === drawing.id} className="bg-red-100 text-red-700 px-4 py-2 rounded hover:bg-red-200 text-sm font-medium disabled:opacity-50">Return</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
          {!canClose && (
            <p className="text-red-600 text-sm flex-1">
              Please upload at least one drawing before closing
            </p>
          )}
          {canClose && (
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
