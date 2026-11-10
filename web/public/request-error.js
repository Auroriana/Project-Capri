export function requestErrorText(status,retrying=false,detail=''){
 const reason=(status===401||status===403)?'I couldn’t get access for that request.':status===413?'That request was too big for the model.':status===429?'I hit a request or token limit.':status===504?'That reply timed out.':status===400?'That request was rejected.':status===502||status===503?'Something failed while I was getting that reply.':'I couldn’t finish that request.';
 // The server returns the specific upstream failure (which provider/model,
 // which HTTP status); a short quoted reason turns the dead-end message into
 // something the owner can act on.
 const clean=String(detail||'').replace(/\s+/g,' ').trim().replace(/[.。]+$/,'');
 const why=clean&&clean!=='Request failed.'?' Reason: '+clean.slice(0,220):'';
 return reason+why+'. Your progress is saved. '+(retrying?'I’ll retry shortly. You can hit Stop all to cancel.':'Use Resume reply to try again, or change my model in settings.');
}
