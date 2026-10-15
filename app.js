'use strict';
const $ = id => document.getElementById(id);
const canvas = $('preview'), ctx = canvas.getContext('2d'), video = $('sourceVideo');
const FONTS = {
  gothic:'"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans CJK JP",sans-serif',
  mincho:'"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif',
  serif:'Georgia,"Times New Roman",serif',
  sans:'Arial,Helvetica,sans-serif',
  mono:'Menlo,Consolas,monospace',
  rounded:'"Hiragino Maru Gothic ProN","Arial Rounded MT Bold",sans-serif',
  heavy:'Impact,"Arial Black","Hiragino Kaku Gothic ProN",sans-serif',
  hand:'"Bradley Hand","Comic Sans MS",cursive'
};
const state = {items:[],selected:null,time:1,duration:30,zoom:60,playingDemo:false,videoFile:null,videoURL:null,isDemo:true,drag:null,history:[],future:[],exporting:false,stopExport:null,customFonts:{},recording:false};
let idCounter=1, lastFrame=performance.now(), activeDrag=null, mutedWhileRecording=false;
let audioContext=null, audioSource=null, audioDestination=null;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const round=(n,nDigits=2)=>Number(n.toFixed(nDigits));
const formatTime=t=> {t=Math.max(0,Number(t)||0);let m=Math.floor(t/60),s=Math.floor(t%60),h=Math.floor(t*100)%100;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(h).padStart(2,'0')}`;};
const status=(message)=>{$('status').textContent=message;};
const graphemes=s=> (typeof Intl!=='undefined'&&Intl.Segmenter)?Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(s),x=>x.segment):Array.from(s);
const uid=()=>`tx_${Date.now().toString(36)}_${idCounter++}`;
const cloneItems=()=>JSON.parse(JSON.stringify(state.items));
function stash(snapshot){state.history.push(snapshot||cloneItems());if(state.history.length>80)state.history.shift();state.future=[];updateUndo();}
function updateUndo(){$('undo').disabled=!state.history.length;$('redo').disabled=!state.future.length;}
function undo(){if(!state.history.length)return;state.future.push(cloneItems());state.items=state.history.pop();if(!state.items.some(x=>x.id===state.selected))state.selected=state.items.at(-1)?.id||null;refresh();updateUndo();}
function redo(){if(!state.future.length)return;state.history.push(cloneItems());state.items=state.future.pop();if(!state.items.some(x=>x.id===state.selected))state.selected=state.items.at(-1)?.id||null;refresh();updateUndo();}
function newItem(text='あなたの歌詞をここに',start=state.time,duration=3){start=clamp(start,0,Math.max(0,state.duration-.2));duration=Math.min(duration,Math.max(.2,state.duration-start));return {id:uid(),text,start:round(start),end:round(start+duration),x:.5,y:.51,size:72,spacing:0,color:'#ffffff',strokeColor:'#11102b',stroke:0,shadow:6,font:'gothic',align:'center',rotate:0,scale:1,opacity:1,animation:'fade',inDur:.5,outDur:.35,keyframes:[],fx:{style:'standard',intensity:70,grain:54,irregularity:38,detail:62,seed:1,reveal:'none',vanish:'none'}};}
function selected(){return state.items.find(x=>x.id===state.selected)||null;}
function select(id){state.selected=id;renderLayers();renderTimeline();renderInspector();draw();}
function refresh(){renderLayers();renderTimeline();renderInspector();updateTransport();draw();}
function addText(){stash();let item=newItem();state.items.push(item);state.selected=item.id;refresh();status('文字レイヤーを追加しました。プレビュー上でドラッグして配置できます。');}
function duplicate(){let src=selected();if(!src)return;stash();let n=JSON.parse(JSON.stringify(src));n.id=uid();n.start=clamp(n.start+.25,0,state.duration-.2);n.end=clamp(n.end+.25,n.start+.1,state.duration);n.y=clamp(n.y+.04,-1,2);state.items.push(n);state.selected=n.id;refresh();}
function deleteSelected(){if(!selected())return;stash();state.items=state.items.filter(x=>x.id!==state.selected);state.selected=state.items.at(-1)?.id||null;refresh();}
function isActive(item,time){return time>=item.start&&time<item.end;}
function ease(x){return x*x*(3-2*x);}
function lerp(a,b,t){return a+(b-a)*t;}
function interpolated(item,time){
 let base={x:item.x,y:item.y,rotate:item.rotate,scale:item.scale,opacity:item.opacity}, keys=[...item.keyframes].sort((a,b)=>a.at-b.at);
 if(!keys.length)return base;
 let t=clamp(time-item.start,0,Math.max(0,item.end-item.start));
 if(t<keys[0].at){if(keys[0].at===0)return {...base,...keys[0]};let p=ease(clamp(t/keys[0].at,0,1));return Object.fromEntries(Object.keys(base).map(k=>[k,lerp(base[k],keys[0][k],p)]));}
 if(t>=keys.at(-1).at)return {...base,...keys.at(-1)};
 for(let i=0;i<keys.length-1;i++){let a=keys[i],b=keys[i+1];if(t>=a.at&&t<=b.at){let q=ease((t-a.at)/Math.max(.000001,b.at-a.at));return Object.fromEntries(Object.keys(base).map(k=>[k,lerp(a[k],b[k],q)]));}}
 return base;
}
function measureLine(c,line,spacing){let letters=graphemes(line);if(!letters.length)return 0;return letters.reduce((sum,ch)=>sum+c.measureText(ch).width,0)+Math.max(0,letters.length-1)*spacing;}
function printSpaced(c,line,x,y,spacing,mode){if(!spacing){c[mode+'Text'](line,x,y);return;}
 let chars=graphemes(line),total=measureLine(c,line,spacing),pos=x-(c.textAlign==='center'?total/2:c.textAlign==='right'?total:0);
 c.save();c.textAlign='left';for(let ch of chars){c[mode+'Text'](ch,pos,y);pos+=c.measureText(ch).width+spacing;}c.restore();
}
function paintItem(item,time,{editing=false}={}){
 if(!isActive(item,time))return null;
 let base=interpolated(item,time),duration=item.end-item.start,p=clamp((time-item.start)/Math.max(.01,item.inDur),0,1),q=ease(p),elapsed=time-item.start;
 let x=base.x*canvas.width,y=base.y*canvas.height,angle=base.rotate*Math.PI/180,sc=base.scale,alpha=base.opacity;
 const inSecs=Math.min(item.inDur,duration);
 switch(item.animation){
 case 'fade':alpha*=item.inDur>0?q:1;break;
 case 'left':x-=canvas.width*.6*(1-q);alpha*=q;break;
 case 'right':x+=canvas.width*.6*(1-q);alpha*=q;break;
 case 'up':y+=canvas.height*.3*(1-q);alpha*=q;break;
 case 'down':y-=canvas.height*.3*(1-q);alpha*=q;break;
 case 'pop':sc*=.25+.75*q;alpha*=q;break;
 case 'spin':angle-=(1-q)*Math.PI*2;alpha*=q;break;
 case 'float':y+=Math.sin(elapsed*2.7)*canvas.height*.022;alpha*=item.inDur>0?q:1;break;
 case 'scroll':x=canvas.width*(1.2-2.4*elapsed/Math.max(.01,duration));break;
 case 'scrollUp':
 case 'scrollDown':{
   // Keep the entire text block offscreen at both ends, even when it is
   // multi-line, large or rotated.  Vertical motion is linear, not eased.
   const unit=canvas.height/1080, fontSize=item.size*unit, letterGap=item.spacing*unit;
   const lines=item.text.split('\n');
   ctx.save();
   ctx.font=`${item.font==='heavy'?'900':'700'} ${fontSize}px ${FONTS[item.font]||state.customFonts[item.font]||FONTS.gothic}`;
   const textWidth=Math.max(10,...lines.map(line=>measureLine(ctx,line,letterGap)));
   ctx.restore();
   const textHeight=fontSize*1.28*lines.length;
   const maxVerticalExtent=(Math.abs(Math.sin(angle))*textWidth+Math.abs(Math.cos(angle))*textHeight)*Math.abs(sc);
   const clearance=maxVerticalExtent+Math.max(20,canvas.height*.035);
   const progress=clamp(elapsed/Math.max(.01,duration),0,1);
   const origin=item.animation==='scrollUp'?canvas.height+clearance:-clearance;
   const destination=item.animation==='scrollUp'?-clearance:canvas.height+clearance;
   y=lerp(origin,destination,progress);
   break;
 }
 }
 if(item.outDur>0 && item.fx?.vanish!=='erase' && item.fx?.vanish!=='scatter')alpha*=clamp((item.end-time)/item.outDur,0,1);
 alpha=clamp(alpha,0,1);if(alpha<=.001)return null;
 const unit=canvas.height/1080,fontsize=item.size*unit,spacing=item.spacing*unit,lines=item.text.split('\n'),lh=fontsize*1.28;
 let paintLines=lines;
 if(item.animation==='type'){
   let charCount=graphemes(item.text.replace(/\n/g,'')).length,limit=Math.ceil(charCount*(item.inDur>0?clamp(elapsed/item.inDur,0,1):1)),used=0;
   paintLines=lines.map(l=>{let z=graphemes(l),part=z.slice(0,Math.max(0,limit-used)).join('');used+=z.length;return part;});
 }
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(sc,sc);ctx.globalAlpha=alpha;
 ctx.font=`${item.font==='heavy'?'900':'700'} ${fontsize}px ${FONTS[item.font]||state.customFonts[item.font]||FONTS.gothic}`;
 ctx.textAlign=item.align;ctx.textBaseline='middle';ctx.lineJoin='round';ctx.miterLimit=2;
 const widths=paintLines.map(t=>measureLine(ctx,t,spacing)),width=Math.max(10,...widths),height=lh*lines.length;
 if(item.animation==='wipe'&&inSecs>0){const leftEdge=item.align==='left'?0:item.align==='right'?-width:-width/2;ctx.beginPath();ctx.rect(-canvas.width*3,-canvas.height*2,canvas.width*3+leftEdge+width*q,canvas.height*4);ctx.clip();}
 ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=item.shadow*unit;
 paintLines.forEach((line,i)=>{
   let baseY=(i-(lines.length-1)/2)*lh;
   const progressIn=item.inDur>0?clamp((time-item.start)/item.inDur,0,1):1;
   const progressOut=item.outDur>0?clamp((time-(item.end-item.outDur))/item.outDur,0,1):0;
   const hasStyled=window.LyricaTypeFX?.renderLine(ctx,line,0,baseY,{
     fontSize:fontsize,spacing,color:item.color,stroke:item.stroke*unit,strokeColor:item.strokeColor,
     fontFamily:FONTS[item.font]||state.customFonts[item.font]||FONTS.gothic,
     weight:item.font==='heavy'?'900':'700',align:item.align,fx:item.fx
   },{enter:progressIn,exit:progressOut,reveal:item.fx?.reveal||'none',vanish:item.fx?.vanish||'none',elapsed});
   if(!hasStyled){
     if(item.fx?.reveal==='write'&&progressIn<1){ctx.save();const left=item.align==='left'?0:item.align==='right'?-width:-width/2;ctx.beginPath();ctx.rect(left-4,baseY-lh*.65,width*progressIn+8,lh*1.3);ctx.clip();}
     if(item.fx?.reveal==='stagger'&&progressIn<1){ctx.save();const left=item.align==='left'?0:item.align==='right'?-width:-width/2;ctx.beginPath();ctx.rect(left-4,baseY-lh*.65,width*Math.floor(graphemes(line).length*progressIn)/Math.max(1,graphemes(line).length)+8,lh*1.3);ctx.clip();}
     if(item.fx?.vanish==='erase'&&progressOut>0){ctx.save();const left=item.align==='left'?0:item.align==='right'?-width:-width/2;ctx.beginPath();ctx.rect(left+width*progressOut,baseY-lh*.65,width*(1-progressOut)+5,lh*1.3);ctx.clip();}
     if(item.stroke>0){ctx.lineWidth=item.stroke*unit;ctx.strokeStyle=item.strokeColor;printSpaced(ctx,line,0,baseY,spacing,'stroke');}
     ctx.fillStyle=item.color;printSpaced(ctx,line,0,baseY,spacing,'fill');
     if(item.fx?.reveal==='write'&&progressIn<1)ctx.restore();
     if(item.fx?.reveal==='stagger'&&progressIn<1)ctx.restore();
     if(item.fx?.vanish==='erase'&&progressOut>0)ctx.restore();
   }
 });
 ctx.shadowBlur=0;
 if(editing){let dx=item.align==='left'?0:item.align==='right'?-width:-width/2;ctx.strokeStyle='#eaa4ff';ctx.globalAlpha=1;ctx.lineWidth=Math.max(2,1.5*unit)/Math.max(sc,.05);ctx.setLineDash([9*unit,6*unit]);ctx.strokeRect(dx-8*unit,-height/2-6*unit,width+16*unit,height+12*unit);ctx.setLineDash([]);ctx.fillStyle='#f2c2ff';let r=5*unit;for(let vx of [dx-8*unit,dx+width+8*unit])for(let vy of [-height/2-6*unit,height/2+6*unit]){ctx.beginPath();ctx.arc(vx,vy,r,0,Math.PI*2);ctx.fill();}}
 ctx.restore();
 return {x,y,w:width*sc,h:height*sc,rotation:angle,align:item.align};
}
const hitRegions=[];
function draw(){
 const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
 if(state.videoFile&&video.readyState>=2){try{ctx.drawImage(video,0,0,w,h);}catch{ctx.fillStyle='#11182a';ctx.fillRect(0,0,w,h);}}
 else{let g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#12183b');g.addColorStop(.54,'#28214d');g.addColorStop(1,'#0b2134');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.fillStyle='#ffffff09';for(let i=0;i<14;i++){ctx.save();ctx.translate((i+.2)*w/14,0);ctx.rotate(.35);ctx.fillRect(0,-h*.2,w*.08,h*1.5);ctx.restore();}ctx.fillStyle='#d5bafc';ctx.textAlign='center';ctx.font=`${Math.round(h*.027)}px sans-serif`;ctx.fillText('LYRICA  /  PREVIEW DEMO',w/2,h*.86);}
 hitRegions.length=0;
 for(let item of state.items){let bounds=paintItem(item,state.time,{editing:!state.exporting&&item.id===state.selected});if(bounds)hitRegions.push({item,bounds});}
}
function sizeCanvas(videoW,videoH){const cap=1920,ratio=Math.min(1,cap/Math.max(videoW,videoH));canvas.width=Math.max(2,Math.round(videoW*ratio/2)*2);canvas.height=Math.max(2,Math.round(videoH*ratio/2)*2);canvas.style.aspectRatio=`${canvas.width} / ${canvas.height}`;$('resolutionBadge').textContent=`${canvas.width} × ${canvas.height}`;draw();}
function updateTransport(){let t=state.time;$('timeCurrent').textContent=formatTime(t);$('timeDuration').textContent=formatTime(state.duration);$('seek').max=state.duration;$('seek').value=t;$('playBtn').textContent=(state.videoFile?!video.paused:state.playingDemo)?'Ⅱ':'▶';updatePlayhead();}
function setTime(time){state.time=clamp(time,0,state.duration);if(state.videoFile&&Number.isFinite(video.duration)&&Math.abs(video.currentTime-state.time)>.012){try{video.currentTime=state.time}catch{}}updateTransport();draw();}
function playPause(){if(state.videoFile){if(video.paused){if(video.currentTime>=state.duration-.03)video.currentTime=0;video.play().catch(e=>status(`再生できません：${e.message}`));}else video.pause();}else{state.playingDemo=!state.playingDemo;}updateTransport();}
function loop(now){let diff=Math.min(.08,(now-lastFrame)/1000);lastFrame=now;if(state.videoFile){if(!video.paused&&Number.isFinite(video.currentTime))state.time=video.currentTime;}else if(state.playingDemo){state.time+=diff;if(state.time>=state.duration){state.time=0;state.playingDemo=false;}}updateTransport();draw();requestAnimationFrame(loop);}
function renderLayers(){let root=$('layerList');root.innerHTML='';if(!state.items.length){root.innerHTML='<div class="empty-layer">文字レイヤーはまだありません。<br>「文字を追加」で開始。</div>';return;}
 state.items.forEach((item,i)=>{let btn=document.createElement('button');btn.className='layer-item'+(item.id===state.selected?' active':'');let n=document.createElement('span');n.className='layer-n';n.textContent=String(i+1).padStart(2,'0');let box=document.createElement('span');box.className='layer-main';let text=document.createElement('span');text.className='layer-txt';text.textContent=item.text||'(空の文字)';let time=document.createElement('span');time.className='layer-time';time.textContent=`${formatTime(item.start)} → ${formatTime(item.end)}`;box.append(text,time);btn.append(n,box);btn.onclick=()=>select(item.id);root.append(btn);});}
function renderTimeline(){let w=Math.max(800,Math.ceil(state.duration*state.zoom)+12);$('timelineInner').style.width=w+'px';$('ruler').innerHTML='';let maxMarks=85,unit=Math.max(1,Math.ceil(state.duration*state.zoom/Math.max(600,maxMarks*12)));let step=unit<=1?1:unit<=2?2:unit<=5?5:unit<=10?10:unit<=20?20:30;
 for(let second=0;second<=state.duration;second+=step){let tick=document.createElement('div');tick.className='ruler-tick major';tick.style.left=second*state.zoom+'px';let label=document.createElement('span');label.textContent=`${Math.floor(second/60)}:${String(second%60).padStart(2,'0')}`;tick.append(label);$('ruler').append(tick);}
 let tracks=$('tracks');tracks.innerHTML='';state.items.forEach((item,i)=>{let track=document.createElement('div');track.className='track';track.dataset.id=item.id;let clip=document.createElement('div');clip.className='clip'+(item.id===state.selected?' active':'');clip.dataset.id=item.id;clip.style.left=item.start*state.zoom+'px';clip.style.width=Math.max(8,(item.end-item.start)*state.zoom)+'px';let left=document.createElement('div');left.className='clip-handle left';left.dataset.edge='left';let label=document.createElement('div');label.className='clip-label';label.textContent=item.text.replace(/\n/g,' ↵ ')||'(空)';let right=document.createElement('div');right.className='clip-handle right';right.dataset.edge='right';clip.append(left,label,right);track.append(clip);tracks.append(track);});
 if(!state.items.length){let empty=document.createElement('div');empty.style.cssText='font-size:12px;color:#8696b9;padding:34px 15px';empty.textContent='ここに文字クリップが並びます';tracks.append(empty);}
 updatePlayhead();}
function updatePlayhead(){$('playhead').style.left=state.time*state.zoom+'px';}
function renderInspector(){let item=selected();$('settings').hidden=!item;$('noSelection').hidden=!!item;$('duplicate').disabled=!item;if(!item)return;
 let field=$('fontValue');for(let custom in state.customFonts){if(!Array.from(field.options).some(option=>option.value===custom)){let o=document.createElement('option');o.value=custom;o.textContent='追加フォント / '+custom;field.append(o);}}
 const data={textValue:item.text,fontValue:item.font,sizeValue:item.size,spacingValue:item.spacing,colorValue:item.color,strokeColor:item.strokeColor,strokeValue:item.stroke,shadowValue:item.shadow,alignValue:item.align,xValue:round(item.x*100,2),yValue:round(item.y*100,2),rotateValue:item.rotate,scaleValue:round(item.scale*100,2),opacityValue:round(item.opacity*100),animationValue:item.animation,inValue:item.inDur,outValue:item.outDur,startValue:item.start,endValue:item.end};
 for(let [id,value] of Object.entries(data)){let el=$(id);if(el===document.activeElement)continue;el.value=value;}
 $('opacityLabel').textContent=`${Math.round(item.opacity*100)}%`;
 renderTextureInspector(item);
 renderKeyframes(item);
}
function renderKeyframes(item){let list=$('keyframeList');list.innerHTML='';if(!item.keyframes.length){let span=document.createElement('span');span.className='help';span.textContent='キーフレームはまだありません。';list.append(span);return;}
 [...item.keyframes].sort((a,b)=>a.at-b.at).forEach(k=>{let row=document.createElement('div');row.className='key-row';let text=document.createElement('span');text.textContent=`◇ ${formatTime(item.start+k.at)}  /  X:${round(k.x*100)}  Y:${round(k.y*100)}  回転:${round(k.rotate)}°`;let buttons=document.createElement('div');let jump=document.createElement('button');jump.textContent='↗';jump.title='この時刻へ移動';jump.onclick=()=>setTime(item.start+k.at);let rm=document.createElement('button');rm.textContent='×';rm.title='キーフレームを削除';rm.onclick=()=>{stash();item.keyframes=item.keyframes.filter(p=>p!==k);refresh();};buttons.append(jump,rm);row.append(text,buttons);list.append(row);});}
const FIELDS={textValue:['text',v=>v],fontValue:['font',v=>v],sizeValue:['size',v=>clamp(Number(v)||12,8,360)],spacingValue:['spacing',v=>clamp(Number(v)||0,-15,80)],colorValue:['color',v=>v],strokeColor:['strokeColor',v=>v],strokeValue:['stroke',v=>clamp(Number(v)||0,0,24)],shadowValue:['shadow',v=>clamp(Number(v)||0,0,60)],alignValue:['align',v=>v],xValue:['x',v=>clamp(Number(v)/100,-1,2)],yValue:['y',v=>clamp(Number(v)/100,-1,2)],rotateValue:['rotate',v=>clamp(Number(v)||0,-1080,1080)],scaleValue:['scale',v=>clamp(Number(v)/100,.05,10)],opacityValue:['opacity',v=>clamp(Number(v)/100,0,1)],animationValue:['animation',v=>v],inValue:['inDur',v=>clamp(Number(v)||0,0,120)],outValue:['outDur',v=>clamp(Number(v)||0,0,120)],startValue:['start',v=>clamp(Number(v)||0,0,state.duration-.1)],endValue:['end',v=>clamp(Number(v)||0,.1,state.duration)]};

const FX_NAMES={
 shatter:['欠け・ひびの強さ','表面の剥がれ','破片のズレ','亀裂の細かさ'],
 graphite:['鉛筆の濃淡','芯のざらつき','手書きの揺れ','重ね描きの線']
};
function ensureFx(item){
 if(!item.fx)item.fx={style:'standard',intensity:70,grain:54,irregularity:38,detail:62,seed:1,reveal:'none',vanish:'none'};
 return item.fx;
}
function renderTextureInspector(item){
 const fx=ensureFx(item);
 document.querySelectorAll('.type-preset').forEach(b=>{const active=b.dataset.texture===fx.style;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});
 $('textureControls').hidden=fx.style==='standard';
 const names=FX_NAMES[fx.style]||FX_NAMES.shatter;
 ['Intensity','Grain','Irregularity','Detail'].forEach((key,index)=>{
   const id='fx'+key,prop=key.toLowerCase();$(id+'Name').textContent=names[index];$(id+'Label').textContent=Math.round(fx[prop]);
   if(document.activeElement!==$(id))$(id).value=fx[prop];
 });
 if(document.activeElement!==$('fxReveal'))$('fxReveal').value=fx.reveal;
 if(document.activeElement!==$('fxVanish'))$('fxVanish').value=fx.vanish;
}
function bindTexture(){
 document.querySelectorAll('.type-preset').forEach(button=>button.addEventListener('click',()=>{
  const item=selected();if(!item)return;const fx=ensureFx(item);if(fx.style===button.dataset.texture)return;
  stash();fx.style=button.dataset.texture;
  if(fx.style==='shatter'&&fx.seed===1)fx.seed=241;
  if(fx.style==='graphite'&&fx.seed===1)fx.seed=917;
  renderTextureInspector(item);draw();status('文字スタイル：'+fx.style.toUpperCase()+'。MVの動画書き出しにも反映されます。');
 }));
 for(const [id,field] of [['fxIntensity','intensity'],['fxGrain','grain'],['fxIrregularity','irregularity'],['fxDetail','detail']]){
  let saved=false;$(id).addEventListener('focus',()=>saved=false);
  $(id).addEventListener('input',()=>{let item=selected();if(!item)return;if(!saved){stash();saved=true;}ensureFx(item)[field]=clamp(Number($(id).value),0,100);$(id+'Label').textContent=Math.round(ensureFx(item)[field]);draw();});
  $(id).addEventListener('change',()=>{saved=false;renderInspector();});$(id).addEventListener('blur',()=>saved=false);
 }
 for(const [id,field] of [['fxReveal','reveal'],['fxVanish','vanish']])$(id).addEventListener('change',()=>{
  const item=selected();if(!item)return;stash();ensureFx(item)[field]=$(id).value;draw();status('出現・消失演出を更新しました。');
 });
 $('fxReseed').addEventListener('click',()=>{const item=selected();if(!item)return;stash();ensureFx(item).seed=(Math.random()*2000000000|0)+2;draw();status('新しい文字の傷・筆圧パターンを作りました。');});
}
function bindFields(){Object.entries(FIELDS).forEach(([id,[prop,convert]])=>{let element=$(id), saved=false;
 element.addEventListener('focus',()=>{saved=false});
 element.addEventListener('input',()=>{let item=selected();if(!item)return;if(!saved){stash();saved=true;}let value=convert(element.value);item[prop]=value;if(prop==='start'){item.start=Math.min(item.start,item.end-.1);item.keyframes=item.keyframes.filter(k=>k.at<=item.end-item.start);}if(prop==='end'){item.end=Math.max(item.start+.1,item.end);item.keyframes=item.keyframes.filter(k=>k.at<=item.end-item.start);}if(prop==='opacity')$('opacityLabel').textContent=`${Math.round(item.opacity*100)}%`;if(['start','end','text'].includes(prop)){renderTimeline();renderLayers();}draw();});
 element.addEventListener('change',()=>{saved=false;renderInspector();});
 element.addEventListener('blur',()=>{saved=false;renderInspector();});
 });}
function hitTest(nx,ny){for(let i=hitRegions.length-1;i>=0;i--){let {item,bounds:b}=hitRegions[i];let dx=nx*canvas.width-b.x,dy=ny*canvas.height-b.y,ang=-b.rotation;let px=Math.cos(ang)*dx-Math.sin(ang)*dy,py=Math.sin(ang)*dx+Math.cos(ang)*dy;let l=b.align==='left'?0:b.align==='right'?-b.w:-b.w/2;if(px>=l-25&&px<=l+b.w+25&&Math.abs(py)<=b.h/2+25)return item;}return null;}
function pointerCanvasStart(e){if(state.exporting)return;let rect=canvas.getBoundingClientRect(),nx=(e.clientX-rect.left)/rect.width,ny=(e.clientY-rect.top)/rect.height;let hit=hitTest(nx,ny),item=hit;if(hit)select(hit.id);if(!item||!isActive(item,state.time))return;
 let before=cloneItems();activeDrag={mode:'canvas',id:item.id,startX:e.clientX,startY:e.clientY,x:item.x,y:item.y,before,rect};canvas.setPointerCapture(e.pointerId);
}
function pointerCanvasMove(e){if(!activeDrag||activeDrag.mode!=='canvas')return;let d=activeDrag,item=state.items.find(x=>x.id===d.id);if(!item)return;item.x=clamp(d.x+(e.clientX-d.startX)/d.rect.width,-1,2);item.y=clamp(d.y+(e.clientY-d.startY)/d.rect.height,-1,2);if(document.activeElement!==$('xValue'))$('xValue').value=round(item.x*100,2);if(document.activeElement!==$('yValue'))$('yValue').value=round(item.y*100,2);draw();}
function pointerCanvasEnd(){if(!activeDrag||activeDrag.mode!=='canvas')return;let d=activeDrag;activeDrag=null;let item=state.items.find(x=>x.id===d.id);if(item&&(Math.abs(item.x-d.x)>.0001||Math.abs(item.y-d.y)>.0001))stash(d.before);renderInspector();}
function timelinePointerStart(e){if(state.exporting)return;let clip=e.target.closest('.clip');if(clip){let item=state.items.find(x=>x.id===clip.dataset.id);if(!item)return;select(item.id);let edge=e.target.dataset.edge||'move';activeDrag={mode:'clip',id:item.id,edge,startX:e.clientX,start:item.start,end:item.end,before:cloneItems()};e.preventDefault();return;}
 if(e.target.closest('.ruler')){let rect=$('ruler').getBoundingClientRect();let x=e.clientX-rect.left+$('timelineScroll').scrollLeft;setTime(x/state.zoom);activeDrag={mode:'scrub'};e.preventDefault();}
}
function timelinePointerMove(e){if(!activeDrag)return;if(activeDrag.mode==='scrub'){let rect=$('ruler').getBoundingClientRect(),x=e.clientX-rect.left+$('timelineScroll').scrollLeft;setTime(x/state.zoom);return;}
 if(activeDrag.mode!=='clip')return;let d=activeDrag,item=state.items.find(x=>x.id===d.id);if(!item)return;let delta=round((e.clientX-d.startX)/state.zoom,2);
 if(d.edge==='left')item.start=clamp(d.start+delta,0,d.end-.1);else if(d.edge==='right')item.end=clamp(d.end+delta,d.start+.1,state.duration);else{let span=d.end-d.start;item.start=clamp(d.start+delta,0,state.duration-span);item.end=item.start+span;}
 let clip=$(`tracks`).querySelector(`.clip[data-id="${item.id}"]`);if(clip){clip.style.left=item.start*state.zoom+'px';clip.style.width=Math.max(8,(item.end-item.start)*state.zoom)+'px';}draw();}
function timelinePointerEnd(){if(!activeDrag)return;let d=activeDrag;activeDrag=null;if(d.mode==='clip'){let item=state.items.find(x=>x.id===d.id);if(item&&(Math.abs(item.start-d.start)>.0001||Math.abs(item.end-d.end)>.0001))stash(d.before);renderTimeline();renderLayers();renderInspector();}}
function addKeyframe(){let item=selected();if(!item){status('先に文字を選択してください');return;}if(!isActive(item,state.time)){status('キーフレームは文字が表示される時間の中で追加できます。');return;}
 stash();let at=round(state.time-item.start,3);let k={at,x:item.x,y:item.y,rotate:item.rotate,scale:item.scale,opacity:item.opacity};let ix=item.keyframes.findIndex(x=>Math.abs(x.at-at)<.045);if(ix>=0)item.keyframes[ix]=k;else item.keyframes.push(k);refresh();status(`${formatTime(state.time)} にキーフレームを設定しました。`);
}
function downloadBlob(blob,name){let link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),90000);}
function exportProject(){let payload={app:'Lyrica Studio',version:2,created:new Date().toISOString(),videoName:state.videoFile?.name||null,source:{width:canvas.width,height:canvas.height,duration:state.duration},items:state.items};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),'Lyrica-project.json');status('編集プロジェクトを書き出しました。動画ファイル本体は含まれません。');}
async function importProject(file){try{let project=JSON.parse(await file.text());if(!Array.isArray(project.items)||project.items.length>5000)throw new Error('プロジェクト形式が正しくありません');
 let clean=project.items.map((obj,i)=>{let d=newItem(String(obj.text||''),0,2);for(let key of Object.keys(d)){if(Object.prototype.hasOwnProperty.call(obj,key)&&key!=='id')d[key]=obj[key];}d.id=uid();d.keyframes=Array.isArray(d.keyframes)?d.keyframes.filter(k=>Number.isFinite(k.at)&&Number.isFinite(k.x)&&Number.isFinite(k.y)&&Number.isFinite(k.rotate)&&Number.isFinite(k.scale)&&Number.isFinite(k.opacity)).slice(0,200):[];
 d.fx={style:['standard','shatter','graphite'].includes(d.fx?.style)?d.fx.style:'standard',intensity:clamp(Number(d.fx?.intensity??70),0,100),grain:clamp(Number(d.fx?.grain??54),0,100),irregularity:clamp(Number(d.fx?.irregularity??38),0,100),detail:clamp(Number(d.fx?.detail??62),0,100),seed:Number(d.fx?.seed)||1,reveal:['none','write','stagger','flicker'].includes(d.fx?.reveal)?d.fx.reveal:'none',vanish:['none','erase','scatter'].includes(d.fx?.vanish)?d.fx.vanish:'none'};return d;});stash();state.items=clean;state.selected=clean[0]?.id||null;if(!state.videoFile&&Number.isFinite(project.source?.duration)){state.duration=clamp(project.source.duration,1,36000);sizeCanvas(project.source.width||1280,project.source.height||720);}state.isDemo=false;refresh();status('編集プロジェクトを開きました。元動画も必要なら読み込んでください。');}catch(e){status('プロジェクトの読み込みに失敗：'+e.message);}}
async function importVideo(file){if(!file||!file.type.startsWith('video/')){status('動画ファイルを選択してください。');return;}video.pause();if(state.videoURL)URL.revokeObjectURL(state.videoURL);state.videoURL=URL.createObjectURL(file);state.videoFile=file;state.playingDemo=false;video.src=state.videoURL;video.load();status('動画を読み込み中...');
 try{await new Promise((resolve,reject)=>{let timer=setTimeout(()=>reject(Error('動画の読み込みがタイムアウトしました')),30000);video.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});video.addEventListener('error',()=>{clearTimeout(timer);reject(Error('この動画形式はブラウザで再生できません'));},{once:true});});if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('動画の長さが取得できません');state.duration=video.duration;state.time=0;sizeCanvas(video.videoWidth,video.videoHeight);$('videoName').textContent=file.name;if(state.isDemo){state.items=[];state.selected=null;state.isDemo=false;}for(let item of state.items){item.start=clamp(item.start,0,Math.max(0,state.duration-.1));item.end=clamp(item.end,item.start+.1,state.duration);}setTime(0);state.history=[];state.future=[];refresh();status('動画を読み込みました。音声は元動画のものをそのまま使用します。');}catch(e){state.videoFile=null;status(e.message);}}
async function importFont(file){if(!file)return;try{let name=`custom_${Object.keys(state.customFonts).length+1}`;let buffer=await file.arrayBuffer();let font=new FontFace(name,buffer);await font.load();document.fonts.add(font);state.customFonts[name]=`"${name}"`;let o=document.createElement('option');o.value=name;o.textContent=`読込：${file.name}`;$('fontValue').append(o);let item=selected();if(item){stash();item.font=name;}renderInspector();draw();status(`フォントを追加しました：${file.name}（再起動時は再読込が必要です）`);}catch(e){status('フォントが読み込めません：'+e.message);}}
function supportedMime(){if(!window.MediaRecorder||!window.HTMLCanvasElement.prototype.captureStream)return null;let candidates=['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];return candidates.find(s=>MediaRecorder.isTypeSupported(s))||null;}
async function audioForExport(){if(!audioContext){audioContext=new (window.AudioContext||window.webkitAudioContext)();audioSource=audioContext.createMediaElementSource(video);audioDestination=audioContext.createMediaStreamDestination();audioSource.connect(audioContext.destination);audioSource.connect(audioDestination);}await audioContext.resume();return audioDestination.stream.getAudioTracks()[0]||null;}
async function startExport(){if(state.exporting)return;if(!state.videoFile){status('書き出す前に動画を読み込んでください。');return;}let mime=supportedMime();if(!mime){status('このブラウザは映像書き出しに対応していません。Mac/PC版 Chrome または Safari をお試しください。');return;}
 state.exporting=true;state.playingDemo=false;video.pause();let audioTrack=null,audioWarning='';
 // AudioContext is unlocked while the user gesture is still active.
 try{audioTrack=await audioForExport();}catch(err){audioWarning='音声の結合を開始できませんでした。';console.warn(err);}
 $('exportModal').hidden=false;$('saveExport').hidden=true;$('cancelExport').textContent='中止';$('exportProgress').style.width='0%';$('exportPercent').textContent='0%';$('exportText').textContent='書き出し中は画面を閉じず、スリープさせないでください。映像の長さに近い時間がかかります。';
 let stream,recorder,interval=null;const chunks=[];let stopped=false;
 const cleanup=()=>{state.exporting=false;state.stopExport=null;if(interval)clearInterval(interval);if(stream)stream.getTracks().forEach(t=>t.stop());video.pause();draw();};
 try{
   video.currentTime=0;state.time=0;await new Promise(resolve=>{if(video.readyState>=2&&Math.abs(video.currentTime)<.02)return resolve();let timer=setTimeout(resolve,3000);video.addEventListener('seeked',()=>{clearTimeout(timer);resolve();},{once:true});});draw();
   stream=canvas.captureStream(30);if(audioTrack)stream.addTrack(audioTrack);
   recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.min(13000000,Math.max(3000000,canvas.width*canvas.height*4))});
   recorder.addEventListener('dataavailable',e=>{if(e.data?.size>0)chunks.push(e.data);});
   recorder.addEventListener('error',e=>{status('書き出しでエラーが発生：'+(e.error?.message||'不明なエラー'));});
   recorder.addEventListener('stop',()=>{const wasCancelled=stopped;let blob=new Blob(chunks,{type:recorder.mimeType||mime});cleanup();if(!wasCancelled&&blob.size){let ext=blob.type.includes('mp4')?'mp4':'webm';state.latestExport={blob,filename:`Lyrica-MV-${Date.now()}.${ext}`};$('exportProgress').style.width='100%';$('exportPercent').textContent='100%';$('exportText').textContent=`動画が完成しました（${ext.toUpperCase()}）。「完成動画を保存」を押してください。${audioWarning}`;$('saveExport').hidden=false;$('cancelExport').textContent='閉じる';status(`動画を合成しました。完成動画を端末に保存してください。${audioWarning}`);}else if(wasCancelled){$('exportModal').hidden=true;status('書き出しを中止しました。');}else{$('exportModal').hidden=true;status('動画が生成できませんでした。端末の録画対応状況をご確認ください。');}});
   state.stopExport=()=>{stopped=true;video.pause();if(recorder.state!=='inactive')recorder.stop();};
   recorder.start(1000);
   video.onended=()=>{if(recorder.state==='recording'){recorder.requestData();recorder.stop();}};
   await video.play();
   interval=setInterval(()=>{if(!state.exporting)return;let ratio=clamp(video.currentTime/state.duration,0,1);$('exportProgress').style.width=round(ratio*100)+'%';$('exportPercent').textContent=Math.round(ratio*100)+'%';if(video.ended&&recorder.state==='recording')recorder.stop();},120);
 }catch(e){if(recorder&&recorder.state!=='inactive'){stopped=true;recorder.stop();}else cleanup();$('exportModal').hidden=true;status('書き出しに失敗：'+e.message);console.error(e);}
}
async function saveExportToDevice(){const info=state.latestExport;if(!info){status('保存できる動画がありません。');return;}try{const file=new File([info.blob],info.filename,{type:info.blob.type});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Lyrica Studio MV'});status('共有・保存の操作が完了しました。');closeModal('exportModal');return;}}catch(e){if(e.name==='AbortError')return;console.warn('共有は利用できません',e);}downloadBlob(info.blob,info.filename);status('動画のダウンロードを開始しました。Safariでは「ファイルに保存」を選択してください。');closeModal('exportModal');}
function setZoom(val){state.zoom=clamp(val,12,250);$('zoomLabel').textContent=`${state.zoom}px/s`;renderTimeline();}
function openModal(id){$(id).hidden=false;}
function closeModal(id){$(id).hidden=true;}
function initialize(){
 // Demo layer lets the app be explored even before loading a local video.
 let a=newItem('この瞬間を、言葉に',.4,3.6);a.y=.46;a.size=84;a.font='mincho';a.animation='pop';a.stroke=2;a.fx={style:'shatter',intensity:75,grain:45,irregularity:35,detail:69,seed:241,reveal:'none',vanish:'scatter'};
 let b=newItem('Let the light find us',4,3.5);b.y=.57;b.font='serif';b.size=63;b.animation='left';b.color='#ffdaea';b.fx={style:'graphite',intensity:90,grain:70,irregularity:65,detail:75,seed:917,reveal:'write',vanish:'erase'};
 state.items=[a,b];state.selected=a.id;
 bindFields();bindTexture();refresh();$('videoInput').addEventListener('change',e=>{if(e.target.files[0])importVideo(e.target.files[0]);e.target.value='';});$('projectInput').addEventListener('change',e=>{if(e.target.files[0])importProject(e.target.files[0]);e.target.value='';});$('fontInput').addEventListener('change',e=>{if(e.target.files[0])importFont(e.target.files[0]);e.target.value='';});
 $('addText').onclick=addText;$('addTextMini').onclick=addText;$('duplicate').onclick=duplicate;$('deleteSelected').onclick=deleteSelected;
 $('playBtn').onclick=playPause;$('backStep').onclick=()=>setTime(state.time-.1);$('forwardStep').onclick=()=>setTime(state.time+.1);$('toStart').onclick=()=>setTime(0);$('seek').addEventListener('input',e=>setTime(Number(e.target.value)));
 $('undo').onclick=undo;$('redo').onclick=redo;$('zoomOut').onclick=()=>setZoom(state.zoom-15);$('zoomIn').onclick=()=>setZoom(state.zoom+15);$('saveProject').onclick=exportProject;$('exportVideo').onclick=startExport;$('cancelExport').onclick=()=>{if(state.exporting)state.stopExport?.();else closeModal('exportModal');};$('saveExport').onclick=saveExportToDevice;
 $('addKeyframe').onclick=addKeyframe;$('startHere').onclick=()=>{let item=selected();if(!item)return;stash();item.start=clamp(state.time,0,item.end-.1);refresh();};$('endHere').onclick=()=>{let item=selected();if(!item)return;stash();item.end=clamp(state.time,item.start+.1,state.duration);refresh();};
 $('bulkOpen').onclick=()=>openModal('bulkModal');$('bulkClose').onclick=()=>closeModal('bulkModal');$('bulkCancel').onclick=()=>closeModal('bulkModal');$('bulkInsert').onclick=()=>{let lines=$('bulkText').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length){status('歌詞を入力してください。');return;}let duration=clamp(Number($('bulkDuration').value)||3,.2,600),gap=clamp(Number($('bulkGap').value)||0,0,600);stash();let cursor=state.time,added=0;for(let line of lines){if(cursor>=state.duration)break;let item=newItem(line,cursor,duration);state.items.push(item);cursor+=duration+gap;added++;}state.selected=state.items.at(-1)?.id||state.selected;closeModal('bulkModal');$('bulkText').value='';refresh();status(`${added}行の歌詞を配置しました。`);};
 canvas.addEventListener('pointerdown',pointerCanvasStart);canvas.addEventListener('pointermove',pointerCanvasMove);canvas.addEventListener('pointerup',pointerCanvasEnd);canvas.addEventListener('pointercancel',pointerCanvasEnd);
 $('timelineScroll').addEventListener('pointerdown',timelinePointerStart);window.addEventListener('pointermove',timelinePointerMove);window.addEventListener('pointerup',timelinePointerEnd);window.addEventListener('pointercancel',timelinePointerEnd);
 video.addEventListener('ended',()=>{state.time=state.duration;updateTransport();});video.addEventListener('seeked',()=>{if(video.paused){state.time=video.currentTime;draw();updateTransport();}});
 window.addEventListener('keydown',e=>{let typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}else if(!typing&&e.code==='Space'&&!state.exporting){e.preventDefault();playPause();}else if(!typing&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();deleteSelected();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playingDemo)state.playingDemo=false;});
 if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
 updateUndo();requestAnimationFrame(loop);
}
initialize();
