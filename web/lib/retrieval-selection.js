// Cheap, deterministic ranking before any model reads retrieved text.
const stop=new Set('a an the and or to of for in on my me i you your it is are was were this that please help find search retrieve look inside through with from about'.split(' '));
const words=text=>[...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>!stop.has(w)&&w.length>1))];
export function selectPassages(rows,query,{limit=6,characters=18000}={}){
 const terms=words(query),seen=new Set(),reranked=rows.length>0&&rows.every(r=>Number.isFinite(r.rerankScore));
 const ranked=rows.map((row,index)=>{
  const title=String(row.title||'').toLowerCase(),body=String(row.content||'').toLowerCase();
  const matches=terms.filter(w=>title.includes(w)||body.includes(w)).length;
  return {...row,relevance:matches*10+terms.filter(w=>title.includes(w)).length*2,index};
 }).sort((a,b)=>(reranked?b.rerankScore-a.rerankScore:0)||b.relevance-a.relevance||Number(b.score||0)-Number(a.score||0)||a.index-b.index);
 const best=ranked[0]?.relevance||0;let used=0;
 return ranked.filter(row=>{
  const key=row.id??[row.vault_name,row.source_path,row.content].join('\0');
  if(seen.has(key)||!row.content||used+row.content.length>characters||(!reranked&&best&&row.relevance<Math.max(10,best*.5)))return false;
  seen.add(key);used+=row.content.length;return true;
 }).slice(0,limit).map(({index,...row})=>row);
}
