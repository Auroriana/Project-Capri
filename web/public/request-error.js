export function requestErrorText(status,retrying=false,detail=''){
 const reason=status===413?'That request was too big for the model.':status===429?'I hit a request or token limit.':status===504?'That reply timed out.':status===401||status===403?'I couldn’t get access for that request.':status===400?'That request was rejected.':status===502||status===503?'Something failed while I was getting that reply.':'I couldn’t finish that request.';
 // Server error messages are already redacted; show the real cause so a failure is diagnosable.
 const why=typeof detail==='string'&&detail.trim()?' ('+detail.trim().replace(/\s+/g,' ').slice(0,200)+')':'';
 return reason+why+' Your progress is saved. '+(retrying?'I’ll retry shortly. You can hit Stop all to cancel.':'Use Resume reply to try again, or change my model in settings.');
}
