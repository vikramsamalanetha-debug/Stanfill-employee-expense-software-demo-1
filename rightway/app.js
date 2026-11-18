/* Rightway Auto Recycling: counter invoicing (demo). Everything is saved in this browser only. */
(function(){
"use strict";
const KEY="rightway-demo-v1";
const $=s=>document.querySelector(s);
const money=n=>"$"+(Math.round((Number(n)||0)*100)/100).toFixed(2);
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
  const tr=P("Transmission - FWD/AWD"); tr.coreReturnedAt=addDays(t,-38); tr.coreRefund=r2(50*1.0975); tr.coreRefundHow="cash";
  return {seq:1005, settings:{taxRate:9.75,warrantyDays:30,staff:["Mike","Dana"]},
    prices:null, credits:{},
    invoices:[
      inv(1001,addDays(t,-40),"Tommy Ray","7315550142","Mike","cash",[tr]),
      inv(1002,addDays(t,-12),"Carla Jones","7315550188","Dana","card",[s]),
      inv(1003,addDays(t,-5),"Customer","","Mike","cash",[c,d,e]),
      inv(1004,t,"John Carter","7315550101","Dana","cash",[a,b])
    ]};
}
function load(){ try{ DB=JSON.parse(localStorage.getItem(KEY)); }catch(e){ DB=null; } if(!DB||!DB.invoices) DB=seed(); }
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(DB)); }catch(e){ toast("Couldn't save on this computer."); } }
const prices=()=>DB.prices||PRICE_LIST.map(p=>({name:p[0],price:p[1],core:p[2],note:p[3]||""}));
function setPrices(list){ DB.prices=list; save(); }

/* ---------- totals ---------- */
function invTotals(inv){
  const rate=(inv.taxRate??DB.settings.taxRate)/100;
  let parts=0,cores=0;
  inv.lines.forEach(l=>{ parts+=l.price*l.qty; if(l.coreCharged) cores+=l.core*l.qty; });
  parts=r2(parts); cores=r2(cores);
  const sub=r2(parts+cores), tax=r2(sub*rate), total=r2(sub+tax), credit=r2(inv.creditUsed||0);
  return {parts,cores,sub,tax,total,credit,due:r2(Math.max(0,total-credit)),rate};
}
const coresOwed=inv=>inv.lines.filter(l=>l.coreCharged&&l.core>0&&!l.coreReturnedAt);
const withTax=(amt,inv)=>r2(amt*(1+(inv.taxRate??DB.settings.taxRate)/100));
const custKey=(name,phone)=>normPhone(phone)||String(name||"").trim().toLowerCase();
const creditFor=(name,phone)=>{ const k=custKey(name,phone); return k&&DB.credits[k]?r2(DB.credits[k].amount):0; };
function addCredit(name,phone,amt){ const k=custKey(name,phone); if(!k) return; const c=DB.credits[k]||{name,phone,amount:0}; c.amount=r2(c.amount+amt); c.name=name||c.name; DB.credits[k]=c; }

