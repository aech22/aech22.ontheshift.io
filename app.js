// ============================================================
// シフト管理システム v6 - Firebase リアルタイム同期版
// ============================================================
const {useState,useEffect,useCallback,useRef,useMemo}=React;

// ============================================================
// ★ Firebase 設定 ★
// Firebase Console で取得した設定を以下に貼り付けてください
// https://console.firebase.google.com
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDdl1Li3QduufAFhBWcF4nmOlFcCsx8zlQ",
  authDomain:        "ontheshift.firebaseapp.com",
  databaseURL:       "https://ontheshift-default-rtdb.firebaseio.com",
  projectId:         "ontheshift",
  storageBucket:     "ontheshift.firebasestorage.app",
  messagingSenderId: "29720860733",
  appId:             "1:29720860733:web:94aec772f4cddcb1287254",
  measurementId:     "G-P8RP0TG9JG"
};
// ============================================================

// Firebase SDK の初期化
let firebaseDB = null;
let firebaseEnabled = false;
let onConnectChange = null; // 接続状態変化コールバック

function initFirebase(onStatusChange) {
  try {
    if (typeof firebase === "undefined") {
      console.warn("Firebase SDK未読込み");
      onStatusChange && onStatusChange("offline");
      return;
    }
    // 既に初期化済みなら再利用
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    firebaseDB = firebase.database();
    onConnectChange = onStatusChange;

    // 接続状態をリアルタイム監視
    firebaseDB.ref(".info/connected").on("value", snap => {
      const connected = snap.val() === true;
      firebaseEnabled = connected;
      console.log("Firebase接続状態:", connected ? "オンライン" : "オフライン");
      onStatusChange && onStatusChange(connected ? "online" : "offline");
    });
  } catch(e) {
    console.warn("Firebase初期化失敗:", e.message);
    firebaseEnabled = false;
    onStatusChange && onStatusChange("offline");
  }
}

// Firebase パス生成（店舗ID + キー）
function fbPath(shopId, key) { return `shops/${shopId}/${key}`; }

// Firebase への書き込み
function fbSet(path, val) {
  if (firebaseDB) {
    return firebaseDB.ref(path).set(val)
      .then(() => console.log("fbSet OK:", path))
      .catch(e => console.warn("fbSet失敗:", path, e.message));
  }
  return Promise.resolve();
}

// Firebase リアルタイム購読
function fbOn(path, cb) {
  if (firebaseDB) {
    const ref = firebaseDB.ref(path);
    ref.on("value", snap => {
      const val = snap.val();
      console.log("fbOn受信:", path, val !== null ? "データあり" : "null");
      cb(val);
    }, err => console.warn("fbOn失敗:", path, err.message));
    return () => ref.off("value");
  }
  // Firebase未初期化 → 何もしない
  return () => {};
}

// ===== 定数 =====
const WD=["日","月","火","水","木","金","土"];
const JH=[1,6,7,8,11,15,16,23]; // 祝日月日（簡易・毎年共通）
const DEFAULT_PW="admin1234";

// ===== デフォルト候補時間 =====
const CAND_WEEKDAY=[
  {start:"10:00",end:"15:00"},{start:"11:00",end:"15:00"},
  {start:"17:00",end:"23:00"},{start:"18:00",end:"23:00"},
  {start:"10:00",end:"23:00"},{start:"11:00",end:"23:00"}
];
const CAND_WEEKEND=[
  {start:"10:00",end:"15:00"},{start:"11:00",end:"15:00"},
  {start:"10:00",end:"17:00"},{start:"11:00",end:"17:00"},
  {start:"15:00",end:"23:00"},{start:"17:00",end:"23:00"},
  {start:"18:00",end:"23:00"},{start:"10:00",end:"23:00"},
  {start:"11:00",end:"23:00"}
];

