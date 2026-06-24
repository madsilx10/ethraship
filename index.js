import { ethers } from "ethers";
import { createInterface } from "readline";
import fs from "fs";

// ============ CONFIG ============
const REFERRAL_CODE = "invincible-inferno-6364";
const PRIVY_APP_ID = "cmdonap9700d3ky0jcrppiz4x";
const PRIVY_CA_ID = "ff0b9728-e059-4245-b816-a1e516520407";
const CHAIN_ID = "eip155:21894";
const BASE_URL = "https://evm-api.pulsar.money";
const PRIVY_URL = "https://auth.privy.io";

// ============ HELPERS ============
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function loadWallets() {
  return fs.readFileSync("wallets.txt", "utf-8")
    .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

function loadAnswers() {
  const raw = fs.readFileSync("answers.txt", "utf-8").replace(/\r/g, "");
  return raw.split(/\n\s*\n/).map(block =>
    block.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => ({ text: l }))
  ).filter(g => g.length > 0);
}

const icon = (s) => s === "SUCCESSFUL" ? "✅" : s === "PENDING" ? "⏳" : s === "ERROR" ? "❌" : "?";
const log = (msg) => console.log(msg);

// ============ AUTH ============
function privyHeaders() {
  return {
    "Content-Type": "application/json",
    "privy-app-id": PRIVY_APP_ID,
    "privy-ca-id": PRIVY_CA_ID,
    "privy-client": "react-auth:3.21.3",
    "Origin": "https://app.ethraship.io",
    "Referer": "https://app.ethraship.io/",
  };
}

function apiHeaders(token) {
  return {
    "Content-Type": "application/json",
    "X-Privy-Access-Token": `Bearer ${token}`,
    "Origin": "https://app.ethraship.io",
  };
}

async function login(wallet) {
  const { nonce } = await fetch(`${PRIVY_URL}/api/v1/siwe/init`, {
    method: "POST", headers: privyHeaders(),
    body: JSON.stringify({ address: wallet.address }),
  }).then(r => r.json());

  const issuedAt = new Date().toISOString();
  const message =
    `app.ethraship.io wants you to sign in with your Ethereum account:\n${wallet.address}\n\n` +
    `By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.\n\n` +
    `URI: https://app.ethraship.io\nVersion: 1\nChain ID: 21894\nNonce: ${nonce}\nIssued At: ${issuedAt}\nResources:\n- https://privy.io`;

  const signature = await wallet.signMessage(message);

  const data = await fetch(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    method: "POST", headers: privyHeaders(),
    body: JSON.stringify({ message, signature, chainId: CHAIN_ID, walletClientType: "metamask", connectorType: "injected", mode: "login-or-sign-up", referralCode: REFERRAL_CODE }),
  }).then(r => r.json());

  if (!data.token) throw new Error("Login gagal: " + JSON.stringify(data));
  return data.token;
}

// ============ REFERRAL ============
async function createReferral(token) {
  await fetch(`${BASE_URL}/challenges/ethra-portal/create-referral/2`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ referralCode: REFERRAL_CODE }),
  });
}


// ============ CONNECT X ============
function loadXTokens() {
  try {
    const raw = fs.readFileSync("xtoken.txt", "utf-8").replace(/\r/g, "");
    return raw.split(/\n\s*\n/).map(block => {
      const lines = block.trim().split("\n").map(l => l.trim());
      return { username: lines[0], auth_token: lines[1], ct0: lines[2] };
    }).filter(t => t.auth_token && t.ct0);
  } catch { return []; }
}

