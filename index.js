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
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function loadWallets() {
  return fs.readFileSync("wallets.txt", "utf-8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function loadAnswers() {
  return fs.readFileSync("answers.txt", "utf-8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.split(",").map((a) => a.trim()));
}

const statusIcon = (s) => s === "SUCCESSFUL" ? "✓" : s === "PENDING" ? "◌" : s === "ERROR" ? "✗" : "?";

// ============ AUTH ============
function getPrivyHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "privy-app-id": PRIVY_APP_ID,
    "privy-ca-id": PRIVY_CA_ID,
    "privy-client": "react-auth:3.21.3",
    "Origin": "https://app.ethraship.io",
    "Referer": "https://app.ethraship.io/",
    ...extra,
  };
}

async function login(wallet) {
  const initRes = await fetch(`${PRIVY_URL}/api/v1/siwe/init`, {
    method: "POST",
    headers: getPrivyHeaders(),
    body: JSON.stringify({ address: wallet.address }),
  });
  const { nonce } = await initRes.json();

  const issuedAt = new Date().toISOString();
  const message =
    `app.ethraship.io wants you to sign in with your Ethereum account:\n` +
    `${wallet.address}\n\n` +
    `By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.\n\n` +
    `URI: https://app.ethraship.io\n` +
    `Version: 1\n` +
    `Chain ID: 21894\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Resources:\n- https://privy.io`;

  const signature = await wallet.signMessage(message);

  const authRes = await fetch(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    method: "POST",
    headers: getPrivyHeaders(),
    body: JSON.stringify({
      message, signature, chainId: CHAIN_ID,
      walletClientType: "metamask",
      connectorType: "injected",
      mode: "login-or-sign-up",
      referralCode: REFERRAL_CODE,
    }),
  });

  const authData = await authRes.json();
  if (!authData.token) throw new Error("Login failed: " + JSON.stringify(authData));
  return authData.token;
}

// ============ TASKS ============
async function fetchTasks(token, group) {
  const res = await fetch(`${BASE_URL}/challenges/ethra-portal/tasks-status/${group}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Privy-Access-Token": `Bearer ${token}`,
      "Origin": "https://app.ethraship.io",
    },
  });
  const data = await res.json();
  return data.tasksStatus || [];
}

async function getTasks(token) {
  const [group1, group2] = await Promise.all([fetchTasks(token, 1), fetchTasks(token, 2)]);
  return [...group1, ...group2];
}

async function doTask(token, taskGuid, extraArguments = []) {
  const res = await fetch(`${BASE_URL}/challenges/do-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Privy-Access-Token": `Bearer ${token}`,
      "Origin": "https://app.ethraship.io",
    },
    body: JSON.stringify({ taskGuid, extraArguments }),
  });
  return res.json();
}

// ============ TASK RUNNERS ============
async function runClickLink(token, task) {
  const result = await doTask(token, task.taskGuid);
  console.log(`  ${statusIcon(result.state)} click_link  │ ${task.title} │ ${result.points ?? 0} pts`);
}

async function runRetweet(token, task) {
  const result = await doTask(token, task.taskGuid);
  console.log(`  ${statusIcon(result.state)} retweet     │ ${task.title} │ ${result.points ?? 0} pts`);
}

async function runQuestionnaire(token, task, answers) {
  if (!answers || answers.length === 0) {
    console.log(`  - quiz       │ ${task.title} │ skip (no answers)`);
    return;
  }

  console.log(`  ◌ quiz       │ ${task.title} │ ${answers.length} soal`);
  for (let i = 0; i < answers.length; i++) {
    const answerIndex = answers[i];
    const result = await doTask(token, task.taskGuid, [answerIndex]);
    console.log(`    ${statusIcon(result.state)} Q${String(i + 1).padStart(2, "0")} │ jawaban: ${answerIndex}`);
    await sleep(1000);
  }
}

// ============ MAIN RUNNER ============
async function runWallet(privateKey, answers, walletIndex) {
  const wallet = new ethers.Wallet(privateKey);
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  Wallet ${walletIndex + 1} │ ${wallet.address}`);
  console.log(`${"─".repeat(70)}`);

  let token;
  try {
    token = await login(wallet);
    console.log(`  ✓ Login OK`);
  } catch (e) {
    console.log(`  ✗ Login gagal: ${e.message}`);
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token);
  } catch (e) {
    console.log(`  ✗ Gagal fetch tasks: ${e.message}`);
    return;
  }

  const pending = tasks.filter((t) => t.status !== "SUCCESSFUL");
  console.log(`  Tasks pending: ${pending.length} / ${tasks.length}\n`);

  let quizIndex = 0;
  for (const task of pending) {
    try {
      if (task.taskName === "click_link") {
        await runClickLink(token, task);
      } else if (task.taskName === "retweet_post") {
        await runRetweet(token, task);
      } else if (task.taskName === "questionnaire") {
        await runQuestionnaire(token, task, answers[quizIndex]);
        quizIndex++;
      } else {
        console.log(`  - skip       │ ${task.taskName} │ ${task.title}`);
      }
      await sleep(1500);
    } catch (e) {
      console.log(`  ✗ Error ${task.taskName}: ${e.message}`);
    }
  }

  console.log(`\n  ✓ Selesai: ${wallet.address}`);
}

// ============ ENTRY POINT ============
async function main() {
  console.log("\n╔══════════════════════════════╗");
  console.log("║      EthraShip Bot           ║");
  console.log(`║  Ref: ${REFERRAL_CODE}  ║`);
  console.log("╚══════════════════════════════╝\n");
  console.log("  1. Jalankan 1 wallet");
  console.log("  2. Jalankan semua wallet");
  console.log("  3. Jalankan dari wallet ke-N sampai akhir\n");

  const choice = await prompt("Pilih (1/2/3): ");
  const wallets = loadWallets();
  const answers = loadAnswers();

  let selected = [];

  if (choice === "1") {
    const num = await prompt(`Wallet nomor berapa? (1-${wallets.length}): `);
    const idx = parseInt(num) - 1;
    if (idx < 0 || idx >= wallets.length) { console.log("Nomor tidak valid."); process.exit(1); }
    selected = [{ key: wallets[idx], idx }];
  } else if (choice === "2") {
    selected = wallets.map((key, idx) => ({ key, idx }));
  } else if (choice === "3") {
    const from = await prompt(`Mulai dari wallet ke (1-${wallets.length}): `);
    const idx = parseInt(from) - 1;
    selected = wallets.slice(idx).map((key, i) => ({ key, idx: idx + i }));
  } else {
    console.log("Pilihan tidak valid."); process.exit(1);
  }

  console.log(`\n  Total wallet: ${selected.length}\n`);

  for (let i = 0; i < selected.length; i++) {
    await runWallet(selected[i].key, answers, selected[i].idx);
    if (i < selected.length - 1) await sleep(3000);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ✓ Semua wallet selesai`);
  console.log(`${"═".repeat(70)}\n`);
}

main().catch(console.error);
