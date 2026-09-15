'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../../../lib/api-client';

interface WorkflowHistoryItem {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor_name: string;
  actor_email: string;
  recipient_name: string | null;
  recipient_email: string | null;
  comments: string | null;
  created_at: string;
}

interface WorkflowHistoryProps {
  documentId: string;
}

export default function WorkflowHistory({ documentId }: WorkflowHistoryProps) {
  const [history, setHistory] = useState<WorkflowHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (showHistory && documentId) {
      loadHistory();
    }
  }, [showHistory, documentId]);

  const loadHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.get<WorkflowHistoryItem[]>(`/documents/${documentId}/workflow-history`);
      setHistory(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load workflow history');
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const formatAction = (action: string): string => {
    const actionMap: Record<string, string> = {
      'FORWARDED_TO_STAFF': '📤 Forwarded to Staff',
      'RETURNED_TO_ADMIN': '↩️ Returned to Admin',
      'FORWARDED_TO_MANAGER': '📤 Forwarded to Manager',
      'SENT_TO_CLIENT': '📧 Sent to Client',
      'REJECTED': '❌ Rejected',
      'FINAL_APPROVED': '✅ Final Approved',
      'CREATED': '📝 Created',
      'CLIENT_UPLOADED_REVISION': '📎 Client Uploaded Revision',
    };
    return actionMap[action] || action;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-2"
      >
        {showHistory ? '▼' : '▶'} View Workflow History
      </button>

      {showHistory && (
        <div className="mt-3 border border-gray-200 rounded-lg bg-gray-50 p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Document Workflow Timeline</h4>

          {loading && (
            <div className="text-sm text-gray-500">Loading history...</div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded">
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div className="text-sm text-gray-500 italic">
              No workflow history available yet.
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <div className="space-y-3">
              {history.map((item, index) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 relative"
                >
                  {/* Timeline connector */}
                  {index < history.length - 1 && (
                    <div className="absolute left-4 top-12 bottom-0 w-0.5 bg-gray-300" style={{ height: 'calc(100% + 12px)' }} />
                  )}

                  <div className="flex items-start gap-3">
                    {/* Timeline dot */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-xs relative z-10">
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Action and time */}
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatAction(item.action)}
                        </span>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {formatDate(item.created_at)}
                        </span>
                      </div>

                      {/* Actor info */}
                      <div className="text-xs text-gray-600 mb-1">
                        <span className="font-medium">By:</span> {item.actor_name}
                        {item.actor_email && (
                          <span className="text-gray-500"> ({item.actor_email})</span>
                        )}
                      </div>

                      {/* Recipient info (if any) */}
                      {item.recipient_name && (
                        <div className="text-xs text-gray-600 mb-1">
                          <span className="font-medium">To:</span> {item.recipient_name}
                          {item.recipient_email && (
                            <span className="text-gray-500"> ({item.recipient_email})</span>
                          )}
                        </div>
                      )}

                      {/* Status change */}
                      {item.from_status && item.to_status && (
                        <div className="text-xs text-gray-500 mb-1">
                          <span className="font-medium">Status:</span>{' '}
                          <span className="bg-gray-100 px-2 py-0.5 rounded">{item.from_status}</span>
                          {' → '}
                          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded">{item.to_status}</span>
                        </div>
                      )}

                      {/* Comments */}
                      {item.comments && (
                        <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded mt-2 border-l-2 border-amber-400">
                          <span className="font-medium">Comments:</span> {item.comments}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
