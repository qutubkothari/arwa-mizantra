'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../lib/api-client';
import { hasModulePermission, getUserRoleNames, isAdminLike, readStoredUser } from '@/lib/rbac';
import { FileText, Package, ClipboardCheck, Wrench, CheckCircle2, Clock, AlertCircle, FileCheck2 } from 'lucide-react';
import type { DashboardReminderQueue } from '@/components/DashboardReminders';

export const dynamic = 'force-dynamic';

interface PendingApproval {
  id: string;
  number: string;
  type: 'PR' | 'PO' | 'GRN' | 'JO' | 'QC' | 'SES';
  requestedBy: string;
  requestedDate: string;
  amount?: number;
  status: string;
  priority?: string;
}

interface ApprovalStats {
  totalPending: number;
  prCount: number;
  poCount: number;
  grnCount: number;
  joCount: number;
  qcCount: number;
  sesCount: number;
}

type PendingPO = {
  id: string;
  po_number?: string;
  vendor?: { name?: string } | null;
  created_at?: string;
  order_date?: string;
  total_amount?: number;
  status?: string;
};

type PendingGRN = {
  id: string;
  grn_number?: string;
  vendor?: { name?: string } | null;
  purchase_order?: { po_number?: string } | null;
  created_at?: string;
  receipt_date?: string;
  status?: string;
};

