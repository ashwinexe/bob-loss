import {mkdir,rm,copyFile} from 'node:fs/promises';
const manifest=await Bun.file('public/narration.json').json();
const publicFiles=['index.html','style.css','app.js','painter.js','captions.js','favicon.svg','gradium-logo.svg','narration.json'];
if(manifest.chapters?.length!==8)throw new Error('Expected eight narration chapters.');
for(const chapter of manifest.chapters){
  if(!/^\/audio\/[a-z]+\.mp3$/.test(chapter.audio))throw new Error('Unexpected audio path.');
  if(/Ashwin|Golden Gate|vox_emb_|GRADIUM_API_KEY|<break|&lt;break/i.test(JSON.stringify(chapter)))throw new Error('Non-public content found in narration.');
  publicFiles.push(chapter.audio.slice(1));
}
await rm('dist',{recursive:true,force:true});await mkdir('dist/audio',{recursive:true});
for(const file of publicFiles){if(!(await Bun.file(`public/${file}`).exists()))throw new Error(`Missing public asset: ${file}`);await copyFile(`public/${file}`,`dist/${file}`);}
console.log(`Public build: ${publicFiles.length} allowlisted files. No photos, credentials, or local session data.`);
