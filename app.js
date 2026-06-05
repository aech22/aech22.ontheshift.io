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

// ===== サブスクリプション プラン定義 =====
// テスト用: "free"|"standard"|"pro" に設定すると Firebase を無視して上書き
const DEV_PLAN_OVERRIDE = null; // null = Firebaseから読む

const PLAN_LIMITS = {
  free:     { shops: 1,        staff: 10, periods: 3        },
  standard: { shops: 3,        staff: 30, periods: Infinity },
  pro:      { shops: Infinity, staff: Infinity, periods: Infinity },
};
const PLAN_LABELS = { free: "Free", standard: "Standard", pro: "Pro" };

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
function makeShop(name="店舗1"){return{id:`${genToken()}${genToken()}`,name,createdAt:new Date().toISOString()};} // IDを完全ランダム化
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
  // スタッフURL: #/s/<token>
  return`${window.location.origin}${window.location.pathname}#/s/${token}`;
}

function parseUrl(){
  const h=window.location.hash;
  // スタッフURL: #/s/<token>
  if(h.startsWith("#/s/")){
    const token=h.slice(4);
    if(token) return{type:"staff",token};
  }
  // 旧形式互換（#/<token> または #p=<token>）→ スタッフとして扱う
  if(h.startsWith("#/")&&!h.startsWith("#/s/")&&!h.startsWith("#/a/")){
    const token=h.slice(2);
    if(token) return{type:"staff",token};
  }
  if(h.startsWith("#p="))return{type:"staff",token:h.slice(3)};
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

// ============================================================
// Cookie管理（端末ごとに独立した店舗を管理）
// ============================================================
function setCookie(name,value,days){
  const exp=new Date();exp.setDate(exp.getDate()+(days||365));
  document.cookie=`${name}=${encodeURIComponent(value)};expires=${exp.toUTCString()};path=/;SameSite=Lax`;
}
function getCookie(name){
  const m=document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m?decodeURIComponent(m[1]):null;
}
function delCookie(name){
  document.cookie=`${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}
const CK_SHOP="ots_shopId"; // 端末の店舗IDを保存するCookieキー
const ckStaffKey=(shopId,periodId)=>`ots_staff_${shopId}_${periodId}`; // スタッフ名Cookie

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
  const _hasUrlToken=!!(parseUrl()?.type==="staff");
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
  const[unbound,setUnbound]=useState(false); // 引き継ぎコード未入力（未所属）状態
  const[inviteCode,setInviteCode]=useState(""); // 引き継ぎコード入力値
  const[inviteError,setInviteError]=useState(""); // エラーメッセージ
  const[plan,setPlan]=useState("free"); // サブスクプラン

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
      if(parsed&&parsed.token&&parsed.type==="staff"){
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
            // tokenがあるがperiodが見つからない → 管理者URLの可能性
            // Cookieチェックに戻す
            console.warn("token一致なし(Phase1):", token, "→ Cookieチェックへ");
            const ckShopId2=getCookie(CK_SHOP);
            if(ckShopId2){
              const ckShop2=sh.find(s=>s.id===ckShopId2);
              const targetId=ckShopId2;
              currentShopIdRef.current=targetId;
              setCurrentShopId(targetId);
              startSubscriptions(targetId,sh);
            } else {
              // Cookieもない → 引き継ぎ画面
              setShops(sh);
              setUnbound(true);
            }
          }
          setReady(true);
        }).catch(()=>{
          const ckShopId2=getCookie(CK_SHOP);
          if(ckShopId2){
            setCurrentShopId(ckShopId2);
            startSubscriptions(ckShopId2,sh);
          } else {
            setShops(sh);
            setUnbound(true);
          }
          setReady(true);
        });
      } else {
        // URLなし: Cookieを最優先で確認
        const ckShopId=getCookie(CK_SHOP);
        if(ckShopId){
          // Cookieにshopがある → FirebaseになくてもCookieを信頼して使用
          const cookieShop=sh.find(s=>s.id===ckShopId);
          const targetId=ckShopId;
          console.log("Cookie店舗:", cookieShop?.name||targetId);
          currentShopIdRef.current=targetId;
          setCurrentShopId(targetId);
          startSubscriptions(targetId,sh);
          setReady(true);
        } else {
          // Cookieなし → 引き継ぎコード入力画面を表示
          console.log("Cookie未設定: 引き継ぎコード入力待ち");
          setShops(sh);
          setUnbound(true);
          setReady(true);
        }
      }
    }).catch(e=>{
      console.warn("shops読み込み失敗:",e);
      // エラー時もCookie確認
      const ckShopId=getCookie(CK_SHOP);
      const local=lg("shift_shops_v6",null)||[];
      const ckShop=ckShopId?local.find(s=>s.id===ckShopId):null;
      const target=ckShop||(local.length>0?local[0]:makeShop("メイン店舗"));
      if(!ckShopId)setCookie(CK_SHOP,target.id,365);
      setShops(local.length>0?local:[target]);
      setCurrentShopId(target.id);
      startSubscriptions(target.id,local.length>0?local:[target]);
      setReady(true);
    });

    return()=>{ if(firebaseDB) firebaseDB.ref(".info/connected").off(); };
  },[]);

  const shop=shops.find(s=>s.id===currentShopId)||shops[0];
  const sid=shop?.id||"default";
  // refとsessionStorage・Cookieを最新のsidに同期
  useEffect(()=>{
    currentShopIdRef.current=sid;
    if(!_hasUrlToken){
      ssSave(SS_SHOP,sid);
      setCookie(CK_SHOP,sid,365); // Cookieにも保存（1年間）
    }
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
    // accounts/<shopId>/plan（プラン読み込み）
    on(`accounts/${targetSid}/plan`,val=>{
      setPlan(DEV_PLAN_OVERRIDE||(val&&["free","standard","pro"].includes(val)?val:"free"));
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
    if(!apid&&periods.length>0&&urlResolved){
      const latest=[...periods].sort((a,b)=>new Date(b.startDate)-new Date(a.startDate))[0];
      setApid(latest.id);
    }
  },[periods,urlResolved]);

  // ===================================================================
  // 保存関数（Firebase + localStorage 二重書き）
  // ===================================================================
  const fbW=(path,val)=>{ if(firebaseDB) firebaseDB.ref(path).set(val).catch(e=>console.warn("書き込み失敗:",path,e)); };
  const saveSettings=useCallback(v=>{ setSettings(v); ls(storeKey(sid,"settings_v6"),v); fbW(fbPath(sid,"settings"),v); },[sid]);
  const savePeriods =useCallback(v=>{
    // 削除された期間のsubsをFirebaseから削除
    const deletedIds=periods.filter(p=>!v.find(np=>np.id===p.id)).map(p=>p.id);
    if(deletedIds.length>0&&firebaseDB){
      const newSubs=subs.filter(s=>!deletedIds.includes(s.periodId));
      setSubs(newSubs); ls(storeKey(sid,"subs_v6"),newSubs);
      firebaseDB.ref(fbPath(sid,"subs")).once("value").then(snap=>{
        const val=snap.val(); if(!val)return;
        const updates={};
        Object.keys(val).forEach(k=>{ if(deletedIds.includes(val[k]?.periodId)) updates[k]=null; });
        if(Object.keys(updates).length>0) firebaseDB.ref(fbPath(sid,"subs")).update(updates);
      });
    }
    setPeriods(v);
    ls(storeKey(sid,"periods_v6"),v);
    if(firebaseDB){
      const obj={};
      v.forEach(p=>{ if(p&&p.id) obj[p.id]=p; });
      firebaseDB.ref(fbPath(sid,"periods")).set(obj).catch(e=>console.warn("periods書き込み失敗:",e));
    }
  },[sid,periods,subs]);
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
  // 最新の期間 = startDateが最も新しいperiod
  const latestPeriod=periods.length>0?[...periods].sort((a,b)=>new Date(b.startDate)-new Date(a.startDate))[0]:null;
  // urlLocked時はapidが確定するまで表示しない、それ以外は最新期間をデフォルトに
  const ap=periods.find(p=>p.id===apid)||(urlLocked?null:latestPeriod);
  const effectiveSettings=settings||makeSettings(sid);

  // ローディング画面
  if(!ready||(urlLocked&&!apid)) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#1A1A2E",flexDirection:"column",gap:16}}>
      <div style={{fontSize:40}}>📅</div>
      <div style={{color:"white",fontSize:16,fontWeight:700}}>シフト管理システム</div>
      <div style={{color:"rgba(255,255,255,.5)",fontSize:13}}>データを読み込み中...</div>
    </div>
  );

  // 引き継ぎコード入力画面（未所属状態）
  const applyInviteCode=()=>{
    const code=inviteCode.trim();
    if(!code){setInviteError("引き継ぎコードを入力してください");return;}
    if(!firebaseDB){setInviteError("Firebase未接続です");return;}
    setInviteError("確認中...");
    firebaseDB.ref("global/shops").once("value").then(snap=>{
      const val=snap.val();
      if(!val){setInviteError("店舗情報が見つかりません");return;}
      const sh=typeof val==="object"&&!Array.isArray(val)?Object.values(val):val;
      const found=Array.isArray(sh)?sh.find(s=>s&&s.id===code):null;
      if(found){
        const allSh=Array.isArray(sh)?sh.filter(s=>s&&s.id):[];
        setCookie(CK_SHOP,code,365);
        setShops(allSh);
        ls("shift_shops_v6",allSh);
        currentShopIdRef.current=code;
        setCurrentShopId(code);
        startSubscriptions(code,allSh);
        setUnbound(false);
        setInviteError("");
        setInviteCode("");
      } else {
        setInviteError("コードが正しくありません。もう一度確認してください。");
      }
    }).catch(()=>setInviteError("確認に失敗しました。もう一度お試しください。"));
  };

  if(unbound) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#1A1A2E",padding:"20px"}}>
      <div style={{background:"#16213E",borderRadius:20,padding:"32px 24px",width:"100%",maxWidth:400,boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:48,marginBottom:12}}>🔑</div>
          <div style={{color:"white",fontSize:20,fontWeight:700,marginBottom:8}}>引き継ぎコードを入力</div>
          <div style={{color:"rgba(255,255,255,.5)",fontSize:13,lineHeight:1.6}}>
            管理者から受け取った引き継ぎコードを入力してください。
          </div>
        </div>
        <input
          value={inviteCode}
          onChange={e=>{setInviteCode(e.target.value);setInviteError("");}}
          onKeyDown={e=>e.key==="Enter"&&applyInviteCode()}
          placeholder="引き継ぎコードを貼り付け"
          style={{width:"100%",padding:"14px 16px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:12,color:"white",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12}}
        />
        {inviteError&&<div style={{color:inviteError==="確認中..."?"#F59E0B":"#FF4757",fontSize:13,marginBottom:12,textAlign:"center"}}>{inviteError}</div>}
        <button onClick={applyInviteCode}
          style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#06C755,#05A847)",border:"none",borderRadius:12,color:"white",fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:16}}>
          ✅ 入力する
        </button>
        <div style={{textAlign:"center"}}>
          <button onClick={()=>{
            if(!firebaseDB){setInviteError("Firebase未接続");return;}
            setInviteError("確認中...");
            // 既存shopがあっても新規作成可能（Cookieなし端末は常に新規登録できる）
            firebaseDB.ref("global/shops").once("value").then(snap=>{
              const val=snap.val();
              const sh=val?(typeof val==="object"&&!Array.isArray(val)
                ?Object.values(val).filter(s=>s&&s.id)
                :(Array.isArray(val)?val:Object.values(val)).filter(s=>s&&s.id)):[];
              const newShop=makeShop("新しい店舗");
              const newShops=[...sh,newShop];
              const obj={};newShops.forEach(s=>{if(s&&s.id)obj[s.id]=s;});
              firebaseDB.ref("global/shops").set(obj);
              setCookie(CK_SHOP,newShop.id,365);
              setShops(newShops);
              currentShopIdRef.current=newShop.id;
              setCurrentShopId(newShop.id);
              startSubscriptions(newShop.id,newShops);
              setUnbound(false);
              setInviteError("");
            }).catch(()=>setInviteError("エラーが発生しました。再試行してください。"));
          }} style={{background:"none",border:"none",color:"rgba(255,255,255,.4)",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
            新規店舗を作成する
          </button>
        </div>
      </div>
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
              const currentSid=currentShopIdRef.current||sid;
              const a=[...subs];const i=a.findIndex(s=>s.staffName===sub.staffName&&s.periodId===sub.periodId);
              if(i>=0)a[i]=sub;else a.push(sub);
              setSubs(a);
              ls(storeKey(currentSid,"subs_v6"),a);
              if(firebaseDB){
                const path=`shops/${currentSid}/subs/${sub.id}`;
                firebaseDB.ref(path).set(sub)
                  .then(()=>console.log(sub.isUpdated?"変更保存完了":"提出完了","path=",path))
                  .catch(e=>console.warn("sub書き込み失敗:",path,e));
              }
            }} shopName={shop?.name}/>
        :(auth
          ?<AdminView settings={effectiveSettings} periods={periods} subs={subs} staffList={staffList} shops={shops}
              currentShopId={sid} saveSettings={saveSettings} savePeriods={savePeriods} saveSubs={saveSubs}
              saveStaff={saveStaff} saveShops={saveShops}
              globalTemplates={globalTemplates} saveGlobalTemplates={saveGlobalTemplates}
              plan={plan}
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
  // Cookieからスタッフ名を復元
  const savedName=shopId&&apid?getCookie(ckStaffKey(shopId,apid))||"":"";
  const[name,setName]=useState(savedName);
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

  // 期間変更時にシフトデータをリセット
  // Cookieに保存された名前がある場合は提出済みデータを復元
  useEffect(()=>{
    if(!apid||!ap)return;
    const ckName=shopId&&apid?getCookie(ckStaffKey(shopId,apid))||"":"";
    if(ckName){
      // 提出済みデータを検索
      const prevSub=subs.find(s=>s.staffName===ckName&&s.periodId===apid);
      if(prevSub){
        // 提出済み → データを復元して完了画面を表示
        setName(ckName);
        const init={};
        gd(ap.startDate,ap.endDate).forEach(d=>{
          init[d]=(prevSub.shifts||{})[d]||{status:"holiday"};
        });
        setSd(init);
        setComment(prevSub.comment||"");
        setDone(true);
        return;
      }
      // 名前はあるが未提出 → 名前だけ復元
      setName(ckName);
    }
    const i={};dates.forEach(d=>{i[d]={status:"holiday"};});
    setSd(i);setDone(false);setComment("");
  },[apid,ap?.startDate,ap?.endDate,shopId]);

  const tt_=m=>{setToast(m);clearTimeout(tr.current);tr.current=setTimeout(()=>setToast(null),2500);};
  const upd=(ds,u)=>setSd(p=>({...p,[ds]:{...p[ds],...u}}));
  const reset=()=>{
    // CookieとStateをリセット
    if(shopId&&apid) delCookie(ckStaffKey(shopId,apid));
    setName("");
    const i={};dates.forEach(d=>{i[d]={status:"holiday"};});
    setSd(i);setDone(false);setComment("");
    tt_("🔄 リセットしました");
  };

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
  // 休業日チェック（候補に closed:true が含まれるか）
  const isClosed=ds=>gc(ds).some(c=>c.closed);

  const submit=()=>{
    const staffName=name.trim();
    // 既存subを検索（同じperiod+名前 → 上書き）
    const existSub=subs.find(s=>s.staffName===staffName&&s.periodId===apid);
    const sub={
      id:existSub?existSub.id:Date.now().toString(), // 既存なら同じID（上書き）
      periodId:apid,
      staffName,
      submittedAt:existSub?existSub.submittedAt:new Date().toISOString(), // 初回提出日は維持
      updatedAt:existSub?new Date().toISOString():undefined, // 再提出なら更新日時
      isUpdated:existSub?true:undefined,
      shifts:Object.fromEntries(dates.map(d=>[d,sd[d]||{status:"holiday"}])),
      comment:comment.trim()
    };
    // スタッフ名をCookieに保存（1年間）
    if(shopId&&apid) setCookie(ckStaffKey(shopId,apid),staffName,365);
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
      {sm&&<SmModal subs={subs} periods={periods} apid={apid} onClose={()=>setSm(false)} staffList={staffList} onEditSub={sub=>{onSub({...sub,updatedAt:new Date().toISOString(),isUpdated:true});}} onEditByName={sub=>{setName(sub.staffName);const init={};const ds2=ap?gd(ap.startDate,ap.endDate):[];ds2.forEach(d=>{init[d]=(sub.shifts||{})[d]||{status:"holiday"};});setSd(init);setComment(sub.comment||"");setDone(false);}}/>}
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
      {sm&&<SmModal subs={subs} periods={periods} apid={apid} onClose={()=>setSm(false)} staffList={staffList} onEditSub={sub=>{onSub({...sub,updatedAt:new Date().toISOString(),isUpdated:true});}} onEditByName={sub=>{setName(sub.staffName);const init={};const ds2=ap?gd(ap.startDate,ap.endDate):[];ds2.forEach(d=>{init[d]=(sub.shifts||{})[d]||{status:"holiday"};});setSd(init);setComment(sub.comment||"");setDone(false);}}/>}
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
          const cds=gc(ds).filter(c=>!c.closed);
          const dayIsClosed=gc(ds).some(c=>c.closed); // 休業日チェック
          return(
            <div key={ds} className="dc" style={{background:dayIsClosed?"#FFF5F5":"#fff",borderRadius:14,boxShadow:"0 1px 4px rgba(0,0,0,.08)",marginBottom:10,border:`2px solid ${dayIsClosed?"rgba(255,71,87,.3)":iw?"#C2F0D2":"#E5E7EB"}`,opacity:iw?1:.82}}>
              <div style={{padding:"11px 15px 9px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"linear-gradient(to right,#F9FAFB,#fff)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:17,fontWeight:700,color:"#1A1A2E"}}>{m}/{day}</span>
                  <span style={{fontSize:13,fontWeight:700,padding:"2px 8px",borderRadius:6,background:iS?"#EFF6FF":iSu?"#FFF0F1":"#F0F2F5",color:iS?"#3B82F6":iSu?"#FF4757":"#6B7280"}}>{wd}{isHoliday(ds)?"祝":""}</span>
                  {dayIsClosed&&<span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:6,background:"rgba(255,71,87,.1)",color:"#FF4757"}}>🚫 休業日</span>}
                </div>
                <span style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:12,background:dayIsClosed?"rgba(255,71,87,.1)":iw?"#E8F9EE":"#F0F2F5",color:dayIsClosed?"#FF4757":iw?"#15803D":"#6B7280"}}>{dayIsClosed?"休業":iw?"出勤":"休み"}</span>
              </div>
              {dayIsClosed
                ?<div style={{padding:"8px 15px 12px"}}></div>
                :<div style={{display:"flex",gap:8,padding:"0 15px 10px"}}>
                {[["work","出勤"],["holiday","休み"]].map(([v,l])=>{
                  const a=st.status===v,iW=v==="work";
                  return(<div key={v} onClick={()=>!dl&&upd(ds,{status:v,start:iW?(st.start||cds[0]?.start||"18:00"):undefined,end:iW?(st.end||cds[0]?.end||"23:00"):undefined})}
                    style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px 0",borderRadius:10,cursor:dl?"not-allowed":"pointer",border:`2px solid ${a?(iW?"#06C755":"#FF4757"):"#E5E7EB"}`,background:a?(iW?"#E8F9EE":"#FFF0F1"):"#F0F2F5",color:a?(iW?"#166634":"#FF4757"):"#6B7280",fontSize:14,fontWeight:600,opacity:dl?.5:1,transition:"all .15s"}}>
                    <div style={{width:15,height:15,borderRadius:"50%",border:"2px solid currentColor",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{a&&<div style={{width:7,height:7,borderRadius:"50%",background:"currentColor"}}/>}</div>{l}
                  </div>);
                })}
              </div>}
              {!dayIsClosed&&iw&&(
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
function AdminView({settings,periods,subs,staffList,shops,currentShopId,saveSettings,savePeriods,saveSubs,saveStaff,saveShops,setCurrentShopId,startSubscriptions,globalTemplates,saveGlobalTemplates,logout,syncStatus,plan="free"}){
  const[tab,setTab]=useState(()=>ssGet(SS_TAB,"periods"));
  useEffect(()=>ssSave(SS_TAB,tab),[tab]);
  const[toast,setToast]=useState(null);
  const[shopMenuOpen,setShopMenuOpen]=useState(false);
  const[shopEditMode,setShopEditMode]=useState(false);
  const[upgradeReason,setUpgradeReason]=useState(null); // {type,limit,plan}
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
                        <button onClick={()=>{
                          const lim=PLAN_LIMITS[plan]?.shops??1;
                          if(shops.length>=lim){setShopMenuOpen(false);setUpgradeReason({type:"shops",limit:lim,plan});return;}
                          const name=prompt("新しい店舗名を入力");if(!name)return;const ns=makeShop(name.trim());const newShops=[...shops,ns];saveShops(newShops);setCurrentShopId(ns.id);currentShopIdRef.current=ns.id;ssSave(SS_SHOP,ns.id);startSubscriptions(ns.id,newShops);setShopMenuOpen(false);tt("✅ 店舗を追加しました");
                        }} style={{flex:1,padding:"7px",background:"#06C755",border:"none",borderRadius:8,fontSize:12,fontWeight:700,color:"white",cursor:"pointer"}}>＋ 追加</button>
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
        {tab==="periods"&&<PeriodsTab periods={periods} subs={subs} staffList={staffList} shops={shops} onSave={savePeriods} tt={tt} shopId={currentShopId} shopName={(shops.find(s=>s.id===currentShopId)||shops[0])?.name} plan={plan} onUpgrade={setUpgradeReason}/>}
        {tab==="staff"&&<StaffTab staffList={staffList} onSave={saveStaff} tt={tt} plan={plan} onUpgrade={setUpgradeReason}/>}
        {tab==="candidates"&&<CandTab settings={settings} onSave={saveSettings} globalTemplates={globalTemplates} saveGlobalTemplates={saveGlobalTemplates} tt={tt} plan={plan}/>}
        {tab==="submissions"&&<SubsTab subs={subs} periods={periods} staffList={staffList} onSave={saveSubs} tt={tt}/>}
        {tab==="settings"&&<SetTab settings={settings} onSave={saveSettings} subs={subs} saveSubs={saveSubs} tt={tt} syncStatus={syncStatus} plan={plan}/>}
      </div>
      {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:"rgba(255,255,255,.12)",backdropFilter:"blur(10px)",color:"white",padding:"10px 20px",borderRadius:24,fontSize:14,fontWeight:500,zIndex:999,border:"1px solid rgba(255,255,255,.15)"}}>{toast}</div>}
      {upgradeReason&&<UpgradeModal reason={upgradeReason} currentPlan={plan} onClose={()=>setUpgradeReason(null)}/>}
    </div>
  );
}

// ===== 期間管理タブ =====
function PeriodsTab({periods,subs,staffList,shops,onSave,tt,shopId,shopName,plan="free",onUpgrade}){
  const[eid,setEid]=useState(null);
  const[form,setForm]=useState({label:"",startDate:"",endDate:"",deadlineDate:""});
  const[show,setShow]=useState(false);
  const[usePreset,setUsePreset]=useState(true); // プリセット使用フラグ
  const[viewPeriodId,setViewPeriodId]=useState(null);
  // Pro限定Excelオプション
  const[xlShopNameOverride,setXlShopNameOverride]=useState("");
  const[xlStaffColors,setXlStaffColors]=useState({}); // {staffName: "red"|"black"}
  const[xlOptPeriodId,setXlOptPeriodId]=useState(null);

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

  const checkPeriodLimit=()=>{
    const lim=PLAN_LIMITS[plan]?.periods??3;
    if(periods.length>=lim){onUpgrade&&onUpgrade({type:"periods",limit:lim,plan});return false;}
    return true;
  };
  const create=()=>{
    if(!form.startDate||!form.endDate){tt("⚠️ 開始日・終了日を入力");return;}
    if(!checkPeriodLimit())return;
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
        <SmModal subs={subs} periods={periods} apid={viewPeriodId} onClose={()=>setViewPeriodId(null)} staffList={staffList} onEditSub={sub=>{const updated={...sub,updatedAt:new Date().toISOString(),isUpdated:true};const a=[...subs];const i=a.findIndex(s=>s.id===sub.id);if(i>=0){a[i]=updated;onSave(a);}tt("✅ 更新しました");}}/>
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
                  <button onClick={e=>{e.stopPropagation();
              if(navigator.clipboard&&navigator.clipboard.writeText){
                navigator.clipboard.writeText(pUrl).then(()=>tt("✅ URLをコピーしました")).catch(()=>{
                  // フォールバック（iOS Safari 12以下等）
                  const el=document.createElement("textarea");el.value=pUrl;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);tt("✅ URLをコピーしました");
                });
              } else {
                const el=document.createElement("textarea");el.value=pUrl;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);tt("✅ URLをコピーしました");
              }}} style={{padding:"4px 10px",background:"rgba(255,255,255,.1)",border:"none",borderRadius:6,color:"white",fontSize:11,cursor:"pointer",flexShrink:0}}>コピー</button>
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
  if(typeof ExcelJS==="undefined"){tt("⚠️ ExcelJS未読込み");return;}
  const dates=gd(p.startDate,p.endDate);
  const submittedNames=ss.map(s=>s.staffName);
  const registeredOrder=staffList.filter(n=>submittedNames.includes(n));
  const unregistered=submittedNames.filter(n=>!registeredOrder.includes(n)).sort((a,b)=>a.localeCompare(b,"ja"));
  const sl=[...registeredOrder,...unregistered];
  if(sl.length===0){tt("⚠️ 提出データがありません");return;}

  const firstDate=pd(dates[0]);
  const mo=firstDate.getMonth()+1;
  const isLatter=firstDate.getDate()>=16||(p.label&&p.label.includes("後半"));
  const periodLabel=`${mo}月${isLatter?"後半":"前半"}`;

  // ============================================================
  // サンプルファイル完全準拠レイアウト
  //
  // ヘッダー行(Row1 = サンプルのRow2):
  //   A1 = 期間ラベル (縦書き, medium四辺)
  //   B1 = 曜日ヘッダー (縦書き, medium四辺)
  //   C1〜C+sl-1 = スタッフ名 (縦書き, top:medium, right:thin)
  //   C+sl = 曜日 (縦書き, medium四辺 ← 右端ミラー)
  //   C+sl+1 = 店舗名 (縦書き, top/bot:medium, left/right:thin)
  //
  // データ行(1日=2行):
  //   上行: A=日付(横書き), B=曜日(横書き) → 両方 medium四辺・上下結合
  //         スタッフ列 → top:medium, bot:hair, left:thin, right:thin
  //         右端A=曜日(横書き, medium四辺・上下結合)
  //         右端B=日付(横書き, medium四辺・上下結合)
  //   下行: A/B結合(bot:medium), スタッフ → top:hair, bot:thin
  //         右端結合(bot:medium)
  //   最終日の下行: スタッフ → bot:medium
  //
  // 塗り: 土日祝は A〜右端B 全列に塗り, 平日は塗りなし
  // ============================================================

  const R=h=>"FF"+h;
  // 列定義
  const C_PER=1;             // A: 期間
  const C_WD_H=2;            // B: 曜日ヘッダー
  const C_STAFF=3;           // C〜: スタッフ
  const C_WD_R=3+sl.length;  // 右端曜日
  const C_SHOP_R=4+sl.length;// 右端店舗名
  const TOTAL_COLS=C_SHOP_R;
  const TOTAL_ROWS=1+dates.length*2;

  // 枠線
  const M={style:"medium",color:{argb:R("555555")}};
  const T={style:"thin",  color:{argb:R("AAAAAA")}};
  const H={style:"hair",  color:{argb:R("CCCCCC")}};

  // 配置
  const aV={horizontal:"center",vertical:"middle",textRotation:255,wrapText:true};
  const aH={horizontal:"center",vertical:"middle"};

  // 塗り
  const fSat ={type:"pattern",pattern:"solid",fgColor:{argb:R("DDEEFF")},bgColor:{argb:"FFFFFFFF"}};
  const fHol ={type:"pattern",pattern:"solid",fgColor:{argb:R("FFEEEE")},bgColor:{argb:"FFFFFFFF"}};
  const fNone={type:"pattern",pattern:"none"};

  const wb=new ExcelJS.Workbook();
  wb.creator="ShiftApp";
  const ws=wb.addWorksheet("シフト一覧",{pageSetup:{orientation:"landscape"}});

  // 列幅
  ws.getColumn(C_PER).width=5;
  ws.getColumn(C_WD_H).width=5;
  sl.forEach((_,i)=>ws.getColumn(C_STAFF+i).width=6);
  ws.getColumn(C_WD_R).width=5;
  ws.getColumn(C_SHOP_R).width=6;

  const SC=(r,c,val,al,fill,border,font)=>{
    const cell=ws.getRow(r).getCell(c);
    cell.value=(val===null||val===undefined||val==="")? null:val;
    // alignmentはObject.assignで確実に反映
    const a=al||aV;
    cell.alignment=Object.assign({},a);
    // fillを確実に設定
    const f=fill||fNone;
    if(f.pattern==="none"){
      cell.fill={type:"pattern",pattern:"none",fgColor:{argb:"FFFFFFFF"},bgColor:{argb:"FFFFFFFF"}};
    } else {
      cell.fill=Object.assign({},f);
    }
    cell.border=border?Object.assign({},border):{};
    cell.font=Object.assign({name:"HG正楷書体-PRO",size:11,bold:true},font||{}); // デフォルトHGフォント
  };

  // ===== Row1: ヘッダー (高さ120, 全縦書き) =====
  ws.getRow(1).height=120;

  // A1: 期間ラベル (top/bot/left:medium, right:thin)
  SC(1,C_PER,periodLabel,aV,fNone,{top:M,bottom:M,left:M,right:T},{bold:true,size:11});
  // B1: 曜日ヘッダー (top/bot/right:medium, left:thin)
  SC(1,C_WD_H,"曜日",aV,fNone,{top:M,bottom:M,left:T,right:M},{bold:true,size:11});
  // スタッフ列: top:medium, right:thin（左枠なし）
  sl.forEach((nm,i)=>{
    const isFirst=i===0;
    SC(1,C_STAFF+i,nm,aV,fNone,
      {top:M,bottom:M,left:isFirst?T:undefined,right:T},
      {bold:true,size:10});
  });
  // 右端曜日: top/bot/left:medium, right:thin
  SC(1,C_WD_R,"曜日",aV,fNone,{top:M,bottom:M,left:M,right:T},{bold:true,size:11});
  // 右端店舗名: top/bot:medium, left/right:thin
  SC(1,C_SHOP_R,shopName||"",aV,fNone,{top:M,bottom:M,left:T,right:T},{bold:true,size:11});

  // ===== データ行 (1日=2行) =====
  dates.forEach((ds,di)=>{
    const d=pd(ds),dow=d.getDay(),day=d.getDate(),wd=WD[dow];
    const isSat=dow===6,isSunHol=dow===0||isHoliday(ds);
    const fill=isSat?fSat:isSunHol?fHol:fNone; // 平日=塗りなし
    const isLast=di===dates.length-1;
    const rT=2+di*2, rB=rT+1;
    ws.getRow(rT).height=18;
    ws.getRow(rB).height=18;

    // A列: 日付 (medium四辺, 上下結合, 横書き)
    SC(rT,C_PER,day,aH,fill,{top:M,bottom:M,left:M,right:M},{name:"HG正楷書体-PRO",bold:true,size:11,color:{argb:"FF000000"}});
    SC(rB,C_PER,null,aH,fill,{top:M,bottom:M,left:M,right:M});
    ws.mergeCells(rT,C_PER,rB,C_PER);

    // B列: 曜日 (medium四辺, 上下結合, 横書き)
    SC(rT,C_WD_H,wd,aH,fill,{top:M,bottom:M,left:M,right:M},{name:"HG正楷書体-PRO",bold:true,size:11,color:{argb:R("000000")}});
    SC(rB,C_WD_H,null,aH,fill,{top:M,bottom:M,left:M,right:M});
    ws.mergeCells(rT,C_WD_H,rB,C_WD_H);

    // スタッフ列
    sl.forEach((nm,si)=>{
      const sub=ss.find(s=>s.staffName===nm),sh=sub?.shifts?.[ds];
      const isWork=sh&&sh.status==="work";
      const ci=C_STAFF+si;
      const isLastStaff=si===sl.length-1;
      // 上行: top:medium, bot:hair
      // 下行: top:hair, bot:thin (最終日はbot:medium)
      const botT=isLast?M:T;
      if(isWork){
        SC(rT,ci,sh.start?timeToNum(sh.start):null,aH,fill,{top:M,bottom:H,left:T,right:T},{name:"Yu Gothic",bold:false,size:10});
        SC(rB,ci,sh.end?timeToNum(sh.end):null,aH,fill,{top:H,bottom:botT,left:T,right:T},{name:"Yu Gothic",bold:false,size:10});
      } else {
        // 休み: 斜線（右上→左下）
        const diagU={up:false,down:true,style:"thin",color:{argb:R("AAAAAA")}};
        SC(rT,ci,null,aH,fill,{top:M,bottom:H,left:T,right:T,diagonal:diagU});
        SC(rB,ci,null,aH,fill,{top:H,bottom:botT,left:T,right:T,diagonal:diagU});
      }
    });

    // 右端曜日: medium四辺, 上下結合
    SC(rT,C_WD_R,wd,aH,fill,{top:M,bottom:M,left:M,right:M},{name:"HG正楷書体-PRO",bold:true,size:11,color:{argb:R("000000")}});
    SC(rB,C_WD_R,null,aH,fill,{top:M,bottom:M,left:M,right:M});
    ws.mergeCells(rT,C_WD_R,rB,C_WD_R);

    // 右端日付: medium四辺, 上下結合
    SC(rT,C_SHOP_R,day,aH,fill,{top:M,bottom:M,left:M,right:M},{name:"HG正楷書体-PRO",bold:true,size:11});
    SC(rB,C_SHOP_R,null,aH,fill,{top:M,bottom:M,left:M,right:M});
    ws.mergeCells(rT,C_SHOP_R,rB,C_SHOP_R);
  });

  // ファイル名・ダウンロード
  const sn=(shopName||"店舗").replace(/[\\/:*?"<>|]/g,"");
  const pl=periodLabel.replace(/[\\/:*?"<>|]/g,"");
  const fname=`${sn}${pl}.xlsx`;
  wb.xlsx.writeBuffer().then(buf=>{
    const blob=new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=fname; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    tt(`✅ ${fname} をダウンロードしました`);
  }).catch(e=>{
    console.error("Excel生成失敗:",e);
    tt("❌ Excel生成に失敗しました: "+e.message);
  });
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
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginBottom:8}}>複数選択で一括追加 ／ 祝日は平日・土日より優先適用されます</div>

        {/* 曜日選択ボタン（日曜を先頭に・祝日も含む） */}
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
          {[0,1,2,3,4,5,6,7].map(d=>{
            const sel=selDows.includes(d);
            const isSat=d===6,isSun=d===0,isHol=d===7;
            return(<button key={d} onClick={()=>setSelDows(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d])}
              style={{padding:"7px 14px",borderRadius:20,fontSize:13,fontWeight:700,border:"1px solid",cursor:"pointer",
                background:sel?(isSat?"#3B82F6":isSun||isHol?"#FF4757":"#06C755"):"rgba(255,255,255,.05)",
                borderColor:sel?"transparent":isSat?"rgba(147,197,253,.3)":isSun||isHol?"rgba(252,165,165,.3)":"rgba(255,255,255,.15)",
                color:sel?"white":isSat?"#93C5FD":isSun||isHol?"#FCA5A5":"rgba(255,255,255,.6)"}}>
              {d===7?"祝":WD[d]}
            </button>);
          })}
        </div>

        {/* 追加フォーム（常に表示・選択中の曜日を表示） */}
        <div style={{marginBottom:16,padding:"12px",background:"rgba(255,255,255,.03)",borderRadius:10}}>
          <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:8}}>
            <SingleTimeSelect value={wSelStart} onChange={setWSelStart} label="出勤時刻"/>
            <div style={{color:"rgba(255,255,255,.4)",paddingBottom:12,fontSize:16}}>〜</div>
            <SingleTimeSelect value={wSelEnd} onChange={setWSelEnd} label="退勤時刻"/>
            <button onClick={addW} style={{...AB,whiteSpace:"nowrap"}}>＋ 追加</button>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{selDows.map(d=>d===7?"祝":WD[d]).join("・")} に追加</div>
            <button onClick={()=>{
              const w={...(settings.weekdayCandidates||{})};
              let total=0;
              selDows.forEach(dow=>{
                const b=w[dow]||[];
                if(!b.some(c=>c.closed)){w[dow]=sc([...b,{closed:true}]);total++;}
              });
              onSave({...settings,weekdayCandidates:w});
              tt(total>0?`✅ ${selDows.map(d=>d===7?"祝":WD[d]).join("・")}に休業日を設定`:"⚠️ 既に設定済みです");
            }} style={{padding:"6px 12px",background:"rgba(255,71,87,.15)",border:"1px solid rgba(255,71,87,.3)",borderRadius:8,color:"#FF4757",fontSize:12,fontWeight:700,cursor:"pointer"}}>🚫 休業日に設定</button>
          </div>
        </div>

        {/* 全曜日の候補一覧（常に表示・日曜→祝→月〜土の順） */}
        <div style={{borderTop:"1px solid rgba(255,255,255,.08)",paddingTop:14}}>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:10,fontWeight:600}}>全曜日の登録済み候補</div>
          {[0,1,2,3,4,5,6,7].map(d=>{
            const cands=(settings.weekdayCandidates||{})[d]||[];
            const isSat=d===6,isSun=d===0,isHol=d===7;
            const label=d===7?"祝日":WD[d]+"曜日";
            const lc=isSat?"#93C5FD":isSun||isHol?"#FCA5A5":"rgba(255,255,255,.7)";
            return(
              <div key={d} style={{marginBottom:8,background:"rgba(255,255,255,.03)",borderRadius:10,overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",
                  borderBottom:cands.length>0?"1px solid rgba(255,255,255,.06)":"none"}}>
                  <span style={{fontSize:13,fontWeight:700,color:lc}}>{label}</span>
                  <span style={{fontSize:11,color:cands.length>0?"rgba(255,255,255,.4)":"rgba(255,255,255,.2)"}}>
                    {cands.length>0?`${cands.length}件`:"未設定"}
                  </span>
                </div>
                {cands.length>0&&<div style={{padding:"6px 8px"}}>
                  {cands.map((c,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"5px 8px",background:"rgba(255,255,255,.04)",borderRadius:7,marginBottom:3}}>
                      <span style={{fontSize:13,color:"white",fontWeight:600}}>{c.start} 〜 {c.end}</span>
                      <button onClick={()=>delW(d,i)} style={AD}>削除</button>
                    </div>
                  ))}
                </div>}
              </div>
            );
          })}
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
        <div style={{marginTop:12,padding:"12px",background:"rgba(255,255,255,.03)",borderRadius:10}}>
          <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:8}}>
            <SingleTimeSelect value={dSelStart} onChange={setDSelStart} label="出勤時刻"/>
            <div style={{color:"rgba(255,255,255,.4)",paddingBottom:12,fontSize:16}}>〜</div>
            <SingleTimeSelect value={dSelEnd} onChange={setDSelEnd} label="退勤時刻"/>
            <button onClick={addD} style={{...AB,whiteSpace:"nowrap"}}>＋ 追加</button>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,.4)"}}>{selDates.length}日付に追加</div>
            <button onClick={()=>{
              const dc={...(settings.dateCandidates||{})};
              let total=0;
              selDates.forEach(dt=>{
                if(!(dc[dt]||[]).some(c=>c.closed)){dc[dt]=sc([...(dc[dt]||[]),{closed:true}]);total++;}
              });
              onSave({...settings,dateCandidates:dc});
              tt(total>0?`✅ ${selDates.length}日付に休業日を設定`:"⚠️ 既に設定済みです");
            }} style={{padding:"6px 12px",background:"rgba(255,71,87,.15)",border:"1px solid rgba(255,71,87,.3)",borderRadius:8,color:"#FF4757",fontSize:12,fontWeight:700,cursor:"pointer"}}>🚫 休業日に設定</button>
          </div>
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
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.9)",fontWeight:600}}>
                {sub.staffName}
                {sub.isUpdated&&<span style={{marginLeft:6,fontSize:10,background:"rgba(245,158,11,.2)",color:"#F59E0B",border:"1px solid rgba(245,158,11,.3)",padding:"1px 6px",borderRadius:4,fontWeight:700}}>変更あり</span>}
              </td>
              <td style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,.05)",color:"rgba(255,255,255,.6)",whiteSpace:"nowrap"}}>
                  {at}
                  {sub.isUpdated&&<><br/><span style={{fontSize:10,color:"#F59E0B",fontWeight:700}}>✏️ 更新: {new Date(sub.updatedAt).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span></>}
                </td>
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
  const[inviteInput,setInviteInput]=useState("");
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
    <AC title="🏪 端末・店舗の紐付け（招待コード）">
      <div style={{fontSize:13,color:"rgba(255,255,255,.6)",marginBottom:10,lineHeight:1.6}}>
        この端末のCookieに紐付いている店舗IDです。別の端末でこの店舗を管理したい場合は「招待コード」を別端末で入力してください。
      </div>
      <AL>この端末のCookie（店舗ID）</AL>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <input readOnly value={getCookie(CK_SHOP)||"（未設定）"} style={{...AI,flex:1,fontSize:11,fontFamily:"monospace"}}/>
        <button onClick={()=>{const v=getCookie(CK_SHOP);if(!v)return;
          if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(v).then(()=>tt("✅ コピーしました")).catch(()=>{const el=document.createElement("textarea");el.value=v;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);tt("✅ コピーしました");});
          } else {
            const el=document.createElement("textarea");el.value=v;document.body.appendChild(el);el.select();document.execCommand("copy");document.body.removeChild(el);tt("✅ コピーしました");
          }}} style={AB}>コピー</button>
      </div>
      <AL>招待コード（別の店舗に切り替え）</AL>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <input value={inviteInput} onChange={e=>setInviteInput(e.target.value)} placeholder="別端末の店舗IDを貼り付け" style={{...AI,flex:1}}/>
        <button onClick={()=>{
          if(!inviteInput.trim()){tt("⚠️ 招待コードを入力");return;}
          const code=inviteInput.trim();
          if(!firebaseDB){tt("⚠️ Firebase未接続");return;}
          firebaseDB.ref("global/shops").once("value").then(snap=>{
            const val=snap.val();
            const sh=val?(typeof val==="object"&&!Array.isArray(val)?Object.values(val).filter(s=>s&&s.id):[]):[];
            const found=sh.find(s=>s&&s.id===code);
            if(found){
              setCookie(CK_SHOP,code,365);
              tt(`✅「${found.name}」に切り替えました。ページをリロードしてください。`);
              setInviteInput("");
            } else {
              tt("❌ 該当する店舗が見つかりません");
            }
          }).catch(()=>tt("❌ 確認に失敗しました"));
        }} style={AB}>切り替え</button>
      </div>
      <button onClick={()=>{
        if(!firebaseDB){tt("⚠️ Firebase未接続");return;}
        if(!confirm("新規店舗を作成してこの端末に紐付けます。よろしいですか？"))return;
        const newShop=makeShop("新しい店舗");
        firebaseDB.ref("global/shops").once("value").then(snap=>{
          const val=snap.val();
          const sh=val?(typeof val==="object"&&!Array.isArray(val)?Object.values(val).filter(s=>s&&s.id):[]):[];
          const newShops=[...sh,newShop];
          const obj={};newShops.forEach(s=>{if(s&&s.id)obj[s.id]=s;});
          firebaseDB.ref("global/shops").set(obj);
          setCookie(CK_SHOP,newShop.id,365);
          tt("✅ 新規店舗を作成しました。ページをリロードしてください。");
        });
      }} style={{...AGray,width:"100%",fontSize:13}}>＋ 新規店舗を作成してこの端末に紐付け</button>
    </AC>

  </div>);
}

// ============================================================
// 共通UIパーツ
// ============================================================
function AC({title,children}){return(<div style={{background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:20,marginBottom:16}}><div style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,.85)",marginBottom:14}}>{title}</div>{children}</div>);}
function AL({children}){return(<label style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,.6)",display:"block",marginBottom:6}}>{children}</label>);}
function AT({children}){return(<div style={{fontSize:18,fontWeight:700,color:"white",marginBottom:16}}>{children}</div>);}
function CL({items,onDel}){return items.map((c,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:c.closed?"rgba(255,71,87,.08)":"rgba(255,255,255,.05)",border:`1px solid ${c.closed?"rgba(255,71,87,.2)":"rgba(255,255,255,.08)"}`,borderRadius:10,marginBottom:6}}>
  {c.closed
    ?<span style={{flex:1,fontSize:14,color:"#FF4757",fontWeight:600}}>🚫 休業日</span>
    :<span style={{flex:1,fontSize:14,color:"rgba(255,255,255,.9)",fontWeight:500}}>{c.start} 〜 {c.end}</span>
  }
  <button onClick={()=>onDel(i)} style={AD}>削除</button>
</div>));}
const AI={width:"100%",padding:"11px 14px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,color:"white",fontSize:14,outline:"none"};
const AB={padding:"10px 18px",background:"#06C755",border:"none",borderRadius:9,color:"white",fontSize:14,fontWeight:700,cursor:"pointer"};
const AD={padding:"6px 11px",background:"rgba(255,71,87,.15)",border:"1px solid rgba(255,71,87,.3)",borderRadius:6,color:"#FF8C94",fontSize:12,fontWeight:600,cursor:"pointer"};
const AGray={padding:"10px 16px",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,color:"rgba(255,255,255,.7)",fontSize:14,cursor:"pointer"};

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
