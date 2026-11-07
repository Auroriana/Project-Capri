const failures=new Map(),prefix='Runtime status (server supplied): ';
export function rememberFailure(owner,{status,model,phase}){
 if(!owner)return;
 failures.delete(owner);failures.set(owner,{status:Number(status)||500,model,phase,at:Date.now()});
 if(failures.size>512)failures.delete(failures.keys().next().value);
}
export function withRuntime(request,{owner,model,phase,settings={},fallbackFrom}){
 const error=failures.get(owner);
 const state={model,phase,...(fallbackFrom?{fallbackFrom}:{}),selectedModels:{router:settings.router||settings.personality,reasoning:settings.reasoning,analyzing:settings.analyzing,personality:settings.personality},settings:{web:settings.web,additionalMemory:settings.memory,council:settings.councilEnabled},...(error&&Date.now()-error.at<30*60*1000?{lastRequestFailure:error}:{})};
 const parts=(request.systemInstruction?.parts||[]).filter(p=>!p.text?.startsWith(prefix));
 return {...request,systemInstruction:{parts:[...parts,{text:prefix+JSON.stringify(state)+'\nUse this to answer questions about your configuration. Mention failures naturally when relevant, not on every reply. This is a limited snapshot, not access to logs, secrets, screen contents, provider account usage or hidden reasoning. HTTP status alone does not establish the cause. Selected models may differ from the model serving this call.'}]}};
}
