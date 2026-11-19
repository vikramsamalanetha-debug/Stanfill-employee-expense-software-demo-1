/* Rightway Auto Recycling: counter invoicing (demo). Everything is saved in this browser only. */
(function(){
"use strict";
const KEY="rightway-demo-v1";
const $=s=>document.querySelector(s);
const money=n=>(Math.round((Number(n)||0)*100)/100).toLocaleString("en-US",{style:"currency",currency:"USD"});
const r2=n=>Math.round((Number(n)||0)*100)/100;
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const today=()=>ymd(new Date());
const niceDate=s=>{ if(!s) return ""; const d=new Date(s.length<=10?s+"T12:00":s); return (d.getMonth()+1)+"-"+d.getDate()+"-"+String(d.getFullYear()).slice(2); };
const longDate=s=>{ const d=new Date(s.length<=10?s+"T12:00":s); return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}); };
const addDays=(s,n)=>{ const d=new Date(s+"T12:00"); d.setDate(d.getDate()+n); return ymd(d); };
const daysBetween=(a,b)=>Math.round((new Date(b+"T12:00")-new Date(a+"T12:00"))/864e5);
const normPhone=p=>String(p||"").replace(/\D/g,"").slice(-10);
const fmtPhone=p=>{ const d=normPhone(p); return d.length===10?d.slice(0,3)+"-"+d.slice(3,6)+"-"+d.slice(6):String(p||""); };

function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null||v===false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2),v);
    else if (k==="class") e.className=v;
    else if (k==="html") e.innerHTML=v;
    else if (k in e && k!=="list" && k!=="type") { try{ e[k]=v; }catch(_){ e.setAttribute(k,v); } }
    else e.setAttribute(k,v===true?"":v);
  }
  for (const k of kids.flat(9)) if (k!=null&&k!==false) e.append(k.nodeType?k:String(k));
  return e;
}
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("on"),2600); }

// "john smith" → "John Smith" while typing, without moving the cursor.
const nameCase=v=>String(v||"").replace(/[A-Za-z][A-Za-z']*/g,w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());
function nameCaseInput(x){ const v=nameCase(x.value); if (v!==x.value){ const a=x.selectionStart,b=x.selectionEnd; x.value=v; try{ x.setSelectionRange(a,b); }catch(e){} } }
/* ---------- data ---------- */
const BIZ={name:"Rightway Auto Recycling",addr:"7945 TN-100",city:"Decaturville, TN 38329",phone:"731-549-3179"};
let DB;
function seed(){
  const t=today();
  const P=n=>{ const p=PRICE_LIST.find(x=>x[0]===n); return {name:n,price:p[1],qty:1,core:p[2],coreCharged:p[2]>0}; };
  const inv=(no,date,soldTo,phone,soldBy,pay,lines)=>({no,date,soldTo,phone,address:"",soldBy,pay,taxRate:9.75,lines,returns:[],creditUsed:0,createdAt:date+"T10:15"});
  const a=P("Alternator"), b=P("Battery"); b.coreCharged=false;
  const s=P("Starter");
  const c=P("Instrument Cluster"), d=P("Dash Pad"), e=P("Radio Bezel"); e.qty=2;
  const tr=P("Transmission - FWD/AWD");
  // Sample history: about two months of counter sales, popular parts sell more often.
  let r=7; const rnd=()=>{ r=(r*16807)%2147483647; return (r-1)/2147483646; };
  const popular=["Alternator","Starter","Battery","Headlight Assembly","Tail Light Assy","Door Mirror - Power","Wheel - Aluminum","Tires","Radiator","A/C Compressor","Door - Car","Bumper Cover","Window Regulator W/ Motor","Brake Caliper","Fuel Pump (Electric)","Radio W/ BT","Seat Belt - Male W/ Tensioner","Hood","Instrument Cluster","Power Steering Pump"];
  const names=["Customer","Customer","Customer","Ray Wilson","Kim Tate","Bo Hughes","Lisa Greer","Customer","Dale Moss","Customer"];
  const hist=[]; let no=800;
  for (let day=60; day>=1; day--){ const n=Math.floor(rnd()*4)+(day%7===0?0:1);
    for (let k=0;k<n;k++){ const lines=[]; const cnt=1+Math.floor(rnd()*2.2);
      for (let j=0;j<cnt;j++){ const nm=popular[Math.floor(Math.pow(rnd(),1.8)*popular.length)]; const x=P(nm); if (rnd()<0.4) x.coreCharged=false; if (/Tires|Wheel/.test(nm)&&rnd()<0.5) x.qty=2+Math.floor(rnd()*3); lines.push(x); }
      const pay=["cash","cash","card","check"][Math.floor(rnd()*4)];
      hist.push({...inv(no++,addDays(t,-day),names[Math.floor(rnd()*names.length)],"","Mike",pay,lines),cardFee:pay==="card"?3:0}); } }
  hist.forEach(i=>i.lines.forEach((l,idx)=>{ if (l.coreCharged&&rnd()<0.7) i.returns.push({idx,name:l.name,kind:"core",qty:0,coreQty:l.qty,how:"refund",amount:r2(l.core*l.qty*1.0975),at:addDays(i.date,2)}); }));
  return {seq:1005, settings:{taxRate:9.75,warrantyDays:30,staff:["Mike","Dana"]},
    prices:null, credits:{},
    invoices:[
      {...inv(1001,addDays(t,-40),"Tommy Ray","7315550142","Mike","cash",[tr]),returns:[{idx:0,name:tr.name,kind:"core",qty:0,coreQty:1,how:"refund",amount:r2(50*1.0975),at:addDays(t,-38)}]},
      inv(1002,addDays(t,-12),"Carla Jones","7315550188","Dana","card",[s]),
      inv(1003,addDays(t,-5),"Customer","","Mike","cash",[c,d,e]),
      inv(1004,t,"John Carter","7315550101","Dana","cash",[a,b]),
      ...hist
    ]};
}
function load(){ try{ DB=JSON.parse(localStorage.getItem(KEY)); }catch(e){ DB=null; } if(!DB||!DB.invoices) DB=seed();
  if (DB.prices && !DB.prices.some(x=>/^entry$/i.test(x.name))) DB.prices.unshift({name:"Entry",price:2,core:0,note:"",notax:true});
  DB.invoices.forEach(inv=>{ inv.returns=(inv.returns||[]).map(r=>r.kind?r:{...r,kind:"part",how:r.type==="exchange"?"exchange":"credit",coreQty:0});
    inv.lines.forEach((l,idx)=>{ if(l.coreReturnedAt){ inv.returns.push({idx,name:l.name,kind:"core",qty:0,coreQty:l.qty,how:l.coreRefundHow==="credit"?"credit":"refund",amount:l.coreRefund||0,at:l.coreReturnedAt}); delete l.coreReturnedAt; } }); }); }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(DB)); }catch(e){ toast("Couldn't save on this computer."); } }
