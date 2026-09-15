const BASE=process.env.QA_BASE_URL||'https://mizantra.saksolution.com';
if(!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE))throw new Error('Refusing outside Mizantra TEST.');
const ok=(v,m,d)=>{if(!v)throw new Error(`${m}${d===undefined?'':`\n${JSON.stringify(d,null,2)}`}`)};
async function call(path,options={}){const r=await fetch(`${BASE}${path}`,options),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}return{r,d}}
(async()=>{
 const login=await call('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.QA_USERNAME||'hnoman',password:process.env.QA_PASSWORD||'Password'})});ok(login.r.ok&&login.d.accessToken,'Login failed',login.d);const headers={authorization:`Bearer ${login.d.accessToken}`,'content-type':'application/json'};
 const items=await call('/api/v1/items?onlyVerified=true',{headers});ok(items.r.ok&&Array.isArray(items.d)&&items.d.length,'No verified QA item is available.',items.d);const item=items.d.find(x=>x.is_active!==false&&x.code&&!/\s/.test(x.code))||items.d.find(x=>x.is_active!==false&&x.code);ok(item,'No usable verified item is available.');
 const due=new Date(Date.now()+14*86400000).toISOString().slice(0,10),message=`Raise a PR for 1 nos ${item.code} required ${due} department Production reason: Active Planner native executor QA`;
 const interpreted=await call('/api/v1/active-planner/interpret',{method:'POST',headers,body:JSON.stringify({message})});ok(interpreted.r.ok&&interpreted.d.status==='READY_TO_CREATE_DRAFT','PR was not ready for native draft creation.',interpreted.d);
 let created;
 try{
  created=await call('/api/v1/active-planner/execute',{method:'POST',headers,body:JSON.stringify({context_token:interpreted.d.context_token,confirm:'CREATE DRAFT'})});ok(created.r.ok&&created.d.native_record?.id&&created.d.native_record?.status==='DRAFT','Native PR creation failed.',created.d);ok(created.d.safe_note&&created.d.route==='/dashboard/purchase/requisitions','Native PR governance response is incomplete.',created.d);
 }finally{
  const id=created?.d?.native_record?.id;if(id){const removed=await call(`/api/v1/purchase/requisitions/${id}`,{method:'DELETE',headers});ok(removed.r.ok,'QA draft PR cleanup failed.',removed.d)}
 }
 console.log(JSON.stringify({pass:true,environment:'MIZANTRA TEST ONLY',intent:interpreted.d.intent_type,status:interpreted.d.status,native_executor:'PURCHASE_REQUISITION',cleanup:'PASSED'},null,2));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
