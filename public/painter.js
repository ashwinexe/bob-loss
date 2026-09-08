// Coarse-to-fine, curved brushwork sampled from the reference. Every mark is
// painted onto a blank ground; the source photograph is never composited on top.
export class Painter {
  constructor(canvas, cursor) { this.canvas=canvas;this.ctx=canvas.getContext('2d');this.cursor=cursor;this.pen=cursor.getContext('2d');this.layers=[];this.done=0;this.seed=8391; }
  random() { this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296; }
  load(image) {
    this.seed=8391;
    const ratio=image.naturalWidth/image.naturalHeight;
    this.w=ratio>=1?1200:Math.round(1200*ratio);this.h=ratio>=1?Math.round(1200/ratio):1200;
    this.canvas.width=this.cursor.width=this.w;this.canvas.height=this.cursor.height=this.h;
    const source=document.createElement('canvas');source.width=this.w;source.height=this.h;
    const s=source.getContext('2d',{willReadFrequently:true});s.drawImage(image,0,0,this.w,this.h);
    this.pixels=s.getImageData(0,0,this.w,this.h).data;
    this.layers=[];
    const scale=Math.max(this.w,this.h)/1200;
    // Broad tonal masses, medium planes, small forms, then edges and glints.
    for(const [layer,base] of [48,35,26,20,15,11,8.5,6.5].entries()) {
      const radius=base*scale,step=Math.max(2,radius*.84),strokes=[];
      for(let gy=0;gy<this.h;gy+=step) for(let gx=0;gx<this.w;gx+=step) {
        const x=Math.min(this.w-1,Math.max(0,gx+(this.random()-.5)*step)),y=Math.min(this.h-1,Math.max(0,gy+(this.random()-.5)*step));
        const rgb=this.sample(x,y),lum=(rgb[0]*.299+rgb[1]*.587+rgb[2]*.114);
        const dx=this.luma(x+3,y)-this.luma(x-3,y),dy=this.luma(x,y+3)-this.luma(x,y-3),edge=Math.hypot(dx,dy);
        // Fine layers concentrate on contours rather than flattening every area.
        if(layer>3 && edge<12 && this.random()>.13)continue;
        if(layer>5 && (edge<22||this.random()>.56))continue;
        const angle=(edge>8?Math.atan2(dy,dx)+Math.PI/2:-.35)+(this.random()-.5)*.8;
        const length=radius*(1.2+this.random()*1.8),jitter=(this.random()-.5)*15;
        const color=rgb.map((v,i)=>Math.round(Math.max(0,Math.min(255,Math.round((v+jitter+[4,1,-3][i])/8)*8))));
        strokes.push({x,y,r:radius*(.6+this.random()*.55),angle,length,color,alpha:layer<3?.78:.65,curve:(this.random()-.5)*radius*.85,seed:this.random()});
      }
      // Shuffle within each pass so the picture emerges across the canvas.
      for(let i=strokes.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[strokes[i],strokes[j]]=[strokes[j],strokes[i]];}
      this.layers.push(strokes);
    }
    this.strokes=this.layers.flat();this.ends=[];let end=0;for(const l of this.layers){end+=l.length;this.ends.push(end);}this.clear();
    return {width:this.w,height:this.h,strokes:this.strokes.length};
  }
  sample(x,y) {const i=(Math.max(0,Math.min(this.h-1,Math.round(y)))*this.w+Math.max(0,Math.min(this.w-1,Math.round(x))))*4;const a=this.pixels[i+3]/255;return [0,1,2].map(n=>this.pixels[i+n]*a+[238,231,213][n]*(1-a));}
  luma(x,y){const c=this.sample(x,y);return c[0]*.299+c[1]*.587+c[2]*.114;}
  clear(){this.ctx.fillStyle='#eee7d5';this.ctx.fillRect(0,0,this.w||1200,this.h||900);this.pen.clearRect(0,0,this.cursor.width,this.cursor.height);this.done=0;}
  mark(s){const c=this.ctx;c.save();c.translate(s.x,s.y);c.rotate(s.angle);c.lineCap='round';c.lineJoin='round';c.globalAlpha=s.alpha;c.strokeStyle=`rgb(${s.color.join(',')})`;c.lineWidth=s.r;c.beginPath();c.moveTo(-s.length/2,0);c.quadraticCurveTo(0,s.curve,s.length/2,0);c.stroke();
    // A few bristles leave visible oil-paint ridges, particularly in large marks.
    if(s.r>3){c.globalAlpha=.23;c.lineWidth=Math.max(.55,s.r*.055);for(let k=0;k<5;k++){const offset=(k-2)*s.r*.17;c.strokeStyle=`rgb(${s.color.map(v=>Math.max(0,Math.min(255,v+(k%2?24:-17)))).join(',')})`;c.beginPath();c.moveTo(-s.length*(.3+s.seed*.15),offset);c.quadraticCurveTo(0,s.curve+offset,s.length*(.3+s.seed*.16),offset);c.stroke();}}
    c.restore();
  }
  draw(chapter,progress,showCursor=true){if(!this.strokes)return;const layer=Math.max(0,Math.min(7,chapter));const start=layer?this.ends[layer-1]:0;const target=start+Math.floor(this.layers[layer].length*Math.max(0,Math.min(1,progress)));if(target<this.done)this.clear();for(;this.done<target;this.done++)this.mark(this.strokes[this.done]);this.pen.clearRect(0,0,this.w,this.h);if(showCursor&&this.done>0&&progress<1){const s=this.strokes[this.done-1],c=this.pen;c.save();c.translate(s.x,s.y);c.rotate(-.7);c.shadowColor='#0004';c.shadowBlur=4;c.fillStyle='#d3bb85';c.fillRect(-3,-54,6,45);c.fillStyle='#b7b9af';c.fillRect(-4,-15,8,12);c.fillStyle=`rgb(${s.color.join(',')})`;c.beginPath();c.moveTo(-4,-3);c.lineTo(4,-3);c.lineTo(2,5);c.lineTo(-2,5);c.fill();c.restore();}}
}