const ELEC=/\b(ecm|bcm|bmc|tcm|pcm)\b|computer|module|brain box|radio|cd changer|amplifier|subwoofer|navigation|video screen|camera|sensor|cluster|gauges|tachometer|speedo|ballast|ignitor|immobilizer|key fob|keyless|alarm|relay|voltage regulator|clock spring|cruise control box/i;
const isElec=p=>p.elec!=null?!!p.elec:ELEC.test(p.name||"");
const prices=()=>DB.prices||PRICE_LIST.map(p=>({name:p[0],price:p[1],core:p[2],note:p[3]||""}));
function setPrices(list){ DB.prices=list; save(); }

/* ---------- totals ---------- */
function invTotals(inv){
  const rate=(inv.taxRate??DB.settings.taxRate)/100;
  let parts=0,cores=0;
  let labor=0;
  let notax=0;
  inv.lines.forEach(l=>{ if (l.labor){ labor+=l.price*l.qty; return; } parts+=l.price*l.qty; if (l.notax) notax+=l.price*l.qty; if(l.coreCharged) cores+=l.core*l.qty; });
  parts=r2(parts); cores=r2(cores); labor=r2(labor);
  const sub=r2(parts+cores+labor), tax=inv.taxExempt?0:r2((parts+cores-notax)*rate), total=r2(sub+tax), credit=r2(inv.creditUsed||0);
  // Paying by credit card adds a card fee (3%) on what goes on the card: total after tax and store credit.
  const before=r2(Math.max(0,total-credit)), feePct=inv.pay==="card"?Number(inv.cardFee)||0:0, fee=r2(before*feePct/100);
  return {parts,cores,labor,sub,tax,total,credit,fee,feePct,due:r2(before+fee),rate};
}
const cardFeePct=()=>DB.settings.cardFee??3;
// How many cores are still out on a line, and how many of the parts have come back (refund or credit; an exchange keeps the sale).
const coreOwedQty=(inv,idx)=>{ const l=inv.lines[idx]; if(!(l.coreCharged&&l.core>0)) return 0; return Math.max(0,l.qty-(inv.returns||[]).filter(r=>r.idx===idx).reduce((n,r)=>n+(r.coreQty||0),0)); };
const partBackQty=(inv,idx)=>(inv.returns||[]).filter(r=>r.idx===idx&&r.kind==="part"&&r.how!=="exchange").reduce((n,r)=>n+r.qty,0);
const coresOwed=inv=>inv.lines.map((l,idx)=>({l,idx,n:coreOwedQty(inv,idx)})).filter(x=>x.n>0);
const withTax=(amt,inv,l)=>inv.taxExempt||(l&&(l.notax||l.labor))?r2(amt):r2(amt*(1+(inv.taxRate??DB.settings.taxRate)/100));
const custKey=(name,phone)=>normPhone(phone)||String(name||"").trim().toLowerCase();
const creditFor=(name,phone)=>{ const k=custKey(name,phone); return k&&DB.credits[k]?r2(DB.credits[k].amount):0; };
function addCredit(name,phone,amt){ const k=custKey(name,phone); if(!k) return; const c=DB.credits[k]||{name,phone,amount:0}; c.amount=r2(c.amount+amt); c.name=name||c.name; DB.credits[k]=c; }

/* Warranty: 30 days, exchange or store credit, no refunds. Computer modules aren't covered; glass is void if broken. */
function warranty(inv,line){
  const n=line.name.toLowerCase(), days=DB.settings.warrantyDays, ends=addDays(inv.date.slice(0,10),days), left=daysBetween(today(),ends);
  if (line.labor) return {ok:false,why:"Labor isn't refundable.",ends};
  if (/^entry$/i.test(line.name)) return {ok:false,why:"Entry fee isn't refundable.",ends};
  if (line.elec||(line.elec==null&&ELEC.test(n))) return {ok:false,why:"Electronic part: not returnable.",ends};
  if (left<0) return {ok:false,why:"Warranty ended "+longDate(ends)+".",ends};
  return {ok:true,left,ends,glass:/glass|windshield/.test(n)};
}

/* ---------- part search: "eng" -> Engine..., "ac comp" -> A/C Compressor ---------- */
const SYN={"a/c":"ac air conditioning","w/":"with","w/o":"without","assy":"assembly","transm":"transmission","trans":"transmission","cyl":"cylinder","p/u":"pickup truck","bt":"bluetooth","4x4":"4wd","4wd":"4x4","ecm":"computer","tcm":"computer","pcm":"computer"};
let INDEX=[];
function buildIndex(){
  INDEX=prices().map(p=>{
    let t=p.name.toLowerCase();
    let extra=[]; for (const [k,v] of Object.entries(SYN)) if (t.includes(k)) extra.push(v);
    const words=(t+" "+extra.join(" ")).replace(/[^a-z0-9]+/g," ").trim().split(" ");
    return {p,words,low:t};
  });
}
function searchParts(q){
  q=q.toLowerCase().trim(); if(!q) return [];
  const toks=q.replace(/a\/c/g,"ac").replace(/[^a-z0-9]+/g," ").trim().split(" ").filter(Boolean);
  if(!toks.length) return [];
  const out=[];
  for (const it of INDEX){
    if (!toks.every(t=>it.words.some(w=>w.startsWith(t)))) continue;
    const first=it.words[0];
    const score=(it.low.startsWith(q)?0:first.startsWith(toks[0])?1:2)+it.low.length/1000;
    out.push([score,it.p]);
  }
  return out.sort((a,b)=>a[0]-b[0]).slice(0,8).map(x=>x[1]);
}

/* ---------- views ---------- */
let TAB="sale";
const tabs=[["sale","New Sale"],["find","Find Invoice"],["today","Sales"],["prices","Price List"]];
function render(){
  $("#tabs").replaceChildren(...tabs.map(([id,l])=>h("button",{type:"button",class:"tab"+(TAB===id?" on":""),onclick:()=>go(id,{open:null,retInv:null})},l)));
  const v=$("#view"); v.replaceChildren();
  ({sale:viewSale,find:viewFind,returns:viewReturns,today:viewToday,prices:viewPrices}[TAB])(v);
}
function go(id,opts){ TAB=id; Object.assign(STATE,opts||{}); render(); window.scrollTo(0,0); }
const STATE={open:null,retInv:null,findQ:"",retQ:""};