async function connectTwitter(token, xtoken, w) {
  // Step 1: Register twitter - dapet OAuth params
  const regRaw = await fetch(`${BASE_URL}/social-pay/register/twitter`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ type: "register", redirectUrl: "https://app.ethraship.io/" }),
  });
  const regText = await regRaw.text();
  let reg;
  try { reg = JSON.parse(regText); } catch { reg = { authUrl: regText.trim() }; }
  log(`${w} Register response: ${JSON.stringify(reg).slice(0,200)}`);

  if (!reg.authUrl) {
    log(`${w} ❌ Connect X: gagal dapet authUrl`);
    return false;
  }

  const url = new URL(reg.authUrl);
  const client_id = url.searchParams.get("client_id");
  const code_challenge = url.searchParams.get("code_challenge");
  const state = url.searchParams.get("state");
  const redirect_uri = url.searchParams.get("redirect_uri");
  const scope = url.searchParams.get("scope");

  // Step 2: GET authorize page (init session)
  const authUrl = `https://x.com/i/api/2/oauth2/authorize?client_id=${client_id}&code_challenge=${code_challenge}&code_challenge_method=plain&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  
  const initRes = await fetch(authUrl, {
    headers: {
      "Authorization": `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
      "Cookie": `auth_token=${xtoken.auth_token}; ct0=${xtoken.ct0}`,
      "X-Csrf-Token": xtoken.ct0,
      "X-Twitter-Auth-Type": "OAuth2Session",
      "X-Twitter-Active-User": "yes",
      "X-Twitter-Client-Language": "en",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Referer": "https://x.com/",
    }
  }).then(async r => {
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error(`Init authorize bukan JSON: ${text.slice(0,100)}`); }
  });

  log(`${w} Init response: ${JSON.stringify(initRes).slice(0,300)}`);
  if (initRes.auth_code) {
    // Step 3: POST approve
    const approveRes = await fetch("https://x.com/i/api/2/oauth2/authorize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": `auth_token=${xtoken.auth_token}; ct0=${xtoken.ct0}`,
        "X-Csrf-Token": xtoken.ct0,
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "en",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Referer": authUrl,
        "Origin": "https://x.com",
        "Accept": "application/json, text/plain, */*",
      },
      body: `approval=true&code=${initRes.auth_code}&client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=code&state=${state}&code_challenge=${code_challenge}&code_challenge_method=plain`
    }).then(async r => {
      const text = await r.text();
      try { return JSON.parse(text); } catch { throw new Error(`Approve bukan JSON: ${text.slice(0,200)}`); }
    });

    log(`${w} Approve response: ${JSON.stringify(approveRes).slice(0,300)}`);
    if (!approveRes.redirect_uri) {
      log(`${w} ❌ Connect X: gagal approve`);
      return false;
    }

    const code = new URL(approveRes.redirect_uri).searchParams.get("code");
    
    // Step 4: Callback ke EthraShip - hit redirect_uri langsung
    const callbackUrl = approveRes.redirect_uri;
    const cbR = await fetch(callbackUrl, { headers: apiHeaders(token) });
    const cbText = await cbR.text();
    log(`${w} Callback status: ${cbR.status} | ${cbText.slice(0,200)}`);
    
    if (cbR.status === 200 || cbR.status === 201 || cbR.status === 302) {
      log(`${w} ✅ Connect X: ${xtoken.username}`);
      return true;
    }
  }

  log(`${w} ❌ Connect X gagal`);
  return false;
}


const X_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

function xHeaders(xtoken) {
  return {
    "Authorization": `Bearer ${X_BEARER}`,
    "Cookie": `auth_token=${xtoken.auth_token}; ct0=${xtoken.ct0}`,
    "X-Csrf-Token": xtoken.ct0,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Auth-Type": "OAuth2Session",
    "X-Twitter-Client-Language": "en",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
}

async function tweetComment(xtoken, tweetId, text) {
  const QUERY_ID = "SoVnbfCycZ7fERGCwpZkYA";
  const r = await fetch(`https://x.com/i/api/graphql/${QUERY_ID}/CreateTweet`, {
    method: "POST",
    headers: xHeaders(xtoken),
    body: JSON.stringify({
      variables: {
        tweet_text: text,
        reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] },
        dark_request: false,
        media: { media_entities: [], possibly_sensitive: false },
        semantic_annotation_ids: [],
      },
      features: {
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: false,
        tweet_awards_web_tipping_enabled: false,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        interactive_text_enabled: true,
        responsive_web_text_conversations_enabled: false,
        responsive_web_enhance_cards_enabled: false,
      },
      queryId: QUERY_ID,
    }),
  }).then(async r => {
    const t = await r.text();
    console.log("Tweet raw response:", t.slice(0, 300));
    try { return JSON.parse(t); } catch { throw new Error("Tweet response bukan JSON: " + t.slice(0, 200)); }
  });

  if (!r?.data?.create_tweet) throw new Error(`Tweet gagal: ${JSON.stringify(r).slice(0, 200)}`);
  const result = r.data.create_tweet.tweet_results?.result;
  if (!result?.rest_id) throw new Error(`Tweet gagal, tweet_results kosong: ${JSON.stringify(r.data).slice(0, 200)}`);
  const newTweetId = result.rest_id;
  const username = result.core?.user_results?.result?.legacy?.screen_name;
  return `https://twitter.com/${username}/status/${newTweetId}`;
}

