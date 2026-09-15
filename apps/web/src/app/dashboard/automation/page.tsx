'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, Building2, ChevronRight, History, Lightbulb, ListTodo, Loader2, MessageSquareText, Play, Plus, RefreshCw, ShieldCheck, Trash2, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '../../../../lib/api-client';
import { ErpButton, ErpMetricStrip, ErpPageHeader, ErpStatusBadge } from '../../../components/ui/ErpPrimitives';

type Rule = {
  id: string;
  rule_code: string;
  rule_name: string;
  module: string;
  trigger_type: string;
  action_type: string;
  is_active: boolean;
  recipients?: string[];
  last_run_at?: string | null;
};

type Run = {
  id: string;
  run_type: string;
  automation_rule?: { rule_code?: string; rule_name?: string; module?: string } | null;
  status: string;
  target_count: number;
  created_at: string;
  result?: { safety_note?: string; safe_note?: string; delivery?: { created?: number; skipped?: number; channel?: string; note?: string } };
};

type Communication = {
  id: string;
  channel: string;
  direction: string;
  subject?: string | null;
  recipient?: string | null;
  module?: string | null;
  delivery_status: string;
  created_at: string;
};

type AutomationTask = {
  id: string;
  module: string;
  document_number?: string | null;
  title: string;
  description?: string | null;
  priority: string;
  status: string;
  due_date?: string | null;
  created_at: string;
  metadata?: Record<string, any>;
};

type Branch = {
  id: string;
  branch_code: string;
  branch_name: string;
  market_profile: string;
  currency_code: string;
  tax_regime?: string | null;
  timezone?: string | null;
  is_active: boolean;
};

type Mis = {
  grade?: string;
  riskScore?: number;
  generatedBy?: string;
  decisionsRequired?: string[];
  managementAttention?: Array<{ area: string; issue: string; impact: string; severity: string }>;
  departmentActions?: Array<{ department: string; action: string; route: string }>;
};