/* Warranty: 30 days, exchange or store credit, no refunds. Computer modules aren't covered; glass is void if broken. */
function warranty(inv,line){
  const n=line.name.toLowerCase(), days=DB.settings.warrantyDays, ends=addDays(inv.date.slice(0,10),days), left=daysBetween(today(),ends);
  if (/\b(ecm|bcm|bmc|tcm|pcm)\b|control module|computer|brain box/.test(n)) return {ok:false,why:"Not covered: computer modules (ECM, BCM, TCM, PCM) are sold as is.",ends};
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
const tabs=[["sale","New Sale"],["find","Find Invoice"],["returns","Returns"],["today","Today"],["prices","Price List"]];
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
      field("Sold to","soldTo",{placeholder:"Customer name",autocomplete:"off"}),
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
    const t=invTotals({...s,taxRate:DB.settings.taxRate});
    totals.replaceChildren(...[
      trow("Parts",money(t.parts)),
      t.cores?trow("Core charges",money(t.cores),"corecharge"):null,
      trow("Sub-total",money(t.sub)),
      trow("Tax ("+DB.settings.taxRate+"%)",money(t.tax)),
      t.credit?trow("Store credit used","−"+money(t.credit),"good"):null,
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
        l.note?h("small",{class:"warn"},l.note):null),
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
      s.lines.push({name:p.name,price:p.price,qty:1,core:p.core||0,coreCharged:(p.core||0)>0,note:p.note||""});
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
    return h("div",{class:"lrow newrow"},h("span",{class:"c-desc wide"},inp,box));
  }
  const pays=h("div",{class:"pays"},["cash","check","card"].map(p=>h("button",{type:"button",class:"pay"+(s.pay===p?" on":""),onclick:e=>{ s.pay=p; pays.querySelectorAll(".pay").forEach(b=>b.classList.toggle("on",b===e.currentTarget)); chk.hidden=p!=="check"; }},
    {cash:"Cash",check:"Check",card:"Credit card"}[p])));
  const chk=h("label",{class:"f chk",hidden:s.pay!=="check"},"Check #",h("input",{value:s.checkNo,inputmode:"numeric",oninput:e=>{ s.checkNo=e.target.value; }}));

  function field(label,key,props){ return h("label",{class:"f"},label,h("input",{value:s[key],...props,oninput:e=>{ s[key]=e.target.value; if(key==="soldTo"||key==="phone"){ s.creditUsed=0; drawCredit(); drawTotals(); } }})); }

  const acts=h("div",{class:"acts"},
    h("button",{type:"button",class:"btn ghost",onclick:()=>{ if(!s.lines.length||confirm("Clear this invoice and start over?")){ newSale(); render(); } }},"Clear"),
    h("button",{type:"button",class:"btn primary big",onclick:saveSale},"Save & print"));
  top.append(creditBox,body,h("div",{class:"bottom"},h("div",{},h("div",{class:"lbl2"},"Paid by"),pays,chk),totals),acts);
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
    soldBy:s.soldBy.trim(),pay:s.pay,checkNo:s.checkNo,taxRate:DB.settings.taxRate,lines:s.lines.map(l=>({...l})),returns:[],creditUsed:r2(s.creditUsed||0)};
  if (inv.creditUsed) addCredit(inv.soldTo,inv.phone,-inv.creditUsed);
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
    if (l.coreCharged&&l.core>0) lines.push(h("tr",{class:"coreline"},h("td",{},"   Core charge, "+l.name+(l.coreReturnedAt?" (core returned "+niceDate(l.coreReturnedAt)+")":" (refunded when core is returned)")),
      h("td",{class:"num"},money(l.core)),h("td",{class:"num"},String(l.qty)),h("td",{class:"num"},money(l.core*l.qty))));
  });
  while (lines.length<8) lines.push(h("tr",{class:"blank"},h("td",{}," "),h("td",{}),h("td",{}),h("td",{})));
  const box=(on,label)=>h("span",{class:"pbox"},h("i",{},on?"✔":""),label);
  const after=[];
  inv.lines.forEach(l=>{ if(l.coreReturnedAt) after.push("Core returned "+niceDate(l.coreReturnedAt)+": "+l.name+", "+(l.coreRefundHow==="credit"?"store credit ":"refunded ")+money(l.coreRefund)); });
  (inv.returns||[]).forEach(r=>after.push((r.type==="exchange"?"Exchanged ":"Returned for store credit ")+niceDate(r.at)+": "+r.name+(r.qty>1?" ×"+r.qty:"")+(r.type==="credit"?", credit "+money(r.amount):"")));
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
      h("div",{class:"rpay"},box(inv.pay==="check","CHECK"+(inv.checkNo?" #"+inv.checkNo:"")),box(inv.pay==="cash","CASH"),box(inv.pay==="card","CREDIT CARD"))),
    h("table",{class:"rtable"},h("thead",{},h("tr",{},h("th",{},"DESCRIPTION"),h("th",{},"PRICE"),h("th",{},"UNIT"),h("th",{},"AMOUNT"))),h("tbody",{},lines)),
    h("div",{class:"rfoot"},
      h("div",{class:"rnote"},
        h("p",{},h("b",{},"30-day warranty: exchange or store credit. No refunds."),
          " Receipt required and parts must be marked. ECM, BCM, TCM and PCM are not covered. Glass is void if returned broken."),
        after.length?h("div",{class:"rafter"},after.map(x=>h("div",{},x))):null,
        h("div",{class:"sig"},"Signature ",h("span",{}))),
      h("table",{class:"rtot"},h("tbody",{},
        h("tr",{},h("th",{},"SUB-TOTAL"),h("td",{class:"num"},money(t.sub))),
        h("tr",{},h("th",{},"TAX"),h("td",{class:"num"},money(t.tax))),
        t.credit?h("tr",{},h("th",{},"STORE CREDIT"),h("td",{class:"num"},"−"+money(t.credit))):null,
        h("tr",{class:"big"},h("th",{},"TOTAL"),h("td",{class:"num"},money(t.due)))))));
}
function printDoc(node){ const p=$("#print"); p.replaceChildren(node); window.print(); }