// Tweet ID dari post EthraShip yang perlu di-komen
const ETHRA_TWEET_ID = "2050222589084119221";
const COMMENTS = [
  "This is the future of maritime investing",
  "Finally real maritime assets on-chain",
  "Maritime RWA is a game changer",
  "Love what Ethra is building",
  "Solid project, makes a lot of sense",
  "Been waiting for something like this",
  "Real world assets done right",
  "This is what crypto should be about",
  "Interesting approach to maritime logistics",
  "Ethra is onto something big",
  "Maritime shipping meets blockchain, finally",
  "This unlocks a whole new asset class",
  "Very promising project",
  "Great to see RWA expanding to maritime",
  "The future of shipping investment",
  "Legit use case for blockchain",
  "Maritime assets accessible to everyone now",
  "This changes how we invest in shipping",
  "Really innovative approach",
  "Excited to see where this goes",
  "Finally a project with real utility",
  "Maritime RWA makes total sense",
  "Shipping is a massive market",
  "Smart move bringing this on-chain",
  "This is what real adoption looks like",
  "Love the vision here",
  "Big market, smart solution",
  "Underrated sector getting attention",
  "Real assets, real value",
  "This is the kind of project crypto needs",
  "Maritime + blockchain is the future",
];
const randomComment = () => COMMENTS[Math.floor(Math.random() * COMMENTS.length)];

// ============ TASKS ============
async function getTasks(token) {
  const r = await fetch(`${BASE_URL}/challenges/ethra-portal/tasks-status/2`, { headers: apiHeaders(token) }).then(r => r.json());
  const tasks = r.tasksStatus || [];
  return tasks;
}

async function doTask(token, taskGuid, extraArguments = []) {
  return fetch(`${BASE_URL}/challenges/do-task`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ taskGuid, extraArguments }),
  }).then(r => r.json());
}


async function xFollow(xtoken, userId) {
  const meRes = await fetch("https://x.com/i/api/1.1/account/verify_credentials.json", {
    headers: { ...xHeaders(xtoken), "Content-Type": "application/json" }
  }).then(r => r.json());
  const myId = meRes.id_str;
  if (!myId) throw new Error("Gagal dapet user ID");

  await fetch(`https://api.twitter.com/1.1/friendships/create.json`, {
    method: "POST",
    headers: { ...xHeaders(xtoken), "Content-Type": "application/x-www-form-urlencoded" },
    body: `user_id=${userId}&follow=true`,
  });
}

async function xUpdateName(xtoken, name) {
  await fetch("https://x.com/i/api/1.1/account/update_profile.json", {
    method: "POST",
    headers: { ...xHeaders(xtoken), "Content-Type": "application/x-www-form-urlencoded" },
    body: `name=${encodeURIComponent(name)}`,
  });
}

async function xGetUserByUsername(xtoken, username) {
  const r = await fetch(`https://api.twitter.com/1.1/users/show.json?screen_name=${username}`, {
    headers: xHeaders(xtoken),
  }).then(r => r.json());
  return r.id_str;
}

