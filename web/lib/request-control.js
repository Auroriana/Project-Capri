import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage(),active=new Map();
export const withRequest=(controller,run)=>context.run(controller,run);
export function registerRequest(owner,controller){
 const jobs=active.get(owner)||new Set();active.set(owner,jobs);jobs.add(controller);
 return ()=>{jobs.delete(controller);if(!jobs.size)active.delete(owner);};
}
export function stopRequests(owner){const jobs=active.get(owner);let stopped=0;for(const controller of jobs||[]){controller.abort(new DOMException('Stopped by you.','AbortError'));stopped++;}return stopped;}
export function checkRequest(){context.getStore()?.signal.throwIfAborted();}
export function requestFetch(url,options={}){
 const signal=context.getStore()?.signal;signal?.throwIfAborted();
 return globalThis.fetch(url,{...options,...(signal?{signal:options.signal?AbortSignal.any([signal,options.signal]):signal}:{})});
}
