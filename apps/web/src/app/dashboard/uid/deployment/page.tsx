'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../../../lib/api-client';
import DateInput from '../../../../components/ui/DateInput';
import { getTodayDateInputValue } from '@/lib/date';
import { hasModulePermission, readStoredUser } from '@/lib/rbac';

interface Customer {
  id: string;
  customer_name: string;
  customer_code: string;
  contact_email: string;
  contact_person: string;
}

interface CustomerLocation {
  location_name: string;
  count: number;
}

interface UIDDeployment {
  uid_id: string;
  uid: string;
  client_part_number: string | null;
  item_name: string;
  item_code: string;
  current_level: string | null;
  current_organization: string | null;
  current_location: string | null;
  current_deployment_date: string | null;
  deployment_count: number;
  warranty_expiry_date: string | null;
}

interface DeploymentHistory {
  id: string;
  deployment_level: string;
  organization_name: string;
  location_name: string;
  deployment_date: string;
  contact_person: string | null;
  contact_email: string | null;
  deployment_notes: string | null;
  is_current_location: boolean;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

export default function UIDDeploymentPage() {
  const router = useRouter();
  const todayDate = getTodayDateInputValue();
  const canCreateDeployment = hasModulePermission(readStoredUser(), 'Inventory', 'create');
  const [deployments, setDeployments] = useState<UIDDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUID, setSelectedUID] = useState<UIDDeployment | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistory[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [sortField, setSortField] = useState<keyof UIDDeployment>('uid');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // Customer and location autocomplete
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  
  const [customerLocations, setCustomerLocations] = useState<CustomerLocation[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<CustomerLocation[]>([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  
  // Deployment level autocomplete
  const [deploymentLevels] = useState([
    'CUSTOMER',
    'DEPOT',
    'END_LOCATION',
    'SERVICE_CENTER',
    'RETURNED'
  ]);
  const [filteredLevels, setFilteredLevels] = useState<string[]>([]);
  const [showLevelDropdown, setShowLevelDropdown] = useState(false);
  
  const [newDeployment, setNewDeployment] = useState({
    deployment_level: 'CUSTOMER',
    organization_name: '',
    location_name: '',
    deployment_date: getTodayDateInputValue(),
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    deployment_notes: '',
    warranty_expiry_date: '',
    maintenance_schedule: '',
    is_current_location: true,
    commissioning_confirmed: false,
  });

  useEffect(() => {
    fetchDeployments(1, searchTerm, sortField, sortOrder);
    fetchCustomers();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
      fetchDeployments(1, searchInput, sortField, sortOrder);
    }, 300);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);
  
  const fetchCustomers = async () => {
    try {
      const data = await apiClient.get<Customer[]>('/sales/customers');
      setCustomers(data);
      setFilteredCustomers(data);
    } catch (error) {
    }
  };
  
  const fetchCustomerLocations = async (customerName: string) => {
    try {
      // Fetch unique locations for this customer from deployment history
      const response = await apiClient.get<PaginatedResponse<any>>(
        `/uid/deployment/status?organization=${encodeURIComponent(customerName)}&offset=0&limit=200`,
      );
      const allDeployments = response?.data || [];

      const locations = allDeployments
        .filter(d => d.current_organization === customerName)
        .reduce((acc: Map<string, number>, curr) => {
          if (curr.current_location) {
            acc.set(curr.current_location, (acc.get(curr.current_location) || 0) + 1);
          }
          return acc;
        }, new Map<string, number>());
      
      const locationArray: CustomerLocation[] = Array.from(locations.entries()).map(([location_name, count]: [string, number]) => ({
        location_name,
        count
      }));
      
      setCustomerLocations(locationArray);
      setFilteredLocations(locationArray);
    } catch (error) {
      setCustomerLocations([]);
      setFilteredLocations([]);
    }
  };
  
  const handleOrganizationChange = (value: string) => {
    setNewDeployment({ ...newDeployment, organization_name: value });
    setSelectedCustomerId('');
    
    const filtered = customers.filter(customer =>
      customer.customer_name.toLowerCase().includes(value.toLowerCase()) ||
      customer.customer_code.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredCustomers(filtered);
    setShowCustomerDropdown(value.length > 0 && filtered.length > 0);
  };
  
  const selectCustomer = (customer: Customer) => {
    setNewDeployment({
      ...newDeployment,
      organization_name: customer.customer_name,
      contact_email: customer.contact_email || newDeployment.contact_email,
      contact_person: customer.contact_person || newDeployment.contact_person,
    });
    setSelectedCustomerId(customer.id);
    setShowCustomerDropdown(false);
    
    // Fetch locations for this customer
    fetchCustomerLocations(customer.customer_name);
  };
  
  const handleLocationChange = (value: string) => {
    setNewDeployment({ ...newDeployment, location_name: value });
    
    const filtered = customerLocations.filter(loc =>
      loc.location_name.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredLocations(filtered);
    setShowLocationDropdown(value.length > 0);
  };
  
  const selectLocation = (location: CustomerLocation) => {
    setNewDeployment({ ...newDeployment, location_name: location.location_name });
    setShowLocationDropdown(false);
  };
  
  const handleDeploymentLevelChange = (value: string) => {
    setNewDeployment({ ...newDeployment, deployment_level: value.toUpperCase() });
    
    const filtered = deploymentLevels.filter(level =>
      level.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredLevels(filtered);
    setShowLevelDropdown(value.length > 0 && filtered.length > 0);
  };
  
  const selectLevel = (level: string) => {
    setNewDeployment({ ...newDeployment, deployment_level: level });
    setShowLevelDropdown(false);
  };

  const fetchDeployments = useCallback(async (
    page = 1,
    search = '',
    sortBy: keyof UIDDeployment = sortField,
    order: 'asc' | 'desc' = sortOrder,
  ) => {
    try {
      setLoading(true);
      const offset = (page - 1) * itemsPerPage;
      const params = new URLSearchParams();
      params.set('offset', String(offset));
      params.set('limit', String(itemsPerPage));
      params.set('sort_by', String(sortBy));
      params.set('sort_order', order);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiClient.get<PaginatedResponse<UIDDeployment>>(`/uid/deployment/status?${params.toString()}`);
      setDeployments(Array.isArray(res.data) ? res.data : []);
      setTotalCount(Number(res.total || 0));
      setError('');
    } catch (error: any) {
      const message = error?.message || 'Failed to load UID deployments';
      setError(message);
      setDeployments([]);
      setTotalCount(0);
      if (message.toLowerCase().includes('unauthorized') || message.includes('401')) {
        router.replace('/login');
      }
    } finally {
      setLoading(false);
    }
  }, [itemsPerPage, router, sortField, sortOrder]);

  const viewHistory = async (uid: UIDDeployment) => {
    try {
      setSelectedUID(uid);
      const history = await apiClient.get<DeploymentHistory[]>(`/uid/deployment/${uid.uid_id}/history`);
      setDeploymentHistory(history);
      setShowHistoryModal(true);
    } catch (error: any) {
      alert(error?.message || 'Failed to load deployment history');
    }
  };

  const openAddModal = (uid: UIDDeployment) => {
    if (!canCreateDeployment) {
      alert('You do not have permission to add deployment records');
      return;
    }
    setSelectedUID(uid);
    setNewDeployment({
      ...newDeployment,
      organization_name: uid.current_organization || '',
      location_name: '',
      commissioning_confirmed: false,
    });
    setSelectedCustomerId('');
    setShowAddModal(true);
  };

  const addDeployment = async () => {
    if (!selectedUID) return;
    if (!canCreateDeployment) {
      alert('You do not have permission to add deployment records');
      return;
    }
    
    try {
      await apiClient.post('/uid/deployment', {
        uid_id: selectedUID.uid_id,
        customer_id: selectedCustomerId || undefined,
        ...newDeployment,
      });
      
      alert('Deployment added successfully!');
      setShowAddModal(false);
      fetchDeployments();
      
      // Reset form
      setNewDeployment({
        deployment_level: 'CUSTOMER',
        organization_name: '',
        location_name: '',
        deployment_date: getTodayDateInputValue(),
        contact_person: '',
        contact_email: '',
        contact_phone: '',
        deployment_notes: '',
        warranty_expiry_date: '',
        maintenance_schedule: '',
        is_current_location: true,
        commissioning_confirmed: false,
      });
    } catch (error) {
      alert(`Failed to add deployment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getLevelBadgeColor = (level: string | null) => {
    if (!level) return 'bg-gray-200 text-gray-700';
    switch (level.toUpperCase()) {
      case 'CUSTOMER': return 'bg-blue-100 text-blue-800';
      case 'DEPOT': return 'bg-yellow-100 text-yellow-800';
      case 'END_LOCATION': return 'bg-green-100 text-green-800';
      case 'SERVICE_CENTER': return 'bg-orange-100 text-orange-800';
      case 'RETURNED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-200 text-gray-700';
    }
  };

  const handleSort = (field: keyof UIDDeployment) => {
    let nextSortOrder: 'asc' | 'desc' = 'asc';
    if (sortField === field) {
      nextSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      setSortOrder(nextSortOrder);
    } else {
      setSortField(field);
      nextSortOrder = 'asc';
      setSortOrder('asc');
    }

    setCurrentPage(1);
    fetchDeployments(1, searchTerm, field, nextSortOrder);
  };

  const getSortIcon = (field: keyof UIDDeployment) => {
    if (sortField !== field) return '⇅';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));
  const paginatedDeployments = deployments;

  const goToPage = (page: number) => {
    const nextPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(nextPage);
    fetchDeployments(nextPage, searchTerm, sortField, sortOrder);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">🗺️ Product Deployment Tracking</h1>
          <p className="text-gray-600">Track product locations through distribution channels</p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Search and Stats */}
        <div className="grid grid-cols-4 gap-6 mb-8">
          <div className="col-span-2">
            <div className="relative">
              <input
                type="text"
                placeholder="🔍 Search by UID, Part No, Item, Organization, Location, Level..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full px-4 py-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <svg className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">Total Products</div>
            <div className="text-3xl font-bold text-purple-600">{totalCount}</div>
            <div className="text-xs text-gray-500 mt-1">Showing {deployments.length} on this page</div>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <div className="text-sm text-gray-600 mb-1">With Locations</div>
            <div className="text-3xl font-bold text-green-600">
              {deployments.filter(d => d.current_location).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">(current page)</div>
          </div>
        </div>

        {/* Deployments Table */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading deployments...</div>
          ) : totalCount === 0 ? (
            <div className="p-12 text-center">
              <div className="text-6xl mb-4">📦</div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No Deployments Found</h3>
              <p className="text-gray-500">Start tracking products by adding deployment information</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="bg-purple-50">
                  <tr>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('uid')}
                    >
                      UID {getSortIcon('uid')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('client_part_number')}
                    >
                      Part No {getSortIcon('client_part_number')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('item_name')}
                    >
                      Item {getSortIcon('item_name')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('current_level')}
                    >
                      Level {getSortIcon('current_level')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('current_organization')}
                    >
                      Organization {getSortIcon('current_organization')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('current_location')}
                    >
                      Location {getSortIcon('current_location')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-purple-900 uppercase cursor-pointer hover:bg-purple-100"
                      onClick={() => handleSort('current_deployment_date')}
                    >
                      Date {getSortIcon('current_deployment_date')}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-purple-900 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {paginatedDeployments.map((deployment) => (
                  <tr key={deployment.uid_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{deployment.uid}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {deployment.client_part_number || <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{deployment.item_name}</div>
                      <div className="text-sm text-gray-500">{deployment.item_code}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getLevelBadgeColor(deployment.current_level)}`}>
                        {deployment.current_level || 'Not Deployed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {deployment.current_organization || <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {deployment.current_location || <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {deployment.current_deployment_date 
                        ? new Date(deployment.current_deployment_date).toLocaleDateString()
                        : <span className="text-gray-400">-</span>
                      }
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => viewHistory(deployment)}
                        className="text-purple-600 hover:text-purple-800 font-medium mr-3"
                      >
                        History
                      </button>
                      {canCreateDeployment && (
                        <button
                          onClick={() => openAddModal(deployment)}
                          className="text-green-600 hover:text-green-800 font-medium"
                        >
                          + Add
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {totalCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  ««
                </button>
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  «
                </button>
                
                {(() => {
                  const candidates = [
                    1,
                    totalPages,
                    currentPage - 1,
                    currentPage,
                    currentPage + 1,
                  ].filter((p) => p >= 1 && p <= totalPages);

                  const uniqueSorted = Array.from(new Set(candidates)).sort((a, b) => a - b);

                  const parts: Array<number | 'ellipsis'> = [];
                  for (let i = 0; i < uniqueSorted.length; i++) {
                    const p = uniqueSorted[i];
                    const prev = uniqueSorted[i - 1];
                    if (i > 0 && prev !== undefined && p - prev > 1) {
                      parts.push('ellipsis');
                    }
                    parts.push(p);
                  }

                  return parts.map((part, idx) => {
                    if (part === 'ellipsis') {
                      return (
                        <span key={`ellipsis-${idx}`} className="px-2">
                          ...
                        </span>
                      );
                    }

                    const page = part;
                    return (
                      <button
                        key={page}
                        onClick={() => goToPage(page)}
                        className={`px-3 py-1 rounded text-sm ${
                          currentPage === page
                            ? 'bg-purple-600 text-white font-semibold'
                            : 'border border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  });
                })()}
                
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  »
                </button>
                <button
                  onClick={() => goToPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  »»
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && selectedUID && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Deployment History</h2>
                <p className="text-sm text-gray-500">{selectedUID.uid} • {selectedUID.client_part_number || 'No Part No'}</p>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              {deploymentHistory.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No deployment history</p>
              ) : (
                <div className="space-y-4">
                  {deploymentHistory.map((history) => (
                    <div key={history.id} className="relative pl-8 pb-6 border-l-2 border-purple-300 last:border-l-0">
                      <div className={`absolute left-0 top-0 transform -translate-x-1/2 ${
                        history.is_current_location ? 'w-4 h-4 bg-green-500' : 'w-3 h-3 bg-purple-300'
                      } rounded-full`}></div>
                      
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getLevelBadgeColor(history.deployment_level)}`}>
                              {history.deployment_level}
                            </span>
                            {history.is_current_location && (
                              <span className="ml-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                                CURRENT
                              </span>
                            )}
                          </div>
                          <span className="text-sm text-gray-500">
                            {new Date(history.deployment_date).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <div className="text-lg font-bold text-gray-900 mb-1">
                          {history.organization_name}
                        </div>
                        <div className="text-md text-gray-700 mb-2">
                          📍 {history.location_name}
                        </div>
                        
                        {history.contact_person && (
                          <div className="text-sm text-gray-600">
                            👤 {history.contact_person}
                            {history.contact_email && ` • ${history.contact_email}`}
                          </div>
                        )}
                        
                        {history.deployment_notes && (
                          <div className="mt-2 text-sm text-gray-600 italic">
                            &quot;{history.deployment_notes}&quot;
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Deployment Modal */}
      {showAddModal && selectedUID && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Add New Deployment</h2>
                <p className="text-sm text-gray-500">{selectedUID.uid} • {selectedUID.client_part_number || 'No Part No'}</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Organization Name - First with Autocomplete */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name *</label>
                <input
                  type="text"
                  value={newDeployment.organization_name}
                  onChange={(e) => handleOrganizationChange(e.target.value)}
                  onFocus={() => setShowCustomerDropdown(newDeployment.organization_name.length > 0 && filteredCustomers.length > 0)}
                  onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                  placeholder="Start typing customer name..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
                
                {/* Customer Autocomplete Dropdown */}
                {showCustomerDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredCustomers.map((customer) => (
                      <div
                        key={customer.id}
                        onClick={() => selectCustomer(customer)}
                        className="px-4 py-3 cursor-pointer hover:bg-purple-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">{customer.customer_name}</div>
                        <div className="text-sm text-gray-500">
                          Code: {customer.customer_code} {customer.contact_email && `• ${customer.contact_email}`}
                        </div>
                      </div>
                    ))}
                    {filteredCustomers.length === 0 && newDeployment.organization_name && (
                      <div className="px-4 py-3 text-sm text-gray-500 italic">
                        New customer will be created: &quot;{newDeployment.organization_name}&quot;
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Location Name - Second with Autocomplete */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Location Name *</label>
                <input
                  type="text"
                  value={newDeployment.location_name}
                  onChange={(e) => handleLocationChange(e.target.value)}
                  onFocus={() => setShowLocationDropdown(newDeployment.location_name.length > 0)}
                  onBlur={() => setTimeout(() => setShowLocationDropdown(false), 200)}
                  placeholder={newDeployment.organization_name ? "Start typing location..." : "Select customer first"}
                  disabled={!newDeployment.organization_name}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100"
                />
                
                {/* Location Autocomplete Dropdown */}
                {showLocationDropdown && customerLocations.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredLocations.map((location, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectLocation(location)}
                        className="px-4 py-3 cursor-pointer hover:bg-purple-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">{location.location_name}</div>
                        <div className="text-sm text-gray-500">Used {location.count} time(s)</div>
                      </div>
                    ))}
                  </div>
                )}
                {showLocationDropdown && customerLocations.length === 0 && newDeployment.location_name && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
                    <div className="px-4 py-3 text-sm text-gray-500 italic">
                      New location will be created: &quot;{newDeployment.location_name}&quot;
                    </div>
                  </div>
                )}
              </div>

              {/* Deployment Level */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Deployment Level *</label>
                <input
                  type="text"
                  value={newDeployment.deployment_level}
                  onChange={(e) => handleDeploymentLevelChange(e.target.value)}
                  onFocus={() => {
                    const filtered = deploymentLevels.filter(level =>
                      level.toLowerCase().includes(newDeployment.deployment_level.toLowerCase())
                    );
                    setFilteredLevels(filtered);
                    setShowLevelDropdown(filtered.length > 0);
                  }}
                  onBlur={() => setTimeout(() => setShowLevelDropdown(false), 200)}
                  placeholder="Type or select level..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
                
                {/* Level Autocomplete Dropdown */}
                {showLevelDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredLevels.map((level, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectLevel(level)}
                        className="px-4 py-3 cursor-pointer hover:bg-purple-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">{level}</div>
                      </div>
                    ))}
                  </div>
                )}
                {!showLevelDropdown && newDeployment.deployment_level && !deploymentLevels.includes(newDeployment.deployment_level) && (
                  <div className="mt-1 text-sm text-purple-600 italic">
                    ✨ New custom level: &quot;{newDeployment.deployment_level}&quot;
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                  <input
                    type="text"
                    value={newDeployment.contact_person}
                    onChange={(e) => setNewDeployment({ ...newDeployment, contact_person: e.target.value })}
                    placeholder="Name"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                  <input
                    type="email"
                    value={newDeployment.contact_email}
                    onChange={(e) => setNewDeployment({ ...newDeployment, contact_email: e.target.value })}
                    placeholder="email@example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={newDeployment.contact_phone}
                  onChange={(e) => setNewDeployment({ ...newDeployment, contact_phone: e.target.value })}
                  placeholder="+91 XXXXXXXXXX"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deployment Notes</label>
                <textarea
                  value={newDeployment.deployment_notes}
                  onChange={(e) => setNewDeployment({ ...newDeployment, deployment_notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Deployment Date</label>
                  <DateInput
                    max={todayDate}
                    value={newDeployment.deployment_date}
                    onChange={(value) => setNewDeployment({ ...newDeployment, deployment_date: value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Warranty Expiry</label>
                  <DateInput
                    max={todayDate}
                    value={newDeployment.warranty_expiry_date}
                    onChange={(value) => setNewDeployment({ ...newDeployment, warranty_expiry_date: value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={newDeployment.is_current_location}
                    onChange={(e) => setNewDeployment({ ...newDeployment, is_current_location: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Set as current location</span>
                </label>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={newDeployment.commissioning_confirmed}
                    onChange={(e) => setNewDeployment({ ...newDeployment, commissioning_confirmed: e.target.checked, is_current_location: e.target.checked ? true : newDeployment.is_current_location })}
                    disabled={!selectedCustomerId}
                    className="mt-1"
                  />
                  <span className="text-sm text-emerald-900">
                    <span className="block font-semibold">Installation / commissioning confirmed</span>
                    Select the customer above, then confirm only after equipment is installed. This creates the active Installed Asset, carries the UID, location and warranty expiry, and prevents duplicates.
                  </span>
                </label>
                {!selectedCustomerId && <div className="mt-2 text-xs text-amber-700">Select a customer from the list to enable commissioning.</div>}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={addDeployment}
                  disabled={!canCreateDeployment}
                  className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  Add Deployment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
