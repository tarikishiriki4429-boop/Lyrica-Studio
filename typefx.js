/* Lyrica Studio original procedural typography engine.
   Shatter & Graphite are generated texture styles, not redistributable font files.
   Deterministic texture generation makes timeline scrubbing and video export stable. */
'use strict';
window.LyricaTypeFX = (()=>{
  const textures = new Map();
  const LIMIT = 90;
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const gr = text => typeof Intl !== 'undefined' && Intl.Segmenter ?
    Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text),r=>r.segment) : Array.from(text);
  function hash(s) {let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0;}
  function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
  const randInt=(r,min,max)=>min+Math.floor(r()*(max-min+1));
  function fontSpec(p){return `${p.weight||700} ${p.fontSize}px ${p.fontFamily||'sans-serif'}`;}
  function metrics(line,p){const probe=document.createElement('canvas').getContext('2d');probe.font=fontSpec(p);const chars=gr(line);const widths=chars.map(c=>probe.measureText(c).width);return {chars,widths,width:widths.reduce((a,b)=>a+b,0)+Math.max(0,chars.length-1)*p.spacing};}
  function parameters(p){let fx=p.fx||{};return {
    style:fx.style||'standard',intensity:clamp((Number(fx.intensity)||0)/100,0,1),
    grain:clamp((Number(fx.grain)||0)/100,0,1),
    irregularity:clamp((Number(fx.irregularity)||0)/100,0,1),
    detail:clamp((Number(fx.detail)||0)/100,0,1),
    seed:Number(fx.seed)||1
  };}
  function texturedLine(line,p){
    const opts=parameters(p), key=JSON.stringify([line,p.fontSize,p.fontFamily,p.weight,p.spacing,p.color,p.stroke,p.strokeColor,opts]);
    if(textures.has(key)){const cached=textures.get(key);textures.delete(key);textures.set(key,cached);return cached;}
    const data=metrics(line,p), f=p.fontSize;
    const pad=Math.ceil(Math.max(14,f*.33+(p.stroke||0)*2)), w=Math.ceil(Math.max(1,data.width)+2*pad),h=Math.ceil(Math.max(f*1.95,12)+2*pad);
    // Browser canvas limits vary. Fall back to native fillText for huge titles.
    if(w>7500||h>4500)return null;
    const surface=document.createElement('canvas');surface.width=w;surface.height=h;
    const c=surface.getContext('2d',{willReadFrequently:opts.style==='graphite'});
    const r=rng(hash(key)+opts.seed),center=h/2;let cursor=pad;
    c.font=fontSpec(p);c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.miterLimit=2;
    const centers=[];
    data.chars.forEach((ch,i)=>{
      const width=data.widths[i],cx=cursor+width/2;
      const shift=opts.style==='standard'?0:opts.style==='graphite'?opts.irregularity*f*.07:opts.irregularity*f*.027;
      const jitterX=(r()-.5)*2*shift,jitterY=(r()-.5)*2*shift;
      const ang=(r()-.5)*(opts.style==='graphite'?.12:.045)*opts.irregularity;
      c.save();c.translate(cx+jitterX,center+jitterY);c.rotate(ang);
      if(opts.style==='graphite'){
        // Sketchy duplicate edge strokes and pencil-pressure changes.
        c.strokeStyle=p.color;c.lineWidth=clamp(f*.009,.5,1.8);
        c.globalAlpha=opts.detail*.15+opts.intensity*.07;c.strokeText(ch,-f*.012,f*.009);
        c.strokeText(ch,f*.009,-f*.016);
        c.globalAlpha=1-opts.irregularity*.22*r();
      }
      if(p.stroke>0){c.strokeStyle=p.strokeColor;c.lineWidth=p.stroke;c.strokeText(ch,0,0);}
      c.fillStyle=p.color;c.fillText(ch,0,0);
      c.restore();centers.push({cx:cx+jitterX,cy:center+jitterY,width});cursor+=width+p.spacing;
    });
    if(opts.style==='shatter'){
      c.save();c.globalCompositeOperation='destination-out';
      for(let i=0;i<centers.length;i++){
        const g=centers[i],density=opts.intensity;
        if(!data.chars[i].trim())continue;
        // Angular cuts: fractured glyph edges, chips, and branching fault lines.
        const crackCount=Math.floor(density*(1.3+opts.detail*3)+(r()<density*.8?1:0));
        for(let j=0;j<crackCount;j++){
          let px=g.cx+(r()-.5)*g.width*.95,py=g.cy+(r()-.5)*f*.8;
          const dx=(r()-.5)*g.width*.7;
          c.beginPath();c.moveTo(px,py);
          const count=randInt(r,2,5);
          for(let n=0;n<count;n++){
            px+=dx/count+(r()-.5)*f*.16;
            py+=(r()-.5)*f*.18;
            c.lineTo(px,py);
          }
          c.lineWidth=clamp(f*(.008+opts.intensity*.018)*(.7+r()),.8,6.5);c.stroke();
          if(r()<.55){c.beginPath();c.moveTo(px,py);c.lineTo(px+(r()-.5)*f*.24,py+(r()-.5)*f*.23);c.lineWidth*=.53;c.stroke();}
        }
        const chipCount=Math.floor(opts.grain*opts.intensity*(3+f*.32));
        for(let n=0;n<chipCount;n++){
          const x=g.cx+(r()-.5)*g.width*1.25,y=g.cy+(r()-.5)*f*1.1,sz=(.008+r()*.045)*f*(.5+density);
          c.beginPath();c.moveTo(x,y);c.lineTo(x+sz*(.25+r()),y-sz*(.3+r()));c.lineTo(x+sz*(.5+r()),y+sz*(.4+r()));c.closePath();c.fill();
        }
      }
      // Long slash cracks extend across multiple characters at higher intensity.
      if(opts.intensity>.45 && data.width>f*2){
        for(let k=0;k<Math.round(opts.detail*2);k++){
          let x=pad+r()*data.width,y=center+(r()-.5)*f*.8;
          c.beginPath();c.moveTo(x,y);
          for(let n=0;n<6;n++){x+=(r()-.2)*f*.19;y+=(r()-.5)*f*.21;c.lineTo(x,y);}
          c.lineWidth=f*(.009+opts.intensity*.008);c.stroke();
        }
      }
      c.restore();
      // Misregistered fragments are deliberately restrained for legibility.
      if(opts.irregularity>.05){
        const shiftCanvas=document.createElement('canvas');shiftCanvas.width=w;shiftCanvas.height=h;
        const cc=shiftCanvas.getContext('2d');const strips=Math.ceil(2+opts.irregularity*5);
        for(let n=0;n<strips;n++){
          const stripY=pad+r()*f*.95,stripH=Math.max(1,f*(.015+r()*.05));
          cc.globalAlpha=.2+opts.irregularity*.34;
          cc.drawImage(surface,pad,stripY,data.width,stripH,pad+(r()-.5)*f*.17*opts.irregularity,stripY+(r()-.5)*f*.045,data.width,stripH);
        }
        c.drawImage(shiftCanvas,0,0);
      }
    }else if(opts.style==='graphite'){
      // Dry graphite is not pure gray: keep the selected text hue, modulate its opacity.
      const im=c.getImageData(0,0,w,h),pixels=im.data;
      const seed=hash(key),strength=opts.intensity;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const ix=(y*w+x)*4,a=pixels[ix+3];if(a<4)continue;
        let t=(Math.imul(x+11,374761393)^Math.imul(y+7,668265263)^seed)>>>0;
        t=Math.imul(t^(t>>>13),1274126177)>>>0;
        const noise=((t^(t>>>16))>>>0)/4294967295;
        const broad=.68+.15*Math.sin(x*.026+seed*.00001)+.13*Math.sin(y*.081+x*.009);
        const pressure=clamp(broad*(1-opts.irregularity*.19)+.35*(1-opts.irregularity),.28,1.16);
        const dry=clamp((noise-.17)*opts.grain*strength*.93,0,.80);
        const faint=1-strength*.18;
        pixels[ix+3]=Math.round(a*clamp(pressure*faint*(1-dry),.06,1));
      }
      c.putImageData(im,0,0);
      // Second pass: irregular graphite wisps and traces left by a soft pencil.
      c.save();c.globalCompositeOperation='source-atop';c.strokeStyle=p.color;
      const count=Math.round((w/f)*opts.detail*20*strength);
      for(let i=0;i<count;i++){
        let x=pad+r()*data.width,y=center+(r()-.5)*f*.92;
        c.globalAlpha=.06+r()*.12;c.lineWidth=.4+r()*.7;
        c.beginPath();c.moveTo(x,y);c.lineTo(x+f*(.035+r()*.1),y-f*(.008+r()*.035));c.stroke();
      }
      c.restore();
    }
    const result={canvas:surface,width:data.width,height:h,pad,chars:data.chars.length};
    textures.set(key,result);if(textures.size>LIMIT)textures.delete(textures.keys().next().value);
    return result;
  }
  function renderLine(c,line,x,y,p,anim={}){
    const opts=parameters(p);if(opts.style==='standard' && anim.vanish!=='scatter' && anim.reveal!=='flicker')return false;
    const sprite=texturedLine(line,p);if(!sprite)return false;
    const left=x-sprite.width*(p.align==='center'?.5:p.align==='right'?1:0);
    const imageX=left-sprite.pad,imageY=y-sprite.height/2;
    const enter=clamp(anim.enter??1,0,1),exit=clamp(anim.exit??0,0,1);
    const reveal=anim.reveal||'none',vanish=anim.vanish||'none';
    c.save();
    if((reveal==='write'||reveal==='stagger')&&enter<1){
      const width=sprite.width*(reveal==='stagger'?Math.floor(enter*Math.max(1,sprite.chars)+.001)/Math.max(1,sprite.chars):enter);
      c.beginPath();c.rect(left-3,y-sprite.height/2,width+3,sprite.height);c.clip();
    }
    if(vanish==='erase'&&exit>0){c.beginPath();c.rect(left+sprite.width*exit,y-sprite.height/2,sprite.width*(1-exit)+sprite.pad,sprite.height);c.clip();}
    if(vanish==='scatter'&&exit>0){
      // Whole-word fracture into horizontal bands while the letters drift apart.
      const sections=11,r=rng(hash(line+opts.seed));
      for(let i=0;i<sections;i++){
        const stripH=sprite.height/sections,dy=i*stripH,offset=(r()-.5)*p.fontSize*1.4*exit;
        c.globalAlpha=clamp(1-exit*.85,0,1);
        c.drawImage(sprite.canvas,0,dy,sprite.canvas.width,stripH,imageX+offset,imageY+dy+(r()-.5)*p.fontSize*.45*exit,sprite.canvas.width,stripH);
      }
    }else{
      if(reveal==='flicker'&&enter<1){const frame=Math.floor((anim.elapsed||0)*17);const noise=rng(hash(line+frame+opts.seed))();c.globalAlpha=.45+.55*(noise>.28?1:noise);}
      c.drawImage(sprite.canvas,imageX,imageY);
    }
    c.restore();return true;
  }
  return {renderLine,clear(){textures.clear()},stats(){return {cachedTextures:textures.size}}};
})();
