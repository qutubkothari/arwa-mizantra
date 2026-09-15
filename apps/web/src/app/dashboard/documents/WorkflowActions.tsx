import { useState, useEffect } from 'react';
import { apiClient } from '../../../../lib/api-client';

interface WorkflowActionsProps {
  document: {
    id: string;
    status: string;
    document_number: string;
    title: string;
  };
  onSuccess: () => void;
}

interface Employee {
  id: string;
  employee_name: string;
  email: string;
  designation: string;
}

export default function WorkflowActions({ document, onSuccess }: WorkflowActionsProps) {
  const [showModal, setShowModal] = useState(false);
  const [action, setAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [formData, setFormData] = useState({
    recipientEmail: '',
    recipientName: '',
    comments: '',
    reason: '',
    clientEmail: '',
    clientName: '',
    message: '',
  });

  // Load employees list
  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const data = await apiClient.get<Employee[]>('/hr/employees');
      setEmployees(Array.isArray(data) ? data : (data as any)?.data || []);
    } catch (error) {
    } finally {
      setLoadingEmployees(false);
    }
  };

  const handleEmployeeSelect = (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId);
    if (employee) {
      setFormData({
        ...formData,
        recipientName: employee.employee_name,
        recipientEmail: employee.email,
      });
    }
  };

  const handleAction = async () => {
    setLoading(true);
    try {
      let endpoint = '';
      let payload: any = {};

      switch (action) {
        case 'forward-to-staff':
          endpoint = `/documents/${document.id}/forward-to-staff`;
          payload = {
            recipientEmail: formData.recipientEmail,
            recipientName: formData.recipientName,
            comments: formData.comments,
          };
          break;
        case 'return-to-admin':
          endpoint = `/documents/${document.id}/return-to-admin`;
          payload = { comments: formData.comments };
          break;
        case 'forward-to-manager':
          endpoint = `/documents/${document.id}/forward-to-manager`;
          payload = {
            recipientEmail: formData.recipientEmail,
            recipientName: formData.recipientName,
            comments: formData.comments,
          };
          break;
        case 'send-to-client':
          endpoint = `/documents/${document.id}/send-to-client`;
          payload = {
            clientEmail: formData.clientEmail,
            clientName: formData.clientName,
            message: formData.message,
          };
          break;
        case 'reject':
          endpoint = `/documents/${document.id}/workflow-reject`;
          payload = {
            reason: formData.reason,
            rejectedBy: formData.recipientName,
          };
          break;
        case 'final-approve':
          endpoint = `/documents/${document.id}/final-approve`;
          payload = {};
          break;
      }

      await apiClient.post(endpoint, payload);
      setShowModal(false);
      setFormData({
        recipientEmail: '',
        recipientName: '',
        comments: '',
        reason: '',
        clientEmail: '',
        clientName: '',
        message: '',
      });
      onSuccess();
    } catch (error: any) {
      alert(error.response?.data?.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (actionType: string) => {
    setAction(actionType);
    setShowModal(true);
  };

  const getAvailableActions = () => {
    const actions: Array<{ label: string; action: string; color: string; icon: string }> = [];

    switch (document.status) {
      case 'DRAFT':
        actions.push({ label: 'Forward to Staff', action: 'forward-to-staff', color: 'blue', icon: '→' });
        break;
      case 'PENDING_REVIEW':
        actions.push({ label: 'Return to Admin', action: 'return-to-admin', color: 'yellow', icon: '←' });
        actions.push({ label: 'Reject', action: 'reject', color: 'red', icon: '✗' });
        break;
      case 'PENDING_APPROVAL':
        actions.push({ label: 'Forward to Manager', action: 'forward-to-manager', color: 'blue', icon: '→' });
        actions.push({ label: 'Reject', action: 'reject', color: 'red', icon: '✗' });
        break;
      case 'SENT_TO_CLIENT':
        actions.push({ label: 'Final Approve', action: 'final-approve', color: 'green', icon: '✓' });
        actions.push({ label: 'Send to Client Again', action: 'send-to-client', color: 'blue', icon: '📧' });
        break;
      default:
        if (document.status !== 'APPROVED' && document.status !== 'REJECTED') {
          actions.push({ label: 'Send to Client', action: 'send-to-client', color: 'purple', icon: '📧' });
        }
    }

    return actions;
  };

  const renderModalContent = () => {
    switch (action) {
      case 'forward-to-staff':
      case 'forward-to-manager':
        return (
          <>
            <h3 className="text-lg font-semibold mb-4">
              {action === 'forward-to-staff' ? 'Forward to Staff' : 'Forward to Manager'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Employee
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  onChange={(e) => handleEmployeeSelect(e.target.value)}
                  disabled={loadingEmployees}
                >
                  <option value="">-- Select Employee --</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.employee_name} ({emp.designation})
                    </option>
                  ))}
                </select>
                {loadingEmployees && (
                  <p className="text-xs text-gray-500 mt-1">Loading employees...</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                  value={formData.recipientName}
                  onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
                  required
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 bg-gray-50"
                  value={formData.recipientEmail}
                  onChange={(e) => setFormData({ ...formData, recipientEmail: e.target.value })}
                  required
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comments
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  rows={3}
                  value={formData.comments}
                  onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                />
              </div>
            </div>
          </>
        );

      case 'return-to-admin':
        return (
          <>
            <h3 className="text-lg font-semibold mb-4">Return to Admin</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comments
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  rows={3}
                  value={formData.comments}
                  onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                  placeholder="Add any comments or feedback..."
                />
              </div>
            </div>
          </>
        );

      case 'send-to-client':
        return (
          <>
            <h3 className="text-lg font-semibold mb-4">Send to Client</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Name
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Email
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={formData.clientEmail}
                  onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  rows={4}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Add a message for the client..."
                />
              </div>
            </div>
          </>
        );

      case 'reject':
        return (
          <>
            <h3 className="text-lg font-semibold mb-4">Reject Document</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  value={formData.recipientName}
                  onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for Rejection
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
                  rows={4}
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="Explain why this document is being rejected..."
                  required
                />
              </div>
            </div>
          </>
        );

      case 'final-approve':
        return (
          <>
            <h3 className="text-lg font-semibold mb-4">Final Approval</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to give final approval to this document? This action will mark the document as APPROVED.
            </p>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-800">
                <strong>Document:</strong> {document.document_number} - {document.title}
              </p>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  const availableActions = getAvailableActions();

  if (availableActions.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {availableActions.map((item) => (
          <button
            key={item.action}
            onClick={() => openModal(item.action)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors
              ${item.color === 'blue' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : ''}
              ${item.color === 'yellow' ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100' : ''}
              ${item.color === 'red' ? 'bg-red-50 text-red-700 hover:bg-red-100' : ''}
              ${item.color === 'green' ? 'bg-green-50 text-green-700 hover:bg-green-100' : ''}
              ${item.color === 'purple' ? 'bg-purple-50 text-purple-700 hover:bg-purple-100' : ''}
            `}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            {renderModalContent()}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                disabled={loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors disabled:bg-gray-400"
              >
                {loading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