// ============ TASK RUNNERS ============
async function runSimpleTask(token, task, w) {
  if (task.status === "SUCCESSFUL") {
    log(`${w} ✅ ${task.title}`);
    return;
  }
  const r = await doTask(token, task.taskGuid);
  const pts = r.points ? ` (${parseFloat(r.points).toFixed(0)}p)` : '';
  log(`${w} ${icon(r.state)} ${task.title}${pts}`);
}

async function runQuestionnaire(token, task, answers, w) {
  if (task.status === "SUCCESSFUL") {
    log(`${w} ✅ ${task.title}`);
    return;
  }
  if (!answers || answers.length === 0) {
    log(`${w} - ${task.title} (no answers)`);
    return;
  }
  for (let i = 0; i < answers.length; i++) {
    const { text } = answers[i];
    const r = await doTask(token, task.taskGuid, [String(i), text]);
    if (r.state === "SUCCESSFUL") log(`${w} ✅ ${task.title}`);
    await sleep(1000);
  }
}


function loadLinks() {
  try { return JSON.parse(fs.readFileSync("links.json", "utf-8")); } catch { return {}; }
}
function saveLinks(links) {
  fs.writeFileSync("links.json", JSON.stringify(links, null, 2));
}

async function runCreateMedia(token, task, xtoken, walletAddr, w) {
  if (task.status === "SUCCESSFUL") {
    log(`${w} ✅ ${task.title}`);
    return;
  }
  if (!xtoken) {
    log(`${w} - ${task.title} (no X token)`);
    return;
  }
  try {
    const links = loadLinks();
    let tweetLink = links[walletAddr];
    if (!tweetLink || !tweetLink.includes("/status/")) {
      tweetLink = await tweetComment(xtoken, ETHRA_TWEET_ID, randomComment());
      links[walletAddr] = tweetLink;
      saveLinks(links);
    }
    log(`${w} Submit tweet link: ${tweetLink}`);
    const r = await doTask(token, task.taskGuid, [tweetLink]);
    const pts = r.points ? ` (${parseFloat(r.points).toFixed(0)}p)` : '';
    log(`${w} ${icon(r.state)} ${task.title}${pts}`);
  } catch (e) {
    log(`${w} ❌ ${task.title}: ${e.message}`);
  }
}

