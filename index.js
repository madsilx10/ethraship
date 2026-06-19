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
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  const file = fs.readFileSync("wallets.txt", "utf-8");
  return file
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function loadAnswers() {
  const file = fs.readFileSync("answers.txt", "utf-8");
  return file
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(",").map((a) => a.trim()));
}

// ============ AUTH ============
async function getPrivyHeaders(extra = {}) {
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
  // 1. Init - get nonce
  const initRes = await fetch(`${PRIVY_URL}/api/v1/siwe/init`, {
    method: "POST",
    headers: await getPrivyHeaders(),
    body: JSON.stringify({ address: wallet.address }),
  });
  const { nonce } = await initRes.json();

  // 2. Build SIWE message
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

  // 3. Sign
  const signature = await wallet.signMessage(message);

  // 4. Authenticate
  const authRes = await fetch(`${PRIVY_URL}/api/v1/siwe/authenticate`, {
    method: "POST",
    headers: await getPrivyHeaders(),
    body: JSON.stringify({
      message,
      signature,
      chainId: CHAIN_ID,
      walletClientType: "metamask",
      connectorType: "injected",
      mode: "login-or-sign-up",
    }),
  });

  const authData = await authRes.json();
  if (!authData.token) throw new Error("Login failed: " + JSON.stringify(authData));

  log(`Login OK: ${wallet.address}`);
  return authData.token;
}

// ============ TASKS ============
async function getTasks(token) {
  const res = await fetch(`${BASE_URL}/challenges/ethra-portal/tasks-status/2`, {
    headers: {
      "Content-Type": "application/json",
      "X-Privy-Access-Token": `Bearer ${token}`,
    },
  });
  const data = await res.json();
  return data.tasksStatus || [];
}

async function doTask(token, taskGuid, extraArguments = []) {
  const res = await fetch(`${BASE_URL}/challenges/do-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Privy-Access-Token": `Bearer ${token}`,
    },
    body: JSON.stringify({ taskGuid, extraArguments }),
  });
  return res.json();
}

// ============ TASK RUNNERS ============
async function runClickLink(token, task) {
  const result = await doTask(token, task.taskGuid);
  log(`[click_link] ${task.title} → ${result.state} (${result.points} pts)`);
}

async function runRetweet(token, task) {
  const result = await doTask(token, task.taskGuid);
  log(`[retweet] ${task.title} → ${result.state} (${result.points} pts)`);
}

async function runQuestionnaire(token, task, answers) {
  if (!answers || answers.length === 0) {
    log(`[quiz] ${task.title} → skip (no answers)`);
    return;
  }

  // Get questions from task arguments
  const questionsArg = task.arguments.find((a) => a.name === "questions");
  if (!questionsArg) {
    log(`[quiz] ${task.title} → skip (no questions found)`);
    return;
  }

  const questions = JSON.parse(questionsArg.value);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answerIndex = parseInt(answers[i] ?? "0");
    const answerText = q.options[answerIndex];
    const extraArguments = [String(answerIndex), answerText];

    const result = await doTask(token, task.taskGuid, extraArguments);
    log(`[quiz] Q${i + 1}: ${answerIndex} → ${result.state}`);
    await sleep(1000);
  }
}

// ============ MAIN RUNNER ============
async function runWallet(privateKey, answers, walletIndex) {
  const wallet = new ethers.Wallet(privateKey);
  log(`\n=== Wallet ${walletIndex + 1}: ${wallet.address} ===`);

  let token;
  try {
    token = await login(wallet);
  } catch (e) {
    log(`Login error: ${e.message}`);
    return;
  }

  let tasks;
  try {
    tasks = await getTasks(token);
  } catch (e) {
    log(`Get tasks error: ${e.message}`);
    return;
  }

  // Filter only pending tasks
  const pending = tasks.filter((t) => t.status !== "SUCCESSFUL");
  log(`Tasks pending: ${pending.length}`);

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
        log(`[skip] ${task.taskName}: ${task.title}`);
      }
      await sleep(1500);
    } catch (e) {
      log(`Error on task ${task.taskName}: ${e.message}`);
    }
  }

  log(`=== Done: ${wallet.address} ===`);
}

// ============ ENTRY POINT ============
async function main() {
  console.log("\n=== EthraShip Bot ===");
  console.log("Referral:", REFERRAL_CODE);
  console.log("");
  console.log("1. Jalankan 1 wallet (urutan pertama)");
  console.log("2. Jalankan semua wallet");
  console.log("3. Jalankan dari wallet ke-N sampai akhir");
  console.log("");

  const choice = await prompt("Pilih (1/2/3): ");

  let wallets = loadWallets();
  const answers = loadAnswers();

  let selected = [];

  if (choice === "1") {
    const num = await prompt(`Wallet nomor berapa? (1-${wallets.length}): `);
    const idx = parseInt(num) - 1;
    if (idx < 0 || idx >= wallets.length) {
      console.log("Nomor wallet tidak valid.");
      process.exit(1);
    }
    selected = [wallets[idx]];
  } else if (choice === "2") {
    selected = wallets;
  } else if (choice === "3") {
    const from = await prompt(`Mulai dari wallet ke (1-${wallets.length}): `);
    const idx = parseInt(from) - 1;
    selected = wallets.slice(idx);
  } else {
    console.log("Pilihan tidak valid.");
    process.exit(1);
  }

  console.log(`\nTotal wallet: ${selected.length}\n`);

  for (let i = 0; i < selected.length; i++) {
    await runWallet(selected[i], answers, wallets.indexOf(selected[i]));
    if (i < selected.length - 1) await sleep(3000);
  }

  console.log("\n=== Selesai ===");
}

main().catch(console.error);