/* ===== New sale: looks like the paper invoice ===== */
let SALE=null;
function newSale(){ SALE={soldTo:"",phone:"",address:"",soldBy:DB.settings.lastSoldBy||"",pay:"cash",checkNo:"",lines:[],creditUsed:0}; }
function viewSale(v){
  if(!SALE) newSale();
  const s=SALE;
  const top=h("div",{class:"paper"},
    h("div",{class:"ptop"},
      h("div",{class:"biz"},h("b",{},BIZ.name),h("span",{},BIZ.addr+" | "+BIZ.city),h("span",{},BIZ.phone)),
      h("div",{class:"invno"},h("span",{class:"lbl"},"INVOICE"),h("b",{},"#"+DB.seq),h("span",{},"Date "+niceDate(today())))),
    h("div",{class:"grid2"},
      field("Sold to","soldTo",{placeholder:"Customer name",autocomplete:"off",autocapitalize:"words"}),
      field("Customer phone","phone",{type:"tel",placeholder:"731-555-0100",autocomplete:"off"}),
      field("Address (optional)","address",{placeholder:"Street, city",autocomplete:"off"}),
      h("label",{class:"f"},"Sold by",h("input",{value:s.soldBy,list:"staff",placeholder:"Your name",autocomplete:"off",oninput:e=>{ s.soldBy=e.target.value; }}),
        h("datalist",{id:"staff"},DB.settings.staff.map(n=>h("option",{value:n}))))));
  const credit=creditFor(s.soldTo,s.phone);
  const creditBox=h("div",{id:"creditBox"});
  const drawCredit=()=>{ const c=creditFor(s.soldTo,s.phone); creditBox.replaceChildren();
    if (c>0) creditBox.append(h("div",{class:"note good"},"This customer has ",h("b",{},money(c))," in store credit. ",
      s.creditUsed?h("button",{type:"button",class:"btn small",onclick:()=>{ s.creditUsed=0; drawTotals(); drawCredit(); }},"Don't use it")
        :h("button",{type:"button",class:"btn small primary",onclick:()=>{ s.creditUsed=Math.min(c,invTotals({...s,taxRate:DB.settings.taxRate,creditUsed:0}).total); drawTotals(); drawCredit(); }},"Use it on this sale"))); };
  void credit;

  const body=h("div",{class:"lines"});
  const head=h("div",{class:"lrow lhead"},h("span",{class:"c-desc"},"Description"),h("span",{class:"c-core"},"Core"),h("span",{class:"c-price"},"Price"),h("span",{class:"c-qty"},"Unit"),h("span",{class:"c-amt"},"Amount"),h("span",{class:"c-x"}));
  const totals=h("div",{class:"totals"});
  const drawTotals=()=>{
    const t=invTotals({...s,taxRate:DB.settings.taxRate,cardFee:cardFeePct()});
    totals.replaceChildren(...[
      trow("Parts",money(t.parts)),
      t.cores?trow("Core charges",money(t.cores),"corecharge"):null,
      t.labor?trow("Labor (no tax)",money(t.labor)):null,
      trow("Sub-total",money(t.sub)),
      s.taxExempt?trow("Tax exempt",money(0),"good"):trow("Tax ("+DB.settings.taxRate+"%)",money(t.tax)),
      t.credit?trow("Store credit used","−"+money(t.credit),"good"):null,
      t.fee?trow("Card fee ("+t.feePct+"%)",money(t.fee),"corecharge"):null,
      trow("Total",money(t.due),"big")].filter(Boolean));
  };
  const drawLines=(focusNew)=>{
    body.replaceChildren(head,...s.lines.map((l,i)=>lineRow(l,i)),newRow());
    drawTotals();
    if (focusNew){ const n=body.querySelector(".newrow input"); if(n) n.focus(); }
  };
  function lineRow(l,i){
    const amt=h("span",{class:"c-amt num"},money(l.price*l.qty+(l.coreCharged?l.core*l.qty:0)));
    const upd=()=>{ amt.textContent=money(l.price*l.qty+(l.coreCharged?l.core*l.qty:0)); drawTotals(); };
    return h("div",{class:"lrow"},
      h("span",{class:"c-desc"},h("input",{value:l.name,"aria-label":"Description",oninput:e=>{ l.name=e.target.value; }}),
        l.note?h("small",{class:"warn"},l.note):null,
        l.labor?h("small",{class:"muted"},"Labor: no tax"):l.notax?h("small",{class:"muted"},"No tax"):null),
      h("span",{class:"c-core"},l.core>0?h("label",{class:"core"+(l.coreCharged?" on":""),title:"Tick when the customer did NOT bring the old part back"},
        h("input",{type:"checkbox",checked:l.coreCharged,onchange:e=>{ l.coreCharged=e.target.checked; e.target.parentNode.classList.toggle("on",l.coreCharged); upd(); }}),
        h("span",{},"Core "+money(l.core))):h("span",{class:"muted"},"—")),
      h("span",{class:"c-price"},h("input",{type:"number",min:"0",step:"0.01",inputmode:"decimal",value:l.price,"aria-label":"Price",oninput:e=>{ l.price=Number(e.target.value)||0; upd(); }})),
      h("span",{class:"c-qty"},h("input",{type:"number",min:"1",step:"1",inputmode:"numeric",value:l.qty,"aria-label":"Unit",oninput:e=>{ l.qty=Math.max(1,parseInt(e.target.value)||1); upd(); }})),
      amt,
      h("span",{class:"c-x"},h("button",{type:"button",class:"x","aria-label":"Remove "+l.name,onclick:()=>{ s.lines.splice(i,1); drawLines(); }},"×")));
  }
  function newRow(){
    const inp=h("input",{placeholder:s.lines.length?"Type the next part…":"Type a part, like \"alt\" or \"eng\"",autocomplete:"off","aria-label":"Add a part"});
    const box=h("div",{class:"sugg",hidden:true});
    let items=[],sel=0;
    const pick=p=>{ if(!p) return;
      s.lines.push({name:p.name,price:p.price,qty:1,core:p.core||0,coreCharged:(p.core||0)>0,note:p.note||"",elec:isElec(p),notax:!!p.notax||/^entry$/i.test(p.name)});
      drawLines(true); };
    const custom=()=>{ const n=inp.value.trim(); if(!n) return; s.lines.push({name:n,price:0,qty:1,core:0,coreCharged:false}); drawLines(); const pr=body.querySelectorAll(".lrow:not(.lhead):not(.newrow) .c-price input"); const last=pr[pr.length-1]; if(last){ last.focus(); last.select(); } };
    const draw=()=>{ items=searchParts(inp.value); sel=0; box.replaceChildren();
      if(!inp.value.trim()){ box.hidden=true; return; }
      items.forEach((p,i)=>box.append(h("button",{type:"button",class:"opt"+(i===sel?" on":""),onmousedown:e=>{ e.preventDefault(); pick(p); }},
        h("span",{class:"on"},p.name),h("span",{class:"pp"},p.price?money(p.price):"see sales",p.core?h("em",{},"+ core "+money(p.core)):null))));
      box.append(h("button",{type:"button",class:"opt add",onmousedown:e=>{ e.preventDefault(); custom(); }},"+ Add “"+inp.value.trim()+"” (type the price)"));
      box.hidden=false; };
    const hi=()=>[...box.querySelectorAll(".opt")].forEach((o,i)=>o.classList.toggle("on",i===sel));
    inp.addEventListener("input",draw);
    inp.addEventListener("keydown",e=>{
      if (e.key==="ArrowDown"){ e.preventDefault(); sel=Math.min(sel+1,items.length); hi(); }
      else if (e.key==="ArrowUp"){ e.preventDefault(); sel=Math.max(0,sel-1); hi(); }
      else if (e.key==="Enter"){ e.preventDefault(); if (sel<items.length && items[sel]) pick(items[sel]); else custom(); }
      else if (e.key==="Escape"){ box.hidden=true; }
    });
    inp.addEventListener("blur",()=>setTimeout(()=>{ box.hidden=true; },150));
    const labor=h("button",{type:"button",class:"btn small ghost addlabor",onclick:()=>{ s.lines.push({name:"Labor: pulling the part",price:0,qty:1,core:0,coreCharged:false,labor:true}); drawLines(); const pr=body.querySelectorAll(".lrow:not(.lhead):not(.newrow) .c-price input"); const last=pr[pr.length-1]; if(last){ last.focus(); last.select(); } }},"+ Labor (we pull it)");
    const entry=h("button",{type:"button",class:"btn small ghost addentry",onclick:()=>{ const e=prices().find(x=>/^entry$/i.test(x.name))||{name:"Entry",price:2}; s.lines.push({name:"Entry",price:e.price,qty:1,core:0,coreCharged:false,notax:true}); drawLines(true); }},"+ Entry $"+((prices().find(x=>/^entry$/i.test(x.name))||{price:2}).price));
    return h("div",{class:"lrow newrow"},h("span",{class:"c-desc wide"},inp,box),h("span",{class:"quick"},entry,labor));
  }
  const pays=h("div",{class:"pays"},["cash","check","card"].map(p=>h("button",{type:"button",class:"pay"+(s.pay===p?" on":""),onclick:e=>{ s.pay=p; pays.querySelectorAll(".pay").forEach(b=>b.classList.toggle("on",b===e.currentTarget)); chk.hidden=p!=="check"; drawTotals(); }},
    p==="card"?["Credit card",h("small",{class:"fee"},"+"+cardFeePct()+"% fee")]:{cash:"Cash",check:"Check"}[p])));
  const chk=h("label",{class:"f chk",hidden:s.pay!=="check"},"Check #",h("input",{value:s.checkNo,inputmode:"numeric",oninput:e=>{ s.checkNo=e.target.value; }}));

  function field(label,key,props){ return h("label",{class:"f"},label,h("input",{value:s[key],...props,oninput:e=>{ if(key==="soldTo") nameCaseInput(e.target); s[key]=e.target.value; if(key==="soldTo"||key==="phone"){ s.creditUsed=0; drawCredit(); drawTotals(); if (s._exCheck) s._exCheck(); } }})); }

  const acts=h("div",{class:"acts"},
    h("button",{type:"button",class:"btn ghost",onclick:()=>{ if(!s.lines.length||confirm("Clear this invoice and start over?")){ newSale(); render(); } }},"Clear"),
    h("button",{type:"button",class:"btn primary big",onclick:saveSale},"Save & print"));
  const exNo=h("input",{value:s.exemptNo||"",placeholder:"Exemption certificate # (optional)",autocomplete:"off",oninput:e=>{ s.exemptNo=e.target.value; }});
  const exBox=h("div",{class:"exempt"+(s.taxExempt?" on":"")},
    h("label",{class:"exsw"},h("input",{type:"checkbox",class:"switch",checked:!!s.taxExempt,onchange:e=>{ s.taxExempt=e.target.checked; exBox.classList.toggle("on",s.taxExempt); drawTotals(); }}),
      h("span",{},h("b",{},"Tax exempt"),h("small",{},"Business account that doesn't pay sales tax"))),exNo);
  s._exCheck=()=>{ const k=custKey(s.soldTo,s.phone), m=k&&DB.exempt&&DB.exempt[k]; if (m&&!s.taxExempt&&!s._exAsked){ s._exAsked=true; s.taxExempt=true; s.exemptNo=s.exemptNo||m.no||""; exNo.value=s.exemptNo; exBox.querySelector("input.switch").checked=true; exBox.classList.add("on"); drawTotals(); toast("Tax exempt account"); } };
  top.append(exBox,creditBox,body,h("div",{class:"bottom"},h("div",{},h("div",{class:"lbl2"},"Paid by"),pays,chk),totals),acts);
  v.append(top);
  drawCredit(); drawLines(true);
}
function trow(l,v,cls){ return h("div",{class:"trow"+(cls?" "+cls:"")},h("span",{},l),h("b",{class:"num"},v)); }
function saveSale(){
  const s=SALE;
  s.lines=s.lines.filter(l=>l.name.trim());
  if (!s.lines.length) return toast("Add at least one part.");
  if (s.lines.some(l=>!(l.price>0)) && !confirm("Some parts have no price. Save anyway?")) return;
  const inv={no:DB.seq++,date:today(),createdAt:new Date().toISOString(),soldTo:s.soldTo.trim()||"Customer",phone:normPhone(s.phone),address:s.address.trim(),
    soldBy:s.soldBy.trim(),pay:s.pay,checkNo:s.checkNo,taxRate:DB.settings.taxRate,taxExempt:!!s.taxExempt,exemptNo:(s.exemptNo||"").trim(),cardFee:s.pay==="card"?cardFeePct():0,lines:s.lines.map(l=>({...l})),returns:[],creditUsed:r2(s.creditUsed||0)};
  if (inv.creditUsed) addCredit(inv.soldTo,inv.phone,-inv.creditUsed);
  // Remember tax-exempt business accounts so the switch turns on next time
  const ek=custKey(inv.soldTo,inv.phone); DB.exempt=DB.exempt||{};
  if (ek && inv.soldTo!=="Customer"){ if (inv.taxExempt) DB.exempt[ek]={no:inv.exemptNo}; else delete DB.exempt[ek]; }
  DB.invoices.push(inv);
  if (inv.soldBy){ DB.settings.lastSoldBy=inv.soldBy; if(!DB.settings.staff.includes(inv.soldBy)) DB.settings.staff.push(inv.soldBy); }
  save(); newSale();
  toast("Invoice #"+inv.no+" saved");
  showInvoice(inv,true);
}

