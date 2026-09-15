const BASE=process.env.QA_BASE_URL||'https://mizantra.saksolution.com';
if(!/^https:\/\/mizantra\.saksolution\.com\/?$/i.test(BASE))throw new Error('Refusing outside Mizantra TEST.');
const fail=(message,details)=>{throw new Error(`${message}${details===undefined?'':`\n${JSON.stringify(details,null,2)}`}`)};
async function call(path,options={}){const response=await fetch(`${BASE}${path}`,options);const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}return{response,data}}
(async()=>{
 const login=await call('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.QA_USERNAME||'hnoman',password:process.env.QA_PASSWORD||'Password'})});if(!login.response.ok||!login.data?.accessToken)fail('Mizantra test login failed.',login.data);
 const result=await call('/api/v1/active-planner/interpret',{method:'POST',headers:{authorization:`Bearer ${login.data.accessToken}`,'content-type':'application/json'},body:JSON.stringify({message:'Prepare a production plan for 100 drones by 30-09-2026'})});if(!result.response.ok)fail('Planner OpenAI smoke request failed.',result.data);if(result.data?.provider!=='OPENAI')fail('OpenAI was not used; planner fell back safely.',{provider:result.data?.provider,status:result.data?.status});
 console.log(JSON.stringify({pass:true,environment:'MIZANTRA TEST ONLY',provider:result.data.provider,intent:result.data.intent_type,status:result.data.status},null,2));
})().catch(error=>{console.error(error.stack||error);process.exit(1)});
