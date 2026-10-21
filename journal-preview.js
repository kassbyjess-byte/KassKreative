/* Live journal illustration. No requests or generated images are needed. */
(function(global){
'use strict';
const leatherColours={Anthracite:'#49464a',Burgundy:'#681f38',Emerald:'#28684f',Rust:'#a65034',Sky:'#7598ac',Tiffany:'#65b5b1',Charcoal:'#363537',Coffee:'#49352b',Olive:'#687147',Aubergine:'#352032',Chocolate:'#4b3028',Forest:'#173c32',Onyx:'#242329',Scarlett:'#aa2830',Cognac:'#bb8959'};
const cordColours={'Baby Pink':'#e6b4c4','Baby Blue':'#97cbdc',White:'#f4f0e8',Black:'#252526',Gray:'#9b999c','Forest Green':'#355747',Forest:'#355747','Dark Blue':'#293d64',Burgundy:'#782e46',Red:'#cb3b3f',Lilac:'#baa4d0',Yellow:'#e8c967',Cream:'#eee5cd',Pink:'#e6b4c4',Blue:'#97cbdc',Grey:'#9b999c',Gold:'#c4a16a',Silver:'#c2c6ca'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function colour(value,fallback){const v=String(value||'').trim();if(/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v))return v;const key=Object.keys(cordColours).find(k=>k.toLowerCase()===v.toLowerCase());return key?cordColours[key]:fallback;}
function journalIllustration(d){
const small=d.size==='A6',base=leatherColours[d.leather]||leatherColours.Chocolate,cord=colour(d.elastic,'#e6b4c4'),metal=d.eyelet==='Silver'?'url(#jp-silver)':'url(#jp-gold)';
const shape='M56 40 H196 Q206 40 206 50 V306 Q206 316 196 316 H56 Q48 316 48 308 V48 Q48 40 56 40 Z';
const ring=(x,y,r=4.2)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${metal}" stroke="#342b23" stroke-opacity=".5" stroke-width=".7"/><circle cx="${x}" cy="${y}" r="${r*.45}" fill="#25211f"/>`;
const cols=small?[282,299]:[275,291,307];
const eyelets=[74,98,258,282].map(y=>cols.map(x=>ring(x,y)).join('')).join('')+ring(291,178,4.6);
const strings=[74,258].map(y=>cols.map(x=>`<path d="M${x} ${y}v24"/>`).join('')).join('');
const src=d.surface&&/^assets\/leathers\/[a-z-]+\.(?:png|webp)$/.test(d.surface)?d.surface:null;
const fill=src?'url(#jp-leather)':base;
const custom=d.custom?(d.customizations||[]):[];
const get=type=>custom.find(c=>c.type===type)?.details;
let details='',spineDetails='',frontDetails='';
if(get('wavy')){
 const wave='M126 40 C45 75 57 117 102 157 C173 218 150 260 48 316 H196 Q206 316 206 306 V50 Q206 40 196 40 Z';
 frontDetails=`<path d="${wave}" fill="${fill}" stroke="#211b17" stroke-opacity=".55" stroke-width="1.2"/><path d="${wave}" fill="url(#jp-shade)"/>`;
 frontDetails+=[[127,49],[88,80],[86,131],[121,181],[143,223],[122,273],[72,305]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4.5" fill="${metal}" stroke="#55483c" stroke-width=".5"/>`).join('');
}
for(const type of ['embroidery','stipple']){
 const c=get(type);if(!c)continue;
 const letter=String(c[type+'-initial']||'').slice(0,1).toUpperCase();
 const place=String(c[type+'-placement']||'bottom right').toLowerCase();
 const x=place.includes('left')?82:place.includes('middle')||place.includes('center')||place.includes('centre')?128:170;
 const y=place.includes('top')?106:place.includes('middle')||place.includes('center')||place.includes('centre')?162:282;
 const ink=type==='embroidery'?colour(c['embroidery-colour'],'#eee5cd'):'#b9a18a';
 details+=`<text data-custom-preview="${type}" x="${x}" y="${y}" text-anchor="middle" font-family="cursive" font-style="italic" font-size="49" fill="none" stroke="${ink}" stroke-width="${type==='embroidery'?1.7:1.2}" stroke-dasharray="${type==='embroidery'?'2.5 1.5':'.1 2'}" stroke-linecap="round">${esc(letter)}</text>`;
}
const lace=get('lace');
if(lace){
 const lc=colour(lace['lace-colour'],'#a5dce6'),isLace=lace['lace-material']==='Lace';
 const ys=[53,88,123,158,193,228,263,298];
 spineDetails=ys.map(y=>ring(274,y,3.5)+ring(307,y,3.5)).join('');
 const paths=ys.slice(0,-1).map((y,i)=>`M274 ${y} C277 ${y+12} 304 ${ys[i+1]-10} 307 ${ys[i+1]} M307 ${y} C304 ${y+12} 277 ${ys[i+1]-10} 274 ${ys[i+1]}`).join(' ');
 spineDetails+=`<g data-custom-preview="lace" fill="none" stroke="${lc}" stroke-width="${isLace?7:6}" stroke-linejoin="round"><path d="M274 53 H307 ${paths}"/>${isLace?`<path d="${paths}" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-dasharray="1 3"/>`:''}<path d="M290 301 C259 282 260 322 290 304 C326 280 329 325 290 304 M289 306 Q281 324 280 333 M293 306 Q303 323 310 330" stroke-width="4"/></g>`;
}

if(d.embossed)details+=`<text x="189" y="299" text-anchor="end" font-family="Georgia,serif" font-size="12" letter-spacing="2" fill="#e1cdb1" fill-opacity=".5" stroke="#201713" stroke-opacity=".4" stroke-width=".4">${esc(String(d.embossed).slice(0,4).toUpperCase())}</text>`;
return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360" role="img" aria-label="${esc(d.size+' '+d.leather+' journal with '+d.elastic+' elastic and '+d.eyelet+' eyelets')}" data-size="${esc(d.size)}"><defs><linearGradient id="jp-gold"><stop stop-color="#f4deb0"/><stop offset=".45" stop-color="#c6a16a"/><stop offset="1" stop-color="#85653e"/></linearGradient><linearGradient id="jp-silver"><stop stop-color="#f4f5f6"/><stop offset=".5" stop-color="#b5bbc0"/><stop offset="1" stop-color="#777d82"/></linearGradient><linearGradient id="jp-shade"><stop stop-color="#000" stop-opacity=".28"/><stop offset=".3" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".15"/></linearGradient><linearGradient id="jp-spine-shade"><stop stop-color="#000" stop-opacity=".27"/><stop offset=".22" stop-color="#fff" stop-opacity=".1"/><stop offset=".72" stop-color="#000" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient><clipPath id="jp-front"><path d="${shape}"/></clipPath>${src?`<pattern id="jp-leather" width="360" height="360" patternUnits="userSpaceOnUse"><image href="${esc(src)}" width="360" height="360" preserveAspectRatio="xMidYMid slice"/></pattern>`:''}</defs><g transform="${small?'translate(25 26) scale(.85)':'translate(0 0)'}"><path d="${shape}" fill="${fill}"/><g clip-path="url(#jp-front)"><rect x="48" y="40" width="158" height="276" fill="url(#jp-shade)"/><path d="M71 42v272" stroke="#000" stroke-opacity=".1"/></g><g data-view="spine"><rect x="267" y="40" width="48" height="276" rx="5" fill="${fill}"/><rect x="267" y="40" width="48" height="276" rx="5" fill="url(#jp-spine-shade)"/></g>${lace?spineDetails:eyelets}${frontDetails}<g fill="none" stroke="${cord}" stroke-width="2.8" stroke-linecap="round">${lace?'':strings}<path d="M44 178 H210 ${lace?'':'M263 178 H319'}"/></g>${details}</g><g fill="#80756d" font-family="Arial,sans-serif" font-size="9" letter-spacing="2"><text x="127" y="344" text-anchor="middle">FRONT</text><text x="291" y="344" text-anchor="middle">SPINE</text></g></svg>`;
}
global.KassJournalPreview={render:journalIllustration,colours:leatherColours};
})(typeof window==='undefined'?globalThis:window);