export default function ManagerDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<ApprovalStats>({
    totalPending: 0,
    prCount: 0,
    poCount: 0,
    grnCount: 0,
    joCount: 0,
    qcCount: 0,
    sesCount: 0,
  });
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');

  useEffect(() => {
    // Check if user is authenticated
    if (!apiClient.isAuthenticated()) {
      router.push('/login');
      return;
    }

    // Check if user has manager role
    const user = readStoredUser();
    const roleNames = getUserRoleNames(user);
    const isManager = roleNames.some(name => 
      ['MANAGER', 'HR MANAGER', 'MANAGER_HR', 'DEPARTMENT MANAGER', 'TEAM LEAD', 'SUPERVISOR'].includes(name.toUpperCase())
    );

    if (!isManager && !isAdminLike(user) && !hasModulePermission(user, 'HR Management', 'approve')) {
      alert('Access Denied: This dashboard is only available for managers');
      router.replace('/dashboard');
      return;
    }

    fetchApprovals();
  }, [router]);

  useEffect(() => {
    const applyReminderQueue = (queue: DashboardReminderQueue) => {
      const poApprovals: PendingApproval[] = queue.pendingPOs.map((po) => ({
        id: po.id,
        number: po.po_number || po.id,
        type: 'PO',
        requestedBy: po.vendor?.name || 'Supplier not assigned',
        requestedDate: po.created_at || po.order_date || new Date().toISOString(),
        amount: Number(po.total_amount || 0),
        status: po.status || 'Pending approval',
      }));
      const qcApprovals: PendingApproval[] = queue.pendingQC.map((grn) => ({
        id: grn.id,
        number: grn.grn_number || grn.id,
        type: 'QC',
        requestedBy: grn.vendor?.name || grn.purchase_order?.po_number || 'Goods receipt',
        requestedDate: grn.created_at || grn.receipt_date || new Date().toISOString(),
        status: grn.status || 'QC pending',
      }));

      setApprovals((current) => {
        const otherApprovals = current.filter((item) => item.type !== 'PO' && item.type !== 'QC');
        const next = [...otherApprovals, ...poApprovals, ...qcApprovals];
        setStats({
          totalPending: next.length,
          prCount: next.filter((item) => item.type === 'PR').length,
          poCount: poApprovals.length,
          grnCount: next.filter((item) => item.type === 'GRN').length,
          joCount: next.filter((item) => item.type === 'JO').length,
          qcCount: qcApprovals.length,
          sesCount: next.filter((item) => item.type === 'SES').length,
        });
        return next;
      });
      setLoading(false);
    };

    const existing = (window as Window & { __sakPendingReminders?: DashboardReminderQueue }).__sakPendingReminders;
    if (existing) applyReminderQueue(existing);
    const listener = (event: Event) => applyReminderQueue((event as CustomEvent<DashboardReminderQueue>).detail);
    window.addEventListener('sak:pending-reminders', listener);
    return () => window.removeEventListener('sak:pending-reminders', listener);
  }, []);

  const fetchApprovals = async () => {
    try {
      setLoading(true);
      // The action-required widget already uses these two live queues.  Keep the
      // dashboard on the same sources so a PO/QC item cannot be visible in one
      // place and disappear from the manager worklist.
      const [managerResult, poResult, qcResult] = await Promise.allSettled([
        apiClient.get<PendingApproval[]>('/manager/pending-approvals'),
        apiClient.get<PendingPO[]>('/purchase/orders?status=PENDING'),
        apiClient.get<PendingGRN[]>('/purchase/grn?pendingQc=true'),
      ]);

      const managerApprovals = managerResult.status === 'fulfilled' && Array.isArray(managerResult.value)
        ? managerResult.value
        : [];
      const poApprovals: PendingApproval[] = poResult.status === 'fulfilled' && Array.isArray(poResult.value)
        ? poResult.value.map((po) => ({
            id: po.id,
            number: po.po_number || po.id,
            type: 'PO' as const,
            requestedBy: po.vendor?.name || 'Supplier not assigned',
            requestedDate: po.created_at || po.order_date || new Date().toISOString(),
            amount: Number(po.total_amount || 0),
            status: po.status || 'Pending approval',
          }))
        : [];
      const qcApprovals: PendingApproval[] = qcResult.status === 'fulfilled' && Array.isArray(qcResult.value)
        ? qcResult.value.map((grn) => ({
            id: grn.id,
            number: grn.grn_number || grn.id,
            type: 'QC' as const,
            requestedBy: grn.vendor?.name || grn.purchase_order?.po_number || 'Goods receipt',
            requestedDate: grn.created_at || grn.receipt_date || new Date().toISOString(),
            status: grn.status || 'QC pending',
          }))
        : [];

      // Manager endpoint can also return PO/QC records. De-duplicate by type + id.
      const data = [...managerApprovals, ...poApprovals, ...qcApprovals].filter(
        (approval, index, all) => all.findIndex((item) => item.type === approval.type && item.id === approval.id) === index,
      );
      
      // Calculate stats
      const prCount = data.filter((a: PendingApproval) => a.type === 'PR').length;
      const poCount = data.filter((a: PendingApproval) => a.type === 'PO').length;
      const grnCount = data.filter((a: PendingApproval) => a.type === 'GRN').length;
      const joCount = data.filter((a: PendingApproval) => a.type === 'JO').length;
      const qcCount = data.filter((a: PendingApproval) => a.type === 'QC').length;
      const sesCount = data.filter((a: PendingApproval) => a.type === 'SES').length;

      setStats({
        totalPending: data.length,
        prCount,
        poCount,
        grnCount,
        joCount,
        qcCount,
        sesCount,
      });
      setApprovals(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const filteredApprovals = selectedFilter === 'ALL' 
    ? approvals 
    : approvals.filter(a => a.type === selectedFilter);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'PR': return <FileText className="w-5 h-5" />;
      case 'PO': return <Package className="w-5 h-5" />;
      case 'GRN': return <ClipboardCheck className="w-5 h-5" />;
      case 'JO': return <Wrench className="w-5 h-5" />;
      case 'QC': return <CheckCircle2 className="w-5 h-5" />;
      case 'SES': return <FileCheck2 className="w-5 h-5" />;
      default: return <FileText className="w-5 h-5" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'PR': return '#8B6F47';
      case 'PO': return '#6F4E37';
      case 'GRN': return '#6B8E23';
      case 'JO': return '#4682B4';
      case 'QC': return '#DC2626';
      case 'SES': return '#087A55';
      default: return '#8B6F47';
    }
  };

  const handleApprovalClick = (approval: PendingApproval) => {
    switch (approval.type) {
      case 'PR':
        router.push('/dashboard/purchase/requisitions');
        break;
      case 'PO':
        router.push(`/dashboard/purchase/orders?viewId=${approval.id}`);
        break;
      case 'GRN':
        router.push(`/dashboard/purchase/grn?viewId=${approval.id}`);
        break;
      case 'JO':
        router.push('/dashboard/production/job-orders');
        break;
      case 'QC':
        router.push(`/dashboard/purchase/grn?viewId=${approval.id}`);
        break;
      case 'SES':
        router.push('/dashboard/purchase/service-entries');
        break;
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="bg-white shadow-sm border-2 rounded-lg mb-6 p-6" style={{ borderColor: '#E8DCC4' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#36454F' }}>
              Manager Approval Dashboard
            </h1>
            <p className="text-sm mt-1" style={{ color: '#6F4E37' }}>
              Review and approve pending requests from your team
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ backgroundColor: '#E8DCC4' }}>
            <Clock className="w-5 h-5" style={{ color: '#6F4E37' }} />
            <span className="font-semibold" style={{ color: '#6F4E37' }}>
              {stats.totalPending} Pending
            </span>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 mb-8">
        {[
          { title: 'Purchase Requisitions', value: stats.prCount, type: 'PR', icon: FileText, color: '#8B6F47' },
          { title: 'Purchase Orders', value: stats.poCount, type: 'PO', icon: Package, color: '#6F4E37' },
          { title: 'Goods Receipt', value: stats.grnCount, type: 'GRN', icon: ClipboardCheck, color: '#6B8E23' },
          { title: 'Job Orders', value: stats.joCount, type: 'JO', icon: Wrench, color: '#4682B4' },
          { title: 'Quality Control', value: stats.qcCount, type: 'QC', icon: CheckCircle2, color: '#DC2626' },
          { title: 'Service Acceptance', value: stats.sesCount, type: 'SES', icon: FileCheck2, color: '#087A55' },
        ].map((card, index) => (
          <div
            key={index}
            onClick={() => setSelectedFilter(card.type)}
            className={`bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-all border-2 cursor-pointer ${
              selectedFilter === card.type ? 'ring-4 ring-opacity-50' : ''
            }`}
            style={{ 
              borderColor: '#E8DCC4',
              ...(selectedFilter === card.type && { ringColor: card.color })
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 rounded-lg" style={{ backgroundColor: `${card.color}15` }}>
                <card.icon className="w-6 h-6" style={{ color: card.color }} />
              </div>
              {card.value > 0 && (
                <div className="px-2 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: card.color }}>
                  {card.value}
                </div>
              )}
            </div>
            <h3 className="text-sm font-medium mb-1" style={{ color: '#8B6F47' }}>
              {card.title}
            </h3>
            <p className="text-2xl font-bold" style={{ color: card.color }}>
              {loading ? '...' : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mb-6 flex items-center justify-between rounded-lg border-2 bg-white p-4" style={{ borderColor: '#E8DCC4' }}>
        <div>
          <div className="text-sm font-semibold text-[#6F4E37]">Approval type</div>
          <div className="text-xs text-gray-500">Choose the queue to review.</div>
        </div>
        <select
          value={selectedFilter}
          onChange={(event) => setSelectedFilter(event.target.value)}
          className="rounded-lg border border-[#D8C8AA] bg-white px-3 py-2 text-sm font-semibold text-[#4A3426]"
          aria-label="Approval type"
        >
          <option value="ALL">All ({stats.totalPending})</option>
          {['PR', 'PO', 'GRN', 'JO', 'QC', 'SES'].map((type) => {
            const count = stats[`${type.toLowerCase()}Count` as keyof ApprovalStats] as number;
            return <option key={type} value={type}>{type} ({count})</option>;
          })}
        </select>
      </div>

      {/* Approvals List */}
      <div className="bg-white rounded-lg border-2 shadow-md" style={{ borderColor: '#E8DCC4' }}>
        <div className="p-6 border-b-2" style={{ borderColor: '#E8DCC4' }}>
          <h2 className="text-xl font-bold" style={{ color: '#36454F' }}>
            {selectedFilter === 'ALL' ? 'All Pending Approvals' : `${selectedFilter} Approvals`}
          </h2>
        </div>

        {loading ? (
          <div className="p-12 text-center" style={{ color: '#8B6F47' }}>
            <div className="animate-spin w-8 h-8 border-4 border-gray-200 border-t-current rounded-full mx-auto mb-4"></div>
            Loading approvals...
          </div>
        ) : filteredApprovals.length === 0 ? (
          <div className="p-12 text-center" style={{ color: '#8B6F47' }}>
            <AlertCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No pending approvals</p>
            <p className="text-sm mt-2 opacity-75">All caught up! Check back later for new requests.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead style={{ backgroundColor: '#E8DCC4' }}>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Requested By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#6F4E37' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredApprovals.map((approval) => (
                  <tr key={approval.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded" style={{ backgroundColor: `${getTypeColor(approval.type)}15` }}>
                          {getTypeIcon(approval.type)}
                        </div>
                        <span className="font-medium" style={{ color: getTypeColor(approval.type) }}>
                          {approval.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: '#36454F' }}>
                      {approval.number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: '#6F4E37' }}>
                      {approval.requestedBy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: '#8B6F47' }}>
                      {new Date(approval.requestedDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium" style={{ color: '#6B8E23' }}>
                      {approval.amount ? `₹${approval.amount.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span 
                        className="px-2 py-1 text-xs rounded-full font-medium"
                        style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
                      >
                        {approval.status}
                      </span>
                      {approval.priority === 'HIGH' && (
                        <span className="ml-2 px-2 py-1 text-xs rounded-full font-medium bg-red-100 text-red-800">
                          Urgent
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleApprovalClick(approval)}
                        className="px-4 py-2 rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
                        style={{ backgroundColor: '#6F4E37' }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
