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

const icon = (s) => s === "SUCCESSFUL" ? "✓" : s === "PENDING" ? "◌" : s === "ERROR" ? "✗" : "?";
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

// ============ TASKS ============
async function getTasks(token) {
  const r = await fetch(`${BASE_URL}/challenges/ethra-portal/tasks-status/2`, { headers: apiHeaders(token) }).then(r => r.json());
  const tasks = r.tasksStatus || [];
  log(`   Raw tasks: ${tasks.length}, quiz: ${tasks.filter(t=>t.taskName==='questionnaire').length}`);
  return tasks;
}

async function doTask(token, taskGuid, extraArguments = []) {
  return fetch(`${BASE_URL}/challenges/do-task`, {
    method: "POST", headers: apiHeaders(token),
    body: JSON.stringify({ taskGuid, extraArguments }),
  }).then(r => r.json());
}

// ============ TASK RUNNERS ============
async function runSimpleTask(token, task, label) {
  if (task.status === "SUCCESSFUL") {
    log(`  ✓ ${label.padEnd(10)} ${task.title}`);
    return;
  }
  const r = await doTask(token, task.taskGuid);
  log(`  ${icon(r.state)} ${label.padEnd(10)} ${task.title} │ ${r.points ?? 0} pts`);
}

async function runQuestionnaire(token, task, answers) {
  if (task.status === "SUCCESSFUL") {
    log(`  ✓ quiz       ${task.title}`);
    return;
  }
  if (!answers || answers.length === 0) {
    log(`  - quiz       ${task.title} │ no answers`);
    return;
  }
  log(`  ◌ quiz       ${task.title} | guid: ${task.taskGuid}`);
  for (let i = 0; i < answers.length; i++) {
    const { text } = answers[i];
    const r = await doTask(token, task.taskGuid, [String(i), text]);
    log(`    ${icon(r.state)} Q${String(i+1).padStart(2,"0")} → ${text.slice(0,45)} | ${JSON.stringify(r)}`);
    await sleep(1000);
  }
}

// ============ MAIN RUNNER ============
async function runWallet(privateKey, answers, idx) {
  const wallet = new ethers.Wallet(privateKey);
  log(`\n── Wallet ${idx+1} ─────────────────────────────────────────────────────`);
  log(`   ${wallet.address}`);

  let token;
  try {
    token = await login(wallet);
    try { await createReferral(token); } catch (_) {}
    log(`   ✓ Login OK`);
  } catch (e) {
    log(`   ✗ Login gagal: ${e.message}`);
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token);
  } catch (e) {
    log(`   ✗ Fetch tasks gagal: ${e.message}`);
    return;
  }

  const done = tasks.filter(t => t.status === "SUCCESSFUL").length;
  log(`   Tasks: ${done}/${tasks.length} selesai\n`);

  let quizIdx = 0;
  for (const task of tasks) {
    try {
      if (task.taskName === "click_link") {
        await runSimpleTask(token, task, "link");
      } else if (task.taskName === "retweet_post") {
        await runSimpleTask(token, task, "retweet");
      } else if (task.taskName === "questionnaire") {
        log(`   [quiz ${quizIdx}] ${task.title}`);
        await runQuestionnaire(token, task, answers[quizIdx]);
        quizIdx++;
      }
      // task lain di-skip diam-diam
      if (task.status !== "SUCCESSFUL") await sleep(1500);
    } catch (e) {
      log(`   ✗ Error: ${e.message}`);
    }
  }

  log(`\n   ✓ Selesai`);
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
  log(`   Answers loaded: ${answers.length} quiz`);
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
    await runWallet(selected[i].key, answers, selected[i].idx);
    if (i < selected.length - 1) await sleep(3000);
  }

  log("\n  ✓ Semua wallet selesai\n");
}

main().catch(console.error);