/* ===== Printed invoice (same layout as the paper book) ===== */
function receipt(inv,kind){
  const t=invTotals(inv);
  const lines=[];
  inv.lines.forEach(l=>{
    lines.push(h("tr",{},h("td",{},l.name),h("td",{class:"num"},money(l.price)),h("td",{class:"num"},String(l.qty)),h("td",{class:"num"},money(l.price*l.qty))));
    if (l.coreCharged&&l.core>0) lines.push(h("tr",{class:"coreline"},h("td",{},"   Core charge, "+l.name+(coreOwedQty(inv,inv.lines.indexOf(l))?" (refunded when core is returned)":" (core returned)")),
      h("td",{class:"num"},money(l.core)),h("td",{class:"num"},String(l.qty)),h("td",{class:"num"},money(l.core*l.qty))));
  });
  while (lines.length<8) lines.push(h("tr",{class:"blank"},h("td",{}," "),h("td",{}),h("td",{}),h("td",{})));
  const box=(on,label)=>h("span",{class:"pbox"},h("i",{},on?"✔":""),label);
  const after=[];
  const howTxt={refund:"refunded",credit:"store credit",exchange:"exchanged"};
  (inv.returns||[]).forEach(r=>after.push(niceDate(r.at)+": "+(r.kind==="core"?"Core returned, "+r.name+(r.coreQty>1?" ×"+r.coreQty:""):"Part returned, "+r.name+(r.qty>1?" ×"+r.qty:"")+(r.coreQty?" with core":""))+" · "+howTxt[r.how]+(r.how!=="exchange"?" "+money(r.amount):"")));
  return h("div",{class:"receipt"},
    h("div",{class:"rhead"},
      h("div",{class:"rlogo"},h("div",{class:"rw"},"RIGHTWAY"),h("div",{class:"ar"},"♻ Auto Recycling")),
      h("div",{class:"rbiz"},h("b",{},BIZ.name),h("div",{},BIZ.addr+"  |  "+BIZ.city),h("div",{},BIZ.phone)),
      h("div",{class:"rtitle"},h("b",{},kind||"INVOICE"),h("div",{},"No. "+inv.no),h("div",{},"Date "+niceDate(inv.date)))),
    h("div",{class:"rgrid"},
      h("div",{},h("span",{class:"rl"},"SOLD TO"),h("b",{},inv.soldTo||"")),
      h("div",{},h("span",{class:"rl"},"CUSTOMER TELEPHONE #"),fmtPhone(inv.phone)),
      h("div",{},h("span",{class:"rl"},"ADDRESS"),inv.address||""),
      h("div",{},h("span",{class:"rl"},"SOLD BY"),inv.soldBy||""),
      inv.taxExempt?h("div",{class:"rpay"},h("b",{},"TAX EXEMPT"+(inv.exemptNo?" · Certificate # "+inv.exemptNo:""))):null,
      h("div",{class:"rpay"},box(inv.pay==="check","CHECK"+(inv.checkNo?" #"+inv.checkNo:"")),box(inv.pay==="cash","CASH"),box(inv.pay==="card","CREDIT CARD"))),
    h("table",{class:"rtable"},h("thead",{},h("tr",{},h("th",{},"DESCRIPTION"),h("th",{},"PRICE"),h("th",{},"UNIT"),h("th",{},"AMOUNT"))),h("tbody",{},lines)),
    h("div",{class:"rfoot"},
      h("div",{class:"rnote"},
        h("p",{},h("b",{},"All sales are final. No returns or exchanges."),
          " Core charges are refunded when the core is brought back with this invoice."),
        after.length?h("div",{class:"rafter"},after.map(x=>h("div",{},x))):null,
        h("div",{class:"sig"},"Signature ",h("span",{}))),
      h("table",{class:"rtot"},h("tbody",{},
        h("tr",{},h("th",{},"SUB-TOTAL"),h("td",{class:"num"},money(t.sub))),
        h("tr",{},h("th",{},inv.taxExempt?"TAX EXEMPT":"TAX"),h("td",{class:"num"},money(t.tax))),
        t.credit?h("tr",{},h("th",{},"STORE CREDIT"),h("td",{class:"num"},"−"+money(t.credit))):null,
        t.fee?h("tr",{},h("th",{},"CARD FEE ("+t.feePct+"%)"),h("td",{class:"num"},money(t.fee))):null,
        h("tr",{class:"big"},h("th",{},"TOTAL"),h("td",{class:"num"},money(t.due)))))));
}
function printDoc(node){ const p=$("#print"); p.replaceChildren(node); window.print(); }

