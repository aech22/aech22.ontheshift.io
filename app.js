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
// 日本の祝日（固定祝日 + ハッピーマンデー + 年ごと変動）
// 固定祝日: MMDD形式
const JH_FIXED=new Set(["0101","0211","0223","0429","0503","0504","0505","0811","1103","1123"]);
// 年別祝日（振替・ハッピーマンデー含む）: YYYYMMDD形式
const JH_DATES=new Set([
  // 2025
  "20250101","20250113","20250211","20250223","20250320","20250429","20250503","20250504","20250505",
  "20250721","20250811","20250915","20250923","20251013","20251103","20251123","20251124",
  // 2026
  "20260101","20260112","20260211","20260223","20260320","20260429","20260503","20260504","20260505",
  "20260720","20260811","20260921","20260922","20260923","20261012","20261103","20261123",
  // 2027
  "20270101","20270111","20270211","20270223","20270321","20270322","20270429","20270503","20270504","20270505",
  "20270719","20270811","20270920","20270923","20271011","20271103","20271123",
]);
function isHoliday(dateStr){
  const d=pd(dateStr);
  const yyyymmdd=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const mmdd=yyyymmdd.slice(4);
  return JH_DATES.has(yyyymmdd)||JH_FIXED.has(mmdd);
}
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
function gto(){
  const o=[];
  // 9:00〜24:00（15分刻み）
  for(let h=9;h<=24;h++){
    const ms=h===24?[0]:[0,15,30,45];
    for(const m of ms) o.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  }
  // 翌0:15〜翌3:00（25:00〜27:00形式、15分刻み）
  for(let h=25;h<=27;h++){
    const ms=h===27?[0]:[0,15,30,45];
    for(const m of ms) o.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  }
  return o;
}
const TO=gto();
function idp(d){return d?new Date()>new Date(d+"T23:59:59"):false;}
function lg(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function ls(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function sc(cs){return[...cs].sort((a,b)=>{const ta=Number(a.start.replace(":","").replace(":","")),tb=Number(b.start.replace(":","").replace(":","")),ea=Number(a.end.replace(":","").replace(":","")),eb=Number(b.end.replace(":","").replace(":",""));return ta!==tb?ta-tb:ea-eb;});}
// 時刻→数値（Excelフォーマット用）HH:MM → H.5 / H形式
function timeToNum(t){if(!t)return"";const[h,m]=t.split(":").map(Number);return m===0?h:h+m/60;}
// 祝日判定（簡易）
// isHoliday は上で定義済み
function isWeekend(dateStr){const dow=pd(dateStr).getDay();return dow===0||dow===6||isHoliday(dateStr);}

const td=new Date(),tds=fd(td);

// ===== ストレージキー（店舗IDベース）=====
function storeKey(shopId,key){return`shift_${shopId}_${key}`;}

// ===== 初期データ =====
function makeShop(name="店舗1"){return{id:`shop_${Date.now()}`,name,createdAt:new Date().toISOString()};}
function makePeriod(shopId){
  const yr=td.getFullYear(),mo=td.getMonth()+1,ms=String(mo).padStart(2,"0");
  return{id:`p_${Date.now()}`,urlToken:genToken(),shopId,label:`${yr}年${mo}月前半`,startDate:`${yr}-${ms}-01`,endDate:`${yr}-${ms}-15`,deadlineDate:"",createdAt:new Date().toISOString()};
}
function makeSettings(shopId){
  return{shopId,password:DEFAULT_PW,candidates:CAND_WEEKDAY,weekdayCandidates:{0:CAND_WEEKEND,6:CAND_WEEKEND},dateCandidates:{},templates:[]};
}

// ===== URL生成・解析 =====
// 形式: #/<urlToken>  例: #/a3f8x2k9
// urlTokenはperiod作成時にランダム生成、period.urlTokenに保存
// periodIdとは独立したランダム文字列で推測不可能

function genToken(){
  // 8文字のランダム英数字
  const chars="abcdefghijkmnpqrstuvwxyz23456789";
  let t="";
  for(let i=0;i<8;i++) t+=chars[Math.floor(Math.random()*chars.length)];
  return t;
}

function buildUrl(shops,shopId,period){
  if(!period)return "";
  const token=period.urlToken||period.id;
  return`${window.location.origin}${window.location.pathname}#/${token}`;
}

function parseUrl(){
  const h=window.location.hash;
  if(h.startsWith("#/")){
    const token=h.slice(2);
    if(token) return{token};
  }
  if(h.startsWith("#p="))return{token:h.slice(3)}; // 旧形式互換
  return null;
}

// URLからshopId+periodを解決
function resolvePeriodFromUrl(shops,allPeriods){
  const parsed=parseUrl();
  if(!parsed||!parsed.token)return null;
  const token=parsed.token;
  // urlToken または id で検索（旧形式互換）
  const found=allPeriods.find(p=>p.urlToken===token||p.id===token);
  if(found){
    const shopId=found.shopId||shops[0]?.id;
    return{period:found,shopId};
  }
  return null;
}

// ============================================================
// メインアプリ
// ============================================================
// ============================================================
// メインアプリ - 3フェーズ初期化
// ============================================================

// リロード時の状態復元用セッションキー
const SS_SHOP="ss_shopId";
const SS_APID="ss_apid";
const SS_VIEW="ss_view";
const SS_TAB="ss_tab";
function ssGet(k,fb){try{const v=sessionStorage.getItem(k);return v!==null?v:fb;}catch{return fb;}}
function ssSave(k,v){try{if(v)sessionStorage.setItem(k,v);else sessionStorage.removeItem(k);}catch{}}
function App(){
  const[syncStatus,setSyncStatus]=useState("init");
  const[ready,setReady]=useState(false); // Phase1完了フラグ

  const[shops,setShops]=useState([]);
  // URLにtokenがある場合はsessionStorageを無視してPhase1で確定
  const _hasUrlToken=!!(parseUrl()?.token);
  const[currentShopId,setCurrentShopId]=useState(()=>_hasUrlToken?null:ssGet(SS_SHOP,null));
  const currentShopIdRef=useRef(_hasUrlToken?null:ssGet(SS_SHOP,null));
  const[view,setView]=useState(()=>_hasUrlToken?"staff":ssGet(SS_VIEW,"staff"));
  const[auth,setAuth]=useState(true); // パスワード廃止
  const[settings,setSettings]=useState(null);
  const[periods,setPeriods]=useState([]);
  const[staffList,setStaffList]=useState([]);
  const[subs,setSubs]=useState([]);
  // URLトークンがある場合はapidもPhase1で確定させる
  const[apid,setApid]=useState(()=>_hasUrlToken?null:ssGet(SS_APID,null));
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
        if(typeof val==="object"&&!Array.isArray(val)){
          sh=Object.values(val).filter(s=>s&&s.id);
        } else {
          sh=(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
        }
      } else {
        const local=lg("shift_shops_v6",null);
        sh=local&&local.length>0?local:[makeShop("メイン店舗")];
        const shObj={};
        sh.forEach(s=>{ if(s&&s.id) shObj[s.id]=s; });
        firebaseDB.ref("global/shops").set(shObj);
      }
      setShops(sh);
      ls("shift_shops_v6",sh);

      // URLにtokenがある場合: 全店舗のperiodsを横断検索してshopを特定
      const parsed=parseUrl();
      if(parsed&&parsed.token){
        const token=parsed.token;
        Promise.all(
          sh.map(shop=>
            firebaseDB.ref(fbPath(shop.id,"periods")).once("value")
              .then(s=>{
                const v=s.val();
                if(!v)return{shop,periods:[]};
                const arr=typeof v==="object"&&!Array.isArray(v)
                  ?Object.values(v).filter(Boolean)
                  :Array.isArray(v)?v.filter(Boolean):[];
                return{shop,periods:arr};
              }).catch(()=>({shop,periods:[]}))
          )
        ).then(results=>{
          let matched=null;
          for(const {shop,periods:ps} of results){
            const found=ps.find(p=>p.urlToken===token||p.id===token);
            if(found){matched={shop,period:found};break;}
          }
          if(matched){
            console.log("URL解決(Phase1): shop=",matched.shop.name,"period=",matched.period.label);
            currentShopIdRef.current=matched.shop.id;
            setCurrentShopId(matched.shop.id);
            setApid(matched.period.id);
            setUrlResolved(true);
            startSubscriptions(matched.shop.id,sh);
          } else {
            console.warn("token一致なし(Phase1):", token);
            const savedShopId=ssGet(SS_SHOP,null);
            const restoredShop=savedShopId?sh.find(s=>s.id===savedShopId):null;
            const fallback=restoredShop||sh[0];
            currentShopIdRef.current=fallback.id;
            setCurrentShopId(fallback.id);
            startSubscriptions(fallback.id,sh);
          }
          setReady(true);
        }).catch(()=>{
          const savedShopId=ssGet(SS_SHOP,null);
          const restoredShop=savedShopId?sh.find(s=>s.id===savedShopId):null;
          const fallback=restoredShop||sh[0];
          setCurrentShopId(fallback.id);
          startSubscriptions(fallback.id,sh);
          setReady(true);
        });
      } else {
        // URLなし: セッションに保存された店舗があれば復元、なければshops[0]
        const savedShopId=ssGet(SS_SHOP,null);
        const restoredShop=savedShopId?sh.find(s=>s.id===savedShopId):null;
        const targetShop=restoredShop||sh[0];
        currentShopIdRef.current=targetShop.id;
        setCurrentShopId(targetShop.id);
        // Phase1内で購読開始（sidが確定した直後）
        startSubscriptions(targetShop.id,sh);
        setReady(true);
      }
    }).catch(e=>{
      console.warn("shops読み込み失敗:",e);
      const local=lg("shift_shops_v6",null)||[makeShop("メイン店舗")];
      setShops(local); setCurrentShopId(local[0].id);
      startSubscriptions(local[0].id,local);
      setReady(true);
    });

    return()=>{ if(firebaseDB) firebaseDB.ref(".info/connected").off(); };
  },[]);

  const shop=shops.find(s=>s.id===currentShopId)||shops[0];
  const sid=shop?.id||"default";
  // refとsessionStorageを最新のsidに同期（URLトークンがある場合は保存しない）
  useEffect(()=>{
    currentShopIdRef.current=sid;
    if(!_hasUrlToken) ssSave(SS_SHOP,sid);
  },[sid]);

  // 共有テンプレート（全店舗共通: global/templates）
  const[globalTemplates,setGlobalTemplates]=useState(()=>lg("shift_global_templates",[]));
  const saveGlobalTemplates=useCallback(v=>{
    setGlobalTemplates(v);
    ls("shift_global_templates",v);
    if(firebaseDB) firebaseDB.ref("global/templates").set(v).catch(e=>console.warn("templates保存失敗:",e));
  },[]);
  useEffect(()=>{ if(!_hasUrlToken) ssSave(SS_APID,apid); },[apid]);
  useEffect(()=>{ if(!_hasUrlToken) ssSave(SS_VIEW,view); },[view]);

  // startSubscriptions: Phase1内でsid確定直後に呼ぶ（useEffectに依存しない）
  const activeSubsRef=useRef([]); // 購読中のrefリスト（クリーンアップ用）
  const startSubscriptions=useCallback((targetSid,shopList)=>{
    if(!firebaseDB)return;
    // 既存の購読を解除
    activeSubsRef.current.forEach(r=>r.off());
    activeSubsRef.current=[];
    const refs=activeSubsRef.current;
    const on=(path,cb)=>{
      const r=firebaseDB.ref(path);
      r.on("value",snap=>cb(snap.val()),err=>console.warn("購読失敗:",path,err));
      refs.push(r);
    };
    console.log("購読開始 targetSid=",targetSid);

    // global/templates（全店舗共通）
    on("global/templates",val=>{
      if(!val)return;
      const arr=Array.isArray(val)?val.filter(Boolean):Object.values(val);
      setGlobalTemplates(arr);
      ls("shift_global_templates",arr);
    });

    // global/shops
    on("global/shops",val=>{
      if(!val)return;
      const arr=typeof val==="object"&&!Array.isArray(val)
        ?Object.values(val).filter(s=>s&&s.id)
        :(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
      if(arr.length>0){ setShops(arr); ls("shift_shops_v6",arr); }
    });
    // settings
    on(fbPath(targetSid,"settings"),val=>{
      if(val&&typeof val==="object"){ setSettings(val); ls(storeKey(targetSid,"settings_v6"),val); }
      else{ setSettings(makeSettings(targetSid)); }
    });
    // periods
    on(fbPath(targetSid,"periods"),val=>{
      if(!val)return;
      const arr=typeof val==="object"&&!Array.isArray(val)
        ?Object.values(val).filter(p=>p&&p.id)
        :(Array.isArray(val)?val:Object.values(val)).filter(p=>p&&p.id);
      if(arr.length>0){
        arr.sort((a,b)=>new Date(b.startDate||0)-new Date(a.startDate||0));
        setPeriods(arr); ls(storeKey(targetSid,"periods_v6"),arr);
      }
    });
    // staff
    on(fbPath(targetSid,"staff"),val=>{
      if(!val){ setStaffList([]); return; }
      const arr=Array.isArray(val)
        ?val.filter(s=>s&&typeof s==="string")
        :typeof val==="object"?Object.values(val).filter(s=>s&&typeof s==="string"):[];
      setStaffList(arr); ls(storeKey(targetSid,"staff_v6"),arr);
    });
    // subs
    setSubs([]);
    on(fbPath(targetSid,"subs"),val=>{
      if(!val){ setSubs([]); ls(storeKey(targetSid,"subs_v6"),[]); return; }
      const arr=typeof val==="object"&&!Array.isArray(val)
        ?Object.values(val).filter(s=>s&&s.id)
        :(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id);
      arr.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));
      setSubs(arr); ls(storeKey(targetSid,"subs_v6"),arr);
      console.log("subs受信:",arr.length,"件 sid=",targetSid);
    });
    // settingsデフォルト書き込み
    firebaseDB.ref(fbPath(targetSid,"settings")).once("value").then(snap=>{
      if(!snap.val()) firebaseDB.ref(fbPath(targetSid,"settings")).set(makeSettings(targetSid));
    });
  },[]);

  // URLにtokenが含まれるか（スタッフ専用モード・期間固定）
  const [urlLocked]=useState(()=>{ const p=parseUrl(); return !!(p&&p.token); });

  // ===================================================================
  // Phase3: URLなし時のapid初期化（セッション復元優先）
  // ===================================================================
  useEffect(()=>{
    if(!ready||urlResolved)return;
    if(periods.length===0)return; // periodsが届くまで待機
    // URLトークンがある場合はPhase1で解決済みなのでPhase3では何もしない
    if(_hasUrlToken){
      // apidはPhase1でセット済み。未セットの場合だけperiods[0]を使う
      if(!apid&&periods.length>0) setApid(periods[0].id);
      setUrlResolved(true);
      return;
    }
    // URLなし: セッションに保存されたapidがperiodsに存在するか確認
    const savedApid=ssGet(SS_APID,null);
    const restored=savedApid?periods.find(p=>p.id===savedApid):null;
    if(restored){
      setApid(restored.id);
    } else if(!apid){
      setApid(periods[0].id);
    }
    setUrlResolved(true);
  },[ready,periods,urlResolved]);

  // periodsが来たらapidを設定（URLで指定済みの場合は上書きしない）
  useEffect(()=>{
    if(!apid&&periods.length>0&&urlResolved)setApid(periods[0].id);
  },[periods,urlResolved]);

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
    // Firebase には update() でマージ書き込み（set()は他端末データを上書きするためNG）
    if(firebaseDB){
      const obj={};
      v.forEach(s=>{ if(s&&s.id) obj[s.id]=s; });
      firebaseDB.ref(fbPath(sid,"subs")).update(obj).catch(e=>console.warn("subs書き込み失敗:",e));
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

  // ap: apidに対応するperiodを取得
  // urlLocked時はapidが確定するまでperiods[0]を使わない
  const ap=periods.find(p=>p.id===apid)||(urlLocked?null:periods[0]);
  const effectiveSettings=settings||makeSettings(sid);

  // ローディング画面（Phase1完了まで、またはURLモードでperiodsが届くまで）
  if(!ready||(urlLocked&&!apid)) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#1A1A2E",flexDirection:"column",gap:16}}>
      <div style={{fontSize:40}}>📅</div>
      <div style={{color:"white",fontSize:16,fontWeight:700}}>シフト管理システム</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13}}>データを読み込み中...</div>
    </div>
  );

  return(
    <div style={{fontFamily:"'Hiragino Sans','Yu Gothic',sans-serif",minHeight:"100vh",background:view==="admin"?"#1A1A2E":"#F0F2F5"}}>
      {/* 同期ステータスバー（接続中以外のみ表示） */}
      {syncStatus!=="online"&&<div style={{background:syncStatus==="offline"?"#F59E0B":"#6B7280",color:"white",fontSize:11,fontWeight:700,textAlign:"center",padding:"4px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>{syncStatus==="offline"?"🟡 オフライン（再接続中...）":syncStatus==="no_config"?"⚙️ Firebase未設定":"⏳ 接続中..."}</span>
        <button onClick={()=>{
          if(!firebaseDB){alert("firebaseDB=null\nFirebase SDKが読み込まれていません");return;}
          firebaseDB.ref("debug_test").set({t:Date.now(),msg:"接続テスト"})
            .then(()=>alert("✅ Firebase書き込み成功！\n同期は正常です"))
            .catch(e=>alert("❌ Firebase書き込み失敗:\n"+e.message));
        }} style={{background:"rgba(255,255,255,.25)",border:"none",borderRadius:6,padding:"2px 8px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔍 テスト</button>
      </div>}
      {/* タブ: URLロック時はスタッフ画面のみ表示 */}
      {!urlLocked&&<div style={{display:"flex",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
        <button onClick={()=>setView("staff")} style={{flex:1,padding:"13px 0",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,background:view==="staff"?"#06C755":"#1A1A2E",color:"white"}}>📅 スタッフ画面</button>
        <button onClick={()=>setView("admin")} style={{flex:1,padding:"13px 0",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,background:view==="admin"?"#16213E":"#111827",color:"white"}}>⚙️ 管理者画面</button>
      </div>}
      {/* メインコンテンツ */}
      {(urlLocked||view==="staff")
        ?<StaffView periods={periods} ap={ap} apid={apid} setApid={setApid} shopId={sid} settings={effectiveSettings} subs={subs} staffList={staffList}
            urlLocked={urlLocked}
            onSub={sub=>{
              // 常に最新のsidをrefから取得
              const currentSid=currentShopIdRef.current||sid;
              // ローカルstateを更新
              const a=[...subs];const i=a.findIndex(s=>s.staffName===sub.staffName&&s.periodId===sub.periodId);
              if(i>=0)a[i]=sub;else a.push(sub);
              setSubs(a);
              ls(storeKey(currentSid,"subs_v6"),a);
              // Firebaseに1件だけ書き込み（他の提出を消さない）
              if(firebaseDB){
                const path=`shops/${currentSid}/subs/${sub.id}`;
                firebaseDB.ref(path).set(sub)
                  .then(()=>console.log("提出完了 path=",path))
                  .catch(e=>console.warn("sub書き込み失敗:",path,e));
              } else {
                console.warn("Firebase未接続: ローカルのみ保存");
              }
            }} shopName={shop?.name}/>
        :(auth
          ?<AdminView settings={effectiveSettings} periods={periods} subs={subs} staffList={staffList} shops={shops}
              currentShopId={sid} saveSettings={saveSettings} savePeriods={savePeriods} saveSubs={saveSubs}
              saveStaff={saveStaff} saveShops={saveShops}
              globalTemplates={globalTemplates} saveGlobalTemplates={saveGlobalTemplates}
              setCurrentShopId={id=>{
                currentShopIdRef.current=id;
                setCurrentShopId(id);
                ssSave(SS_SHOP,id);
                startSubscriptions(id,shops);
              }}
              startSubscriptions={startSubscriptions}
              logout={()=>setAuth(false)} syncStatus={syncStatus}/>
          :null)
      }
    </div>
  );
}

// ============================================================
// スタッフ画面
// ============================================================
function StaffView({periods,ap,apid,setApid,shopId,settings,subs,staffList,onSub,shopName,urlLocked=false}){
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

  // 候補取得（日付別 > 祝日[key=7] > 曜日別 > 全体）
  const gc=ds=>{
    // 1. 日付別（最優先）
    const dc=(settings.dateCandidates||{})[ds];if(dc&&dc.length>0)return dc;
    // 2. 祝日（key=7）
    if(isHoliday(ds)){const hc=(settings.weekdayCandidates||{})[7]||[];if(hc.length>0)return hc;}
    // 3. 曜日別
    const dow=pd(ds).getDay();
    const wdc=(settings.weekdayCandidates||{})[dow]||[];if(wdc.length>0)return wdc;
    // 4. 全体デフォルト
    if(isWeekend(ds))return settings.candidates||CAND_WEEKEND;
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
      <StaffHdr ap={ap} p0={p0} pe={pe} nd={dates.length} subs={subs} apid={apid} onSm={()=>setSm(true)} shopName={shopName}/>
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
      <StaffHdr ap={ap} p0={p0} pe={pe} nd={dates.length} subs={subs} apid={apid} onSm={()=>setSm(true)} shopName={shopName}/>
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
function StaffHdr({ap,p0,pe,nd,subs,apid,onSm,shopName}){
  const submitted=subs.filter(s=>s.periodId===apid);
  return(
    <div style={{background:"#06C755",boxShadow:"0 2px 12px rgba(6,199,85,.25)",padding:"12px 14px"}}>
      <div style={{maxWidth:560,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
          <span style={{fontSize:20,flexShrink:0}}>📅</span>
          <div style={{minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              {shopName&&<span style={{fontSize:11,background:"rgba(255,255,255,.25)",color:"white",padding:"1px 7px",borderRadius:10,fontWeight:700,whiteSpace:"nowrap"}}>{shopName}</span>}
              <div style={{fontSize:15,fontWeight:700,color:"white",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {ap?.label||"シフト希望提出"}
              </div>
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.85)",marginTop:1}}>{p0} 〜 {pe}（{nd}日間）</div>
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
          {/* 左固定：名前列 */}
          <div style={{width:NW,flexShrink:0,display:"flex",flexDirection:"column",borderRight:"2px solid #E5E7EB",zIndex:2,background:"white"}}>
            <div style={{height:52,flexShrink:0,borderBottom:"2px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#6B7280",background:"#F9FAFB"}}>名前</div>
            <div ref={nameColRef} onScroll={e=>{if(dataColRef.current)dataColRef.current.scrollTop=e.currentTarget.scrollTop;}} style={{flex:1,overflowY:"scroll",overflowX:"hidden",scrollbarWidth:"none"}}>
              {submitted.map((sub,ri)=>(
                <div key={sub.id} onClick={()=>handleNameClick(sub)}
                  style={{height:72,borderBottom:"2px solid #E5E7EB",display:"flex",alignItems:"center",justifyContent:"center",padding:"6px",background:ri%2===0?"white":"#FAFAFA",cursor:"pointer",flexShrink:0}}
                  onMouseEnter={e=>e.currentTarget.style.background="#E8F9EE"}
                  onMouseLeave={e=>e.currentTarget.style.background=ri%2===0?"white":"#FAFAFA"}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#1A1A2E",wordBreak:"break-all",lineHeight:1.3}}>{sub.staffName}</div>
                    <div style={{fontSize:10,color:"#06C755",marginTop:2}}>✎ 修正</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右側：ヘッダー行 + データ行を同一スクロールコンテナに */}
          <div ref={dataColRef} onScroll={e=>{if(nameColRef.current)nameColRef.current.scrollTop=e.currentTarget.scrollTop;}} style={{flex:1,overflow:"auto"}}>
            {/* 日付ヘッダー行（sticky で上固定、横スクロールに追従） */}
            <div style={{display:"flex",position:"sticky",top:0,zIndex:5,background:"#F9FAFB",borderBottom:"2px solid #E5E7EB",minWidth:"fit-content"}}>
              {dates.map(ds=>{
                const d=pd(ds),m=d.getMonth()+1,day=d.getDate(),dow=d.getDay(),wd=WD[dow],iS=dow===6,iSu=dow===0||isHoliday(ds);
                return(
                  <div key={ds} style={{width:CW,flexShrink:0,textAlign:"center",height:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRight:"1px solid #E5E7EB",borderLeft:"1px solid #E5E7EB"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E"}}>{m}/{day}</div>
                    <div style={{fontSize:11,fontWeight:700,padding:"1px 6px",borderRadius:4,background:iS?"#EFF6FF":iSu?"#FFF0F1":"#F0F2F5",color:iS?"#3B82F6":iSu?"#FF4757":"#6B7280",marginTop:2}}>{wd}{isHoliday(ds)?"祝":""}</div>
                  </div>
                );
              })}
              <div style={{width:COMMENT_W,flexShrink:0,height:52,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#6B7280",borderRight:"1px solid #E5E7EB",borderLeft:"1px solid #E5E7EB"}}>コメント</div>
            </div>
            {/* データ行（ヘッダーと同じスクロールで横移動） */}
            {submitted.map((sub,ri)=>(
              <div key={sub.id} style={{display:"flex",height:72,borderBottom:"2px solid #E5E7EB",flexShrink:0,minWidth:"fit-content",background:ri%2===0?"white":"#FAFAFA"}}>
                {dates.map(ds=>{
                  const s=(sub.shifts||{})[ds]||null;
                  const iw=s&&s.status==="work";
                  const isEditing=editTarget&&editTarget.subId===sub.id&&editTarget.ds===ds;
                  return(
                    <div key={ds} onClick={()=>handleCellClick(sub,ds)}
                      style={{width:CW,flexShrink:0,height:72,padding:"4px",borderRight:"1px solid #E5E7EB",borderLeft:"1px solid #E5E7EB",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,cursor:"pointer",background:isEditing?"#E8F9EE":"transparent"}}
                      onMouseEnter={e=>{if(!isEditing)e.currentTarget.style.background="#F0FFF4";}}
                      onMouseLeave={e=>{if(!isEditing)e.currentTarget.style.background="transparent";}}>
                      {iw?(<>
                        <div style={{fontSize:10,fontWeight:700,background:"#E8F9EE",color:"#15803D",padding:"1px 5px",borderRadius:3,border:"1px solid #C2F0D2"}}>出勤</div>
                        <div style={{fontSize:11,fontWeight:700,color:"#1A1A2E",whiteSpace:"nowrap"}}>{s.start||"--:--"}</div>
                        <div style={{fontSize:9,color:"#9CA3AF"}}>〜</div>
                        <div style={{fontSize:11,fontWeight:700,color:"#1A1A2E",whiteSpace:"nowrap"}}>{s.end||"--:--"}</div>
                      </>):(<div style={{fontSize:13,color:"#D1D5DB"}}>🌙</div>)}
                    </div>
                  );
                })}
                <div style={{width:COMMENT_W,flexShrink:0,height:72,padding:"6px 8px",borderRight:"1px solid #E5E7EB",borderLeft:"1px solid #E5E7EB",display:"flex",alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#6B7280",lineHeight:1.4,wordBreak:"break-all",display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{sub.comment||""}</span>
                </div>
              </div>
            ))}
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
function AdminView({settings,periods,subs,staffList,shops,currentShopId,saveSettings,savePeriods,saveSubs,saveStaff,saveShops,setCurrentShopId,startSubscriptions,globalTemplates,saveGlobalTemplates,logout,syncStatus}){
  const[tab,setTab]=useState(()=>ssGet(SS_TAB,"periods"));
  useEffect(()=>ssSave(SS_TAB,tab),[tab]);
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
                        <button onClick={()=>{const name=prompt("新しい店舗名を入力");if(!name)return;const ns=makeShop(name.trim());const newShops=[...shops,ns];saveShops(newShops);setCurrentShopId(ns.id);currentShopIdRef.current=ns.id;ssSave(SS_SHOP,ns.id);startSubscriptions(ns.id,newShops);setShopMenuOpen(false);tt("✅ 店舗を追加しました");}} style={{flex:1,padding:"7px",background:"#06C755",border:"none",borderRadius:8,fontSize:12,fontWeight:700,color:"white",cursor:"pointer"}}>＋ 追加</button>
                      </div>
                      {shopEditMode&&<div style={{borderTop:"1px solid #E5E7EB",padding:"10px"}}>
                        {shops.map(sh=>(
                          <div key={sh.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                            <span style={{flex:1,fontSize:13,color:"#1A1A2E"}}>{sh.name}</span>
                            <button onClick={()=>{const name=prompt("店舗名を変更",sh.name);if(!name)return;saveShops(shops.map(s=>s.id===sh.id?{...s,name:name.trim()}:s));tt("✅ 変更しました");}} style={{padding:"4px 8px",background:"#F0F2F5",border:"none",borderRadius:6,fontSize:11,cursor:"pointer"}}>✏️</button>
                            {shops.length>1&&<button onClick={()=>{if(!confirm(`「${sh.name}」を削除しますか？`))return;const ns=shops.filter(s=>s.id!==sh.id);saveShops(ns);if(sh.id===currentShopId){setCurrentShopId(ns[0].id);currentShopIdRef.current=ns[0].id;ssSave(SS_SHOP,ns[0].id);startSubscriptions(ns[0].id,ns);}tt("🗑️ 削除しました");}} style={{padding:"4px 8px",background:"rgba(255,71,87,.1)",border:"none",borderRadius:6,fontSize:11,color:"#FF4757",cursor:"pointer"}}>🗑️</button>}
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
        {tab==="periods"&&<PeriodsTab periods={periods} subs={subs} staffList={staffList} shops={shops} onSave={savePeriods} tt={tt} shopId={currentShopId} shopName={(shops.find(s=>s.id===currentShopId)||shops[0])?.name}/>}
        {tab==="staff"&&<StaffTab staffList={staffList} onSave={saveStaff} tt={tt}/>}
        {tab==="candidates"&&<CandTab settings={settings} onSave={saveSettings} globalTemplates={globalTemplates} saveGlobalTemplates={saveGlobalTemplates} tt={tt}/>}
        {tab==="submissions"&&<SubsTab subs={subs} periods={periods} staffList={staffList} onSave={saveSubs} tt={tt}/>}
        {tab==="settings"&&<SetTab settings={settings} onSave={saveSettings} subs={subs} saveSubs={saveSubs} tt={tt} syncStatus={syncStatus}/>}
      </div>
      {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"rgba(255,255,255,.12)",backdropFilter:"blur(10px)",color:"white",padding:"10px 20px",borderRadius:24,fontSize:14,fontWeight:500,zIndex:999,border:"1px solid rgba(255,255,255,.15)"}}>{toast}</div>}
    </div>
  );
}

// ===== 期間管理タブ =====
function PeriodsTab({periods,subs,staffList,shops,onSave,tt,shopId,shopName}){
  const[eid,setEid]=useState(null);
  const[form,setForm]=useState({label:"",startDate:"",endDate:"",deadlineDate:""});
  const[show,setShow]=useState(false);
  const[usePreset,setUsePreset]=useState(true); // プリセット使用フラグ
  const[viewPeriodId,setViewPeriodId]=useState(null);

  // プリセット生成（1ヶ月前除外、今月〜再来月）
  const genPresets=()=>{
    const result=[],today=new Date();
    const cutoff=new Date(today.getFullYear(),today.getMonth()-1,today.getDate());
    for(let offset=0;offset<=2;offset++){
      const base=new Date(today.getFullYear(),today.getMonth()+offset,1);
      const yr=base.getFullYear(),mo=base.getMonth()+1,ms=String(mo).padStart(2,"0");
      const lastDay=fd(new Date(yr,mo,0));
      const fh={label:`${yr}年${mo}月前半`,startDate:`${yr}-${ms}-01`,endDate:`${yr}-${ms}-15`};
      const sh={label:`${yr}年${mo}月後半`,startDate:`${yr}-${ms}-16`,endDate:lastDay};
      if(pd(fh.endDate)>=cutoff)result.push(fh);
      if(pd(sh.endDate)>=cutoff)result.push(sh);
    }
    return result;
  };
  const pre=genPresets();

  const create=()=>{
    if(!form.startDate||!form.endDate){tt("⚠️ 開始日・終了日を入力");return;}
    const p={id:`p_${Date.now()}`,urlToken:genToken(),shopId,
      label:form.label||`${form.startDate.replace(/-/g,"/")}〜${form.endDate.replace(/-/g,"/")}`,
      startDate:form.startDate,endDate:form.endDate,deadlineDate:form.deadlineDate,
      createdAt:new Date().toISOString()};
    onSave([...periods,p]);
    setForm({label:"",startDate:"",endDate:"",deadlineDate:""});
    setShow(false);setUsePreset(true);
    tt("✅ 期間を作成しました");
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

  // 期間を開始日の降順でソート（最新が上）
  const sortedPeriods=[...periods].sort((a,b)=>new Date(b.startDate)-new Date(a.startDate));

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <AT>📅 期間管理</AT>
        <button onClick={()=>{setShow(v=>!v);setUsePreset(true);setForm({label:"",startDate:"",endDate:"",deadlineDate:""}); }} style={{padding:"9px 16px",background:"#06C755",border:"none",borderRadius:9,color:"white",fontSize:13,fontWeight:700,cursor:"pointer"}}>＋ 新しい期間を作成</button>
      </div>
      {show&&<AC title="📝 新しい期間を作成">
        {/* プリセット使用 / 手動入力 の切り替え */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button onClick={()=>setUsePreset(true)} style={{flex:1,padding:"9px 0",border:`2px solid ${usePreset?"#06C755":"rgba(255,255,255,.15)"}`,borderRadius:9,background:usePreset?"rgba(6,199,85,.15)":"rgba(255,255,255,.04)",color:usePreset?"#06C755":"rgba(255,255,255,.6)",fontSize:13,fontWeight:700,cursor:"pointer"}}>📋 プリセットから選ぶ</button>
          <button onClick={()=>{setUsePreset(false);setForm({label:"",startDate:"",endDate:"",deadlineDate:""}); }} style={{flex:1,padding:"9px 0",border:`2px solid ${!usePreset?"#06C755":"rgba(255,255,255,.15)"}`,borderRadius:9,background:!usePreset?"rgba(6,199,85,.15)":"rgba(255,255,255,.04)",color:!usePreset?"#06C755":"rgba(255,255,255,.6)",fontSize:13,fontWeight:700,cursor:"pointer"}}>✏️ 手動で入力する</button>
        </div>

        {usePreset?(
          /* プリセット選択 */
          <div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:10}}>選択するとすぐに作成されます</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:14}}>
              {pre.map((p,i)=>{
                const alreadyExists=periods.some(pp=>pp.startDate===p.startDate&&pp.endDate===p.endDate);
                return(
                  <button key={i} onClick={()=>{
                    if(alreadyExists){tt("⚠️ この期間はすでに作成済みです");return;}
                    const np={id:`p_${Date.now()}`,urlToken:genToken(),shopId,label:p.label,startDate:p.startDate,endDate:p.endDate,deadlineDate:"",createdAt:new Date().toISOString()};
                    onSave([...periods,np]);setShow(false);setUsePreset(true);tt(`✅ ${p.label} を作成しました`);
                  }} style={{padding:"10px 16px",background:alreadyExists?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:`1px solid ${alreadyExists?"rgba(255,255,255,.08)":"rgba(255,255,255,.2)"}`,borderRadius:9,color:alreadyExists?"rgba(255,255,255,.25)":"rgba(255,255,255,.9)",fontSize:13,fontWeight:600,cursor:alreadyExists?"not-allowed":"pointer",textDecoration:alreadyExists?"line-through":"none"}}>
                    {p.label}{alreadyExists&&<span style={{fontSize:10,marginLeft:4}}>作成済み</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={()=>setShow(false)} style={{...AGray,width:"100%"}}>キャンセル</button>
          </div>
        ):(
          /* 手動入力 */
          <div>
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
          </div>
        )}
      </AC>}

      {sortedPeriods.map(p=>{
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
                    <button onClick={e=>{e.stopPropagation();expXl(p,subs,staffList,tt,shopName);}} style={{padding:"5px 9px",background:"linear-gradient(135deg,#217346,#1A5C38)",border:"none",borderRadius:6,color:"white",fontSize:11,fontWeight:700,cursor:"pointer"}}>📊 Excel</button>
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
function expXl(p,subs,staffList,tt,shopName){
  const ss=subs.filter(s=>s.periodId===p.id);
  if(typeof XLSX==="undefined"){tt("⚠️ SheetJS未読込み");return;}
  const dates=gd(p.startDate,p.endDate);
  const submittedNames=ss.map(s=>s.staffName);
  const registeredOrder=staffList.filter(n=>submittedNames.includes(n));
  const unregistered=submittedNames.filter(n=>!registeredOrder.includes(n)).sort((a,b)=>a.localeCompare(b,"ja"));
  const sl=[...registeredOrder,...unregistered];
  if(sl.length===0){tt("⚠️ 提出データがありません");return;}

  // ============================================================
  // サンプルファイルに準拠したフォーマット
  //
  // 列構成:
  //   A,B,C: 予備（空）
  //   D: 日付（数字、上下2行結合、中央揃え）
  //   E: 曜日（縦書き、上下2行結合、中央揃え）
  //   F: 空列
  //   G〜G+sl-1: スタッフ列（出勤上行・退勤下行）
  //   G+sl: 曜日（縦書き、上下2行結合）右端ミラー
  //   G+sl+1: 日付（数字、上下2行結合）右端ミラー
  //
  // 行構成:
  //   Row 1(R0): ヘッダー行
  //     D1=期間ラベル(縦書き), E1=曜日(縦書き)
  //     G1〜=スタッフ名(縦書き)
  //     右端=曜日(縦書き)・店舗名(縦書き)
  //   Row 2以降: 1日=2行
  //     上行: D=日付数字, E=曜日, G〜=出勤時間, 右=曜日, 右+1=日付
  //     下行: D結合, E結合, G〜=退勤時間, 右結合, 右+1結合
  //
  // 土曜=薄青(DDEEFF), 日祝=薄赤(FFEEEE)
  // 全セル: 細い枠線・中央揃え
  // 文字: スタッフ名・期間・曜日・店舗名=縦書き, 数字=横書き
  // ============================================================

  const firstDate=pd(dates[0]);
  const mo=firstDate.getMonth()+1;
  const isLatter=firstDate.getDate()>=16||(p.label&&p.label.includes("後半"));
  const periodLabel=`${mo}月${isLatter?"後半":"前半"}`;

  // 列インデックス（0-based）
  const C_D=3;          // D列: 日付
  const C_E=4;          // E列: 曜日
  // F列(5)は空列
  const C_STAFF=6;      // G列〜: スタッフ
  const C_WD_R=C_STAFF+sl.length;    // 右端曜日
  const C_DATE_R=C_STAFF+sl.length+1;// 右端日付
  const TOTAL_COLS=C_DATE_R+1;
  const TOTAL_ROWS=1+dates.length*2;

  // スタイル定義
  const thin={style:"thin",color:{rgb:"AAAAAA"}};
  const hair={style:"hair",color:{rgb:"BBBBBB"}};
  const bAll={top:thin,bottom:thin,left:thin,right:thin};
  const bTopDot={top:thin,bottom:hair,left:thin,right:thin};  // 出勤セル（下に点線）
  const bBotDot={top:hair,bottom:thin,left:thin,right:thin};  // 退勤セル（上に点線）
  const CA_H={horizontal:"center",vertical:"center"};         // 横書き中央
  const CA_V={horizontal:"center",vertical:"center",textRotation:255}; // 縦書き中央
  const FH={patternType:"solid",fgColor:{rgb:"F0F0F0"}};     // ヘッダー背景
  const FW={patternType:"solid",fgColor:{rgb:"FFFFFF"}};     // 白
  const FS={patternType:"solid",fgColor:{rgb:"DDEEFF"}};     // 土曜薄青
  const FHO={patternType:"solid",fgColor:{rgb:"FFEEEE"}};    // 日祝薄赤
  const FSR={patternType:"solid",fgColor:{rgb:"CCEEFF"}};    // 土曜休み
  const FHOR={patternType:"solid",fgColor:{rgb:"FFDDDD"}};   // 日祝休み
  const FGR={patternType:"solid",fgColor:{rgb:"EEEEEE"}};    // 平日休み

  const ws={};
  const merges=[];

  const S=(r,c,v,s)=>{
    const ref=XLSX.utils.encode_cell({r,c});
    const t=(typeof v==="number")?"n":"s";
    ws[ref]={v:(v===null||v===undefined)?"":v,t,s:s||{alignment:CA_H,border:bAll}};
  };

  // ===== 行0: ヘッダー =====
  // A〜C列: 空
  [0,1,2].forEach(c=>S(0,c,"",{fill:FH,border:bAll,alignment:CA_H}));
  // D列: 期間ラベル（縦書き）
  S(0,C_D,periodLabel,{font:{bold:true,sz:11},alignment:CA_V,fill:FH,border:bAll});
  // E列: 曜日ヘッダー（縦書き）
  S(0,C_E,"曜日",{font:{bold:true,sz:11},alignment:CA_V,fill:FH,border:bAll});
  // F列: 空
  S(0,5,"",{fill:FH,border:bAll,alignment:CA_H});
  // スタッフ名（縦書き）
  sl.forEach((nm,si)=>{
    S(0,C_STAFF+si,nm,{font:{bold:true,sz:10},alignment:CA_V,fill:FH,border:bAll});
  });
  // 右端: 曜日・店舗名（縦書き）
  S(0,C_WD_R,"曜日",{font:{bold:true,sz:11},alignment:CA_V,fill:FH,border:bAll});
  S(0,C_DATE_R,shopName||"",{font:{bold:true,sz:11},alignment:CA_V,fill:FH,border:bAll});

  // ===== 行1〜: データ（1日=2行）=====
  dates.forEach((ds,di)=>{
    const d=pd(ds),dow=d.getDay(),day=d.getDate(),wd=WD[dow];
    const isSat=dow===6,isSunHol=dow===0||isHoliday(ds);
    const bgData=isSat?FS:isSunHol?FHO:FW;
    const bgRest=isSat?FSR:isSunHol?FHOR:FGR;
    const wdColor={rgb:isSat?"3B82F6":isSunHol?"FF4757":"000000"};
    const rT=1+di*2, rB=rT+1;

    // A〜C列: 空（行ごとに塗り）
    [0,1,2].forEach(c=>{
      S(rT,c,"",{fill:FH,border:bAll,alignment:CA_H});
      S(rB,c,"",{fill:FH,border:bAll,alignment:CA_H});
    });

    // D列: 日付（横書き・上下結合）
    S(rT,C_D,day,{font:{sz:11,bold:true},alignment:CA_H,fill:bgData,border:bAll});
    S(rB,C_D,"", {fill:bgData,border:bAll,alignment:CA_H});
    merges.push({s:{r:rT,c:C_D},e:{r:rB,c:C_D}});

    // E列: 曜日（縦書き・上下結合）
    S(rT,C_E,wd,{font:{sz:11,bold:true,color:wdColor},alignment:CA_V,fill:bgData,border:bAll});
    S(rB,C_E,"", {fill:bgData,border:bAll,alignment:CA_H});
    merges.push({s:{r:rT,c:C_E},e:{r:rB,c:C_E}});

    // F列: 空
    S(rT,5,"",{fill:bgData,border:bAll,alignment:CA_H});
    S(rB,5,"",{fill:bgData,border:bAll,alignment:CA_H});

    // スタッフ列
    sl.forEach((nm,si)=>{
      const sub=ss.find(s=>s.staffName===nm),sh=sub?.shifts?.[ds];
      const isWork=sh&&sh.status==="work";
      const ci=C_STAFF+si;
      if(isWork){
        const sv=sh.start?timeToNum(sh.start):"";
        const ev=sh.end?timeToNum(sh.end):"";
        // 出勤（上行・下に点線）
        S(rT,ci,sv,{font:{sz:10},alignment:CA_H,fill:bgData,border:bTopDot});
        // 退勤（下行・上に点線）
        S(rB,ci,ev,{font:{sz:10},alignment:CA_H,fill:bgData,border:bBotDot});
      } else {
        // 休み: 斜線
        const diagB={diagonal:{style:"thin",color:{rgb:"AAAAAA"}},diagonalUp:true,diagonalDown:true};
        S(rT,ci,"",{fill:bgRest,border:{...bTopDot,...diagB}});
        S(rB,ci,"",{fill:bgRest,border:{...bBotDot,...diagB}});
      }
    });

    // 右端: 曜日（縦書き・上下結合）
    S(rT,C_WD_R,wd,{font:{sz:11,bold:true,color:wdColor},alignment:CA_V,fill:bgData,border:bAll});
    S(rB,C_WD_R,"", {fill:bgData,border:bAll,alignment:CA_H});
    merges.push({s:{r:rT,c:C_WD_R},e:{r:rB,c:C_WD_R}});

    // 右端: 日付（横書き・上下結合）
    S(rT,C_DATE_R,day,{font:{sz:11,bold:true},alignment:CA_H,fill:bgData,border:bAll});
    S(rB,C_DATE_R,"", {fill:bgData,border:bAll,alignment:CA_H});
    merges.push({s:{r:rT,c:C_DATE_R},e:{r:rB,c:C_DATE_R}});
  });

  // シート範囲・結合・列幅・行高さ
  ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:TOTAL_ROWS-1,c:TOTAL_COLS-1}});
  ws["!merges"]=merges;
  ws["!cols"]=[
    {wch:4},{wch:4},{wch:4}, // A,B,C
    {wch:5},                 // D: 日付
    {wch:5},                 // E: 曜日
    {wch:3},                 // F: 空列
    ...sl.map(()=>({wch:6})),// スタッフ列
    {wch:5},                 // 右端曜日
    {wch:5},                 // 右端日付
  ];
  // 行高さ: ヘッダー行=120(縦書き用), データ行=18
  const rowH=[{hpt:120}];
  for(let i=0;i<dates.length;i++){rowH.push({hpt:18});rowH.push({hpt:18});}
  ws["!rows"]=rowH;

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"シフト一覧");
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
function CandTab({settings,onSave,globalTemplates=[],saveGlobalTemplates,tt}){
  const[mode,setMode]=useState("global");
  const[selDows,setSelDows]=useState([1]);
  const[selDates,setSelDates]=useState([tds]);
  const[newDate,setNewDate]=useState(tds);
  // 複数選択用
  const[selStart,setSelStart]=useState("");
  const[selEnd,setSelEnd]=useState("");
  const[wSelStart,setWSelStart]=useState("");
  const[wSelEnd,setWSelEnd]=useState("");
  const[dSelStart,setDSelStart]=useState("");
  const[dSelEnd,setDSelEnd]=useState("");
  const[tmplName,setTmplName]=useState("");

  const toggleArr=(arr,setArr,val)=>setArr(prev=>prev.includes(val)?prev.filter(v=>v!==val):[...prev,val]);

  const addG=()=>{
    if(!selStart||!selEnd){tt("⚠️ 開始・終了を選択してください");return;}
    if(selStart>=selEnd){tt("⚠️ 退勤は出勤より後にしてください");return;}
    const nc={start:selStart,end:selEnd};
    if((settings.candidates||[]).some(c=>c.start===nc.start&&c.end===nc.end)){tt("⚠️ 同じ時間帯が既に登録されています");return;}
    const merged=sc([...(settings.candidates||[]),nc]);
    onSave({...settings,candidates:merged});setSelStart("");setSelEnd("");tt(`✅ ${selStart}〜${selEnd} を追加`);
  };
  const delG=i=>{const c=[...(settings.candidates||[])];c.splice(i,1);onSave({...settings,candidates:c});};

  const addW=()=>{
    if(!wSelStart||!wSelEnd){tt("⚠️ 開始・終了を選択してください");return;}
    if(wSelStart>=wSelEnd){tt("⚠️ 退勤は出勤より後にしてください");return;}
    const w={...(settings.weekdayCandidates||{})};
    const nc={start:wSelStart,end:wSelEnd};
    let total=0;
    selDows.forEach(dow=>{
      const b=w[dow]||[];
      if(!b.some(c=>c.start===nc.start&&c.end===nc.end)){w[dow]=sc([...b,nc]);total++;}
    });
    onSave({...settings,weekdayCandidates:w});setWSelStart("");setWSelEnd("");
    tt(total>0?`✅ ${selDows.map(d=>WD[d]).join("・")}に追加`:"⚠️ 既に登録済みです");
  };
  const delW=(d,i)=>{const w={...(settings.weekdayCandidates||{})};w[d]=[...(w[d]||[])];w[d].splice(i,1);onSave({...settings,weekdayCandidates:w});tt("🗑️ 削除しました");};

  const addD=()=>{
    if(!dSelStart||!dSelEnd){tt("⚠️ 開始・終了を選択してください");return;}
    if(dSelStart>=dSelEnd){tt("⚠️ 退勤は出勤より後にしてください");return;}
    const dc={...(settings.dateCandidates||{})};
    const nc={start:dSelStart,end:dSelEnd};
    let total=0;
    selDates.forEach(dt=>{
      if(!(dc[dt]||[]).some(c=>c.start===nc.start&&c.end===nc.end)){dc[dt]=sc([...(dc[dt]||[]),nc]);total++;}
    });
    onSave({...settings,dateCandidates:dc});setDSelStart("");setDSelEnd("");
    tt(total>0?`✅ ${selDates.length}日付に追加`:"⚠️ 既に登録済みです");
  };
  const delD=(dt,i)=>{const dc={...(settings.dateCandidates||{})};dc[dt]=[...(dc[dt]||[])];dc[dt].splice(i,1);if(dc[dt].length===0)delete dc[dt];onSave({...settings,dateCandidates:dc});};

  // テンプレート保存
  const saveTemplate=()=>{
    if(!tmplName.trim()){tt("⚠️ テンプレート名を入力");return;}
    const wdCopy={...(settings.weekdayCandidates||{})};
    const tmpl={name:tmplName.trim(),weekdayCandidates:wdCopy,savedAt:new Date().toISOString()};
    const ts=[...globalTemplates,tmpl];
    saveGlobalTemplates(ts);setTmplName("");tt(`✅ テンプレート「${tmplName.trim()}」を保存しました（全店舗共有）`);
  };
  const applyTemplate=t=>{
    if(!confirm(`テンプレート「${t.name}」を適用しますか？現在の曜日別候補が上書きされます。`))return;
    onSave({...settings,weekdayCandidates:t.weekdayCandidates});tt(`✅ テンプレート「${t.name}」を適用しました`);
  };
  const delTemplate=i=>{const ts=[...globalTemplates];ts.splice(i,1);saveGlobalTemplates(ts);tt("🗑️ 削除しました");};

  // 選択中の曜日の候補（複数選択時は全曜日の和集合）
  const wC=selDows.length===1?((settings.weekdayCandidates||{})[selDows[0]]||[]):[];// key=7は祝日候補
  // 選択中の日付の候補（複数選択時は全日付の和集合）
  const dC=selDates.length===1?((settings.dateCandidates||{})[selDates[0]]||[]):[];

  const SingleTimeSelect=({value,onChange,label})=>(
    <div style={{flex:1}}>
      <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginBottom:4}}>{label}</div>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{width:"100%",padding:"9px 10px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:8,color:value?"white":"rgba(255,255,255,.4)",fontSize:14,outline:"none",cursor:"pointer"}}>
        <option value="" style={{background:"#1A1A2E"}}>-- 選択 --</option>
        {TO.map(t=><option key={t} value={t} style={{background:"#1A1A2E"}}>{t}</option>)}
      </select>
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
        <div style={{marginTop:12,display:"flex",gap:10,alignItems:"flex-end"}}>
          <SingleTimeSelect value={selStart} onChange={setSelStart} label="出勤時刻"/>
          <div style={{color:"rgba(255,255,255,.4)",paddingBottom:12,fontSize:16}}>〜</div>
          <SingleTimeSelect value={selEnd} onChange={setSelEnd} label="退勤時刻"/>
          <button onClick={addG} style={{...AB,whiteSpace:"nowrap",marginBottom:0}}>＋ 追加</button>
        </div>
      </AC>}

      {mode==="weekday"&&<AC title="📆 曜日別候補（全体より優先）">
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:6}}>複数選択可 ／ 祝日は平日・土日より優先適用されます</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
          {/* 日〜土 */}
          {[0,1,2,3,4,5,6].map(d=>{const sel=selDows.includes(d);const isSat=d===6,isSun=d===0;return(<button key={d} onClick={()=>setSelDows(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d])} style={{padding:"7px 14px",borderRadius:20,fontSize:13,fontWeight:700,border:"1px solid",cursor:"pointer",background:sel?(isSat?"#3B82F6":isSun?"#FF4757":"#06C755"):"rgba(255,255,255,.05)",borderColor:sel?"transparent":(isSat?"rgba(147,197,253,.3)":isSun?"rgba(252,165,165,.3)":"rgba(255,255,255,.15)"),color:sel?"white":(isSat?"#93C5FD":isSun?"#FCA5A5":"rgba(255,255,255,.6)")}}>{WD[d]}</button>);})}
          {/* 祝日（key=7） */}
          {(()=>{const sel=selDows.includes(7);return(<button onClick={()=>setSelDows(prev=>prev.includes(7)?prev.filter(x=>x!==7):[...prev,7])} style={{padding:"7px 14px",borderRadius:20,fontSize:13,fontWeight:700,border:"1px solid",cursor:"pointer",background:sel?"#F59E0B":"rgba(255,255,255,.05)",borderColor:sel?"transparent":"rgba(253,230,138,.3)",color:sel?"white":"#FDE68A"}}>祝</button>);})()}
        </div>
        {selDows.length===1&&<>
          <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,.7)",marginBottom:8}}>
            {selDows[0]===7?"祝日":WD[selDows[0]]+"曜日"}の登録済み候補
            {selDows[0]===7&&<span style={{fontSize:11,color:"#FDE68A",marginLeft:8}}>（平日・土日より優先）</span>}
          </div>
          {wC.length===0&&<div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginBottom:8}}>未設定{selDows[0]===7?"（祝日は曜日別候補にフォールバック）":"（デフォルト候補が使用されます）"}</div>}
          <CL items={wC} onDel={i=>delW(selDows[0],i)}/>
        </>}
        {selDows.length>1&&<div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:8,padding:"8px 12px",background:"rgba(255,255,255,.05)",borderRadius:8}}>
          選択中：{selDows.map(d=>d===7?"祝":WD[d]).join("・")} — 下で時刻を選んで追加します
        </div>}
        <div style={{marginTop:12,display:"flex",gap:10,alignItems:"flex-end"}}>
          <SingleTimeSelect value={wSelStart} onChange={setWSelStart} label="出勤時刻"/>
          <div style={{color:"rgba(255,255,255,.4)",paddingBottom:12,fontSize:16}}>〜</div>
          <SingleTimeSelect value={wSelEnd} onChange={setWSelEnd} label="退勤時刻"/>
          <button onClick={addW} style={{...AB,whiteSpace:"nowrap"}}>＋ 追加</button>
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
        <div style={{marginTop:12,display:"flex",gap:10,alignItems:"flex-end"}}>
          <SingleTimeSelect value={dSelStart} onChange={setDSelStart} label="出勤時刻"/>
          <div style={{color:"rgba(255,255,255,.4)",paddingBottom:12,fontSize:16}}>〜</div>
          <SingleTimeSelect value={dSelEnd} onChange={setDSelEnd} label="退勤時刻"/>
          <button onClick={addD} style={{...AB,whiteSpace:"nowrap"}}>＋ 追加（{selDates.length}日付）</button>
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
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:8}}>🌐 全店舗で共有されます</div>
        {globalTemplates.length===0&&<div style={{fontSize:13,color:"rgba(255,255,255,.3)"}}>保存済みテンプレートはありません</div>}
        {globalTemplates.map((t,i)=>(
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