// ===== ユーティリティ =====
function fd(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function pd(s){const[y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);}
function gd(s,e){const r=[],st=pd(s),en=pd(e);let c=new Date(st);while(c<=en){r.push(fd(c));c.setDate(c.getDate()+1);}return r;}
function gto(){const o=[];for(let h=0;h<=24;h++){const ms=h===24?[0]:[0,30];for(const m of ms)o.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);}return o;}
const TO=gto();
function idp(d){return d?new Date()>new Date(d+"T23:59:59"):false;}
function lg(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function ls(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function sc(cs){return[...cs].sort((a,b)=>{const ta=Number(a.start.replace(":","").replace(":","")),tb=Number(b.start.replace(":","").replace(":","")),ea=Number(a.end.replace(":","").replace(":","")),eb=Number(b.end.replace(":","").replace(":",""));return ta!==tb?ta-tb:ea-eb;});}
// 時刻→数値（Excelフォーマット用）HH:MM → H.5 / H形式
function timeToNum(t){if(!t)return"";const[h,m]=t.split(":").map(Number);return m===0?h:h+0.5;}
// 祝日判定（簡易）
function isHoliday(dateStr){const d=pd(dateStr);const mo=d.getMonth()+1,dy=d.getDate();return JH.some(h=>h===mo*100+dy)||false;}
function isWeekend(dateStr){const dow=pd(dateStr).getDay();return dow===0||dow===6||isHoliday(dateStr);}

const td=new Date(),tds=fd(td);

// ===== ストレージキー（店舗IDベース）=====
function storeKey(shopId,key){return`shift_${shopId}_${key}`;}

// ===== 初期データ =====
function makeShop(name="店舗1"){return{id:`shop_${Date.now()}`,name,createdAt:new Date().toISOString()};}
function makePeriod(shopId){
  const yr=td.getFullYear(),mo=td.getMonth()+1,ms=String(mo).padStart(2,"0");
  return{id:`p_${Date.now()}`,shopId,label:`${yr}年${mo}月前半`,startDate:`${yr}-${ms}-01`,endDate:`${yr}-${ms}-15`,deadlineDate:"",createdAt:new Date().toISOString()};
}
function makeSettings(shopId){
  return{shopId,password:DEFAULT_PW,candidates:CAND_WEEKDAY,weekdayCandidates:{0:CAND_WEEKEND,6:CAND_WEEKEND},dateCandidates:{},templates:[]};
}

// ===== URL スラッグ生成 =====
// 期間から /<shopIdx>/<月数字><first|latter> を生成
// 例: /0/202506first  /1/202506latter
function makePeriodSlug(period){
  if(!period||!period.startDate)return null;
  const d=pd(period.startDate);
  const mo=d.getMonth()+1; // 月は整数（ゼロ埋めなし）
  const yr=d.getFullYear();
  const isLatter=d.getDate()>=16||(period.label&&period.label.includes("後半"));
  return `${yr}${mo}${isLatter?"latter":"first"}`;
}

// URL形式: #/<shopIdx>/<slug>  例: #/0/202506first
// shopIdx = shops配列内のインデックス（0始まり）
function parseUrl(){
  const h=window.location.hash;
  if(h.startsWith("#/")){
    const parts=h.slice(2).split("/");
    if(parts.length>=2){
      const shopIdx=isNaN(Number(parts[0]))?null:Number(parts[0]);
      return{shopIdx,slug:parts[1]};
    }
    if(parts.length===1&&parts[0])return{shopIdx:null,slug:parts[0]};
  }
  if(h.startsWith("#p="))return{shopIdx:null,slug:null,legacyPid:h.slice(3)};
  return null;
}

function buildUrl(shops,shopId,period){
  const slug=makePeriodSlug(period);
  if(!slug)return "";
  const idx=shops.findIndex(s=>s.id===shopId);
  const shopIdx=idx>=0?idx:0;
  return`${window.location.origin}${window.location.pathname}#/${shopIdx}/${slug}`;
}

function setUrl(shops,shopId,period){
  const slug=makePeriodSlug(period);
  if(!slug)return;
  const idx=shops.findIndex(s=>s.id===shopId);
  const shopIdx=idx>=0?idx:0;
  window.location.hash=`/${shopIdx}/${slug}`;
}

// URLからshopId+periodIdを解決
function resolvePeriodFromUrl(shops,allPeriods){
  const parsed=parseUrl();
  if(!parsed)return null;
  if(parsed.legacyPid){
    const found=allPeriods.find(p=>p.id===parsed.legacyPid);
    return found?{period:found,shopId:found.shopId||shops[0]?.id}:null;
  }
  if(!parsed.slug)return null;
  // shopIdxでshopを特定
  let targetShops=shops;
  if(parsed.shopIdx!==null&&shops[parsed.shopIdx]){
    targetShops=[shops[parsed.shopIdx]];
  }
  for(const shop of targetShops){
    const found=allPeriods.find(p=>(p.shopId===shop.id||!p.shopId)&&makePeriodSlug(p)===parsed.slug);
    if(found)return{period:found,shopId:shop.id};
  }
  return null;
}

// ============================================================
// メインアプリ
// ============================================================
// ============================================================
// メインアプリ - 3フェーズ初期化
// ============================================================
function App(){
  const[syncStatus,setSyncStatus]=useState("init");
  const[ready,setReady]=useState(false); // Phase1完了フラグ

  const[shops,setShops]=useState([]);
  const[currentShopId,setCurrentShopId]=useState(null);
  const[view,setView]=useState("staff");
  const[auth,setAuth]=useState(false);
  const[settings,setSettings]=useState(null);
  const[periods,setPeriods]=useState([]);
  const[staffList,setStaffList]=useState([]);
  const[subs,setSubs]=useState([]);
  const[apid,setApid]=useState(null);
  const[urlResolved,setUrlResolved]=useState(false);

  // ===================================================================
  // Phase1: Firebase初期化 → global/shopsをonceで読む → shops/sid確定
  // ===================================================================
  useEffect(()=>{
    const configured = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";

    if(!configured){
      // Firebase未設定: localStorageのみ
      const local=lg("shift_shops_v6",null);
      const sh=local&&local.length>0?local:[makeShop("メイン店舗")];
      setShops(sh); ls("shift_shops_v6",sh);
      setCurrentShopId(sh[0].id);
      setSyncStatus("no_config");
      setReady(true);
      return;
    }

    // Firebase SDK 初期化
    try{
      if(!firebase.apps||firebase.apps.length===0) firebase.initializeApp(FIREBASE_CONFIG);
      firebaseDB = firebase.database();
      firebaseDB.ref(".info/connected").on("value",snap=>{
        firebaseEnabled=snap.val()===true;
        setSyncStatus(firebaseEnabled?"online":"offline");
      });
    }catch(e){
      console.warn("Firebase init failed:",e);
      const local=lg("shift_shops_v6",null)||[makeShop("メイン店舗")];
      setShops(local); setCurrentShopId(local[0].id);
      setSyncStatus("offline"); setReady(true); return;
    }

    // global/shops を1回だけ読む（onceで）→ 全端末でIDを統一
    firebaseDB.ref("global/shops").once("value").then(snap=>{
      const val=snap.val();
      let sh;
      if(val){
        // Firebaseにデータあり → そのまま使う（端末間でIDを統一）
        if(typeof val==="object"&&!Array.isArray(val)){
          sh=Object.values(val).filter(s=>s&&s.id);
        } else {
          sh=(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
        }
        console.log("Firebase shops取得:", sh.length,"件");
      } else {
        // Firebaseにデータなし → localまたは新規作成してFirebaseに書く
        const local=lg("shift_shops_v6",null);
        sh=local&&local.length>0?local:[makeShop("メイン店舗")];
        const shObj={};
        sh.forEach(s=>{ if(s&&s.id) shObj[s.id]=s; });
        firebaseDB.ref("global/shops").set(shObj);
        console.log("Firebase shops新規作成:", sh.length,"件");
      }
      setShops(sh);
      ls("shift_shops_v6",sh);
      setCurrentShopId(sh[0].id);
      setReady(true);
    }).catch(e=>{
      console.warn("shops読み込み失敗:",e);
      const local=lg("shift_shops_v6",null)||[makeShop("メイン店舗")];
      setShops(local); setCurrentShopId(local[0].id); setReady(true);
    });

    return()=>{ if(firebaseDB) firebaseDB.ref(".info/connected").off(); };
  },[]);

  const shop=shops.find(s=>s.id===currentShopId)||shops[0];
  const sid=shop?.id||"default";

  // ===================================================================
  // Phase2: sid確定後、全データをリアルタイム購読
  // ===================================================================
  useEffect(()=>{
    if(!ready||!sid||!firebaseDB)return;
    console.log("Phase2: 購読開始 sid=",sid);
    const refs=[];
    const on=(path,cb)=>{
      const r=firebaseDB.ref(path);
      r.on("value",snap=>cb(snap.val()),err=>console.warn("購読失敗:",path,err));
      refs.push(r);
    };

    // global/shops をリアルタイム購読（店舗追加・変更を全端末に反映）
    on("global/shops",val=>{
      if(!val)return;
      let arr;
      if(typeof val==="object"&&!Array.isArray(val)){
        arr=Object.values(val).filter(s=>s&&s.id);
      } else {
        arr=(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
      }
      if(arr.length>0){ setShops(arr); ls("shift_shops_v6",arr); }
    });

    // 店舗別データ
    on(fbPath(sid,"settings"),val=>{
      if(val&&typeof val==="object"){ setSettings(val); ls(storeKey(sid,"settings_v6"),val); }
      else{ const def=makeSettings(sid); setSettings(def); }
    });
    on(fbPath(sid,"periods"),val=>{
      if(!val){ return; }
      let arr;
      if(typeof val==="object"&&!Array.isArray(val)){
        arr=Object.values(val).filter(p=>p&&p.id);
      } else {
        arr=(Array.isArray(val)?val:Object.values(val)).filter(p=>p&&p.id);
      }
      if(arr.length>0){
        arr.sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
        setPeriods(arr); ls(storeKey(sid,"periods_v6"),arr);
      }
    });
    on(fbPath(sid,"staff"),val=>{
      if(!val){ setStaffList([]); return; }
      // staffは文字列配列
      let arr;
      if(Array.isArray(val)){
        arr=val.filter(s=>s&&typeof s==="string");
      } else if(typeof val==="object"){
        // Firebaseが {0:"田中",1:"山田"} 形式で返した場合
        arr=Object.values(val).filter(s=>s&&typeof s==="string");
      } else {
        arr=[];
      }
      setStaffList(arr); ls(storeKey(sid,"staff_v6"),arr);
    });
    on(fbPath(sid,"subs"),val=>{
      if(!val){ setSubs([]); ls(storeKey(sid,"subs_v6"),[]); return; }
      // Firebase から {id: sub} 形式で返る → 配列に変換
      let arr;
      if(typeof val==="object"&&!Array.isArray(val)){
        arr=Object.values(val).filter(s=>s&&s.id);
      } else {
        arr=(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
      }
      // submittedAt で降順ソート
      arr.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));
      setSubs(arr);
      ls(storeKey(sid,"subs_v6"),arr);
      console.log("subs受信:", arr.length,"件");
    });

    // settingsがFirebaseにない場合デフォルトを書き込む
    firebaseDB.ref(fbPath(sid,"settings")).once("value").then(snap=>{
      if(!snap.val()){ const def=makeSettings(sid); firebaseDB.ref(fbPath(sid,"settings")).set(def); }
    });

    return()=>{ console.log("Phase2: 購読解除 sid=",sid); refs.forEach(r=>r.off()); };
  },[ready,sid]);

  // ===================================================================
  // Phase3: periods確定後にURL解決・apid初期化
  // ===================================================================
  useEffect(()=>{
    if(!ready||urlResolved)return;
    const parsed=parseUrl();
    if(!parsed){
      if(periods.length>0){ if(!apid)setApid(periods[0].id); setUrlResolved(true); }
      return;
    }
    // shopIdxでshop切り替え
    if(parsed.shopIdx!=null&&shops.length>parsed.shopIdx){
      const ts=shops[parsed.shopIdx];
      if(ts&&ts.id!==sid){ setCurrentShopId(ts.id); return; }
    }
    // slugでperiod解決
    if(parsed.slug&&periods.length>0){
      const r=resolvePeriodFromUrl(shops,periods);
      if(r){ setApid(r.period.id); setView("staff"); setUrlResolved(true); return; }
    }
    // periods待ち
    if(periods.length>0){ if(!apid)setApid(periods[0].id); setUrlResolved(true); }
  },[ready,shops,periods,urlResolved,sid,apid]);

  // periodsが来たらapidを設定
  useEffect(()=>{ if(!apid&&periods.length>0)setApid(periods[0].id); },[periods]);

  // ===================================================================
  // 保存関数（Firebase + localStorage 二重書き）
  // ===================================================================
  const fbW=(path,val)=>{ if(firebaseDB) firebaseDB.ref(path).set(val).catch(e=>console.warn("書き込み失敗:",path,e)); };
  const saveSettings=useCallback(v=>{ setSettings(v); ls(storeKey(sid,"settings_v6"),v); fbW(fbPath(sid,"settings"),v); },[sid]);
  const savePeriods =useCallback(v=>{
    setPeriods(v);
    ls(storeKey(sid,"periods_v6"),v);
    if(firebaseDB){
      const obj={};
      v.forEach(p=>{ if(p&&p.id) obj[p.id]=p; });
      firebaseDB.ref(fbPath(sid,"periods")).set(obj).catch(e=>console.warn("periods書き込み失敗:",e));
    }
  },[sid]);
  const saveStaff   =useCallback(v=>{ setStaffList(v);ls(storeKey(sid,"staff_v6"),v);    fbW(fbPath(sid,"staff"),v);    },[sid]);
  const saveSubs    =useCallback(v=>{
    setSubs(v);
    ls(storeKey(sid,"subs_v6"),v);
    // Firebase には {id: sub} のオブジェクト形式で保存（配列はNG）
    if(firebaseDB){
      const obj={};
      v.forEach(s=>{ if(s&&s.id) obj[s.id]=s; });
      firebaseDB.ref(fbPath(sid,"subs")).set(obj).catch(e=>console.warn("subs書き込み失敗:",e));
    }
  },[sid]);
  const saveShops   =useCallback(v=>{
    setShops(v);
    ls("shift_shops_v6",v);
    if(firebaseDB){
      const obj={};
      v.forEach(s=>{ if(s&&s.id) obj[s.id]=s; });
      firebaseDB.ref("global/shops").set(obj).catch(e=>console.warn("shops書き込み失敗:",e));
    }
  },[]);

  const ap=periods.find(p=>p.id===apid)||periods[0];
  const effectiveSettings=settings||makeSettings(sid);

  // ローディング画面（Phase1完了まで）
  if(!ready) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#1A1A2E",flexDirection:"column",gap:16}}>
      <div style={{fontSize:40}}>📅</div>
      <div style={{color:"white",fontSize:16,fontWeight:700}}>シフト管理システム</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13}}>データを読み込み中...</div>
    </div>
  );

  return(
    <div style={{fontFamily:"'Hiragino Sans','Yu Gothic',sans-serif",minHeight:"100vh",background:view==="admin"?"#1A1A2E":"#F0F2F5"}}>
      {/* デバッグ・同期ステータスバー */}
      <div style={{background:syncStatus==="online"?"#06C755":syncStatus==="offline"?"#F59E0B":"#6B7280",color:"white",fontSize:11,fontWeight:700,textAlign:"center",padding:"4px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>{syncStatus==="online"?"🟢 Firebase接続中":syncStatus==="offline"?"🟡 オフライン":syncStatus==="no_config"?"⚙️ 未設定":"⏳ 接続中..."}</span>
        <button onClick={()=>{
          if(!firebaseDB){alert("firebaseDB=null\nFirebase SDKが読み込まれていません");return;}
          firebaseDB.ref("debug_test").set({t:Date.now(),msg:"接続テスト"})
            .then(()=>alert("✅ Firebase書き込み成功！\n同期は正常です"))
            .catch(e=>alert("❌ Firebase書き込み失敗:\n"+e.message));
        }} style={{background:"rgba(255,255,255,.25)",border:"none",borderRadius:6,padding:"2px 8px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔍 接続テスト</button>
      </div>
      {/* タブ */}
      <div style={{display:"flex",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
        <button onClick={()=>setView("staff")} style={{flex:1,padding:"13px 0",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,background:view==="staff"?"#06C755":"#1A1A2E",color:"white"}}>📅 スタッフ画面</button>
        <button onClick={()=>setView("admin")} style={{flex:1,padding:"13px 0",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,background:view==="admin"?"#16213E":"#111827",color:"white"}}>⚙️ 管理者画面</button>
      </div>
      {view==="staff"
        ?<StaffView periods={periods} ap={ap} apid={apid} setApid={setApid} shopId={sid} settings={effectiveSettings} subs={subs} staffList={staffList}
            onSub={sub=>{
              const a=[...subs];const i=a.findIndex(s=>s.staffName===sub.staffName&&s.periodId===sub.periodId);
              if(i>=0)a[i]=sub;else a.push(sub);saveSubs(a);
            }} shopName={shop?.name}/>
        :auth
          ?<AdminView settings={effectiveSettings} periods={periods} subs={subs} staffList={staffList} shops={shops}
              currentShopId={sid} saveSettings={saveSettings} savePeriods={savePeriods} saveSubs={saveSubs}
              saveStaff={saveStaff} saveShops={saveShops} setCurrentShopId={id=>setCurrentShopId(id)}
              logout={()=>setAuth(false)} syncStatus={syncStatus}/>
          :<AdminLogin settings={effectiveSettings} onAuth={()=>setAuth(true)}/>
      }
    </div>
  );
}

// ============================================================
// スタッフ画面
// ============================================================
function StaffView({periods,ap,apid,setApid,shopId,settings,subs,staffList,onSub,shopName}){
  const[name,setName]=useState("");
  const[sd,setSd]=useState({});
  const[done,setDone]=useState(false);
  const[conf,setConf]=useState(false);
  const[toast,setToast]=useState(null);
  const[sm,setSm]=useState(false);
  const[comment,setComment]=useState("");
  const[editN,setEditN]=useState(false);
  const[ni,setNi]=useState("");
  const[showSuggest,setShowSuggest]=useState(false);
  const tr=useRef(),nr=useRef(),nameWrapRef=useRef();
  const dl=idp(ap?.deadlineDate);
  const dates=ap?gd(ap.startDate,ap.endDate):[];

  // 名前はセッション内のみ保持（デフォルト空欄）
  useEffect(()=>{
    const i={};dates.forEach(d=>{i[d]={status:"holiday"};});
    setSd(i);setDone(false);setComment("");
  },[apid,ap?.startDate,ap?.endDate]);

  const tt_=m=>{setToast(m);clearTimeout(tr.current);tr.current=setTimeout(()=>setToast(null),2500);};
  const upd=(ds,u)=>setSd(p=>({...p,[ds]:{...p[ds],...u}}));
  const reset=()=>{const i={};dates.forEach(d=>{i[d]={status:"holiday"};});setSd(i);setDone(false);setComment("");tt_("🔄 リセットしました");};

  // 候補取得（日付別→曜日別→デフォルト）
  const gc=ds=>{
    const dc=(settings.dateCandidates||{})[ds];if(dc&&dc.length>0)return dc;
    const dow=pd(ds).getDay();
    if(isWeekend(ds)){const wdc=(settings.weekdayCandidates||{})[dow]||[];if(wdc.length>0)return wdc;return CAND_WEEKEND;}
    const wdc=(settings.weekdayCandidates||{})[dow]||[];if(wdc.length>0)return wdc;
    return settings.candidates||CAND_WEEKDAY;
  };

  const submit=()=>{
    const sub={id:Date.now().toString(),periodId:apid,staffName:name.trim(),submittedAt:new Date().toISOString(),shifts:Object.fromEntries(dates.map(d=>[d,sd[d]||{status:"holiday"}])),comment:comment.trim()};
    onSub(sub);setDone(true);setConf(false);
  };

  const p0=dates[0]?`${pd(dates[0]).getMonth()+1}/${pd(dates[0]).getDate()}`:"";
  const pe=dates[dates.length-1]?`${pd(dates[dates.length-1]).getMonth()+1}/${pd(dates[dates.length-1]).getDate()}`:"";
  const wk=dates.filter(d=>sd[d]?.status==="work").length;

  // スタッフ名候補（五十音順）
  const nameSuggests=useMemo(()=>[...staffList].sort((a,b)=>a.localeCompare(b,"ja")),[staffList]);
  const filteredSuggests=ni?nameSuggests.filter(n=>n.includes(ni)):nameSuggests;

  // クリック外で候補を閉じる
  useEffect(()=>{
    const h=e=>{if(nameWrapRef.current&&!nameWrapRef.current.contains(e.target))setShowSuggest(false);};
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);

  if(done)return(
    <div style={{background:"#F0F2F5",minHeight:"calc(100vh - 44px)"}}>
      <StaffHdr ap={ap} p0={p0} pe={pe} nd={dates.length} subs={subs} apid={apid} onSm={()=>setSm(true)} shopName={shopName} periods={periods} onChangePeriod={id=>{setApid(id);const p=periods.find(pp=>pp.id===id);if(p){const i={};gd(p.startDate,p.endDate).forEach(d=>{i[d]={status:"holiday"};});setSd(i);setDone(false);setComment("");setUrl(shops,shopId,p);}}}/>
      {sm&&<SmModal subs={subs} periods={periods} apid={apid} onClose={()=>setSm(false)} staffList={staffList} onEditSub={sub=>{onSub(sub);}} onEditByName={sub=>{setName(sub.staffName);const init={};const ds2=ap?gd(ap.startDate,ap.endDate):[];ds2.forEach(d=>{init[d]=(sub.shifts||{})[d]||{status:"holiday"};});setSd(init);setComment(sub.comment||"");setDone(false);}}/>}
      <div style={{maxWidth:560,margin:"0 auto",padding:"50px 20px",textAlign:"center"}}>
        <div style={{fontSize:68,animation:"bI .5s"}}>✅</div>
        <div style={{fontSize:22,fontWeight:700,color:"#05A847",marginTop:14,marginBottom:8}}>提出完了！</div>
        <div style={{background:"#E8F9EE",border:"1px solid #C2F0D2",borderRadius:12,padding:"14px 20px",marginBottom:24,fontSize:14,lineHeight:1.9,display:"inline-block",textAlign:"left"}}>
          <strong style={{color:"#05A847"}}>{ap?.label}</strong><br/>
          {ap?.startDate?.replace(/-/g,"/")} 〜 {ap?.endDate?.replace(/-/g,"/")}<br/>
          出勤予定：<strong style={{color:"#05A847"}}>{wk}日</strong>　休み：{dates.length-wk}日
          {comment&&<><br/>コメント：{comment}</>}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
          {!dl&&<button onClick={()=>setDone(false)} style={{padding:"11px 22px",background:"white",border:"2px solid #06C755",borderRadius:10,color:"#05A847",fontSize:14,fontWeight:700,cursor:"pointer"}}>✏️ 修正する</button>}
          <button onClick={reset} style={{padding:"11px 22px",background:"#F0F2F5",border:"2px solid #E5E7EB",borderRadius:10,color:"#6B7280",fontSize:14,fontWeight:700,cursor:"pointer"}}>🔄 最初から</button>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{background:"#F0F2F5",minHeight:"calc(100vh - 44px)"}}>
      <StaffHdr ap={ap} p0={p0} pe={pe} nd={dates.length} subs={subs} apid={apid} onSm={()=>setSm(true)} shopName={shopName} periods={periods} onChangePeriod={id=>{setApid(id);const p=periods.find(pp=>pp.id===id);if(p){const i={};gd(p.startDate,p.endDate).forEach(d=>{i[d]={status:"holiday"};});setSd(i);setDone(false);setComment("");setUrl(shops,shopId,p);}}}/>
      {sm&&<SmModal subs={subs} periods={periods} apid={apid} onClose={()=>setSm(false)} staffList={staffList} onEditSub={sub=>{onSub(sub);}} onEditByName={sub=>{setName(sub.staffName);const init={};const ds2=ap?gd(ap.startDate,ap.endDate):[];ds2.forEach(d=>{init[d]=(sub.shifts||{})[d]||{status:"holiday"};});setSd(init);setComment(sub.comment||"");setDone(false);}}/>}
      <div style={{maxWidth:560,margin:"0 auto",padding:"14px 12px 120px"}}>
        {ap?.deadlineDate&&<div style={{background:dl?"#FFF0F1":"#FFFBEB",border:`1px solid ${dl?"#FF4757":"#FCD34D"}`,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,fontWeight:700,color:dl?"#FF4757":"#92400E"}}>{dl?`⚠️ 締切済み（${ap.deadlineDate.replace(/-/g,"/")}）`:`📅 締切日：${ap.deadlineDate.replace(/-/g,"/")}`}</div>}

        {/* 名前カード */}
        <div style={{background:"#fff",borderRadius:14,boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:14,padding:"16px 18px",display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:48,height:48,borderRadius:"50%",background:"#E8F9EE",border:"2px solid #C2F0D2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>👤</div>
          <div style={{flex:1,minWidth:0}} ref={nameWrapRef}>
            {editN?(
              <div style={{position:"relative"}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input ref={nr} value={ni} onChange={e=>{setNi(e.target.value);setShowSuggest(true);}}
                    onKeyDown={e=>{if(e.key==="Enter"){if(ni.trim())setName(ni.trim());setEditN(false);setShowSuggest(false);}if(e.key==="Escape"){setEditN(false);setShowSuggest(false);}}}
                    onFocus={()=>setShowSuggest(true)}
                    placeholder="お名前を入力"
                    style={{flex:1,padding:"10px 12px",fontSize:18,fontWeight:700,background:"#F0F2F5",border:"2px solid #06C755",borderRadius:10,outline:"none",color:"#1A1A2E",minWidth:0}}/>
                  <button onClick={()=>{if(ni.trim())setName(ni.trim());setEditN(false);setShowSuggest(false);}} style={{padding:"10px 16px",background:"#06C755",border:"none",borderRadius:10,color:"white",fontSize:14,fontWeight:700,cursor:"pointer",flexShrink:0}}>確定</button>
                </div>
                {showSuggest&&filteredSuggests.length>0&&(
                  <div className="name-suggest">
                    {filteredSuggests.map((n,i)=>(
                      <div key={i} className="name-suggest-item" onMouseDown={e=>{e.preventDefault();setName(n);setNi(n);setEditN(false);setShowSuggest(false);}}>
                        {n}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ):name?(
              <div onClick={()=>{setNi(name);setEditN(true);setTimeout(()=>nr.current?.focus(),50);}} style={{cursor:"pointer"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#6B7280",marginBottom:2,letterSpacing:".05em"}}>名前（タップで変更）</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:22,fontWeight:900,color:"#1A1A2E",lineHeight:1}}>{name}</span>
                  <span style={{fontSize:12,color:"#6B7280",background:"#F0F2F5",padding:"2px 8px",borderRadius:6}}>✎ 変更</span>
                </div>
              </div>
            ):(
              <div onClick={()=>{setNi("");setEditN(true);setTimeout(()=>{nr.current?.focus();setShowSuggest(true);},50);}} style={{cursor:"pointer",padding:"4px 0"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#6B7280",marginBottom:4}}>お名前を入力してください（必須）</div>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"#F0F2F5",borderRadius:10,border:"2px dashed #E5E7EB"}}>
                  <span style={{fontSize:16,color:"#9CA3AF"}}>例）山田 太郎</span>
                  <span style={{marginLeft:"auto",fontSize:12,color:"#06C755",fontWeight:700}}>タップして入力 →</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 日付カード */}
        {dates.map(ds=>{
          const d=pd(ds),m=d.getMonth()+1,day=d.getDate(),dow=d.getDay(),wd=WD[dow];
          const st=sd[ds]||{status:"holiday"},iw=st.status==="work",iS=dow===6,iSu=dow===0||isHoliday(ds);
          const cds=gc(ds);
          return(
            <div key={ds} className="dc" style={{background:"#fff",borderRadius:14,boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:10,border:`2px solid ${iw?"#C2F0D2":"#E5E7EB"}`,opacity:iw?1:.82}}>
              <div style={{padding:"11px 15px 9px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"linear-gradient(to right,#F9FAFB,#fff)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:17,fontWeight:700,color:"#1A1A2E"}}>{m}/{day}</span>
                  <span style={{fontSize:13,fontWeight:700,padding:"2px 8px",borderRadius:6,background:iS?"#EFF6FF":iSu?"#FFF0F1":"#F0F2F5",color:iS?"#3B82F6":iSu?"#FF4757":"#6B7280"}}>{wd}{isHoliday(ds)?"祝":""}</span>
                </div>
                <span style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:12,background:iw?"#E8F9EE":"#F0F2F5",color:iw?"#15803D":"#6B7280"}}>{iw?"出勤":"休み"}</span>
              </div>
              <div style={{display:"flex",gap:8,padding:"0 15px 10px"}}>
                {[["work","出勤"],["holiday","休み"]].map(([v,l])=>{
                  const a=st.status===v,iW=v==="work";
                  return(<div key={v} onClick={()=>!dl&&upd(ds,{status:v,start:iW?(st.start||cds[0]?.start||"18:00"):undefined,end:iW?(st.end||cds[0]?.end||"23:00"):undefined})}
                    style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px 0",borderRadius:10,cursor:dl?"not-allowed":"pointer",border:`2px solid ${a?(iW?"#06C755":"#FF4757"):"#E5E7EB"}`,background:a?(iW?"#E8F9EE":"#FFF0F1"):"#F0F2F5",color:a?(iW?"#166634":"#FF4757"):"#6B7280",fontSize:14,fontWeight:600,opacity:dl?.5:1,transition:"all .15s"}}>
                    <div style={{width:15,height:15,borderRadius:"50%",border:"2px solid currentColor",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{a&&<div style={{width:7,height:7,borderRadius:"50%",background:"currentColor"}}/>}</div>{l}
                  </div>);
                })}
              </div>
              {iw&&(
                <div style={{padding:"0 15px 13px"}}>
                  {cds.length>0&&<div style={{marginBottom:10}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:5}}>⚡ 候補から選択</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {cds.map((c,i)=>{const sel=st.start===c.start&&st.end===c.end;return(
                        <button key={i} className="cb" onClick={()=>!dl&&upd(ds,{start:c.start,end:c.end})} disabled={dl}
                          style={{padding:"6px 11px",fontSize:13,fontWeight:700,background:sel?"#06C755":"rgba(6,199,85,.1)",color:sel?"white":"#05A847",border:`1.5px solid ${sel?"#06C755":"#C2F0D2"}`,borderRadius:8,whiteSpace:"nowrap",cursor:"pointer"}}>
                          {c.start}〜{c.end}
                        </button>
                      );})}
                    </div>
                  </div>}
                  <div style={{display:"flex",gap:8}}>
                    {[["start","出勤"],["end","退勤"]].map(([f,l])=>(
                      <div key={f} style={{flex:1}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:4}}>{l}</div>
                        <select value={st[f]||"18:00"} onChange={e=>!dl&&upd(ds,{[f]:e.target.value})} disabled={dl}
                          style={{width:"100%",padding:"9px 28px 9px 10px",fontSize:15,fontWeight:600,background:`#F0F2F5 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center`,border:"2px solid #E5E7EB",borderRadius:9,color:"#1A1A2E",outline:"none",cursor:"pointer",appearance:"none",WebkitAppearance:"none"}}>
                          {TO.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!iw&&<div style={{padding:"0 15px 13px",fontSize:13,color:"#6B7280",fontWeight:500}}>🌙 お休み</div>}
            </div>
          );
        })}

        {/* コメント欄 */}
        <div style={{background:"#fff",borderRadius:14,boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:10,overflow:"hidden"}}>
          <div style={{padding:"12px 16px 10px",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>💬</span>
            <span style={{fontSize:14,fontWeight:700,color:"#1A1A2E"}}>コメント・備考（任意）</span>
          </div>
          <div style={{padding:"14px 16px"}}>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} disabled={dl}
              placeholder="休み希望の理由、変動できる日、その他連絡事項など"
              style={{width:"100%",minHeight:80,padding:"10px 12px",fontSize:14,color:"#1A1A2E",background:"#F0F2F5",border:"2px solid #E5E7EB",borderRadius:10,outline:"none",resize:"vertical",lineHeight:1.6,fontFamily:"inherit"}}
              onFocus={e=>e.target.style.borderColor="#06C755"} onBlur={e=>e.target.style.borderColor="#E5E7EB"}></textarea>
          </div>
        </div>
      </div>

      {/* 送信ボタン */}
      {!dl&&<div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(240,242,245,.97)",backdropFilter:"blur(10px)",padding:"10px 14px 16px",boxShadow:"0 -4px 20px rgba(0,0,0,.08)",zIndex:40}}>
        <div style={{maxWidth:560,margin:"0 auto",display:"flex",gap:8}}>
          <button onClick={reset} style={{padding:"13px 14px",background:"white",border:"2px solid #E5E7EB",borderRadius:10,color:"#6B7280",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>🔄 リセット</button>
          <button onClick={()=>{if(!name.trim()){tt_("⚠️ 名前を入力してください");return;}setConf(true);}}
            style={{flex:1,padding:13,background:"linear-gradient(135deg,#06C755,#05A847)",color:"white",border:"none",borderRadius:10,fontSize:16,fontWeight:700,boxShadow:"0 4px 16px rgba(6,199,85,.35)",cursor:"pointer"}}>
            📤 シフトを提出する
          </button>
        </div>
      </div>}

      {/* 確認モーダル */}
      {conf&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fI .2s"}}>
        <div style={{background:"white",borderRadius:20,width:"100%",maxWidth:340,padding:"26px 22px 20px",boxShadow:"0 8px 32px rgba(0,0,0,.14)",animation:"sI .2s"}}>
          <div style={{fontSize:36,textAlign:"center",marginBottom:10}}>📤</div>
          <div style={{fontSize:17,fontWeight:700,textAlign:"center",marginBottom:8}}>シフトを提出しますか？</div>
          <div style={{background:"#F0F2F5",borderRadius:10,padding:"11px 13px",marginBottom:18,fontSize:13,lineHeight:1.9,color:"#6B7280"}}>
            <strong style={{color:"#1A1A2E"}}>氏名</strong>：{name}<br/>
            <strong style={{color:"#1A1A2E"}}>期間</strong>：{ap?.label}<br/>
            <strong style={{color:"#1A1A2E"}}>出勤</strong>：{dates.filter(d=>sd[d]?.status==="work").length}日　<strong style={{color:"#1A1A2E"}}>休み</strong>：{dates.filter(d=>sd[d]?.status==="holiday").length}日
            {comment&&<><br/><strong style={{color:"#1A1A2E"}}>コメント</strong>：{comment}</>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setConf(false)} style={{flex:1,padding:12,background:"#F0F2F5",border:"none",borderRadius:10,fontSize:14,fontWeight:600,color:"#6B7280",cursor:"pointer"}}>キャンセル</button>
            <button onClick={submit} style={{flex:2,padding:12,background:"linear-gradient(135deg,#06C755,#05A847)",border:"none",borderRadius:10,fontSize:14,fontWeight:700,color:"white",cursor:"pointer"}}>提出する</button>
          </div>
        </div>
      </div>}
      {toast&&<div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"rgba(26,26,46,.9)",color:"white",padding:"10px 20px",borderRadius:24,fontSize:14,fontWeight:500,zIndex:500,whiteSpace:"nowrap",animation:"fI .3s"}}>{toast}</div>}
    </div>
  );
}

// ===== スタッフヘッダー =====
function StaffHdr({ap,p0,pe,nd,subs,apid,onSm,shopName,periods,onChangePeriod,urlLocked}){
  const submitted=subs.filter(s=>s.periodId===apid);
  const[periodMenu,setPeriodMenu]=useState(false);
  const menuRef=useRef();
  useEffect(()=>{
    const h=e=>{if(menuRef.current&&!menuRef.current.contains(e.target))setPeriodMenu(false);};
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);
  return(
    <div style={{background:"#06C755",boxShadow:"0 2px 12px rgba(6,199,85,.25)",padding:"12px 14px"}}>
      <div style={{maxWidth:560,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}} ref={menuRef}>
          <span style={{fontSize:20,flexShrink:0}}>📅</span>
          <div style={{minWidth:0,position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              {shopName&&<span style={{fontSize:11,background:"rgba(255,255,255,.25)",color:"white",padding:"1px 7px",borderRadius:10,fontWeight:700,whiteSpace:"nowrap"}}>{shopName}</span>}
              {/* プロジェクト名クリックでプロジェクト切り替えメニュー */}
              <button onClick={()=>!urlLocked&&periods&&periods.length>1&&setPeriodMenu(v=>!v)}
                style={{fontSize:15,fontWeight:700,color:"white",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",background:"none",border:"none",cursor:(!urlLocked&&periods&&periods.length>1)?"pointer":"default",padding:0,display:"flex",alignItems:"center",gap:4}}>
                {ap?.label||"シフト希望提出"}
                {!urlLocked&&periods&&periods.length>1&&<span style={{fontSize:11,opacity:.75}}>▼</span>}
              </button>
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.85)",marginTop:1}}>{p0} 〜 {pe}（{nd}日間）</div>
            {/* プロジェクト切り替えメニュー */}
            {periodMenu&&periods&&periods.length>1&&(
              <div style={{position:"absolute",top:"100%",left:0,background:"white",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.2)",zIndex:200,minWidth:200,marginTop:6,overflow:"hidden"}}>
                {[...periods].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(p=>(
                  <div key={p.id} onClick={()=>{onChangePeriod&&onChangePeriod(p.id);setPeriodMenu(false);}}
                    style={{padding:"11px 16px",cursor:"pointer",fontSize:14,fontWeight:p.id===apid?700:400,color:p.id===apid?"#06C755":"#1A1A2E",background:p.id===apid?"#E8F9EE":"white",display:"flex",alignItems:"center",gap:8}}
                    onMouseEnter={e=>e.currentTarget.style.background=p.id===apid?"#E8F9EE":"#F9FAFB"}
                    onMouseLeave={e=>e.currentTarget.style.background=p.id===apid?"#E8F9EE":"white"}>
                    {p.id===apid&&<span style={{fontSize:10}}>✓</span>}{p.label}
                    <span style={{fontSize:11,color:"#9CA3AF",marginLeft:"auto"}}>{p.startDate?.replace(/-/g,"/").slice(5)}〜{p.endDate?.replace(/-/g,"/").slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <button onClick={onSm} style={{flexShrink:0,background:"rgba(255,255,255,.18)",border:"1px solid rgba(255,255,255,.4)",borderRadius:20,padding:"7px 14px",color:"white",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
          👥 提出状況
          <span style={{background:submitted.length>0?"white":"rgba(255,255,255,.3)",color:submitted.length>0?"#05A847":"white",borderRadius:20,padding:"1px 8px",fontSize:12,fontWeight:800}}>{submitted.length}</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// セル編集パネル（元の時間を正しく初期表示）
// ============================================================
function CellEditPanel({sub,s,d,onApply,onClose}){
  const[status,setStatus]=useState(s.status||"holiday");
  const[start,setStart]=useState(s.start||"18:00");
  const[end,setEnd]=useState(s.end||"23:00");
  // statusが変わったとき出勤→即時適用
  const handleStatus=v=>{
    setStatus(v);
    if(v==="holiday")onApply(v,start,end);
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20,animation:"fI .2s"}} onClick={onClose}>
      <div style={{background:"white",borderRadius:16,width:"100%",maxWidth:320,padding:"20px",animation:"sI .2s"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:15,fontWeight:700,color:"#1A1A2E",marginBottom:4}}>{sub?.staffName}</div>
        <div style={{fontSize:13,color:"#6B7280",marginBottom:14}}>{d.getMonth()+1}/{d.getDate()}（{WD[d.getDay()]}）</div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {[["work","出勤"],["holiday","休み"]].map(([v,l])=>(
            <button key={v} onClick={()=>handleStatus(v)}
              style={{flex:1,padding:"10px 0",border:`2px solid ${status===v?(v==="work"?"#06C755":"#FF4757"):"#E5E7EB"}`,borderRadius:10,background:status===v?(v==="work"?"#E8F9EE":"#FFF0F1"):"#F0F2F5",color:status===v?(v==="work"?"#166634":"#FF4757"):"#6B7280",fontWeight:700,fontSize:14,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        {status==="work"&&<>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["start","出勤時間"],["end","退勤時間"]].map(([f,l])=>(
              <div key={f} style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:4}}>{l}</div>
                <select value={f==="start"?start:end} onChange={e=>f==="start"?setStart(e.target.value):setEnd(e.target.value)}
                  style={{width:"100%",padding:"9px 10px",fontSize:15,fontWeight:700,background:"#F0F2F5",border:"2px solid #E5E7EB",borderRadius:9,color:"#1A1A2E",outline:"none",cursor:"pointer"}}>
                  {TO.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={()=>onApply(status,start,end)} style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#06C755,#05A847)",border:"none",borderRadius:10,color:"white",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:8}}>✅ 確定</button>
        </>}
        <button onClick={onClose} style={{width:"100%",padding:"10px",background:"#F0F2F5",border:"none",borderRadius:10,color:"#6B7280",fontSize:14,fontWeight:600,cursor:"pointer"}}>キャンセル</button>
      </div>
    </div>
  );
}

// ============================================================
// 提出状況モーダル（全画面・名前固定・横スクロール）
// ============================================================
function SmModal({subs,periods,apid,onClose,staffList,onEditSub,onEditByName}){
  const period=periods.find(p=>p.id===apid);
  const submitted=subs.filter(s=>s.periodId===apid);
  const dates=period?gd(period.startDate,period.endDate):[];
  const[editTarget,setEditTarget]=useState(null);
  const submittedNames=submitted.map(s=>s.staffName);
  const notSubmitted=staffList.filter(n=>!submittedNames.includes(n));
  const NW=88,CW=86,COMMENT_W=150;
  const handleCellClick=(sub,ds)=>{if(!sub)return;setEditTarget({subId:sub.id,ds});};
  const applyCellEdit=(subId,ds,newStatus,newStart,newEnd)=>{
    const sub=submitted.find(s=>s.id===subId);if(!sub)return;
    const shifts={...(sub.shifts||{}),[ds]:{status:newStatus,start:newStart,end:newEnd}};
    onEditSub({...sub,shifts});
    setEditTarget(null);
  };
  // 名前クリック→ホーム画面で修正
  const handleNameClick=(sub)=>{
    if(onEditByName)onEditByName(sub);
    onClose();
  };
  // 名前列と日付列の縦スクロール同期用ref
  const nameColRef=useRef();
  const dataColRef=useRef();
  const syncScroll=(src,dst)=>()=>{if(dst.current)dst.current.scrollTop=src.current.scrollTop;};

  return(
    <div style={{position:"fixed",inset:0,background:"white",zIndex:300,display:"flex",flexDirection:"column",animation:"fI .2s"}}>
      <div style={{background:"#06C755",padding:"12px 16px",flexShrink:0,boxShadow:"0 2px 8px rgba(6,199,85,.3)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"white"}}>👥 提出状況一覧</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.85)",marginTop:1}}>{period?.label}　提出済み {submitted.length}名</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.2)",border:"1px solid rgba(255,255,255,.4)",borderRadius:"50%",width:36,height:36,color:"white",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>
      {submitted.length===0
        ?<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#6B7280",fontSize:15,flexDirection:"column",gap:12}}>
            <div>まだ提出者がいません</div>
            {notSubmitted.length>0&&<div style={{fontSize:13,color:"#9CA3AF"}}>未提出：{notSubmitted.join("、")}</div>}
          </div>
        :<div style={{flex:1,display:"flex",overflow:"hidden"}}>
          {/* 左固定：名前列（ヘッダー＋データ） */}
          <div style={{width:NW,flexShrink:0,display:"flex",flexDirection:"column",borderRight:"2px solid #E5E7EB",zIndex:2}}>
            {/* 名前ヘッダー */}
            <div style={{height:52,flexShrink:0,borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#6B7280",background:"#F9FAFB"}}>名前</div>
            {/* 名前データ（スクロール同期） */}
            <div ref={nameColRef} onScroll={syncScroll(nameColRef,dataColRef)} style={{flex:1,overflowY:"scroll",overflowX:"hidden",scrollbarWidth:"none"}}>
              {submitted.map(sub=>(
                <div key={sub.id} onClick={()=>handleNameClick(sub)}
                  style={{height:72,borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"center",padding:"6px",background:"white",cursor:"pointer",flexShrink:0}}
                  onMouseEnter={e=>e.currentTarget.style.background="#E8F9EE"}
                  onMouseLeave={e=>e.currentTarget.style.background="white"}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#1A1A2E",wordBreak:"break-all",lineHeight:1.3}}>{sub.staffName}</div>
                    <div style={{fontSize:10,color:"#06C755",marginTop:2}}>✎ 修正</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右スクロール：日付列（ヘッダー＋データ） */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* 日付ヘッダー（横スクロールは dataColRef に連動するためref設定） */}
            <div id="sm-date-header" style={{height:52,flexShrink:0,overflowX:"hidden",borderBottom:"1px solid #E5E7EB",background:"#F9FAFB",display:"flex"}}>
              {dates.map(ds=>{const d=pd(ds),m=d.getMonth()+1,day=d.getDate(),dow=d.getDay(),wd=WD[dow],iS=dow===6,iSu=dow===0||isHoliday(ds);return(
                <div key={ds} style={{width:CW,flexShrink:0,textAlign:"center",height:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRight:"1px solid #E5E7EB"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E"}}>{m}/{day}</div>
                  <div style={{fontSize:11,fontWeight:700,padding:"1px 6px",borderRadius:4,background:iS?"#EFF6FF":iSu?"#FFF0F1":"#F0F2F5",color:iS?"#3B82F6":iSu?"#FF4757":"#6B7280",marginTop:2}}>{wd}{isHoliday(ds)?"祝":""}</div>
                </div>
              );})}
              <div style={{width:COMMENT_W,flexShrink:0,height:52,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#6B7280",borderRight:"1px solid #E5E7EB"}}>コメント</div>
            </div>
            {/* データ本体（縦横スクロール・名前列と縦同期） */}
            <div ref={dataColRef} onScroll={syncScroll(dataColRef,nameColRef)} style={{flex:1,overflow:"auto"}}>
              {submitted.map(sub=>(
                <div key={sub.id} style={{display:"flex",height:72,borderBottom:"1px solid #E5E7EB",flexShrink:0}}>
                  {dates.map(ds=>{
                    const s=(sub.shifts||{})[ds]||null;
                    const iw=s&&s.status==="work";
                    const isEditing=editTarget&&editTarget.subId===sub.id&&editTarget.ds===ds;
                    return(
                      <div key={ds} onClick={()=>handleCellClick(sub,ds)}
                        style={{width:CW,flexShrink:0,height:72,padding:"4px",borderRight:"1px solid #E5E7EB",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,cursor:"pointer",background:isEditing?"#E8F9EE":"white"}}
                        onMouseEnter={e=>{if(!isEditing)e.currentTarget.style.background="#F9FAFB";}}
                        onMouseLeave={e=>{if(!isEditing)e.currentTarget.style.background=isEditing?"#E8F9EE":"white";}}>
                        {iw?(<>
                          <div style={{fontSize:10,fontWeight:700,background:"#E8F9EE",color:"#15803D",padding:"1px 5px",borderRadius:3,border:"1px solid #C2F0D2"}}>出勤</div>
                          <div style={{fontSize:11,fontWeight:700,color:"#1A1A2E",whiteSpace:"nowrap"}}>{s.start||"--:--"}</div>
                          <div style={{fontSize:9,color:"#9CA3AF"}}>〜</div>
                          <div style={{fontSize:11,fontWeight:700,color:"#1A1A2E",whiteSpace:"nowrap"}}>{s.end||"--:--"}</div>
                        </>):(<div style={{fontSize:13,color:"#D1D5DB"}}>🌙</div>)}
                      </div>
                    );
                  })}
                  <div style={{width:COMMENT_W,flexShrink:0,height:72,padding:"6px 8px",borderRight:"1px solid #E5E7EB",display:"flex",alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#6B7280",lineHeight:1.4,wordBreak:"break-all",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{sub.comment||""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      {editTarget&&(()=>{
        const sub=submitted.find(s=>s.id===editTarget.subId);
        const s=(sub?.shifts||{})[editTarget.ds]||{status:"holiday"};
        const d=pd(editTarget.ds);
        // 編集用state（元の時間を初期値として保持）
        return <CellEditPanel
          key={editTarget.subId+editTarget.ds}
          sub={sub} s={s} d={d}
          onApply={(status,start,end)=>applyCellEdit(editTarget.subId,editTarget.ds,status,start,end)}
          onClose={()=>setEditTarget(null)}
        />;
      })()}
      {notSubmitted.length>0&&<div style={{background:"white",borderTop:"1px solid #E5E7EB",padding:"10px 16px",flexShrink:0}}>
        <div style={{fontSize:12,fontWeight:700,color:"#9CA3AF",marginBottom:6}}>📋 未提出（{notSubmitted.length}名）</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {notSubmitted.map((n,i)=><span key={i} style={{fontSize:12,background:"#FFF0F1",color:"#FF4757",border:"1px solid rgba(255,71,87,.2)",padding:"3px 10px",borderRadius:20,fontWeight:600}}>{n}</span>)}
        </div>
      </div>}
    </div>
  );
}

// ============================================================
// 管理者ログイン
// ============================================================
function AdminLogin({settings,onAuth}){
  const[pw,setPw]=useState(""),[err,setErr]=useState("");
  const go=()=>{if(pw===(settings.password||DEFAULT_PW))onAuth();else{setErr("パスワードが違います");setPw("");}};
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 44px)",background:"#1A1A2E",padding:20}}>
      <div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",borderRadius:20,padding:"36px 28px",width:"100%",maxWidth:360,textAlign:"center",animation:"sI .3s"}}>
        <div style={{fontSize:48,marginBottom:12}}>🔐</div>
        <div style={{fontSize:20,fontWeight:700,color:"white",marginBottom:4}}>管理者ログイン</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.4)",marginBottom:24}}>パスワードを入力してください</div>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••••••" style={{width:"100%",padding:"13px 16px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:10,color:"white",fontSize:16,outline:"none",textAlign:"center",letterSpacing:".2em",marginBottom:12}}/>
        <button onClick={go} style={{width:"100%",padding:14,background:"#06C755",border:"none",borderRadius:10,color:"white",fontSize:16,fontWeight:700,cursor:"pointer"}}>ログイン</button>
        <div style={{fontSize:13,color:"#FF8C94",marginTop:10,minHeight:20}}>{err}</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,.25)",marginTop:6}}>初期PW: admin1234</div>
      </div>
    </div>
  );
}

// ============================================================
// 管理者画面
// ============================================================
function AdminView({settings,periods,subs,staffList,shops,currentShopId,saveSettings,savePeriods,saveSubs,saveStaff,saveShops,setCurrentShopId,logout,syncStatus}){
  const[tab,setTab]=useState("periods");
  const[toast,setToast]=useState(null);
  const[shopMenuOpen,setShopMenuOpen]=useState(false);
  const[shopEditMode,setShopEditMode]=useState(false);
  const tr=useRef();
  const tt=m=>{setToast(m);clearTimeout(tr.current);tr.current=setTimeout(()=>setToast(null),2500);};
  const currentShop=shops.find(s=>s.id===currentShopId)||shops[0];

  return(
    <div style={{background:"#1A1A2E",minHeight:"calc(100vh - 44px)"}}>
      {/* 管理ヘッダー */}
      <div style={{background:"#16213E",borderBottom:"1px solid rgba(255,255,255,.08)",padding:"12px 16px"}}>
        <div style={{maxWidth:900,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,background:"#06C755",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>⚙️</div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:15,fontWeight:700,color:"white"}}>シフト管理システム</div>
                {/* 店舗切り替えボタン */}
                <div style={{position:"relative"}}>
                  <button onClick={()=>setShopMenuOpen(v=>!v)} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.2)",borderRadius:8,padding:"4px 10px",color:"white",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    🏪 {currentShop?.name||"店舗"} ▼
                  </button>
                  {shopMenuOpen&&(
                    <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"white",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.2)",zIndex:200,minWidth:180,overflow:"hidden"}}>
                      {shops.map(sh=>(
                        <div key={sh.id} onClick={()=>{setCurrentShopId(sh.id);setShopMenuOpen(false);}} style={{padding:"11px 16px",cursor:"pointer",fontSize:14,fontWeight:sh.id===currentShopId?700:400,color:sh.id===currentShopId?"#06C755":"#1A1A2E",background:sh.id===currentShopId?"#E8F9EE":"white",display:"flex",alignItems:"center",gap:8}}>
                          {sh.id===currentShopId&&<span style={{fontSize:10}}>✓</span>}{sh.name}
                        </div>
                      ))}
                      <div style={{borderTop:"1px solid #E5E7EB",padding:"8px 10px",display:"flex",gap:6}}>
                        <button onClick={()=>{setShopEditMode(v=>!v);}} style={{flex:1,padding:"7px",background:"#F0F2F5",border:"none",borderRadius:8,fontSize:12,fontWeight:600,color:"#1A1A2E",cursor:"pointer"}}>⚙️ 店舗編集</button>
                        <button onClick={()=>{const name=prompt("新しい店舗名を入力");if(!name)return;const ns=makeShop(name.trim());saveShops([...shops,ns]);setCurrentShopId(ns.id);setShopMenuOpen(false);tt("✅ 店舗を追加しました");}} style={{flex:1,padding:"7px",background:"#06C755",border:"none",borderRadius:8,fontSize:12,fontWeight:700,color:"white",cursor:"pointer"}}>＋ 追加</button>
                      </div>
                      {shopEditMode&&<div style={{borderTop:"1px solid #E5E7EB",padding:"10px"}}>
                        {shops.map(sh=>(
                          <div key={sh.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                            <span style={{flex:1,fontSize:13,color:"#1A1A2E"}}>{sh.name}</span>
                            <button onClick={()=>{const name=prompt("店舗名を変更",sh.name);if(!name)return;saveShops(shops.map(s=>s.id===sh.id?{...s,name:name.trim()}:s));tt("✅ 変更しました");}} style={{padding:"4px 8px",background:"#F0F2F5",border:"none",borderRadius:6,fontSize:11,cursor:"pointer"}}>✏️</button>
                            {shops.length>1&&<button onClick={()=>{if(!confirm(`「${sh.name}」を削除しますか？`))return;const ns=shops.filter(s=>s.id!==sh.id);saveShops(ns);if(sh.id===currentShopId)setCurrentShopId(ns[0].id);tt("🗑️ 削除しました");}} style={{padding:"4px 8px",background:"rgba(255,71,87,.1)",border:"none",borderRadius:6,fontSize:11,color:"#FF4757",cursor:"pointer"}}>🗑️</button>}
                          </div>
                        ))}
                      </div>}
                    </div>
                  )}
                </div>
              </div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.4)"}}>管理者画面</div>
            </div>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["periods","📅 期間"],["staff","👥 スタッフ"],["candidates","📋 候補"],["submissions","📥 提出一覧"],["settings","⚙️ 設定"]].map(([id,l])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"7px 13px",background:tab===id?"#06C755":"rgba(255,255,255,.06)",border:`1px solid ${tab===id?"#06C755":"rgba(255,255,255,.1)"}`,borderRadius:7,color:"white",fontSize:12,fontWeight:600,cursor:"pointer",opacity:tab===id?1:.75}}>{l}</button>
            ))}
            <button onClick={logout} style={{padding:"7px 12px",background:"rgba(255,71,87,.15)",border:"1px solid rgba(255,71,87,.3)",borderRadius:7,color:"#FF8C94",fontSize:12,cursor:"pointer"}}>ログアウト</button>
          </div>
        </div>
      </div>
      <div style={{maxWidth:900,margin:"0 auto",padding:"20px 14px 60px"}}>
        {tab==="periods"&&<PeriodsTab periods={periods} subs={subs} staffList={staffList} shops={shops} onSave={savePeriods} tt={tt} shopId={currentShopId}/>}
        {tab==="staff"&&<StaffTab staffList={staffList} onSave={saveStaff} tt={tt}/>}
        {tab==="candidates"&&<CandTab settings={settings} onSave={saveSettings} tt={tt}/>}
        {tab==="submissions"&&<SubsTab subs={subs} periods={periods} staffList={staffList} onSave={saveSubs} tt={tt}/>}
        {tab==="settings"&&<SetTab settings={settings} onSave={saveSettings} subs={subs} saveSubs={saveSubs} tt={tt} syncStatus={syncStatus}/>}
      </div>
      {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"rgba(255,255,255,.12)",backdropFilter:"blur(10px)",color:"white",padding:"10px 20px",borderRadius:24,fontSize:14,fontWeight:500,zIndex:999,border:"1px solid rgba(255,255,255,.15)"}}>{toast}</div>}
    </div>
  );
}

// ===== 期間管理タブ =====
function PeriodsTab({periods,subs,staffList,shops,onSave,tt,shopId}){
  const[eid,setEid]=useState(null);
  const[form,setForm]=useState({label:"",startDate:"",endDate:"",deadlineDate:""});
  const[show,setShow]=useState(false);
  const[viewPeriodId,setViewPeriodId]=useState(null);
  const yr=td.getFullYear(),mo=td.getMonth()+1,ms=String(mo).padStart(2,"0");
  const nm=new Date(td.getFullYear(),td.getMonth()+1,1),nyr=nm.getFullYear(),nms=String(nm.getMonth()+1).padStart(2,"0");
  const lc=fd(new Date(yr,mo,0)),ln=fd(new Date(nyr,nm.getMonth()+1,0));
  const pre=[
    {label:`${yr}年${mo}月前半`,startDate:`${yr}-${ms}-01`,endDate:`${yr}-${ms}-15`},
    {label:`${yr}年${mo}月後半`,startDate:`${yr}-${ms}-16`,endDate:lc},
    {label:`${nyr}年${nm.getMonth()+1}月前半`,startDate:`${nyr}-${nms}-01`,endDate:`${nyr}-${nms}-15`},
    {label:`${nyr}年${nm.getMonth()+1}月後半`,startDate:`${nyr}-${nms}-16`,endDate:ln},
  ];
  const create=()=>{
    if(!form.startDate||!form.endDate){tt("⚠️ 開始日・終了日を入力");return;}
    const p={id:`p_${Date.now()}`,shopId,label:form.label||`${form.startDate.replace(/-/g,"/")}〜${form.endDate.replace(/-/g,"/")}`,startDate:form.startDate,endDate:form.endDate,deadlineDate:form.deadlineDate,createdAt:new Date().toISOString()};
    onSave([...periods,p]);setForm({label:"",startDate:"",endDate:"",deadlineDate:""});setShow(false);tt("✅ 期間を作成しました");
  };

  // 提出状況ビュー
  if(viewPeriodId){
    const vp=periods.find(p=>p.id===viewPeriodId);
    if(!vp)return null;
    return(
      <div>
        <button onClick={()=>setViewPeriodId(null)} style={{marginBottom:16,padding:"8px 16px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:8,color:"white",fontSize:13,cursor:"pointer"}}>← 期間一覧に戻る</button>
        <SmModal subs={subs} periods={periods} apid={viewPeriodId} onClose={()=>setViewPeriodId(null)} staffList={staffList} onEditSub={sub=>{const a=[...subs];const i=a.findIndex(s=>s.id===sub.id);if(i>=0)a[i]=sub;tt("✅ 更新しました");}}/>
      </div>
    );
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <AT>📅 期間管理</AT>
        <button onClick={()=>setShow(v=>!v)} style={{padding:"9px 16px",background:"#06C755",border:"none",borderRadius:9,color:"white",fontSize:13,fontWeight:700,cursor:"pointer"}}>＋ 新しい期間を作成</button>
      </div>
      {show&&<AC title="📝 新しい期間を作成">
        <AL>プリセット</AL>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14}}>
          {pre.map((p,i)=><button key={i} onClick={()=>setForm(f=>({...f,label:p.label,startDate:p.startDate,endDate:p.endDate}))} style={{padding:"6px 12px",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",borderRadius:7,color:"rgba(255,255,255,.85)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{p.label}</button>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:12}}>
          <div><AL>ラベル</AL><input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="例）7月前半" style={AI}/></div>
          <div><AL>開始日 *</AL><input type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} style={AI}/></div>
          <div><AL>終了日 *</AL><input type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} style={AI}/></div>
          <div><AL>締切日</AL><input type="date" value={form.deadlineDate} onChange={e=>setForm(f=>({...f,deadlineDate:e.target.value}))} style={AI}/></div>
        </div>
        {form.startDate&&form.endDate&&form.startDate<=form.endDate&&<div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginBottom:10}}>期間：{gd(form.startDate,form.endDate).length}日間</div>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={create} style={AB}>✅ 作成する</button>
          <button onClick={()=>setShow(false)} style={AGray}>キャンセル</button>
        </div>
      </AC>}

      {[...periods].reverse().map(p=>{
        const dates=gd(p.startDate,p.endDate),ip=idp(p.deadlineDate);
        const pUrl=buildUrl(shops,shopId,p);
        return(
          <div key={p.id} style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:18,marginBottom:12,cursor:"pointer"}} onClick={e=>{if(e.target.tagName==="BUTTON"||e.target.closest("button"))return;setViewPeriodId(p.id);}}>
            {eid===p.id
              ?<PEF period={p} onSave={u=>{onSave(periods.map(pp=>pp.id===p.id?{...pp,...u}:pp));tt("✅ 保存しました");setEid(null);}} onCancel={()=>setEid(null)}/>
              :<>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:"white",marginBottom:3}}>{p.label}</div>
                    <div style={{fontSize:13,color:"rgba(255,255,255,.6)"}}>{p.startDate?.replace(/-/g,"/")} 〜 {p.endDate?.replace(/-/g,"/")}（{dates.length}日間）</div>
                    {p.deadlineDate&&<div style={{fontSize:12,marginTop:3,color:ip?"#FF8C94":"rgba(255,255,255,.4)"}}>締切：{p.deadlineDate.replace(/-/g,"/")} {ip?"（済み）":""}</div>}
                    <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:4}}>提出：{subs.filter(s=>s.periodId===p.id).length}件</div>
                  </div>
                  <div style={{display:"flex",gap:5,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <button onClick={e=>{e.stopPropagation();setEid(p.id);}} style={{padding:"5px 9px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:6,color:"rgba(255,255,255,.8)",fontSize:11,cursor:"pointer"}}>✏️ 編集</button>
                    <button onClick={e=>{e.stopPropagation();expXl(p,subs,staffList,tt);}} style={{padding:"5px 9px",background:"linear-gradient(135deg,#217346,#1A5C38)",border:"none",borderRadius:6,color:"white",fontSize:11,fontWeight:700,cursor:"pointer"}}>📊 Excel</button>
                    <button onClick={e=>{e.stopPropagation();if(!confirm("削除しますか？"))return;onSave(periods.filter(pp=>pp.id!==p.id));tt("🗑️ 削除しました");}} style={AD}>削除</button>
                  </div>
                </div>
                {/* URLシェア */}
                <div style={{marginTop:10,padding:"8px 12px",background:"rgba(255,255,255,.04)",borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,.4)",flexShrink:0}}>🔗 URL</span>
                  <span style={{fontSize:11,color:"rgba(255,255,255,.5)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pUrl}</span>
                  <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(pUrl).then(()=>tt("✅ URLをコピーしました")).catch(()=>tt("URLをコピーできませんでした"));}} style={{padding:"4px 10px",background:"rgba(255,255,255,.1)",border:"none",borderRadius:6,color:"white",fontSize:11,cursor:"pointer",flexShrink:0}}>コピー</button>
                </div>
              </>
            }
          </div>
        );
      })}
    </div>
  );
}
function PEF({period,onSave,onCancel}){
  const[f,setF]=useState({label:period.label,startDate:period.startDate,endDate:period.endDate,deadlineDate:period.deadlineDate||""});
  return(<div onClick={e=>e.stopPropagation()}>
    <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.7)",marginBottom:10}}>✏️ 編集中</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:9,marginBottom:12}}>
      <div><AL>ラベル</AL><input value={f.label} onChange={e=>setF(p=>({...p,label:e.target.value}))} style={AI}/></div>
      <div><AL>開始日</AL><input type="date" value={f.startDate} onChange={e=>setF(p=>({...p,startDate:e.target.value}))} style={AI}/></div>
      <div><AL>終了日</AL><input type="date" value={f.endDate} onChange={e=>setF(p=>({...p,endDate:e.target.value}))} style={AI}/></div>
      <div><AL>締切日</AL><input type="date" value={f.deadlineDate} onChange={e=>setF(p=>({...p,deadlineDate:e.target.value}))} style={AI}/></div>
    </div>
    <div style={{display:"flex",gap:8}}><button onClick={()=>onSave(f)} style={AB}>💾 保存</button><button onClick={onCancel} style={AGray}>キャンセル</button></div>
  </div>);
}

// ===== Excel出力 =====
function expXl(p,subs,staffList,tt){
  const ss=subs.filter(s=>s.periodId===p.id);
  if(typeof XLSX==="undefined"){tt("⚠️ SheetJS未読込み");return;}
  const dates=gd(p.startDate,p.endDate);
  const submittedNames=ss.map(s=>s.staffName);
  const registeredOrder=staffList.filter(n=>submittedNames.includes(n));
  const unregistered=submittedNames.filter(n=>!registeredOrder.includes(n)).sort((a,b)=>a.localeCompare(b,"ja"));
  const sl=[...registeredOrder,...unregistered];
  if(sl.length===0){tt("⚠️ 提出データがありません");return;}

  // ============================================================
  // フォーマット：
  //   行1(ヘッダー上)： 空|空|名前1|名前1|名前2|名前2|...
  //   行2(ヘッダー下)： 日付|曜日|出勤|退勤|出勤|退勤|...
  //   行3以降(データ)： 各スタッフ1行、日付ごとに出勤・退勤を2列
  // ============================================================
  const headerRow1=["",""];
  const headerRow2=["日付","曜日"];
  sl.forEach(n=>{headerRow1.push(n,n);headerRow2.push("出勤","退勤");});

  const dataRows=[headerRow1,headerRow2];

  dates.forEach(ds=>{
    const d=pd(ds),disp=`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`,wd=WD[d.getDay()];
    const row=[disp,wd];
    sl.forEach(nm=>{
      const sub=ss.find(s=>s.staffName===nm),sh=sub?.shifts?.[ds];
      if(!sh||sh.status==="holiday"){row.push("","");}
      else{row.push(timeToNum(sh.start),timeToNum(sh.end));}
    });
    dataRows.push(row);
  });

  const ws=XLSX.utils.aoa_to_sheet(dataRows);
  const nc=2+sl.length*2;

  // 列幅
  ws["!cols"]=[{wch:12},{wch:4},...sl.flatMap(()=>[{wch:7},{wch:7}])];

  // スタイル：土=薄青、日祝=薄赤、休み=グレー斜線
  // ヘッダー行（row 0,1）
  for(let ri=0;ri<=1;ri++){
    for(let ci=0;ci<nc;ci++){
      const ref=XLSX.utils.encode_cell({r:ri,c:ci});
      if(!ws[ref])ws[ref]={v:"",t:"s"};
      ws[ref].s={fill:{patternType:"solid",fgColor:{rgb:"F0F0F0"}},font:{bold:true}};
    }
  }
  // データ行（row 2以降）
  dates.forEach((ds,ri)=>{
    const d=pd(ds),dow=d.getDay(),isSat=dow===6,isSunHol=dow===0||isHoliday(ds);
    const rowIdx=ri+2;
    const bgColor=isSat?"DDEEFF":isSunHol?"FFEEEE":null;
    for(let ci=0;ci<nc;ci++){
      const ref=XLSX.utils.encode_cell({r:rowIdx,c:ci});
      if(!ws[ref])ws[ref]={v:"",t:"s"};
      if(!ws[ref].s)ws[ref].s={};
      if(bgColor)ws[ref].s.fill={patternType:"solid",fgColor:{rgb:bgColor}};
    }
    sl.forEach((nm,si)=>{
      const sub=ss.find(s=>s.staffName===nm),sh=sub?.shifts?.[ds];
      if(!sh||sh.status==="holiday"){
        [2+si*2,2+si*2+1].forEach(ci=>{
          const ref=XLSX.utils.encode_cell({r:rowIdx,c:ci});
          if(!ws[ref])ws[ref]={v:"",t:"s"};
          if(!ws[ref].s)ws[ref].s={};
          ws[ref].s.fill={patternType:"solid",fgColor:{rgb:bgColor||"E8E8E8"}};
          ws[ref].s.border={diagonal:{style:"thin",color:{rgb:"999999"}},diagonalUp:true,diagonalDown:true};
        });
      }
    });
  });

  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"シフト一覧");
  const lb=p.label.slice(0,20).replace(/ /g,"_"),t=new Date();
  XLSX.writeFile(wb,`shift_${lb}_${t.getFullYear()}${String(t.getMonth()+1).padStart(2,"0")}${String(t.getDate()).padStart(2,"0")}.xlsx`);
  tt("✅ Excelをダウンロードしました");
}

// ===== スタッフ登録タブ =====
function StaffTab({staffList,onSave,tt}){
  const[newName,setNewName]=useState("");
  const add=()=>{if(!newName.trim()){tt("⚠️ 名前を入力");return;}if(staffList.includes(newName.trim())){tt("⚠️ 既に登録されています");return;}onSave([...staffList,newName.trim()]);setNewName("");tt(`✅ ${newName.trim()} を追加しました`);};
  const del=i=>{const a=[...staffList];a.splice(i,1);onSave(a);tt("🗑️ 削除しました");};
  const moveUp=i=>{if(i===0)return;const a=[...staffList];[a[i-1],a[i]]=[a[i],a[i-1]];onSave(a);};
  const moveDown=i=>{if(i===staffList.length-1)return;const a=[...staffList];[a[i],a[i+1]]=[a[i+1],a[i]];onSave(a);};
  return(
    <div>
      <AT>👥 スタッフ登録</AT>
      <AC title="スタッフ一覧">
        {staffList.length===0&&<div style={{fontSize:13,color:"rgba(255,255,255,.35)",marginBottom:12}}>スタッフが登録されていません</div>}
        {staffList.map((n,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,marginBottom:6}}>
            <span style={{fontSize:13,color:"rgba(255,255,255,.4)",minWidth:24,textAlign:"center"}}>{i+1}</span>
            <span style={{flex:1,fontSize:14,color:"white",fontWeight:600}}>{n}</span>
            <button onClick={()=>moveUp(i)} disabled={i===0} style={{padding:"4px 8px",background:"rgba(255,255,255,.08)",border:"none",borderRadius:5,color:"rgba(255,255,255,.6)",fontSize:12,cursor:i===0?"not-allowed":"pointer",opacity:i===0?.3:1}}>↑</button>
            <button onClick={()=>moveDown(i)} disabled={i===staffList.length-1} style={{padding:"4px 8px",background:"rgba(255,255,255,.08)",border:"none",borderRadius:5,color:"rgba(255,255,255,.6)",fontSize:12,cursor:i===staffList.length-1?"not-allowed":"pointer",opacity:i===staffList.length-1?.3:1}}>↓</button>
            <button onClick={()=>del(i)} style={AD}>削除</button>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="スタッフ名を入力" style={AI}/>
          <button onClick={add} style={AB}>＋ 追加</button>
        </div>
      </AC>
    </div>
  );
}

// ===== 候補管理タブ（複数選択対応）=====
function CandTab({settings,onSave,tt}){
  const[mode,setMode]=useState("global");
  const[selDows,setSelDows]=useState([1]);
  const[selDates,setSelDates]=useState([tds]);
  const[newDate,setNewDate]=useState(tds);
  // 複数選択用
  const[selStarts,setSelStarts]=useState([]);
  const[selEnds,setSelEnds]=useState([]);
  const[wSelStarts,setWSelStarts]=useState([]);
  const[wSelEnds,setWSelEnds]=useState([]);
  const[dSelStarts,setDSelStarts]=useState([]);
  const[dSelEnds,setDSelEnds]=useState([]);
  const[tmplName,setTmplName]=useState("");

  const toggleArr=(arr,setArr,val)=>setArr(prev=>prev.includes(val)?prev.filter(v=>v!==val):[...prev,val]);

  const addG=()=>{
    if(selStarts.length===0||selEnds.length===0){tt("⚠️ 開始・終了を選択してください");return;}
    const newC=[];
    selStarts.forEach(s=>selEnds.forEach(e=>{if(s<e||(Number(s.replace(":","")))<=Number(e.replace(":","")))newC.push({start:s,end:e});}));
    const merged=sc([...(settings.candidates||[]),...newC.filter(nc=>!(settings.candidates||[]).some(c=>c.start===nc.start&&c.end===nc.end))]);
    onSave({...settings,candidates:merged});setSelStarts([]);setSelEnds([]);tt(`✅ ${newC.length}件追加`);
  };
  const delG=i=>{const c=[...(settings.candidates||[])];c.splice(i,1);onSave({...settings,candidates:c});};

  const addW=()=>{
    if(wSelStarts.length===0||wSelEnds.length===0){tt("⚠️ 開始・終了を選択してください");return;}
    const w={...(settings.weekdayCandidates||{})};
    const newC=[];wSelStarts.forEach(s=>wSelEnds.forEach(e=>newC.push({start:s,end:e})));
    let total=0;
    selDows.forEach(dow=>{const b=w[dow]||[];const added=newC.filter(nc=>!b.some(c=>c.start===nc.start&&c.end===nc.end));w[dow]=sc([...b,...added]);total+=added.length;});
    onSave({...settings,weekdayCandidates:w});setWSelStarts([]);setWSelEnds([]);tt(`✅ ${selDows.map(d=>WD[d]).join("・")}に${total}件追加`);
  };
  const delW=(d,i)=>{const w={...(settings.weekdayCandidates||{})};w[d]=[...(w[d]||[])];w[d].splice(i,1);onSave({...settings,weekdayCandidates:w});tt("🗑️ 削除しました");};

  const addD=()=>{
    if(dSelStarts.length===0||dSelEnds.length===0){tt("⚠️ 開始・終了を選択してください");return;}
    const dc={...(settings.dateCandidates||{})};
    const newC=[];dSelStarts.forEach(s=>dSelEnds.forEach(e=>newC.push({start:s,end:e})));
    let total=0;
    selDates.forEach(dt=>{const added=newC.filter(nc=>!(dc[dt]||[]).some(c=>c.start===nc.start&&c.end===nc.end));dc[dt]=sc([...(dc[dt]||[]),...added]);total+=added.length;});
    onSave({...settings,dateCandidates:dc});setDSelStarts([]);setDSelEnds([]);tt(`✅ ${selDates.length}日付に${total}件追加`);
  };
  const delD=(dt,i)=>{const dc={...(settings.dateCandidates||{})};dc[dt]=[...(dc[dt]||[])];dc[dt].splice(i,1);if(dc[dt].length===0)delete dc[dt];onSave({...settings,dateCandidates:dc});};

  // テンプレート保存
  const saveTemplate=()=>{
    if(!tmplName.trim()){tt("⚠️ テンプレート名を入力");return;}
    const wdCopy={...(settings.weekdayCandidates||{})};
    const tmpl={name:tmplName.trim(),weekdayCandidates:wdCopy,savedAt:new Date().toISOString()};
    const ts=[...(settings.templates||[]),tmpl];
    onSave({...settings,templates:ts});setTmplName("");tt(`✅ テンプレート「${tmplName.trim()}」を保存しました`);
  };
  const applyTemplate=t=>{
    if(!confirm(`テンプレート「${t.name}」を適用しますか？現在の曜日別候補が上書きされます。`))return;
    onSave({...settings,weekdayCandidates:t.weekdayCandidates});tt(`✅ テンプレート「${t.name}」を適用しました`);
  };
  const delTemplate=i=>{const ts=[...(settings.templates||[])];ts.splice(i,1);onSave({...settings,templates:ts});tt("🗑️ 削除しました");};

  // 選択中の曜日の候補（複数選択時は全曜日の和集合）
  const wC=selDows.length===1?((settings.weekdayCandidates||{})[selDows[0]]||[]):[];
  // 選択中の日付の候補（複数選択時は全日付の和集合）
  const dC=selDates.length===1?((settings.dateCandidates||{})[selDates[0]]||[]):[];

  const MultiTimeSelect=({selected,onChange,label})=>(
    <div>
      <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginBottom:4}}>{label}（複数選択可）</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
        {TO.filter((_,i)=>i%2===0||TO[i]==="24:00").map(t=>(
          <button key={t} onClick={()=>onChange(t)} style={{padding:"4px 8px",fontSize:12,fontWeight:600,background:selected.includes(t)?"#06C755":"rgba(255,255,255,.08)",color:selected.includes(t)?"white":"rgba(255,255,255,.7)",border:`1px solid ${selected.includes(t)?"#06C755":"rgba(255,255,255,.15)"}`,borderRadius:6,cursor:"pointer"}}>{t}</button>
        ))}
      </div>
    </div>
  );

  return(
    <div>
      <AT>📋 候補管理</AT>
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[["global","🌐 全体"],["weekday","📆 曜日別"],["date","📌 日付別"],["template","📁 テンプレ"]].map(([id,l])=>(
          <button key={id} onClick={()=>setMode(id)} style={{padding:"8px 14px",background:mode===id?"#06C755":"rgba(255,255,255,.06)",border:`1px solid ${mode===id?"#06C755":"rgba(255,255,255,.1)"}`,borderRadius:8,color:"white",fontSize:13,fontWeight:600,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {mode==="global"&&<AC title="🌐 全体候補（優先度低）">
        <CL items={settings.candidates||[]} onDel={delG}/>
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <MultiTimeSelect selected={selStarts} onChange={v=>toggleArr(selStarts,setSelStarts,v)} label="開始時刻"/>
          <MultiTimeSelect selected={selEnds} onChange={v=>toggleArr(selEnds,setSelEnds,v)} label="終了時刻"/>
          <button onClick={addG} style={{...AB,alignSelf:"flex-start"}}>＋ 選択した組み合わせを追加</button>
        </div>
      </AC>}

      {mode==="weekday"&&<AC title="📆 曜日別候補（全体より優先）">
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:6}}>複数選択可（選択した全曜日にまとめて追加）</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
          {[0,1,2,3,4,5,6].map(d=>{const sel=selDows.includes(d);return(<button key={d} onClick={()=>setSelDows(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d])} style={{padding:"7px 14px",borderRadius:20,fontSize:13,fontWeight:700,border:"1px solid",cursor:"pointer",background:sel?(d===6?"#3B82F6":d===0?"#FF4757":"#06C755"):"rgba(255,255,255,.05)",borderColor:sel?"transparent":(d===6?"rgba(147,197,253,.3)":d===0?"rgba(252,165,165,.3)":"rgba(255,255,255,.15)"),color:sel?"white":(d===6?"#93C5FD":d===0?"#FCA5A5":"rgba(255,255,255,.6)")}}>{WD[d]}</button>);})}
        </div>
        {selDows.length===1&&<>
          <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.7)",marginBottom:8}}>{WD[selDows[0]]}曜日の登録済み候補</div>
          {wC.length===0&&<div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginBottom:8}}>未設定（デフォルト候補が使用されます）</div>}
          <CL items={wC} onDel={i=>delW(selDows[0],i)}/>
        </>}
        {selDows.length>1&&<div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:8,padding:"8px 12px",background:"rgba(255,255,255,.05)",borderRadius:8}}>
          選択中：{selDows.map(d=>WD[d]).join("・")} — 下で時刻を選んで追加します
        </div>}
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <MultiTimeSelect selected={wSelStarts} onChange={v=>toggleArr(wSelStarts,setWSelStarts,v)} label="開始時刻"/>
          <MultiTimeSelect selected={wSelEnds} onChange={v=>toggleArr(wSelEnds,setWSelEnds,v)} label="終了時刻"/>
          <button onClick={addW} style={{...AB,alignSelf:"flex-start"}}>＋ 追加</button>
        </div>
      </AC>}

      {mode==="date"&&<AC title="📌 日付別候補（最優先）">
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:6}}>複数選択可（選択した全日付にまとめて追加）</div>
        <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
          <input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} style={{...AI,maxWidth:180}}/>
          <button onClick={()=>{if(!selDates.includes(newDate))setSelDates(prev=>[...prev,newDate]);}} style={{...AB,padding:"10px 14px",fontSize:13}}>＋ 追加</button>
        </div>
        {selDates.length>0&&<div style={{marginBottom:10}}>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:6}}>選択中の日付：</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {selDates.sort().map(dt=>(
              <div key={dt} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(6,199,85,.15)",border:"1px solid rgba(6,199,85,.3)",borderRadius:8,padding:"4px 8px"}}>
                <span style={{fontSize:12,color:"#4ADE80",fontWeight:600}}>{dt.replace(/-/g,"/")}</span>
                <button onClick={()=>setSelDates(prev=>prev.filter(d=>d!==dt))} style={{background:"none",border:"none",color:"#4ADE80",cursor:"pointer",fontSize:14,lineHeight:1,padding:0}}>×</button>
              </div>
            ))}
          </div>
        </div>}
        {selDates.length===1&&<>
          <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.7)",marginBottom:8}}>{selDates[0].replace(/-/g,"/")} の登録済み候補</div>
          {dC.length===0&&<div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginBottom:8}}>未設定</div>}
          <CL items={dC} onDel={i=>delD(selDates[0],i)}/>
        </>}
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <MultiTimeSelect selected={dSelStarts} onChange={v=>toggleArr(dSelStarts,setDSelStarts,v)} label="開始時刻"/>
          <MultiTimeSelect selected={dSelEnds} onChange={v=>toggleArr(dSelEnds,setDSelEnds,v)} label="終了時刻"/>
          <button onClick={addD} style={{...AB,alignSelf:"flex-start"}}>＋ 追加（{selDates.length}日付に適用）</button>
        </div>
        {Object.keys(settings.dateCandidates||{}).length>0&&<div style={{marginTop:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,.5)",marginBottom:8}}>設定済みの日付</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>{Object.keys(settings.dateCandidates||{}).sort().map(dt=>{const sel=selDates.includes(dt);return(<button key={dt} onClick={()=>setSelDates(prev=>prev.includes(dt)?prev.filter(d=>d!==dt):[...prev,dt])} style={{padding:"4px 9px",borderRadius:6,background:sel?"#06C755":"rgba(255,255,255,.08)",border:`1px solid ${sel?"#06C755":"rgba(255,255,255,.15)"}`,color:"white",fontSize:11,fontWeight:600,cursor:"pointer"}}>{dt.replace(/-/g,"/")}（{((settings.dateCandidates||{})[dt]||[]).length}件）</button>);})}</div>
        </div>}
      </AC>}

      {mode==="template"&&<AC title="📁 曜日別候補テンプレート">
        <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:12}}>現在の曜日別候補をテンプレートとして保存し、後で再利用できます。</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={tmplName} onChange={e=>setTmplName(e.target.value)} placeholder="テンプレート名を入力" style={{...AI,flex:1}}/>
          <button onClick={saveTemplate} style={AB}>保存</button>
        </div>
        {(settings.templates||[]).length===0&&<div style={{fontSize:13,color:"rgba(255,255,255,.3)"}}>保存済みテンプレートはありません</div>}
        {(settings.templates||[]).map((t,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,marginBottom:6}}>
            <span style={{flex:1,fontSize:14,color:"white",fontWeight:600}}>{t.name}</span>
            <button onClick={()=>applyTemplate(t)} style={{...AB,padding:"6px 12px",fontSize:12}}>適用</button>
            <button onClick={()=>delTemplate(i)} style={AD}>削除</button>
          </div>
        ))}
      </AC>}
    </div>
  );
}

// ===== 提出一覧タブ =====
function SubsTab({subs,periods,staffList,onSave,tt}){
  const[fn,setFn]=useState(""),[fp,setFp]=useState("all");
  const[sf,setSf]=useState("submittedAt"),[sdr,setSdr]=useState("desc");
  const[det,setDet]=useState(null);
  const tg=f=>{if(sf===f)setSdr(d=>d==="asc"?"desc":"asc");else{setSf(f);setSdr("asc");}};
  const fil=subs.filter(s=>(!fn||s.staffName.includes(fn))&&(fp==="all"||s.periodId===fp)).sort((a,b)=>{let va=sf==="submittedAt"?new Date(a[sf]).getTime():(a[sf]||""),vb=sf==="submittedAt"?new Date(b[sf]).getTime():(b[sf]||"");return(va<vb?-1:va>vb?1:0)*(sdr==="asc"?1:-1);});
  const gpl=id=>periods.find(p=>p.id===id)?.label||"不明";
  return(<div>
    <AT>📥 提出一覧</AT>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      <input value={fn} onChange={e=>setFn(e.target.value)} placeholder="🔍 氏名で絞り込み" style={{flex:1,minWidth:130,padding:"10px 14px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:"white",fontSize:14,outline:"none"}}/>
      <select value={fp} onChange={e=>setFp(e.target.value)} style={{padding:"10px 12px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:"white",fontSize:13,outline:"none",cursor:"pointer"}}>
        <option value="all" style={{background:"#1A1A2E"}}>全期間</option>
        {periods.map(p=><option key={p.id} value={p.id} style={{background:"#1A1A2E"}}>{p.label}</option>)}
      </select>
    </div>
    <div style={{marginBottom:12,fontSize:13,color:"rgba(255,255,255,.5)"}}>件数：<strong style={{color:"#4ADE80",fontSize:16}}>{fil.length}</strong></div>
    <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr>
            {[["staffName","氏名"],["submittedAt","提出日時"]].map(([f,l])=><th key={f} onClick={()=>tg(f)} style={{background:"rgba(255,255,255,.08)",color:"rgba(255,255,255,.7)",padding:"10px 14px",textAlign:"left",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",borderBottom:"1px solid rgba(255,255,255,.08)"}}>{l}{sf===f?(sdr==="asc"?" ▲":" ▼"):" ↕"}</th>)}
            {["期間","出勤","休み","操作"].map(h=><th key={h} style={{background:"rgba(255,255,255,.08)",color:"rgba(255,255,255,.7)",padding:"10px 14px",textAlign:"left",fontWeight:600,whiteSpace:"nowrap",borderBottom:"1px solid rgba(255,255,255,.08)"}}>{h}</th>)}
          </tr></thead>
          <tbody>{fil.length===0
            ?<tr><td colSpan={6} style={{textAlign:"center",color:"rgba(255,255,255,.3)",padding:24}}>提出データがありません</td></tr>
            :fil.map(sub=>{const ds=Object.keys(sub.shifts||{}).sort(),wk=ds.filter(d=>sub.shifts[d]&&sub.shifts[d].status==="work").length,at=new Date(sub.submittedAt).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});return(<tr key={sub.id}>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.9)",fontWeight:600}}>{sub.staffName}</td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.6)",whiteSpace:"nowrap"}}>{at}</td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.6)",fontSize:12}}>{gpl(sub.periodId)}</td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)"}}><span style={{background:"rgba(6,199,85,.15)",color:"#4ADE80",border:"1px solid rgba(6,199,85,.3)",padding:"2px 8px",borderRadius:4,fontSize:12,fontWeight:600}}>{wk}日</span></td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)"}}><span style={{background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.5)",padding:"2px 8px",borderRadius:4,fontSize:12}}>{ds.length-wk}日</span></td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",whiteSpace:"nowrap"}}>
                <button onClick={()=>setDet(sub)} style={{padding:"5px 10px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:6,color:"rgba(255,255,255,.8)",fontSize:12,cursor:"pointer",marginRight:4}}>詳細</button>
                <button onClick={()=>{if(!confirm("削除しますか？"))return;onSave(subs.filter(s=>s.id!==sub.id));tt("🗑️ 削除しました");}} style={AD}>削除</button>
              </td>
            </tr>);})}
          </tbody>
        </table>
      </div>
    </div>
    {det&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:500,display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fI .2s"}} onClick={()=>setDet(null)}>
      <div style={{background:"#1E2130",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:560,maxHeight:"88vh",overflow:"hidden",display:"flex",flexDirection:"column",animation:"sU .25s"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:36,height:4,background:"rgba(255,255,255,.15)",borderRadius:2,margin:"10px auto 0"}}/>
        <div style={{padding:"12px 20px 14px",borderBottom:"1px solid rgba(255,255,255,.08)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontSize:16,fontWeight:700,color:"white"}}>{det.staffName}</div><div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:2}}>{gpl(det.periodId)} ／ {new Date(det.submittedAt).toLocaleString("ja-JP")} 提出</div></div>
          <button onClick={()=>setDet(null)} style={{background:"rgba(255,255,255,.08)",border:"none",borderRadius:"50%",width:32,height:32,color:"rgba(255,255,255,.7)",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",padding:"8px 16px 24px"}}>
          {det.comment&&<div style={{background:"rgba(255,255,255,.05)",borderRadius:8,padding:"10px 12px",margin:"8px 0",fontSize:13,color:"rgba(255,255,255,.7)"}}>💬 {det.comment}</div>}
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>{["日付","区分","出勤","退勤"].map(h=><th key={h} style={{background:"rgba(255,255,255,.08)",color:"rgba(255,255,255,.7)",padding:"8px 12px",textAlign:"left",fontWeight:600}}>{h}</th>)}</tr></thead>
            <tbody>{Object.keys(det.shifts||{}).sort().map(ds=>{const d=pd(ds),s=det.shifts[ds],iw=s&&s.status==="work";return(<tr key={ds}>
              <td style={{padding:"9px 12px",borderBottom:"1px solid rgba(255,255,255,.04)",color:"rgba(255,255,255,.7)"}}>{d.getMonth()+1}/{d.getDate()}（{WD[d.getDay()]}）</td>
              <td style={{padding:"9px 12px",borderBottom:"1px solid rgba(255,255,255,.04)"}}>{iw?<span style={{background:"rgba(6,199,85,.15)",color:"#4ADE80",border:"1px solid rgba(6,199,85,.3)",padding:"2px 7px",borderRadius:4,fontSize:12,fontWeight:600}}>出勤</span>:<span style={{background:"rgba(255,255,255,.06)",color:"rgba(255,255,255,.5)",padding:"2px 7px",borderRadius:4,fontSize:12}}>休み</span>}</td>
              <td style={{padding:"9px 12px",borderBottom:"1px solid rgba(255,255,255,.04)",color:"rgba(255,255,255,.8)"}}>{iw?s.start:"-"}</td>
              <td style={{padding:"9px 12px",borderBottom:"1px solid rgba(255,255,255,.04)",color:"rgba(255,255,255,.8)"}}>{iw?s.end:"-"}</td>
            </tr>);})}
            </tbody>
          </table>
        </div>
      </div>
    </div>}
  </div>);
}

// ===== 設定タブ =====
function SetTab({settings,onSave,subs,saveSubs,tt,syncStatus}){
  const[pw,setPw]=useState("");
  // データエクスポート（JSON）
  const exportData=()=>{
    const data=JSON.stringify(subs,null,2);
    const blob=new Blob([data],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`shift_subs_${fd(new Date())}.json`;a.click();URL.revokeObjectURL(url);
    tt("✅ 提出データをエクスポートしました");
  };
  // データインポート（JSON）→ 既存データとマージ
  const importData=()=>{
    const input=document.createElement("input");input.type="file";input.accept=".json";
    input.onchange=e=>{
      const file=e.target.files[0];if(!file)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        try{
          const imported=JSON.parse(ev.target.result);
          if(!Array.isArray(imported)){tt("⚠️ 無効なファイルです");return;}
          // マージ（同一id は上書き、新規は追加）
          const merged=[...subs];
          imported.forEach(sub=>{
            const idx=merged.findIndex(s=>s.id===sub.id);
            if(idx>=0)merged[idx]=sub;else merged.push(sub);
          });
          saveSubs(merged);tt(`✅ ${imported.length}件をインポートしました（合計${merged.length}件）`);
        }catch{tt("⚠️ ファイルの読み込みに失敗しました");}
      };
      reader.readAsText(file);
    };
    input.click();
  };
  return(<div>
    <AT>⚙️ システム設定</AT>
    <AC title="🔴 リアルタイム同期（Firebase）">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"12px 14px",background:"rgba(255,255,255,.05)",borderRadius:10}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:syncStatus==="online"?"#06C755":syncStatus==="offline"?"#F59E0B":"#6B7280",flexShrink:0}}/>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"white"}}>
            {syncStatus==="online"?"接続中 — リアルタイム同期中":syncStatus==="offline"?"オフライン — ローカル保存中":"Firebase未設定 — ローカル保存中"}
          </div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>
            {syncStatus==="no_config"?"app.js の FIREBASE_CONFIG に設定を貼り付けてください":"全端末の変更が即座に反映されます"}
          </div>
        </div>
      </div>
      {syncStatus==="no_config"&&<div style={{fontSize:12,color:"rgba(255,255,255,.5)",lineHeight:1.8,padding:"10px 14px",background:"rgba(255,255,255,.04)",borderRadius:8}}>
        <strong style={{color:"white"}}>設定手順：</strong><br/>
        1. <a href="https://console.firebase.google.com" target="_blank" style={{color:"#60A5FA"}}>Firebase Console</a> でプロジェクトを作成<br/>
        2. 「Realtime Database」を作成（テストモードで開始）<br/>
        3. プロジェクト設定 → マイアプリ → SDK設定からconfigをコピー<br/>
        4. app.js の FIREBASE_CONFIG に貼り付けて保存
      </div>}
    </AC>
    <AC title="🔐 パスワード変更">
      <AL>新しいパスワード</AL>
      <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="新しいパスワードを入力" style={{...AI,maxWidth:280}}/>
      <div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginTop:4}}>初期パスワード: admin1234</div>
      <div style={{marginTop:12}}><button onClick={()=>{if(!pw){tt("⚠️ 入力してください");return;}onSave({...settings,password:pw});setPw("");tt("✅ 変更しました");}} style={AB}>🔐 変更する</button></div>
    </AC>
    <AC title="📤 データ統合（別端末との同期）">
      <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:14,lineHeight:1.7}}>
        別の端末（スマホ・PC）で提出されたデータを統合するには：<br/>
        ①この端末でエクスポート → ②相手端末でインポート、またはその逆を行ってください。
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={exportData} style={{...AB,background:"#3B82F6"}}>📥 提出データをエクスポート（JSON）</button>
        <button onClick={importData} style={{...AB,background:"#8B5CF6"}}>📤 JSONからインポート（マージ）</button>
      </div>
    </AC>
  </div>);
}

// ============================================================
// 共通UIパーツ
// ============================================================
function AC({title,children}){return(<div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:20,marginBottom:16}}><div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,.85)",marginBottom:14}}>{title}</div>{children}</div>);}
function AL({children}){return(<label style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,.6)",display:"block",marginBottom:6}}>{children}</label>);}
function AT({children}){return(<div style={{fontSize:18,fontWeight:700,color:"white",marginBottom:16}}>{children}</div>);}
function CL({items,onDel}){return items.map((c,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,marginBottom:6}}><span style={{flex:1,fontSize:14,color:"rgba(255,255,255,.9)",fontWeight:500}}>{c.start} 〜 {c.end}</span><button onClick={()=>onDel(i)} style={AD}>削除</button></div>));}
const AI={width:"100%",padding:"11px 14px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:"white",fontSize:14,outline:"none"};
const AB={padding:"10px 18px",background:"#06C755",border:"none",borderRadius:9,color:"white",fontSize:14,fontWeight:700,cursor:"pointer"};
const AD={padding:"6px 11px",background:"rgba(255,71,87,.15)",border:"1px solid rgba(255,71,87,.3)",borderRadius:6,color:"#FF8C94",fontSize:12,fontWeight:600,cursor:"pointer"};
const AGray={padding:"10px 16px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer"};

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
