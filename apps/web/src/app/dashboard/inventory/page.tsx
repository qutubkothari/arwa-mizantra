'use client';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import { useSelection } from '../../../hooks/useSelection';
import { confirmDialog } from '../../../components/ui/ConfirmDialog';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface StockLevel {
  id: string;
  item_id: string;
  warehouse_id: string;
  quantity: number;
  available_quantity: number;
  allocated_quantity: number;
  unit_price?: number;
  batch_number?: string;
  items: {
    code: string;
    name: string;
    uom: string;
    category: string;
    standard_cost?: number;
    selling_price?: number;
  };
  warehouses: {
    code: string;
    name: string;
  };
}

interface StockMovement {
  id: string;
  movement_number: string;
  movement_type: string;
  quantity: number;
  uid?: string;
  movement_date: string;
  reference_number?: string;
  notes?: string;
  items: {
    code: string;
    name: string;
  };
  from_warehouse?: {
    code: string;
    name: string;
  };
  to_warehouse?: {
    code: string;
    name: string;
  };
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
  items?: {
    item_code?: string | null;
    item_name?: string | null;
  } | null;
  warehouses?: {
    warehouse_code: string;
    warehouse_name: string;
  };
}

interface DemoItem {
  id: string;
  demo_id: string;
  uid: string;
  customer_name: string;
  customer_contact: string;
  issue_date: string;
  expected_return_date?: string;
  status: string;
  demo_expenses: number;
  items?: {
    item_code?: string | null;
    item_name?: string | null;
  } | null;
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="text-xl">Loading...</div>
        </div>
      }
    >
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  const router = useRouter();
  const currentUser = readStoredUser();
  const canDelete = hasModulePermission(currentUser, 'Inventory', 'delete');
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  
  const [activeTab, setActiveTab] = useState<'movements' | 'alerts' | 'demo'>(
    (tabParam as 'movements' | 'alerts' | 'demo') || 'movements'
  );
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [demoItems, setDemoItems] = useState<DemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailModal, setEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const movementSelection = useSelection(movements);
  const alertSelection = useSelection(alerts);
  const demoSelection = useSelection(demoItems);

  // Update tab when URL parameter changes
  useEffect(() => {
    if (tabParam && ['movements', 'alerts', 'demo'].includes(tabParam)) {
      setActiveTab(tabParam as 'movements' | 'alerts' | 'demo');
    }
  }, [tabParam]);

  useEffect(() => {
    fetchData();
    if (activeTab === 'alerts') {
      apiClient.post('/inventory/alerts/check-low-stock', {}).then(() => fetchData()).catch(() => {});
    }
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'movements') {
        const data = await apiClient.get('/inventory/movements', { limit: 50 });
        setMovements(Array.isArray(data) ? data : []);
      } else if (activeTab === 'alerts') {
        const data = await apiClient.get('/inventory/alerts', { acknowledged: false });
        setAlerts(Array.isArray(data) ? data : []);
      } else if (activeTab === 'demo') {
        const data = await apiClient.get('/inventory/demo');
        setDemoItems(Array.isArray(data) ? data : []);
      }
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await apiClient.put(`/inventory/alerts/${alertId}/acknowledge`);
      fetchData();
    } catch (error) {
    }
  };

  const sendLowStockEmail = async () => {
    if (!recipientEmail) {
      alert('Please enter a recipient email address');
      return;
    }

    setSendingEmail(true);
    try {
      const result = await apiClient.post('/inventory/alerts/send-email', { recipientEmail });
      alert(`Email sent successfully to ${recipientEmail}. ${result.itemCount} low stock items included.`);
      setEmailModal(false);
      setRecipientEmail('');
    } catch (error: any) {
      alert(error.response?.data?.message || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const checkAllLowStock = async () => {
    try {
      const result = await apiClient.post('/inventory/alerts/check-low-stock');
      alert(result.message);
      fetchData();
    } catch (error: any) {
      alert('Failed to check low stock');
    }
  };

  const checkJobOrderAlerts = async () => {
    try {
      const result = await apiClient.post('/inventory/alerts/check-job-orders');
      alert(result.message);
      fetchData();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to check job orders';
      alert(`Error: ${errorMessage}`);
    }
  };

  const deleteMovements = async (ids: string[]) => {
    const confirmed = await confirmDialog({
      title: `Delete ${ids.length} Movement${ids.length > 1 ? 's' : ''}`,
      message: `Are you sure you want to delete ${ids.length} movements? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await Promise.all(ids.map(id => apiClient.delete(`/inventory/movements/${id}`)));
      movementSelection.deselectAll();
      fetchData();
    } catch (error) {
    }
  };

  const deleteAlerts = async (ids: string[]) => {
    const confirmed = await confirmDialog({
      title: `Delete ${ids.length} Alert${ids.length > 1 ? 's' : ''}`,
      message: `Are you sure you want to delete ${ids.length} alerts? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await Promise.all(ids.map(id => apiClient.delete(`/inventory/alerts/${id}`)));
      alertSelection.deselectAll();
      fetchData();
    } catch (error) {
    }
  };

  const deleteDemoItems = async (ids: string[]) => {
    const confirmed = await confirmDialog({
      title: `Delete ${ids.length} Demo Item${ids.length > 1 ? 's' : ''}`,
      message: `Are you sure you want to delete ${ids.length} demo items? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await Promise.all(ids.map(id => apiClient.delete(`/inventory/demo/${id}`)));
      demoSelection.deselectAll();
      fetchData();
    } catch (error) {
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'text-red-600 bg-red-50';
      case 'HIGH': return 'text-orange-600 bg-orange-50';
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-amber-600 bg-amber-50';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'RAW_MATERIAL': return 'bg-blue-100 text-blue-800';
      case 'WIP': return 'bg-yellow-100 text-yellow-800';
      case 'FINISHED_GOODS': return 'bg-green-100 text-green-800';
      case 'DEMO': return 'bg-purple-100 text-purple-800';
      case 'SERVICE_SPARES': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ISSUED': return 'bg-blue-100 text-blue-800';
      case 'RETURNED': return 'bg-green-100 text-green-800';
      case 'SOLD': return 'bg-purple-100 text-purple-800';
      case 'DAMAGED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const inventoryWorkspaces = [
    {
      id: 'movements',
      title: 'Stock movements',
      detail: 'Review all inventory issues, receipts and transfers.',
      path: '/dashboard/inventory?tab=movements',
    },
    {
      id: 'alerts',
      title: 'Stock alerts',
      detail: 'Review low-stock and job-order shortage exceptions.',
      path: '/dashboard/inventory?tab=alerts',
    },
    {
      id: 'demo',
      title: 'Demo inventory',
      detail: 'Track customer demo units and expected returns.',
      path: '/dashboard/inventory?tab=demo',
    },
  ] as const;

  const activeWorkspace = inventoryWorkspaces.find((workspace) => workspace.id === activeTab) || inventoryWorkspaces[0];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
        <p className="text-gray-600">{activeWorkspace.title}: {activeWorkspace.detail}</p>
      </div>

      <section className="mb-6 grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => router.push('/dashboard/inventory/items')}
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:border-amber-400"
        >
          <span className="block text-sm font-bold text-amber-900">Stock master</span>
          <span className="block text-xs text-amber-800">Items, stock position and warehouse balance.</span>
        </button>
        {inventoryWorkspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => router.push(workspace.path)}
            className={`rounded-lg border px-4 py-3 text-left transition ${activeTab === workspace.id ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-gray-50 hover:border-amber-300 hover:bg-amber-50/50'}`}
          >
            <span className="block text-sm font-bold text-gray-900">{workspace.title}{workspace.id === 'alerts' && alerts.length > 0 ? ` (${alerts.length})` : ''}</span>
            <span className="block text-xs text-gray-600">{workspace.detail}</span>
          </button>
        ))}
      </section>

      {/* Movements Tab */}
      {activeTab === 'movements' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {movements.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={movementSelection.isAllSelected}
                    onChange={movementSelection.toggleSelectAll}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Select All ({movements.length} movements)
                  </span>
                </label>
                {movementSelection.hasSelections && canDelete && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteMovements(Array.from(movementSelection.selectedIds))}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      Delete Selected ({movementSelection.selectedItems.length})
                    </button>
                    <button
                      onClick={movementSelection.deselectAll}
                      className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Movement #</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">UID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : movements.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    No movements found
                  </td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id} className={`hover:bg-gray-50 ${movementSelection.isSelected(movement.id) ? 'bg-amber-50' : ''}`}>
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={movementSelection.isSelected(movement.id)}
                        onChange={() => movementSelection.toggleSelection(movement.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{movement.movement_number}</div>
                      {movement.reference_number && (
                        <div className="text-sm text-gray-500">Ref: {movement.reference_number}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-gray-900">
                        {movement.movement_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{movement.items.name}</div>
                      <div className="text-sm text-gray-500">{movement.items.code}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {movement.from_warehouse?.name || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {movement.to_warehouse?.name || '-'}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      {movement.quantity}
                    </td>
                    <td className="px-6 py-4">
                      {movement.uid ? (
                        <span className="text-sm font-mono text-amber-600">{movement.uid}</span>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(movement.movement_date).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div>
          <div className="mb-4 p-4 bg-white rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {alerts.length > 0 && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={alertSelection.isAllSelected}
                      onChange={alertSelection.toggleSelectAll}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Select All ({alerts.length} alerts)
                    </span>
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={checkAllLowStock}
                  className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 text-sm flex items-center gap-2"
                >
                  🔍 Check Stock
                </button>
                <button
                  onClick={checkJobOrderAlerts}
                  className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm flex items-center gap-2"
                >
                  📋 Check Jobs
                </button>
                {alerts.length > 0 && (
                  <>
                    <button
                      onClick={() => setEmailModal(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center gap-2"
                    >
                      📧 Email Alert
                    </button>
                    {alertSelection.hasSelections && canDelete && (
                      <>
                        <button
                          onClick={() => deleteAlerts(Array.from(alertSelection.selectedIds))}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                        >
                          Delete Selected ({alertSelection.selectedItems.length})
                        </button>
                        <button
                          onClick={alertSelection.deselectAll}
                          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                        >
                          Deselect All
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : alerts.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                No active alerts
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`bg-white rounded-lg shadow p-6 border-l-4 ${
                    alert.severity === 'CRITICAL' ? 'border-red-500' :
                    alert.severity === 'HIGH' ? 'border-orange-500' :
                    alert.severity === 'MEDIUM' ? 'border-yellow-500' : 'border-amber-500'
                  } ${alertSelection.isSelected(alert.id) ? 'ring-2 ring-amber-500' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={alertSelection.isSelected(alert.id)}
                        onChange={() => alertSelection.toggleSelection(alert.id)}
                        className="w-4 h-4 mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${getSeverityColor(alert.severity)}`}>
                            {alert.severity}
                          </span>
                          <span className="text-sm text-gray-500">{alert.alert_type.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-gray-900 mb-2">{alert.message}</p>
                        <div className="text-sm text-gray-500">
                          {alert.items?.item_name || 'Unknown Item'}
                          {alert.items?.item_code ? ` (${alert.items.item_code})` : ''}
                          {alert.warehouses && ` - ${alert.warehouses.warehouse_name}`}
                        </div>
                        <div className="text-xs text-gray-400 mt-2">
                          {new Date(alert.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => acknowledgeAlert(alert.id)}
                      className="ml-4 px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                    >
                      Acknowledge
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Demo Inventory Tab */}
      {activeTab === 'demo' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {demoItems.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={demoSelection.isAllSelected}
                    onChange={demoSelection.toggleSelectAll}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Select All ({demoItems.length} demo items)
                  </span>
                </label>
                {demoSelection.hasSelections && canDelete && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteDemoItems(Array.from(demoSelection.selectedIds))}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                      Delete Selected ({demoSelection.selectedItems.length})
                    </button>
                    <button
                      onClick={demoSelection.deselectAll}
                      className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Demo ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">UID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expected Return</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : demoItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                    No demo items found
                  </td>
                </tr>
              ) : (
                demoItems.map((demo) => (
                  <tr key={demo.id} className={`hover:bg-gray-50 ${demoSelection.isSelected(demo.id) ? 'bg-amber-50' : ''}`}>
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={demoSelection.isSelected(demo.id)}
                        onChange={() => demoSelection.toggleSelection(demo.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {demo.demo_id}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{demo.items?.item_name || 'Unknown Item'}</div>
                      <div className="text-sm text-gray-500">{demo.items?.item_code || '-'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-mono text-amber-600">{demo.uid}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{demo.customer_name}</div>
                      <div className="text-sm text-gray-500">{demo.customer_contact}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(demo.issue_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {demo.expected_return_date
                        ? new Date(demo.expected_return_date).toLocaleDateString()
                        : '-'}
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-gray-900">
                      ₹{demo.demo_expenses.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(demo.status)}`}>
                        {demo.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Email Modal */}
      {emailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Send Low Stock Alert Email</h3>
            <p className="text-sm text-gray-600 mb-4">
              Send an email notification with all {alerts.length} low stock alerts to the specified recipient.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipient Email Address
              </label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="purchasing@company.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                disabled={sendingEmail}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setEmailModal(false);
                  setRecipientEmail('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                disabled={sendingEmail}
              >
                Cancel
              </button>
              <button
                onClick={sendLowStockEmail}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                disabled={sendingEmail || !recipientEmail}
              >
                {sendingEmail ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
