// Browser capture helpers for the free multimodal chain. Voice recordings go
// to /api/transcribe (Groq whisper, NIM Omni fallback); camera/screen
// snapshots become JPEG frames that ride the normal image attachment path.
const JPEG_MAX = 1600; // match the attachment shrinker so sizes stay comparable
const VOICE_MAX_MS = 240000; // auto-stop at 4 min; 24 kbps keeps it far under the body cap
async function frameToJpeg(video) {
  const k = Math.min(1, JPEG_MAX / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', .85));
  video.srcObject.getTracks().forEach(t => t.stop());
  return blob;
}
async function frameFromStream(stream) {
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  await new Promise(ok => setTimeout(ok, 350)); // let exposure settle
  try { return await frameToJpeg(video); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
}
export function captureSupported() { return !!navigator.mediaDevices?.getUserMedia; }
export async function snapshotCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 } }, audio: false });
  return frameFromStream(stream);
}
export async function snapshotScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  return frameFromStream(stream);
}
export function voiceSupported() {
  return typeof window.MediaRecorder === 'function' && captureSupported();
}
// Returns {stop(): Promise<{mime, data}>}; data is base64 without the data: prefix.
export async function recordVoice() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  let stopped;
  const done = new Promise(ok => {
    stopped = () => { stream.getTracks().forEach(t => t.stop()); ok(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
    rec.onstop = stopped;
  });
  rec.start(250);
  const timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, VOICE_MAX_MS);
  return {
    stop() {
      clearTimeout(timer);
      if (rec.state === 'inactive') return done.then(blob => toPayload(blob));
      rec.stop();
      return done.then(blob => toPayload(blob));
    }
  };
}
async function toPayload(blob) {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const r = new FileReader();
  const data = await new Promise((ok, no) => { r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
  return { mime, data };
}
