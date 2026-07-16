/*!
 * Derived from Geiss HDR — copyright (c) 2026 Ryan Geiss
 * Original: https://www.geisswerks.com/geiss_hdr
 * License: Apache-2.0 (see amp/src/geiss-hdr/LICENSE.txt)
 *
 * MODIFIED for the amp example app (tinyjsapp-examples), 2026-07-16:
 * bundled to a single classic script, external-audio mode added, HDR path
 * disabled for WKWebView, worker inlined as a Blob. Full sources with every
 * change marked "[amp]" live in amp/src/geiss-hdr/.
 *
 * NOTICE (reproduced from NOTICE.txt as required):
 *
 * This distribution includes software derived from
 * Geiss HDR, copyright 2026 Ryan Geiss, www.geisswerks.com/geiss_hdr
 *
 * Attribution Notice
 * ------------------
 * Derivative works and redistributions must retain this NOTICE file.
 *
 * Naming / Branding Notice
 * ------------------------
 * "Geiss" and "Geiss HDR" are reserved names for the original Geiss HDR project.
 *
 * The Apache-2.0 license does not grant permission to use the names "Geiss" or
 * "Geiss HDR", or any confusingly similar name, as the name or branding of a
 * derivative work, fork, modified version, or redistributed version, except for
 * reasonable and customary use in describing the origin of the work and
 * reproducing the content of this NOTICE file.
 *
 * Use of "Geiss HDR" or "Geiss" in attribution or descriptive text is allowed
 * (and may be required), e.g. "Derived from Geiss HDR", "Fork of Geiss HDR",
 * "Based on Geiss HDR", etc.
 *
 * Use of "Geiss" or "Geiss HDR" as part of the name/branding of a derivative
 * project or product is not permitted, e.g. "Geiss HDR 2.0", "Super Geiss",
 * "GeissFX", or other confusingly similar names.
 *
 * You may use "Geiss HDR" only to truthfully describe origin (and to reproduce
 * this NOTICE), not to imply endorsement or to brand the derivative work.
 *
 * Outputs Permission
 * ------------------
 * See OUTPUTS.txt for the permission grant covering images and video produced
 * by running this software.
 *
 * Notes:
 * - This NOTICE file is provided for attribution and clarity. It does not modify
 *   the Apache-2.0 license terms in LICENSE.txt.
 */
