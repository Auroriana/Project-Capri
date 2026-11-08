import {AsyncLocalStorage} from 'node:async_hooks';import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
const context=new AsyncLocalStorage(),names=['groq','nim','deepseek','openrouter','anthropic','zai'];
const encryptionKey=()=>{const secret=process.env.PROVIDER_CREDENTIAL_SECRET||process.env.GEMINI_API_KEY;if(!secret)throw Object.assign(Error('Server credential encryption is not configured.'),{status:503});return createHash('sha256').update(secret).digest();};
export const credential=provider=>context.getStore()?.[provider];
export function sealCredential(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv),data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function openCredential(token){const b=Buffer.from(token,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));const value=JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]));if(value.owner!==process.env.OWNER_USER_ID||value.expires<Date.now())throw Error('Expired credential');return value;}
export function withProviderCredentials(req,work){const values={};for(const provider of names){const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('capri_key_'+provider+'='))?.split('=')[1];if(raw)try{values[provider]=openCredential(raw);}catch{}}return context.run(values,work);}
export function saveProviderCredential(req,res,body,owner){
 const {provider,key,freeAccess}=body;if(!names.includes(provider)||typeof key!=='string'||key.length>1024||/[\s\x00-\x1f]/.test(key))throw Object.assign(Error('Invalid provider credential.'),{status:400});
 const value=key?sealCredential({key,freeAccess:freeAccess===true,owner,expires:Date.now()+30*86400000}):'';
 res.setHeader('Set-Cookie','capri_key_'+provider+'='+value+'; Path=/api; HttpOnly; SameSite=Strict; Max-Age='+(key?30*86400:0)+(process.env.VERCEL||req.headers['x-forwarded-proto']==='https'?'; Secure':''));
}
