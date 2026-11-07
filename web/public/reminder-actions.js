export const ALERT_WINDOW_MS=15*60*1000;
export function freshReminder(due,now=Date.now()){
 const time=typeof due==='number'?due:Date.parse(due);
 return Number.isFinite(time)&&time<=now&&now-time<=ALERT_WINDOW_MS;
}
export function completionIntent(text){
 const input=String(text).trim().replace(/^(?:hey\s+)?capri[,!]?\s*/i,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,'').replace(/[.!]+$/,'');
 if(/^(?:that reminder is done|i(?:'ve| have) done (?:that|the) reminder|mark (?:that|this|it) (?:reminder )?(?:as )?done)$/i.test(input))return {reference:true};
 const match=input.match(/^i(?:'m| am) done with (?:the )?(.+?) reminder$/i)||input.match(/^(?:mark|set) (?:the )?(.+?) reminder (?:as )?(?:done|complete|completed)$/i)||input.match(/^(?:complete|finish) (?:the )?(.+?) reminder$/i)||input.match(/^i(?:'ve| have) (?:done|finished|completed) (?:the )?(.+?) reminder$/i);
 return match?{query:match[1].trim()}:null;
}
export function matchingReminders(reminders,query){
 const words=String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
 return words.length?reminders.filter(r=>!r.completed_at&&words.every(word=>String(r.text).toLowerCase().includes(word))):[];
}
export const reminderId=message=>typeof message?.reminder==='string'?message.reminder:message?.reminder?.id;