/* Invoice page: receipt + what you can do with it */
function showInvoice(inv,justSaved){ go("find",{open:inv.no}); if(justSaved) setTimeout(()=>printDoc(receipt(inv)),250); }
function invoicePage(v,inv){
  const owed=coresOwed(inv);
  const acts=h("div",{class:"acts left"},
    h("button",{type:"button",class:"btn primary",onclick:()=>printDoc(receipt(inv))},"Print invoice"),
    h("button",{type:"button",class:"btn",onclick:()=>go("returns",{retInv:inv.no})},"Return or exchange a part"),
    h("button",{type:"button",class:"btn ghost",onclick:()=>go(TAB,{open:null})},"← Back"));
  const coreP=owed.length?h("div",{class:"panel corepanel"},h("h3",{},"Cores still owed"),
    owed.map(l=>h("div",{class:"crow"},h("div",{},h("b",{},l.name),h("span",{class:"muted"}," core "+money(l.core)+(l.qty>1?" × "+l.qty:"")+" + tax = "),h("b",{},money(withTax(l.core*l.qty,inv)))),
      h("button",{type:"button",class:"btn primary",onclick:()=>coreReturn(inv,l)},"Core returned")))):null;
  v.append(h("div",{class:"invpage"},acts,coreP,h("div",{class:"sheet"},receipt(inv))));
}
function coreReturn(inv,l){
  const amt=withTax(l.core*l.qty,inv);
  const d=h("dialog",{class:"dlg"});
  const done=how=>{ l.coreReturnedAt=today(); l.coreRefund=amt; l.coreRefundHow=how; if(how==="credit") addCredit(inv.soldTo,inv.phone,amt); save(); d.close(); d.remove(); toast(how==="credit"?"Core returned. "+money(amt)+" added to store credit.":"Core returned. Give the customer "+money(amt)+"."); render(); };
  d.append(h("h3",{},"Core returned: "+l.name),
    h("p",{},"Core charge "+money(l.core*l.qty)+" plus tax. The customer gets back ",h("b",{},money(amt)),"."),
    h("div",{class:"acts"},h("button",{type:"button",class:"btn ghost",onclick:()=>{ d.close(); d.remove(); }},"Cancel"),
      h("button",{type:"button",class:"btn",onclick:()=>done("credit")},"Store credit"),
      h("button",{type:"button",class:"btn primary",onclick:()=>done(inv.pay==="card"?"card":"cash")},inv.pay==="card"?"Refund to card":"Give cash back")));
  document.body.append(d); d.showModal();
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

/* ===== Returns ===== */
function viewReturns(v){
  const inv=STATE.retInv!=null?DB.invoices.find(i=>i.no===STATE.retInv):null;
  if (!inv){
    const list=h("div",{class:"ilist"});
    const draw=()=>{ const r=findInvoices(STATE.retQ); list.replaceChildren(...(r.length?r.slice(0,30).map(i=>invRow(i,()=>go("returns",{retInv:i.no}))):[h("div",{class:"empty"},"No invoice matches.")])); };
    const q=h("input",{class:"search",type:"search",placeholder:"Invoice number, phone or name",value:STATE.retQ,autocomplete:"off",oninput:e=>{ STATE.retQ=e.target.value; draw(); }});
    v.append(h("div",{class:"panel"},h("h2",{},"Return or exchange a part"),
      h("p",{class:"muted"},"Find the customer's invoice. Parts can be exchanged or turned into store credit within "+DB.settings.warrantyDays+" days. No refunds."),q,list));
    draw(); setTimeout(()=>q.focus(),0); return;
  }
  const picks=new Map();
  const rows=inv.lines.map((l,idx)=>{
    const w=warranty(inv,l), done=(inv.returns||[]).filter(r=>r.idx===idx).reduce((n,r)=>n+r.qty,0), left=l.qty-done;
    const status=left<=0?h("span",{class:"tag"},"Already returned")
      :w.ok?h("span",{class:"tag good"},"In warranty · "+w.left+" day"+(w.left===1?"":"s")+" left")
      :h("span",{class:"tag bad"},w.why);
    const can=w.ok&&left>0;
    return h("label",{class:"rrow"+(can?"":" off")},
      h("input",{type:"checkbox",disabled:!can,onchange:e=>{ if(e.target.checked) picks.set(idx,1); else picks.delete(idx); }}),
      h("span",{class:"rname"},h("b",{},l.name),h("small",{},money(l.price)+(l.qty>1?" × "+l.qty:"")+(w.glass&&can?" · glass: check it isn't broken":""))),
      status);
  });
  const go2=type=>{
    if(!picks.size) return toast("Tick the part being brought back.");
    const recs=[];
    for (const idx of picks.keys()){
      const l=inv.lines[idx];
      let amt=0;
      if (type==="credit"){ amt=l.price; if(l.coreCharged&&!l.coreReturnedAt){ amt+=l.core; l.coreReturnedAt=today(); l.coreRefund=withTax(l.core,inv); l.coreRefundHow="credit"; } amt=withTax(amt,inv); }
      recs.push({idx,name:l.name,qty:1,type,amount:amt,at:today()});
    }
    inv.returns=(inv.returns||[]).concat(recs);
    const credit=r2(recs.reduce((n,r)=>n+r.amount,0));
    if (type==="credit") addCredit(inv.soldTo,inv.phone,credit);
    save();
    toast(type==="credit"?money(credit)+" store credit for "+(inv.soldTo||"the customer"):"Exchange recorded");
    printDoc(returnSlip(inv,recs,type,credit));
    go("find",{open:inv.no,retInv:null});
  };
  v.append(h("div",{class:"panel"},
    h("div",{class:"row"},h("h2",{class:"grow"},"Invoice #"+inv.no+" · "+(inv.soldTo||"Customer")),h("button",{type:"button",class:"btn ghost",onclick:()=>go("returns",{retInv:null})},"← Pick another")),
    h("p",{class:"muted"},"Sold "+longDate(inv.date)+". Tick what's coming back."),
    h("div",{class:"rlist"},rows),
    h("div",{class:"note"},"Store policy: no refunds. Exchange the part, or give store credit for the price plus tax. Store credit is saved to this customer and comes up the next time you sell to them."),
    h("div",{class:"acts"},h("button",{type:"button",class:"btn",onclick:()=>go2("exchange")},"Exchange for same part"),h("button",{type:"button",class:"btn primary",onclick:()=>go2("credit")},"Give store credit"))));
}
function returnSlip(inv,recs,type,credit){
  return h("div",{class:"receipt slip"},
    h("div",{class:"rhead"},h("div",{class:"rlogo"},h("div",{class:"rw"},"RIGHTWAY"),h("div",{class:"ar"},"♻ Auto Recycling")),
      h("div",{class:"rbiz"},h("b",{},BIZ.name),h("div",{},BIZ.addr+"  |  "+BIZ.city),h("div",{},BIZ.phone)),
      h("div",{class:"rtitle"},h("b",{},type==="credit"?"STORE CREDIT":"EXCHANGE"),h("div",{},"For invoice "+inv.no),h("div",{},"Date "+niceDate(today())))),
    h("p",{},h("b",{},inv.soldTo||"Customer"),inv.phone?" · "+fmtPhone(inv.phone):""),
    h("table",{class:"rtable"},h("thead",{},h("tr",{},h("th",{},"PART"),h("th",{},type==="credit"?"CREDIT (WITH TAX)":"")) ),
      h("tbody",{},recs.map(r=>h("tr",{},h("td",{},r.name),h("td",{class:"num"},type==="credit"?money(r.amount):"Exchanged"))))),
    type==="credit"?h("p",{class:"big"},"Store credit: ",h("b",{},money(credit)),". Balance now ",h("b",{},money(creditFor(inv.soldTo,inv.phone))),"."):null,
    h("div",{class:"sig"},"Signature ",h("span",{})));
}

/* ===== Today ===== */
function viewToday(v){
  const d=STATE.day||today();
  const list=DB.invoices.filter(i=>i.date===d).sort((a,b)=>b.no-a.no);
  const sum=k=>r2(list.reduce((n,i)=>n+invTotals(i)[k],0));
  const byPay=p=>r2(list.filter(i=>i.pay===p).reduce((n,i)=>n+invTotals(i).due,0));
  const owed=DB.invoices.flatMap(i=>coresOwed(i).map(l=>({i,l}))).sort((a,b)=>a.i.no-b.i.no);
  const coreBack=DB.invoices.flatMap(i=>i.lines.filter(l=>l.coreReturnedAt===d).map(l=>l.coreRefund||0)).reduce((a,b)=>a+b,0);
  v.append(
    h("div",{class:"row"},h("h2",{class:"grow"},d===today()?"Today":longDate(d)),
      h("input",{type:"date",value:d,max:today(),onchange:e=>{ STATE.day=e.target.value||today(); render(); }})),
    h("div",{class:"stats"},
      stat(String(list.length),"Invoices"),
      stat(money(sum("due")),"Total taken in"),
      stat(money(sum("tax")),"Sales tax"),
      stat(money(sum("cores")),"Core charges")),
    h("div",{class:"stats three"},stat(money(byPay("cash")),"Cash"),stat(money(byPay("check")),"Check"),stat(money(byPay("card")),"Card"),
      coreBack?stat("−"+money(coreBack),"Core refunds given"):null),
    h("div",{class:"panel"},h("h3",{},"Invoices"),list.length?h("div",{class:"ilist"},list.map(i=>invRow(i,()=>go("find",{open:i.no})))):h("div",{class:"empty"},"No sales on this day.")),
    h("div",{class:"panel"},h("h3",{},"Cores still out ("+owed.length+")"),
      owed.length?owed.map(({i,l})=>h("div",{class:"crow"},h("div",{},h("b",{},l.name),h("span",{class:"muted"}," · #"+i.no+" · "+(i.soldTo||"Customer")+(i.phone?" · "+fmtPhone(i.phone):"")+" · sold "+niceDate(i.date))),
        h("div",{class:"row"},h("b",{class:"num"},money(withTax(l.core*l.qty,i))),h("button",{type:"button",class:"btn small primary",onclick:()=>coreReturn(i,l)},"Core returned"))))
      :h("div",{class:"empty"},"Every core is back.")));
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