// ============ MAIN RUNNER ============
async function runWallet(privateKey, answers, idx, xTokens = []) {
  const wallet = new ethers.Wallet(privateKey);
  const w = `[Wallet ${idx+1}]`;
  log(`\n${w} Mulai...`);
  log(`${w} ${wallet.address}`);

  let token;
  try {
    token = await login(wallet);
    try { await createReferral(token); } catch (_) {}
    log(`${w} ✅ Login OK`);
  } catch (e) {
    log(`${w} ❌ Login gagal: ${e.message}`);
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token);
  } catch (e) {
    log(`${w} ❌ Fetch tasks gagal: ${e.message}`);
    return;
  }

  // Connect X - hanya kalau ada task X yang belum selesai
  if (xTokens.length > 0) {
    const needsX = tasks.some(t =>
      ["follow_twitter_account", "twitter_username", "create_media", "retweet_post"].includes(t.taskName)
      && t.status !== "SUCCESSFUL"
    );
    if (needsX) {
      const xtmp = xTokens[idx % xTokens.length];
      try { await connectTwitter(token, xtmp, w); } catch (e) { log(`${w} ❌ Connect X error: ${e.message}`); }
    }
  }

  const done = tasks.filter(t => t.status === "SUCCESSFUL").length;
  log(`${w} ${done}/${tasks.length} task selesai`);

  const xtoken = xTokens.length > 0 ? xTokens[idx % xTokens.length] : null;
  if (!xtoken) log(`${w} ⚠️ xtoken.txt kosong — task X akan diskip`);
  let quizIdx = 0;
  for (const task of tasks) {
    try {
      if (task.taskName === "click_link") {
        await runSimpleTask(token, task, w);
      } else if (task.taskName === "retweet_post") {
        await runSimpleTask(token, task, w);
      } else if (task.taskName === "follow_twitter_account") {
        if (task.status === "SUCCESSFUL") { log(`${w} ✅ ${task.title}`); }
        else {
          if (xtoken) {
            try {
              await fetch("https://api.twitter.com/1.1/friendships/create.json", {
                method: "POST",
                headers: { ...xHeaders(xtoken), "Content-Type": "application/x-www-form-urlencoded" },
                body: "screen_name=EthraShip&follow=true",
              });
            } catch (e) { log(`${w} ⚠️ Follow Twitter gagal: ${e.message}`); }
          }
          await runSimpleTask(token, task, w);
        }
      } else if (task.taskName === "twitter_username") {
        if (task.status === "SUCCESSFUL") { log(`${w} ✅ ${task.title}`); }
        else {
          if (xtoken) {
            try {
              const meRes = await fetch("https://x.com/i/api/graphql/G3KGOASz96M-Qu0nwmGXNg/UserByScreenName?" + new URLSearchParams({
                variables: JSON.stringify({ screen_name: xtoken.username, withSafetyModeUserFields: true }),
                features: JSON.stringify({ responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false, responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, responsive_web_graphql_timeline_navigation_enabled: true }),
              }), { headers: xHeaders(xtoken) }).then(r => r.json());
              const currentName = meRes?.data?.user?.result?.legacy?.name || "";
              log(`${w} Nama saat ini: "${currentName}"`);
              if (!currentName.includes("🚢")) {
                const upRes = await fetch("https://x.com/i/api/1.1/account/update_profile.json", {
                  method: "POST",
                  headers: { ...xHeaders(xtoken), "Content-Type": "application/x-www-form-urlencoded" },
                  body: `name=${encodeURIComponent(currentName + " 🚢")}`,
                }).then(r => r.json());
                log(`${w} Update nama response: ${JSON.stringify(upRes).slice(0,200)}`);
              } else {
                log(`${w} Nama sudah ada emoji, skip`);
              }
            } catch (e) { log(`${w} ⚠️ Update nama gagal: ${e.message}`); }
          }
          await runSimpleTask(token, task, w);
        }
      } else if (task.taskName === "create_media") {
        await runCreateMedia(token, task, xtoken, wallet.address, w);
      } else if (task.taskName === "questionnaire") {
        await runQuestionnaire(token, task, answers[quizIdx], w);
        quizIdx++;
      }
      if (task.status !== "SUCCESSFUL") await sleep(1500);
    } catch (e) {
      log(`${w} ❌ Error: ${e.message}`);
    }
  }

  log(`${w} ✅ Selesai!`);
}

// ============ ENTRY ============
async function main() {
  log("\n  EthraShip Bot");
  log("  ─────────────");
  log("  1. 1 wallet");
  log("  2. Semua wallet");
  log("  3. Dari wallet ke-N\n");

  const choice = await prompt("Pilih: ");
  const wallets = loadWallets();
  const answers = loadAnswers();
  const xTokens = loadXTokens();
  let selected = [];

  if (choice === "1") {
    const n = parseInt(await prompt(`Wallet ke (1-${wallets.length}): `)) - 1;
    if (n < 0 || n >= wallets.length) { log("Tidak valid."); process.exit(1); }
    selected = [{ key: wallets[n], idx: n }];
  } else if (choice === "2") {
    selected = wallets.map((key, idx) => ({ key, idx }));
  } else if (choice === "3") {
    const n = parseInt(await prompt(`Mulai dari wallet ke (1-${wallets.length}): `)) - 1;
    selected = wallets.slice(n).map((key, i) => ({ key, idx: n + i }));
  } else {
    log("Tidak valid."); process.exit(1);
  }

  log(`\n  Total: ${selected.length} wallet\n`);

  for (let i = 0; i < selected.length; i++) {
    await runWallet(selected[i].key, answers, selected[i].idx, xTokens);
    if (i < selected.length - 1) await sleep(3000);
  }

  log("\n  ✅ Semua wallet selesai\n");
}

main().catch(console.error);
