'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Pencil, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../../../../lib/api-client';
import SearchableSelect from '../../../components/SearchableSelect';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../components/ui/ErpPrimitives';
import { SlidePanel } from '../../../components/ui/SlidePanel';

type Project = {
  id: string;
  project_code: string;
  project_name: string;
  department: string;
  status: string;
  description?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  site_name?: string | null;
  site_address?: string | null;
  committed_delivery_date?: string | null;
  created_at?: string;
};

type WorkPackageLine = { id: string; line_number: number; item_id: string; item_code?: string; item_name?: string; quantity: number; uom: string; required_date?: string | null; demand_status: string };
type WorkPackage = { id: string; package_code: string; package_name: string; location_name?: string | null; required_date?: string | null; priority: number; status: string; lines: WorkPackageLine[] };
type ItemOption = { id: string; code: string; name: string; uom?: string };
type CustomerOption = { id: string; customer_code: string; customer_name: string };

type ProjectEvent = {
  id: string;
  event_type: string;
  source_module?: string | null;
  source_number?: string | null;
  remarks?: string | null;
  created_at: string;
};

const DEPARTMENT_OPTIONS = [
  { value: 'PRODUCTION', label: 'Production' },
  { value: 'R&D', label: 'R&D' },
];

const EMPTY_PROJECT_FORM = {
  projectName: '',
  projectCode: '',
  department: 'PRODUCTION',
  description: '',
  customerId: '',
  customerName: '',
  siteName: '',
  siteAddress: '',
  committedDeliveryDate: '',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [workPackages, setWorkPackages] = useState<WorkPackage[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [packageForm, setPackageForm] = useState({ packageName: '', packageCode: '', locationName: '', requiredDate: '', priority: '50' });
  const [lineForms, setLineForms] = useState<Record<string, { itemId: string; quantity: string; requiredDate: string }>>({});
  const [form, setForm] = useState(EMPTY_PROJECT_FORM);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/projects?status=ACTIVE');
      setProjects(Array.isArray(data) ? data : []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
    Promise.all([
      apiClient.get('/inventory/items?onlyVerified=true').catch(() => []),
      apiClient.get('/sales/customers').catch(() => []),
    ]).then(([itemRows, customerRows]) => {
      setItems(Array.isArray(itemRows) ? itemRows : []);
      setCustomers(Array.isArray(customerRows) ? customerRows : []);
    });
  }, []);

  const filteredProjects = useMemo(() => {
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    return projects.filter((project) => {
      if (departmentFilter && project.department !== departmentFilter) return false;
      const haystack = `${project.project_code} ${project.project_name} ${project.description || ''}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [projects, search, departmentFilter]);

  const openTrail = async (project: Project) => {
    setSelectedProject(project);
    setEvents([]);
    try {
      const data = await apiClient.get(`/projects/${project.id}/trail`);
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load project trail');
    }
  };

  const openManufacturing = async (project: Project) => {
    setSelectedProject(project);
    setEvents([]);
    setWorkPackages([]);
    try {
      const [detail, trail] = await Promise.all([
        apiClient.get(`/projects/${project.id}/manufacturing`),
        apiClient.get(`/projects/${project.id}/trail`),
      ]);
      setSelectedProject(detail?.project || project);
      setWorkPackages(Array.isArray(detail?.workPackages) ? detail.workPackages : []);
      setEvents(Array.isArray(trail?.events) ? trail.events : []);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load project manufacturing plan');
    }
  };

  const reloadManufacturing = async () => {
    if (!selectedProject) return;
    const detail = await apiClient.get(`/projects/${selectedProject.id}/manufacturing`);
    setWorkPackages(Array.isArray(detail?.workPackages) ? detail.workPackages : []);
  };

  const createWorkPackage = async () => {
    if (!selectedProject || !packageForm.packageName.trim()) return toast.error('Work package name is required');
    setSaving(true);
    try {
      await apiClient.post(`/projects/${selectedProject.id}/work-packages`, { ...packageForm, priority: Number(packageForm.priority || 50) });
      setPackageForm({ packageName: '', packageCode: '', locationName: '', requiredDate: '', priority: '50' });
      await reloadManufacturing();
      toast.success('Work package added');
    } catch (error: any) { toast.error(error?.message || 'Failed to add work package'); }
    finally { setSaving(false); }
  };

  const createDemandLine = async (workPackage: WorkPackage) => {
    if (!selectedProject) return;
    const row = lineForms[workPackage.id] || { itemId: '', quantity: '', requiredDate: '' };
    if (!row.itemId || Number(row.quantity) <= 0) return toast.error('Select an item and enter a quantity');
    setSaving(true);
    try {
      await apiClient.post(`/projects/${selectedProject.id}/work-packages/${workPackage.id}/lines`, row);
      setLineForms((prev) => ({ ...prev, [workPackage.id]: { itemId: '', quantity: '', requiredDate: '' } }));
      await reloadManufacturing();
      toast.success('Item demand added');
    } catch (error: any) { toast.error(error?.message || 'Failed to add item demand'); }
    finally { setSaving(false); }
  };

  const changeDemandStatus = async (workPackage: WorkPackage, line: WorkPackageLine, demandStatus: string) => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      await apiClient.put(`/projects/${selectedProject.id}/work-packages/${workPackage.id}/lines/${line.id}`, { demandStatus });
      await reloadManufacturing();
      toast.success(`Demand moved to ${demandStatus.replaceAll('_', ' ').toLowerCase()}`);
    } catch (error: any) { toast.error(error?.message || 'Failed to update demand status'); }
    finally { setSaving(false); }
  };

  const createProject = async () => {
    if (!form.projectName.trim()) {
      toast.error('Project name is required');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/projects', form);
      toast.success('Project created');
      setShowCreate(false);
      setForm(EMPTY_PROJECT_FORM);
      loadProjects();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create project');
    } finally {
      setSaving(false);
    }
  };

  const openCreateProject = () => {
    setEditingProject(null);
    setForm(EMPTY_PROJECT_FORM);
    setShowCreate(true);
  };

  const openEditProject = (project: Project) => {
    setShowCreate(false);
    setSelectedProject(null);
    setEditingProject(project);
    setForm({
      projectName: project.project_name || '',
      projectCode: project.project_code || '',
      department: project.department || 'PRODUCTION',
      description: project.description || '',
      customerId: project.customer_id || '',
      customerName: project.customer_name || '',
      siteName: project.site_name || '',
      siteAddress: project.site_address || '',
      committedDeliveryDate: (project.committed_delivery_date || '').slice(0, 10),
    });
  };

  const updateProject = async () => {
    if (!editingProject) return;
    if (!form.projectName.trim()) {
      toast.error('Project name is required');
      return;
    }
    if (!form.projectCode.trim()) {
      toast.error('Project code is required');
      return;
    }
    setSaving(true);
    try {
      await apiClient.put(`/projects/${editingProject.id}`, form);
      toast.success('Project updated');
      setEditingProject(null);
      setForm(EMPTY_PROJECT_FORM);
      await loadProjects();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update project');
    } finally {
      setSaving(false);
    }
  };

  const closeProjectForm = () => {
    setShowCreate(false);
    setEditingProject(null);
    setForm(EMPTY_PROJECT_FORM);
  };

  return (
    <div className="w-full space-y-3">
      <ErpPageHeader
        eyebrow="Project Control"
        title="Projects"
        description="Maintain production and R&D project masters, then track procurement and inventory trail against each project."
        actions={(
          <div className="flex gap-2">
            <ErpButton variant="secondary" onClick={loadProjects}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </ErpButton>
            <ErpButton variant="primary" onClick={openCreateProject}>
              <ClipboardList className="h-4 w-4" />
              New Project
            </ErpButton>
          </div>
        )}
      />

      <ErpMetricStrip
        loading={loading}
        metrics={[
          { label: 'Active Projects', value: projects.length },
          { label: 'Production', value: projects.filter((p) => p.department === 'PRODUCTION').length },
          { label: 'R&D', value: projects.filter((p) => p.department === 'R&D').length },
          { label: 'Filtered', value: filteredProjects.length },
        ]}
      />

      <section className="border border-[#D8C8AA] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#E6D8BF] p-3 lg:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A6555]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 w-full border border-[#D8C8AA] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#8B6F47]"
              placeholder="Search project code, name, or description"
            />
          </label>
          <div className="w-full lg:w-72">
            <SearchableSelect
              value={departmentFilter}
              onChange={setDepartmentFilter}
              options={[{ value: '', label: 'All departments' }, ...DEPARTMENT_OPTIONS]}
              placeholder="All departments"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-[#F7F3EA] text-left text-xs uppercase text-[#5E4635]">
              <tr>
                <th className="px-4 py-3">Project Code</th>
                <th className="px-4 py-3">Project Name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <tr key={project.id} className="border-t border-[#E6D8BF]">
                  <td className="px-4 py-3 font-semibold text-[#4A3426]">{project.project_code}</td>
                  <td className="px-4 py-3">{project.project_name}</td>
                  <td className="px-4 py-3">{project.department}</td>
                  <td className="px-4 py-3"><ErpStatusBadge status={project.status} /></td>
                  <td className="max-w-[360px] px-4 py-3 text-[#6B5A48]">{project.description || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <ErpButton variant="primary" onClick={() => openManufacturing(project)}>Plan</ErpButton>
                      <ErpButton variant="secondary" onClick={() => openEditProject(project)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </ErpButton>
                      <ErpButton variant="secondary" onClick={() => openTrail(project)}>Trail</ErpButton>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#7A6555]">No projects found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <SlidePanel
        open={showCreate || !!editingProject}
        onClose={closeProjectForm}
        title={editingProject ? 'Edit Project' : 'Create Project'}
        subtitle="Project master"
        width="full"
        footer={(
          <>
            <ErpButton variant="ghost" onClick={closeProjectForm}>Cancel</ErpButton>
            <ErpButton variant="primary" onClick={editingProject ? updateProject : createProject} disabled={saving}>
              {saving ? 'Saving...' : editingProject ? 'Save Changes' : 'Create Project'}
            </ErpButton>
          </>
        )}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Project Name *</span>
            <input
              value={form.projectName}
              onChange={(event) => setForm((prev) => ({ ...prev, projectName: event.target.value }))}
              className="h-10 w-full border border-[#D8C8AA] px-3 outline-none focus:border-[#8B6F47]"
              placeholder="e.g. Coupler R&D Trial"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Project Code</span>
            <input
              value={form.projectCode}
              onChange={(event) => setForm((prev) => ({ ...prev, projectCode: event.target.value }))}
              className="h-10 w-full border border-[#D8C8AA] px-3 outline-none focus:border-[#8B6F47]"
              placeholder="Auto generated if blank"
            />
          </label>
          <div className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Department *</span>
            <SearchableSelect
              value={form.department}
              onChange={(department) => setForm((prev) => ({ ...prev, department }))}
              options={DEPARTMENT_OPTIONS}
              placeholder="Select department"
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Customer</span>
            <SearchableSelect
              value={form.customerId}
              onChange={(customerId) => {
                const customer = customers.find((row) => row.id === customerId);
                setForm((prev) => ({ ...prev, customerId, customerName: customer?.customer_name || '' }));
              }}
              options={[{ value: '', label: 'No customer / internal project' }, ...customers.map((customer) => ({ value: customer.id, label: `${customer.customer_code} - ${customer.customer_name}` }))]}
              placeholder="Select customer"
            />
          </div>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Committed Delivery Date</span>
            <input type="date" value={form.committedDeliveryDate} onChange={(event) => setForm((prev) => ({ ...prev, committedDeliveryDate: event.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3 outline-none focus:border-[#8B6F47]" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[#5E4635]">Site / Delivery Location</span>
            <input value={form.siteName} onChange={(event) => setForm((prev) => ({ ...prev, siteName: event.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3 outline-none focus:border-[#8B6F47]" placeholder="Site, building, plant, or location" />
          </label>
          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm font-medium text-[#5E4635]">Site Address</span>
            <input value={form.siteAddress} onChange={(event) => setForm((prev) => ({ ...prev, siteAddress: event.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3 outline-none focus:border-[#8B6F47]" placeholder="Optional delivery or project-site address" />
          </label>
          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm font-medium text-[#5E4635]">Description</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              className="w-full border border-[#D8C8AA] px-3 py-2 outline-none focus:border-[#8B6F47]"
              placeholder="Scope, customer, trial purpose, or notes"
            />
          </label>
        </div>
      </SlidePanel>

      <SlidePanel
        open={!!selectedProject}
        onClose={() => setSelectedProject(null)}
        title={selectedProject?.project_name || 'Project Trail'}
        subtitle={selectedProject?.project_code}
        width="full"
        footer={<ErpButton variant="ghost" onClick={() => setSelectedProject(null)}><X className="h-4 w-4" />Close</ErpButton>}
      >
        <div className="space-y-5">
          <section className="grid grid-cols-1 gap-3 border border-[#D8C8AA] bg-[#FAF7EF] p-4 md:grid-cols-4">
            <div><p className="text-xs uppercase text-[#7A6555]">Customer</p><p className="font-semibold">{selectedProject?.customer_name || 'Internal'}</p></div>
            <div><p className="text-xs uppercase text-[#7A6555]">Site</p><p className="font-semibold">{selectedProject?.site_name || '-'}</p></div>
            <div><p className="text-xs uppercase text-[#7A6555]">Committed date</p><p className="font-semibold">{selectedProject?.committed_delivery_date || '-'}</p></div>
            <div><p className="text-xs uppercase text-[#7A6555]">Demand lines</p><p className="font-semibold">{workPackages.reduce((sum, row) => sum + row.lines.length, 0)}</p></div>
          </section>

          <section className="border border-[#D8C8AA] bg-white p-4">
            <h3 className="font-semibold text-[#4A3426]">Add work package</h3>
            <p className="mb-3 text-sm text-[#6B5A48]">Use a package for a phase, area, batch, assembly group, floor, or delivery lot.</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Package name *</span><input value={packageForm.packageName} onChange={(e) => setPackageForm((p) => ({ ...p, packageName: e.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3" placeholder="e.g. Pilot batch or Ground floor" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Code</span><input value={packageForm.packageCode} onChange={(e) => setPackageForm((p) => ({ ...p, packageCode: e.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3" placeholder="Auto if blank" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Required by</span><input type="date" value={packageForm.requiredDate} onChange={(e) => setPackageForm((p) => ({ ...p, requiredDate: e.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Priority</span><input type="number" min="1" max="100" value={packageForm.priority} onChange={(e) => setPackageForm((p) => ({ ...p, priority: e.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3" /></label>
              <label className="space-y-1 md:col-span-4"><span className="text-xs font-medium">Location / group</span><input value={packageForm.locationName} onChange={(e) => setPackageForm((p) => ({ ...p, locationName: e.target.value }))} className="h-10 w-full border border-[#D8C8AA] px-3" placeholder="Optional configurable location" /></label>
              <div className="flex items-end"><ErpButton variant="primary" onClick={createWorkPackage} disabled={saving}>Add package</ErpButton></div>
            </div>
          </section>

          {workPackages.map((workPackage) => {
            const row = lineForms[workPackage.id] || { itemId: '', quantity: '', requiredDate: '' };
            return (
              <section key={workPackage.id} className="border border-[#D8C8AA] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F7F3EA] p-3">
                  <div><p className="font-semibold text-[#4A3426]">{workPackage.package_code} · {workPackage.package_name}</p><p className="text-xs text-[#6B5A48]">{workPackage.location_name || 'No location'} · Required {workPackage.required_date || 'not set'} · Priority {workPackage.priority}</p></div>
                  <ErpStatusBadge status={workPackage.status} />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[800px] w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-[#6B5A48]"><th className="p-3">Line</th><th className="p-3">Item</th><th className="p-3">Quantity</th><th className="p-3">Required</th><th className="p-3">Demand status</th><th className="p-3">Next action</th></tr></thead><tbody>
                    {workPackage.lines.map((line) => <tr key={line.id} className="border-b"><td className="p-3">{line.line_number}</td><td className="p-3"><span className="font-medium">{line.item_code}</span><br/><span className="text-xs text-[#6B5A48]">{line.item_name}</span></td><td className="p-3">{line.quantity} {line.uom}</td><td className="p-3">{line.required_date || '-'}</td><td className="p-3"><ErpStatusBadge status={line.demand_status} /></td><td className="p-3">{line.demand_status === 'DRAFT' ? <ErpButton variant="secondary" onClick={() => changeDemandStatus(workPackage, line, 'READY')} disabled={saving}>Mark ready</ErpButton> : line.demand_status === 'READY' ? <ErpButton variant="primary" onClick={() => changeDemandStatus(workPackage, line, 'RELEASED')} disabled={saving}>Release to MRP</ErpButton> : <span className="text-xs text-[#6B5A48]">Tracked by MRP / production</span>}</td></tr>)}
                    {!workPackage.lines.length && <tr><td colSpan={6} className="p-4 text-center text-[#7A6555]">No item demand yet</td></tr>}
                  </tbody></table>
                </div>
                <div className="grid grid-cols-1 gap-2 border-t bg-[#FCFAF5] p-3 md:grid-cols-4">
                  <div><SearchableSelect value={row.itemId} onChange={(itemId) => setLineForms((p) => ({ ...p, [workPackage.id]: { ...row, itemId } }))} options={items.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} placeholder="Search finished/sub-assembly item" /></div>
                  <input type="number" min="0.0001" step="any" value={row.quantity} onChange={(e) => setLineForms((p) => ({ ...p, [workPackage.id]: { ...row, quantity: e.target.value } }))} className="h-10 border border-[#D8C8AA] px-3" placeholder="Quantity" />
                  <input type="date" value={row.requiredDate} onChange={(e) => setLineForms((p) => ({ ...p, [workPackage.id]: { ...row, requiredDate: e.target.value } }))} className="h-10 border border-[#D8C8AA] px-3" />
                  <ErpButton variant="secondary" onClick={() => createDemandLine(workPackage)} disabled={saving}>Add item demand</ErpButton>
                </div>
              </section>
            );
          })}

          <section>
            <h3 className="mb-3 font-semibold text-[#4A3426]">Project trail</h3>
          {events.map((event) => (
            <div key={event.id} className="border-l-4 border-[#8B6F47] bg-[#FAF7EF] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[#4A3426]">{event.event_type}</p>
                <p className="text-xs text-[#7A6555]">{event.created_at ? new Date(event.created_at).toLocaleString() : ''}</p>
              </div>
              <p className="mt-1 text-sm text-[#5E4635]">{event.source_module || '-'} {event.source_number ? `- ${event.source_number}` : ''}</p>
              {event.remarks && <p className="mt-2 text-sm text-[#6B5A48]">{event.remarks}</p>}
            </div>
          ))}
          {events.length === 0 && <p className="text-sm text-[#7A6555]">No trail events yet.</p>}
          </section>
        </div>
      </SlidePanel>
    </div>
  );
}
