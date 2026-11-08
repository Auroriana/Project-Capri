import {estimateText} from './token-usage.js';
export function capHistory(history,maxTokens=3000){
 maxTokens=Number.isInteger(maxTokens)?Math.max(256,Math.min(12000,maxTokens)):3000;
 const out=[];let used=0;
 for(const m of [...history].reverse()){
  const cost=estimateText(JSON.stringify(m));if(used+cost>maxTokens)break;
  out.unshift(m);used+=cost;
 }return out;
}
export function recentExchange(history){
 const end=history.findLastIndex(m=>m.role==='model');if(end<0)return history.slice(-1);
 const user=history.slice(0,end).findLast(m=>m.role==='user');return [...(user?[user]:[]),history[end]];
}