(()=>{var p0=class{constructor({fftSize:t=2048}={}){this.fftSize=t,this.ctx=null,this.analyser=null,this.waveF=null,this.spectrum=null,this.audio_el=null,this.src_node=null,this.mode=null,this.object_url=null,this.media_keys_hooked_up=!1,this.prev_song_requested=!1,this.next_song_requested=!1}_revokeObjectURLIfNeeded(){this.object_url&&(URL.revokeObjectURL(this.object_url),this.object_url=null)}async startTab(){try{this.ctx=new(window.AudioContext||window.webkitAudioContext);let t="CaptureController"in window?new CaptureController:null,e=await navigator.mediaDevices.getDisplayMedia({video:!0,audio:!0,...t?{controller:t}:{}});t?.setFocusBehavior&&t.setFocusBehavior("no-focus-change");for(let i of e.getVideoTracks())i.stop();let r=this.ctx.createMediaStreamSource(e);this.analyser=this.ctx.createAnalyser(),this.analyser.fftSize=this.fftSize,this.analyser.smoothingTimeConstant=.6,this.analyser.minDecibels=-100,this.analyser.maxDecibels=-30,r.connect(this.analyser),this.waveF=new Float32Array(this.analyser.fftSize);let o=this.analyser.frequencyBinCount;return this.spectrum=new Float32Array(o),{success:!0,error:""}}catch(t){return console.error("startTab failed:",t),{success:!1,error:`startTab failed: ${t}`}}}async startMic(){try{this.ctx=new(window.AudioContext||window.webkitAudioContext);let t=await navigator.mediaDevices.getUserMedia({audio:!0}),e=this.ctx.createMediaStreamSource(t);this.analyser=this.ctx.createAnalyser(),this.analyser.fftSize=this.fftSize,this.analyser.smoothingTimeConstant=.6,this.analyser.minDecibels=-100,this.analyser.maxDecibels=-30,e.connect(this.analyser),this.waveF=new Float32Array(this.analyser.fftSize);let r=this.analyser.frequencyBinCount;return this.spectrum=new Float32Array(r),{success:!0,error:""}}catch(t){return console.error("startMic failed:",t),{success:!1,error:`startMic failed; error: ${t}`}}}startExternal(t,e){return this.mode="external",this.ctx=t,this.analyser=this.ctx.createAnalyser(),this.analyser.fftSize=this.fftSize,this.analyser.smoothingTimeConstant=.6,this.analyser.minDecibels=-100,this.analyser.maxDecibels=-30,e.connect(this.analyser),this.waveF=new Float32Array(this.analyser.fftSize),this.spectrum=new Float32Array(this.analyser.frequencyBinCount),{success:!0,error:""}}async startMP3(t,e,r){try{this.mode="mp3",this.ctx=new(window.AudioContext||window.webkitAudioContext),this.analyser=this.ctx.createAnalyser(),this.analyser.fftSize=this.fftSize,this.analyser.smoothingTimeConstant=.6,this.analyser.minDecibels=-100,this.analyser.maxDecibels=-30,this.waveF=new Float32Array(this.analyser.fftSize);let o=this.analyser.frequencyBinCount;this.spectrum=new Float32Array(o);let i=new Audio;return i.src=t,i.loop=r,i.preload="auto",i.volume=Math.max(0,Math.min(1,e)),this.audio_el=i,this.src_node=this.ctx.createMediaElementSource(i),this.src_node.connect(this.analyser),this.src_node.connect(this.ctx.destination),await this.ctx.resume(),this.HookUpMediaKeys(),await i.play(),{success:!0,error:""}}catch(o){return console.error("startMP3 failed:",o),{success:!1,error:`startMP3 failed: ${o}`}}}async loadLocalFile(t,e=1,r=!0){if(!t)return{success:!1,error:"loadLocalFile failed: no file specified"};let o=t.name||"";if(!((t.type||"").startsWith("audio/")||/\.mp3$/i.test(o)||/\.wav$/i.test(o)||/\.m4a$/i.test(o)||/\.ogg$/i.test(o)))return console.warn("loadLocalFile: not an audio file:",t),{success:!1,error:"loadLocalFile failed: file ${file} is not an audio file"};this._revokeObjectURLIfNeeded();let c=URL.createObjectURL(t);if(this.object_url=c,this.mode==="mp3"&&this.audio_el)try{return this.audio_el.pause(),this.audio_el.src=c,this.audio_el.currentTime=0,this.audio_el.volume=Math.max(0,Math.min(1,e)),this.audio_el.loop=r,this.HookUpMediaKeys(),await this.audio_el.play(),{success:!0,error:""}}catch(n){return console.error("loadLocalFile replace failed:",n),{success:!1,error:`loadLocalFile failed: ${n}`}}return await this.startMP3(c,e,r)}setVolume(t){this.audio_el&&(this.audio_el.volume=Math.max(0,Math.min(1,t)))}isPaused(){return this.audio_el.paused}togglePause(){return this.audio_el.paused?(this.audio_el.play(),!0):(this.audio_el.pause(),!1)}adjustVolume(t){this.audio_el&&this.setVolume(this.audio_el.volume+t)}rewindCurrentSong(){this.audio_el.currentTime=0}play(){this.audio_el.play()}songHasEnded(){return this.audio_el.ended}getCurrentSongTimeInSeconds(){return this.audio_el.currentTime}getCurrentSongLengthInSeconds(){return this.audio_el.duration}seekRelative(t){this.audio_el&&(this.audio_el.currentTime+=t)}HookUpMediaKeys(){this.media_keys_hooked_up||(this.media_keys_hooked_up=!0,"mediaSession"in navigator&&(navigator.mediaSession.setActionHandler("previoustrack",()=>{this.prev_song_requested=!0}),navigator.mediaSession.setActionHandler("nexttrack",()=>{this.next_song_requested=!0})))}async loadNewSong(t){if(this.audio_el){this.audio_el.src=t,this.audio_el.currentTime=0;try{await this.audio_el.play()}catch(e){console.error("loadNewSong failed:",e)}}}_hzToBin(t){let e=this.ctx.sampleRate/2,r=this.analyser.frequencyBinCount,o=Math.max(0,Math.min(e,t));return Math.round(o/e*(r-1))}_binToHz(t){let e=this.ctx.sampleRate/2,r=this.analyser.frequencyBinCount;return t*(e/(r-1))}_dbToPerceptual(t,e){let r=Math.pow(10,t/10);return r*=e,r}NormalizeSpectrumAndSumBands(t,e){let r=new Array(4),o=t.length;for(let i=0;i<o;i++){let a=this._binToHz(i);t[i]=this._dbToPerceptual(t[i],a)}if(e!=null){r=new Float32Array(e.length);for(let i=0;i<e.length;i++){let a=this._hzToBin(e[i].f0),c=this._hzToBin(e[i].f1),n=Math.max(0,Math.min(a,c)),x=Math.min(o-1,Math.max(a,c)),w=0;for(let F=n;F<=x;F++)w+=t[F];let M=x>=n?x-n+1:1;r[i]=w/M}}return r}isPrevSongRequested(){return this.prev_song_requested?(this.prev_song_requested=!1,!0):!1}isNextSongRequested(){return this.next_song_requested?(this.next_song_requested=!1,!0):!1}getFrame({waveScale:t=1,wantWave:e=!0,wantSpec:r=!0,bandsHz:o=null}={}){if(!this.analyser)return null;let i=null;if(e){this.analyser.getFloatTimeDomainData(this.waveF);let n=0;for(let x=0;x<this.waveF.length;x++){let w=this.waveF[x]*t;this.waveF[x]=w,n+=w*w}i=Math.sqrt(n/this.waveF.length)}let a=null,c=null;return r&&(this.analyser.getFloatFrequencyData(this.spectrum),a=this.spectrum,c=this.NormalizeSpectrumAndSumBands(a,o)),{wave:e?this.waveF:null,rms:i,spectrum:a,bandEnergy:c}}};var Ct=class{constructor(t,e){let r=t*1/e,o=-1,i=-1,a=1,c=1;r>1?(i/=r,c/=r):(o*=r,a*=r),this.W=t,this.H=e,this.inv_W=1/t,this.inv_H=1/e,this.x0x1=a-o,this.y0y1=c-i,this.inv_x0x1=1/this.x0x1,this.inv_y0y1=1/this.y0y1}NormToScreenX(t){return(t*this.inv_x0x1+.5)*this.W}NormToScreenY(t){return(t*this.inv_y0y1+.5)*this.H}ScreenToNormX(t){return(t*this.inv_W-.5)*this.x0x1}ScreenToNormY(t){return(t*this.inv_H-.5)*this.y0y1}};function Ar(s,t,e,r,o,i,a,c){let n=e.ScreenToNormX(s),x=e.ScreenToNormY(t),w=n,M=x,F=r[0].warp_map.src_dxy,A=r[1].warp_map.src_dxy,R=r[2].warp_map.src_dxy,P=r[3].warp_map.src_dxy,D=4;for(let k=0;k<D;k++){let B=(w*.5+.5)*512,V=(M*.5+.5)*512,H=Math.max(0,Math.min(511,B|0)),l=Math.max(0,Math.min(511,V|0)),u=Math.max(0,Math.min(511,B+1|0)),f=Math.max(0,Math.min(511,V+1|0)),p=B-Math.floor(B),_=V-Math.floor(V),S=F[(H+l*512)*2+0]*(1-p)*(1-_)+F[(u+l*512)*2+0]*p*(1-_)+F[(H+f*512)*2+0]*(1-p)*_+F[(u+f*512)*2+0]*p*_,d=A[(H+l*512)*2+0]*(1-p)*(1-_)+A[(u+l*512)*2+0]*p*(1-_)+A[(H+f*512)*2+0]*(1-p)*_+A[(u+f*512)*2+0]*p*_,v=R[(H+l*512)*2+0]*(1-p)*(1-_)+R[(u+l*512)*2+0]*p*(1-_)+R[(H+f*512)*2+0]*(1-p)*_+R[(u+f*512)*2+0]*p*_,y=P[(H+l*512)*2+0]*(1-p)*(1-_)+P[(u+l*512)*2+0]*p*(1-_)+P[(H+f*512)*2+0]*(1-p)*_+P[(u+f*512)*2+0]*p*_,g=F[(H+l*512)*2+1]*(1-p)*(1-_)+F[(u+l*512)*2+1]*p*(1-_)+F[(H+f*512)*2+1]*(1-p)*_+F[(u+f*512)*2+1]*p*_,W=A[(H+l*512)*2+1]*(1-p)*(1-_)+A[(u+l*512)*2+1]*p*(1-_)+A[(H+f*512)*2+1]*(1-p)*_+A[(u+f*512)*2+1]*p*_,T=R[(H+l*512)*2+1]*(1-p)*(1-_)+R[(u+l*512)*2+1]*p*(1-_)+R[(H+f*512)*2+1]*(1-p)*_+R[(u+f*512)*2+1]*p*_,N=P[(H+l*512)*2+1]*(1-p)*(1-_)+P[(u+l*512)*2+1]*p*(1-_)+P[(H+f*512)*2+1]*(1-p)*_+P[(u+f*512)*2+1]*p*_,E=S*o[0]+d*o[1]+v*o[2]+y*o[3],$=g*o[0]+W*o[1]+T*o[2]+N*o[3];E*=.5*i,$*=.5*i,E+=a*e.inv_W*e.x0x1,$+=c*e.inv_H*e.y0y1,w=n-E,M=x-$}let h=e.NormToScreenX(w),m=e.NormToScreenY(M);return{x:h,y:m}}function Sr(s,t,e,r,o,i,a,c,n,x){let w=new Ct(n,x),M=s.src_dxy,F=t.src_dxy,A=e.src_dxy,R=r.src_dxy,P=Math.sqrt(n*n+x*x),D=Math.sqrt(512*512+512*512),h=64,m=32,k=8,B=0,V=0,H=new Array(h),l=k;for(let f=0;f<h;f++){let p=(Math.random()+Math.random())*.5*n|0,_=(Math.random()+Math.random())*.5*x|0,S=w.ScreenToNormX(p),d=w.ScreenToNormY(_),v=(S*.5+.5)*511,y=(d*.5+.5)*511;for(let g=0;g<m;g++){let W=v+.5|0,N=((y+.5|0)*512+W)*2,E=M[N+0]*o+F[N+0]*i+A[N+0]*a+R[N+0]*c,$=M[N+1]*o+F[N+1]*i+A[N+1]*a+R[N+1]*c;E=E*.5*512,$=$*.5*512;let U=v+E*l+.5|0,J=y+$*l+.5|0;v=Math.max(0,Math.min(511,U)),y=Math.max(0,Math.min(511,J))}B+=v,V+=y,H[f]={wx:v,wy:y}}B/=h,V/=h;let u=0;for(let f=0;f<h;f++){let p=B-H[f].wx,_=V-H[f].wy,S=Math.sqrt(p*p+_*_);u+=S}return u/=h,u/=D,B=B*(2/511)-1,V=V*(2/511)-1,{cx:B,cy:V,rad:u,end_xy:H}}var m0=256,Tr=m0-1,js=0,ft=class{constructor(t=0,e=0,r=-1,o=2){this.mode=t|0,this.weight=+e,this.index=js++}},Ye=-1,Et=[new ft(0,.55),new ft(1,2.25),new ft(2,.53),new ft(3,2),new ft(4,1.3),new ft(5,.3),new ft(6,.3),new ft(7,.04),new ft(8,1.5),new ft(9,.95),new ft(10,.15),new ft(11,.05),new ft(12,1.66),new ft(13,.06),new ft(14,.3),new ft(15,.25),new ft(16,1.3)];function Xs(s,t,e){return s*(1-e)+t*e}function Pr(s){return s*s*(3-2*s)}function Xe(s,t,e){let r=Math.cos(e),o=Math.sin(e),i=s*r-t*o,a=s*o+t*r;return{x:i,y:a}}function Ys(s,t,e){return s*Math.pow(t/s,e)}function x0(s,t,e){return s+(t-s)*e}function Er(s){let t=512,e=512,r={wave_prefs_weight:1,hog_motion_weight:1,flat_angle_lo:-3.141592,flat_angle_hi:3.141592,flat_angle_bias_toward_horizontal_angles:1.7,flat_scale:1,flat_is_stereo_chance:.18,flat_stereo_sep_lo:.55,flat_stereo_sep_hi:.85,flat_stereo_amplitude_scale:1,flat_cx_lo:-.2,flat_cx_hi:.2,flat_cy_lo:-.2,flat_cy_hi:.2,circ_rad_lo:.75,circ_rad_hi:1.3,circ_scale:1,circ_cx_lo:-.05,circ_cx_hi:.05,circ_cy_lo:-.05,circ_cy_hi:.05,use_motion_center_as_wave_center_prob:.93,use_motion_center_as_wave_center_power:.4,radial_beat_dots_prob:.03,random_beat_dots_prob:.01,fading_dots_prob:.09,grid_dots_prob:.005,net_motion:0,net_zoom_motion:0,in_or_out_motion:0,net_clockwise_motion:0,cw_or_ccw_motion:0,angular_motion_mag:0,radial_motion_mag:0,abs_radial_motion_mag:0,abs_angular_motion_mag:0},o=t*e,i=new Float32Array(o*2),a=t*1/e,c=-1,n=-1,x=1,w=1;a>1?(n/=a,w/=a):(c*=a,x*=a);let M=1/t,F=1/e,A=x-c,R=w-n,P=1/A,D=1/R,h=new Float32Array(m0);for(let l=0;l<m0;l++)h[l]=Math.random();let m=0,k=0;if(Ye>=0&&(s=Ye),!(s<0)){if(s==4){for(let u=0;u<e;u++)for(let f=0;f<t;f++,k+=2)i[k+0]=0,i[k+1]=0;let l=2+34*h[m++]|0;for(let u=0;u<l;u++){let f=(h[m++]-.5)*A,p=(h[m++]-.5)*R,_=.3+.5*h[m++]*Math.min(1,10/l),S=(.4+.4*h[m++])*(h[m++]>.5?1:-1)*.1*Math.pow(Math.min(1,3/l),.7),d=Math.max(0,Math.min(t,((f-_)*P+.5)*t))|0,v=Math.max(0,Math.min(e,((p-_)*D+.5)*e))|0,y=Math.max(0,Math.min(t,((f+_)*P+.5)*t))|0,g=Math.max(0,Math.min(e,((p+_)*D+.5)*e))|0;for(let W=v;W<g;W++){let T=(W*(2/e)-1)*(R*.5);k=(W*t+d)*2;for(let N=d;N<y;N++,k+=2){let E=(N*(2/t)-1)*(A*.5),$=((E-f)*(E-f)+(T-p)*(T-p))*(1/(_*_));if($<1){let U=Math.pow($,.333),J=E,K=T;U=Pr(U);let X=E-f,Z=T-p,tt=(1-U)*S,b=X*Math.cos(tt)-Z*Math.sin(tt),O=X*Math.sin(tt)+Z*Math.cos(tt);J=f+b,K=p+O,i[k+0]+=J-E,i[k+1]+=K-T}}}}}else if(s==5){let l=.5+h[m++]*3.5,u=h[m++]*(1/l),f=h[m++]*(1/l),p=(.1+.9*h[m++]*h[m++])*(h[m++]>.5?1:-1)*.25,_=h[m++]*6.28,S=h[m++]>.5;for(let d=0;d<e;d++){let v=(d*(2/e)-1)*(R*.5);v+=f;for(let y=0;y<t;y++,k+=2){let g=(y*(2/t)-1)*(A*.5);g+=u;let W=Xe(g,v,_),T=W.x,N=W.y,E=Math.floor(T*l),$=Math.floor(N*l),U=E*3+$*7|0,J=S?h[U&Tr]*2-1:1,K=(E+.5)*(1/l),X=($+.5)*(1/l),Z=((T-K)*(T-K)+(N-X)*(N-X))*(l*l*4),tt=Math.pow(Z,.333),b=T,O=N;if(tt<1){tt=Pr(tt);let I=T-K,j=N-X,C=(1-tt)*p,q=I*Math.cos(C*J)-j*Math.sin(C*J),_t=I*Math.sin(C*J)+j*Math.cos(C*J);b=K+q,O=X+_t}b-=T,O-=N;let z=Xe(b,O,-_);b=z.x,O=z.y,i[k+0]=b,i[k+1]=O}}}else if(s==6){let l=2+h[m++]*8,u=h[m++]*(1/l),f=h[m++]*(1/l),p=1,_=(.002+.028*h[m++])*(h[m++]<.5?1:-1)*Math.min(1,4/l),S=.5+2.5*h[m++],d=Math.max(0,Math.min(1,h[m++]*3-1)),v=h[m++]*6.28;for(let y=0;y<e;y++){let g=(y*(2/e)-1)*(R*.5);for(let W=0;W<t;W++,k+=2){let T=(W*(2/t)-1)*(A*.5),N=Xe(T,g,v),E=N.x,$=N.y;E+=u,E=E*l*.5;let U=Math.floor(E);E-=U,E=E*2-1,$+=f,$=$*l*.5;let J=Math.floor($);$-=J,$=$*2-1;let K=U*3+J*7|0,X=E,Z=$;var B=Math.sqrt(X*X+Z*Z);B=Math.pow(B,S);let b=_*Math.max(0,1-B)*Xs(1,h[K&Tr]*2-1,d),O=(E*Math.cos(b)-$*Math.sin(b))*p,z=(E*Math.sin(b)+$*Math.cos(b))*p;O-=E,z-=$;let I=Xe(O,z,-v);O=I.x,z=I.y,i[k+0]=O,i[k+1]=z}}}else if(s==10){let l=.4+1.6*h[m++];h[m++]<.3&&(l=l*-.25);let u=3+Math.floor(h[m++]*6),f=(h[m++]*2-1)*.12,p=(h[m++]*2-1)*.12;for(let _=0;_<e;_++){let S=(_*(2/e)-1)*(R*.5);for(let d=0;d<t;d++,k+=2){let v=(d*(2/t)-1)*(A*.5),y=v-f,g=S-p,W=Math.atan2(y,g),T=.987+.01*Math.cos(W*u),N=v*T,E=S*T,$=Math.sqrt(y*y+g*g),U=Math.max(0,Math.min(1,($-.05)*4));N=v+(N-v)*U*l,E=S+(E-S)*U*l,i[k+0]=N-v,i[k+1]=E-S}}}else if(s==9){r.circ_scale=4;let l=(h[m++]*2-1)*.35,u=(h[m++]*2-1)*.35,f=6+18*h[m++],p=h[m++]*6.28,_=(12e-5+5e-5*h[m++])/f*100*(h[m++]<.5?1:-1),S=h[m++]*2-1;for(let d=0;d<e;d++){let v=(d*(2/e)-1)*(R*.5);for(let y=0;y<t;y++,k+=2){let g=(y*(2/t)-1)*(A*.5),W=g-l,T=v-u,N=Math.sqrt(W*W+T*T),E=1+_*(Math.cos(N*f+p)+S),$=g*E,U=v*E;i[k+0]=$-g,i[k+1]=U-v}}}else if(s==8){r.circ_scale=4;let l=(h[m++]*2-1)*.45,u=(h[m++]*2-1)*.45,f=5+19*h[m++],p=(.001+.004*h[m++]*h[m++])*(h[m++]<.5?-1:1)*.21*Math.pow(13/f,.6)*4,_=h[m]*2-1;for(let S=0;S<e;S++){let d=(S*(2/e)-1)*(R*.5);for(let v=0;v<t;v++,k+=2){let y=(v*(2/t)-1)*(A*.5),g=y-l,W=d-u,T=Math.sqrt(g*g+W*W),N=(Math.cos(T*f)+_)*p,E=g*Math.cos(N)-W*Math.sin(N)+l,$=g*Math.sin(N)+W*Math.cos(N)+u;i[k+0]=E-y,i[k+1]=$-d}}}else if(s==2){r.wave_prefs_weight*=5;let l=.027*(.1+.9*h[m++]),u=h[m++]*6.28,f=Math.cos(u),p=Math.sin(u),_=(h[m++]*2-1)*.0015,S=Math.cos(_),d=Math.sin(_);for(let v=0;v<e;v++){let y=(v*(2/e)-1)*(R*.5);for(let g=0;g<t;g++,k+=2){let W=(g*(2/t)-1)*(A*.5),T=W*f-y*p,N=W*p+y*f,E=W,$=y,U=1-1/(-N+1.4)*l;E*=U,$*=U,T=E*S-$*d,N=E*d+$*S,E=T,$=N,i[k+0]=E-W,i[k+1]=$-y}}}else if(s==11){r.wave_prefs_weight*=10,r.circ_rad_lo=.9,r.circ_rad_hi=1.5;let l=.75+1.5*h[m++];for(let u=0;u<e;u++){let f=(u*(2/e)-1)*(R*.5);for(let p=0;p<t;p++,k+=2){let _=(p*(2/t)-1)*(A*.5),S=_,d=f,y=.97+.1*Math.sqrt(_*_+f*f);y=Math.pow(y,4),S*=y,d*=y,S=_+(S-_)*-l,d=f+(d-f)*-l,i[k+0]=S-_,i[k+1]=d-f}}}else if(s==0){r.wave_prefs_weight*=10,r.type_flat_plus_circ*=1.4;let l=.004+.016*h[m++];h[m++]<.1&&(l*=-.25);let u=(h[m++]*2-1)*.0015,f=Math.cos(u),p=Math.sin(u);for(let _=0;_<e;_++){let S=(_*(2/e)-1)*(R*.5);for(let d=0;d<t;d++,k+=2){let v=(d*(2/t)-1)*(A*.5),y=v+(0-v)*l,g=S+(0-S)*l,W=y*f-g*p,T=y*p+g*f;y=W,g=T,i[k+0]=y-v,i[k+1]=g-S}}}else if(s==1){r.wave_prefs_weight*=10,r.type_flat_plus_circ*=1.4;let l=(.4+1.6*h[m++])*.03*1.8;h[m++]<.1&&(l*=-.4);let u=(h[m++]*2-1)*.0015,f=Math.cos(u),p=Math.sin(u);for(let _=0;_<e;_++){let S=(_*(2/e)-1)*(R*.5);for(let d=0;d<t;d++,k+=2){let v=(d*(2/t)-1)*(A*.5),y=v*v+S*S,g=v+(0-v)*y*l,W=S+(0-S)*y*l,T=g*f-W*p,N=g*p+W*f;g=T,W=N,i[k+0]=g-v,i[k+1]=W-S}}}else if(s==3){r.wave_prefs_weight*=.01;var V=.002+.008*h[m++];h[m++]<.5&&(V*=-1);var H=V;h[m++]<.3&&(H=V*h[m++]*2,h[m++]<.5&&(H*=-1));for(let l=0;l<e;l++){let u=(l*(2/e)-1)*(R*.5);for(let f=0;f<t;f++,k+=2){let p=(f*(2/t)-1)*(A*.5),_=Math.sqrt(p*p+u*u),S=V+(H-V)*_,d=p*Math.cos(S)-u*Math.sin(S),v=p*Math.sin(S)+u*Math.cos(S);i[k+0]=d-p,i[k+1]=v-u}}}else if(s==12){r.wave_prefs_weight*=10;let l=.015,u=.08,f=Math.pow(h[m++],3),p=x0(l,u,h[m++]),_=(h[m++]*2-1)*.0015,S=Math.cos(_),d=Math.sin(_);for(let v=0;v<e;v++){let y=(v*(2/e)-1)*(R*.5);for(let g=0;g<t;g++,k+=2){let W=(g*(2/t)-1)*(A*.5),T=Math.sqrt(W*W+y*y+1e-5),N=1/T,E=W*N,$=y*N,U=N;U+=p;let J=1/U,K=W+E*(J-T),X=y+$*(J-T),Z=K*S-X*d,tt=K*d+X*S;K=Z,X=tt,i[k+0]=K-W,i[k+1]=X-y}}}else if(s==7){r.wave_prefs_weight*=10;let l=x0(1.03,1.1,h[m++]),u=(h[m++]+h[m++])*.5,f=Ys(1.5,4,u),p=1/f,_=.1+.4*h[m++];for(let S=0;S<e;S++){let d=(S*(2/e)-1)*(R*.5);for(let v=0;v<t;v++,k+=2){let y=(v*(2/t)-1)*(A*.5),g=Math.sqrt(y*y+d*d+1e-5),W=Math.pow(g*f,l)*p,T=1/g,N=y*T,E=d*T,$=y+N*(W-g)*_,U=d+E*(W-g)*_;i[k+0]=$-y,i[k+1]=U-d}}}else if(s==13){r.wave_prefs_weight*=10;let l=x0(.003,.01,h[m++])*(h[m++]>.5?1:-1);for(let u=0;u<e;u++){let f=(u*(2/e)-1)*(R*.5);for(let p=0;p<t;p++,k+=2){let _=(p*(2/t)-1)*(A*.5),S=Math.sqrt(_*_+f*f),d=f,v=-_,y=d<0?-1:1,g=v<0?-1:1;d*=d*y,v*=v*g;let W=1/Math.sqrt(d*d+v*v+1e-5);d*=W,v*=W;let T=_+d*l*S,N=f+v*l*S;i[k+0]=T-_,i[k+1]=N-f}}}else if(s==14){let l=(h[m++]*2-1)*.08,u=(h[m++]*2-1)*.08,f=x0(.008,.025,h[m++])*(h[m++]>.5?1:-1);for(let p=0;p<e;p++){let _=(p*(2/e)-1)*(R*.5);for(let S=0;S<t;S++,k+=2){let d=(S*(2/t)-1)*(A*.5),v=d-l,y=_-u,W=Math.sqrt(v*v+y*y)*f,T=Xe(v,y,W),N=l+T.x,E=u+T.y;i[k+0]=N-d,i[k+1]=E-_}}}else if(s==15){r.wave_prefs_weight*=10,r.hog_motion_weight*=10;let l=h[m++]*6.28,u=Math.cos(l),f=Math.sin(l),p=Math.cos(-l),_=Math.sin(-l),S=(.015+.015*h[m++])*1,d=1.01+.5*h[m++],v=(h[m++]*2-1)*.6,y=v*Math.cos(-l+Math.PI/2),g=v*Math.sin(-l+Math.PI/2);h[m++]<.99&&(r.flat_angle_lo=-l,r.flat_angle_hi=-l,r.flat_cx_lo=y,r.flat_cx_hi=y,r.flat_cy_lo=g,r.flat_cy_hi=g,r.flat_angle_bias_toward_horizontal_angles=0,r.flat_stereo_sep_lo*=.3,r.flat_stereo_sep_hi*=.75,r.flat_stereo_amplitude_scale*=.6,r.circ_cx_lo=y,r.circ_cx_hi=y,r.circ_cy_lo=g,r.circ_cy_hi=g);for(let W=0;W<e;W++){let T=(W*(2/e)-1)*(R*.5);for(let N=0;N<t;N++,k+=2){let E=(N*(2/t)-1)*(A*.5),$=E-y,U=T-g,J=$*u-U*f,K=$*f+U*u,X=J,Z=K,tt=1,b=X,O=Z,z=tt,I=1/Math.sqrt(b*b+O*O+z*z);b*=I,O*=I,z*=I;let C=d*(K<0?-1:1)/O,q=b*C,_t=O*C,it=z*C;it+=S,b=q,O=_t,z=it,I=1/Math.sqrt(b*b+O*O+z*z),b*=I,O*=I,z*=I,C=1/z;let vt=b*C,Mt=O*C,dt=vt*p-Mt*_,Zt=vt*_+Mt*p;dt+=y,Zt+=g,i[k+0]=dt-E,i[k+1]=Zt-T}}}else if(s==16){r.wave_prefs_weight*=.1;let l=5,u=.4+.6*h[m++],f=new Float32Array(l),p=new Float32Array(l),_=new Float32Array(l),S=new Float32Array(l),d=new Float32Array(l),v=0;for(let U=0;U<l;U++)f[U]=h[m++]*6.28,p[U]=Math.cos(f[U]),_[U]=Math.sin(f[U]),d[U]=h[m++]*u*.002*.5*1.3,S[U]=h[m++]*12*2,v+=f[U];let y=Math.cos(-v),g=Math.sin(-v),W=4,T=t/W+1|0,N=e/W+1|0,E=new Float32Array(T*N),$=new Float32Array(T*N);for(let U=0;U<N;U++){let J=(U*(2/N)-1)*(R*.5);for(let K=0;K<T;K++){let X=(K*(2/T)-1)*(A*.5),Z=X,tt=J;for(let z=0;z<l;z++){let I=Z*p[z]-tt*_[z],j=Z*_[z]+tt*p[z];Z=I,tt=j,Z+=Math.cos(tt*S[z])*d[z]}let b=Z*y-tt*g,O=Z*g+tt*y;E[U*T+K]=b-X,$[U*T+K]=O-J}}k=0;for(let U=0;U<e;U++){let J=U*(N-1)/e,K=Math.floor(J),X=J-K;for(let Z=0;Z<t;Z++,k+=2){let tt=Z*(T-1)/t,b=Math.floor(tt),O=tt-b,z=(K+0)*T+(b+0),I=(K+0)*T+(b+1),j=(K+1)*T+(b+0),C=(K+1)*T+(b+1),q=(1-X)*(1-O),_t=(1-X)*O,it=X*(1-O),vt=X*O,Mt=E[z]*q+E[I]*_t+E[j]*it+E[C]*vt,dt=$[z]*q+$[I]*_t+$[j]*it+$[C]*vt;i[k+0]=Mt,i[k+1]=dt}}}else if(s==98||s==99)r.wave_prefs_weight=100,r.hog_motion_weight=100,r.flat_angle_lo=0,r.flat_angle_hi=0,r.flat_is_stereo_chance=0,r.flat_cx_lo=-.1,r.flat_cx_hi=.1,r.flat_cy_lo=-.2,r.flat_cy_hi=.2,r.use_motion_center_as_wave_center_prob=0;else if(s==17){let l=(h[m++]*2-1)*.08,u=(h[m++]*2-1)*.08;for(let f=0;f<e;f++){let p=(f*(2/e)-1)*(R*.5);for(let _=0;_<t;_++,k+=2){let S=(_*(2/t)-1)*(A*.5),d=S-l,v=p-u,g=1/(Math.sqrt(d*d+v*v)+1e-4),W=d*g,T=v*g,$=1/(g+.01)-1e-4,U=$*W,J=$*T,K=l+U,X=u+J;i[k+0]=K-S,i[k+1]=X-p}}}}if(m>m0)throw new Error("Too many random numbers used when generating warp map for mode ",s);{let l=Math.sqrt(t*t+e*e),u=256,f=100/l,p=t/2,_=e/2,S=0,d=0,v=0,y=0,g=0;for(let W=0;W<u;W++){let T=(Math.random()+Math.random())*.5,N=(Math.random()+Math.random())*.5,E=T*(t-1)|0,$=N*(e-1)|0,U=($*t+E)*2,J=E+i[U+0]*(.5*t),K=$+i[U+1]*(.5*e),X=E-p,Z=$-_,tt=1/Math.sqrt(X*X+Z*Z+1e-5);X*=tt,Z*=tt;let b=-Z,O=X,z=(E-J)*f,I=($-K)*f,j=X*z+Z*I,C=b*z+O*I;S+=Math.sqrt(z*z+I*I),d+=j,v+=Math.abs(j),y+=C,g+=Math.abs(C)}r.net_motion=S/u,r.net_zoom_motion=d/u,r.in_or_out_motion=v/u,r.net_clockwise_motion=y/u,r.cw_or_ccw_motion=g/u}return{mode:s,W:t,H:e,warp_prefs:r,src_dxy:i,randoms:h}}function Wr(s,t){let e=s.length,r=t|0;if(r<=0)return s;let o=new Float32Array(e);if(r<=0)return o.set(s),o;if(e<=r)return s;let i=2*r+1;if(i>=e)return s;let a=0;for(let n=0;n<=r;n++)a+=s[n];o[0]=a/(r+1);for(let n=1;n<=r;n++)a+=s[n+r],o[n]=a/(n+r+1);let c=1/i;for(let n=r+1;n<=e-r-1;n++)a+=s[n+r]-s[n-r-1],o[n]=a*c;for(let n=e-r;n<e;n++)a-=s[n-r-1],o[n]=a/(e-n+r);return o}function Qs(s){let e=(1-Math.abs(s-.5)*2)*5-2;return Math.max(0,Math.min(15,e*15))}function Js(s){let t=s.length>>1,e=new Float32Array(t);for(let r=0,o=0;o<t;o++,r+=2)e[o]=(s[r]+s[r+1])*.5;return e}function y0(s,t,e,r){let o=0;if(e)for(let i=0;i<t.length;i++)o+=s[r+i]*t[i]*e[i];else for(let i=0;i<t.length;i++)o+=s[r+i]*t[i]*15;return o}function Fr(s,t){let e=[s];for(let r=1;r<=t;r++)e.push(Js(e[r-1]));return e}function Zs(s){let t=new Uint8Array(s);for(let e=0;e<s;e++){let r=(e+.5)/s;t[e]=Qs(r)&15}return t}function to(s){let t=s.length>>1,e=new Uint8Array(t);for(let r=0,o=0;o<t;o++,r+=2)e[o]=s[r]+s[r+1]+1>>1&15;return e}function eo(s,t,e,r){let o=t.length-1,i=s[o],a=t[o],c=e[o],n=i.length-a.length,x=0,w=-1/0;for(let M=0;M<=n;M++){let F=y0(i,a,c,M);F>w&&(w=F,x=M)}for(let M=o-1;M>=0;M--){let F=s[M],A=t[M],R=e[M],P=F.length-A.length,D=x<<1,h=D-1,m=D,k=D+1;h<0&&(h=0),k>P&&(k=P),m<0&&(m=0),m>P&&(m=P);let B=m,V=y0(F,A,R,m);if(h!==m){let H=y0(F,A,R,h);H>V&&(V=H,B=h)}if(k!==m&&k!==h){let H=y0(F,A,R,k);H>V&&(V=H,B=k)}x=B,w=V}return x<0&&(x=0),x>r&&(x=r),{offset:x,score:w}}function ro(s,t){let e=0,r=t;for(;e<4&&r>>1>=48&&s>>1>t>>1;)e++,r>>=1;return e}var g0=class{constructor(){this.ORIG_SAMPLE_COUNT=0,this.ALIGNED_SAMPLE_COUNT=0,this.MAX_OFF=0,this.levels=0,this.prevAligned=null,this.tmpOrig=null}_reinit(t){this.ORIG_SAMPLE_COUNT=t,this.prevAligned=null,this.tmpOrig=new Float32Array(this.ORIG_SAMPLE_COUNT)}alignFromF(t,e,r){if(this.ALIGNED_SAMPLE_COUNT=Math.floor(r*e),this.MAX_OFF=this.ORIG_SAMPLE_COUNT-this.ALIGNED_SAMPLE_COUNT,this.MAX_OFF<0&&(this.MAX_OFF=0),this.levels=ro(this.ORIG_SAMPLE_COUNT,this.ALIGNED_SAMPLE_COUNT),(r|0)<=0)throw new Error(`ORIG_SAMPLE_COUNT must be > 0, got ${r}`);if(!t||t.length<r)throw new Error(`waveF.length (${t?t.length:"null"}) < ORIG_SAMPLE_COUNT (${r})`);if((this.ORIG_SAMPLE_COUNT!==r||!this.tmpOrig||this.tmpOrig.length!==r)&&this._reinit(r),this.tmpOrig.set(t.subarray(0,r)),!this.prevAligned){let c=this.MAX_OFF>>1,n=new Float32Array(this.ALIGNED_SAMPLE_COUNT);return n.set(this.tmpOrig.subarray(c,c+this.ALIGNED_SAMPLE_COUNT)),this.prevAligned=n,n}let o=Fr(this.prevAligned,this.levels),a=[Zs(o[0].length)];for(let c=1;c<o.length;c++)a.push(to(a[c-1]));if(a.length!==o.length)throw new Error(`W_pyr length mismatch: W=${a.length} T=${o.length} levels=${this.levels} aligned=${this.ALIGNED_SAMPLE_COUNT}`);{let c=this.tmpOrig.length,n=[];for(let A=0;A<4;A++)n.push(new Float32Array(c));for(let A=0;A<c;A++)n[0][A]=this.tmpOrig[A],n[1][A]=this.tmpOrig[c-1-A],n[2][A]=-this.tmpOrig[A],n[3][A]=-this.tmpOrig[c-1-A];let x=-1,w=-1/0,M=-1;for(let A=0;A<4;A++){let R=Fr(n[A],this.levels),P=eo(R,o,a,this.MAX_OFF);P.score>w&&(x=A,w=P.score,M=P.offset)}let F=new Float32Array(this.ALIGNED_SAMPLE_COUNT);return F.set(n[x].subarray(M,M+this.ALIGNED_SAMPLE_COUNT)),this.prevAligned=F,F}}};function se(s){console.log(s);let t=document.getElementById("fatal_overlay");t.textContent=s,t.classList.add("show")}var Nr=`(() => {
  // const.js
  var kWarpMapSize = 512;

  // motion.js
  var WarpMapRandomNumberCount = 256;
  var WarpMapRandomNumberMask = WarpMapRandomNumberCount - 1;
  var _count = 0;
  var WarpMap = class {
    constructor(mode = 0, weight = 0, str_lo = -1, str_hi = 2) {
      this.mode = mode | 0;
      this.weight = +weight;
      this.index = _count++;
    }
  };
  var g_override_mode = -1;
  var g_warp_maps = [
    // freq = weight ~ probability of being picked
    //       mode   freq  str_lo str_hi
    new WarpMap(0, 0.55),
    // flat zoom
    new WarpMap(1, 2.25),
    // power zoom
    new WarpMap(2, 0.53),
    // ~zooming over terrain
    new WarpMap(3, 2),
    // heavy rotate
    new WarpMap(4, 1.3),
    // N randomly-placed swirls; can overlap
    new WarpMap(5, 0.3),
    // swirlie grid 2
    new WarpMap(6, 0.3),
    // swirlie grid
    new WarpMap(7, 0.04),
    // sphere (was: egg)
    new WarpMap(8, 1.5),
    // radial swirl (sonic)
    new WarpMap(9, 0.95),
    // angular ripples (pond splash)
    new WarpMap(10, 0.15),
    // starfish
    new WarpMap(11, 0.05),
    // black hole (-)
    new WarpMap(12, 1.66),
    // 1/Z zoom
    new WarpMap(13, 0.06),
    // ROUNDED SQUARE ROTATION
    new WarpMap(14, 0.3),
    // VORTEX
    new WarpMap(15, 0.25),
    // FISSURE.  This mode "hogs" the motion when active, so make it less common.   
    new WarpMap(16, 1.3)
    // LOW FREQ SINE WAVES
    //new WarpMap(17, 3.30),	// Name of the Wind
    //new WarpMap(99,  0.04),	// cubism
  ];
  function lerp(a, b, t) {
    return a * (1 - t) + b * t;
  }
  function smoothstep(x) {
    return x * x * (3 - 2 * x);
  }
  function ApplyRot2D(x, y, rot) {
    const cos_rot = Math.cos(rot);
    const sin_rot = Math.sin(rot);
    let x2 = x * cos_rot - y * sin_rot;
    let y2 = x * sin_rot + y * cos_rot;
    return { x: x2, y: y2 };
  }
  function LogInterp(lo, hi, t) {
    return lo * Math.pow(hi / lo, t);
  }
  function LinearInterp(lo, hi, t) {
    return lo + (hi - lo) * t;
  }
  function buildWarpMap(new_mode) {
    const W = kWarpMapSize;
    const H = kWarpMapSize;
    let warp_prefs = {
      // How much this motion map cares about selecting the wave data.
      // >= 0.  A higher weight will cause it to be more aggressive in
      // the weighted decision (when multiple motion maps are active at 
      // once).
      wave_prefs_weight: 1,
      // How much this warp map will try to dominate the others in terms
      // of motion.  If this value is > 1, it will (increasingly) suppress
      // the motion of other warp maps, when active, as it doesn't play
      // well with others.
      hog_motion_weight: 1,
      // These are all relative weights.  They don't have to sum to 1.
      // Note that the primary logic for the wave type (flat vs. circ)
      //   is driven by a function of the weighted average motion 
      //   metadata of the 4 active maps.  These 'prob' values basically
      //   serve as gates, to completely shut off certain wave types
      //   for certain modes, if desired.
      //type_flat_prob : 1.0,		// Do not change.
      //type_circ_prob : 1.0,		// Do not change.
      //type_flat_plus_circ : 0.01,
      //type_xy : 0.0,
      flat_angle_lo: -3.141592,
      flat_angle_hi: 3.141592,
      // Since most people watch in widescreen:
      flat_angle_bias_toward_horizontal_angles: 1.7,
      // 0+
      flat_scale: 1,
      flat_is_stereo_chance: 0.18,
      // [0..1]
      flat_stereo_sep_lo: 0.55,
      flat_stereo_sep_hi: 0.85,
      flat_stereo_amplitude_scale: 1,
      // see also: use_motion_center_as_wave_center_on_zoomy_combos_prob
      flat_cx_lo: -0.2,
      flat_cx_hi: 0.2,
      flat_cy_lo: -0.2,
      flat_cy_hi: 0.2,
      circ_rad_lo: 0.75,
      // 0.45,
      circ_rad_hi: 1.3,
      //0.75
      circ_scale: 1,
      // see also: use_motion_center_as_wave_center_on_zoomy_combos_prob
      circ_cx_lo: -0.05,
      circ_cx_hi: 0.05,
      circ_cy_lo: -0.05,
      circ_cy_hi: 0.05,
      // Most of the time, we ignore the (cx, cy) for the wave and
      // just stick it at the center of motion.  You can control
      // how often that happens here.  Or, for certain modes, you
      // can fine-tune it.
      use_motion_center_as_wave_center_prob: 0.93,
      // When we do it, don't always just do it 100%; sometimes
      // do it fractionally, according to:
      //   [random in 0..1] ^ use_motion_center_as_wave_center_power
      use_motion_center_as_wave_center_power: 0.4,
      //radial_beat_dots_prob : 0.035,
      //random_beat_dots_prob : 0.01,		
      //fading_dots_prob      : 0.003,
      //grid_dots_prob        : 0.005,
      radial_beat_dots_prob: 0.03,
      random_beat_dots_prob: 0.01,
      fading_dots_prob: 0.09,
      grid_dots_prob: 5e-3,
      // Metadata computed from the resulting warp map:
      net_motion: 0,
      net_zoom_motion: 0,
      in_or_out_motion: 0,
      net_clockwise_motion: 0,
      cw_or_ccw_motion: 0,
      angular_motion_mag: 0,
      // ~clockwise rotation
      radial_motion_mag: 0,
      // ~zoom out
      abs_radial_motion_mag: 0,
      // ~motion in or out
      abs_angular_motion_mag: 0
      // ~rotation in any direction
    };
    const n = W * H;
    const src_dxy = new Float32Array(n * 2);
    const aspect = W * 1 / H;
    let x0 = -1;
    let y0 = -1;
    let x1 = 1;
    let y1 = 1;
    if (aspect > 1) {
      y0 /= aspect;
      y1 /= aspect;
    } else {
      x0 *= aspect;
      x1 *= aspect;
    }
    const inv_W = 1 / W;
    const inv_H = 1 / H;
    const x0x1 = x1 - x0;
    const y0y1 = y1 - y0;
    const inv_x0x1 = 1 / x0x1;
    const inv_y0y1 = 1 / y0y1;
    let randoms = new Float32Array(WarpMapRandomNumberCount);
    for (let i = 0; i < WarpMapRandomNumberCount; i++) {
      randoms[i] = Math.random();
    }
    let rand_idx = 0;
    let write_offset = 0;
    if (g_override_mode >= 0) {
      new_mode = g_override_mode;
    }
    if (new_mode < 0) {
    } else if (new_mode == 4) {
      for (let dy = 0; dy < H; dy++) {
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          src_dxy[write_offset + 0] = 0;
          src_dxy[write_offset + 1] = 0;
        }
      }
      const N = 2 + 34 * randoms[rand_idx++] | 0;
      for (let n2 = 0; n2 < N; n2++) {
        const cx = (randoms[rand_idx++] - 0.5) * x0x1;
        const cy = (randoms[rand_idx++] - 0.5) * y0y1;
        const rad2 = 0.3 + 0.5 * randoms[rand_idx++] * Math.min(1, 10 / N);
        const str = (0.4 + 0.4 * randoms[rand_idx++]) * (randoms[rand_idx++] > 0.5 ? 1 : -1) * 0.1 * Math.pow(Math.min(1, 3 / N), 0.7);
        const dx0 = Math.max(0, Math.min(W, ((cx - rad2) * inv_x0x1 + 0.5) * W)) | 0;
        const dy0 = Math.max(0, Math.min(H, ((cy - rad2) * inv_y0y1 + 0.5) * H)) | 0;
        const dx1 = Math.max(0, Math.min(W, ((cx + rad2) * inv_x0x1 + 0.5) * W)) | 0;
        const dy1 = Math.max(0, Math.min(H, ((cy + rad2) * inv_y0y1 + 0.5) * H)) | 0;
        for (let dy = dy0; dy < dy1; dy++) {
          let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
          write_offset = (dy * W + dx0) * 2;
          for (let dx = dx0; dx < dx1; dx++, write_offset += 2) {
            let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
            let rad_sq = ((fdx - cx) * (fdx - cx) + (fdy - cy) * (fdy - cy)) * (1 / (rad2 * rad2));
            if (rad_sq < 1) {
              let r = Math.pow(rad_sq, 0.333);
              let sdx = fdx;
              let sdy = fdy;
              r = smoothstep(r);
              let zx = fdx - cx;
              let zy = fdy - cy;
              let rot = (1 - r) * str;
              let zx2 = zx * Math.cos(rot) - zy * Math.sin(rot);
              let zy2 = zx * Math.sin(rot) + zy * Math.cos(rot);
              sdx = cx + zx2;
              sdy = cy + zy2;
              src_dxy[write_offset + 0] += sdx - fdx;
              src_dxy[write_offset + 1] += sdy - fdy;
            }
          }
        }
      }
    } else if (new_mode == 5) {
      const N = 0.5 + randoms[rand_idx++] * 3.5;
      const offset_x = randoms[rand_idx++] * (1 / N);
      const offset_y = randoms[rand_idx++] * (1 / N);
      const str = (0.1 + 0.9 * randoms[rand_idx++] * randoms[rand_idx++]) * (randoms[rand_idx++] > 0.5 ? 1 : -1) * 0.25;
      const rot0 = randoms[rand_idx++] * 6.28;
      const variety = randoms[rand_idx++] > 0.5;
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        fdy += offset_y;
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          fdx += offset_x;
          let p = ApplyRot2D(fdx, fdy, rot0);
          let fx = p.x;
          let fy = p.y;
          let nx = Math.floor(fx * N);
          let ny = Math.floor(fy * N);
          let k = nx * 3 + ny * 7 | 0;
          let att = variety ? randoms[k & WarpMapRandomNumberMask] * 2 - 1 : 1;
          let cx = (nx + 0.5) * (1 / N);
          let cy = (ny + 0.5) * (1 / N);
          let rad_sq = ((fx - cx) * (fx - cx) + (fy - cy) * (fy - cy)) * (N * N * 4);
          let r = Math.pow(rad_sq, 0.333);
          let sdx = fx;
          let sdy = fy;
          if (r < 1) {
            r = smoothstep(r);
            let zx = fx - cx;
            let zy = fy - cy;
            let rot = (1 - r) * str;
            let zx2 = zx * Math.cos(rot * att) - zy * Math.sin(rot * att);
            let zy2 = zx * Math.sin(rot * att) + zy * Math.cos(rot * att);
            sdx = cx + zx2;
            sdy = cy + zy2;
          }
          sdx -= fx;
          sdy -= fy;
          let p2 = ApplyRot2D(sdx, sdy, -rot0);
          sdx = p2.x;
          sdy = p2.y;
          src_dxy[write_offset + 0] = sdx;
          src_dxy[write_offset + 1] = sdy;
        }
      }
    } else if (new_mode == 6) {
      const N = 2 + randoms[rand_idx++] * 8;
      const offset_x = randoms[rand_idx++] * (1 / N);
      const offset_y = randoms[rand_idx++] * (1 / N);
      const scale = 1;
      const rot = (2e-3 + 0.028 * randoms[rand_idx++]) * (randoms[rand_idx++] < 0.5 ? 1 : -1) * Math.min(1, 4 / N);
      const power = 0.5 + 2.5 * randoms[rand_idx++];
      const variety = Math.max(0, Math.min(1, randoms[rand_idx++] * 3 - 1));
      const rot0 = randoms[rand_idx++] * 6.28;
      for (let dy = 0; dy < H; dy++) {
        const orig_fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          const orig_fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let p = ApplyRot2D(orig_fdx, orig_fdy, rot0);
          let fdx = p.x;
          let fdy = p.y;
          fdx += offset_x;
          fdx = fdx * N * 0.5;
          const nx = Math.floor(fdx);
          fdx -= nx;
          fdx = fdx * 2 - 1;
          fdy += offset_y;
          fdy = fdy * N * 0.5;
          const ny = Math.floor(fdy);
          fdy -= ny;
          fdy = fdy * 2 - 1;
          const k = nx * 3 + ny * 7 | 0;
          const tx = fdx;
          const ty = fdy;
          var rad = Math.sqrt(tx * tx + ty * ty);
          rad = Math.pow(rad, power);
          const rot22 = rot * Math.max(0, 1 - rad);
          const rot3 = rot22 * lerp(1, randoms[k & WarpMapRandomNumberMask] * 2 - 1, variety);
          let sdx = (fdx * Math.cos(rot3) - fdy * Math.sin(rot3)) * scale;
          let sdy = (fdx * Math.sin(rot3) + fdy * Math.cos(rot3)) * scale;
          sdx -= fdx;
          sdy -= fdy;
          let p2 = ApplyRot2D(sdx, sdy, -rot0);
          sdx = p2.x;
          sdy = p2.y;
          src_dxy[write_offset + 0] = sdx;
          src_dxy[write_offset + 1] = sdy;
        }
      }
    } else if (new_mode == 10) {
      let str = 0.4 + 1.6 * randoms[rand_idx++];
      if (randoms[rand_idx++] < 0.3) {
        str = str * -0.25;
      }
      const fins = 3 + Math.floor(randoms[rand_idx++] * 6);
      const cx = (randoms[rand_idx++] * 2 - 1) * 0.12;
      const cy = (randoms[rand_idx++] * 2 - 1) * 0.12;
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const tx = fdx - cx;
          const ty = fdy - cy;
          const ang = Math.atan2(tx, ty);
          const scale = 0.987 + 0.01 * Math.cos(ang * fins);
          let sdx = fdx * scale;
          let sdy = fdy * scale;
          const rad2 = Math.sqrt(tx * tx + ty * ty);
          const att = Math.max(0, Math.min(1, (rad2 - 0.05) * 4));
          sdx = fdx + (sdx - fdx) * att * str;
          sdy = fdy + (sdy - fdy) * att * str;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 9) {
      warp_prefs.circ_scale = 4;
      const cx = (randoms[rand_idx++] * 2 - 1) * 0.35;
      const cy = (randoms[rand_idx++] * 2 - 1) * 0.35;
      const freq = 6 + 18 * randoms[rand_idx++];
      const phase = randoms[rand_idx++] * 6.28;
      const mag = (12e-5 + 5e-5 * randoms[rand_idx++]) / freq * 100 * (randoms[rand_idx++] < 0.5 ? 1 : -1);
      const bias = randoms[rand_idx++] * 2 - 1;
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const tx = fdx - cx;
          const ty = fdy - cy;
          const rad2 = Math.sqrt(tx * tx + ty * ty);
          const scale = 1 + mag * (Math.cos(rad2 * freq + phase) + bias);
          let sdx = fdx * scale;
          let sdy = fdy * scale;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 8) {
      warp_prefs.circ_scale = 4;
      const cx = (randoms[rand_idx++] * 2 - 1) * 0.45;
      const cy = (randoms[rand_idx++] * 2 - 1) * 0.45;
      const rad_freq = 5 + 19 * randoms[rand_idx++];
      const rot_str = (1e-3 + 4e-3 * randoms[rand_idx++] * randoms[rand_idx++]) * (randoms[rand_idx++] < 0.5 ? -1 : 1) * 0.21 * Math.pow(13 / rad_freq, 0.6) * 4;
      const rot_bias = randoms[rand_idx] * 2 - 1;
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const tx = fdx - cx;
          const ty = fdy - cy;
          const rad2 = Math.sqrt(tx * tx + ty * ty);
          const rot = (Math.cos(rad2 * rad_freq) + rot_bias) * rot_str;
          let sdx = tx * Math.cos(rot) - ty * Math.sin(rot) + cx;
          let sdy = tx * Math.sin(rot) + ty * Math.cos(rot) + cy;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 2) {
      warp_prefs.wave_prefs_weight *= 5;
      let str = 0.027 * (0.1 + 0.9 * randoms[rand_idx++]);
      let angle = randoms[rand_idx++] * 6.28;
      const cos_angle = Math.cos(angle);
      const sin_angle = Math.sin(angle);
      const rot = (randoms[rand_idx++] * 2 - 1) * 15e-4;
      const cos_rot = Math.cos(rot);
      const sin_rot = Math.sin(rot);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let rx = fdx * cos_angle - fdy * sin_angle;
          let ry = fdx * sin_angle + fdy * cos_angle;
          let sdx = fdx;
          let sdy = fdy;
          let zoom = 1 - 1 / (-ry + 1.4) * str;
          sdx *= zoom;
          sdy *= zoom;
          rx = sdx * cos_rot - sdy * sin_rot;
          ry = sdx * sin_rot + sdy * cos_rot;
          sdx = rx;
          sdy = ry;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 11) {
      warp_prefs.wave_prefs_weight *= 10;
      warp_prefs.circ_rad_lo = 0.9;
      warp_prefs.circ_rad_hi = 1.5;
      let str = 0.75 + 1.5 * randoms[rand_idx++];
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let sdx = fdx;
          let sdy = fdy;
          let rad2 = Math.sqrt(fdx * fdx + fdy * fdy);
          let scale = 0.97 + 0.1 * rad2;
          scale = Math.pow(scale, 4);
          sdx *= scale;
          sdy *= scale;
          sdx = fdx + (sdx - fdx) * -str;
          sdy = fdy + (sdy - fdy) * -str;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 0) {
      warp_prefs.wave_prefs_weight *= 10;
      warp_prefs.type_flat_plus_circ *= 1.4;
      let zoom = 4e-3 + 0.016 * randoms[rand_idx++];
      if (randoms[rand_idx++] < 0.1) {
        zoom *= -0.25;
      }
      const rot = (randoms[rand_idx++] * 2 - 1) * 15e-4;
      const cos_rot = Math.cos(rot);
      const sin_rot = Math.sin(rot);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let sdx = fdx + (0 - fdx) * zoom;
          let sdy = fdy + (0 - fdy) * zoom;
          let rx = sdx * cos_rot - sdy * sin_rot;
          let ry = sdx * sin_rot + sdy * cos_rot;
          sdx = rx;
          sdy = ry;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 1) {
      warp_prefs.wave_prefs_weight *= 10;
      warp_prefs.type_flat_plus_circ *= 1.4;
      let zoom = (0.4 + 1.6 * randoms[rand_idx++]) * 0.03 * 1.8;
      if (randoms[rand_idx++] < 0.1) {
        zoom *= -0.4;
      }
      const rot = (randoms[rand_idx++] * 2 - 1) * 15e-4;
      const cos_rot = Math.cos(rot);
      const sin_rot = Math.sin(rot);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let r = fdx * fdx + fdy * fdy;
          let sdx = fdx + (0 - fdx) * r * zoom;
          let sdy = fdy + (0 - fdy) * r * zoom;
          let rx = sdx * cos_rot - sdy * sin_rot;
          let ry = sdx * sin_rot + sdy * cos_rot;
          sdx = rx;
          sdy = ry;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 3) {
      warp_prefs.wave_prefs_weight *= 0.01;
      var rot1 = 2e-3 + 8e-3 * randoms[rand_idx++];
      if (randoms[rand_idx++] < 0.5) rot1 *= -1;
      var rot2 = rot1;
      if (randoms[rand_idx++] < 0.3) {
        rot2 = rot1 * randoms[rand_idx++] * 2;
        if (randoms[rand_idx++] < 0.5) rot2 *= -1;
      }
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const rad2 = Math.sqrt(fdx * fdx + fdy * fdy);
          const rot = rot1 + (rot2 - rot1) * rad2;
          let sdx = fdx * Math.cos(rot) - fdy * Math.sin(rot);
          let sdy = fdx * Math.sin(rot) + fdy * Math.cos(rot);
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 12) {
      warp_prefs.wave_prefs_weight *= 10;
      const speed_min = 0.015;
      const speed_max = 0.08;
      const t = Math.pow(randoms[rand_idx++], 3);
      const speed = LinearInterp(speed_min, speed_max, randoms[rand_idx++]);
      const rot = (randoms[rand_idx++] * 2 - 1) * 15e-4;
      const cos_rot = Math.cos(rot);
      const sin_rot = Math.sin(rot);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let orig_rad = Math.sqrt(fdx * fdx + fdy * fdy + 1e-5);
          let inv_rad = 1 / orig_rad;
          let nx = fdx * inv_rad;
          let ny = fdy * inv_rad;
          let dist = inv_rad;
          dist += speed;
          let rad2 = 1 / dist;
          let sdx = fdx + nx * (rad2 - orig_rad);
          let sdy = fdy + ny * (rad2 - orig_rad);
          let rx = sdx * cos_rot - sdy * sin_rot;
          let ry = sdx * sin_rot + sdy * cos_rot;
          sdx = rx;
          sdy = ry;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 7) {
      warp_prefs.wave_prefs_weight *= 10;
      const power = LinearInterp(1.03, 1.1, randoms[rand_idx++]);
      const t = (randoms[rand_idx++] + randoms[rand_idx++]) * 0.5;
      const scale = LogInterp(1.5, 4, t);
      const inv_scale = 1 / scale;
      const str = 0.1 + 0.4 * randoms[rand_idx++];
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let orig_rad = Math.sqrt(fdx * fdx + fdy * fdy + 1e-5);
          let rad2 = Math.pow(orig_rad * scale, power) * inv_scale;
          let inv_rad = 1 / orig_rad;
          let nx = fdx * inv_rad;
          let ny = fdy * inv_rad;
          let sdx = fdx + nx * (rad2 - orig_rad) * str;
          let sdy = fdy + ny * (rad2 - orig_rad) * str;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 13) {
      warp_prefs.wave_prefs_weight *= 10;
      const speed = LinearInterp(3e-3, 0.01, randoms[rand_idx++]) * (randoms[rand_idx++] > 0.5 ? 1 : -1);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const rad2 = Math.sqrt(fdx * fdx + fdy * fdy);
          let nx = fdy;
          let ny = -fdx;
          let nx_sign = nx < 0 ? -1 : 1;
          let ny_sign = ny < 0 ? -1 : 1;
          nx *= nx * nx_sign;
          ny *= ny * ny_sign;
          const norm_scale = 1 / Math.sqrt(nx * nx + ny * ny + 1e-5);
          nx *= norm_scale;
          ny *= norm_scale;
          let sdx = fdx + nx * speed * rad2;
          let sdy = fdy + ny * speed * rad2;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 14) {
      const cx = (randoms[rand_idx++] * 2 - 1) * 0.08;
      const cy = (randoms[rand_idx++] * 2 - 1) * 0.08;
      const str = LinearInterp(8e-3, 0.025, randoms[rand_idx++]) * (randoms[rand_idx++] > 0.5 ? 1 : -1);
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const tx = fdx - cx;
          const ty = fdy - cy;
          const rad2 = Math.sqrt(tx * tx + ty * ty);
          const rot = rad2 * str;
          const rotated = ApplyRot2D(tx, ty, rot);
          let sdx = cx + rotated.x;
          let sdy = cy + rotated.y;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 15) {
      warp_prefs.wave_prefs_weight *= 10;
      warp_prefs.hog_motion_weight *= 10;
      const theta = randoms[rand_idx++] * 6.28;
      const cos_theta = Math.cos(theta);
      const sin_theta = Math.sin(theta);
      const cos_minus_theta = Math.cos(-theta);
      const sin_minus_theta = Math.sin(-theta);
      const dz = (0.015 + 0.015 * randoms[rand_idx++]) * 1;
      const plane_y = 1.01 + 0.5 * randoms[rand_idx++];
      const wave_offset = (randoms[rand_idx++] * 2 - 1) * 0.6;
      const cx = wave_offset * Math.cos(-theta + Math.PI / 2);
      const cy = wave_offset * Math.sin(-theta + Math.PI / 2);
      if (randoms[rand_idx++] < 0.99) {
        warp_prefs.flat_angle_lo = -theta;
        warp_prefs.flat_angle_hi = -theta;
        warp_prefs.flat_cx_lo = cx;
        warp_prefs.flat_cx_hi = cx;
        warp_prefs.flat_cy_lo = cy;
        warp_prefs.flat_cy_hi = cy;
        warp_prefs.flat_angle_bias_toward_horizontal_angles = 0;
        warp_prefs.flat_stereo_sep_lo *= 0.3;
        warp_prefs.flat_stereo_sep_hi *= 0.75;
        warp_prefs.flat_stereo_amplitude_scale *= 0.6;
        warp_prefs.circ_cx_lo = cx;
        warp_prefs.circ_cx_hi = cx;
        warp_prefs.circ_cy_lo = cy;
        warp_prefs.circ_cy_hi = cy;
      }
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          let rrx = fdx - cx;
          let rry = fdy - cy;
          let rx = rrx * cos_theta - rry * sin_theta;
          let ry = rrx * sin_theta + rry * cos_theta;
          let sx = rx;
          let sy = ry;
          let sz = 1;
          let vx = sx;
          let vy = sy;
          let vz = sz;
          let v_norm_scale = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
          vx *= v_norm_scale;
          vy *= v_norm_scale;
          vz *= v_norm_scale;
          const which_plane_y = plane_y * (ry < 0 ? -1 : 1);
          let t = which_plane_y / vy;
          let ix = vx * t;
          let iy = vy * t;
          let iz = vz * t;
          iz += dz;
          vx = ix;
          vy = iy;
          vz = iz;
          v_norm_scale = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
          vx *= v_norm_scale;
          vy *= v_norm_scale;
          vz *= v_norm_scale;
          t = 1 / vz;
          let fx = vx * t;
          let fy = vy * t;
          let sdx = fx * cos_minus_theta - fy * sin_minus_theta;
          let sdy = fx * sin_minus_theta + fy * cos_minus_theta;
          sdx += cx;
          sdy += cy;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    } else if (new_mode == 16) {
      warp_prefs.wave_prefs_weight *= 0.1;
      const N = 5;
      const str = 0.4 + 0.6 * randoms[rand_idx++];
      let theta = new Float32Array(N);
      let cos_theta = new Float32Array(N);
      let sin_theta = new Float32Array(N);
      let freq = new Float32Array(N);
      let amp = new Float32Array(N);
      let theta_sum = 0;
      for (let i = 0; i < N; i++) {
        theta[i] = randoms[rand_idx++] * 6.28;
        cos_theta[i] = Math.cos(theta[i]);
        sin_theta[i] = Math.sin(theta[i]);
        amp[i] = randoms[rand_idx++] * str * 2e-3 * 0.5 * 1.3;
        freq[i] = randoms[rand_idx++] * 12 * 2;
        theta_sum += theta[i];
      }
      const cos_undo = Math.cos(-theta_sum);
      const sin_undo = Math.sin(-theta_sum);
      const SCALE = 4;
      const W2 = W / SCALE + 1 | 0;
      const H2 = H / SCALE + 1 | 0;
      let temp_x = new Float32Array(W2 * H2);
      let temp_y = new Float32Array(W2 * H2);
      for (let dy = 0; dy < H2; dy++) {
        let fdy = (dy * (2 / H2) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W2; dx++) {
          let fdx = (dx * (2 / W2) - 1) * (x0x1 * 0.5);
          let x = fdx;
          let y = fdy;
          for (let i = 0; i < N; i++) {
            let x2 = x * cos_theta[i] - y * sin_theta[i];
            let y2 = x * sin_theta[i] + y * cos_theta[i];
            x = x2;
            y = y2;
            x += Math.cos(y * freq[i]) * amp[i];
          }
          let sdx = x * cos_undo - y * sin_undo;
          let sdy = x * sin_undo + y * cos_undo;
          temp_x[dy * W2 + dx] = sdx - fdx;
          temp_y[dy * W2 + dx] = sdy - fdy;
        }
      }
      write_offset = 0;
      for (let dy = 0; dy < H; dy++) {
        const fsy = dy * (H2 - 1) / H;
        const sy = Math.floor(fsy);
        const fy = fsy - sy;
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          const fsx = dx * (W2 - 1) / W;
          const sx = Math.floor(fsx);
          const fx = fsx - sx;
          const o1 = (sy + 0) * W2 + (sx + 0);
          const o2 = (sy + 0) * W2 + (sx + 1);
          const o3 = (sy + 1) * W2 + (sx + 0);
          const o4 = (sy + 1) * W2 + (sx + 1);
          const w1 = (1 - fy) * (1 - fx);
          const w2 = (1 - fy) * fx;
          const w3 = fy * (1 - fx);
          const w4 = fy * fx;
          const vx = temp_x[o1] * w1 + temp_x[o2] * w2 + temp_x[o3] * w3 + temp_x[o4] * w4;
          const vy = temp_y[o1] * w1 + temp_y[o2] * w2 + temp_y[o3] * w3 + temp_y[o4] * w4;
          src_dxy[write_offset + 0] = vx;
          src_dxy[write_offset + 1] = vy;
        }
      }
    } else if (new_mode == 98 || new_mode == 99) {
      warp_prefs.wave_prefs_weight = 100;
      warp_prefs.hog_motion_weight = 100;
      warp_prefs.flat_angle_lo = 0;
      warp_prefs.flat_angle_hi = 0;
      warp_prefs.flat_is_stereo_chance = 0;
      warp_prefs.flat_cx_lo = -0.1, warp_prefs.flat_cx_hi = 0.1, warp_prefs.flat_cy_lo = -0.2, warp_prefs.flat_cy_hi = 0.2, warp_prefs.use_motion_center_as_wave_center_prob = 0;
    } else if (new_mode == 17) {
      const cx = (randoms[rand_idx++] * 2 - 1) * 0.08;
      const cy = (randoms[rand_idx++] * 2 - 1) * 0.08;
      for (let dy = 0; dy < H; dy++) {
        let fdy = (dy * (2 / H) - 1) * (y0y1 * 0.5);
        for (let dx = 0; dx < W; dx++, write_offset += 2) {
          let fdx = (dx * (2 / W) - 1) * (x0x1 * 0.5);
          const tx = fdx - cx;
          const ty = fdy - cy;
          const rad1 = Math.sqrt(tx * tx + ty * ty);
          const inv_rad1 = 1 / (rad1 + 1e-4);
          const nx = tx * inv_rad1;
          const ny = ty * inv_rad1;
          const dist1 = inv_rad1;
          const dist2 = dist1 + 0.01;
          const rad2 = 1 / dist2 - 1e-4;
          let tx2 = rad2 * nx;
          let ty2 = rad2 * ny;
          let sdx = cx + tx2;
          let sdy = cy + ty2;
          src_dxy[write_offset + 0] = sdx - fdx;
          src_dxy[write_offset + 1] = sdy - fdy;
        }
      }
    }
    if (rand_idx > WarpMapRandomNumberCount) {
      throw new Error("Too many random numbers used when generating warp map for mode ", new_mode);
    }
    {
      const diagonal = Math.sqrt(W * W + H * H);
      const sample_count = 256;
      const scale = 100 / diagonal;
      const cx = W / 2;
      const cy = H / 2;
      let net_motion = 0;
      let net_zoom_motion = 0;
      let in_or_out_motion = 0;
      let net_clockwise_motion = 0;
      let cw_or_ccw_motion = 0;
      for (let k = 0; k < sample_count; k++) {
        const fx = (Math.random() + Math.random()) * 0.5;
        const fy = (Math.random() + Math.random()) * 0.5;
        const dx = fx * (W - 1) | 0;
        const dy = fy * (H - 1) | 0;
        const read_offset = (dy * W + dx) * 2;
        const sx = dx + src_dxy[read_offset + 0] * (0.5 * W);
        const sy = dy + src_dxy[read_offset + 1] * (0.5 * H);
        let rx = dx - cx;
        let ry = dy - cy;
        let r_norm_scale = 1 / Math.sqrt(rx * rx + ry * ry + 1e-5);
        rx *= r_norm_scale;
        ry *= r_norm_scale;
        const tx = -ry;
        const ty = rx;
        const vx = (dx - sx) * scale;
        const vy = (dy - sy) * scale;
        const outward = rx * vx + ry * vy;
        const clockwise = tx * vx + ty * vy;
        net_motion += Math.sqrt(vx * vx + vy * vy);
        net_zoom_motion += outward;
        in_or_out_motion += Math.abs(outward);
        net_clockwise_motion += clockwise;
        cw_or_ccw_motion += Math.abs(clockwise);
      }
      warp_prefs.net_motion = net_motion / sample_count;
      warp_prefs.net_zoom_motion = net_zoom_motion / sample_count;
      warp_prefs.in_or_out_motion = in_or_out_motion / sample_count;
      warp_prefs.net_clockwise_motion = net_clockwise_motion / sample_count;
      warp_prefs.cw_or_ccw_motion = cw_or_ccw_motion / sample_count;
    }
    return {
      mode: new_mode,
      // TODO: Remove W,H return params?
      W,
      H,
      warp_prefs,
      src_dxy,
      randoms
    };
  }

  // background_worker.js
  self.onmessage = (e) => {
    if (e.data.type === "start") {
      const { payload } = e.data;
      const result = do_heavy_thing(payload);
      self.postMessage({ type: "done", result });
    }
  };
  function do_heavy_thing(payload) {
    return {
      mode: payload.mode,
      warp_map: buildWarpMap(payload.mode),
      i: payload.i,
      t0: payload.t0,
      t1: payload.t1,
      t2: payload.t2,
      t3: payload.t3
    };
  }
})();
`;function Rr(){let s=new Blob([Nr],{type:"text/javascript"});return new Worker(URL.createObjectURL(s))}var St=1,Pe=St*14,D0=St*26,ie=St*1.5,M0=St*10,$r=St*13,Cr=St*24,H0=St*5,I0=St*8,L0=H0*.35+.65*I0,zr=109*.9,oo=1.5,no=1.1,io=.95*.65,ao=.7,lo=.8,co=.5,_o=1.1;var Q=null,at=null,gt=0,oe=.1,w0=!0,Gr=0,Br=0,Lr=0,Or=0,Ur=0,At=null,fo=new g0,Ft=new Array(1024);for(let s=0;s<Ft.length;s++)Ft[s]={x:Math.random()*1024|0,y:Math.random()*1024|0};var qr=Rr(),kt=null,V0=!1,Kr=!1,O0=!1;qr.onmessage=s=>{s.data.type==="done"&&(Kr&&console.log(`# bkg generation of warp map complete! mode ${s.data.result.mode}, slot ${s.data.result.i}`),V0=!1,kt=s.data.result)};function ho(s){Kr&&console.log(`# kicking off bkg generation of a warp map, slot ${s.i}, mode ${s.mode}, t0 ${s.t0}, t3 ${s.t3}`),kt=null,V0=!0,qr.postMessage({type:"start",payload:s})}function ne(s,t,e){return s*(1-e)+t*e}function j0(s){return s*s*(3-2*s)}var ct=new Array;for(let s=0;s<4;s++)ct.push([]);var Ee=class{constructor(t=0,e=0,r=0,o=0,i=0,a=1,c=null){this.mode=t|0,(e==r||o==i||e==i)&&se("ERROR: ActiveWarpMap constructor: invalid zero time gap (t0, t1, t2, t3)"),e==-1&&se("ERROR: t0 was -1!"),c!=null&&c.mode!=t&&se(`ERROR: Mismatch: mode (${t}) != warp_map.mode (${c.mode}).`),this.peak_str=a,this.t0=e,this.t1=r,this.t2=o,this.t3=i,this.warp_map=c??Er(t)}};function Vr(s,t){let e=ct[s],r=e.length;if(r==0||t<e[0].t0||t>e[r-1].t3)return{mode:-1,raw_str:0,peak_str:0,t0:-1,t1:-1,t2:-1,t3:-1,warp_map:null};let o=r-1;for(o=r-1;o>=0&&!(t>=e[o].t0&&t<=e[o].t3);o--);let i=e[o].mode,a=0;return t<=e[o].t1?a=Math.max(0,Math.min(1,(t-e[o].t0)/(e[o].t1-e[o].t0))):a=1-Math.max(0,Math.min(1,(t-e[o].t2)/(e[o].t3-e[o].t2))),a=j0(a),{mode:i,raw_str:a*e[o].peak_str,peak_str:e[o].peak_str,t0:e[o].t0,t1:e[o].t1,t2:e[o].t2,t3:e[o].t3,warp_map:e[o].warp_map}}function Qe(s){let t=[];for(let r=0;r<4;r++)t.push(Vr(r,s));let e=0;for(let r=0;r<4;r++){let o=t[r].warp_map==null?0:t[r].warp_map.warp_prefs.hog_motion_weight*t[r].raw_str;e+=o}for(let r=0;r<4;r++){let i=(t[r].warp_map==null?0:t[r].warp_map.warp_prefs.hog_motion_weight*t[r].raw_str)*4/e;t[r].bal_str=t[r].raw_str*i}return t}function Dr(s,t,e){console.log(`time = ${t.toFixed(4)} + ${e.toFixed(4)} = ${(t+e).toFixed(4)}:`);let r=`  i ${s} -> `;for(let o=0;o<ct[s].length;o++)r+=`${ct[s][o].t0.toFixed(3)} .. ${ct[s][o].t3.toFixed(3)}, `;console.log(r)}function jr(s){if(Ye>=0){for(let i=0;i<Et.length;i++)if(Et[i].mode==Ye)return Et[i].mode}s=s||[];let t=new Float32Array(Et.length),e=0;for(let i=0;i<Et.length;i++){let a=Et[i].weight;for(let c=0;c<s.length;c++)Et[i].mode==s[c]&&(a=0);t[i]=a,e+=a}let r=Math.random()*e,o=0;for(let i=0;i<Et.length;i++)if(o+=t[i],o>=r)return Et[i].mode;return Et[Et.length-1].mode}var v0=0,Xr=0,Yr=0;function q0(){v0=ie+(M0-ie)*Math.random(),Xr=Pe+(D0-Pe)*Math.random(),Yr=ie+(M0-ie)*Math.random()}q0();function U0(s,t){let e=Qe(s+t),r=-1,o=0,i=new Array;for(let M=0;M<4;M++)if(e[M].mode!=-1)i.push(e[M].mode);else if(ct[M].length>0){let F=ct[M][ct[M].length-1];(r==-1||F.t3<o)&&(r=M,o=F.t3)}else(r==-1||s<o)&&(r=M,o=s-v0);let a=jr(i),c=r>=0?o:s-v0,n=c+v0,x=n+Xr,w=x+Yr;return{earliest_dead_i:r,earliest_dead_time:o,mode:a,t0:c,t1:n,t2:x,t3:w}}function Hr(s,t){if(s.length!==t.length)throw new Error(`blendStructs: prefs.length (${s.length}) != weights.length (${t.length})`);if(s.length===0)throw new Error("blendStructs: empty prefs array");let e=t.reduce((i,a)=>i+a,0);if(e===0)throw new Error("blendStructs: weight sum is 0");let r={},o=new Set;for(let i of s)for(let a of Object.keys(i))o.add(a);for(let i of o){let a=0,c=!1;for(let n=0;n<s.length;n++){let x=s[n][i];typeof x=="number"&&(a+=t[n]*x,c=!0)}r[i]=c?a/e:s[0][i]}return r}function zt(s,t){return s+(t-s)*Math.random()}function Ir(s,t){let e=s.length;if((t|0)!==t||t<0)throw new Error(`linearUpsampleF: outLen must be a non-negative integer (got ${t})`);if(t===e)return new Float32Array(s);if(t===0||e===0)return new Float32Array(0);if(e===1){let w=new Float32Array(t);return w.fill(s[0]),w}if(t===1){let w=e-1,M=0;for(let F=0;F<w;F++)M+=.5*(s[F]+s[F+1]);return new Float32Array([M/w])}let r=new Float32Array(t),o=e-1;if(t>e){let w=o/(t-1);for(let M=0;M<t;M++){let F=M*w,A=F|0;if(A>=o)r[M]=s[o];else{let R=F-A,P=s[A],D=s[A+1];r[M]=P+(D-P)*R}}return r}let i=new Float32Array(e);for(let w=0;w<o;w++)i[w+1]=i[w]+.5*(s[w]+s[w+1]);function a(w){if(w<=0)return 0;if(w>=o)return i[o];let M=w|0,F=w-M,A=s[M],P=s[M+1]-A;return i[M]+A*F+.5*P*F*F}let c=o/(t-1),n=0,x=0;for(let w=0;w<t;w++){let M=w*c,F;if(w===t-1)F=o;else{let R=(w+1)*c;F=.5*(M+R)}let A=F-x;A<=0?r[w]=s[M+.5|0]:r[w]=(a(F)-a(x))/A,x=F,n=M}return r}function uo(s,t){let e=Math.PI*2;return t+e*Math.round((s-t)/e)}function po(s,t=1){t=Math.max(0,Math.min(10,t));let e=s/Math.PI,r=Math.floor(e),o=e-r;for(;t>0;){let i=j0(o),a=Math.min(t,1);o=i*a+(1-a)*o,t-=1}return(r+o)*Math.PI}function xo(s,t){return Math.sqrt(s*s+t*t)|0}var b0=class{constructor(t,e,r,o,i,a){this.cw=e,this.ch=r,this.iw=o,this.ih=i,this.a=new Uint8Array(this.iw*this.ih),this.b=new Uint8Array(this.iw*this.ih),this.front=this.a,this.back=this.b,this.presenter=t,this.seed(),this.RandomizeActiveWarpMaps(a),this.paletteRGBA=new Float32Array(256*4),this.t=0}RandomizeActiveWarpMaps(t){let e=new Array;for(let r=0;r<4;r++){let o=jr(e);ct[r]=[];let i=Pe+(D0-Pe)*Math.random(),a=ie+(M0-ie)*Math.random(),c=i*Math.random()*.6,n=t-c-a,x=t-c,w=t-c+i,M=t-c+i+a;console.log("Generating fresh warp map (blocking)."),ct[r].push(new Ee(o,n,x,w,M,1)),e.push(o)}w0=!0}SetMotionModeDebug(t,e){for(let r=0;r<4;r++){let o=t,i=Pe+(D0-Pe)*Math.random(),a=ie+(M0-ie)*Math.random(),c=e-a,n=e,x=e+i,w=e+i+a,M=r==0?1:1e-7;ct[r]=[],ct[r].push(new Ee(o,c,n,x,w,M)),kt=null}w0=!0}GetMotionDebugInfo(t){let e=new Array,r=Qe(t);for(let o=0;o<4;o++){let i=r[o].mode,a=r[o].raw_str,c=r[o].bal_str,n=`${i}`;e.push(`warp ${o}:  mode ${n.padStart(2," ")}  raw_str ${a.toFixed(2)}  bal_str ${c.toFixed(2)}`)}return e.push(`last blended net_motion           ${Gr.toFixed(2)}`),e.push(`last blended net_zoom_motion      ${Br.toFixed(2)}`),e.push(`last blended in_or_out_motion     ${Lr.toFixed(2)}`),e.push(`last blended net_clockwise_motion ${Or.toFixed(2)}`),e.push(`last blended cw_or_ccw_motion     ${Ur.toFixed(2)}`),At!=null&&(e.push(`last blended cx  ${At.cx.toFixed(2)}`),e.push(`last blended cy  ${At.cy.toFixed(2)}`),e.push(`last blended rad ${At.rad.toFixed(3)}`)),e}resize(t,e,r,o){this.cw=t,this.ch=e,this.iw=r,this.ih=o,this.a=new Uint8Array(this.iw*this.ih),this.b=new Uint8Array(this.iw*this.ih),this.front=this.a,this.back=this.b,this.seed()}seed(){for(let t=0;t<this.front.length;t++)this.front[t]=Math.random()*31|0}update(t,e){this.t+=t,this.audio=e}render(t,e,r,o,i,a,c,n,x,w,M,F,A,R,P,D,h,m,k,B,V,H,l){let u=this.iw,f=this.ih,p=Math.sqrt(u*u+f*f)|0;if(l!="this_is_the_last_param"){console.log("ERROR: Parameter integrity check failed"),se("ERROR: Parameter integrity check failed (Engine::render)");return}a&&this.RandomizeActiveWarpMaps(e);let _=L0+4;if(!V0&&kt==null){let b=U0(e,_);if(b.earliest_dead_i>=0){let O={mode:b.mode,i:b.earliest_dead_i,t0:b.t0,t1:b.t1,t2:b.t2,t3:b.t3};ho(O)}}if(kt!=null){let b=kt.i;Vr(b,e+_).mode==-1?(O0&&console.log(`Using bkg-generated warp map, slot ${b}`),ct[b].push(new Ee(kt.mode,kt.t0,kt.t1,kt.t2,kt.t3,1,kt.warp_map)),kt=null,q0()):(console.log(`Clearing g_bkg_warp_map as slot ${b} is already covered at lookahead time.`),kt=null)}let S=L0,d=U0(e,S);for(;d.earliest_dead_i>=0;){let b=d.earliest_dead_i;console.log(`Generating warp map on demand (slot ${b}, time ${e+S}, `),O0&&Dr(b,e,S),ct[b].push(new Ee(d.mode,d.t0,d.t1,d.t2,d.t3,1)),q0(),d=U0(e,S)}let v=c||Q==null,y=r>gt&&at==null;if(v||y||w0){let b=y?e+L0:e,O=Qe(b),z=new Float32Array(4),I=new Array(4),j=new Float32Array(4);for(let dt=0;dt<4;dt++)z[dt]=Math.max(1e-5,O[dt].bal_str),I[dt]=O[dt].warp_map.warp_prefs,j[dt]=z[dt]*I[dt].wave_prefs_weight;let C=Hr(I,j),q={wave_flat_str:0,wave_flat_angle:0,wave_flat_scale:1,wave_flat_is_stereo:0,wave_flat_stereo_sep:.6,wave_flat_stereo_amplitude_scale:1,wave_flat_cx:0,wave_flat_cy:0,wave_circ_str:0,wave_circ_rad:1,wave_circ_scale:1,wave_circ_angle:0,wave_circ_cx:0,wave_circ_cy:0,radial_beat_dots:0,random_beat_dots:0,fading_dots:0,grid_dots:0},_t=1,it=.25,vt=.01;{let dt=0,Zt=0,Ke=0,Ve=0,u0=0;for(let et=0;et<4;et++)dt+=I[et].net_motion*z[et],Zt+=I[et].net_zoom_motion*z[et],Ke+=I[et].in_or_out_motion*z[et],Ve+=I[et].net_clockwise_motion*z[et],u0+=I[et].cw_or_ccw_motion*z[et];Gr=dt,Br=Zt,Lr=Ke,Or=Ve,Ur=u0,At=Sr(O[0].warp_map,O[1].warp_map,O[2].warp_map,O[3].warp_map,z[0],z[1],z[2],z[3],this.iw,this.ih),w0=!1;let re=1.8;{let et=re*.2,je=re*.35,Pt=Math.max(0,Math.min(1,(Ke-et)/(je-et)));it*=Pt,vt*=Pt}{let et=re*.25,je=re*.35,Pt=Math.max(0,Math.min(1,(Zt-et)/(je-et)));Pt=1-.5*Pt*Math.random(),C.flat_stereo_sep_lo*=Pt,C.flat_stereo_sep_hi*=Pt}{let et=re*.3,je=re*.5,Pt=Math.max(0,Math.min(1,(Zt-et)/(je-et)));Pt=1-.5*Pt*Math.random(),C.circ_rad_lo*=Pt,C.circ_rad_hi*=Pt}{let et=Math.random()<C.use_motion_center_as_wave_center_prob?1:0;et*=Math.pow(Math.random(),C.use_motion_center_as_wave_center_power),C.flat_cx_lo=ne(C.flat_cx_lo,At.cx,et),C.flat_cx_hi=ne(C.flat_cx_hi,At.cx,et),C.flat_cy_lo=ne(C.flat_cy_lo,At.cy,et),C.flat_cy_hi=ne(C.flat_cy_hi,At.cy,et),C.circ_cx_lo=ne(C.circ_cx_lo,At.cx,et),C.circ_cx_hi=ne(C.circ_cx_hi,At.cx,et),C.circ_cy_lo=ne(C.circ_cy_lo,At.cy,et),C.circ_cy_hi=ne(C.circ_cy_hi,At.cy,et)}}let Mt=Math.random()*(_t+it+vt);Mt<_t?q.wave_flat_str=1:(Mt<_t+it||(q.wave_flat_str=1),q.wave_circ_str=1),q.wave_flat_str>1e-4&&(q.wave_flat_angle=po(zt(C.flat_angle_lo,C.flat_angle_hi),C.flat_angle_bias_toward_horizontal_angles),q.wave_flat_scale=C.flat_scale,q.wave_flat_is_stereo=Math.random()<C.flat_is_stereo_chance?1:0,q.wave_flat_stereo_sep=zt(C.flat_stereo_sep_lo,C.flat_stereo_sep_hi),q.wave_flat_stereo_amplitude_scale=C.flat_stereo_amplitude_scale,q.wave_flat_cx=zt(C.flat_cx_lo,C.flat_cx_hi),q.wave_flat_cy=zt(C.flat_cy_lo,C.flat_cy_hi)),q.wave_circ_str>1e-4&&(q.wave_circ_rad=zt(C.circ_rad_lo,C.circ_rad_hi),q.wave_circ_scale=C.circ_scale,q.wave_circ_angle=Math.random()*6.28,q.wave_circ_cx=zt(C.circ_cx_lo,C.circ_cx_hi),q.wave_circ_cy=zt(C.circ_cy_lo,C.circ_cy_hi)),y&&Q!=null&&(Q.wave_flat_str>1e-4?q.wave_flat_str>1e-4?q.wave_flat_angle=uo(Q.wave_flat_angle,q.wave_flat_angle):q.wave_flat_angle=Q.wave_flat_angle:q.wave_flat_str>1e-4&&(Q.wave_flat_angle=q.wave_flat_angle)),q.radial_beat_dots=Math.random()<C.radial_beat_dots_prob?1:0,q.random_beat_dots=Math.random()<C.random_beat_dots_prob?1:0,q.fading_dots=Math.random()<C.fading_dots_prob?1:0,q.grid_dots=Math.random()<C.grid_dots_prob?1:0,v&&(Q=q,at=null,gt=r+zt($r,Cr),oe=gt+zt(H0,I0)),y&&(at=q)}k&&(r<gt?Q.grid_dots=!Q.grid_dots:r<(gt+oe)*.5?(Q.grid_dots=!Q.grid_dots,at.grid_dots=Q.grid_dots):(at.grid_dots=!at.grid_dots,Q.grid_dots=at.grid_dots)),B&&(r<gt?Q.fading_dots=!Q.fading_dots:r<(gt+oe)*.5?(Q.fading_dots=!Q.fading_dots,at.fading_dots=Q.fading_dots):(at.fading_dots=!at.fading_dots,Q.fading_dots=at.fading_dots)),V&&(r<gt?Q.random_beat_dots=!Q.random_beat_dots:r<(gt+oe)*.5?(Q.random_beat_dots=!Q.random_beat_dots,at.random_beat_dots=Q.random_beat_dots):(at.random_beat_dots=!at.random_beat_dots,Q.random_beat_dots=at.random_beat_dots)),H&&(r<gt?Q.radial_beat_dots=!Q.radial_beat_dots:r<(gt+oe)*.5?(Q.radial_beat_dots=!Q.radial_beat_dots,at.radial_beat_dots=Q.radial_beat_dots):(at.radial_beat_dots=!at.radial_beat_dots,Q.radial_beat_dots=at.radial_beat_dots));let g=Q;if(r>gt)if(r<oe){let b=Math.max(0,Math.min(1,(r-gt)/(oe-gt)));b=j0(b);let O=[1-b,b];g=Hr([Q,at],O)}else Q=at,at=null,gt=r+zt($r,Cr),oe=gt+zt(H0,I0),g=Q;let W=Qe(e),T=new Float32Array(4);for(let b=0;b<4;b++)T[b]=W[b].bal_str*zr*A/n,T[b]*=1+.2*Math.cos(o*.7+b*6.28/4),this.presenter.SetWarpMap(b,W[b].warp_map.src_dxy);let N=0,E=0;{let b=zr*A*p/n*121e-6*io,O=ao,z=o*60;N=b*(Math.cos(z*.01171*O+0)*2+Math.cos(z*.00111*O+3)*2),E=b*(Math.cos(z*.00874*O+1)*1.3+Math.cos(z*.00351*O+2)*1.3),ct[0].mode==98&&(N=0,E=0),ct[0].mode==99&&(N=0,E=-5)}let $=1,U=xo(2060,1430),J=Math.max(1,p/U),K=this.generateWaveformPoints(g,J,x,M,$,m,P);if(F){let b={dot_rad:.0025+Math.random()*.0025*10,dot_count:Math.pow(2,4+3*Math.random()),intensity:32+Math.random()*128},O=b.dot_rad*b.dot_rad*b.dot_count*b.intensity,z=(.08+.08*Math.random())*1.5,I=Math.pow(z/O,.25);b.dot_rad*=I*I,b.dot_count*=I,b.intensity*=I;let j=b.dot_rad*p|0,C=Math.random()<.25,q=1/j;if(g.radial_beat_dots>.001){let _t=b.intensity*g.radial_beat_dots|0,it=.2+.35*Math.random(),vt=b.dot_count/2|0;for(let Mt=0;Mt<vt;Mt++){let dt=Mt*Math.PI*2/vt,Zt=Math.cos(dt)*it,Ke=Math.sin(dt)*it,Ve=new Ct(u,f),u0=Ve.NormToScreenX(Zt)|0,re=Ve.NormToScreenY(Ke)|0;K.push(u0,re,j*2,_t*(1/255))}}if(g.random_beat_dots>.001){let _t=b.intensity*g.random_beat_dots|0;for(let it=0;it<b.dot_count;it++){let vt=Math.random()*(u-1)|0,Mt=Math.random()*(f-1)|0;K.push(vt,Mt,j*2,_t*(1/255))}}}if(g.fading_dots>.001){let b=new Ct(u,f),O=Qe(e),z=6.5,I=30;for(let j=0;j<Ft.length;j++){let C=j*Math.PI*2/Ft.length,q=Math.max(0,Math.min(1,.5+.6*Math.cos(t*z+C)))*g.fading_dots*.6*.5;if(q<1e-4)Ft[j].x=Math.random()*u,Ft[j].y=Math.random()*f;else{let it=Ar(Ft[j].x,Ft[j].y,b,O,T,1,N,E);Ft[j].x=it.x,Ft[j].y=it.y;let vt=Ft[j].x|0,Mt=Ft[j].y|0;K.push(vt,Mt,J,q)}}}if(g.grid_dots>.001){let b=Math.sqrt(u*u+f*f)|0,O=24,z=96*g.grid_dots|0,I=t*.7;I-=Math.floor(I);let j=b/O|0,C=j*I|0,q=j/2|0;for(let _t=q;_t<f;_t+=j)for(let it=C;it<u;it+=j)K.push(it,_t,J,z*(1/255))}if(D!=""){let b=Math.max(8,p*_o/Math.max(36,D.length));this.presenter.gpu_warp.set_overlay_text(D,b|0,{center_x:u/2,center_y:f/2,intensity:1,font_family:"Arial",font_weight:"bold",supersample:1,duration:lo,fade_in_power:co})}this.presenter.gpu_warp.text_overlay.get_intensity()>=1&&this.presenter.gpu_warp.burn_overlay_text(u/2,f/2,1);let Z=new Float32Array(K);R||this.presenter.warpAndDrawWaveform(T[0],T[1],T[2],T[3],N,E,Z,h);for(let b=0;b<4;b++){let O=ct[b].length,z=Array();for(let j=0;j<ct[b].length;j++)e<=ct[b][j].t3&&z.push(ct[b][j]);let I=z.length;ct[b]=z,O!=I&&O0&&(console.log(`Pruning warp slot ${b} from ${O} to ${I} entries`),Dr(b,e,0))}let tt=this.front;this.front=this.back,this.back=tt}generateWaveformPoints(t,e,r,o,i,a,c){let n=this.audio;if(!n)return;let x=[],w=this.iw,M=this.ih,F=n.wave,A=n.rms,R=Math.sqrt(w*w+M*M)|0,P=null;if(t.wave_flat_str>0||t.wave_circ_str>0){let D=fo.alignFromF(F,a,F.length);P=Wr(D,r)}if(t.wave_flat_str>0){let D=Math.cos(t.wave_flat_angle),h=Math.sin(t.wave_flat_angle),m=R*oo*(a/.55)/e|0,k=P;k.length!=m&&(k=Ir(k,m));let B=k.length,V=t.wave_flat_is_stereo*t.wave_flat_stereo_sep,H=2*.7*t.wave_flat_scale*(1-.7*Math.sqrt(V)),l=Math.min(255,Math.min(255,A*2e4+16)*t.wave_flat_str)*i*no,u=t.wave_flat_cx,f=t.wave_flat_cy;{let g=u*D+f*h;u-=D*g,f-=h*g}let p=new Ct(w,M),_=p.NormToScreenX(u),S=p.NormToScreenY(f),d=Math.max(0,B-m)/2,v=Math.min(m,B),y=Math.max(0,t.wave_flat_is_stereo*2-1);for(let g=0;g<2&&!(g==1&&(t.wave_flat_is_stereo<1e-4||t.wave_flat_stereo_sep<1e-4));g++){let W=l,T=0;g==1&&(W=W*y|0),T=(-.5+g)*V;let N=H*(y*t.wave_flat_stereo_amplitude_scale+(1-y)*1);W=Math.min(W*(1/255),1);for(let E=0;E<v;E++){let $=E+d|0,U=k[$]*N,J=(E-v*.5)*e,K=(U+T)*(R*.3),X=J*D-K*h,Z=J*h+K*D,tt=_+X,b=S+Z;x.push(tt,b,e,W)}}}if(t.wave_circ_str>0){let D=t.wave_circ_rad*1.15,h=t.wave_circ_scale*.85,m=R*.45|0,k=P;k.length!=m&&(k=Ir(k,m));let B=k.length,V=2.2*t.wave_circ_scale*t.wave_circ_rad,H=Math.min(255,Math.min(255,A*2e4*.16+12)*.6*t.wave_circ_str)|0;H=Math.min(H*(1/255),1)*i;let l=new Ct(w,M),u=l.NormToScreenX(t.wave_circ_cx),f=l.NormToScreenY(t.wave_circ_cy),p=Math.max(0,B-m)/2|0,_=Math.min(m,B),S=_/8|0;for(let d=0;d<_-S;d++){let v=d+p|0,y=k[v]*V;if(d<S){let E=d*(1/S),$=d+p+_-S|0;y=k[$]*V*(1-E)+y*E}let g=d-_*.5,W=y*(R*.3);{let E=d*(1/(_-S)),$=R*(.1*D)+W*(.2*h);g=$*Math.cos(E*(3.1415927*2)+t.wave_circ_angle),W=$*Math.sin(E*(3.1415927*2)+t.wave_circ_angle)}let T=u+g,N=f+W;x.push(T,N,e,H)}}return x}};var mo=`
struct DotUniforms {
  width  : f32,
  height : f32,
  _pad0  : f32,
  _pad1  : f32,
};

// The radial distance over which the dots will fade from opaque to transparent,
// relative to the dot radius.  (Applies to 3x3 or larger dots only.)
// Range: [0..1]
// At 0, a crisp dot of the desired radius is drawn.
// At 1, a blurry dot of double that radius is drawn.
const kRadiusFade = 0.5;//0.25;//0.2;

@group(0) @binding(0) var<uniform> u : DotUniforms;

// Vertex output + fragment input
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) a         : f32,
  @location(1) r1        : f32, // inner radius
  @location(2) r2        : f32, // outer radius
  @location(3) center_pc : vec2f, 
};

@vertex
fn vs_main(
  @location(0) corner_unit : vec2f, // (-1,-1),(+1,-1),(-1,+1),(+1,+1)
  @location(1) inst        : vec4f  // (center_x_pc, center_y_pc, size_px, alpha)
) -> VSOut {
  let center_pc = inst.xy;         // pixel-center coords (integer = pixel center)
  let size_px   = max(inst.z, 1.0);
  let a         = inst.w;

  // size_px:  quad size:   half_extent_pc:   circle_r:
  // 1         1x1          0.5               4
  // 2         2x2          1                 4
  // 3         5x5          2.5               3
  // 4         6x6          3                 4
  // 5         7x7          3.5               5

  // A size of 1 means cover exactly one pixel: center_pc +/- 0.5 in pixel-center coords.
  var half_extent_pc = 0.5 * size_px;

  // Compute circle radius of the white part of the dot to send down to fragment shader.
  // - If point size is 1x1: force very large so it fully covers the square.
  // - If radius > 1: circle_radius = radius - 1.
  // - Otherwise (i.e., ~3x3 to ~4x4-ish), also force large so it's fully covered.
  //   (This matches your intent: small dots should not get circularly clipped.)
  var r1 = 4.0;
  var r2 = 5.0;
  if (size_px >= 1.0001) {
		// Find the exact circle radius that would have the exact same square area
		// as the NxN-pixel square dot.
    let square_area = size_px * size_px;
    let ideal_r = pow(square_area / 3.1415927, 0.5);

		r1 = ideal_r * (1.0 - kRadiusFade);
		r2 = ideal_r * (1.0 + kRadiusFade);
		// The antialiasing will be from [rad - kRadiusFadeDistance/2] ... [rad + kRadiusFadeDistance/2],
		// so choose the square size to make sure we cover it.
    half_extent_pc = ceil(r2);
  }
 
  // Quad corners in pixel-center coords.
  let p_pc = center_pc + corner_unit * half_extent_pc;

  // Convert pixel-center coords -> pixel coords used for NDC mapping:
  // pixel center x corresponds to pixel coord x+0.5
  let p_px = p_pc + 0.5;

  let ndc_x = (p_px.x / u.width) * 2.0 - 1.0;
  let ndc_y = 1.0 - (p_px.y / u.height) * 2.0;

  var out: VSOut;
  out.pos = vec4f(ndc_x, ndc_y, 0.0, 1.0);
  out.a = a;
  out.r1 = r1;
  out.r2 = r2;
  out.center_pc = center_pc;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  // Fragment position in pixel-center coords (integer means pixel center)
  let pc = in.pos.xy - 0.5;

  // Distance from dot center in pixel-center coords.
  // This should be exactly zero in the center of the anti-aliased edge.
  let r = length(pc - in.center_pc);

  // 1 inside circle_r, 0 outside, with a 1-pixel fade band.
  // Fade over [circle_r .. circle_r + 1]
  // smoothstep(edge0, edge1, x) is a clamped, smooth threshold function.
	//   It returns 0 when x <= edge0
	//   It returns 1 when x >= edge1
	//   Between edge0 and edge1, it transitions smoothly from 0\u21921 with zero slope at both ends (so no sharp corners / banding).
  //let coverage = 1.0 - smoothstep(in.circle_r, in.circle_r + 1.0, d);
  var coverage = 1.0 - (r - in.r1) / (in.r2 - in.r1 + 0.000001);
  coverage = max(0.0, min(1.0, coverage));
  
  return vec4f(max(0.0, min(1.0, in.a)) * coverage, 0.0, 0.0, 1.0);
  //return vec4f(1.0, 0.0, 0.0, 1.0);
}
`,k0=class{constructor(t,e="rgba8unorm"){this.device=t,this.target_format=e,this.pipeline=null,this.bind_group=null,this.uniform_buf=null,this.corner_buf=null,this.instance_buf=null,this.max_points=0,this.point_count=0,this.instance_f32=null}init(t=8192){let e=this.device;this.max_points=t|0,this.uniform_buf=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let r=new Float32Array([-1,-1,1,-1,-1,1,1,1]);this.corner_buf=e.createBuffer({size:r.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,mappedAtCreation:!0}),new Float32Array(this.corner_buf.getMappedRange()).set(r),this.corner_buf.unmap(),this.instance_buf=e.createBuffer({size:16*this.max_points>>>0,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.instance_f32=new Float32Array(this.max_points*4);let o=e.createShaderModule({code:mo});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:o,entryPoint:"vs_main",buffers:[{arrayStride:8,stepMode:"vertex",attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]},{arrayStride:16,stepMode:"instance",attributes:[{shaderLocation:1,offset:0,format:"float32x4"}]}]},fragment:{module:o,entryPoint:"fs_main",targets:[{format:this.target_format,blend:{color:{operation:"add",srcFactor:"one",dstFactor:"one"},alpha:{operation:"add",srcFactor:"one",dstFactor:"one"}},writeMask:GPUColorWrite.RED}]},primitive:{topology:"triangle-strip"}}),this.bind_group=e.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform_buf}}]})}set_uniforms(t,e){let r=new Float32Array([t,e,0,0]);this.device.queue.writeBuffer(this.uniform_buf,0,r)}upload_points(t){let r=(t.length|0)/4|0;r>this.max_points&&console.log(`WARNING: DotRenderer max_points is ${this.max_points} but ${r} points were attemped to be drawn.  Not all points will be drawn.`);let o=Math.min(r,this.max_points);return this.instance_f32.set(t.subarray(0,o*4),0),this.device.queue.writeBuffer(this.instance_buf,0,this.instance_f32,0,o*4),this.point_count=o,o}draw(t,e){if(!this.point_count)return;let r=t.beginRenderPass({colorAttachments:[{view:e,loadOp:"load",storeOp:"store"}]});r.setPipeline(this.pipeline),r.setBindGroup(0,this.bind_group),r.setVertexBuffer(0,this.corner_buf),r.setVertexBuffer(1,this.instance_buf),r.draw(4,this.point_count,0,0),r.end()}};function yo(s){return s+255&-256}function go(s,t){let e=s.createTexture({size:{width:t,height:t,depthOrArrayLayers:1},format:"r8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),r=e.createView(),i=t*1,a=yo(i),c=new Uint8Array(a*t);for(let n=0;n<a*t;n++){let x=(Math.random()+Math.random()+Math.random())*.3333333333333333;c[n]=x*255+.5|0}return s.queue.writeTexture({texture:e},c,{bytesPerRow:a,rowsPerImage:t},{width:t,height:t,depthOrArrayLayers:1}),{texture:e,view:r}}function Qr(s,t,e){if(!1)throw new Error(`kNoiseTexSize invalid: ${256}`);if(!1)throw new Error(`kNoiseTexCount invalid: ${4}`);let r=new Array(4),o=new Array(4),i=new Array(4),a=s.createSampler({addressModeU:"repeat",addressModeV:"repeat",magFilter:"linear",minFilter:"linear",mipmapFilter:"linear"});for(let c=0;c<4;c++){let{texture:n,view:x}=go(s,256);r[c]=n,o[c]=x}return{textures:r,views:o,bilinear_wrap_sampler:a}}function Jr(s){let t=4;return(t&t-1)===0?s&t-1:s%t}var wo=`
struct TextUniforms {
  left_px   : f32,
  top_px    : f32,
  width_px  : f32,
  height_px : f32,

  dst_w     : f32,
  dst_h     : f32,
  intensity : f32,
  _pad0     : f32,
};

@group(0) @binding(0) var text_tex  : texture_2d<f32>;
@group(0) @binding(1) var text_samp : sampler;
@group(0) @binding(2) var<uniform> u : TextUniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var corner = array<vec2f, 6>(
    vec2f(0.0, 0.0),
    vec2f(1.0, 0.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, 0.0),
    vec2f(1.0, 1.0)
  );

  let c = corner[vid];

  let px = u.left_px + c.x * u.width_px;
  let py = u.top_px  + c.y * u.height_px;

  let ndc_x = (px / u.dst_w) * 2.0 - 1.0;
  let ndc_y = 1.0 - (py / u.dst_h) * 2.0;

  var out : VSOut;
  out.pos = vec4f(ndc_x, ndc_y, 0.0, 1.0);
  out.uv = c;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let a = textureSampleLevel(text_tex, text_samp, in.uv, 0.0).a;
  return vec4f(a * u.intensity, 0.0, 0.0, 0.0);
}
`,A0=class{constructor(t,e="rgba8unorm"){this.device=t,this.target_format=e,this.pipeline=null,this.uniform_buf=null,this.sampler=null,this.canvas=null,this.ctx=null,this.text_tex=null,this.text_view=null,this.bind_group=null,this.dummy_tex=null,this.dummy_view=null,this.text_px_w=0,this.text_px_h=0,this.tex_w=0,this.tex_h=0,this.supersample=2,this.has_text=!1,this.overlay_enabled=!1,this.overlay_center_x=0,this.overlay_center_y=0,this.overlay_intensity=1,this.t0=-2,this.t1=-1,this.fade_in_power=1}init(){let t=this.device,e=t.createShaderModule({code:wo});this.pipeline=t.createRenderPipeline({layout:"auto",vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.target_format,blend:{color:{operation:"add",srcFactor:"one",dstFactor:"one"},alpha:{operation:"add",srcFactor:"zero",dstFactor:"one"}},writeMask:GPUColorWrite.RED}]},primitive:{topology:"triangle-list"}}),this.uniform_buf=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sampler=t.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest"}),this._ensure_canvas(),this._create_dummy_texture()}_ensure_canvas(){if(!(this.canvas&&this.ctx)&&(typeof OffscreenCanvas<"u"?this.canvas=new OffscreenCanvas(1,1):(this.canvas=document.createElement("canvas"),this.canvas.width=1,this.canvas.height=1),this.ctx=this.canvas.getContext("2d",{alpha:!0}),!this.ctx))throw new Error("GpuTextOverlay: failed to get 2D canvas context")}_create_dummy_texture(){this.dummy_tex=this.device.createTexture({size:{width:1,height:1},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.dummy_view=this.dummy_tex.createView();let t=new Uint8Array([0,0,0,0]);this.device.queue.writeTexture({texture:this.dummy_tex},t,{bytesPerRow:4,rowsPerImage:1},{width:1,height:1})}_recreate_texture_if_needed(t,e){if(!(this.text_tex&&this.tex_w===t&&this.tex_h===e)){if(this.text_tex){try{this.text_tex.destroy()}catch{}this.text_tex=null,this.text_view=null,this.bind_group=null}this.tex_w=t,this.tex_h=e,this.text_tex=this.device.createTexture({size:{width:t,height:e},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),this.text_view=this.text_tex.createView(),this._rebuild_bind_group()}}_rebuild_bind_group(){if(!this.pipeline||!this.text_view||!this.sampler||!this.uniform_buf)return;let t=this.pipeline.getBindGroupLayout(0);this.bind_group=this.device.createBindGroup({layout:t,entries:[{binding:0,resource:this.text_view},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniform_buf}}]})}clear_text(){this.has_text=!1,this.text_px_w=0,this.text_px_h=0,this.overlay_enabled=!1}set_text(t,e,{font_family:r="sans-serif",font_weight:o="bold",supersample:i=2,padding_px:a=4,fill_style:c="#ffffff"}={}){if(this._ensure_canvas(),t=`${t??""}`,!t.length||!(e>0)){this.clear_text();return}let n=Math.max(1,i|0);this.supersample=n;let x=e*n,w=Math.max(1,Math.ceil(a*n)),M=this.ctx;M.font=`${o} ${x}px ${r}`,M.textAlign="left",M.textBaseline="alphabetic";let F=M.measureText(t),A=Math.ceil(F.actualBoundingBoxLeft??0),R=Math.ceil(F.actualBoundingBoxRight??Math.ceil(F.width)),P=Math.ceil(F.actualBoundingBoxAscent??Math.ceil(x*.8)),D=Math.ceil(F.actualBoundingBoxDescent??Math.ceil(x*.2)),h=Math.max(1,A+R),m=Math.max(1,P+D),k=Math.max(1,h+w*2+16),B=Math.max(1,m+w*2);this.canvas.width=k,this.canvas.height=B,M.font=`${o} ${x}px ${r}`,M.textAlign="left",M.textBaseline="alphabetic",M.clearRect(0,0,k,B);let V=w+A,H=w+P;M.fillStyle=c,M.fillText(t,V-A,H),this._recreate_texture_if_needed(k,B),this.device.queue.copyExternalImageToTexture({source:this.canvas},{texture:this.text_tex},{width:k,height:B}),this.text_px_w=k/n,this.text_px_h=B/n,this.has_text=!0}show_overlay(t,e,r,o,i,a){if(!this.has_text){this.overlay_enabled=!1;return}this.overlay_enabled=!0,this.overlay_center_x=t,this.overlay_center_y=e,this.overlay_intensity=r,this.t0=o,this.t1=i,this.fade_in_power=a}hide_overlay(){this.overlay_enabled=!1}get_presenter_texture_view(){return this.overlay_enabled&&this.has_text&&this.text_view?this.text_view:this.dummy_view}get_sampler(){return this.sampler}get_intensity(){if(this.t0<0)return 0;let t=performance.now()*.001,e=Math.max(0,Math.min(1,(t-this.t0)/(this.t1-this.t0)));return e=Math.pow(e,this.fade_in_power),this.overlay_intensity*e}get_presenter_rect(){let t=this.has_text?this.text_px_w:0,e=this.has_text?this.text_px_h:0,r=this.overlay_center_x-t*.5,o=this.overlay_center_y-e*.5,i=this.get_intensity();return{enabled:this.overlay_enabled&&this.has_text?1:0,left_px:r,top_px:o,width_px:t,height_px:e,intensity:i}}draw(t,e,r,o,i,a,c=1){if(!this.has_text||!this.pipeline||!this.bind_group)return;let n=i-this.text_px_w*.5,x=a-this.text_px_h*.5,w=new Float32Array([n,x,this.text_px_w,this.text_px_h,r,o,c,0]);this.device.queue.writeBuffer(this.uniform_buf,0,w);let M=t.beginRenderPass({colorAttachments:[{view:e,loadOp:"load",storeOp:"store"}]});M.setPipeline(this.pipeline),M.setBindGroup(0,this.bind_group),M.draw(6),M.end()}};var Zr=`struct WarpUniforms {
  // strengths for each warp map (in pixels per pixel, if warp maps are in pixels)
  w0 : f32,
  w1 : f32,
  w2 : f32,
  w3 : f32,

  // Optional global shift in pixels (can leave 0)
  shift_x : f32,
  shift_y : f32,

  // dimensions (float for convenience)
  warp_width  : f32,
  warp_height : f32,
  index_width  : f32,
  index_height : f32,
  index_width_inv  : f32,
  index_height_inv : f32,
  x0x1 : f32,
  y0y1 : f32,
  inv_x0x1 : f32,
  inv_y0y1 : f32,

	noise_offset_x : f32,
	noise_offset_y : f32,
  darkening : f32,		// [-1..1]
  _pad2 : f32,
};
`,ts=Zr+`
struct ExposureOut {
  decay : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};

@group(0) @binding(0) var old_tex : texture_2d<f32>;        // rgba8unorm view (sampleType float)
@group(0) @binding(1) var warp0   : texture_2d<f32>;        // rg16float
@group(0) @binding(2) var warp1   : texture_2d<f32>;
@group(0) @binding(3) var warp2   : texture_2d<f32>;
@group(0) @binding(4) var warp3   : texture_2d<f32>;
@group(0) @binding(5) var samp    : sampler;               // filtering sampler
@group(0) @binding(6) var<uniform> u : WarpUniforms;
@group(0) @binding(7) var noise_tex : texture_2d<f32>;      // r8unorm, loaded via textureLoad
@group(0) @binding(8) var<storage, read> exposure : ExposureOut;
//@group(0) @binding(7) var noise_tex0 : texture_2d<f32>;      // r8unorm, loaded via textureLoad
//@group(0) @binding(9) var noise_samp : sampler;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(-1.0,  3.0),
    vec2f( 3.0, -1.0)
  );
  let p = pos[vid];
  return vec4f(p, 0.0, 1.0);
}

