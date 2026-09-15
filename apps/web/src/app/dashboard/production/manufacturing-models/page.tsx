"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, Trash2 } from "lucide-react";
import SearchableSelect from "../../../../components/SearchableSelect";
import { apiClient } from "../../../../../lib/api-client";

const field = "w-full rounded-lg border border-[#D9C8AA] bg-white px-3 py-2 text-sm";
const label = "block text-xs font-semibold text-[#5E4635]";
type Rule = { attribute: string; operator: string; min: string; max: string; value: string };
type Resource = { id: string; name: string; source: string; basis: string; value: string; units: string; parallel: string; efficiency: string; weight: string; setup: string; rules: Rule[] };
type Stage = { id: string; name: string; predecessors: string; transfer: string; resources: Resource[] };
const blankResource = (): Resource => ({ id: "", name: "", source: "IN_HOUSE", basis: "UNITS_PER_MINUTE", value: "", units: "1", parallel: "1", efficiency: "100", weight: "piece_weight_g", setup: "0", rules: [] });
const blankStage = (): Stage => ({ id: "", name: "", predecessors: "", transfer: "", resources: [blankResource()] });
const split = (value: string) => value.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

export default function ManufacturingModelsPage() {
  const [data, setData] = useState<any>({ items: [], manufacturing_models: [] });
  const [itemId, setItemId] = useState("");
  const [attributes, setAttributes] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [stages, setStages] = useState<Stage[]>([blankStage()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await apiClient.get("/production-planning/masters")); }
    catch (e: any) { setMessage(e?.message || "Unable to load manufacturing models."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const itemMap = useMemo(
    () => new Map<string, any>((data.items || []).map((x: any) => [String(x.id), x])),
    [data.items],
  );
  const patchStage = (index: number, patch: Partial<Stage>) => setStages((current) => current.map((stage, i) => i === index ? { ...stage, ...patch } : stage));
  const patchResource = (stageIndex: number, resourceIndex: number, patch: Partial<Resource>) => setStages((current) => current.map((stage, i) => i !== stageIndex ? stage : { ...stage, resources: stage.resources.map((resource, j) => j === resourceIndex ? { ...resource, ...patch } : resource) }));
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const raw: any = Object.fromEntries(new FormData(event.currentTarget));
      const values: Record<string, any> = {};
      for (const attribute of attributes) if (attribute.key.trim()) {
        const parsed = Number(attribute.value);
        values[attribute.key.trim()] = attribute.value.trim() !== "" && Number.isFinite(parsed) ? parsed : attribute.value.trim();
      }
      const configuration = {
        attributes: values,
        planning: { preferred_wave_quantity: Number(raw.preferred_wave_quantity || 0) || undefined, maximum_wave_count: Number(raw.maximum_wave_count || 12), transfer_batch_quantity: Number(raw.transfer_batch_quantity || 0) || undefined },
        stages: stages.map((stage) => ({
          id: stage.id.trim(), name: stage.name.trim(), predecessors: split(stage.predecessors), transfer_batch_quantity: Number(stage.transfer || 0) || undefined,
          resources: stage.resources.map((resource) => ({
            id: resource.id.trim(), name: resource.name.trim(), source: resource.source,
            setup_minutes: Number(resource.setup || 0),
            rate: { basis: resource.basis, value: Number(resource.value), units_per_cycle: Number(resource.units || 1), parallel_units: Number(resource.parallel || 1), efficiency_pct: Number(resource.efficiency || 100), piece_weight_attribute: resource.weight || undefined },
            capability_rules: resource.rules.filter((rule) => rule.attribute.trim()).map((rule) => ({ attribute: rule.attribute.trim(), operator: rule.operator, value: rule.value || undefined, min: rule.min === "" ? undefined : Number(rule.min), max: rule.max === "" ? undefined : Number(rule.max), values: rule.operator === "IN" ? split(rule.value) : undefined })),
          })),
        })),
      };
      const result: any = await apiClient.post("/production-planning/configuration/manufacturing-models", { model_code: raw.model_code, model_name: raw.model_name, version: Number(raw.version || 1), finished_item_id: itemId, notes: raw.notes, configuration });
      setMessage(`${result.model_code} version ${result.version} saved as DRAFT. Test it, then activate it for automatic planning.`);
      await load();
    } catch (e: any) { setMessage(e?.message || "Unable to save manufacturing model."); }
    finally { setBusy(false); }
  };
  const activate = async (id: string) => {
    if (!confirm("Activate this model for automatic production planning? The previous active version will be retired.")) return;
    setBusy(true);
    try { await apiClient.patch(`/production-planning/configuration/manufacturing-models/${id}/activate`, {}); setMessage("Manufacturing model activated."); await load(); }
    catch (e: any) { setMessage(e?.message || "Unable to activate model."); }
    finally { setBusy(false); }
  };
  const test = async (id: string) => {
    const quantity = Number(prompt("Test quantity", "1000") || 0); if (!quantity) return;
    const today = new Date().toISOString().slice(0, 10), due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    try { const result: any = await apiClient.post(`/production-planning/configuration/manufacturing-models/${id}/evaluate`, { quantity, start_date: today, due_date: due }); setMessage(result.feasible ? `Test passed. ${result.stages.length} stages evaluated; bottleneck: ${result.bottleneck_stage_name || "none"}; ${result.recommended_waves.length} wave(s) recommended.` : "Test failed: one or more stages have no eligible machine."); }
    catch (e: any) { setMessage(e?.message || "Unable to test model."); }
  };
  return <main className="mx-auto max-w-[1500px] space-y-5 p-3 sm:p-5">
    <header className="rounded-2xl bg-gradient-to-r from-[#4A3526] to-[#8B6844] p-6 text-white">
      <div className="flex justify-between gap-4"><div><p className="text-sm text-amber-100">Reusable production intelligence</p><h1 className="mt-1 text-2xl font-bold">Manufacturing Models</h1><p className="mt-2 max-w-4xl text-sm text-amber-50">Define each product&apos;s attributes, stage sequence, parallel branches, compatible machines, speeds, cavities, batch conversion and outsourcing choices once. Planners then enter only demand and due date.</p></div><button onClick={load} aria-label="Refresh" className="h-fit rounded border border-white/40 p-2"><RefreshCw className={busy ? "animate-spin" : ""}/></button></div>
    </header>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{message}</div>}
    <form onSubmit={save} className="space-y-5 rounded-xl border border-[#E6D8C0] bg-[#FFFCF7] p-4">
      <div><h2 className="font-semibold">New model version</h2><p className="text-xs text-slate-500">A draft cannot affect a plan until an approver activates it.</p></div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className={label}>Finished item *<input type="hidden" name="finished_item_id" value={itemId}/><SearchableSelect options={(data.items || []).map((x:any)=>({value:String(x.id),label:x.code,subtitle:`${x.name} · ${x.uom}`}))} value={itemId} onChange={setItemId} placeholder="Search finished item..." className="mt-1" required/></label>
        <label className={label}>Model code *<input required name="model_code" placeholder="Example: SCREW-8X80" className={`${field} mt-1`}/></label>
        <label className={label}>Model name *<input required name="model_name" placeholder="Example: 8x80 screw + plug" className={`${field} mt-1`}/></label>
        <label className={label}>Version *<input required name="version" type="number" min="1" defaultValue="1" className={`${field} mt-1`}/></label>
        <label className={label}>Preferred wave quantity<input name="preferred_wave_quantity" type="number" min="0" step="0.0001" className={`${field} mt-1`}/></label>
        <label className={label}>Maximum waves<input name="maximum_wave_count" type="number" min="1" max="100" defaultValue="12" className={`${field} mt-1`}/></label>
        <label className={label}>Default transfer batch<input name="transfer_batch_quantity" type="number" min="0" step="0.0001" className={`${field} mt-1`}/></label>
        <label className={label}>Notes<input name="notes" placeholder="Purpose / approval evidence" className={`${field} mt-1`}/></label>
      </div>
      <section className="rounded-lg border bg-white p-3"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Product attributes</h3><p className="text-xs text-slate-500">Use any client-specific measurements: length_mm, diameter_mm, resin, piece_weight_g, grade, colour, etc.</p></div><button type="button" onClick={()=>setAttributes((x)=>[...x,{key:"",value:""}])} className="rounded border px-3 py-2 text-sm"><Plus size={14} className="inline"/> Attribute</button></div>
        <div className="grid gap-2 md:grid-cols-2">{attributes.map((attribute,index)=><div key={index} className="flex gap-2"><input aria-label={`Attribute ${index+1} name`} value={attribute.key} onChange={(e)=>setAttributes((x)=>x.map((a,i)=>i===index?{...a,key:e.target.value}:a))} placeholder="Attribute name" className={field}/><input aria-label={`Attribute ${index+1} value`} value={attribute.value} onChange={(e)=>setAttributes((x)=>x.map((a,i)=>i===index?{...a,value:e.target.value}:a))} placeholder="Value" className={field}/><button type="button" aria-label="Remove attribute" onClick={()=>setAttributes((x)=>x.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>)}</div>
      </section>
      <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Stages and machine choices</h3><p className="text-xs text-slate-500">Predecessors create sequential, parallel and merge flows. Add every eligible in-house or subcontract resource.</p></div><button type="button" onClick={()=>setStages((x)=>[...x,blankStage()])} className="rounded border px-3 py-2 text-sm"><Plus size={14} className="inline"/> Stage</button></div>
        {stages.map((stage,stageIndex)=><article key={stageIndex} className="space-y-3 rounded-lg border bg-white p-3"><div className="grid gap-2 md:grid-cols-4"><label className={label}>Stage ID *<input required value={stage.id} onChange={(e)=>patchStage(stageIndex,{id:e.target.value})} placeholder="blank_cutting" className={`${field} mt-1`}/></label><label className={label}>Stage name *<input required value={stage.name} onChange={(e)=>patchStage(stageIndex,{name:e.target.value})} placeholder="Blank cutting" className={`${field} mt-1`}/></label><label className={label}>Predecessor stage IDs<input value={stage.predecessors} onChange={(e)=>patchStage(stageIndex,{predecessors:e.target.value})} placeholder="Comma-separated; blank = first" className={`${field} mt-1`}/></label><label className={label}>Transfer batch<input type="number" min="0" value={stage.transfer} onChange={(e)=>patchStage(stageIndex,{transfer:e.target.value})} className={`${field} mt-1`}/></label></div>
          {stage.resources.map((resource,resourceIndex)=><div key={resourceIndex} className="space-y-2 rounded-lg bg-slate-50 p-3"><div className="grid gap-2 md:grid-cols-5"><label className={label}>Machine/resource ID *<input required value={resource.id} onChange={(e)=>patchResource(stageIndex,resourceIndex,{id:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Name *<input required value={resource.name} onChange={(e)=>patchResource(stageIndex,resourceIndex,{name:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Source<select value={resource.source} onChange={(e)=>patchResource(stageIndex,resourceIndex,{source:e.target.value})} className={`${field} mt-1`}><option>IN_HOUSE</option><option>SUBCONTRACT</option></select></label><label className={label}>Rate basis<select value={resource.basis} onChange={(e)=>patchResource(stageIndex,resourceIndex,{basis:e.target.value})} className={`${field} mt-1`}><option>UNITS_PER_MINUTE</option><option>SHOTS_PER_MINUTE</option><option>KG_PER_HOUR</option><option>BATCHES_PER_HOUR</option></select></label><label className={label}>Rate *<input required type="number" min="0.000001" step="any" value={resource.value} onChange={(e)=>patchResource(stageIndex,resourceIndex,{value:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Units/cavities per cycle<input type="number" min="0" step="any" value={resource.units} onChange={(e)=>patchResource(stageIndex,resourceIndex,{units:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Parallel units/barrels<input type="number" min="1" value={resource.parallel} onChange={(e)=>patchResource(stageIndex,resourceIndex,{parallel:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Efficiency %<input type="number" min="1" max="150" value={resource.efficiency} onChange={(e)=>patchResource(stageIndex,resourceIndex,{efficiency:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Piece-weight attribute<input value={resource.weight} onChange={(e)=>patchResource(stageIndex,resourceIndex,{weight:e.target.value})} className={`${field} mt-1`}/></label><label className={label}>Setup/changeover minutes<input type="number" min="0" value={resource.setup} onChange={(e)=>patchResource(stageIndex,resourceIndex,{setup:e.target.value})} className={`${field} mt-1`}/></label></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>patchResource(stageIndex,resourceIndex,{rules:[...resource.rules,{attribute:"",operator:"BETWEEN",min:"",max:"",value:""}]})} className="rounded border px-2 py-1 text-xs"><Plus size={12} className="inline"/> Capability rule</button><button type="button" onClick={()=>patchStage(stageIndex,{resources:stage.resources.filter((_,i)=>i!==resourceIndex)})} className="rounded border px-2 py-1 text-xs text-red-700">Remove machine</button></div>
            {resource.rules.map((rule,ruleIndex)=><div key={ruleIndex} className="grid gap-2 md:grid-cols-6"><input aria-label="Capability attribute" value={rule.attribute} onChange={(e)=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.map((r,i)=>i===ruleIndex?{...r,attribute:e.target.value}:r)})} placeholder="Attribute" className={field}/><select aria-label="Capability operator" value={rule.operator} onChange={(e)=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.map((r,i)=>i===ruleIndex?{...r,operator:e.target.value}:r)})} className={field}><option>BETWEEN</option><option>MIN</option><option>MAX</option><option>EQ</option><option>NE</option><option>IN</option></select><input aria-label="Minimum" value={rule.min} onChange={(e)=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.map((r,i)=>i===ruleIndex?{...r,min:e.target.value}:r)})} placeholder="Min" className={field}/><input aria-label="Maximum" value={rule.max} onChange={(e)=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.map((r,i)=>i===ruleIndex?{...r,max:e.target.value}:r)})} placeholder="Max" className={field}/><input aria-label="Value or list" value={rule.value} onChange={(e)=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.map((r,i)=>i===ruleIndex?{...r,value:e.target.value}:r)})} placeholder="Value / list" className={field}/><button type="button" onClick={()=>patchResource(stageIndex,resourceIndex,{rules:resource.rules.filter((_,i)=>i!==ruleIndex)})} aria-label="Remove capability rule"><Trash2 size={16}/></button></div>)}
          </div>)}
          <div className="flex gap-2"><button type="button" onClick={()=>patchStage(stageIndex,{resources:[...stage.resources,blankResource()]})} className="rounded border px-3 py-2 text-sm"><Plus size={14} className="inline"/> Machine choice</button><button type="button" onClick={()=>setStages((x)=>x.filter((_,i)=>i!==stageIndex))} className="rounded border px-3 py-2 text-sm text-red-700"><Trash2 size={14} className="inline"/> Remove stage</button></div>
        </article>)}
      </section>
      <button disabled={busy || !itemId} className="rounded bg-[#4A3526] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save draft model</button>
    </form>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Model versions</h2><div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Model</th><th className="p-2">Finished item</th><th className="p-2">Version</th><th className="p-2">Stages</th><th className="p-2">Status</th><th className="p-2">Actions</th></tr></thead><tbody>{(data.manufacturing_models || []).map((model:any)=><tr key={model.id} className="border-b"><td className="p-2"><b>{model.model_code}</b><small className="block text-slate-500">{model.model_name}</small></td><td className="p-2">{itemMap.get(String(model.finished_item_id))?.code || model.finished_item_id}</td><td className="p-2">{model.version}</td><td className="p-2">{model.configuration?.stages?.length || 0}</td><td className="p-2"><span className={model.status === "ACTIVE" ? "text-emerald-700" : "text-slate-600"}>{model.status === "ACTIVE" && <CheckCircle2 size={14} className="mr-1 inline"/>}{model.status}</span></td><td className="p-2"><div className="flex gap-2"><button type="button" onClick={()=>test(model.id)} className="rounded border px-3 py-1">Test</button>{model.status !== "ACTIVE" && <button type="button" onClick={()=>activate(model.id)} className="rounded border px-3 py-1">Activate</button>}</div></td></tr>)}</tbody></table>{!(data.manufacturing_models || []).length && <p className="py-5 text-sm text-slate-500">No manufacturing models yet.</p>}</div></section>
  </main>;
}
