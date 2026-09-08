import {mkdir,rename} from 'node:fs/promises';
import {cleanCaption} from '../public/captions.js';
const manifest=await Bun.file('data/manifest.json').json();
if(manifest.chapters.some((c: any)=>/Ashwin|Golden Gate|<break/i.test(c.text)))throw new Error('Render the generic public narration before exporting.');
await mkdir('public/audio',{recursive:true});
const chapters=[];
for(const c of manifest.chapters){
  const target=`public/audio/${c.id}.mp3`;
  const result=Bun.spawnSync(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',`data${c.audio}`,'-codec:a','libmp3lame','-b:a','96k',target]);
  if(result.exitCode!==0)throw new Error(`Audio export failed: ${c.id}`);
  chapters.push({id:c.id,title:c.title,paint:c.paint,text:cleanCaption(c.text),audio:`/audio/${c.id}.mp3`,duration:c.duration,words:c.words.map((w:any)=>({...w,text:cleanCaption(w.text)})).filter((w:any)=>w.text)});
}
await Bun.write('public/narration.json.tmp',JSON.stringify({version:1,voice:'Bob Loss',chapters},null,2));
await rename('public/narration.json.tmp','public/narration.json');
console.log(`Exported ${chapters.length} generic narration chapters. No account IDs, reference photos, or personal narration.`);
