// Keep full evidence intact. Oversized Groq stages move to the configured Gemini
// path; they are never shortened or split into lossy summaries.
export function exceedsGroqBudget(id,request){
 if(!id.startsWith('groq:'))return false;
 const configured=Number(process.env.GROQ_REQUEST_TOKEN_BUDGET);
 const budget=Number.isFinite(configured)&&configured>0?configured:7000;
 // Conservative byte estimate, including output room and protocol overhead.
 return Math.ceil(Buffer.byteLength(JSON.stringify(request))/3)+(request.generationConfig?.maxOutputTokens||4096)+256>budget;
}
export async function generateWithOverflow(id,request,{generate,fallback,onFallback=()=>{}}){
 const overflow=async()=>{if(!fallback)throw Object.assign(Error('This stage exceeds the Groq request budget. Choose Gemini for all stages, or configure the Gemini overflow model. Context was preserved.'),{status:413});onFallback();return fallback(request);};
 if(exceedsGroqBudget(id,request))return overflow();
 try{return {...await generate(id,request),modelUsed:id};}
 catch(error){if(!id.startsWith('groq:')||error.status!==413)throw error;return overflow();}
}
