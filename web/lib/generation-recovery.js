// JSON responses must be regenerated whole; prose can continue from its last token.
// Each attempt still goes through the caller's quota reservation and usage accounting.
export async function completeGeneration(request,generate,{attempts=3,json=false}={}){
 let current=request,result,answer='';
 for(let attempt=0;attempt<attempts;attempt++){
  result=await generate(current);answer=json?result.answer:answer+result.answer;
  if(!result.truncated)return {...result,answer};
  if(json||!answer.trim())current={...request,generationConfig:{...request.generationConfig,maxOutputTokens:Math.min(16384,(current.generationConfig?.maxOutputTokens||2048)*2)}};
  else current={...request,contents:[...request.contents,{role:'model',parts:[{text:answer}]},{role:'user',parts:[{text:'Continue exactly where the previous response stopped. Output only the continuation, without repeating earlier text. Preserve source IDs. Finish the remaining requested tasks.'}]}]};
 }
 throw Object.assign(Error('The reply still reached its output limit. Progress is saved for retry.'),{status:503});
}