const MODULES = ['SALES', 'SERVICE', 'PURCHASE', 'INVENTORY', 'FINANCE', 'OPERATIONS'];
const TRIGGERS = [
  ['QUOTATION_EXPIRING', 'Quotation response / expiry'],
  ['RECEIVABLE_OVERDUE', 'Overdue receivable'],
  ['SERVICE_SLA_RISK', 'Service SLA risk'],
  ['SERVICE_CONTRACT_EXPIRING', 'Service contract renewal'],
  ['WARRANTY_EXPIRING', 'Warranty expiry'],
  ['PREVENTIVE_MAINTENANCE_DUE', 'Preventive maintenance due'],
  ['SERVICE_ESTIMATE_EXPIRING', 'Service estimate response / expiry'],
  ['LOW_STOCK', 'Low-stock risk'],
  ['PO_OVERDUE', 'Purchase-order overdue'],
];
const PLAYBOOKS = [
  { rule_name: 'Quotation follow-up before expiry', module: 'SALES', trigger_type: 'QUOTATION_EXPIRING', action_type: 'NOTIFY', days: 7, description: 'Create a controlled follow-up queue for quotations approaching expiry.' },
  { rule_name: 'Escalate overdue customer receivables', module: 'FINANCE', trigger_type: 'RECEIVABLE_OVERDUE', action_type: 'ESCALATE', days: 14, description: 'Escalate open customer balances after the configured grace period.' },
  { rule_name: 'Protect service SLA commitments', module: 'SERVICE', trigger_type: 'SERVICE_SLA_RISK', action_type: 'ESCALATE', days: 1, description: 'Flag active tickets approaching their SLA due time.' },
  { rule_name: 'Renew service contracts proactively', module: 'SERVICE', trigger_type: 'SERVICE_CONTRACT_EXPIRING', action_type: 'NOTIFY', days: 30, description: 'Create a renewal opportunity before an active contract expires.' },
  { rule_name: 'Protect warranty customer retention', module: 'SERVICE', trigger_type: 'WARRANTY_EXPIRING', action_type: 'NOTIFY', days: 30, description: 'Prepare a warranty-expiry outreach queue for installed assets.' },
  { rule_name: 'Preventive maintenance due control', module: 'SERVICE', trigger_type: 'PREVENTIVE_MAINTENANCE_DUE', action_type: 'CREATE_TASK', days: 7, description: 'Surface planned maintenance due in the upcoming service window.' },
  { rule_name: 'Service estimate customer response', module: 'SERVICE', trigger_type: 'SERVICE_ESTIMATE_EXPIRING', action_type: 'NOTIFY', days: 5, description: 'Prompt a customer decision before a chargeable estimate expires.' },
  { rule_name: 'Low stock exception control', module: 'INVENTORY', trigger_type: 'LOW_STOCK', action_type: 'CREATE_TASK', days: 0, description: 'Create traceable replenishment actions for unresolved low-stock alerts.' },
  { rule_name: 'Overdue purchase-order follow-up', module: 'PURCHASE', trigger_type: 'PO_OVERDUE', action_type: 'ESCALATE', days: 1, description: 'Escalate supplier follow-up for overdue approved purchase orders.' },
];

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mis, setMis] = useState<Mis | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>('OPEN');
  const [tab, setTab] = useState<'playbooks' | 'rules' | 'insights' | 'tasks' | 'runs' | 'communications' | 'branches'>('playbooks');
  const [showRule, setShowRule] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [ruleForm, setRuleForm] = useState({ rule_name: '', module: 'SALES', trigger_type: 'QUOTATION_EXPIRING', action_type: 'NOTIFY', recipients: '', days: '7', template_subject: '', template_body: '' });
  const [branchForm, setBranchForm] = useState({ branch_code: '', branch_name: '', market_profile: 'INDIA', currency_code: 'INR', tax_regime: 'GST', timezone: 'Asia/Kolkata' });

  const load = async () => {
    setLoading(true);
    try {
      const [nextRules, nextRuns, nextCommunications, nextTasks, nextBranches, nextMis] = await Promise.all([
        apiClient.get<Rule[]>('/automation/rules'),
        apiClient.get<Run[]>('/automation/runs'),
        apiClient.get<Communication[]>('/automation/communications'),
        apiClient.get<AutomationTask[]>('/automation/tasks'),
        apiClient.get<Branch[]>('/automation/branches'),
        apiClient.get<Mis>('/dashboard/mis'),
      ]);
      setRules(Array.isArray(nextRules) ? nextRules : []);
      setRuns(Array.isArray(nextRuns) ? nextRuns : []);
      setCommunications(Array.isArray(nextCommunications) ? nextCommunications : []);
      setTasks(Array.isArray(nextTasks) ? nextTasks : []);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
      setMis(nextMis || null);
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load automation controls');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const activeRules = useMemo(() => rules.filter((rule) => rule.is_active).length, [rules]);

  const createRule = async () => {
    if (!ruleForm.rule_name.trim()) return toast.error('Enter a rule name');
    setWorkingId('create-rule');
    try {
      await apiClient.post('/automation/rules', {
        ...ruleForm,
        conditions: { days: Math.max(0, Number(ruleForm.days) || 0) },
        recipients: ruleForm.recipients.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean),
      });
      toast.success('Automation rule created in disabled review mode');
      setShowRule(false);
      setRuleForm({ rule_name: '', module: 'SALES', trigger_type: 'QUOTATION_EXPIRING', action_type: 'NOTIFY', recipients: '', days: '7', template_subject: '', template_body: '' });
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to create rule'); }
    finally { setWorkingId(null); }
  };

  const installPlaybook = async (playbook: typeof PLAYBOOKS[number]) => {
    setWorkingId(`playbook-${playbook.trigger_type}`);
    try {
      await apiClient.post('/automation/rules', {
        ...playbook,
        conditions: { days: playbook.days },
        recipients: [],
        template_subject: '',
        template_body: '',
      });
      toast.success(`${playbook.rule_name} added in disabled review mode`);
      setTab('rules');
      await load();
    } catch (error: any) { toast.error(error?.message || 'This playbook could not be added'); }
    finally { setWorkingId(null); }
  };

  const updateRule = async (rule: Rule, patch: Record<string, unknown>) => {
    setWorkingId(rule.id);
    try {
      await apiClient.put(`/automation/rules/${rule.id}`, patch);
      toast.success(patch.is_active === true ? 'Rule enabled' : patch.is_active === false ? 'Rule disabled' : 'Rule updated');
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to update rule'); }
    finally { setWorkingId(null); }
  };

  const deleteRule = async (rule: Rule) => {
    if (!window.confirm(`Remove disabled rule "${rule.rule_name}"? Rules with audit history will be protected.`)) return;
    setWorkingId(`delete-${rule.id}`);
    try {
      await apiClient.delete(`/automation/rules/${rule.id}`);
      toast.success('Unused automation rule removed');
      await load();
    } catch (error: any) { toast.error(error?.message || 'This rule could not be removed'); }
    finally { setWorkingId(null); }
  };

  const markCommunicationRead = async (communication: Communication) => {
    setWorkingId(`communication-${communication.id}`);
    try {
      await apiClient.patch(`/automation/communications/${communication.id}/read`);
      toast.success('Communication marked as read');
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to update communication status'); }
    finally { setWorkingId(null); }
  };

  const updateTaskStatus = async (task: AutomationTask, status: 'IN_PROGRESS' | 'DONE' | 'CANCELLED') => {
    setWorkingId(`task-${task.id}`);
    try {
      const payload: any = { status };
      if (status === 'DONE' && task.metadata?.source === 'MIZANTRA_INTELLIGENCE') {
        const completionEvidence = window.prompt('Completion evidence (what changed, reference or inspection evidence):', '');
        if (completionEvidence === null) { setWorkingId(null); return; }
        const statedValue = window.prompt('Stated realised value (optional; it will remain unverified until Finance verifies it):', '0');
        if (statedValue === null) { setWorkingId(null); return; }
        payload.completion_evidence = completionEvidence;
        payload.realized_value = statedValue;
      }
      await apiClient.patch(`/automation/tasks/${task.id}`, payload);
      toast.success(status === 'DONE' ? 'Exception task completed' : status === 'CANCELLED' ? 'Exception task cancelled' : 'Exception task accepted');
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to update exception task'); }
    finally { setWorkingId(null); }
  };

  const openTaskSource = (task: AutomationTask) => {
    const query = task.document_number ? `?search=${encodeURIComponent(task.document_number)}` : '';
    const route = task.module === 'SALES'
      ? `/dashboard/sales${task.document_number?.startsWith('QT-') ? '?tab=quotations' : '?tab=billing'}`
      : task.module === 'SERVICE'
        ? '/dashboard/service?tab=tickets'
        : task.module === 'PURCHASE'
          ? `/dashboard/purchase/orders${query}`
          : task.module === 'INVENTORY'
            ? '/dashboard/inventory/low-stock'
            : '/dashboard';
    window.location.assign(route);
  };

  const runRule = async (rule: Rule, mode: 'preview' | 'run') => {
    setWorkingId(`${mode}-${rule.id}`);
    try {
      const result = await apiClient.post<Run>(`/automation/rules/${rule.id}/${mode}`);
      const delivery = result.result?.delivery;
      toast.success(mode === 'preview' ? `${result.target_count} matching records found` : `${delivery?.created ?? 0} governed action(s) created for ${result.target_count} matching records`);
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to execute automation control'); }
    finally { setWorkingId(null); }
  };

  const runEnabledRules = async () => {
    setWorkingId('run-enabled');
    try {
      const result = await apiClient.post<{ evaluated: number; succeeded: number; failed: number }>('/automation/rules/run-active');
      toast.success(`${result.succeeded}/${result.evaluated} enabled rule(s) completed${result.failed ? `; ${result.failed} need review` : ''}`);
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to run enabled automation rules'); }
    finally { setWorkingId(null); }
  };

  const createBranch = async () => {
    if (!branchForm.branch_code.trim() || !branchForm.branch_name.trim()) return toast.error('Enter branch code and branch name');
    setWorkingId('create-branch');
    try {
      await apiClient.post('/automation/branches', branchForm);
      toast.success('Branch created');
      setShowBranch(false);
      setBranchForm({ branch_code: '', branch_name: '', market_profile: 'INDIA', currency_code: 'INR', tax_regime: 'GST', timezone: 'Asia/Kolkata' });
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to create branch'); }
    finally { setWorkingId(null); }
  };

  const toggleBranch = async (branch: Branch) => {
    setWorkingId(`branch-${branch.id}`);
    try {
      await apiClient.put(`/automation/branches/${branch.id}`, { is_active: !branch.is_active });
      toast.success(branch.is_active ? 'Branch deactivated' : 'Branch activated');
      await load();
    } catch (error: any) { toast.error(error?.message || 'Unable to update branch'); }
    finally { setWorkingId(null); }
  };

  return (
    <main className="space-y-4 p-4 md:p-6">
      <ErpPageHeader
        eyebrow="Enterprise controls"
        title="Automation & communication hub"
        description="Govern reminders, escalations, operational signals, communication evidence and India/UAE branch controls. Rules are review-first and do not send external messages unless separately configured."
        actions={<><ErpButton size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</ErpButton><ErpButton size="sm" onClick={runEnabledRules} disabled={!activeRules || workingId !== null}>{workingId === 'run-enabled' && <Loader2 className="h-4 w-4 animate-spin" />}<Play className="h-4 w-4" />Run enabled</ErpButton><ErpButton size="sm" variant="primary" onClick={() => setShowRule(true)}><Plus className="h-4 w-4" />New rule</ErpButton></>}
      />
      <ErpMetricStrip loading={loading} metrics={[
        { label: 'Active rules', value: activeRules, tone: activeRules ? 'success' : 'neutral' },
        { label: 'Controlled runs', value: runs.length },
        { label: 'Communication evidence', value: communications.length },
        { label: 'Open exception tasks', value: tasks.filter((task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS').length, tone: tasks.some((task) => task.priority === 'CRITICAL' || task.priority === 'HIGH') ? 'warning' : 'neutral' },
        { label: 'Active branches', value: branches.filter((branch) => branch.is_active).length },
      ]} />
      <div className="rounded-md border border-[#E8DCC4] bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#E8DCC4] bg-[#FDF9F1] p-4">
          <div>
            <p className="text-sm font-bold text-[#4A3426]">Automation workspace</p>
            <p className="mt-1 text-xs text-[#7A6555]">Choose one worklist at a time to keep this control area focused.</p>
          </div>
          <label className="min-w-[220px] text-xs font-semibold uppercase tracking-wide text-[#6F5A48]">
            Workspace
            <select value={tab} onChange={(event) => setTab(event.target.value as typeof tab)} className="mt-1 block w-full rounded-md border border-[#D9C9AD] bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[#4A3426]">
              <option value="playbooks">Playbooks</option>
              <option value="rules">Rules</option>
              <option value="insights">Recommended actions</option>
              <option value="tasks">Exception queue</option>
              <option value="runs">Run history</option>
              <option value="communications">Communication log</option>
              <option value="branches">Branches</option>
            </select>
          </label>
        </div>
        {tab === 'playbooks' && <div className="p-4"><div className="mb-4 rounded-md border border-[#E8DCC4] bg-[#FDF9F1] p-4"><p className="font-bold text-[#4A3426]">Controlled automation playbooks</p><p className="mt-1 text-sm text-[#7A6555]">Install a standard operational control in disabled review mode. Preview the precise records first, set recipients if required, then enable it.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{PLAYBOOKS.map((playbook) => { const installed = rules.some((rule) => rule.trigger_type === playbook.trigger_type); return <section key={playbook.trigger_type} className="rounded-md border border-[#E8DCC4] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#4A3426]">{playbook.rule_name}</p><p className="mt-1 text-xs text-[#7A6555]">{playbook.module} · {playbook.days} day window</p></div><ErpStatusBadge status={installed ? 'APPROVED' : 'DRAFT'} label={installed ? 'Added' : 'Available'} /></div><p className="mt-3 min-h-10 text-sm text-[#6F5A48]">{playbook.description}</p><div className="mt-4 flex justify-end"><ErpButton size="sm" variant={installed ? 'secondary' : 'primary'} disabled={installed || workingId !== null} onClick={() => installPlaybook(playbook)}>{workingId === `playbook-${playbook.trigger_type}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{installed ? 'Added' : 'Add playbook'}</ErpButton></div></section>; })}</div></div>}
        {tab === 'rules' && <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-[#F7F2E9] text-left text-xs uppercase text-[#7A6555]"><tr><th className="p-3">Rule</th><th className="p-3">Module / trigger</th><th className="p-3">Action</th><th className="p-3">Recipients</th><th className="p-3">State</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{rules.length ? rules.map((rule) => <tr key={rule.id} className="border-t border-[#F0E8D8]"><td className="p-3"><div className="font-semibold text-[#4A3426]">{rule.rule_name}</div><div className="text-xs text-[#8B6F47]">{rule.rule_code}</div></td><td className="p-3"><div>{rule.module}</div><div className="text-xs text-gray-500">{rule.trigger_type.replaceAll('_', ' ')}</div></td><td className="p-3">{rule.action_type}</td><td className="p-3 text-xs text-gray-600">{rule.recipients?.join(', ') || 'In-app control queue'}</td><td className="p-3"><ErpStatusBadge status={rule.is_active ? 'APPROVED' : 'DRAFT'} label={rule.is_active ? 'Enabled' : 'Disabled'} /></td><td className="p-3"><div className="flex justify-end gap-2"><ErpButton size="sm" onClick={() => runRule(rule, 'preview')} disabled={workingId !== null}><BellRing className="h-3.5 w-3.5" />Preview</ErpButton><ErpButton size="sm" variant="approve" onClick={() => runRule(rule, 'run')} disabled={!rule.is_active || workingId !== null}><Play className="h-3.5 w-3.5" />Run</ErpButton><ErpButton size="sm" onClick={() => updateRule(rule, { is_active: !rule.is_active })} disabled={workingId !== null}>{rule.is_active ? 'Disable' : 'Enable'}</ErpButton>{!rule.is_active && <ErpButton size="sm" variant="danger" onClick={() => deleteRule(rule)} disabled={workingId !== null}>{workingId === `delete-${rule.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Remove</ErpButton>}</div></td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-[#7A6555]">No rules yet. Add a monitored business signal, preview its targets, then enable it when the process owner is ready.</td></tr>}</tbody></table></div>}
        {tab === 'runs' && <RunHistory rows={runs} />}
        {tab === 'insights' && <ManagementActions mis={mis} />}
        {tab === 'tasks' && <div className="p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold text-[#4A3426]">Governed exception queue</p><p className="text-xs text-[#7A6555]">Accept, complete or cancel work created by approved automation controls. Every transition remains auditable.</p></div><label className="text-xs font-semibold text-[#6F5A48]">View <select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value as 'OPEN' | 'CLOSED' | 'ALL')} className="ml-2 rounded border border-[#D9C9AD] bg-white px-2 py-1"><option value="OPEN">Open and in progress</option><option value="CLOSED">Completed and cancelled</option><option value="ALL">All tasks</option></select></label></div><AutomationTaskQueue rows={tasks.filter((task) => taskFilter === 'ALL' || taskFilter === 'OPEN' ? task.status === 'OPEN' || task.status === 'IN_PROGRESS' : task.status === 'DONE' || task.status === 'CANCELLED')} onUpdateStatus={updateTaskStatus} onOpenSource={openTaskSource} busyId={workingId} /></div>}
        {tab === 'communications' && <CommunicationHistoryActions rows={communications} onMarkRead={markCommunicationRead} busyId={workingId} />}
        {tab === 'branches' && <div className="p-4"><div className="mb-3 flex justify-end"><ErpButton size="sm" variant="primary" onClick={() => setShowBranch(true)}><Plus className="h-4 w-4" />Add branch</ErpButton></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{branches.map((branch) => <div key={branch.id} className="rounded-md border border-[#E8DCC4] p-4"><div className="flex justify-between gap-3"><div><p className="font-bold text-[#4A3426]">{branch.branch_name}</p><p className="text-xs text-[#8B6F47]">{branch.branch_code}</p></div><ErpStatusBadge status={branch.is_active ? 'APPROVED' : 'DRAFT'} label={branch.is_active ? 'Active' : 'Inactive'} /></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[#6F5A48]"><span>Market: {branch.market_profile}</span><span>Currency: {branch.currency_code}</span><span>Tax: {branch.tax_regime || '—'}</span><span>{branch.timezone || '—'}</span></div><div className="mt-4 flex justify-end"><ErpButton size="sm" onClick={() => toggleBranch(branch)} disabled={workingId !== null}>{workingId === `branch-${branch.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{branch.is_active ? 'Deactivate' : 'Activate'}</ErpButton></div></div>)}{!branches.length && <p className="col-span-full py-8 text-center text-sm text-[#7A6555]">No branches configured. The tenant market profile remains the default until branches are created.</p>}</div></div>}
      </div>
      {showRule && <Modal title="New automation rule" onClose={() => setShowRule(false)}><div className="grid gap-3 md:grid-cols-2"><Field label="Rule name"><input autoFocus value={ruleForm.rule_name} onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })} className="erp-input" placeholder="e.g. Quote follow-up 7 days before expiry" /></Field><Field label="Module"><select value={ruleForm.module} onChange={(e) => setRuleForm({ ...ruleForm, module: e.target.value })} className="erp-input">{MODULES.map((module) => <option key={module}>{module}</option>)}</select></Field><Field label="Business trigger"><select value={ruleForm.trigger_type} onChange={(e) => { const trigger_type = e.target.value; const module = trigger_type.startsWith('SERVICE_') || trigger_type === 'WARRANTY_EXPIRING' || trigger_type === 'PREVENTIVE_MAINTENANCE_DUE' ? 'SERVICE' : ruleForm.module; setRuleForm({ ...ruleForm, trigger_type, module }); }} className="erp-input">{TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Look-ahead / ageing days"><input type="number" min="0" max="365" value={ruleForm.days} onChange={(e) => setRuleForm({ ...ruleForm, days: e.target.value })} className="erp-input" /></Field><Field label="Action"><select value={ruleForm.action_type} onChange={(e) => setRuleForm({ ...ruleForm, action_type: e.target.value })} className="erp-input"><option value="NOTIFY">Create in-app notification</option><option value="CREATE_TASK">Create controlled task</option><option value="ESCALATE">Escalate to owner</option><option value="EMAIL">Email (requires email configuration)</option></select></Field><Field label="Recipients / owners"><input value={ruleForm.recipients} onChange={(e) => setRuleForm({ ...ruleForm, recipients: e.target.value })} className="erp-input" placeholder="comma-separated emails or roles" /></Field><Field label="Subject template (optional)"><input value={ruleForm.template_subject} onChange={(e) => setRuleForm({ ...ruleForm, template_subject: e.target.value })} className="erp-input" placeholder="{{document_number}} needs attention" /></Field><Field label="Message template (optional)"><input value={ruleForm.template_body} onChange={(e) => setRuleForm({ ...ruleForm, template_body: e.target.value })} className="erp-input" placeholder="Use {{document_number}}, {{customer_name}} or {{vendor_name}}" /></Field></div><p className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-900">A code is generated automatically from the rule name. New rules are disabled by default. Use Preview to verify targets before enabling. Email delivery is governed by the Email Configuration screen and remains auditable.</p><div className="mt-5 flex justify-end gap-2"><ErpButton onClick={() => setShowRule(false)}>Cancel</ErpButton><ErpButton variant="primary" onClick={createRule} disabled={workingId !== null}>{workingId === 'create-rule' && <Loader2 className="h-4 w-4 animate-spin" />}Create rule</ErpButton></div></Modal>}
      {showBranch && <Modal title="Add company / branch" onClose={() => setShowBranch(false)}><div className="grid gap-3 md:grid-cols-2"><Field label="Branch code"><input autoFocus value={branchForm.branch_code} onChange={(e) => setBranchForm({ ...branchForm, branch_code: e.target.value.toUpperCase() })} className="erp-input" placeholder="DXB-01" /></Field><Field label="Branch name"><input value={branchForm.branch_name} onChange={(e) => setBranchForm({ ...branchForm, branch_name: e.target.value })} className="erp-input" placeholder="Dubai Operations" /></Field><Field label="Market profile"><select value={branchForm.market_profile} onChange={(e) => { const uae = e.target.value === 'UAE'; setBranchForm({ ...branchForm, market_profile: e.target.value, currency_code: uae ? 'AED' : 'INR', tax_regime: uae ? 'UAE_VAT' : 'GST', timezone: uae ? 'Asia/Dubai' : 'Asia/Kolkata' }); }} className="erp-input"><option value="INDIA">India</option><option value="UAE">UAE</option></select></Field><Field label="Currency"><input value={branchForm.currency_code} onChange={(e) => setBranchForm({ ...branchForm, currency_code: e.target.value.toUpperCase() })} className="erp-input" /></Field><Field label="Tax regime"><input value={branchForm.tax_regime} onChange={(e) => setBranchForm({ ...branchForm, tax_regime: e.target.value })} className="erp-input" /></Field><Field label="Timezone"><input value={branchForm.timezone} onChange={(e) => setBranchForm({ ...branchForm, timezone: e.target.value })} className="erp-input" /></Field></div><div className="mt-5 flex justify-end gap-2"><ErpButton onClick={() => setShowBranch(false)}>Cancel</ErpButton><ErpButton variant="primary" onClick={createBranch} disabled={workingId !== null}>{workingId === 'create-branch' && <Loader2 className="h-4 w-4 animate-spin" />}Create branch</ErpButton></div></Modal>}
      <style jsx global>{`.erp-input { width: 100%; border: 1px solid #D9C9AD; border-radius: 0.375rem; padding: 0.55rem 0.7rem; font-size: 0.875rem; color: #4A3426; background: #fff; } .erp-input:focus { outline: 2px solid #C7A56D; outline-offset: 1px; }`}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold uppercase tracking-wide text-[#6F5A48]"><span className="mb-1 block">{label}</span>{children}</label>; }

function CommunicationHistoryActions({ rows, onMarkRead, busyId }: { rows: Communication[]; onMarkRead: (communication: Communication) => void; busyId: string | null }) {
  return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-[#F7F2E9] text-left text-xs uppercase text-[#7A6555]"><tr><th className="p-3">Channel</th><th className="p-3">Subject / recipient</th><th className="p-3">Module</th><th className="p-3">Status</th><th className="p-3">Time</th><th className="p-3 text-right">Action</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-[#F0E8D8]"><td className="p-3">{row.channel} <span className="text-xs text-gray-500">{row.direction}</span></td><td className="p-3"><div>{row.subject || '-'}</div><div className="text-xs text-gray-500">{row.recipient || '-'}</div></td><td className="p-3">{row.module || '-'}</td><td className="p-3"><ErpStatusBadge status={row.delivery_status} /></td><td className="p-3 text-xs text-gray-600">{new Date(row.created_at).toLocaleString()}</td><td className="p-3 text-right">{row.delivery_status === 'READ' ? <span className="text-xs font-semibold text-emerald-700">Read</span> : <ErpButton size="sm" onClick={() => onMarkRead(row)} disabled={busyId !== null}>{busyId === `communication-${row.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Mark read</ErpButton>}</td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-[#7A6555]">No audited communication records yet. Sales and service communications remain visible on their respective document trails.</td></tr>}</tbody></table></div>;
}
function AutomationTaskQueue({ rows, onUpdateStatus, onOpenSource, busyId }: { rows: AutomationTask[]; onUpdateStatus: (task: AutomationTask, status: 'IN_PROGRESS' | 'DONE' | 'CANCELLED') => void; onOpenSource: (task: AutomationTask) => void; busyId: string | null }) {
  return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-[#F7F2E9] text-left text-xs uppercase text-[#7A6555]"><tr><th className="p-3">Exception</th><th className="p-3">Module / document</th><th className="p-3">Priority</th><th className="p-3">Due</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{rows.length ? rows.map((task) => <tr key={task.id} className="border-t border-[#F0E8D8]"><td className="p-3"><div className="font-semibold text-[#4A3426]">{task.title}</div>{task.description && <div className="mt-1 max-w-xl text-xs text-[#7A6555]">{task.description}</div>}</td><td className="p-3"><div>{task.module}</div><button type="button" onClick={() => onOpenSource(task)} className="text-xs font-semibold text-[#8B6F47] hover:underline">{task.document_number || 'Open source record'}</button></td><td className="p-3"><ErpStatusBadge status={task.priority === 'CRITICAL' ? 'REJECTED' : task.priority === 'HIGH' ? 'PENDING' : 'DRAFT'} label={task.priority} /></td><td className="p-3 text-xs text-gray-600">{task.due_date || '—'}</td><td className="p-3"><ErpStatusBadge status={task.status} /></td><td className="p-3"><div className="flex justify-end gap-2"><ErpButton size="sm" onClick={() => onOpenSource(task)} disabled={busyId !== null}>Open</ErpButton>{task.status === 'OPEN' && <ErpButton size="sm" onClick={() => onUpdateStatus(task, 'IN_PROGRESS')} disabled={busyId !== null}>{busyId === `task-${task.id}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Accept</ErpButton>}{(task.status === 'OPEN' || task.status === 'IN_PROGRESS') && <><ErpButton size="sm" variant="approve" onClick={() => onUpdateStatus(task, 'DONE')} disabled={busyId !== null}>Complete</ErpButton><ErpButton size="sm" variant="danger" onClick={() => onUpdateStatus(task, 'CANCELLED')} disabled={busyId !== null}>Cancel</ErpButton></>}</div></td></tr>) : <tr><td colSpan={6} className="p-8 text-center text-[#7A6555]">No exception tasks in this view.</td></tr>}</tbody></table></div>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}><section className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-[#8B6F47]">Enterprise control</p><h2 className="text-lg font-bold text-[#4A3426]">{title}</h2></div><button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>{children}</section></div>; }
function ManagementActions({ mis }: { mis: Mis | null }) { const attention = mis?.managementAttention || []; const decisions = mis?.decisionsRequired || []; const actions = mis?.departmentActions || []; return <div className="space-y-4 p-4"><div className="rounded-md border border-[#E8DCC4] bg-[#FDF9F1] p-4"><p className="font-bold text-[#4A3426]">Management action queue</p><p className="text-xs text-[#7A6555]">Prioritized from live ERP signals. Complete each action in its source module.</p></div><div className="grid gap-4 xl:grid-cols-2"><section className="rounded-md border border-[#E8DCC4]"><h3 className="border-b border-[#E8DCC4] bg-[#F7F2E9] p-3 text-sm font-bold">Decisions required</h3>{decisions.length ? decisions.map((item, i) => <p key={i} className="border-b border-[#F0E8D8] p-3 text-sm">{i + 1}. {item}</p>) : <p className="p-4 text-sm text-emerald-700">No management decisions are currently flagged.</p>}</section><section className="rounded-md border border-[#E8DCC4]"><h3 className="border-b border-[#E8DCC4] bg-[#F7F2E9] p-3 text-sm font-bold">Risk signals</h3>{attention.length ? attention.map((item, i) => <div key={i} className="border-b border-[#F0E8D8] p-3"><p className="font-semibold text-sm">{item.issue}</p><p className="text-xs text-[#7A6555]">{item.impact}</p></div>) : <p className="p-4 text-sm text-emerald-700">No material risk signals are currently open.</p>}</section></div><section className="rounded-md border border-[#E8DCC4]"><h3 className="border-b border-[#E8DCC4] bg-[#F7F2E9] p-3 text-sm font-bold">Department action owners</h3><div className="grid gap-2 p-3 md:grid-cols-2">{actions.map((item, i) => <button type="button" key={i} onClick={() => window.location.assign(item.route)} className="flex justify-between rounded border border-[#E8DCC4] p-3 text-left hover:bg-[#FDF9F1]"><span><b className="block text-sm">{item.department}</b><span className="text-xs text-[#7A6555]">{item.action}</span></span><ChevronRight className="h-4 w-4" /></button>)}</div></section></div>; }
function RunHistory({ rows }: { rows: Run[] }) { return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-[#F7F2E9] text-left text-xs uppercase text-[#7A6555]"><tr><th className="p-3">Run</th><th className="p-3">Rule</th><th className="p-3">Mode</th><th className="p-3">Targets</th><th className="p-3">Governed actions</th><th className="p-3">Status</th><th className="p-3">Executed</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-[#F0E8D8]"><td className="p-3 font-medium">{String(row.id).slice(0, 8).toUpperCase()}</td><td className="p-3">{row.automation_rule?.rule_name || 'Automation rule'}<div className="text-xs text-gray-500">{row.automation_rule?.rule_code || '—'}</div></td><td className="p-3">{row.run_type}</td><td className="p-3">{row.target_count}</td><td className="p-3">{row.run_type === 'EXECUTE' ? <><span className="font-semibold">{row.result?.delivery?.created ?? 0} created</span><div className="text-xs text-gray-500">{row.result?.delivery?.channel || 'IN_APP'} · {row.result?.delivery?.skipped ?? 0} skipped</div></> : <span className="text-xs text-gray-500">Preview only</span>}</td><td className="p-3"><ErpStatusBadge status={row.status} /></td><td className="p-3 text-xs text-gray-600">{new Date(row.created_at).toLocaleString()}</td></tr>) : <tr><td colSpan={7} className="p-8 text-center text-[#7A6555]">No automation previews or controlled runs have been logged.</td></tr>}</tbody></table></div>; }
function CommunicationHistory({ rows }: { rows: Communication[] }) { return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-[#F7F2E9] text-left text-xs uppercase text-[#7A6555]"><tr><th className="p-3">Channel</th><th className="p-3">Subject / recipient</th><th className="p-3">Module</th><th className="p-3">Status</th><th className="p-3">Time</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-[#F0E8D8]"><td className="p-3">{row.channel} <span className="text-xs text-gray-500">{row.direction}</span></td><td className="p-3"><div>{row.subject || '—'}</div><div className="text-xs text-gray-500">{row.recipient || '—'}</div></td><td className="p-3">{row.module || '—'}</td><td className="p-3"><ErpStatusBadge status={row.delivery_status} /></td><td className="p-3 text-xs text-gray-600">{new Date(row.created_at).toLocaleString()}</td></tr>) : <tr><td colSpan={5} className="p-8 text-center text-[#7A6555]">No audited communication records yet. Sales and service communications remain visible on their respective document trails.</td></tr>}</tbody></table></div>; }
