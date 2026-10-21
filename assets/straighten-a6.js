/* Perspective alignment of the original photograph; no regenerated pixels. */
(()=>{const h=[0.9559672935372894, -0.019219351141729506, 10.094234984605864, -0.019981369734086617, 0.8996748608028863, 29.12794095274311, -2.284038562272857e-05, -5.665295186901344e-05, 1];
function align(img){const s=img.offsetWidth/1080;if(!s)return;const m=[h[0],h[3],0,h[6]/s,h[1],h[4],0,h[7]/s,0,0,1,0,h[2]*s,h[5]*s,0,1];img.style.transformOrigin='0 0';img.style.transform='matrix3d('+m.join(',')+')';}
function init(){document.querySelectorAll('img[src="assets/custom-a6-original.webp"]').forEach(img=>{align(img);img.addEventListener('load',()=>align(img));new ResizeObserver(()=>align(img)).observe(img);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();