fn clamp_i32(x: i32, lo: i32, hi: i32) -> i32 {
  return max(lo, min(hi, x));
}

// Decode packed u16 from RG of an rgba8unorm textureLoad result.
// c.r and c.g are floats in [0..1].
fn decode_u16_from_rg(c: vec4f) -> u32 {
  // Round to nearest byte.
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

// Encode u16 (0..65535) into RG bytes in [0..1] for rgba8unorm output.
fn encode_rg_from_u16(v: u32) -> vec4f {
  let hi: u32 = (v >> 8) & 255u;
  let lo: u32 =  v       & 255u;
  return vec4f(f32(hi) * (1.0 / 255.0),
               f32(lo) * (1.0 / 255.0),
               0.0,
               1.0);
}

// Wrap an integer into [0..n-1] (works for negative too).
fn wrap_i32(x: i32, n: i32) -> i32 {
  // WGSL % keeps the sign of x, so fix negatives.
  let r = x % n;
  return select(r, r + n, r < 0);
}

// Manual bilinear sampling from old_tex for packed-u16 scalar, with WRAP on all edges.
// Caller is responsible for biasing pixel coords by (+0.5, +0.5) before calling.
fn sample_old_u16_bilinear(src_pos: vec2f) -> f32 {
  let w = i32(u.index_width);
  let h = i32(u.index_height);

  // Floor to get base texel (can be negative / outside).
  let x0f = floor(src_pos.x);
  let y0f = floor(src_pos.y);

  // Fraction within the cell [0..1).
  // (Caller bias ensures "no drift" when sampling texel centers.)
  let fx = src_pos.x - x0f;
  let fy = src_pos.y - y0f;

  // Wrap base texel and its neighbor.
  let x0 = wrap_i32(i32(x0f), w);
  let y0 = wrap_i32(i32(y0f), h);
  let x1 = wrap_i32(x0 + 1, w);
  let y1 = wrap_i32(y0 + 1, h);

  let c00 = textureLoad(old_tex, vec2i(x0, y0), 0);
  let c01 = textureLoad(old_tex, vec2i(x1, y0), 0);
  let c10 = textureLoad(old_tex, vec2i(x0, y1), 0);
  let c11 = textureLoad(old_tex, vec2i(x1, y1), 0);

  let v00 = f32(decode_u16_from_rg(c00));
  let v01 = f32(decode_u16_from_rg(c01));
  let v10 = f32(decode_u16_from_rg(c10));
  let v11 = f32(decode_u16_from_rg(c11));

  // Bilinear lerp.
  let a0 = v00 + (v01 - v00) * fx;
  let a1 = v10 + (v11 - v10) * fx;
  return a0 + (a1 - a0) * fy;
}

//fn fetcher(src_pos: vec2f, dx: i32, dy: i32) -> f32 {
//	let s1 = vec2i(i32(floor(src_pos.x + 0.5)), i32(floor(src_pos.y + 0.5)));
//	let s2 = vec2i(s1.x + dx, s1.y + dy);
//	let packed = textureLoad(old_tex, s2, 0);
//	return f32(decode_u16_from_rg(packed));	
//}



// p.xy : the output coordinates in [0..index_width - 1, 0 .. index_height - 1]
@fragment
fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f {

  // Destination pixel coords in the index texture space (assume 1:1 for now).
  let dx = p.x;		// [0 .. u.index_width - 1]
  let dy = p.y;		// [0 .. u.index_height - 1]

  // UV in [0..1] for sampling warp maps with bilinear.
	// General conversion formula:  (screen [0..W]x[0..H] -> normalized [-1..1])
	//   fx [-1..1] = (dx * inv_W - 0.5) * x0x1
	//   fy [-1..1] = (dy * inv_H - 0.5) * y0y1
  var uv = vec2f(dx * (1.0 / (u.index_width - 1)), 
                 dy * (1.0 / (u.index_height - 1)));		// [0..1]
	uv = (uv - 0.5) * vec2f(u.x0x1, u.y0y1);  // -> Now in normalized coordinate space.
	uv = uv * 0.5 + 0.5;          // -> Now go back to [0..1] UV sampling space. 
  uv += vec2f(0.5 / u.warp_width, 0.5 / u.warp_height);		// (Doesn't really matter) //TODO

  // Sample 4 warp maps (rg16float), bilinear.
  let wv0 = textureSampleLevel(warp0, samp, uv, 0.0).xy;
  let wv1 = textureSampleLevel(warp1, samp, uv, 0.0).xy;
  let wv2 = textureSampleLevel(warp2, samp, uv, 0.0).xy;
  let wv3 = textureSampleLevel(warp3, samp, uv, 0.0).xy;

  // Combined warp vector (in pixels if your warp maps are in pixels).
  var warp_vec =
      (wv0 * u.w0 +
       wv1 * u.w1 +
       wv2 * u.w2 +
       wv3 * u.w3);

	// General conversion formula:  (normalized [-1..1] -> screen [0..W]x[0..H])
	//   dx [0..W]  = (fx * inv_x0x1 * 0.5 + 0.5) * W
	//   dy [0..H]  = (fy * inv_y0y1 * 0.5 + 0.5) * H
	// TODO: This *0.5 should not be here; remove it.
	//   *** see similar TODO in AdvectPoint().
  warp_vec = warp_vec
       * vec2f(u.inv_x0x1 * 0.5 * u.index_width,
               u.inv_y0y1 * 0.5 * u.index_height)
       ;

	//warp_vec = vec2f(0.0, -5);     // IN PIXELS

	//let warp_noise_vec = vec2f(
	//    textureSample(noise_tex0, noise_samp, uv * 0.2                  ).r * 2 - 1,
	//    textureSample(noise_tex0, noise_samp, uv * 0.2 + vec2f(0.5, 0.5)).r * 2 - 1
	//) * vec2f(u.index_width, u.index_height) * 0.00015 * 0.0;

  // Source position -- in pixel space.
  let src_pos = 
  		vec2f(dx, dy) 
      + warp_vec
      //+ warp_noise_vec
  		+ vec2f(u.shift_x, u.shift_y)
      - vec2f(0.5, 0.5)
  		;

  // Sample old image (packed u16) manually with bilinear.
  var v = sample_old_u16_bilinear(src_pos);


	//// Experiment: sharpen.
	//// -> fails because src_pos is in-between 2x2 pixels, and we're just
	//      always reading 3x3 snapped pixels, and comparing them.
  //let blurred =                                                    
  //		(fetcher(src_pos, -1, -1)     +
  //		 fetcher(src_pos, -1,  0) * 2 +
  //		 fetcher(src_pos, -1,  1)     +
  //		 fetcher(src_pos,  0, -1) * 2 +
  //		 fetcher(src_pos,  0,  0) * 4 +
  //		 fetcher(src_pos,  0,  1) * 2 +
  //		 fetcher(src_pos,  1, -1)     +
  //		 fetcher(src_pos,  1,  0) * 2 +
  //		 fetcher(src_pos,  1,  1)) * (1.0 / 16);
	//v = v * 0.1 + 0.9 * blurred;
  //

	//let checkerboard = (u32(floor(dx * 0.02)) & 1) * 256 - 128;

  // Round to nearest u16 and write back packed into RG.
  var v_u = clamp(floor(v + 0.5), 0.0, 65535.0);// + checkerboard;



	// Add noise.
  // Tiny unfiltered noise (textureLoad). Wrap by & (size-1) since size is 256.
  // p.xy are pixel coords in the output render target space.
  let nx = (u32(p.x) + u32(u.noise_offset_x)) & (256u - 1u);
  let ny = (u32(p.y) + u32(u.noise_offset_y)) & (256u - 1u);
  let n01 = textureLoad(noise_tex, vec2u(nx, ny), 0).r;  // [0,1]
  let noise = n01 * 2.0 - 1.0;                               // [-1,1]

  // Sprinkle: pick a *tiny* scale. Tune later.
  const kNoiseStrength = 1.015;//1.015;//1.005;
	v_u *= pow(kNoiseStrength, noise);



	// TODO: Put in a better decay.
	//let decay = 0.99;//0.997;
	let decay = exposure.decay;
	v_u *= decay;	
	//v_u *= 0.0;//FIXME_WAVEFORM
  
  let rounded = u32(max(0.0, min(65535.0, v_u + 0.5)));
  
  return encode_rg_from_u16(rounded);
}`,vo=Zr+`
@group(0) @binding(0) var old_tex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> u : WarpUniforms;

struct ExposureOut {
  decay : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
};
@group(0) @binding(2) var<storage, read_write> out_exposure : ExposureOut;

fn decode_u16_from_rg(c: vec4f) -> u32 {
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

// Simple integer hash (good enough for sampling coords)
fn hash_u32(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

const kWG: u32 = 256u;
const kSamplesPerThread: u32 = 16u; // 256*16 = 4096 samples total

var<workgroup> wg_sum : array<f32, 256>;

@compute @workgroup_size(256)
fn cs_main(@builtin(local_invocation_id) lid: vec3u) {
  let tid = lid.x;

  let w = u32(u.index_width);
  let h = u32(u.index_height);

  // Seed from tid + per-frame noise offsets (you update these each frame)
  // (note: u.noise_offset_x/y are floats; convert safely)
  let sx_seed = u32(u.noise_offset_x);
  let sy_seed = u32(u.noise_offset_y);
  var seed = hash_u32(tid ^ (sx_seed * 1315423911u) ^ (sy_seed * 2654435761u));

  var sum: f32 = 0.0;

  // Strided random samples
  for (var i: u32 = 0u; i < kSamplesPerThread; i++) {
    seed = hash_u32(seed + 0x9e3779b9u);

    // Derive coords from seed
    let x = (seed      ) % w;
    let y = (seed >> 16) % h;

    let c = textureLoad(old_tex, vec2u(x, y), 0);
    let v_u16 = f32(decode_u16_from_rg(c));
    sum += v_u16;
  }

  wg_sum[tid] = sum;
  workgroupBarrier();

  // Reduce within workgroup
  var stride = 128u;
  while (stride > 0u) {
    if (tid < stride) {
      wg_sum[tid] += wg_sum[tid + stride];
    }
    workgroupBarrier();
    stride >>= 1u;
  }

  // Thread 0 writes final average and converts to decay
  if (tid == 0u) {
    let total_samples = f32(kWG * kSamplesPerThread);
    let avg_u16 = wg_sum[0] / total_samples;         // [0..65535]ish

		// DECAY TUNING:
		/*
    let avg01 = avg_u16 * (1.0 / 65535.0);    
		const clamp_thresh = 1.2 / 255.0;//1.3;	
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const divisor = 6.3;//9;
		let prev_avg_clamped = max(avg01 - clamp_thresh, 0.0);
		let decay = 1.0 - 0.25 * (prev_avg_clamped / divisor);    
    */

		/*
    let avg8 = avg_u16 * (1.0 / 256.0);    		// [0..255]
		// Tune this first, to the decay you want when the image is already dark.
		const base_decay = 1.0;    
		const clamp_thresh = 1.2;	
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const divisor = 1613;
		let prev_avg_clamped = max(avg8 - clamp_thresh, 0.0);
		let decay = base_decay - 0.25 * (prev_avg_clamped / divisor);    
		*/
		
    let avg8 = avg_u16 * (1.0 / 256.0);    		// [0..255]
		// Tune this first, to the decay you want when the image is already dark.
		const base_decay = 0.997;//1.0;
		const fast_decay = 0.990;
		let exp_base = select(base_decay, fast_decay, u.darkening >= 0);
		let adj_base_decay = base_decay * pow(exp_base, u.darkening);
					
		let min_level_for_extra_decay = 30 * (1 - u.darkening);//1.2;  	// [0..255]
		// Lower divisor -> quicker decay to black *of very bright stuff* over time
		const extra_decay_strength = 0.000075;//0.000155
		let prev_avg_clamped = max(avg8 - min_level_for_extra_decay, 0.0);
		let decay = max(0.0, adj_base_decay - (prev_avg_clamped * extra_decay_strength));        
    
    out_exposure.decay = decay;
  }
}
`,es=new Float32Array(1),Mo=new Uint32Array(es.buffer);function bo(s){es[0]=s;let t=Mo[0],e=t>>>16&32768,r=t&8388607,o=t>>>23&255;return o===255?r!==0?e|32256:e|31744:(o=o-127+15,o<=0?o<-10?e:(r=(r|8388608)>>>1-o,r&4096&&(r+=8192),e|r>>>13):o>=31||r&4096&&(r+=8192,r&8388608&&(r=0,o+=1,o>=31))?e|31744:e|o<<10|r>>>13)}function ko(s){let t=s.length;if(typeof Float16Array<"u"){let r=new Float16Array(t);return r.set(s),new Uint16Array(r.buffer,r.byteOffset,t).slice()}console.log("WARNING: Native Float16Array not supported by browser; warp map uploads will be slow and might cause brief pauses.");let e=new Uint16Array(t);for(let r=0;r<t;r++)e[r]=bo(s[r]);return e}function Ao(s){let t=s.length,e=new Uint8Array(t*4);for(let r=0;r<t;r++){let o=s[r]&255;e[r*4+0]=o,e[r*4+1]=0,e[r*4+2]=0,e[r*4+3]=255}return e}var S0=class{constructor(t,e,r,o){this.device=t,this.W=e,this.H=r,this.shader_code=o,this.index_tex=[null,null],this.index_view=[null,null],this.ping=0,this.warp_tex=[null,null,null,null],this.warp_view=[null,null,null,null],this.sampler=null,this.uniform_buf=null,this.bind_group=null,this.pipeline=null,this.dots=null,this.noise=null,this.bind_groups=null,this.frame_index=0,this.exposure_buf=null,this.autoexp_pipeline=null,this.autoexp_bind_groups=[null,null],this.text_overlay=null,this.pending_text_burn=!1,this.pending_text_burn_center_x=0,this.pending_text_burn_center_y=0,this.pending_text_burn_intensity=1,this.warp_map=new Array;for(let i=0;i<4;i++)this.warp_map.push(null)}resize(t,e){if(!this.pipeline)return;if(t|=0,e|=0,t<=0||e<=0)throw new Error(`GPUWarp.resize invalid size: ${t}x${e}`);if(this.W===t&&this.H===e&&this.index_tex[0]&&this.index_tex[1])return;for(let o=0;o<2;o++)if(this.index_tex[o]){try{this.index_tex[o].destroy()}catch{}this.index_tex[o]=null,this.index_view[o]=null}this.W=t,this.H=e,this.ping=0;let r=this.device;for(let o=0;o<2;o++)this.index_tex[o]=r.createTexture({size:{width:this.W,height:this.H},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC}),this.index_view[o]=this.index_tex[o].createView();this.rebuild_autoexp_bind_groups(),this.rebuild_bind_groups_all(),this.fill_index_u8_with_noise()}init(){let t=this.device;for(let o=0;o<2;o++)this.index_tex[o]=t.createTexture({size:{width:this.W,height:this.H},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC}),this.index_view[o]=this.index_tex[o].createView();for(let o=0;o<4;o++)this.warp_tex[o]=t.createTexture({size:{width:512,height:512},format:"rg16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.warp_view[o]=this.warp_tex[o].createView();this.sampler=t.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest"}),this.uniform_buf=t.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let e=t.createShaderModule({code:this.shader_code});this.pipeline=t.createRenderPipeline({layout:"auto",vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:"rgba8unorm"}]},primitive:{topology:"triangle-list"}}),this.exposure_buf=t.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});let r=t.createShaderModule({code:vo});this.autoexp_pipeline=t.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:"cs_main"}}),this.rebuild_autoexp_bind_groups(),this.dots=new k0(t,"rgba8unorm"),this.dots.init(32768),this.noise=Qr(t),this.text_overlay=new A0(t,"rgba8unorm"),this.text_overlay.init(),this.rebuild_bind_groups_all()}rebuild_autoexp_bind_groups(){if(!this.autoexp_pipeline||!this.exposure_buf||!this.index_view[0]||!this.index_view[1])return;let t=this.autoexp_pipeline.getBindGroupLayout(0);for(let e=0;e<2;e++)this.autoexp_bind_groups[e]=this.device.createBindGroup({layout:t,entries:[{binding:0,resource:this.index_view[e]},{binding:1,resource:{buffer:this.uniform_buf}},{binding:2,resource:{buffer:this.exposure_buf}}]})}rebuild_bind_groups_all(){let t=this.pipeline.getBindGroupLayout(0),e=this.noise.views.length;this.bind_groups=[new Array(e),new Array(e)];for(let r=0;r<2;r++)for(let o=0;o<e;o++)this.bind_groups[r][o]=this.device.createBindGroup({layout:t,entries:[{binding:0,resource:this.index_view[r]},{binding:1,resource:this.warp_view[0]},{binding:2,resource:this.warp_view[1]},{binding:3,resource:this.warp_view[2]},{binding:4,resource:this.warp_view[3]},{binding:5,resource:this.sampler},{binding:6,resource:{buffer:this.uniform_buf}},{binding:7,resource:this.noise.views[o]},{binding:8,resource:{buffer:this.exposure_buf}}]})}upload_index_u8(t){if(!t||t.length<this.W*this.H)throw new Error(`upload_index_u8: index_u8 length (${t?t.length:"null"}) < W*H (${this.W*this.H})`);let e=Ao(t),r=this.W*4,o=r+255&-256,i=(a,c)=>{if(o===r){this.device.queue.writeTexture({texture:a},c,{bytesPerRow:r,rowsPerImage:this.H},{width:this.W,height:this.H});return}let n=o*this.H;!this._padded_index_rgba8||this._padded_index_rgba8.length!==n?this._padded_index_rgba8=new Uint8Array(n):this._padded_index_rgba8.fill(0);for(let x=0;x<this.H;x++){let w=x*r,M=x*o;this._padded_index_rgba8.set(c.subarray(w,w+r),M)}this.device.queue.writeTexture({texture:a},this._padded_index_rgba8,{bytesPerRow:o,rowsPerImage:this.H},{width:this.W,height:this.H})};i(this.index_tex[this.ping],e),i(this.index_tex[this.ping^1],e)}fill_index_u8_with_noise(){let t=new Uint8Array(this.W*this.H);for(let e=0;e<this.W*this.H;e++)t[e]=Math.random()*40|0;this.upload_index_u8(t)}upload_warp_map(t,e){if(this.warp_map[t]!=e){this.warp_map[t]=e;let r=512,o=512,i=ko(e);this.device.queue.writeTexture({texture:this.warp_tex[t]},i,{bytesPerRow:r*4,rowsPerImage:o},{width:r,height:o})}}set_params({w0:t=1,w1:e=0,w2:r=0,w3:o=0,shift_x:i=0,shift_y:a=0,darkening:c=0,warp_width:n=512,warp_height:x=512,image_width:w=this.W,image_height:M=this.H}={}){let F=new Ct(w,M),A=1/w,R=1/M,P=Math.random()*255|0,D=Math.random()*255|0,h=new Float32Array([t,e,r,o,i,a,n,x,w,M,A,R,F.x0x1,F.y0y1,F.inv_x0x1,F.inv_y0y1,P,D,c,0]);this.device.queue.writeBuffer(this.uniform_buf,0,h)}step(t){let e=this.device,r=this.ping,o=this.ping^1,i=e.createCommandEncoder();{let n=i.beginComputePass();n.setPipeline(this.autoexp_pipeline),n.setBindGroup(0,this.autoexp_bind_groups[r]),n.dispatchWorkgroups(1),n.end()}let a=i.beginRenderPass({colorAttachments:[{view:this.index_view[o],clearValue:{r:0,g:0,b:0,a:1},loadOp:"load",storeOp:"store"}]}),c=Jr(this.frame_index++);a.setPipeline(this.pipeline),a.setBindGroup(0,this.bind_groups[r][c]),a.draw(3),a.end(),t&&t.length&&(this.dots.set_uniforms(this.W,this.H,!0),this.dots.upload_points(t),this.dots.draw(i,this.index_view[o])),this.pending_text_burn&&this.text_overlay&&(this.text_overlay.draw(i,this.index_view[o],this.W,this.H,this.pending_text_burn_center_x,this.pending_text_burn_center_y,this.pending_text_burn_intensity),this.text_overlay.clear_text(),this.pending_text_burn=!1),e.queue.submit([i.finish()]),this.ping=o}get_current_index_view(){return this.index_view[this.ping]}get_current_index_texture(){return this.index_tex[this.ping]}set_overlay_text(t,e,{font_family:r="sans-serif",font_weight:o="bold",supersample:i=2,padding_px:a=4,center_x:c=this.W*.5,center_y:n=this.H*.5,intensity:x=1,duration:w=2,fade_in_power:M=.5}={}){if(!this.text_overlay)return;this.text_overlay.set_text(t,e,{font_family:r,font_weight:o,supersample:i,padding_px:a});let F=performance.now()*.001,A=F,R=F+w;this.text_overlay.show_overlay(c,n,x,A,R,M)}clear_overlay_text(){this.text_overlay&&(this.text_overlay.clear_text(),this.pending_text_burn=!1)}hide_overlay_text(){this.text_overlay&&this.text_overlay.hide_overlay()}show_overlay_text(t,e,r=1){this.text_overlay&&this.text_overlay.show_overlay(t,e,r)}burn_overlay_text(t=null,e=null,r=null){if(!this.text_overlay)return;let o=this.text_overlay.get_presenter_rect();o.enabled&&(this.pending_text_burn=!0,this.pending_text_burn_center_x=t??o.left_px+o.width_px*.5,this.pending_text_burn_center_y=e??o.top_px+o.height_px*.5,this.pending_text_burn_intensity=r??o.intensity)}get_overlay_texture_view(){return this.text_overlay?this.text_overlay.get_presenter_texture_view():null}get_overlay_sampler(){return this.text_overlay?this.text_overlay.get_sampler():null}get_overlay_rect(){return this.text_overlay?this.text_overlay.get_presenter_rect():{enabled:0,left_px:0,top_px:0,width_px:0,height_px:0,intensity:0}}};var So=`
struct UiUniforms {
  screen_w : f32,
  screen_h : f32,
  rect_w   : f32,
  rect_h   : f32,
  margin_x : f32,
  margin_y : f32,
  palette_swatch_count : f32,
};

@group(0) @binding(0) var palette_tex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> ui : UiUniforms;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

// Two triangles (6 verts) with UVs spanning [0..1].
// We place the rect in pixel space then convert to NDC.
@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VSOut {
  var out : VSOut;

  // 6 vertices => (0,0)(1,0)(0,1) and (0,1)(1,0)(1,1)
  var p : vec2<f32>;
  switch (vid) {
    case 0u: { p = vec2<f32>(0.0, 0.0); }
    case 1u: { p = vec2<f32>(1.0, 0.0); }
    case 2u: { p = vec2<f32>(0.0, 1.0); }
    case 3u: { p = vec2<f32>(0.0, 1.0); }
    case 4u: { p = vec2<f32>(1.0, 0.0); }
    default:{ p = vec2<f32>(1.0, 1.0); } // vid == 5
  }

  // Lower-right anchored rect in pixels.
  // Pixel origin assumed top-left; NDC origin is center with +Y up.
  let x0 = ui.screen_w - ui.margin_x - ui.rect_w;
  let y0 = ui.screen_h - ui.margin_y - ui.rect_h;
  let px = x0 + p.x * ui.rect_w;
  let py = y0 + p.y * ui.rect_h;

  // Convert pixel coords to NDC.
  let ndc_x = (px / ui.screen_w) * 2.0 - 1.0;
  let ndc_y = 1.0 - (py / ui.screen_h) * 2.0;

  out.pos = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
  out.uv  = p;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Example: sample the palette texture with integer coords.
  let dims = textureDimensions(palette_tex); // vec2<i32>
  
  // if swatch_count is 8, we want samples at:
  // 0.0   0.14  0.28  0.42  0.56  0.71  0.85  1.0
  
	var t = in.uv.x;
	t = floor(t * (ui.palette_swatch_count)) * 
	    (1.0 / f32(ui.palette_swatch_count - 1));
  
  let xi = clamp(i32(t * f32(dims.x - 1)), i32(0), i32(dims.x - 1));
  let yi = 0;
  var col = textureLoad(palette_tex, vec2<i32>(xi, yi), 0);


	// TODO: pull this power from constants.
	// SEE ALSO: Same formula repeated in webgpu_present.js.
  col = col * col;
  // TODO: Pull this scale from constants.
  col *= 3;  // kHeadroom

  return vec4<f32>(col.rgb, 1.0);
}
`,T0=class{constructor(t,e,r){this.device=t,this.canvas_format=e;let o=32;this.ui_ubo=t.createBuffer({size:o,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,label:"palette_overlay_ui_ubo"}),this.bind_group_layout=t.createBindGroupLayout({label:"palette_overlay_bgl",entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),this.pipeline_layout=t.createPipelineLayout({label:"palette_overlay_pl",bindGroupLayouts:[this.bind_group_layout]});let i=t.createShaderModule({label:"palette_overlay_wgsl",code:So});this.pipeline=t.createRenderPipeline({label:"palette_overlay_pipeline",layout:this.pipeline_layout,vertex:{module:i,entryPoint:"vs_main"},fragment:{module:i,entryPoint:"fs_main",targets:[{format:e}]},primitive:{topology:"triangle-list",cullMode:"none"}}),this.palette_view=r.createView({label:"palette_overlay_palette_view"}),this.bind_group=t.createBindGroup({label:"palette_overlay_bg",layout:this.bind_group_layout,entries:[{binding:0,resource:this.palette_view},{binding:1,resource:{buffer:this.ui_ubo}}]})}update_ui_uniforms(t,e,r=8,o=256,i=64,a=8,c=8){let n=new Float32Array(8);n[0]=t,n[1]=e,n[2]=o,n[3]=i,n[4]=a,n[5]=c,n[6]=r,this.device.queue.writeBuffer(this.ui_ubo,0,n.buffer,0,n.byteLength)}draw(t){t.setPipeline(this.pipeline),t.setBindGroup(0,this.bind_group),t.draw(6,1,0,0)}};var To=`
struct Uniforms {
  //rgb_scale : vec4f,
  //rgb_power : vec4f,
  oversample : vec4f,		// .x = oversample, .y = 1.0/overesample
  	
	title_left_px   : f32,
	title_top_px    : f32,
	title_width_px  : f32,
	title_height_px : f32,
	
	present_w       : f32,
	present_h       : f32,
	title_intensity : f32,
	_pad_title3     : f32,  
};

@group(0) @binding(0) var indexTex : texture_2d<f32>;
@group(0) @binding(1) var<uniform> u : Uniforms;
@group(0) @binding(2) var paletteTex : texture_2d<f32>;
//@group(0) @binding(3) var paletteSamp : sampler;
@group(0) @binding(3) var title_tex  : texture_2d<f32>;
@group(0) @binding(4) var title_samp : sampler;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4f {
  // Fullscreen triangle
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(-1.0,  3.0),
    vec2f( 3.0, -1.0)
  );
  let p = pos[vid];
  return vec4f(p, 0.0, 1.0);
}

// Returns [0..1]
fn overlay_title(frag_px: vec2f) -> f32 {
  if (u.title_intensity <= 0.0) {
    return 0.0;
  }

  let left   = u.title_left_px * u.oversample.y;
  let top    = u.title_top_px * u.oversample.y;
  let right  = left + u.title_width_px * u.oversample.y;
  let bottom = top  + u.title_height_px * u.oversample.y;

  if (frag_px.x < left || frag_px.x >= right || frag_px.y < top || frag_px.y >= bottom) {
    return 0.0;
  }

  let uv = vec2f(
    (frag_px.x - left) * (1.0 / max(u.title_width_px  * u.oversample.y,  1.0)),
    (frag_px.y - top ) * (1.0 / max(u.title_height_px * u.oversample.y, 1.0))
  );

  let a = textureSampleLevel(title_tex, title_samp, uv, 0.0).a * u.title_intensity;

  // White overlay; swap in tinting later if desired.
  //let title_rgb = vec3f(1.0, 1.0, 1.0);
  //return vec4f(base_color.rgb * (1.0 - a) + title_rgb * a, base_color.a);
  return a;
}

fn decode_u16_from_rg(c: vec4f) -> u32 {
  // Round to nearest byte.
  let hi: u32 = u32(clamp(floor(c.r * 255.0 + 0.5), 0.0, 255.0));
  let lo: u32 = u32(clamp(floor(c.g * 255.0 + 0.5), 0.0, 255.0));
  return (hi << 8) | lo;
}

@fragment
fn fs_main(@builtin(position) p: vec4f) -> @location(0) vec4f {
  // p.xy is in pixel coordinates of the render target
  let x: i32 = i32(p.x);
  let y: i32 = i32(p.y);

	//xxx - TODO: match scale in main.js here
	let sx: i32 = i32(f32(x) * u.oversample.x);
	let sy: i32 = i32(f32(y) * u.oversample.x);	// [sic] - scale is just one value.

	// Load packed RG from rgba8unorm. Each channel is 0..1.
	// 16-bit index = R * 256 + G
	// Red channel has the 8 MSBs.
	// Green channel has the 8 LSBs.
//xxx; // TODO: TAKE EXTRA SAMPLES WHEN OVERSAMPLE > 1.



	//var rg = textureLoad(indexTex, vec2i(sx, sy), 0).rg;		// [0..1]
	//let v = floor(rg.r * 255);
	//let t = rg.g;


	// Oversampling-friendly version:
	var sum = u32(0);
	let ss = i32(max(1.0, round(u.oversample.x)));
	for (var y = 0; y < ss; y++) {
		for (var x = 0; x < ss; x++) {	
			sum += decode_u16_from_rg(textureLoad(indexTex, vec2i(sx + x, sy + y), 0));		// [0..65535]
		}
	}			

	var avg = u32(f32(sum) * (1.0 / f32(ss * ss)));		// [0..65535]

	// Add in title overlay.
	avg = min(65535, avg + u32(overlay_title(p.xy) * 65535));

  
  let hi: u32 = (avg >> 8) & 255u;
  let lo: u32 =  avg       & 255u;

	let v = hi;		// [0..255]
	let t = f32(lo) * (1.0 / 256);  // [0..1] 
	
	
	let max_palette_x_coord = i32(textureDimensions(paletteTex).x) - 1;
	
	// Perform manual linear interpolation between 2 entries in the palette.
	let uv1 = vec2i(i32(v) + 0, 0);
	let uv2 = vec2i(min(max_palette_x_coord, i32(v) + 1), 0);
	let col1 = textureLoad(paletteTex, uv1, 0);	// [0..1]
	let col2 = textureLoad(paletteTex, uv2, 0);

  var col = col1 * (1.0 - t) + t * col2;
	
	// Square it, to make up for palette packed with kPower == 0.5:
	// TODO: pull this power from constants.
	// SEE ALSO: Same formula repeated in draw_palette.js.
  col = col * col;
  // TODO: Pull this scale from constants.
  col *= 3;  // kHeadroom

	// To bypass the palette:
	//col = col * 0.00001 + 0.9999 * f32(textureLoad(indexTex, vec2i(sx, sy), 0).r);
	
	return col;  // rg.rrrr;//FIXME_WAVEFORM
}
`,P0=class{constructor(t,e,r,o,i,a){this.canvas=t,this.cw=e,this.ch=r,this.iw=o,this.ih=i,this.oversample=a,this.device=null,this.context=null,this.format=null,this.indexTex=null,this.paletteTex=null,this.pipeline=null,this.bindGroup=null,this.gpu_warp=null,this.palette_overlay=null}BuildBindGroup(t){this.indexTex?.destroy?.(),this.indexTex=this.device.createTexture({size:{width:this.iw,height:this.ih},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:t},{binding:1,resource:{buffer:this.uniform_buf}},{binding:2,resource:this.paletteTex.createView()},{binding:3,resource:this.gpu_warp.get_overlay_texture_view()},{binding:4,resource:this.gpu_warp.get_overlay_sampler()}]})}resize(t,e,r,o,i){this.cw=t,this.ch=e,this.iw=r,this.ih=o,this.oversample=i,this.device!=null&&(this.configure_canvas(this.use_hdr),this.gpu_warp.resize(r,o),this.BuildBindGroup(this.gpu_warp.get_current_index_view()))}updateGlobals(){let t=new Float32Array([this.oversample,1/this.oversample,0,0,0,0,0,0,this.cw,this.ch,0,0]);if(this.gpu_warp){let e=this.gpu_warp.get_overlay_rect();e.intensity>0&&(t=new Float32Array([this.oversample,1/this.oversample,0,0,e.left_px,e.top_px,e.width_px,e.height_px,this.cw,this.ch,e.intensity,0]))}this.device.queue.writeBuffer(this.uniform_buf,0,t)}configure_canvas(t){let e=navigator.gpu.getPreferredCanvasFormat();if(t)try{return this.format="rgba16float",this.context.configure({device:this.device,format:this.format,alphaMode:"opaque",toneMapping:{mode:"extended"}}),!0}catch{console.log(`ERROR: rgba16float texture format not supported -> falling back to ${e}.`)}return this.use_hdr=!1,this.format=e,this.context.configure({device:this.device,format:this.format,alphaMode:"opaque"}),!1}async init(t){if(!this.cw||!this.ch)throw new Error(`Presenter index size invalid: cw=${this.cw} ch=${this.ch}`);if(!navigator.gpu)throw new Error("WebGPU not supported in this browser.");let e=await navigator.gpu.requestAdapter();if(!e)throw new Error("No WebGPU adapter found.");this.device=await e.requestDevice(),this.context=this.canvas.getContext("webgpu"),this.use_hdr=this.configure_canvas(t),this.uniform_buf=this.device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.updateGlobals(),this.paletteTex=this.device.createTexture({size:{width:256,height:1},format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.paletteSampler=this.device.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest"});let r=this.device.createShaderModule({code:To});this.pipeline=this.device.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vs_main"},fragment:{module:r,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}}),this.gpu_warp=new S0(this.device,this.iw,this.ih,ts),this.gpu_warp.init(),this.gpu_warp.fill_index_u8_with_noise(),this.palette_overlay=new T0(this.device,this.format,this.paletteTex),this.BuildBindGroup(this.gpu_warp.get_current_index_view())}SetWarpMap(t,e){this.gpu_warp.upload_warp_map(t,e)}uploadPaletteRGBA8UNorm(t){let n=new Uint8Array(1024);for(let x=0;x<1024;x++){let w=Math.max(0,Math.min(1,t[x]*.3333333333333333));w=Math.pow(w,.5),w*=255,n[x]=w+.5|0}this.device.queue.writeTexture({texture:this.paletteTex},n,{bytesPerRow:256*4,rowsPerImage:1},{width:256,height:1})}warpAndDrawWaveform(t,e,r,o,i,a,c,n){this.updateGlobals(),this.gpu_warp.set_params({w0:t,w1:e,w2:r,w3:o,warp_scale:1,shift_x:i,shift_y:a,darkening:n}),this.gpu_warp.step(c),this.BuildBindGroup(this.gpu_warp.get_current_index_view())}draw(t=0){let e=this.device.createCommandEncoder(),r=this.context.getCurrentTexture().createView(),o=e.beginRenderPass({colorAttachments:[{view:r,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});o.setPipeline(this.pipeline),o.setBindGroup(0,this.bindGroup),o.draw(3),t>0&&(this.palette_overlay.update_ui_uniforms(this.cw,this.ch,t,t*32,32,8,8),this.palette_overlay.draw(o)),o.end(),this.device.queue.submit([e.finish()])}};var ht=["8 0.0000 0.0000 0.0000  0.2582 0.1137 0.0337  0.6026 0.3644 0.0829  0.9894 0.7203 0.1402  1.4066 1.1680 0.2036  1.8478 1.6993 0.2720  2.3093 2.3084 0.3445  2.7884 2.9909 0.4208  ","8  0.0000 0.0000 0.0000  0.0164 0.5203 0.1617  0.0650 0.9636 0.4050  0.1454 1.3820 0.6924  0.2576 1.7849 1.0133  0.4013 2.1765 1.3615  0.5764 2.5597 1.7331  3.0694 3.0824 2.9898  ","8  0.0000 0.0000 0.0000  0.5301 0.1051 0.1661  1.0414 0.2667 0.3087  1.5457 0.4600 0.4437  2.0457 0.6771 0.5738  2.5423 0.9139 0.7006  3.0364 1.1677 0.8246  3.1   2.0213 1.3318  ","8 0.0000 0.0000 0.0000  0.6091 0.1911 0.0161  1.0966 0.4993 0.0314  1.5469 0.8755 0.0465  1.9746 1.3042 0.0613  2.3861 1.7766 0.0761  2.7853 2.2870 0.0908  3.1745 2.8314 0.1054  ","8  0.0000 0.0000 0.0000  0.6663 0.2415 0.0045  1.2149 0.5468 0.0176  1.7265 0.8819 0.0390  2.2154 1.2380 0.0688  2.6881 1.6106 0.1067  3.1 2.3116 0.1767    3.1 3.1 1.4571  ","8 0.0000 0.0000 0.0000  0.0379 0.2533 0.2995  0.0797 0.6261 0.5292  0.1232 1.0631 0.7383  0.1677 1.5477 0.9351  0.2131 2.0711 1.1232  0.2591 2.6278 1.3046  0.3057 3.2137 1.4806  ","8 0.0000 0.0000 0.0000  0.1120 0.6407 0.0904  0.3608 1.0865 0.1521  0.7153 1.4799 0.2061  1.1623 1.8425 0.2558  1.6937 2.1840 0.3025  2.3039 2.5095 0.3468  2.9884 2.8223 0.3894  ","8 0.0000 0.0000 0.0000  0.1838 0.6272 0.0181  0.5015 0.9995 0.0698  0.9023 1.3128 0.1537  1.3688 1.5930 0.2691  1.8911 1.8509 0.4156  2.4627 2.0923 0.5928  3.0788 2.3208 0.8004  ","8 0.0000 0.0000 0.0000  0.0414 0.1624 0.3642  0.1633 0.4223 0.6530  0.3643 0.7386 0.9190  0.6438 1.0981 1.1710  1.0011 1.4937 1.4133  1.4361 1.9205 1.6479  1.9482 2.3753 1.8765  ","8  0.0000 0.0000 0.0000  0.8819 0.1773 0.0714  1.3810 0.4233 0.1863  1.7952 0.7041 0.3265  2.1625 1.0103 0.4861  2.4983 1.3370 0.6620  3.0993 1.8530 0.9392  3.1623 2.7334 1.4131  ","8 0.0000 0.0000 0.0000  0.0559 0.0808 0.7028  0.1034 0.3165 1.0330  0.1482 0.7035 1.2940  0.1913 1.2399 1.5183  0.2332 1.9244 1.7188  0.2742 2.7559 1.9020  0.3144 3.7337 2.0722  ","8  0.0000 0.0000 0.0000  0.2789 0.0100 0.6391  0.6748 0.0225 1.0774  1.1317 0.0362 1.4624  1.6331 0.0507 1.8163  2.1706 0.0659 2.1488  2.7387 0.0816 2.4652  3.0236 1.5030 3.0527  ","8  0.0000 0.0000 0.0000  0.7673 0.1396 0.1033  1.3149 0.3504 0.2207  1.8019 0.6002 0.3441  2.2533 0.8794 0.4716  2.6800 1.1826 0.6022  3.00 1.5064 0.7353  3.1 2.6010 1.2250  ","8 0.0000 0.0000 0.0000  0.0276 0.1923 0.7431  0.1088 0.4895 1.1035  0.2427 0.8454 1.3907  0.4287 1.2459 1.6387  0.6665 1.6830 1.8611  0.9558 2.1517 2.0651  1.2965 2.6486 2.2550  ","8 0.0000 0.0000 0.0000  0.0321 0.1723 0.0269  0.0549 0.4940 0.0782  0.0753 0.9148 0.1462  0.0941 1.4163 0.2278  0.1119 1.9881 0.3213  0.1289 2.6227 0.4256  0.1453 3.3150 0.5397  ","8 0.0000 0.0000 0.0000  0.4738 0.2947 0.7178  0.7552 0.6291 1.0816  0.9920 0.9803 1.3748  1.2038 1.3428 1.6298  1.3987 1.7140 1.8598  1.5812 2.0923 2.0716  1.7540 2.4766 2.2694  ","8 0.0000 0.0000 0.0000  0.8000 0.2511 0.0602  1.3184 0.5184 0.0926  1.7660 0.7921 0.1191  2.1729 1.0702 0.1424  2.5521 1.3514 0.1635  3.5377 1.9878 0.2226  3.25055 2.8388 0.2979  ","8 0.0000 0.0000 0.0000  0.6040 0.1504 0.0264  0.9847 0.4313 0.0636  1.3106 0.7988 0.1063  1.6054 1.2371 0.1530  1.8790 1.7367 0.2030  2.1368 2.2913 0.2558  2.3822 2.8964 0.3109  ","8 0.0000 0.0000 0.0000  0.1759 0.2470 0.7328  0.3025 0.6463 1.0514  0.4154 1.1343 1.2985  0.5203 1.6907 1.5084  0.6195 2.3043 1.6943  0.7145 2.9675 1.8630  0.8061 3.6752 2.0187  ","8  0.0000 0.0000 0.0000  0.1096 0.7007 0.0597  0.2857 1.1237 0.1736  0.5002 1.4812 0.3239  0.7445 1.8017 0.5043  1.0133 2.0976 0.7108  1.3036 2.3749 0.9410  2.1616 3.0350 1.5980  ","8 0.0000 0.0000 0.0000  0.6525 0.2959 0.0101  1.1974 0.6567 0.0257  1.7079 1.0469 0.0443  2.1972 1.4575 0.0653  2.6715 1.8839 0.0883  3.1340 2.3234 0.1129  3.5870 2.7741 0.1389  ","8  0.0000 0.0000 0.0000  0.0354 0.1104 0.1000  0.0872 0.3972 0.1505  0.1478 0.8402 0.1911  0.2148 1.4294 0.2263  0.2870 2.1586 0.2581  0.3636 3.0230 0.2874  0.4442 4.0190 0.3147  ","8 0.0000 0.0000 0.0000  0.0659 0.2217 0.2325  0.1076 0.6001 0.5400  0.1434 1.0745 0.8839  0.1757 1.6244 1.2539  0.2057 2.2383 1.6446  0.2340 2.9086 2.0525  0.2610 3.6297 2.4755  ","8  0.0000 0.0000 0.0000  0.0543 0.4210 0.1647  0.2115 0.8306 0.3097  0.4800 1.2672 0.4596  0.8634 1.7195 0.6112  1.3306 2.1297 0.7453  1.8947 2.5364 0.8764  2.5545 2.9403 1.0052  ","8  0.0000 0.0000 0.0000  0.1107 0.1418 0.4081  0.2642 0.4814 0.8609  0.4394 0.9857 1.3329  0.6304 1.6386 1.8173  0.8341 2.4305 2.3114  1.0481 3.0 2.8133  3.1 3.0686 3.1  ","8 0.0000 0.0000 0.0000  0.0402 0.2917 0.9045  0.1220 0.6827 1.2835  0.2337 1.1228 1.5751  0.3706 1.5981 1.8213  0.5299 2.1014 2.0384  0.7097 2.6283 2.2350  0.9086 3.1755 2.4158  ","8  0.0000 0.0000 0.0000  0.9970 0.1216 0.1741  1.4625 0.3295 0.3277  1.8300 0.5906 0.4742  2.1453 0.8933 0.6165  2.4271 1.2314 0.7556  2.6845 1.6008 0.8923  3.1 2.5504 1.3109  ","8  0.0000 0.0000 0.0000  0.0385 0.0350 0.7263  0.0831 0.1853 1.4247  0.1405 0.5289 2.2986  0.1688 0.9199 2.6665  0.1946 1.4131 2.9919  0.2186 2.0068 3.2871  0.2412 2.6995 3.5593  ","8  0.0000 0.0000 0.0000  0.0322 0.3660 0.4385  0.1210 0.7371 0.7760  0.2625 1.1103 1.0837  0.4550 1.4847 1.3734  0.6970 1.8601 1.6504  0.9876 2.2362 1.9178  1.9593 3.1604 3.0169  ","8  0.0000 0.0000 0.0000  1.0214 0.1789 0.1486  1.5088 0.4590 0.2578  1.9431 0.8165 0.3650  2.3382 1.2355 0.4696  2.6381 1.6651 0.5580  2.9115 2.1250 0.6425  3.1646 2.6115 0.7239  ","8  0.0000 0.0000 0.0000  0.0779 0.1961 0.0118  0.1653 0.6184 0.0268  0.2136 1.0045 0.0364  0.2457 1.3591 0.0433  0.3252 2.0403 0.0589  0.4089 2.8436 0.0756  0.4962 3.7650 0.0934  ","8  0.0000 0.0000 0.0000  0.3264 0.0136 0.1706  0.6115 0.0473 0.4419  0.9772 0.1092 0.8557  1.4616 0.2118 1.4660  2.0091 0.3566 2.2394  2.4498 0.5132 2.9771  3.0892 2.1768 3.0000  ","8  0.0000 0.0000 0.0000  0.1939 0.4527 0.9288  0.2959 0.8513 1.5874  0.3783 1.2317 2.1715  0.4507 1.6008 2.7119  0.5162 1.9617 3.2225  0.5765 2.3161 3.7100  0.6330 2.6655 4.1794  ","8  0.0000 0.0000 0.0000  0.1102 0.5136 0.9506  0.3863 0.9095 1.3548  0.8046 1.2710 1.6669  1.3535 1.6113 1.9307  2.0264 1.9367 2.1641  2.8178 2.2510 2.3753  3.1234 2.5562 2.5701  ","8  0.0000 0.0000 0.0000  0.3035 0.0834 0.1958  0.8097 0.2691 0.5889  1.4374 0.5341 1.1212  2.1599 0.8686 1.7704  2.9621 1.2665 2.5232  3.8342 1.7236 3.3706  3.1 2.2367 4.3054  ","8  0.0000 0.0000 0.0000  0.3220 0.1692 0.0006  0.8344 0.5450 0.0018  1.4566 1.0797 0.0041  2.1629 1.7547 0.0069  2.9390 2.5567 0.0105  3.7754 3.4776 0.0149  3.1 3.1 0.0202  ","8  0.0000 0.0000 0.0000  0.7135 0.3858 0.0195  1.2698 0.7696 0.0660  1.7792 1.1532 0.1348  2.2600 1.5358 0.2236  2.7210 1.9185 0.3309  3.1 2.3010 0.4560     3.1 3.05 0.8835  ","8  0.0000 0.0000 0.0000  0.3142 0.0978 0.7089  0.6364 0.3615 1.2326  0.9619 0.7768 1.7037  1.2896 1.3368 2.1431  1.6186 2.0367 2.5609  1.9491 2.8730 2.9618  2.2804 3.8429 3.3495  ","8  0.0000 0.0000 0.0000  0.3337 0.0769 0.4762  0.5998 0.2929 0.9797  0.8453 0.6405 1.4940  1.0783 1.1159 2.0154  1.3023 1.7167 2.5424  1.5194 2.4408 3.0735  1.7311 3.2866 3.6084  ","8  0.0000 0.0000 0.0000  0.8649 0.0469 0.2006  1.3506 0.1784 0.4708  1.7527 0.3903 0.7752  2.1091 0.6800 1.1049  2.4345 1.0459 1.4539  2.7373 1.4871 1.8196  3.0223 2.0021 2.1996  ","8  0.0000 0.0000 0.0000  0.0808 0.2661 0.1832  0.0736 0.4852 0.2808  0.1034 1.0200 0.5327  0.1470 1.9319 0.9384  0.1491 2.4453 1.1229  1.5230 4.0609 1.7808  2.3959 3.0000 2.2301  ","8 0.0000 0.0000 0.0000  0.4653 0.0494 0.4186  1.0228 0.1857 0.9114  1.6214 0.4031 1.4368  2.2483 0.6984 1.9844  2.8972 1.0697 2.5492  3.5642 1.5154 3.1282  3.1 2.0344 3.0  ","8 0.0000 0.0000 0.0000  0.0427 0.1962 0.0633  0.1686 0.5854 0.1533  0.3767 1.1095 0.2571  0.6664 1.7464 0.3711  1.0373 2.4830 0.4933  1.4891 3.3100 0.6225  2.0214 3.1 0.7578  ","8  0.0000 0.0000 0.0000  0.4238 0.0571 0.6915  0.8292 0.1068 1.0396  1.2243 0.1542 1.3161  1.7804 0.2199 1.7152  2.4139 0.2942 2.1366  3.1 0.3916 2.6837  3.1 1.27 3.05  ","8  0.0000 0.0000 0.0000  0.8031 0.0181 0.0581  1.3389 0.0730 0.0997  1.8272 0.4669 0.3888  2.3437 0.8983 0.5258  2.6358 1.3835 0.6157  2.9013 1.9691 0.7006  3.1467 2.6534 0.7816  ","8  0.0000 0.0000 0.0000  0.9774 0.0909 0.0163  1.5955 0.3223 0.0599  2.1254 0.6756 0.1279  2.6050 1.1419 0.2191  3.0502 1.7155 0.3329  3.4700 2.3926 0.4683  3.8694 3.1696 0.6250  ","8  0.0000 0.0000 0.0000  0.9578 0.1052 0.0728  1.5731 0.3353 0.2591  2.1030 0.6603 0.5448  2.5841 1.0678 0.9229  3.0316 1.5504 1.3893  3.4544 2.1023 1.9405  3.8573 2.7200 2.5742  ","8  0.0000 0.0000 0.0000  0.0537 0.4188 0.3160  0.2156 0.7915 0.6058  0.5115 1.2069 0.9314  0.9550 1.6466 1.2784  1.4806 2.0017 1.5614  2.1182 2.3477 1.8381  2.8676 2.6865 2.1100  ","8  0.0000 0.0000 0.0000  0.1491 0.1983 0.0095  0.5555 0.5372 0.0275  1.1991 0.9622 0.0512  2.0699 1.4550 0.0796  3.1611 2.0051 0.1120  4.4677 2.6061 0.1483  3.1 3.0 0.1879  ","8  0.0000 0.0000 0.0000  0.2326 0.1470 0.6764  0.6402 0.3857 1.1437  1.1576 0.6783 1.5550  1.7621 1.0123 1.9337  2.4411 1.3811 2.2898  3.1858 1.7802 2.6291  3.1 2.2063 2.9549  ","8  0.0000 0.0000 0.0000  1.1343 0.1742 0.0143  1.7126 0.4564 0.0486  2.1794 0.8016 0.0991  2.5860 1.1958 0.1649  2.9528 1.6305 0.2444  3.2908 2.1007 0.3371  3.1 2.6028 0.4422  ","8  0.0000 0.0000 0.0000  0.9454 0.1678 0.0091  1.6606 0.5599 0.0590  1.9224 1.0625 0.1639  2.5199 1.5089 0.3053  2.8820 1.8363 0.4584  3.2161 2.1559 0.6389  3.1 2.4691 0.8461  ","8  0.0000 0.0000 0.0000  1.1655 0.4486 0.0817  1.6826 0.8316 0.2311  2.0859 1.1930 0.4247  2.4293 1.5414 0.6538  2.7341 1.8800 0.9137  3.0114 2.2111 1.2014  3.2676 2.5364 1.5140  ","8  0.0000 0.0000 0.0000  0.8229 0.2505 0.0903  1.4152 0.5886 0.2295  1.9434 0.9704 0.3956  2.4335 1.3835 0.5824  2.8978 1.8217 0.7860  3.3417 2.2807 1.0043  3.7700 2.7582 1.2353  ","8  0.0000 0.0000 0.0000  0.9390 0.2084 0.0214  1.5610 0.5221 0.0806  2.1014 0.8937 0.1749  2.5949 1.3085 0.3029  3.0561 1.7588 0.4640  3.4933 2.2395 0.6574  3.9112 2.7471 0.8824  ","8  0.0000 0.0000 0.0000  1.0474 0.3000 0.0157  1.5282 0.6642 0.0374  1.9059 1.0569 0.0622  2.2294 1.4696 0.0893  2.5178 1.8980 0.1181  2.7808 2.3389 0.1484  3.0244 2.7909 0.1801  ","8  0.0000 0.0000 0.0000  0.8664 0.2263 0.0078  1.3024 0.5764 0.0157  1.6531 0.9959 0.0238  1.9578 1.4682 0.0319  2.2322 1.9839 0.0401  2.4849 2.5370 0.0483  2.7206 3.1233 0.0565  ","8  0.0000 0.0000 0.0000  0.1222 0.2480 0.0876  0.2212 0.6329 0.1764  0.3128 1.0949 0.2658  0.4002 1.6151 0.3554  0.4844 2.1837 0.4454  0.5662 2.7939 0.5356  0.6460 3.4411 0.6259  ","8  0.0000 0.0000 0.0000  0.7655 0.3322 0.0059  1.3475 0.7114 0.0183  1.8759 1.1102 0.0355  2.3720 1.5225 0.0566  2.8455 1.9451 0.0815  3.3020 2.3765 0.1096  3.7445 2.8146 0.1408  ","8  0.0000 0.0000 0.0000  0.6731 0.2048 0.1043  1.2264 0.5164 0.2285  1.7421 0.8873 0.3618  2.2347 1.3025 0.5012  2.7108 1.7545 0.6454  3.1743 2.2379 0.7934  3.6274 2.7490 0.9447  ","8  0.0000 0.0000 0.0000  0.6378 0.1325 0.1555  1.1398 0.3319 0.3726  1.6008 0.5681 0.6213  2.0369 0.8317 0.8928  2.4555 1.1179 1.1829  2.8606 1.4235 1.4885  3.1 2.0215 2.0928  ","8  0.0000 0.0000 0.0000  0.8097 0.3155 0.0536  1.2999 0.6491 0.1647  1.7149 0.9903 0.3172  2.0872 1.3360 0.5050  2.4308 1.6855 0.7245  2.7531 2.0378 0.9728  3.0588 2.3927 1.2483  ","8  0.0000 0.0000 0.0000  0.8861 0.3230 0.0221  1.4980 0.6494 0.0498  2.0365 0.9773 0.0799  2.5323 1.3058 0.1117  2.9986 1.6350 0.1452  3.4426 1.9649 0.1798  3.8690 2.2950 0.2152  ","8 0.0000 0.0000 0.0000  0.2773 0.1031 0.5381  0.5547 0.2061 1.0763  1.0295 0.2447 1.4093  1.6030 0.2511 1.6399  2.2860 0.2906 1.9480  3.1879 0.3963 2.4112  3.1 0.5020 2.8745  ","8 0.0000 0.0000 0.0000  0.1261 0.1936 0.3136  0.2522 0.3873 0.6272  0.7817 0.5781 0.6267  1.5129 0.7675 0.4693  2.1553 1.0720 0.3634  2.6202 1.6066 0.3606  3.0852 2.1411 0.3577  ","8  0.0000 0.0000 0.0000  0.1210 0.1831 0.3147  0.1720 0.2603 0.4471  0.5037 0.4085 0.4425  1.2406 0.7485 0.4638  1.7987 1.0862 0.4118  2.3515 1.7457 0.4640  3.1 3.05 0.6351  ","8 0.0000 0.0000 0.0000  0.1293 0.1865 0.3816  0.2586 0.3729 0.7632  0.8408 0.5391 0.7401  1.6493 0.6950 0.5147  2.3350 0.9324 0.3652  2.7749 1.3326 0.3675  3.2149 1.7328 0.3697  ","8 0.0000 0.0000 0.0000  0.1286 0.1936 0.3736  0.2572 0.3872 0.7472  0.8186 0.5584 0.7386  1.5965 0.7185 0.5389  2.2464 0.9610 0.4183  2.6400 1.3685 0.4558  3.0337 1.7759 0.4934  ","8  0.0000 0.0000 0.0000  0.0849 0.1761 0.2832  0.1516 0.2792 0.4759  0.6899 0.3799 0.6008  1.4064 0.2291 0.3306  2.3361 0.1455 0.1636  3.3362 0.2079 0.2338  2.9610 0.8799 0.3911  ","8  0.0000 0.0000 0.0000  0.4182 0.0205 0.0194  0.8364 0.0409 0.0388  1.2342 0.4864 0.5660  1.6218 1.1444 1.3473  2.0390 1.7167 2.0257  2.5152 2.1177 2.4988  2.9915 2.5185 2.9718  ","8 0.0000 0.0000 0.0000  0.0370 0.1159 0.4412  0.0739 0.2317 0.8823  0.7016 0.5329 1.1452  1.6245 0.9267 1.3190  2.4289 1.2896 1.5560  2.9962 1.5908 1.9194  3.5634 1.8920 2.2828  ","8 0.0000 0.0000 0.0000  0.2870 0.0124 0.3657  0.5740 0.0248 0.7315  0.9876 0.5023 1.0681  1.4646 1.2124 1.3902  1.9331 1.8281 1.7404  2.3846 2.2551 2.1468  2.8360 2.6820 2.5533  ","8  0.0000 0.0000 0.0000  0.2309 0.1902 0.0947  0.4617 0.3804 0.1893  0.4227 0.8493 0.9092  0.2490 1.4574 1.9420  0.1442 2.0200 2.8526  0.1780 2.4917 3.5187  0.2117 2.9635 4.1850  ","8  0.0000 0.0000 0.0000  0.0676 0.3062 0.3159  0.1354 0.6121 0.6322  0.7703 1.0535 0.7397  1.6887 1.5623 0.7430  2.4951 2.0621 0.8083  3.0780 2.5435 0.9970  3.6607 3.0251 1.1859  ","8  0.0000 0.0000 0.0000  0.0914 0.1085 0.3240  0.1828 0.1621 0.4849  0.8179 0.5135 0.4624  1.7248 1.2427 0.5444  2.5260 2.1375 0.6964  3.1160 2.6534 0.8643  3.7059 3.1558 1.0279  ","8  0.0000 0.0000 0.0000  0.2355 0.0146 0.4188  0.4438 0.0276 0.7894  1.0442 0.6259 0.7183  1.7193 1.3557 0.5216  2.4351 2.0473 0.4801  3.0037 2.5254 0.5923  3.5724 3.0036 0.7044  ","8  0.0000 0.0000 0.0000  0.0605 0.1311 0.3756  0.1370 0.2966 0.7512  0.6888 0.6130 1.2118  1.7867 1.0803 1.7149  2.5971 1.3897 2.2235  3.2036 1.7142 2.7427  3.8101 2.0387 3.2620  ","8  0.0000 0.0000 0.0000  0.1497 0.1570 0.2661  0.2995 0.3140 0.5323  0.7269 0.9252 0.5416  1.2929 1.7635 0.4223  1.8114 2.5183 0.3717  2.2346 3.1063 0.4586  2.6574 3.6945 0.5453  ","8  0.0000 0.0000 0.0000  0.0359 0.2246 0.2739  0.0717 0.4490 0.5480  0.3859 1.0233 0.8719  0.8391 1.7724 1.2207  1.2377 2.4636 1.5757  1.5267 3.0389 1.9438  1.8157 3.6143 2.3117  ","8 0.0000 0.0000 0.0000  0.2312 0.1077 0.3087  0.4623 0.2154 0.6174  1.1867 0.5966 0.6182  2.1576 1.1147 0.4649  3.0416 1.5833 0.3934  3.7520 1.9531 0.4852  3.1 2.3228 0.5771  ","8  0.0000 0.0000 0.0000  0.1740 0.0677 0.3501  0.3479 0.1353 0.7001  1.0203 0.6069 0.6846  1.9417 1.2804 0.4864  2.7717 1.8754 0.3840  3.4190 2.3134 0.4738  3.0 2.7514 0.5634  ","8  0.0000 0.0000 0.0000  0.1944 0.1268 0.2482  0.4282 0.2790 0.5268  1.0938 0.4162 0.5388  2.1801 0.5244 0.3308  2.9847 0.5841 0.1604  3.6817 0.7205 0.1979  3.1 0.8569 0.2353  ","8 0.0000 0.0000 0.0000  0.0477 0.1095 0.3609  0.0954 0.2191 0.7218  0.8328 0.3779 0.9896  1.9150 0.5613 1.2109  2.8591 0.7413 1.4730  3.5268 0.9144 1.8170  3.1 1.0875 2.1610  ","8  0.0000 0.0000 0.0000  0.0349 0.2689 0.3590  0.0696 0.5379 0.7181  0.5926 0.9466 0.6957  1.3597 1.4747 0.4826  2.0289 2.0352 0.3693  2.5028 2.5145 0.4555  2.9766 2.9906 0.5418  ","8  0.0000 0.0000 0.0000  0.6885 0.0000 0.0000  1.2738 0.1375 0.0000  1.5489 0.6885 0.0000  1.8243 1.3080 0.0000  2.0997 1.9964 0.0000  2.2718 2.2718 1.0327  2.4095 2.4095 2.4095  ","6  0 0 0   0 0 0.7   0 0.4 1.2  0.7 0.5 2   1.5 1 2   2 2 2","5  0 0 0   0 0.5 0   1.1 1.2 0.3   1.7 1.7 0.7   2.5 2.5 1  ","8  0.0000 0.0000 0.0000  0.0000 0.0000 0.3225  0.6959 0.0000 0.5237  1.2814 0.0000 0.1973  1.7958 0.4462 0.0000  1.8670 1.6169 0.0000  2.4431 2.4431 0.0000  3.1670 3.1670 0.0000  ","8  0.0000 0.0000 0.0000  0.2207 0.0000 0.2207  0.4414 0.0000 0.4414  0.9564 0.2943 0.3679  1.6186 0.7357 0.1471  2.2071 1.3243 0.0000  2.6486 2.2071 0.0000  3.0900 3.0900 0.0000  ","8  0.0000 0.0000 0.0000  0.2694 0.0848 0.6069  0.5621 0.3197 1.0885  0.9077 0.7339 1.6077  1.2896 1.3376 2.1430  1.6186 2.0372 2.5608  1.9491 2.8739 2.9617  2.2804 3.8429 3.3495  ","8  0.0000 0.0000 0.0000  0.2968 0.0780 0.4610  0.7534 0.2924 0.5838  1.5292 0.6234 0.7290  2.6549 1.0093 0.7951  2.3177 1.7345 1.1079  3.6272 2.9633 0.9159  5.3699 2.8789 0.6333  ","8  0.0000 0.0000 0.0000  0.2219 0.0912 0.3608  0.5748 0.3038 0.6813  0.6763 0.6599 0.8301  0.7805 1.0043 1.2224  1.1402 1.9642 1.2653  0.8592 2.5137 1.0900  1.9639 3.0976 2.0050  ","8  0.0000 0.0000 0.0000  0.2700 0.0611 0.5724  0.5312 0.2361 0.9494  1.0967 0.4367 0.8586  1.5230 0.4326 0.6811  2.3134 0.6200 0.7626  3.8775 0.4966 0.8970  3.8601 0.8067 0.8694  ","8  0.0000 0.0000 0.0000  0.1247 0.1380 0.2720  0.3044 0.4910 0.6046  0.6603 0.7644 0.6712  1.3077 1.5183 1.1596  1.6371 2.3929 1.2216  2.4469 3.0393 1.4274  2.2277 3.4255 2.1532  ","8  0.0000 0.0000 0.0000  0.5010 0.0979 0.0950  0.9132 0.3345 0.3380  1.5573 0.5331 0.7057  2.0914 0.9769 1.1501  2.5144 1.4350 1.6934  3.0495 1.8440 2.2728  3.8242 2.4028 2.2635  ","8  0.0000 0.0000 0.0000  0.0669 0.1727 0.4868  0.1226 0.4850 0.6031  0.1996 1.1027 0.5419  0.3495 1.7297 0.6625  0.5732 2.1547 0.9116  0.9270 3.3352 0.9721  1.9616 4.6781 2.1857  ","8  0.0000 0.0000 0.0000  0.0397 0.1218 0.0869  0.1798 0.2437 0.4117  0.5582 0.3267 1.0055  1.4910 0.3782 1.3912  1.8101 0.5710 1.3557  3.1300 0.8754 1.6990  4.0550 1.1857 2.7924  ","8  0.0000 0.0000 0.0000  0.7765 0.0927 0.0017  1.4493 0.2729 0.0066  2.0678 0.3618 0.0244  2.5056 0.5051 0.0578  3.7991 0.8294 0.1316  5.2193 1.2755 0.1590  3.8934 1.5650 0.2259  ","8  0.0000 0.0000 0.0000  0.5850 0.1366 0.0455  1.1137 0.4005 0.1543  1.6590 0.6436 0.3393  1.9323 1.1324 0.3627  2.1444 1.6402 0.5139  2.3833 1.8039 1.2912  2.7097 2.1060 1.5737  ","8  0.0000 0.0000 0.0000  0.0939 0.2051 0.7452  0.1934 0.4074 1.2052  0.3138 0.8115 1.9902  0.3693 1.3328 3.0222  0.5513 1.8579 3.2822  0.8371 3.1620 3.4431  2.3086 3.6482 3.7883  ","8  0.0000 0.0000 0.0000  0.1298 0.0388 0.3520  0.3508 0.1804 0.8510  0.5196 0.4381 1.4085  0.8133 0.7529 1.4938  1.0065 1.1352 1.9639  1.3796 2.1658 2.5417  2.2238 3.8149 3.3990  ","8  0.0000 0.0000 0.0000  0.0998 0.1706 0.1090  0.3451 0.4047 0.4035  0.6131 0.5999 0.7309  0.9756 1.1231 1.4634  1.1648 1.4565 2.2517  1.2370 2.4069 2.5926  1.3100 2.9710 3.9142  ","8  0.0000 0.0000 0.0000  0.0366 0.0797 0.4317  0.1324 0.2662 0.8279  0.3642 0.5733 0.9499  0.6362 0.9431 0.8651  1.0381 1.4739 1.0461  2.0444 1.8274 1.0181  2.6810 2.9946 1.1546  ","8  0.0000 0.0000 0.0000  0.3822 0.0177 0.0006  0.9955 0.1053 0.0026  1.4609 0.2401 0.0040  1.6182 0.5351 0.0067  2.2918 1.1839 0.0132  3.6118 2.1627 0.0207  4.7376 2.6802 0.0258  ","8  0.0000 0.0000 0.0000  0.0431 0.1270 0.2113  0.0733 0.2161 0.3337  0.6363 0.3859 0.5936  1.5042 0.3084 0.5610  2.4520 0.2892 0.8145  2.9457 1.3396 1.2296  3.0500 1.9213 2.0401  ","8  0.0000 0.0000 0.0000  0.0608 0.1200 0.3126  0.5645 0.2400 0.5939  1.1000 0.2500 0.8000  1.5915 0.3198 0.9416  2.0816 0.1645 1.1263  2.5681 0.3292 1.4583  4.9742 0.6375 2.1082  ","8  0.0000 0.0000 0.0000  0.4545 0.1809 0.0137  0.7135 0.3338 0.0337  1.1690 0.4929 0.0562  2.1097 0.8059 0.0848  3.0837 1.3270 0.3927  3.9232 2.0780 1.3980  8.2362 2.3838 1.7636  ","8  0.0000 0.0000 0.0000  0.3066 0.0354 0.9862  0.8724 0.0675 1.2671  1.2591 0.0810 0.9463  1.9325 0.1208 1.1055  2.6893 0.1165 0.8203  2.8068 0.9847 0.7351  2.9890 1.4684 1.1275  ","8  0.0000 0.0000 0.0000  0.3116 0.0208 0.5177  0.8540 0.0926 0.5642  1.2547 0.2232 0.8313  1.9642 0.4047 1.1397  2.4439 1.0145 1.2643  2.3423 1.4297 1.6876  6.0508 1.8035 1.7654  ","8  0.0000 0.0000 0.0000  0.2579 0.1470 0.0294  0.4127 0.2601 0.0552  0.6265 0.3884 0.1348  0.8483 0.7215 0.2808  1.2369 1.1807 0.3120  1.8055 2.0213 0.8081  3.5848 2.8986 1.9559  ","8  0.0000 0.0000 0.0000  0.0740 0.1463 0.3843  0.1087 0.2365 0.5245  0.0878 0.3521 0.7369  0.1777 0.6585 1.1174  0.1814 1.0040 1.5065  0.1618 1.4062 1.8823  0.5153 4.0365 4.7134  ","8  0.0000 0.0000 0.0000  0.0872 0.1041 0.3407  0.3688 0.1985 0.8015  0.7416 0.2599 1.3288  1.1302 0.1833 1.8114  1.7497 0.2142 2.4791  2.4023 0.7426 2.4328  2.9265 1.1380 3.0898  ","8  0.0000 0.0000 0.0000  0.0317 0.0522 0.4144  0.1678 0.2120 0.6814  0.5342 0.4117 0.8938  0.9600 0.5832 0.9494  1.5046 0.7494 0.6738  2.4295 0.7747 0.5910  3.0362 1.1935 0.9553  ","8  0.0000 0.0000 0.0000  0.3422 0.0237 0.0911  0.6591 0.1377 0.2072  1.1604 0.4007 0.2912  1.5737 0.9310 0.3576  2.2287 1.3018 0.3895  3.0227 1.8701 0.5230  4.9686 3.3504 0.6972  ","8  0.0000 0.0000 0.0000  0.0107 0.0166 0.5552  0.0525 0.0999 1.3180  0.1156 0.3290 2.2321  0.2886 0.8339 2.6767  0.4364 1.4407 2.0888  0.6103 2.0342 2.3810  1.2292 4.3065 4.5202  ","8  0.0000 0.0000 0.0000  0.2423 0.1061 0.2508  0.3831 0.1904 0.6171  0.6085 0.4650 1.2062  0.2264 1.3210 1.7617  0.1447 2.0197 2.8518  0.1780 2.4917 3.0000  0.2117 2.9635 3.0000  ","8  0.0000 0.0000 0.0000  0.0669 0.1727 0.4868  0.1226 0.4850 0.6031  0.1996 1.1027 0.5419  0.4918 1.7297 0.6625  1.9409 2.1547 0.9116  2.7118 2.8810 0.8397  3.5226 4.0410 2.4097  "],nt=-1;function Po(s,t,e){return s*(1-e)+t*e}function rs(s,t,e,r,o,i){o=Math.max(o,1);let a=new Float32Array(3);a[0]=t,a[1]=e,a[2]=r;let n=Math.pow(1/o,.57);for(let B=0;B<3;B++)a[B]*=n;o*=n;let w=Math.max(0,s+o-2)*.25;for(let B=0;B<3;B++)a[B]=Po(a[B],1,w);let M=.87,F=(a[0]+a[1]+a[2]+5*Math.max(a[0],Math.max(a[1],a[2])))/8,R=Math.pow(F,M)/F;for(let B=0;B<3;B++)a[B]*=R;let P=.4,D=0,h=.48,m=Math.max(a[0],Math.max(a[1],a[2])),k=Math.max(0,Math.min(1,(m-h)/(D-h)));for(let B=0;B<3;B++)a[B]*=1-k*P;for(let B=0;B<3;B++)a[B]=Math.min(1,a[B]);return a}function Je(s,t){let e=s.length/4|0;t=Math.max(0,Math.min(1,t));let r=t*(e-1),o=Math.floor(r)|0,i=Math.min(o+1,e-1),a=r-o,c=s[o*4+0]*(1-a)+a*s[i*4+0],n=s[o*4+1]*(1-a)+a*s[i*4+1],x=s[o*4+2]*(1-a)+a*s[i*4+2];return{r:c,g:n,b:x}}function X0(s){let e="8  ";for(let r=0;r<8;r++){let o=r/7,i=Je(s,o);e=e+`${i.r.toFixed(4)} ${i.g.toFixed(4)} ${i.b.toFixed(4)}  `}return e}function ss(s){let t=new Array(ht.length+1),e=ht.length;for(let r=0;r<e;r++)t[r]=ht[r];return t[e]=X0(s),ht=t,e}function Y0(){let s=ht.length;nt<0||nt>=s||(console.log(`

Adjusted override palette:`),console.log(`  "${ht[nt]}",  // ${nt}`))}function Q0(){console.log(`

Saved palettes:`);for(let s=0;s<ht.length;s++)console.log(`  "${ht[s]}",  // ${s}`)}function os(s){let t=ht.length;nt<0||nt>=t||(ht[nt]=X0(s))}function We(){let s=ht.length;if(nt<0||nt>=s)return;let t=`Palette ${nt}`;return{palette:er(ht[nt]),name:t}}function J0(s,t,e,r,o){let i=ht.length;if(nt<0||nt>=i)return;let a=er(ht[nt]),c=o*4;c>=a.length||(t&&(a[c+0]*=s),e&&(a[c+1]*=s),r&&(a[c+2]*=s),ht[nt]=X0(a))}function Z0(){let s=nt!=-1;return nt=-1,s}function tr(s){let t=ht.length;nt<0||nt>=t?nt=0:nt=(nt+s+t)%t}function ns(s){let t=ht.length;s>=0&&s<t&&(nt=s)}function er(s){let t=s.trim().split(/\s+/),e=parseInt(t[0],10);if(!Number.isFinite(e)||e<0)throw new Error("Invalid count");let r=new Float32Array(e*4);for(let o=0;o<e;o++)r[o*4+0]=parseFloat(t[o*3+1]),r[o*4+1]=parseFloat(t[o*3+2]),r[o*4+2]=parseFloat(t[o*3+3]),r[o*4+3]=1;return r}function Ze(){if(Math.random()>.05){let s=ht.length,t=Math.floor(Math.random()*s)|0;return t=Math.min(t,s-1),{palette:er(ht[t]),name:`Palette ${t}`}}else{let e=.01+Math.random()*6.5*.6666666666666666,r=.01+Math.random()*6.5*(2/3),o=.01+Math.random()*6.5*(2/3),i=e+r+o;i<5.5&&(e=e*5.5/i,r=r*5.5/i,o=o*5.5/i),i>6.5&&(e=e*6.5/i,r=r*6.5/i,o=o*6.5/i);let a=Math.pow(2,-.7+2*Math.random()),c=Math.pow(2,-.7+2*Math.random()),n=Math.pow(2,-.7+2*Math.random()),x=8,w=new Float32Array(x*4);for(let P=0;P<x;P++){let D=P*(1/(x-1));w[P*4+0]=e*Math.pow(D,a),w[P*4+1]=r*Math.pow(D,c),w[P*4+2]=o*Math.pow(D,n),w[P*4+3]=1}let M=Math.max(0,Math.min(1,Math.random()*1.8-.2))*.6,F=1,A=1,R=1;for(let P=1;P<x;P++)F*=Math.pow(.78+.53*Math.random(),M),A*=Math.pow(.78+.53*Math.random(),M),R*=Math.pow(.78+.53*Math.random(),M),w[P*4+0]*=F,w[P*4+1]*=A,w[P*4+2]*=R;return{palette:w,name:"Random palette"}}}function Eo(s,t){return 1-Math.pow(2,-t/Math.max(1e-9,s))}var E0=class{constructor({fastIdx:t=3,slowIdx:e=1,scoreHalfLifeSec:r=4,minIntervalSec:o=.3,kMul:i=2.4,tAdd:a=.11,wBass:c=.7,wAll:n=.3}={}){this.fastIdx=t,this.slowIdx=e,this.scoreHalfLifeSec=r,this.minIntervalSec=o,this.kMul=i,this.tAdd=a,this.wBass=c,this.wAll=n,this.sPrev2=0,this.sPrev1=0,this.sCur=0,this.scoreAvg=0,this.lastBeatTimeSec=-1e9}_bandScore(t,e,r){let i=r+1e-9,a=t/i-1,c=(t-e)/i;return Math.max(0,a)+Math.max(0,c)}update(t,e,r,o,i,a){let c=1/Math.max(1e-6,e),n=t*c,x=r,w=o,M=o,F=i,A=a,R=a,P=this._bandScore(x,w,M),D=this._bandScore(F,A,R),h=this.wBass*P+this.wAll*D,m=Eo(this.scoreHalfLifeSec,c);this.scoreAvg=(1-m)*this.scoreAvg+m*h;let B=Math.max(this.scoreAvg,1e-4)*this.kMul+this.tAdd;this.sPrev2=this.sPrev1,this.sPrev1=this.sCur,this.sCur=h;let V=this.sPrev1,H=this.sPrev1>this.sPrev2&&this.sPrev1>=this.sCur,l=!1,u;if(H&&V>B){let f=n-c;f-this.lastBeatTimeSec>=this.minIntervalSec&&(l=!0,u=f,this.lastBeatTimeSec=f)}return{beat:l,score:h,threshold:B,beatTimeSec:u}}};var Wo=document.getElementById("start_mic"),No=document.getElementById("start_tab"),Ro=document.getElementById("start_demo"),is=document.getElementById("start_remote_mp3"),$o=document.getElementById("start_local_mp3"),s0=document.getElementById("local_file_input"),Ne=document.getElementById("status"),fi=document.getElementById("start_message"),Te=document.getElementById("c"),Ht=document.getElementById("dbg"),G0=document.getElementById("audio_source_select_screen"),Co=document.getElementById("hud"),Y=Ht.getContext("2d"),as=document.getElementById("license_line"),ls=document.getElementById("license_prefix"),F0=document.getElementById("license_link"),cs=document.getElementById("license_suffix"),mt=class{constructor(t,e="",r="",o="",i=null,a="",c=null){this.filename=t,this.path=a,this.songname=r,this.artist=e,this.source=o,this.license=i,this.file=c,this.has_metadata=r.length>0||e.length>0||o.length>0||i.length>0}GetToast(){let t="",e="",r="",o="",i="",a="";return this.has_metadata?(this.source.length>0&&(t+=this.source+", "),this.license!=null&&(t+="license type: ",e=this.license.text,r=this.license.link,o=""),i=`${Tt}Playing '${this.songname}' by ${this.artist}${lt}`,a=`${this.artist} - ${this.songname}`):(this.path.length==0?i=Tt+this.filename+lt:i=`${de}${this.path}/${lt}
${Tt}${this.filename}${lt}`,a=this.filename.replace(/\.[^/.]+$/,"")),{license_prefix:t,license_text:e,license_link:r,license_suffix:o,song_name:i,embed_string:a}}};function $s(s){for(let t=s.length-1;t>0;t--){let e=Math.floor(Math.random()*(t+1));[s[t],s[e]]=[s[e],s[t]]}}var Wt="Song from the Free Music Archive",ae={text:"CC BY",link:"https://creativecommons.org/licenses/by/4.0/"},W0={text:"CC BY-SA",link:"https://creativecommons.org/licenses/by-sa/4.0/"},zo=[new mt("mp3/1000 Handz - Sharpens Steel.mp3","1000 Handz","Sharpens Steel",Wt,ae),new mt("mp3/Grumplefunk - Prelude.mp3","Grumplefunk","Prelude",Wt,ae),new mt("mp3/Kevin MacLeod - Erik Satie Gymnopedie No 1.mp3","Kevin MacLeod","Erik Satie Gymnopedie No 1",Wt,ae),new mt("mp3/Kevin MacLeod - Mourning Song.mp3","Kevin MacLeod","Mourning Song",Wt,ae),new mt("mp3/John Harrison with the Wichita State University Chamber Players - Spring Mvt 3 Allegro pastorale.mp3","John Harrison with the Wichita State University Chamber Players","Spring Mvt 3 Allegro pastorale",Wt,ae),new mt("mp3/Ketsa - Goes Red.mp3","Ketsa","Goes Red",Wt,ae),new mt("mp3/Andrey Petrov - I won't hear the wind's tale.mp3","Andrey Petrov","I won't hear the wind's tale",Wt,ae),new mt("mp3/Tea K Pea - mewmew.mp3","Tea K Pea","mewmew",Wt,ae),new mt("mp3/Lovira - Birthday present.mp3","Lovira","Birthday present",Wt,W0),new mt("mp3/Lovira - Re.mp3","Lovira","Re",Wt,W0),new mt("mp3/Birds for Scale - Smarties.mp3","Birds for Scale","Smarties",Wt,W0),new mt("mp3/Small Colin - Mono Crash.mp3","Small Colin","Mono Crash",Wt,W0),new mt("mp3/Nunuther - Weirment Eubie.mp3","Nunuther","Weirment Eubie"),new mt("mp3/Nunuther - Thrive.mp3","Nunuther","Thrive")],yt=zo;$s(yt);var qt=[],$t=0,ds=5,_s=1.1,Go=.5,fs=1,hs=.001,Rt=Go,pt=!1,Se=!1,a0=!0,l0=!1,Le="",o0=!!window.GeissAmpConfig,n0="",Bt=!1,Lt=!1,Oe=-1,Ue=-1,us=St*17,Bo=St*32,ps=St*4,Lo=St*8,pe=120,Nt=1,xs=Math.pow(2,-10),ms=Math.pow(2,4),Re=pe,ut=1,me=0,t0=-1,ys=0,N0=new Float32Array(120).fill(1/pe),rr=0,ke=!1,$e=0,e0=!1,Ie=performance.now()*.001,Kt=Ie,sr=Ie-1/90,qe=Ie,i0=Ie,dr=Ie,gs=Ie,He=!0,Xt=[],Ot=0,R0=new Float32Array(120).fill(1/pe),or=0,nr=1/pe,Ge=!1,le=!1,_e=1,ye=2,Oo=96,ge=-1,st=1,Uo=8192,Do=4,ws=.25,xt=Ze(),bt=null,Ce=null,vs=null,wt=!1,C0=qe+10,Cs=qe+20,Ut=!1,_r=!1,Dt=!1,fr=!1,hr=!1,ur=!1,pr=!1,xr=!1,jt=1,It=0,we=.6,ze=!0,ve=!0,Me=!0,be=!0,Gt=1,Ae=[{f0:30,f1:200,name:"bass"},{f0:200,f1:2200,name:"mid"},{f0:2200,f1:12e3,name:"high"},{f0:30,f1:12e3,name:"vol"}],c0=Ae.length,Ms=0;var ir=3,bs=["rgba(240,64,0,1)","rgba(0,220,0,1)","rgba(24,170,255,1)","rgba(255,255,255,1)"],zs=[30,3,2,1],d0=zs.length,ks=2,As=0,wr=1e-5,De=new Float32Array(c0).fill(wr*20),he=new Array(d0);for(let s=0;s<d0;s++)he[s]=new Float32Array(c0).fill(wr*20);var ar=9999.9,Ho=new E0({fastIdx:3,slowIdx:1,minIntervalSec:.2,kMul:2,tAdd:.08}),r0=new Float32Array(180).fill(1/pe),lr=0,Tt='<span style="color:#FFF;">',de='<span style="color:#BBB;">',Io='<span style="color:#4F4;">';var lt="</span>",Ss=location.hostname==="localhost"||location.hostname==="127.0.0.1"||location.hostname==="::1";function qo(s){return s*s*(3-2*s)}(function(){if(window.GeissAmpConfig)return;let t=location.hostname,e=t==="localhost"||t==="127.0.0.1"||t==="[::1]"||/^127(?:\.\d{1,3}){3}$/.test(t);if(!isSecureContext&&!e){let r="https://"+location.host+location.pathname+location.search+location.hash;throw document.body.style.background="black",document.body.style.color="white",document.body.style.font="20px/1.4 sans-serif",document.body.style.padding="24px",document.body.innerHTML=`
      <div style="max-width: 900px;">
        <div style="margin-bottom: 12px;">
          For webGPU to work properly, this site must be loaded over <b>HTTPS</b> (secure context).
        </div>
        <div style="margin-bottom: 12px;">
          Current URL:<br><code>${location.href}</code>
        </div>
        <div style="margin-top: 18px;">
          Please use this link instead:<br>
          <a href="${r}" style="color: #6cf; word-break: break-all;">${r}</a>
        </div>
      </div>
    `,new Error("HTTPS required: "+r)}})();var _0=navigator.userAgent;console.log(`Browser: ${_0}`);var Ko=/Chrome|Chromium|CriOS/i.test(_0),Vo=/Firefox\/\d+/i.test(_0)||/FxiOS\/\d+/i.test(_0),Gs=/Safari/i.test(_0)&&!Ko,jo=new URLSearchParams(window.location.search),Bs=jo.get("force_hdr")!=null,te=window.GeissAmpConfig?!1:!Gs&&!Vo||Bs,ue=!!matchMedia("(dynamic-range: high)").matches,Be=!(ue&&te);function Xo(){let s="";ue||(s+=`Code 1: HDR display not detected.
`),te||(s+=`Code 2: This browser does not [properly] support HDR rendering.
`),s+=`
Please expect degraded visual quality.

For best results, use an HDR display with 1000+
nits of brightness, and Chrome browser.`,G(s,910323,Ot==0?15:9)}function vr(){let s=window.innerWidth,t=window.innerHeight;console.log(`Resizing window to ${s}x${t}`),Te.width=s,Te.height=t,Ht.width=s,Ht.height=t;let e=Math.max(1,Math.floor(s*st))|0,r=Math.max(1,Math.floor(t*st))|0;return{cw:s,ch:t,iw:e,ih:r}}function Yo(s,t,e,r,o=1){Y.globalAlpha=o,Y.fillStyle=r,Y.beginPath(),Y.arc(s,t,e,0,Math.PI*2),Y.fill(),Y.globalAlpha=1}function Qo(s,t){let e=1/t;for(let r=0;r<d0;r++){let o=zs[r],i=o*2*e;for(let a=0;a<c0;a++){let c=1;s<i?c=1/Math.max(1,s+1):c=1-Math.pow(2,-t/o),De[a]>he[r][a]?c=Math.pow(c,1/(1+As)):c=Math.pow(c,1+As),he[r][a]=c*De[a]+(1-c)*he[r][a]}}}function G(s,t=0,e=1.5){if(He){if(t!=0){let i=[];for(let a=0;a<Xt.length;a++)Xt[a].id!=t&&i.push(Xt[a]);Xt=i}let o=performance.now()*.001+e;Xt.push({message:s,id:t,end_time:o})}}function Jo(){let s=navigator.userAgent||"",t=navigator.maxTouchPoints||0,e=Math.min(window.screen.width,window.screen.height),r=/iPad/.test(s)||navigator.platform==="MacIntel"&&t>1,o=/Android/.test(s),i=/Mobi|iPhone|iPod|Windows Phone/.test(s);if(r)return"tablet";if(o)return/Mobile/.test(s)?"phone":"tablet";if(i)return"phone";if(t>0){if(e<600)return"phone";if(e<900)return"tablet"}return"laptop_or_desktop"}Mr("hdr_warn_overlay",0);Mr("safari_warn_overlay",1);Mr("phone_warn_overlay",2);function Mr(s,t){let e=document.getElementById(s);return!e||t==0&&(ue&&te||Bs)||t==1&&!Gs||t==2&&Jo()!="phone"?Promise.resolve():(e.style.display="flex",new Promise(r=>{let o=()=>{!e||e.style.display==="none"||(e.remove(),window.removeEventListener("keydown",i,!0),window.removeEventListener("pointerdown",o,!0),r())},i=a=>{a.key==="Shift"||a.key==="Control"||a.key==="Alt"||a.key==="Meta"||o()};window.addEventListener("keydown",i,!0),e.addEventListener("pointerdown",o,!0)}))}var{cw:Yt,ch:ee,iw:Qt,ih:Jt}=vr();window.addEventListener("resize",()=>{({cw:Yt,ch:ee,iw:Qt,ih:Jt}=vr()),rt&&rt.resize(Yt,ee,Qt,Jt),fe&&fe.resize(Yt,ee,Qt,Jt,st)});var z0=!1,Ls=0,Os=0,Zo=0,Ts=20,Ps=40;window.addEventListener("pointermove",function(s){window.GeissAmpConfig&&!window.GeissAmpConfig.active||s.pointerType!=="touch"&&Ot>0&&(le&&G("Animation is frozen; press SHIFT+F to resume",3424123,3),pt&&ot.isPaused()&&G("Playback is paused; press C to resume",7538623,1),Ge||G("Press H for help",624362,1))});window.addEventListener("pointerdown",s=>{window.GeissAmpConfig&&!window.GeissAmpConfig.active||s.isPrimary&&(s.target.closest("#hud")||(z0=!0,Ls=s.clientX,Os=s.clientY,Zo=performance.now()))});window.addEventListener("pointerup",s=>{if(!z0)return;z0=!1;let t=s.clientX,e=s.clientY,r=t-Ls,o=e-Os;if(r*r+o*o<=Ts*Ts){s.pointerType==="mouse"||s.pointerType===void 0?void 0:tn(t,e);return}Math.abs(r)<Ps&&Math.abs(o)<Ps||s.pointerType==="touch"&&(Math.abs(r)>Math.abs(o)?r>0?rn():en():o>0?on():sn())});window.addEventListener("pointercancel",s=>{s.pointerType==="touch"&&(z0=!1)});function tn(s,t){br()}function en(){console.log("swipe left")}function rn(){console.log("swipe right")}function sn(){console.log("swipe up")}function on(){console.log("swipe down")}async function Es(){st=1,document.fullscreenElement?await document.exitFullscreen():await document.documentElement.requestFullscreen()}function mr(s,t){({cw:Yt,ch:ee,iw:Qt,ih:Jt}=vr()),rt.resize(Yt,ee,Qt,Jt),fe.resize(Yt,ee,Qt,Jt,t);let e=t>s?"increased":"decreased";G(`Resolution ${e} to ${Qt} x ${Jt} (${t.toFixed(2)}x)`,914323)}function nn(){let s=!1;if(Math.abs(It-0)>1e-4&&(It=0,G(`Darkening reset to ${It.toFixed(1)}x`,5831722),s=!0),Math.abs(ut-1)>1e-4&&(ut=1,G(`Transition speed reset to ${ut.toFixed(5)}x`,643261),s=!0),Math.abs(Nt-1)>1e-4&&(Nt=1,G(`Motion speed reset to ${Nt.toFixed(3)}x`,532432),s=!0),Math.abs(It-0)>1e-4&&(It=0,G(`Darkening reset to ${It.toFixed(1)}x`,5831722),s=!0),Math.abs(jt-1)>1e-4&&(jt=1,G(`Brightness reset to ${jt.toFixed(2)}x`,451342),s=!0),Math.abs(_e-1)>1e-4&&(_e=1,G(`Wave scale reset to ${_e.toFixed(3)}`,468206),s=!0),Math.abs(st-1)>1e-4){let t=st;st=1,mr(t,st),s=!0}s||G("(Nothing more to reset)",8752346)}var $0=-1;function Vt(s){if(ke)if($0==-1)$0=s;else{let t=$0*10+s;$0=-1,rt.SetMotionModeDebug(t,i0),G(`Set motion mode to ${t}`,318093)}else s==0?nn():s==1?xr=!0:s==2?pr=!0:s==3?hr=!0:s==4&&(ur=!0)}function ce(){let s=us+(Bo-us)*Math.random(),t=ps+(Lo-ps)*Math.random();C0=qe+s,Cs=C0+t}function br(){wt&&Dt&&Ut&&G("Can't randomize anything; press L to unlock first",235153),Us(),Hs(),Is()}function Us(){wt||(qe=Math.random()*1e4,Z0(),xt=Ze(),bt=null,ce())}function Ds(){let s=Math.max(0,Math.min(1,(qe-C0)/(Cs-C0)));return qo(s)}function an(){let s=Ds();if(s>1e-4&&bt){let t=s*100+.5|0;return`Blend of ${xt.name} (${100-t}%) and ${bt.name} (${t}%)`}else return xt.name}function Hs(){Ut||(i0=Math.random()*1e4,_r=!0)}function Is(){Dt||(dr=Math.random()*1e4,fr=!0)}function ln(s,t=1e3){let e=0,r=!1;function o(){e&&(clearTimeout(e),e=0)}function i(){s.style.cursor=""}function a(){r&&(s.style.cursor="none")}function c(){r&&(i(),o(),e=setTimeout(a,t))}function n(){r=!0,c()}function x(){r=!1,o(),i()}return s.addEventListener("pointerenter",n),s.addEventListener("pointerleave",x),s.addEventListener("pointermove",c),s.addEventListener("pointerdown",c),s.addEventListener("wheel",c,{passive:!0}),function(){o(),i(),s.removeEventListener("pointerenter",n),s.removeEventListener("pointerleave",x),s.removeEventListener("pointermove",c),s.removeEventListener("pointerdown",c),s.removeEventListener("wheel",c)}}ln(Te,250);var ot=null,rt=null,fe=null;function yr(s){if(!s)return!1;let t=s.name||"";return(s.type||"").startsWith("audio/")?!0:/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(t)}function cn(s){return new Promise((t,e)=>{s.file(t,e)})}function dn(s){return new Promise((t,e)=>{let r=s.createReader(),o=[];function i(){r.readEntries(a=>{if(!a||a.length===0){t(o);return}o.push(...a),i()},e)}i()})}async function qs(s,t){if(s){if(s.isFile){try{let e=await cn(s);yr(e)&&t.push({file:e,path:s.fullPath||e.name})}catch(e){console.warn("Failed to read dropped file entry:",e)}return}if(s.isDirectory)try{let e=await dn(s);for(let r of e)await qs(r,t)}catch(e){console.warn("Failed to read dropped directory entry:",e)}}}async function _n(s){let t=[];if(s.items&&s.items.length>0){let e=[];for(let r of s.items){if(r.kind!=="file")continue;let o=typeof r.getAsEntry=="function"&&r.getAsEntry()||typeof r.webkitGetAsEntry=="function"&&r.webkitGetAsEntry()||null;if(o)e.push(o);else{let i=r.getAsFile?.();i&&yr(i)&&t.push({file:i,path:o.fullPath||i.name})}}for(let r of e)await qs(r,t);return t}if(s.files&&s.files.length>0)for(let e of s.files)yr(e)&&t.push({file:e,path:""});return t}function Ks(){qt=new Uint32Array(yt.length);for(let s=0;s<yt.length;s++)qt[s]=s;$s(qt),$t=0}async function Fs(){if(ot.getCurrentSongTimeInSeconds()<.5){let s=qt.length;if(s==0)return;$t=($t+s-1)%s;let t=qt[$t],e=yt[t].filename;if(yt[t].file){let o=await ot.loadLocalFile(yt[t].file,Rt,!1);if(!o.success){alert(`Could not load audio file: ${e}, error: ${o.error}`);return}}else ot.loadNewSong(e);B0()}else ot.rewindCurrentSong()}async function cr(){let s=qt.length;if(s==0)return;$t=($t+1)%s;let t=qt[$t],e=yt[t].filename;if(yt[t].file){let o=await ot.loadLocalFile(yt[t].file,Rt,!1);if(!o.success){alert(`Could not load audio file: ${e}, error: ${o.error}`);return}}else ot.loadNewSong(e);B0(),ot.songHasEnded()&&ot.play()}async function Vs(s){s.sort((i,a)=>i.file.name.localeCompare(a.file.name)),yt=[];for(let i=0;i<s.length;i++){let a=s[i].file.name,c=s[i].path;c.startsWith("/")&&(c=c.slice(1)),c.includes("/")&&(c=c.slice(0,c.lastIndexOf("/"))),c==a&&(c=""),yt.push(new mt(a,"","","","",c,s[i].file))}yt.length>1&&G(`Found ${yt.length} audio files.`,4328947,3),Ks();let t=!l0;t&&kr();let e=qt[$t],o=await ot.loadLocalFile(yt[e].file,Rt,!1);o.success?(a0=!0,B0()):alert(`Could not load audio file: ${yt[e].file.name}, error: ${o.error}`),t&&h0()}s0.addEventListener("change",async()=>{let s=Array.from(s0.files);if(!(s&&s[0]))return;pt=!0,Se=!1;let e=[];for(let r of s0.files)e.push({file:r,path:r.name});await Vs(e),s0.value="",l0||h0()});function fn(s){let t=performance.now()+s,e=0;for(;performance.now()<t;)typeof Atomics.pause=="function"&&(Atomics.pause(),e++);return e}window.GeissAmpConfig||window.addEventListener("dragover",s=>{s.preventDefault(),Te.classList.add("drag_active"),G0.classList.add("drag_active")});window.GeissAmpConfig||window.addEventListener("dragleave",s=>{Te.classList.remove("drag_active"),G0.classList.remove("drag_active")});window.GeissAmpConfig||window.addEventListener("drop",async s=>{s.preventDefault(),Te.classList.remove("drag_active"),G0.classList.remove("drag_active");let t=await _n(s.dataTransfer);if(t.length===0){console.log("No audio files found in dropped items.");return}pt=!0,Se=!1,await Vs(t),l0||h0()});function kr(){l0||(l0=!0,G0.remove(),ot=new p0({fftSize:2048}))}async function f0(s){kr();let t={success:!1,error:""};if(s==0)t=await ot.startMic();else if(s==1)t=await ot.startTab();else if(s==2){pt=!0,Se=!0,Ks();let e=qt[$t],r=yt[e].filename;t=await ot.startMP3(r,Rt,!1),B0()}else s==3?alert("Path not currently supported."):s==4&&(pt=!0,a0=!1,t.success=!0);t.success||se(`Oops!  Something went wrong.  Please refresh to select another audio source.

Error: ${t.error}`),h0()}function Ws(s){s=s|0;let t=Math.floor(s/60);if(s-=t*60,t<60)return`${t}:${String(s).padStart(2,"0")}`;let e=Math.floor(t/60);return t-=e*60,`${e}:${String(t).padStart(2,"0")}:${String(s).padStart(2,"0")}`}function gr(){if($t<0||$t>=qt.length)return;let s=qt[$t];return yt[s].GetToast()}function Ns(){let s=ot.getCurrentSongTimeInSeconds(),t=ot.getCurrentSongLengthInSeconds();return`${de}${Ws(s)} / ${Ws(t)}${lt}`}function Rs(){He&&(!Lt||Ue>=0)&&(Lt=!0,Ue=performance.now()*.001+3)}function B0(){pt&&o0&&(Le=gr().embed_string),He&&(!Bt||Oe>=0)&&(Bt=!0,Oe=performance.now()*.001+(Se?8:3))}async function h0(){Ht.style.display="none",fe=new P0(Te,Yt,ee,Qt,Jt,st);let s=ue&&te;await fe.init(s),rt=new b0(fe,Yt,ee,Qt,Jt,Kt),navigator.gpu||se(`ERROR: WebGPU not supported in this browser.
(navigator.gpu is undefined)

Consider trying Google Chrome.

Otherwise, look up if your browser (and version number) support WebGPU.
In some cases, it might still be behind a browser feature flag
or setting that you need to turn on.  Then be sure to restart your browser.`),Ne.textContent=a0?"running":`Drag-and-drop your music files here to play them.

Or press CTRL+L to browse for them.

Supported types: mp3, m4a, ogg, wav`,Ne.style.fontSize="16px",Ne.style.color="white";let t=null,e=`${Tt}Keyboard commands:${lt}
  ${Io}H         toggle help screen
  SPACE     randomize visuals
  L         lock/unlock visuals
  F         toggle fullscreen${lt}`,r=`

${Tt}Playback control:${lt}${de}
  <EM>In addition to your computer's
  built-in media control keys for
  volume, pause, next, etc:</EM>
  Z B       prev/next song
  C         play/pause song
  \u2190 \u2192       seek within song
  \u2191 \u2193       adjust volume${lt}`,o=`

${Tt}Advanced:${lt}${de}
  CTRL + L  browse for songs
  CTRL + H  toggle HDR/SDR
  [ ]       adjust transition speed
  - +       adjust motion speed
  e E       adjust brightness
  d D       adjust darkening
  j J       adjust wave size
  q Q       adjust resolution
  0         reset all adjustable parameters
  1..4      toggle various visual effects
  CTRL+T    hide/show text pop-ups
  SHIFT+F   [un]freeze visuals${lt}`,i=`${de}
  I         show song info/time
  T         paint song title
               (+SHIFT = toggle auto)${lt}`;window.addEventListener("keydown",n=>{if(!(window.GeissAmpConfig&&!window.GeissAmpConfig.active)){if((n.key=="F1"||n.key==="h"||n.key=="H")&&!n.ctrlKey&&(Ge=!Ge),n.key==="Escape"&&(le?(le=!1,G("Animation resumed",3424123,3)):ze?Ge?Ge=!1:document.fullscreenElement&&Es():ze=!0),n.key==="ArrowLeft"&&!n.ctrlKey&&!n.shiftKey&&pt&&(Ss&&Se?G("Sorry - seeking doesn't work when page is served from localhost.",512433):(ot.seekRelative(-ds),Rs())),n.key==="ArrowRight"&&!n.ctrlKey&&!n.shiftKey&&pt&&(Ss&&Se?G("Sorry - seeking doesn't work when page is served from localhost.",512433):(ot.seekRelative(ds),Rs())),(n.key==="z"||n.key==="Z")&&!n.ctrlKey&&pt&&Fs(),(n.key==="b"||n.key==="B")&&!n.ctrlKey&&pt&&cr(),n.key==="ArrowUp"&&pt&&(Rt=Math.max(hs,Math.min(fs,Rt*_s)),ot.setVolume(Rt),G(`Volume set to ${Rt.toFixed(3)}`,713432)),n.key==="ArrowDown"&&pt&&(Rt=Math.max(hs,Math.min(fs,Rt/_s)),ot.setVolume(Rt),G(`Volume set to ${Rt.toFixed(3)}`,713432)),(n.key==="f"||n.key==="F")&&!n.ctrlKey&&n.shiftKey&&(le=!le,G(le?"Image frozen for study":"Animation resumed",3424123,3)),(n.key==="f"||n.key==="F")&&!n.ctrlKey&&!n.shiftKey&&!window.GeissAmpConfig&&(document.fullscreenElement||G("Press F or ESC to exit fullscreen mode",6431534,3),Es()),n.key==="e"&&!n.ctrlKey&&(jt*=Math.pow(2,-.1),G(`Brightness adjusted to ${jt.toFixed(2)}x`,451342)),n.key==="E"&&!n.ctrlKey&&(jt*=Math.pow(2,.1),G(`Brightness adjusted to ${jt.toFixed(2)}x`,451342)),n.key==="d"|n.key==="D"&&!n.ctrlKey&&(It+=n.key==="d"?-.1:.1,It=Math.max(-1,Math.min(1,It)),G(`Darkening adjusted to ${It.toFixed(1)}x`,5831722)),n.key==="["&&!n.ctrlKey&&(ut*=Math.pow(2,-.5),ut=Math.max(ut,Math.pow(2,-17)),ut<1?G(`Transition speed adjusted to ${ut.toFixed(5)}x`,643261):G(`Transition speed adjusted to ${ut.toFixed(1)}x`,643261)),n.key==="]"&&!n.ctrlKey&&(ut*=Math.pow(2,.5),ut=Math.min(ut,16),ut<1?G(`Transition speed adjusted to ${ut.toFixed(5)}x`,643261):G(`Transition speed adjusted to ${ut.toFixed(1)}x`,643261)),(n.key==="-"||n.key==="_")&&!n.ctrlKey&&(Nt*=Math.pow(2,-.25),Nt=Math.max(xs,Math.min(ms,Nt)),G(`Motion speed adjusted to ${Nt.toFixed(3)}x`,532432)),(n.key==="+"||n.key==="=")&&!n.ctrlKey&&(Nt*=Math.pow(2,.25),Nt=Math.max(xs,Math.min(ms,Nt)),G(`Motion speed adjusted to ${Nt.toFixed(3)}x`,532432)),n.key==="s"&&!n.ctrlKey&&(ye=Math.max(0,ye-1),G(`Wave smoothing adjusted to ${ye}`,682343)),n.key==="S"&&!n.ctrlKey&&(ye=Math.min(32,ye+1),G(`Wave smoothing adjusted to ${ye}`,682343)),(n.key==="h"||n.key==="H")&&n.ctrlKey&&(!ue||!te?Xo():(Be=!Be,G(Be?"HDR disabled":"HDR enabled",348296))),n.key==="j"&&!n.ctrlKey&&(_e*=Math.pow(2,-1/3),G(`Wave scale set to ${_e.toFixed(3)}`,468206)),n.key==="J"&&!n.ctrlKey&&(_e*=Math.pow(2,1/3),G(`Wave scale set to ${_e.toFixed(3)}`,468206)),n.key==="p"&&!n.ctrlKey&&(wt&&G("Can't randomize palette; press SHIFT+P to unlock first",135165),Us()),n.key==="P"&&!n.ctrlKey&&(wt=!wt,G(wt?"Palette locked":"Palette unlocked",583243)),n.key==="q"&&!n.ctrlKey&&st>ws){let x=st;if(st>1.99)st-=1;else{let w=1/st;w+=.5,st=Math.max(ws,1/w)}st!=x&&mr(x,st)}if(n.key==="Q"&&!n.ctrlKey){let x=Math.min(Do,Math.floor(Uo/Yt));if(st<x){let w=st;if(st>.99)st+=1;else{let M=1/st;M-=.5,st=Math.min(x,1/M)}st!=w&&mr(w,st)}}if((n.key==="L"||n.key==="l")&&!n.ctrlKey&&(wt&&Dt&&Ut?(wt=!1,Dt=!1,Ut=!1,G("Everything unlocked",179375)):(wt=!0,Dt=!0,Ut=!0,G("Everything locked",179375))),n.key===" "&&!n.ctrlKey&&!window.GeissAmpConfig&&br(),n.key==="m"&&!n.ctrlKey&&(Ut&&G("Can't randomize motion; press SHIFT+M to unlock first",862734),Hs()),n.key==="M"&&!n.ctrlKey&&(Ut=!Ut,G(Ut?"Motion locked":"Motion unlocked",149323)),n.key==="w"&&!n.ctrlKey&&(Dt&&G("Can't randomize waveform; press SHIFT+W to unlock first",432512),Is()),n.key==="W"&&!n.ctrlKey&&(Dt=!Dt,G(Dt?"Waveform locked":"Waveform unlocked",682738)),(n.key==="t"||n.key==="T")&&(n.shiftKey?(o0=!o0,G(o0?"Song titles auto-paint enabled":"Song titles auto-paint disabled",3824576)):n.ctrlKey?He?(G("Further text pop-ups will be hidden",532653),He=!1):(He=!0,G("Text pop-ups re-enabled",532653)):pt?Le=gr().embed_string:n0&&(Le=n0)),n.key==="0"&&!n.ctrlKey&&Vt(0),n.key==="1"&&!n.ctrlKey&&Vt(1),n.key==="2"&&!n.ctrlKey&&Vt(2),n.key==="3"&&!n.ctrlKey&&Vt(3),n.key==="4"&&!n.ctrlKey&&Vt(4),n.key==="5"&&!n.ctrlKey&&Vt(5),n.key==="6"&&!n.ctrlKey&&Vt(6),n.key==="7"&&!n.ctrlKey&&Vt(7),n.key==="8"&&!n.ctrlKey&&Vt(8),n.key==="9"&&!n.ctrlKey&&Vt(9),(n.key==="e"||n.key=="E")&&n.ctrlKey&&(e0=!e0,G(`Experiment is now ${e0}`,8413461)),n.key==="F8"&&!n.ctrlKey&&(ke=!ke,ke||Z0()&&(wt=!1),G(ke?"Debugging keys enabled":"Debugging keys disabled",696332)),ke){if(console.log(`Key pressed: "${n.key}"`),n.key=="y"&&!n.ctrlKey&&(we=Math.max(.2,we-.05),G(`align_frac is now ${we.toFixed(2)}`,8472612)),n.key=="Y"&&!n.ctrlKey&&(we=Math.min(1,we+.05),G(`align_frac is now ${we.toFixed(2)}`,8472612)),(n.key==="z"||n.key==="Z")&&n.ctrlKey&&wt&&Ce!=null&&(os(Ce.palette),xt=Ce,bt=null,G("Reverted palette changes",5892474)),n.key==="v"&&!n.ctrlKey&&(ge=Math.min(1,Math.max(.05,ge-.05)),G(`Wave point size adjusted to ${ge.toFixed(2)}`,1423643)),n.key==="V"&&!n.ctrlKey&&(ge=Math.min(1,Math.max(.05,ge+.05)),G(`Wave point size adjusted to ${ge.toFixed(2)}`,1423643)),(n.key==="v"||n.key==="V")&&n.ctrlKey&&(ze=!ze),n.key==="1"&&n.ctrlKey&&(Gt=1),n.key==="2"&&n.ctrlKey&&(Gt=2),n.key==="3"&&n.ctrlKey&&(Gt=3),n.key==="4"&&n.ctrlKey&&(Gt=4),n.key==="5"&&n.ctrlKey&&(Gt=5),n.key==="6"&&n.ctrlKey&&(Gt=6),n.key==="7"&&n.ctrlKey&&(Gt=7),n.key==="8"&&n.ctrlKey&&(Gt=8),n.key==="9"&&n.ctrlKey&&(Gt=9),(n.key==="r"||n.key==="R")&&n.ctrlKey&&(ve=!ve,G(`Palette editing r/g/b -> ${ve?"1":"0"}/${Me?"1":"0"}/${be?"1":"0"}`,2068634)),(n.key==="g"||n.key==="G")&&n.ctrlKey&&(Me=!Me,G(`Palette editing r/g/b -> ${ve?"1":"0"}/${Me?"1":"0"}/${be?"1":"0"}`,2068634)),(n.key==="b"||n.key==="B")&&n.ctrlKey&&(be=!be,G(`Palette editing r/g/b -> ${ve?"1":"0"}/${Me?"1":"0"}/${be?"1":"0"}`,2068634)),(n.key==="d"||n.key==="D")&&n.ctrlKey&&($e=($e+1)%3,Ht.style.display=$e>0?"block":"none"),(n.key==="c"||n.key==="C")&&n.ctrlKey){let x=ss(vs);ns(x),Q0(),wt=!0,xt=We(),bt=null,ce(),G(`Added new palette: ${xt.name}`,453232)}if(n.key==="x"&&!n.ctrlKey&&Q0(),n.key==="i"&&n.ctrlKey&&(wt=!0,tr(-1),xt=We(),bt=null,Ce=xt,ce(),G(`Forcing ${xt.name}`,290941)),n.key==="o"&&n.ctrlKey){wt=!0,tr(1),xt=We(),bt=null,Ce=xt,ce(),G(`Forcing ${xt.name}`,290941);return}if(n.key===","&&!n.ctrlKey){J0(1/1.05,ve,Me,be,Gt);let x=We();x!=null&&(xt=x,bt=null,ce(),Y0())}if(n.key==="."&&!n.ctrlKey){J0(1.05,ve,Me,be,Gt);let x=We();x!=null&&(xt=x,bt=null,ce(),Y0())}}if((n.key==="c"||n.key==="C")&&!n.ctrlKey&&pt){let x=ot.togglePause();G(x?"Playback resumed":"Playback paused",7538623,x?2:3)}(n.key==="l"||n.key==="L")&&n.ctrlKey&&!window.GeissAmpConfig&&(n.preventDefault(),s0.click()),(n.key==="i"||n.key==="I")&&!n.ctrlKey&&(Bt&&Lt?Bt=!1:Bt&&!Lt?Lt=!0:!Bt&&Lt?Lt=!1:Bt=!0,Oe=-1,Ue=-1)}});function a(){sr=Kt,Kt=performance.now()*.001;let n=Kt;Ot==0&&(sr=Kt-1/60);let x=Math.min(.2,Math.max(.001,Kt-sr)),w=pt&&(ot.isPaused()||le);!wt&&!w&&(qe+=x*ut),!Ut&&!w&&(i0+=x*ut),!Dt&&!w&&(dr+=x*ut),gs+=x*Math.min(ut,1);{r0[lr]=x,lr=(lr+1)%r0.length;let l=0;for(let f=0;f<r0.length;f++)l+=r0[f];let u=1/(l/r0.length);Re=Re*.95+.05*u}Kt>Oe&&Oe>=0&&(Bt=!1,Oe=-1),Kt>Ue&&Ue>=0&&(Lt=!1,Ue=-1),Ot==0&&(xt=Ze(),bt=null,ce(),G("Press H for help",624362,5));{let l=Ds();l>0&&bt==null&&(bt=Ze()),l>=1&&(xt=bt,bt=null,ce(),l=0);let u=xt,f=bt;if(ze||(l=0,u=Ce,f=null),l<1e-5)for(let d=0;d<256;d++){let v=d*.00392156862745098,y=Je(u.palette,v);rt.paletteRGBA[d*4+0]=y.r,rt.paletteRGBA[d*4+1]=y.g,rt.paletteRGBA[d*4+2]=y.b,rt.paletteRGBA[d*4+3]=1}else for(let d=0;d<256;d++){let v=d*.00392156862745098,y=Je(u.palette,v),g=Je(f.palette,v),W=y.r*(1-l)+g.r*l,T=y.g*(1-l)+g.g*l,N=y.b*(1-l)+g.b*l;rt.paletteRGBA[d*4+0]=W,rt.paletteRGBA[d*4+1]=T,rt.paletteRGBA[d*4+2]=N,rt.paletteRGBA[d*4+3]=1}let p=3,_=0;for(let d=0;d<256;d++){let v=rt.paletteRGBA[d*4+0]*jt,y=rt.paletteRGBA[d*4+1]*jt,g=rt.paletteRGBA[d*4+2]*jt;v=Math.min(v,p),y=Math.min(y,p),g=Math.min(g,p),rt.paletteRGBA[d*4+0]=v,rt.paletteRGBA[d*4+1]=y,rt.paletteRGBA[d*4+2]=g,rt.paletteRGBA[d*4+3]=1,_=Math.max(Math.max(v,y),Math.max(g,_))}if(!ue||!te||Be)for(let d=0;d<256;d++){let v=d*.00392156862745098,y=rt.paletteRGBA[d*4+0],g=rt.paletteRGBA[d*4+1],W=rt.paletteRGBA[d*4+2],T=rs(v,y,g,W,_,e0);rt.paletteRGBA[d*4+0]=T[0],rt.paletteRGBA[d*4+1]=T[1],rt.paletteRGBA[d*4+2]=T[2]}fe.uploadPaletteRGBA8UNorm(rt.paletteRGBA),vs=rt.paletteRGBA}pt&&ot.songHasEnded()&&cr(),ot.isPrevSongRequested()&&Fs(),ot.isNextSongRequested()&&cr();let M=ot.getFrame({waveScale:_e,wantWave:!0,wantSpec:!0,bandsHz:Ae});for(let l=0;l<c0;l++)De[l]=Math.max(wr,M.bandEnergy[l]);Qo(Ot,x),ar+=x;let F=Ho.update(Ot,Re,De[Ms],he[ks][Ms],De[ir],he[ks][ir]),A=!1;if(Ot>50&&F.beat&&(ar=0,A=!0),$e>0){let l=4,u=4;if(Y.clearRect(0,0,Ht.width,Ht.height),$e>=2)for(let _=0;_<3;_++){Y.beginPath(),Y.globalAlpha=1,Y.strokeStyle=bs[_];let S=Ae[3].f0,d=Ae[3].f1,v=Math.log(S)/Math.log(10),y=Math.log(d)/Math.log(10),g=400,W=22500;for(let T=0;T<g;T++){let N=T*(1/(g-1)),E=Math.pow(10,v+(y-v)*N);if(E>=Ae[_].f0&&E<=Ae[_].f1){let $=Math.max(0,Math.min(M.spectrum.length-1,E*(1/W)*M.spectrum.length|0));Y.moveTo(T,Ht.height-4-1-M.spectrum[$]*(15/he[0][ir])),Y.lineTo(T,Ht.height-4)}}Y.stroke(),Y.globalAlpha=1}let f=.92;if($e>=2){let _=Math.max(Ht.width,Ht.height)/26|0,S=.1*_;for(let d=0;d<c0;d++){let v=_*(2+d*2),y=v-_,g=v+_,W=0;Y.fillStyle=`rgba(${W}, ${W}, ${W}, ${f})`,Y.fillRect(0,y,_*(d0*2+1),g-y),u=Math.max(g,u)+4,Y.globalAlpha=1;for(let T=0;T<d0;T++){let E=De[d]/he[T][d]*S,$=_*2*(T+1);Yo($,v,E,bs[d],1)}Y.font="14px sans-serif",Y.fillStyle="white",Y.textAlign="left",Y.textBaseline="top",Y.fillText(Ae[d].name,4,y+4)}}Y.font="18px sans-serif",Y.fillStyle="white",Y.textAlign="left",Y.textBaseline="top",ar<.05&&Y.fillText("BEAT!",4,4);let p=rt.GetMotionDebugInfo(i0);p.push(an()),Y.font="14px Menlo",Y.fillStyle="white",Y.textAlign="left",Y.textBaseline="top";for(let _=0;_<p.length;_++){let S=p[_],v=Y.measureText(S).width,y=20,g=2;Y.fillStyle=`rgba(0,0,0,${f})`,Y.fillRect(l,u,v+g*2,y+g*2),Y.fillStyle="white",Y.fillText(S,l+g,u+g),u+=y+g*2}}rt.update(x,M),rt.render(Kt,i0,dr,gs,Ot,_r,fr,Re,ye,ge,Oo,A,Nt,le,e0,Le,It,we,hr,ur,pr,xr,"this_is_the_last_param"),_r=!1,fr=!1,hr=!1,ur=!1,pr=!1,xr=!1,Le="";let R=0;ke&&(R=xt.palette.length/4),fe.draw(R);let P="",D=gr();if(Bt&&Se&&D.license_text!=""?(ls.textContent=D.license_prefix,F0.textContent=D.license_text,F0.href=D.license_link,cs.textContent=D.license_suffix,as.style.display=""):(ls.textContent="",F0.textContent="",F0.href="",cs.textContent="",as.style.display="none"),pt&&(Bt||Lt)&&(P.length>0&&(P+=`
`),Bt?Lt?P+=D.song_name+`
`+Ns():P+=D.song_name:Lt&&(P+=Ns())),ze||(P+="*** Showing original palette.  Hit CTRL+V or ESC to go back. ***"),Ge){P.length>0&&(P+=`

`),P+=e,pt&&(P+=r),P+=o,pt&&(P+=i);let l=`${Tt}Locked${lt}`,u=`${de}Unlocked${lt}`;P+=`
  ${de}
  ${Tt}            random:   [un]lock:${lt}
  ${Tt}all 3:   ${lt}   SPACE     L
  ${Tt}motion:  ${lt}   m         M      ${Ut?l:u}
  ${Tt}palette: ${lt}   p         P      ${wt?l:u}
  ${Tt}waveform:${lt}   w         W      ${Dt?l:u}${lt}`,P+=`

${Tt}Info:${lt}
`,P+=de,P+=`  Version:     Geiss HDR v${"302"}
`,P+=`  Window res:  ${Yt}x${ee} (${ue&&te&&!Be?"HDR":"SDR"})
`;let f="";st>=1.001&&(f=` (${st.toFixed(0)}x)`),st<=.999&&(f=` (${st.toFixed(2)}x)`),P+=`  Buffer res:  ${Qt}x${Jt}${f}
`,P+=`  Repaint hz:  ${me.toFixed(1)}
`,P+=`  Render hz:   ${Re.toFixed(1)}  (Target: ${pe|0})
`;let p=100-Math.min(100,Math.round(Re*nr*100)|0);P+=`  Idle time:   ${p}%${lt}`}let h=[];for(let l=0;l<Xt.length;l++)Kt<Xt[l].end_time&&(P.length>0&&(P+=`

`),P+=Xt[l].message,h.push(Xt[l]));Xt=h;let m=P.trim().length===0;Co.style.display=m?"none":"block",Ne.textContent=P,Ne.innerHTML=P,Ne.style.fontSize="12px",Ot++;let B=performance.now()*.001-n;R0[or]=B,or=(or+1)%R0.length;let V=0,H=0;for(let l=0;l<Math.min(R0.length,Ot);l++)V+=R0[l],H++;nr=V/H}function c(n){if(!a0){requestAnimationFrame(c);return}if(window.GeissAmpConfig&&!window.GeissAmpConfig.active){t0=-1,requestAnimationFrame(c);return}{let F=n*.001;if(t0<0)t0=F;else{let A=F-t0;t0=F,A<.1&&(ys++,N0[rr]=A,rr=(rr+1)%N0.length);let R=0,P=0;for(let D=0;D<Math.min(N0.length,ys);D++)R+=N0[D],P++;me=1/(R/P)}}let x=performance.now()*.001;a();let w=performance.now()*.001-x,M=1/nr;if(Ot>50&&me!=0&&me<pe*.65&&M>me*2.5){let F=Math.min(10,Math.round(pe/me-.25));if(F>1){let A=1/(me*F);for(let R=1;R<F;R++){let D=x+R*A-performance.now()*.001;D>0&&fn(D*1e3),a()}}}requestAnimationFrame(c)}requestAnimationFrame(c)}Wo.addEventListener("click",async()=>{f0(0)});No.addEventListener("click",async()=>{f0(1)});Ro.addEventListener("click",async()=>{f0(2)});is?.addEventListener("click",async()=>{f0(3)});$o.addEventListener("click",async()=>{f0(4)});window.GeissAmpConfig&&(window.GeissAmpConfig.start=async()=>{window.GeissAmpConfig.allowHdr&&(te=!0,Be=!(ue&&te)),kr();let{ctx:s,srcNode:t}=window.GeissAmpConfig.getAudio();return ot.startExternal(s,t),a0=!0,await h0(),!0},window.GeissAmpConfig.randomize=()=>br(),window.GeissAmpConfig.setTrackTitle=s=>{n0=String(s||""),o0&&n0&&(Le=n0)});})();
