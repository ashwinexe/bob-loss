import {resolve} from 'node:path';
const directory=resolve(import.meta.dir,process.env.SERVE_DIR||'public');
const port=Number(process.env.PORT||4317);
const server=Bun.serve({hostname:'127.0.0.1',port,async fetch(req){
  if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405});
  const url=new URL(req.url);
  const path=resolve(directory,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(directory+'/')||url.pathname.split('/').some(p=>p.startsWith('.'))||! /\.(html|css|js|json|svg|mp3|png)$/.test(path))return new Response('Not found',{status:404});
  const file=Bun.file(path);if(!(await file.exists()))return new Response('Not found',{status:404});
  return new Response(file,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"}});
}});
console.log(`Bob Loss: ${server.url}`);