/* Invoice page: receipt + bring-backs */
function showInvoice(inv,justSaved){ go("find",{open:inv.no}); if(justSaved) setTimeout(()=>printDoc(receipt(inv)),250); }
function invoicePage(v,inv){
  const acts=h("div",{class:"acts left"},
    h("button",{type:"button",class:"btn primary",onclick:()=>printDoc(receipt(inv))},"Print invoice"),
    h("button",{type:"button",class:"btn ghost",onclick:()=>go(TAB,{open:null})},"← Back"));
  v.append(h("div",{class:"invpage"},acts,backPanel(inv),h("div",{class:"sheet"},receipt(inv))));
}
/* ===== Find invoice ===== */
function findInvoices(q){
  q=q.trim().toLowerCase(); const qd=q.replace(/\D/g,"");
  const list=DB.invoices.slice().sort((a,b)=>b.no-a.no);
  if(!q) return list;
  return list.filter(i=>String(i.no)===q.replace(/^#/,"")||(qd.length>=3&&(i.phone||"").includes(qd))||(i.soldTo||"").toLowerCase().includes(q)||String(i.no).startsWith(q.replace(/^#/,"")));
}
function invRow(i,onclick){
  const t=invTotals(i), owed=coresOwed(i);
  return h("button",{type:"button",class:"irow",onclick},
    h("span",{class:"ino"},"#"+i.no),
    h("span",{class:"iwho"},h("b",{},i.soldTo||"Customer"),h("small",{},niceDate(i.date)+(i.phone?" · "+fmtPhone(i.phone):"")+" · "+i.lines.map(l=>l.name).slice(0,3).join(", ")+(i.lines.length>3?"…":""))),
    h("span",{class:"itags"},owed.length?h("span",{class:"tag warn"},"Core owed"):null,(i.returns||[]).length?h("span",{class:"tag"},"Return"):null),
    h("b",{class:"num"},money(t.due)));
}
function viewFind(v){
  if (STATE.open!=null){ const inv=DB.invoices.find(i=>i.no===STATE.open); if(inv) return invoicePage(v,inv); STATE.open=null; }
  const list=h("div",{class:"ilist"});
  const draw=()=>{ const r=findInvoices(STATE.findQ); list.replaceChildren(...(r.length?r.slice(0,50).map(i=>invRow(i,()=>go("find",{open:i.no}))):[h("div",{class:"empty"},"No invoice matches. Check the number, or try the phone or name.")])); };
  const q=h("input",{class:"search",type:"search",placeholder:"Invoice number, phone or name",value:STATE.findQ,autocomplete:"off",oninput:e=>{ STATE.findQ=e.target.value; draw(); },
    onkeydown:e=>{ if(e.key==="Enter"){ const r=findInvoices(STATE.findQ); if(r.length===1) go("find",{open:r[0].no}); } }});
  v.append(h("div",{class:"panel"},h("h2",{},"Find an invoice"),q,list)); draw(); setTimeout(()=>q.focus(),0);
}

/* ===== Returns: the whole part (with its core), or just the core ===== */
function viewReturns(v){
  const inv=STATE.retInv!=null?DB.invoices.find(i=>i.no===STATE.retInv):null;
  if (!inv){
    const list=h("div",{class:"ilist"});
    const draw=()=>{ const r=findInvoices(STATE.retQ); list.replaceChildren(...(r.length?r.slice(0,30).map(i=>invRow(i,()=>go("returns",{retInv:i.no}))):[h("div",{class:"empty"},"No invoice matches.")])); };
    const q=h("input",{class:"search",type:"search",placeholder:"Invoice number, phone or name",value:STATE.retQ,autocomplete:"off",oninput:e=>{ STATE.retQ=e.target.value; draw(); },
      onkeydown:e=>{ if(e.key==="Enter"){ const r=findInvoices(STATE.retQ); if(r.length===1) go("returns",{retInv:r[0].no}); } }});
    v.append(h("div",{class:"panel"},h("h2",{},"Returns"),
      h("p",{class:"muted"},"Find the invoice. A part can come back whole (with its core) within "+DB.settings.warrantyDays+" days, or the customer can bring back just the core."),q,list));
    draw(); setTimeout(()=>q.focus(),0); return;
  }
  v.append(h("div",{class:"acts left"},h("button",{type:"button",class:"btn ghost",onclick:()=>go("returns",{retInv:null})},"← Pick another invoice"),
    h("button",{type:"button",class:"btn",onclick:()=>go("find",{open:inv.no})},"See invoice")),backPanel(inv,true));
}
// One card per part on the invoice: "Return whole part" and, when a core is still out, "Core only".
function backPanel(inv,big){
  const out=coresOwed(inv);
  if (!out.length) return null;
  return h("div",{class:"panel backpanel"},h("h3",{},"Cores still out"),
    h("div",{class:"blist"},out.map(({l,idx,n})=>h("div",{class:"bcard"},
      h("div",{class:"bhead"},h("div",{},h("b",{},l.name),h("div",{class:"muted"},"Core "+money(l.core)+(n>1?" × "+n:"")))),
      h("div",{class:"bbtns"},h("button",{type:"button",class:"btn core-btn",onclick:()=>returnDialog(inv,idx,"core")},
        h("span",{},"Core returned"),h("small",{},"give back "+money(withTax(l.core,inv))+(n>1?" each":""))))))));
}
function backPanelOld(inv,big){
  const cards=inv.lines.map((l,idx)=>{
    const w=warranty(inv,l), back=partBackQty(inv,idx), left=l.qty-back, owed=coreOwedQty(inv,idx);
    const status=left<=0?h("span",{class:"tag"},"Returned")
      :w.ok?h("span",{class:"tag good"},"Return by "+niceDate(w.ends)+" · "+w.left+" day"+(w.left===1?"":"s")+" left")
      :h("span",{class:"tag bad"},w.why);
    const coreIn=Math.min(1,owed), wholeAmt=withTax(l.price,inv,l)+withTax(coreIn?l.core:0,inv);
    const btns=h("div",{class:"bbtns"},
      left>0&&w.ok?h("button",{type:"button",class:"btn primary",onclick:()=>returnDialog(inv,idx,"part")},
        h("span",{},"Return whole part"),h("small",{},money(l.price)+(coreIn?" + core "+money(l.core):"")+(inv.taxExempt?" = ":" + tax = ")+money(wholeAmt)+(l.qty>1?" each":""))):null,
      owed>0?h("button",{type:"button",class:"btn core-btn",onclick:()=>returnDialog(inv,idx,"core")},
        h("span",{},"Core only"),h("small",{},"core "+money(l.core)+(inv.taxExempt?" = ":" + tax = ")+money(withTax(l.core,inv))+(owed>1?" each · "+owed+" out":""))):null);
    return h("div",{class:"bcard"+(left<=0&&!owed?" off":"")},
      h("div",{class:"bhead"},h("div",{},h("b",{},l.name),h("div",{class:"muted"},money(l.price)+(l.qty>1?" × "+l.qty:"")+(l.coreCharged&&l.core>0?(owed?" · core "+money(l.core)+" still out":" · core back"):"")+(w.glass&&left>0?" · glass: check it isn't broken":""))),status),
      btns.childNodes.length?btns:null);
  });
  return h("div",{class:"panel"+(big?"":" backpanel")},h("h3",{},big?"Invoice #"+inv.no+" · "+(inv.soldTo||"Customer")+" · sold "+niceDate(inv.date):"Bring back a part or core"),
    h("div",{class:"blist"},cards));
}
function returnDialog(inv,idx,kind){
  const l=inv.lines[idx], owed=coreOwedQty(inv,idx), left=l.qty-partBackQty(inv,idx);
  const max=kind==="core"?owed:left;
  let n=1;
  const d=h("dialog",{class:"dlg"});
  const close=()=>{ d.close(); d.remove(); };
  const calc=()=>{ const coreQ=kind==="core"?n:Math.min(n,owed); const base=kind==="core"?l.core*n:l.price*n+l.core*coreQ; return {coreQ,amt:kind==="core"?withTax(base,inv):r2(withTax(l.price*n,inv,l)+withTax(l.core*coreQ,inv)),base}; };
  const sum=h("p",{});
  const draw=()=>{ const c=calc(); sum.replaceChildren(kind==="core"?"Core "+money(l.core)+(n>1?" × "+n:""):money(l.price)+(n>1?" × "+n:"")+(c.coreQ?" + core "+money(l.core*c.coreQ):""), (inv.taxExempt?" = ":" + tax = "),h("b",{},money(c.amt))); };
  const qty=max>1?h("label",{class:"f qtyf"},"How many",h("input",{type:"number",min:"1",max:String(max),value:"1",inputmode:"numeric",oninput:e=>{ n=Math.min(max,Math.max(1,parseInt(e.target.value)||1)); draw(); }})):null;
  const done=how=>{
    const c=calc();
    const rec={idx,name:l.name,kind,qty:kind==="part"?n:0,coreQty:c.coreQ,how,amount:how==="exchange"?0:c.amt,at:today()};
    if (how==="exchange" && kind==="part") rec.coreQty=0;   // the customer keeps a part, so the core stays as it was
    inv.returns=(inv.returns||[]).concat(rec);
    if (how==="credit") addCredit(inv.soldTo,inv.phone,rec.amount);
    save(); close();
    toast(how==="exchange"?"Exchange recorded":how==="credit"?money(rec.amount)+" store credit for "+(inv.soldTo||"the customer"):"Give the customer "+money(rec.amount)+(inv.pay==="card"?" back on their card":" back"));
    printDoc(returnSlip(inv,rec));
    render();
  };
  const refundLbl=inv.pay==="card"?"Refund to card":inv.pay==="check"?"Refund (cash)":"Give cash back";
  d.append(...[h("h3",{},(kind==="core"?"Core returned: ":"Return whole part: ")+l.name),
    kind==="part"&&owed?h("p",{class:"muted"},"The core comes back with the part, so the core charge is included."):null,
    qty,sum,
    h("div",{class:"acts"},h("button",{type:"button",class:"btn ghost",onclick:close},"Cancel"),
      kind==="part"?h("button",{type:"button",class:"btn",onclick:()=>done("exchange")},"Exchange for same part"):null,
      h("button",{type:"button",class:"btn",onclick:()=>done("credit")},"Store credit"),
      h("button",{type:"button",class:"btn primary",onclick:()=>done("refund")},refundLbl))].filter(Boolean));
  draw();
  document.body.append(d); d.showModal();
}
function returnSlip(inv,r){
  const title=r.how==="exchange"?"EXCHANGE":r.how==="credit"?"STORE CREDIT":"REFUND";
  return h("div",{class:"receipt slip"},
    h("div",{class:"rhead"},h("div",{class:"rlogo"},h("div",{class:"rw"},"RIGHTWAY"),h("div",{class:"ar"},"♻ Auto Recycling")),
      h("div",{class:"rbiz"},h("b",{},BIZ.name),h("div",{},BIZ.addr+"  |  "+BIZ.city),h("div",{},BIZ.phone)),
      h("div",{class:"rtitle"},h("b",{},title),h("div",{},"For invoice "+inv.no),h("div",{},"Date "+niceDate(r.at)))),
    h("p",{},h("b",{},inv.soldTo||"Customer"),inv.phone?" · "+fmtPhone(inv.phone):""),
    h("table",{class:"rtable"},h("thead",{},h("tr",{},h("th",{},"RETURNED"),h("th",{},"QTY"),h("th",{},r.how==="exchange"?"":"AMOUNT (WITH TAX)"))),
      h("tbody",{},h("tr",{},h("td",{},(r.kind==="core"?"Core, ":"")+r.name+(r.kind==="part"&&r.coreQty?" (with core)":"")),h("td",{class:"num"},String(r.kind==="core"?r.coreQty:r.qty)),h("td",{class:"num"},r.how==="exchange"?"Exchanged":money(r.amount))))),
    r.how==="credit"?h("p",{class:"big"},"Store credit: ",h("b",{},money(r.amount)),". Balance now ",h("b",{},money(creditFor(inv.soldTo,inv.phone))),"."):null,
    h("div",{class:"sig"},"Signature ",h("span",{})));
}

/* ===== Today ===== */
/* ===== Sales: totals for any period, best sellers (to set prices by demand), cores still out ===== */
function salesPeriod(){
  const t=today(), P=STATE.per||"today";
  if (P==="week"){ const d=new Date(t+"T12:00"); d.setDate(d.getDate()-((d.getDay()+6)%7)); return {from:ymd(d),to:t,label:"This week"}; }
  if (P==="month") return {from:t.slice(0,8)+"01",to:t,label:"This month"};
  if (P==="30") return {from:addDays(t,-29),to:t,label:"Last 30 days"};
  if (P==="90") return {from:addDays(t,-89),to:t,label:"Last 90 days"};
  if (P==="pick") return {from:STATE.pf||addDays(t,-6),to:STATE.pt||t,label:"Picked dates"};
  return {from:t,to:t,label:"Today"};
}
function viewToday(v){
  const P=salesPeriod(), inP=d=>d>=P.from&&d<=P.to;
  const list=DB.invoices.filter(i=>inP(i.date)).sort((a,b)=>b.no-a.no);
  const sum=k=>r2(list.reduce((n,i)=>n+invTotals(i)[k],0));
  const byPay=p=>r2(list.filter(i=>i.pay===p).reduce((n,i)=>n+invTotals(i).due,0));
  const refunds=r2(DB.invoices.flatMap(i=>(i.returns||[]).filter(r=>inP(r.at)&&r.how==="refund").map(r=>r.amount)).reduce((a,b)=>a+b,0));
  const owed=DB.invoices.flatMap(i=>coresOwed(i).map(x=>({i,...x}))).sort((a,b)=>a.i.no-b.i.no);
  const chips=h("div",{class:"chips"},[["today","Today"],["week","This week"],["month","This month"],["30","Last 30 days"],["90","Last 90 days"],["pick","Pick dates"]].map(([id,l])=>
    h("button",{type:"button",class:"chip"+((STATE.per||"today")===id?" on":""),onclick:()=>{ STATE.per=id; render(); }},l)));
  const pick=(STATE.per==="pick")?h("div",{class:"row",style:"gap:8px;margin-top:10px"},
    h("input",{type:"date",value:P.from,max:P.to,onchange:e=>{ STATE.pf=e.target.value; render(); }}),"to",h("input",{type:"date",value:P.to,max:today(),onchange:e=>{ STATE.pt=e.target.value; render(); }})):null;
  // Best sellers: how many sold, how much money, how often it comes back, and the price now (change it right here)
  const by={};
  list.forEach(i=>i.lines.forEach((l,idx)=>{ if (l.labor) return; const k=l.name; const x=by[k]||(by[k]={name:k,qty:0,money:0,sales:0,back:0});
    x.qty+=l.qty; x.money+=l.price*l.qty; x.sales++;
    x.back+=(i.returns||[]).filter(r=>r.idx===idx&&r.kind==="part"&&r.how!=="exchange").reduce((n,r)=>n+r.qty,0); }));
  const sortBy=STATE.sortBy||"qty";
  const rows=Object.values(by).sort((a,b)=>sortBy==="money"?b.money-a.money:b.qty-a.qty||b.money-a.money);
  const maxQ=Math.max(1,...rows.map(r=>sortBy==="money"?r.money:r.qty));
  const plist=prices();
  const best=h("div",{class:"panel"},
    h("div",{class:"row",style:"flex-wrap:wrap;gap:8px"},h("h3",{class:"grow",style:"margin:0"},"Best sellers · "+P.label),
      h("div",{class:"seg"},[["qty","Most sold"],["money","Most money"]].map(([id,l])=>h("button",{type:"button",class:sortBy===id?"on":"",onclick:()=>{ STATE.sortBy=id; render(); }},l)))),
    h("div",{style:"height:12px"}),
    rows.length?h("div",{class:"btable"},
      h("div",{class:"brow bthead"},h("span",{},"Part"),h("span",{},"Sold"),h("span",{},"Money"),h("span",{},"Price now")),
      rows.slice(0,STATE.allBest?200:12).map(r=>{ const pr=plist.find(x=>x.name===r.name);
        return h("div",{class:"brow"},
          h("span",{class:"bname"},h("b",{},r.name),h("i",{class:"bar",style:"width:"+Math.max(4,Math.round((sortBy==="money"?r.money:r.qty)/maxQ*100))+"%"})),
          h("span",{class:"num"},String(r.qty)),h("span",{class:"num"},money(r.money)),
          pr?h("input",{type:"number",min:"0",step:"0.01",value:pr.price,"aria-label":"Price of "+r.name,onchange:e=>{ const l=prices(); const x=l.find(y=>y.name===r.name); x.price=Number(e.target.value)||0; setPrices(l); buildIndex(); toast(r.name+" now "+money(x.price)); }}):h("span",{class:"muted"},"not on list")); }),
      rows.length>12?h("button",{type:"button",class:"btn small ghost",onclick:()=>{ STATE.allBest=!STATE.allBest; render(); }},STATE.allBest?"Show fewer":"Show all "+rows.length):null)
    :h("div",{class:"empty"},"No parts sold in this period."));
  // A bar per day when looking at more than one day
  const days=[]; for (let d=P.from; d<=P.to; d=addDays(d,1)) days.push(d);
  const perDay=days.map(d=>r2(DB.invoices.filter(i=>i.date===d).reduce((n,i)=>n+invTotals(i).due,0)));
  const maxD=Math.max(1,...perDay);
  const chart=days.length>1&&days.length<=92?h("div",{class:"panel"},h("h3",{},"Sales by day"),
    h("div",{class:"dchart"},days.map((d,k)=>h("div",{class:"dcol",title:longDate(d)+": "+money(perDay[k])},h("i",{style:"height:"+Math.round(perDay[k]/maxD*100)+"%"})))),
    h("div",{class:"row muted",style:"justify-content:space-between;font-size:13px;margin-top:4px"},h("span",{},niceDate(P.from)),h("span",{},"Best day "+money(maxD)),h("span",{},niceDate(P.to)))):null;
  v.append(
    ...[h("div",{class:"row",style:"flex-wrap:wrap;gap:10px"},h("h2",{class:"grow",style:"margin:0"},"Sales"),chips),pick].filter(Boolean),
    h("div",{class:"stats"},
      stat(money(r2(sum("due")-refunds)),"Taken in"+(refunds?" (after "+money(refunds)+" core refunds)":"")),
      stat(String(list.length),"Sales"),
      stat(list.length?money(sum("due")/list.length):"$0.00","Average sale"),
      stat(money(sum("tax")),"Sales tax collected")),
    h("div",{class:"stats three"},stat(money(byPay("cash")),"Cash"),stat(money(byPay("check")),"Check"),stat(money(byPay("card")),"Card"),stat(money(sum("fee")),"Card fees")),
    chart,best,
    h("div",{class:"panel"},h("h3",{},"Cores still out ("+owed.length+")"),
      owed.length?owed.slice(0,STATE.allCores?500:8).map(({i,l,idx,n})=>h("div",{class:"crow"},h("div",{},h("b",{},l.name+(n>1?" ×"+n:"")),h("span",{class:"muted"}," · #"+i.no+" · "+(i.soldTo||"Customer")+(i.phone?" · "+fmtPhone(i.phone):"")+" · sold "+niceDate(i.date))),
        h("div",{class:"row"},h("b",{class:"num"},money(withTax(l.core*n,i))),h("button",{type:"button",class:"btn small primary",onclick:()=>returnDialog(i,idx,"core")},"Core returned"))))
      :h("div",{class:"empty"},"Every core is back."),
      owed.length>8?h("button",{type:"button",class:"btn small ghost",onclick:()=>{ STATE.allCores=!STATE.allCores; render(); }},STATE.allCores?"Show fewer":"Show all "+owed.length):null),
    h("details",{class:"panel"},h("summary",{style:"cursor:pointer;font-weight:700"},"Every sale in this period ("+list.length+")"),
      list.length?h("div",{class:"ilist",style:"margin-top:12px"},list.slice(0,200).map(i=>invRow(i,()=>go("find",{open:i.no})))):h("div",{class:"empty"},"No sales in this period.")));
}
const stat=(v,l)=>h("div",{class:"stat"},h("b",{},v),h("span",{},l));

/* ===== Price list ===== */
function viewPrices(v){
  let q="";
  const list=h("div",{class:"plist"});
  const draw=()=>{
    const all=prices(); const ql=q.toLowerCase().trim();
    const shown=ql?searchParts(q).length?all.filter(p=>searchParts(q).includes(p)||p.name.toLowerCase().includes(ql)):all.filter(p=>p.name.toLowerCase().includes(ql)):all;
    list.replaceChildren(h("div",{class:"prow phead"},h("span",{},"Part"),h("span",{},"Price"),h("span",{},"Core")),
      ...shown.slice(0,ql?80:600).map(p=>h("div",{class:"prow"},h("span",{},p.name,p.note?h("small",{class:"muted"}," · "+p.note):null),
        h("input",{type:"number",min:"0",step:"0.01",value:p.price,"aria-label":"Price of "+p.name,onchange:e=>{ const l=prices(); const x=l.find(y=>y.name===p.name); x.price=Number(e.target.value)||0; setPrices(l); buildIndex(); toast(p.name+" now "+money(x.price)); }}),
        h("input",{type:"number",min:"0",step:"0.01",value:p.core,"aria-label":"Core charge for "+p.name,onchange:e=>{ const l=prices(); const x=l.find(y=>y.name===p.name); x.core=Number(e.target.value)||0; setPrices(l); buildIndex(); toast(p.name+" core now "+money(x.core)); }}))));
  };
  const add=h("form",{class:"addpart",onsubmit:e=>{ e.preventDefault(); const f=new FormData(e.target); const n=String(f.get("n")||"").trim(); if(!n) return;
    const l=prices(); if(l.some(x=>x.name.toLowerCase()===n.toLowerCase())) return toast("That part is already on the list.");
    l.push({name:n,price:Number(f.get("p"))||0,core:Number(f.get("c"))||0,note:""}); l.sort((a,b)=>a.name.localeCompare(b.name)); setPrices(l); buildIndex(); e.target.reset(); toast(n+" added"); draw(); }},
    h("input",{name:"n",placeholder:"New part name",autocomplete:"off"}),h("input",{name:"p",type:"number",step:"0.01",min:"0",placeholder:"Price"}),h("input",{name:"c",type:"number",step:"0.01",min:"0",placeholder:"Core"}),h("button",{class:"btn"},"Add part"));
  v.append(h("div",{class:"panel"},h("h2",{},"Price list ("+prices().length+" parts)"),
    h("p",{class:"muted"},"From rightwayautorecycling.com. Change a price here and new invoices use it right away. Prices don't include tax."),
    h("input",{class:"search",type:"search",placeholder:"Find a part",oninput:e=>{ q=e.target.value; draw(); }}),add,list));
  draw();
}

/* ---------- start ---------- */
load(); buildIndex(); render();
$("#reset").addEventListener("click",e=>{ e.preventDefault(); if(confirm("Reset the demo? This clears every invoice made on this computer and puts the sample ones back.")){ localStorage.removeItem(KEY); DB=seed(); save(); newSale(); buildIndex(); go("sale"); toast("Demo reset"); } });
window.addEventListener("afterprint",()=>$("#print").replaceChildren());
})();
