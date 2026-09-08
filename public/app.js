import {Painter} from './painter.js';
import {captionAt} from './captions.js';
const $=id=>document.getElementById(id);
const painter=new Painter($('painting'),$('cursor'));
let manifest=null,buffers=[],context=null,source=null,startAt=0,offset=0,total=0,playing=false,frame=0,countTimer=0,photoLoaded=false,ready=false;
let voiceGain,noiseGain,brushGain,noiseSource,brushSource,masterGain,noiseStarted=false,studioView=false,runId=0,muted=false;
let narration={status:'loading',completed:0,total:8},audioPromise=null,photoURL=null,imageVersion=0,exportBlob=null,exportVersion=0;
const starts=[];
const time=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const fail=e=>{$('status').textContent=e.message||String(e);console.error(e);};
async function photoStore(file,forget=false){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('painting-studio',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('photos',file||forget?'readwrite':'readonly');const store=tx.objectStore('photos');const request=forget?store.delete('reference'):file?store.put(file,'reference'):store.get('reference');tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
function clock(){return playing?Math.max(0,Math.min(total,context.currentTime-startAt)):offset;}
function audioGraph(){
  if(context)return;
  context=new AudioContext();
  const compressor=context.createDynamicsCompressor();compressor.threshold.value=-15;compressor.ratio.value=2;
  masterGain=context.createGain();masterGain.gain.value=muted?0:1;compressor.connect(masterGain);masterGain.connect(context.destination);
  const low=context.createBiquadFilter();low.type='lowpass';low.frequency.value=6800;low.Q.value=.4;
  const high=context.createBiquadFilter();high.type='highpass';high.frequency.value=85;
  voiceGain=context.createGain();voiceGain.gain.value=.95;voiceGain.connect(high);high.connect(low);low.connect(compressor);
  // A low, filtered bed of tape hiss. No prerecorded sound assets.
  const noise=context.createBuffer(1,context.sampleRate*4,context.sampleRate),array=noise.getChannelData(0);let last=0;
  for(let i=0;i<array.length;i++){const white=Math.random()*2-1;last=.96*last+.04*white;array[i]=last*4;}
  noiseSource=context.createBufferSource();noiseSource.buffer=noise;noiseSource.loop=true;
  const tape=context.createBiquadFilter();tape.type='highpass';tape.frequency.value=900;
  noiseGain=context.createGain();noiseGain.gain.value=0;noiseSource.connect(tape);tape.connect(noiseGain);noiseGain.connect(compressor);
  brushSource=context.createBufferSource();brushSource.buffer=noise;brushSource.loop=true;
  const brush=context.createBiquadFilter();brush.type='bandpass';brush.frequency.value=1900;brush.Q.value=.65;
  brushGain=context.createGain();brushGain.gain.value=0;brushSource.connect(brush);brush.connect(brushGain);brushGain.connect(compressor);
}
async function prepareAudio(){
  if(!manifest)return;
  narration={...narration,status:'loading'};updateReady();
  audioGraph();
  if(!Array.isArray(manifest.chapters)||manifest.chapters.length!==8)throw new Error('The narration is incomplete. Please retry.');
  let loaded=0;
  buffers=await Promise.all(manifest.chapters.map(async c=>{const r=await fetch(c.audio,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Narration could not load. Please retry.');const b=await context.decodeAudioData(await r.arrayBuffer());narration.completed=++loaded;updateReady();return b;}));
  starts.length=0;total=0;
  buffers.forEach((b,i)=>{starts.push(total);manifest.chapters[i].duration=b.duration;total+=b.duration+2;});
  $('duration').textContent=time(total);ready=true;narration.status='complete';updateReady();
}
function updateReady(){
  const ok=ready&&photoLoaded,busy=narration.status==='loading';
  $('play').disabled=!photoLoaded||(!ready&&busy);$('scrub').disabled=!ok;
  if(!ready){$('play').textContent=busy?'Loading voice…':'Retry voice';$('duration').textContent=busy?`${narration.completed||0} / 8`:'Voice unavailable';}
  else if(!playing&&offset===0)$('play').textContent='Begin painting ↗';
  $('status').textContent=ok?'Ready when you are · Space to start or pause':narration.status==='failed'?`Voice couldn't load. ${narration.error||'Please retry.'}`:!photoLoaded?'Choose a photo to begin.':`Loading Bob's voice · ${narration.completed||0} of 8 chapters`;
}
function narrationFailed(e){narration={...narration,status:'failed',error:e.message||String(e)};updateReady();console.error(e);}
async function loadNarration(){
  if(audioPromise)return audioPromise;
  narration={status:'loading',completed:0,total:8};updateReady();
  audioPromise=(async()=>{const r=await fetch('/narration.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Please check your connection and try again.');manifest=await r.json();await prepareAudio();})().catch(narrationFailed).finally(()=>{audioPromise=null;});
  return audioPromise;
}
async function setImage(url){
  const version=++imageVersion;
  const img=new Image();img.src=url;await img.decode();if(version!==imageVersion)return;reset();
  if(img.naturalWidth<10||img.naturalHeight<10)throw new Error('Please choose a larger photo.');
  const ratio=img.naturalWidth/img.naturalHeight;
  if(ratio>5||ratio<.2)throw new Error('Please crop this panoramic image to an aspect ratio between 1:5 and 5:1.');
  $('status').textContent='Mixing the colours…';
  await new Promise(r=>requestAnimationFrame(r));
  const size=painter.load(img);$('canvasWrap').style.aspectRatio=`${size.width}/${size.height}`;
  $('empty').hidden=true;$('referenceImage').src=url;$('referenceCard').hidden=false;
  if(photoURL?.startsWith('blob:')&&photoURL!==url)URL.revokeObjectURL(photoURL);photoURL=url;
  photoLoaded=true;updateReady();sizeReference();
}
$('photo').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;if(file.size>25*1024*1024){fail(new Error('Please choose a photo smaller than 25 MB.'));return;}if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)){fail(new Error('Please choose a JPG, PNG, WebP or AVIF photo.'));return;}const url=URL.createObjectURL(file);try{await setImage(url);try{await photoStore(file);}catch{ $('status').textContent='Photo ready. This browser cannot remember it after a refresh.';}}catch(e){URL.revokeObjectURL(url);fail(e);}e.target.value='';});
$('changePhoto').addEventListener('click',()=>$('photo').click());
function sizeReference(){const easel=$('easel'),wrap=$('canvasWrap'),ratio=$('painting').width/$('painting').height;const canvasWidth=Math.min(easel.clientWidth,easel.clientHeight*ratio);wrap.style.width=`${canvasWidth}px`;wrap.style.height=`${canvasWidth/ratio}px`;const gap=(easel.clientWidth-canvasWidth)/2;const width=Math.max(96,Math.min(240,gap-24));$('referenceCard').style.setProperty('--reference-width',`${width}px`);}
new ResizeObserver(sizeReference).observe($('easel'));
function position(t){let i=starts.length-1;while(i>0&&t<starts[i])i--;return {i,local:Math.max(0,t-starts[i])};}
function render(t,active=true){
  if(!ready||!manifest||!photoLoaded)return;
  const {i,local}=position(t),chapter=manifest.chapters[i];
  const p=Math.min(1,Math.max(0,(local-.6)/(chapter.duration+.8)));
  painter.draw(i,p,active);
  $('stage').textContent=chapter.title.toUpperCase();$('counter').textContent=`${String(i+1).padStart(2,'0')} / ${String(manifest.chapters.length).padStart(2,'0')}`;
  $('paintLabel').textContent=chapter.paint;$('elapsed').textContent=time(t);$('scrub').value=total?t/total*1000:0;
  $('caption').textContent=captionAt(chapter.words||[],local);
  showResult(t>=total-.05);
  if(active&&brushGain){const audible=p>.015&&p<.99;const wave=.5+.5*Math.sin(local*5.4);brushGain.gain.setTargetAtTime(audible?.020*wave*wave:0,context.currentTime,.055);}
}
function schedule(){
  const t=clock();render(t);if(t>=total){pause();offset=total;render(total,false);$('play').textContent='Paint again ↗';$('status').textContent='Finished · Press Restart for a fresh canvas';return;}frame=requestAnimationFrame(schedule);
}
function stopSources(){if(source){for(const node of source){try{node.stop();}catch{}}source=null;}if(noiseGain)noiseGain.gain.setTargetAtTime(0,context.currentTime,.05);if(brushGain)brushGain.gain.setTargetAtTime(0,context.currentTime,.03);}
async function play(){
  if(!photoLoaded)return;
  if(!ready){await loadNarration();return;}
  if(playing){pause();return;}
  if(offset>=total)reset();
  const myRun=++runId;
  audioGraph();await context.resume();
  if(!noiseStarted){noiseSource.start();brushSource.start();noiseStarted=true;}
  if(offset===0){
    $('play').disabled=true;$('countdown').hidden=false;
    for(let n=3;n>0;n--){$('countdown').textContent=n;await new Promise(r=>{countTimer=setTimeout(r,1000);});if(runId!==myRun)return;}
    $('countdown').hidden=true;$('play').disabled=false;
  }
  if(runId!==myRun)return;
  playing=true;startAt=context.currentTime-offset;source=[];
  for(let i=0;i<buffers.length;i++){const at=starts[i];if(at+buffers[i].duration<=offset)continue;const node=context.createBufferSource();node.buffer=buffers[i];node.connect(voiceGain);node.start(context.currentTime+Math.max(0,at-offset),Math.max(0,offset-at));source.push(node);}
  noiseGain.gain.setTargetAtTime(.008,context.currentTime,.3);
  $('play').textContent='Pause';$('status').textContent='Painting · Space to pause · H for studio view';schedule();
}
function pause(){if(playing)offset=clock();playing=false;runId++;cancelAnimationFrame(frame);stopSources();$('countdown').hidden=true;$('play').disabled=!(ready&&photoLoaded);$('play').textContent='Continue painting';if(photoLoaded)render(offset,false);if(photoLoaded&&offset>0&&offset<total)$('status').textContent='Paused · Space to continue';}
function reset(){pause();offset=0;painter.clear();showResult(false);$('scrub').value=0;$('elapsed').textContent='0:00';$('counter').textContent='00 / 08';$('stage').textContent='YOUR PHOTO, ONE BRUSHSTROKE AT A TIME';$('caption').textContent='A warm voice. A blank canvas. A little time.';$('paintLabel').textContent='Loose brushwork, from your photograph.';$('play').textContent='Begin painting ↗';updateReady();}
function toggleStudio(){studioView=!studioView;document.body.classList.toggle('studio',studioView);$('studioMode').textContent=studioView?'Exit studio':'Studio view';$('studioMode').setAttribute('aria-pressed',String(studioView));sizeReference();}
$('play').addEventListener('click',()=>play().catch(fail));$('reset').addEventListener('click',reset);
$('studioMode').addEventListener('click',toggleStudio);
$('captions').addEventListener('click',()=>{const hidden=document.body.classList.toggle('captions-off');$('captions').textContent=hidden?'Captions off':'Captions on';$('captions').setAttribute('aria-pressed',String(!hidden));});
$('fullscreen').addEventListener('click',()=>{const p=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();p.catch(fail);});
$('scrub').addEventListener('input',()=>{const requested=Number($('scrub').value)/1000*total;pause();offset=requested;render(offset,false);});
document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','BUTTON','A','SUMMARY'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();if(!$('countdown').hidden)return;play().catch(fail);}if(e.key.toLowerCase()==='h')toggleStudio();if(e.key==='Escape'&&studioView)toggleStudio();});
$('sound').addEventListener('click',()=>{muted=!muted;if(masterGain)masterGain.gain.setTargetAtTime(muted?0:1,context.currentTime,.04);$('sound').textContent=muted?'Sound off':'Sound on';$('sound').setAttribute('aria-pressed',String(!muted));});
$('forgetPhoto').addEventListener('click',async()=>{reset();imageVersion++;photoLoaded=false;painter.strokes=null;$('referenceCard').hidden=true;$('empty').hidden=false;if(photoURL?.startsWith('blob:'))URL.revokeObjectURL(photoURL);photoURL=null;$('referenceImage').removeAttribute('src');try{await photoStore(null,true);}catch(e){fail(e);}updateReady();});
const shareText='“Paint my photo in loose oils and talk me through it.”\n\nMade with Bob Loss, voiced by @Gradium.';
$('shareX').href=`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(location.origin)}`;
function downloadPainting(){if(!exportBlob)return;const url=URL.createObjectURL(exportBlob),a=document.createElement('a');a.href=url;a.download='bob-loss-painting.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('download').addEventListener('click',downloadPainting);
$('shareX').addEventListener('click',()=>{downloadPainting();$('shareHint').textContent='Your PNG is downloading. Attach it to the prefilled post on X.';});
$('shareImage').addEventListener('click',async()=>{if(!exportBlob)return;try{await navigator.share({files:[new File([exportBlob],'bob-loss-painting.png',{type:'image/png'})],title:'My Bob Loss painting',text:shareText});}catch(e){if(e.name!=='AbortError')$('shareHint').textContent='Image sharing is unavailable here. Download the PNG and attach it to your post.';}});
function showResult(show){
  if(show===$('result').hidden){$('result').hidden=!show;document.body.classList.toggle('is-finished',show);sizeReference();}
  if(!show){exportBlob=null;exportVersion++;return;}
  if(exportBlob||$('result').dataset.preparing==='true')return;
  $('result').dataset.preparing='true';$('download').disabled=true;
  const version=exportVersion,canvas=document.createElement('canvas'),border=32;
  canvas.width=painter.canvas.width+border*2;canvas.height=painter.canvas.height+border*2+48;const c=canvas.getContext('2d');
  c.fillStyle='#eee7d5';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(painter.canvas,border,border);
  c.fillStyle='#42503c';c.font='24px Georgia';c.fillText('Bob Loss',border,canvas.height-25);c.textAlign='right';c.font='13px sans-serif';c.fillText('A little time to paint · Powered by Gradium',canvas.width-border,canvas.height-25);
  canvas.toBlob(blob=>{delete $('result').dataset.preparing;if(version!==exportVersion||!blob)return;exportBlob=blob;$('download').disabled=false;$('shareImage').hidden=!navigator.canShare?.({files:[new File([blob],'bob-loss-painting.png',{type:'image/png'})]});},'image/png');
}
// Expose a small local inspection surface for reproducible browser checks.
window.studio={get state(){return {ready,photoLoaded,playing,offset:clock(),total,strokeCount:painter.strokes?.length||0,painted:painter.done};},setImage,reset};
async function init(){
  const loading=loadNarration();
  let saved;try{saved=await photoStore();}catch(e){console.warn('Local photo restore unavailable:',e.message);}
  if(saved)await setImage(URL.createObjectURL(saved));
  await loading;
}
init().catch(fail);
