'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DateInput from '../../components/ui/DateInput';
import { getTodayDateInputValue } from '@/lib/date';

interface Customer {
  id: string;
  customer_name: string;
  customer_code: string;
  contact_email: string;
  contact_person: string;
}

interface ProductInfo {
  uid: string;
  client_part_number: string;
  job_order_id: string;
  current_level: string;
  current_organization: string;
  current_location: string;
  current_deployment_date: string;
  original_customer: string;
  warranty_expiry_date: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
}

interface DeploymentHistory {
  deployment_level: string;
  organization_name: string;
  location_name: string;
  deployment_date: string;
  deployment_notes: string;
}

export default function WarrantyPortalPage() {
  const router = useRouter();
  const todayDate = getTodayDateInputValue();
  const [activeTab, setActiveTab] = useState<'search' | 'register'>('search');
  const [searchType, setSearchType] = useState<'part_number' | 'access_token'>('part_number');
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistory[]>([]);
  const [showUpdateForm, setShowUpdateForm] = useState(false);
  
  // Customer list for autocomplete
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  
  // Update form state
  const [updateForm, setUpdateForm] = useState({
    deployment_level: 'END_LOCATION',
    organization_name: '',
    location_name: '',
    deployment_notes: '',
  });
  
  // Registration form state
  const [registrationForm, setRegistrationForm] = useState({
    uid: '',
    part_number: '',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_address: '',
    purchase_date: '',
    dealer_name: '',
    invoice_number: '',
    warranty_years: '1',
    vessel: '',
    location: '',
  });

  const [customerNameLocked, setCustomerNameLocked] = useState(false);
  
  // Fetch customers on mount
  useEffect(() => {
    fetchCustomers();
  }, []);
  
  const fetchCustomers = async () => {
    try {
      const response = await fetch('/api/v1/sales/customers', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setCustomers(data);
        setFilteredCustomers(data);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  };

  // Auto-fill customer details from system when UID is entered
  useEffect(() => {
    const uid = registrationForm.uid.trim().toUpperCase();
    if (!uid || uid.length < 4) {
      setCustomerNameLocked(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const apiUrl =
            process.env.NEXT_PUBLIC_API_URL ||
            (typeof window !== 'undefined'
              ? `http://${window.location.hostname}:4000/api/v1`
              : 'http://localhost:4000/api/v1');

          const response = await fetch(
            `${apiUrl}/uid/deployment/status?uid=${encodeURIComponent(uid)}`,
            { signal: controller.signal },
          );
          if (!response.ok) return;
          const data = await response.json();
          const info = Array.isArray(data) ? data[0] : null;
          if (!info) return;

          const nextCustomerName = String(info.original_customer || info.current_organization || '').trim();
          const nextCustomerEmail = String(info.contact_email || '').trim();
          const nextCustomerPhone = String(info.contact_phone || '').trim();

          setCustomerNameLocked(Boolean(nextCustomerName));

          setRegistrationForm((prev) => ({
            ...prev,
            uid,
            customer_name: nextCustomerName || prev.customer_name,
            customer_email: nextCustomerEmail || prev.customer_email,
            customer_phone: nextCustomerPhone || prev.customer_phone,
          }));
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          console.error('Failed to lookup UID customer details:', err);
          setCustomerNameLocked(false);
        }
      })();
    }, 450);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [registrationForm.uid]);
  
  const handleCustomerNameChange = (value: string) => {
    setRegistrationForm({ ...registrationForm, customer_name: value });
    
    // Filter customers based on input
    const filtered = customers.filter(customer =>
      customer.customer_name.toLowerCase().includes(value.toLowerCase()) ||
      customer.customer_code.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredCustomers(filtered);
    setShowCustomerDropdown(value.length > 0 && filtered.length > 0);
  };
  
  const selectCustomer = (customer: Customer) => {
    setRegistrationForm({
      ...registrationForm,
      customer_name: customer.customer_name,
      customer_email: customer.contact_email || registrationForm.customer_email,
    });
    setShowCustomerDropdown(false);
  };
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(false);

  const handleSearch = async () => {
    if (!searchValue.trim()) {
      setError('Please enter a value to search');
      return;
    }

    setLoading(true);
    setError(null);
    setProductInfo(null);
    setDeploymentHistory([]);

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ||
        (typeof window !== 'undefined'
          ? `http://${window.location.hostname}:4000/api/v1`
          : 'http://localhost:4000/api/v1');
      
      // Search by part number or access token
      const endpoint = searchType === 'part_number' 
        ? `/uid/search/part-number?part_number=${encodeURIComponent(searchValue)}`
        : `/uid/deployment/public/${searchValue}`;
      
      const response = await fetch(`${apiUrl}${endpoint}`);
      
      if (!response.ok) {
        throw new Error('Product not found');
      }
      
      const data = await response.json();
      
      if (searchType === 'part_number') {
        // Get deployment status for the UID
        const statusResponse = await fetch(`${apiUrl}/uid/deployment/status?uid=${data.uid}`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setProductInfo(statusData[0] || null);
          
          // Get deployment history
          const historyResponse = await fetch(`${apiUrl}/uid/deployment/history/${statusData[0]?.uid_id}`);
          if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            setDeploymentHistory(historyData);
          }
        }
      } else {
        // Access token search returns deployment info directly
        setProductInfo(data.product);
        setDeploymentHistory(data.history || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch product information');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateDeployment = async () => {
    if (!productInfo) return;
    
    if (!updateForm.organization_name || !updateForm.location_name) {
      alert('Please fill in organization and location');
      return;
    }

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ||
        (typeof window !== 'undefined'
          ? `http://${window.location.hostname}:4000/api/v1`
          : 'http://localhost:4000/api/v1');
      const response = await fetch(`${apiUrl}/uid/deployment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: productInfo.uid,
          ...updateForm,
        }),
      });

      if (!response.ok) throw new Error('Failed to update deployment');

      alert('Deployment location updated successfully!');
      setShowUpdateForm(false);
      // Refresh data
      handleSearch();
    } catch (err: any) {
      alert(err.message || 'Failed to update deployment');
    }
  };

  const getLevelBadgeColor = (level: string) => {
    switch (level) {
      case 'CUSTOMER': return 'bg-amber-100 text-amber-800';
      case 'DEPOT': return 'bg-yellow-100 text-yellow-800';
      case 'END_LOCATION': return 'bg-green-100 text-green-800';
      case 'SERVICE_CENTER': return 'bg-orange-100 text-orange-800';
      case 'RETURNED': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  
  const handleWarrantyRegistration = async () => {
    if (!registrationForm.uid || !registrationForm.customer_name || !registrationForm.customer_email || !registrationForm.purchase_date) {
      alert('Please fill in all required fields (UID, Name, Email, Purchase Date)');
      return;
    }
    
    setRegistrationLoading(true);
    
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL ||
        (typeof window !== 'undefined'
          ? `http://${window.location.hostname}:4000/api/v1`
          : 'http://localhost:4000/api/v1');
      
      // Calculate warranty expiry
      const purchaseDate = new Date(registrationForm.purchase_date);
      const warrantyExpiry = new Date(purchaseDate);
      warrantyExpiry.setFullYear(warrantyExpiry.getFullYear() + parseInt(registrationForm.warranty_years));

      const deploymentLocation = (() => {
        const vessel = registrationForm.vessel.trim();
        const location = registrationForm.location.trim();
        if (vessel && location) return `${vessel} / ${location}`;
        if (vessel) return vessel;
        if (location) return location;
        return registrationForm.customer_address || 'Customer Location';
      })();
      
      // Create initial deployment record
      const response = await fetch(`${apiUrl}/uid/deployment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: registrationForm.uid,
          deployment_level: 'CUSTOMER',
          organization_name: registrationForm.customer_name,
          location_name: deploymentLocation,
          deployment_date: registrationForm.purchase_date,
          contact_person: registrationForm.customer_name,
          contact_email: registrationForm.customer_email,
          contact_phone: registrationForm.customer_phone,
          deployment_notes: `Warranty Registration - Invoice: ${registrationForm.invoice_number || 'N/A'}, Dealer: ${registrationForm.dealer_name || 'N/A'}`,
          warranty_expiry_date: warrantyExpiry.toISOString().split('T')[0],
          is_current_location: true,
        }),
      });
      
      if (!response.ok) throw new Error('Failed to register warranty');
      
      setRegistrationSuccess(true);
      alert('Warranty registered successfully! You will receive a confirmation email shortly.');
      
      // Reset form
      setRegistrationForm({
        uid: '',
        part_number: '',
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        customer_address: '',
        purchase_date: '',
        dealer_name: '',
        invoice_number: '',
        warranty_years: '1',
        vessel: '',
        location: '',
      });
    } catch (err: any) {
      alert(err.message || 'Failed to register warranty');
    } finally {
      setRegistrationLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(to bottom right, #FAF8F3, #E8DCC4)' }}>
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">🛡️ Warranty Portal</h1>
              <p className="mt-1 text-sm text-gray-600">Track your product warranty and deployment information</p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('search')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'search'
                ? 'text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            style={activeTab === 'search' ? { backgroundColor: '#6F4E37' } : {}}
          >
            🔍 Search Warranty
          </button>
          <button
            onClick={() => setActiveTab('register')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'register'
                ? 'text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            style={activeTab === 'register' ? { backgroundColor: '#6F4E37' } : {}}
          >
            📝 Register Product
          </button>
        </div>
        
        {/* Search Tab Content */}
        {activeTab === 'search' && (
          <>
        {/* Search Card */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Find Your Product</h2>
          
          {/* Search Type Toggle */}
          <div className="flex gap-4 mb-4">
            <button
              onClick={() => setSearchType('part_number')}
              className={`px-4 py-2 rounded-lg font-medium ${
                searchType === 'part_number'
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              style={searchType === 'part_number' ? { backgroundColor: '#6F4E37' } : {}}
            >
              Search by Part Number
            </button>
            <button
              onClick={() => setSearchType('access_token')}
              className={`px-4 py-2 rounded-lg font-medium ${
                searchType === 'access_token'
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              style={searchType === 'access_token' ? { backgroundColor: '#6F4E37' } : {}}
            >
              Search by Warranty Token
            </button>
          </div>

          {/* Search Input */}
          <div className="flex gap-3">
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={
                searchType === 'part_number'
                  ? 'Enter part number (e.g., 53022)'
                  : 'Enter warranty token (e.g., WRT-XXXXX)'
              }
              className="flex-1 px-4 py-3 border-2 rounded-lg focus:ring-2 focus:outline-none"
              style={{ borderColor: '#E8DCC4' }}
              onFocus={(e) => { e.target.style.borderColor = '#8B6F47'; e.target.style.boxShadow = '0 0 0 3px rgba(139, 111, 71, 0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#E8DCC4'; e.target.style.boxShadow = 'none'; }}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-3 text-white rounded-lg disabled:bg-gray-400 font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: loading ? '#9CA3AF' : '#6F4E37' }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Product Information */}
        {productInfo && (
          <>
            {/* Current Status Card */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Current Status</h2>
                <button
                  onClick={() => setShowUpdateForm(!showUpdateForm)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  {showUpdateForm ? 'Cancel Update' : 'Update Location'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Product Details</h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-gray-500">UID:</span>
                      <p className="font-semibold text-gray-900">{productInfo.uid}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Part Number:</span>
                      <p className="font-semibold text-gray-900">{productInfo.client_part_number}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Job Order:</span>
                      <p className="font-semibold text-gray-900">{productInfo.job_order_id || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Current Location</h3>
                  <div className="space-y-2">
                    <div>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${getLevelBadgeColor(productInfo.current_level)}`}>
                        {productInfo.current_level?.replace('_', ' ')}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Organization:</span>
                      <p className="font-semibold text-gray-900">{productInfo.current_organization}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Location:</span>
                      <p className="font-semibold text-gray-900">{productInfo.current_location}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Since:</span>
                      <p className="font-semibold text-gray-900">
                        {productInfo.current_deployment_date ? new Date(productInfo.current_deployment_date).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warranty Info */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 mb-3">Warranty & Contact</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-gray-500">Warranty Expiry:</span>
                    <p className="font-semibold text-gray-900">
                      {productInfo.warranty_expiry_date 
                        ? new Date(productInfo.warranty_expiry_date).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Contact Person:</span>
                    <p className="font-semibold text-gray-900">{productInfo.contact_person || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Contact Details:</span>
                    <p className="text-sm text-gray-900">{productInfo.contact_email || productInfo.contact_phone || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Update Form */}
            {showUpdateForm && (
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Update Deployment Location</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Deployment Level</label>
                    <select
                      value={updateForm.deployment_level}
                      onChange={(e) => setUpdateForm({ ...updateForm, deployment_level: e.target.value })}
                      className="w-full px-3 py-2 border-2 rounded-lg focus:outline-none"
                      style={{ borderColor: '#E8DCC4' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    >
                      <option value="CUSTOMER">Customer</option>
                      <option value="DEPOT">Depot</option>
                      <option value="END_LOCATION">End Location</option>
                      <option value="SERVICE_CENTER">Service Center</option>
                      <option value="RETURNED">Returned</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Organization Name *</label>
                    <input
                      type="text"
                      value={updateForm.organization_name}
                      onChange={(e) => setUpdateForm({ ...updateForm, organization_name: e.target.value })}
                      placeholder="e.g., Indian Navy"
                      className="w-full px-3 py-2 border-2 rounded-lg focus:outline-none"
                      style={{ borderColor: '#E8DCC4' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Location Name *</label>
                    <input
                      type="text"
                      value={updateForm.location_name}
                      onChange={(e) => setUpdateForm({ ...updateForm, location_name: e.target.value })}
                      placeholder="e.g., INS Vikrant"
                      className="w-full px-3 py-2 border-2 rounded-lg focus:outline-none"
                      style={{ borderColor: '#E8DCC4' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
                    <input
                      type="text"
                      value={updateForm.deployment_notes}
                      onChange={(e) => setUpdateForm({ ...updateForm, deployment_notes: e.target.value })}
                      placeholder="Additional notes"
                      className="w-full px-3 py-2 border-2 rounded-lg focus:outline-none"
                      style={{ borderColor: '#E8DCC4' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <button
                    onClick={handleUpdateDeployment}
                    className="px-6 py-2 text-white rounded-lg font-medium transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#6F4E37' }}
                  >
                    Submit Update
                  </button>
                </div>
              </div>
            )}

            {/* Deployment History */}
            {deploymentHistory.length > 0 && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Deployment History</h2>
                <div className="space-y-4">
                  {deploymentHistory.map((deployment, index) => (
                    <div key={index} className="border-l-4 pl-4 py-2" style={{ borderColor: '#8B6F47' }}>
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getLevelBadgeColor(deployment.deployment_level)}`}>
                          {deployment.deployment_level.replace('_', ' ')}
                        </span>
                        <span className="text-sm text-gray-500">
                          {new Date(deployment.deployment_date).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="font-semibold text-gray-900">{deployment.organization_name}</p>
                      <p className="text-sm text-gray-600">{deployment.location_name}</p>
                      {deployment.deployment_notes && (
                        <p className="text-sm text-gray-500 mt-1">{deployment.deployment_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Info Card */}
        {!productInfo && (
          <div className="rounded-xl p-6 border-2" style={{ backgroundColor: '#FAF8F3', borderColor: '#E8DCC4' }}>
            <h3 className="font-semibold mb-2" style={{ color: '#6F4E37' }}>How to use this portal:</h3>
            <ul className="space-y-2 text-sm" style={{ color: '#8B6F47' }}>
              <li>• <strong>Part Number Search:</strong> Enter the part number found on your product label</li>
              <li>• <strong>Warranty Token:</strong> Use the WRT-XXXXX code provided during purchase or deployment</li>
              <li>• <strong>Update Location:</strong> Click &quot;Update Location&quot; to report where your product is currently deployed</li>
              <li>• <strong>View History:</strong> See the complete deployment chain of your product</li>
            </ul>
          </div>
        )}
      </>
      )}

      {/* Registration Tab */}
      {activeTab === 'register' && (
        <>
          {/* Success Message */}
          {registrationSuccess && (
            <div className="rounded-xl p-6 border-2 mb-6" style={{ backgroundColor: '#E8F5E9', borderColor: '#4CAF50' }}>
              <div className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#4CAF50' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="font-semibold text-lg mb-1" style={{ color: '#2E7D32' }}>Warranty Registration Successful!</h3>
                  <p className="text-sm" style={{ color: '#558B2F' }}>
                    Your product has been registered for warranty. You will receive a confirmation email shortly.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Registration Form */}
          <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: '#E8DCC4' }}>
            <div className="px-6 py-4" style={{ backgroundColor: '#6F4E37' }}>
              <h2 className="text-xl font-bold text-white">Register Product for Warranty</h2>
              <p className="text-sm mt-1 text-white/90">Fill in the details below to activate your product warranty</p>
            </div>
            
            <div className="p-6" style={{ backgroundColor: '#FAF8F3' }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Product Details */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg mb-4" style={{ color: '#6F4E37' }}>Product Details</h3>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Product UID / Serial Number *
                    </label>
                    <input
                      type="text"
                      value={registrationForm.uid}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, uid: e.target.value.toUpperCase() })}
                      placeholder="e.g., DIO-SMD-PNJM7"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Part Number (Optional)
                    </label>
                    <input
                      type="text"
                      value={registrationForm.part_number}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, part_number: e.target.value })}
                      placeholder="e.g., DIO-SMD-001"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Purchase Date *
                    </label>
                    <DateInput
                      max={todayDate}
                      value={registrationForm.purchase_date}
                      onChange={(value) => setRegistrationForm({ ...registrationForm, purchase_date: value })}
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Warranty Period (Years)
                    </label>
                    <select
                      value={registrationForm.warranty_years}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, warranty_years: e.target.value })}
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    >
                      <option value="1">1 Year</option>
                      <option value="2">2 Years</option>
                      <option value="3">3 Years</option>
                      <option value="5">5 Years</option>
                      <option value="10">10 Years</option>
                    </select>
                  </div>
                </div>

                {/* Customer Details */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg mb-4" style={{ color: '#6F4E37' }}>Customer Details</h3>
                  
                  <div className="relative">
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Customer / Organization Name *
                    </label>
                    <input
                      type="text"
                      value={registrationForm.customer_name}
                      readOnly={customerNameLocked}
                      onChange={(e) => {
                        if (customerNameLocked) return;
                        handleCustomerNameChange(e.target.value);
                      }}
                      onFocus={() => {
                        if (customerNameLocked) return;
                        setShowCustomerDropdown(
                          registrationForm.customer_name.length > 0 && filteredCustomers.length > 0,
                        );
                      }}
                      onBlur={() => {
                        if (customerNameLocked) return;
                        setTimeout(() => setShowCustomerDropdown(false), 200);
                      }}
                      placeholder="Start typing customer name..."
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocusCapture={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlurCapture={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                    
                    {/* Autocomplete Dropdown */}
                    {showCustomerDropdown && (
                      <div 
                        className="absolute z-10 w-full mt-1 bg-white border-2 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                        style={{ borderColor: '#E8DCC4' }}
                      >
                        {filteredCustomers.map((customer) => (
                          <div
                            key={customer.id}
                            onClick={() => selectCustomer(customer)}
                            className="px-4 py-3 cursor-pointer border-b transition-colors"
                            style={{ borderColor: '#F5F5F5' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#FAF8F3'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
                          >
                            <div className="font-medium" style={{ color: '#6F4E37' }}>
                              {customer.customer_name}
                            </div>
                            <div className="text-sm" style={{ color: '#8B6F47' }}>
                              Code: {customer.customer_code} {customer.contact_email && `• ${customer.contact_email}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Vessel (Optional)
                    </label>
                    <input
                      type="text"
                      value={registrationForm.vessel}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, vessel: e.target.value })}
                      placeholder="Vessel name"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Location (Optional)
                    </label>
                    <input
                      type="text"
                      value={registrationForm.location}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, location: e.target.value })}
                      placeholder="Location"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Email Address *
                    </label>
                    <input
                      type="email"
                      value={registrationForm.customer_email}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, customer_email: e.target.value })}
                      placeholder="customer@example.com"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      value={registrationForm.customer_phone}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, customer_phone: e.target.value })}
                      placeholder="+91 XXXXX XXXXX"
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                      Address (Optional)
                    </label>
                    <textarea
                      value={registrationForm.customer_address}
                      onChange={(e) => setRegistrationForm({ ...registrationForm, customer_address: e.target.value })}
                      placeholder="Full Address"
                      rows={3}
                      className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                      style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                    />
                  </div>
                </div>

                {/* Purchase Details */}
                <div className="space-y-4 md:col-span-2">
                  <h3 className="font-semibold text-lg mb-4" style={{ color: '#6F4E37' }}>Purchase Details (Optional)</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                        Dealer / Seller Name
                      </label>
                      <input
                        type="text"
                        value={registrationForm.dealer_name}
                        onChange={(e) => setRegistrationForm({ ...registrationForm, dealer_name: e.target.value })}
                        placeholder="Dealer Name"
                        className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                        style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: '#6F4E37' }}>
                        Invoice / Order Number
                      </label>
                      <input
                        type="text"
                        value={registrationForm.invoice_number}
                        onChange={(e) => setRegistrationForm({ ...registrationForm, invoice_number: e.target.value })}
                        placeholder="INV-XXXXX"
                        className="w-full px-4 py-2 border-2 rounded-lg focus:outline-none transition-colors"
                        style={{ borderColor: '#E8DCC4', backgroundColor: '#FFFFFF' }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = '#8B6F47'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = '#E8DCC4'; }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="mt-8 flex justify-end gap-4">
                <button
                  onClick={() => {
                    setRegistrationForm({
                      uid: '', part_number: '', customer_name: '', customer_email: '',
                      customer_phone: '', customer_address: '', purchase_date: '',
                      dealer_name: '', invoice_number: '', warranty_years: '1',
                      vessel: '', location: ''
                    });
                    setRegistrationSuccess(false);
                  }}
                  className="px-6 py-2 border-2 rounded-lg font-medium transition-colors"
                  style={{ borderColor: '#E8DCC4', color: '#6F4E37' }}
                >
                  Clear Form
                </button>
                <button
                  onClick={handleWarrantyRegistration}
                  disabled={registrationLoading}
                  className="px-8 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#6F4E37' }}
                  onMouseEnter={(e) => { if (!registrationLoading) e.currentTarget.style.backgroundColor = '#8B6F47'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#6F4E37'; }}
                >
                  {registrationLoading ? 'Registering...' : 'Register Warranty'}
                </button>
              </div>

              {/* Info Note */}
              <div className="mt-6 p-4 rounded-lg border-2" style={{ backgroundColor: '#FFF9E6', borderColor: '#FFE082' }}>
                <p className="text-sm" style={{ color: '#6F4E37' }}>
                  <strong>Note:</strong> Fields marked with * are required. After registration, you will receive a confirmation email with your warranty details and token.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
