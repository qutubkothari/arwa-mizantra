'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api-client';

interface NomenclatureSecondary {
  id: string;
  label: string;
  acronym: string;
  hint: string | null;
  sort_order: number;
  is_active: boolean;
}

interface NomenclaturePrimary {
  id: string;
  label: string;
  acronym: string;
  hint: string | null;
  sort_order: number;
  is_active: boolean;
  secondaries: NomenclatureSecondary[];
}

interface NomenclatureManagerProps {
  onClose: () => void;
}

export default function NomenclatureManager({ onClose }: NomenclatureManagerProps) {
  const [primaries, setPrimaries] = useState<NomenclaturePrimary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form states
  const [showPrimaryForm, setShowPrimaryForm] = useState(false);
  const [showSecondaryForm, setShowSecondaryForm] = useState(false);
  const [selectedPrimary, setSelectedPrimary] = useState<NomenclaturePrimary | null>(null);
  const [editingPrimary, setEditingPrimary] = useState<NomenclaturePrimary | null>(null);
  const [editingSecondary, setEditingSecondary] = useState<NomenclatureSecondary | null>(null);
  
  // Form data
  const [formData, setFormData] = useState({
    label: '',
    acronym: '',
    hint: '',
    sort_order: 0,
  });

  useEffect(() => {
    fetchNomenclature();
  }, []);

  const fetchNomenclature = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<NomenclaturePrimary[]>('/nomenclature');
      setPrimaries(data);
      setError(null);
    } catch (err) {
      setError('Failed to load nomenclature data');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ label: '', acronym: '', hint: '', sort_order: 0 });
    setEditingPrimary(null);
    setEditingSecondary(null);
    setShowPrimaryForm(false);
    setShowSecondaryForm(false);
  };

  const handleCreatePrimary = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/nomenclature', formData);
      resetForm();
      fetchNomenclature();
    } catch (err) {
      alert('Failed to create primary category');
    }
  };

  const handleUpdatePrimary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrimary) return;
    try {
      await apiClient.put(`/nomenclature/${editingPrimary.id}`, formData);
      resetForm();
      fetchNomenclature();
    } catch (err) {
      alert('Failed to update primary category');
    }
  };

  const handleDeletePrimary = async (id: string) => {
    if (!confirm('Are you sure? This will delete all secondary categories too.')) return;
    try {
      await apiClient.delete(`/nomenclature/${id}`);
      fetchNomenclature();
    } catch (err) {
      alert('Failed to delete primary category');
    }
  };

  const handleCreateSecondary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPrimary) return;
    try {
      await apiClient.post('/nomenclature/secondary', {
        ...formData,
        primary_id: selectedPrimary.id,
      });
      resetForm();
      setSelectedPrimary(null);
      fetchNomenclature();
    } catch (err) {
      alert('Failed to create secondary category');
    }
  };

  const handleUpdateSecondary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSecondary) return;
    try {
      await apiClient.put(`/nomenclature/secondary/${editingSecondary.id}`, formData);
      resetForm();
      fetchNomenclature();
    } catch (err) {
      alert('Failed to update secondary category');
    }
  };

  const handleDeleteSecondary = async (id: string) => {
    if (!confirm('Are you sure?')) return;
    try {
      await apiClient.delete(`/nomenclature/secondary/${id}`);
      fetchNomenclature();
    } catch (err) {
      alert('Failed to delete secondary category');
    }
  };

  const startEditPrimary = (primary: NomenclaturePrimary) => {
    setEditingPrimary(primary);
    setFormData({
      label: primary.label,
      acronym: primary.acronym,
      hint: primary.hint || '',
      sort_order: primary.sort_order,
    });
    setShowPrimaryForm(true);
  };

  const startEditSecondary = (secondary: NomenclatureSecondary, primary: NomenclaturePrimary) => {
    setEditingSecondary(secondary);
    setSelectedPrimary(primary);
    setFormData({
      label: secondary.label,
      acronym: secondary.acronym,
      hint: secondary.hint || '',
      sort_order: secondary.sort_order,
    });
    setShowSecondaryForm(true);
  };

  const startAddSecondary = (primary: NomenclaturePrimary) => {
    setSelectedPrimary(primary);
    setFormData({ label: '', acronym: '', hint: '', sort_order: 0 });
    setShowSecondaryForm(true);
  };

  const handleSeedDefaults = async () => {
    if (!confirm('This will add all default nomenclature categories. Continue?')) return;
    try {
      await apiClient.post('/nomenclature/seed');
      fetchNomenclature();
    } catch (err) {
      alert('Failed to seed default data');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Manage SAS Part Number Categories</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => {
              resetForm();
              setShowPrimaryForm(true);
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + Add Primary Category
          </button>
          <button
            onClick={handleSeedDefaults}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            🔄 Restore Defaults
          </button>
        </div>

        {/* Primary Form */}
        {showPrimaryForm && (
          <form onSubmit={editingPrimary ? handleUpdatePrimary : handleCreatePrimary} className="mb-6 p-4 bg-amber-50 rounded-lg">
            <h3 className="font-semibold mb-3">
              {editingPrimary ? 'Edit Primary Category' : 'Add Primary Category'}
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Capacitor"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Acronym *</label>
                <input
                  type="text"
                  value={formData.acronym}
                  onChange={(e) => setFormData({ ...formData, acronym: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., CAP"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hint (User Defined Strings Guide)</label>
                <input
                  type="text"
                  value={formData.hint}
                  onChange={(e) => setFormData({ ...formData, hint: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Package, Wattage, Tolerance, Value"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {editingPrimary ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Secondary Form */}
        {showSecondaryForm && selectedPrimary && (
          <form onSubmit={editingSecondary ? handleUpdateSecondary : handleCreateSecondary} className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold mb-3">
              {editingSecondary ? 'Edit Secondary Category' : `Add Secondary to "${selectedPrimary.label}"`}
            </h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Surface Mounted Device"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Acronym *</label>
                <input
                  type="text"
                  value={formData.acronym}
                  onChange={(e) => setFormData({ ...formData, acronym: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., SMD"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hint</label>
                <input
                  type="text"
                  value={formData.hint}
                  onChange={(e) => setFormData({ ...formData, hint: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., Package, Wattage, Tolerance, Value"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {editingSecondary ? 'Update' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setSelectedPrimary(null);
                }}
                className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="space-y-4">
            {primaries.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No categories found. Click &quot;Restore Defaults&quot; to load the default SAS Part Number configuration.
              </div>
            ) : (
              primaries.map((primary) => (
                <div key={primary.id} className="border rounded-lg overflow-hidden">
                  {/* Primary Header */}
                  <div className="bg-gray-100 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-lg">{primary.label}</span>
                      <span className="px-2 py-1 bg-amber-100 text-amber-800 text-sm rounded">
                        {primary.acronym}
                      </span>
                      {primary.hint && (
                        <span className="text-sm text-gray-500">Hint: {primary.hint}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startAddSecondary(primary)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                      >
                        + Add Secondary
                      </button>
                      <button
                        onClick={() => startEditPrimary(primary)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeletePrimary(primary.id)}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Secondaries */}
                  {primary.secondaries.length > 0 && (
                    <div className="p-4">
                      <div className="grid gap-2">
                        {primary.secondaries.map((secondary) => (
                          <div
                            key={secondary.id}
                            className="flex items-center justify-between p-3 bg-white border rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium">{secondary.label}</span>
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-sm rounded">
                                {secondary.acronym}
                              </span>
                              {secondary.hint && (
                                <span className="text-sm text-gray-500">Hint: {secondary.hint}</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => startEditSecondary(secondary, primary)}
                                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteSecondary(secondary.id)}
                                className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        <div className="mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="w-full px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
