import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";

// ============================
//          CONFIG
// ============================
dotenv.config();

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL;
const USER_ID = process.env.USER_ID;

// El QR que venís usando (HAVANNA, QR 3.0)
const QR_CODE =
  "00020101021140200010com.yacare02022350150011336972350495204739953030325802AR5910HAVANNA SA6012BUENOS AIRES81220010com.yacare0204Y2156304E401";

// ============================
//   1) Obtener direcciones
// ============================

async function getDepositAddresses() {
  console.log("\n👉 1) Obteniendo wallets para depósito USDC...\n");

  const res = await axios.get(
    `${BASE_URL}/info/deposit-info/USDC?userAnyId=${USER_ID}`,
    { headers: { "md-api-key": API_KEY } }
  );

  console.log("=== DIRECCIONES PARA DEPOSITAR USDC ===");
  console.log(res.data);

  // Elegimos BASE como red recomendada (podés cambiarla si querés otra)
  const wallet = res.data.BASE.address;
  console.log("\n💰 Dirección BASE Sepolia para depositar USDC:");
  console.log(wallet);

  return wallet;
}

// ============================
//      2) Lock del pago
// ============================

async function lockPayment() {
  console.log("\n👉 2) Lockeando QR para saber cuántos USDC se necesitan...\n");

  const body = {
    userAnyId: USER_ID,
    paymentDestination: QR_CODE,
    against: "USDC"
  };

  const res = await axios.post(
    `${BASE_URL}/payment-locks`,
    body,
    { headers: { "md-api-key": API_KEY } }
  );

  console.log("=== RESPUESTA PAYMENT LOCK ===");
  console.log(res.data);

  console.log("\n💵 USDC necesarios para pagar:");
  console.log(`${res.data.paymentAgainstAmount} USDC`);

  return {
    qrCode: res.data.code,                       // 👈 ESTE es el qrCode que pide el synthetic
    requiredUSDC: parseFloat(res.data.paymentAgainstAmount)
  };
}

// ============================
//    3) Esperar fondos
// ============================

async function waitForDeposit(requiredUSDC) {
  console.log("\n👉 3) Esperando a que los fondos aparezcan en la wallet...\n");
  console.log(
    "   (Cambiar config.txt → waitForBalance=false para continuar inmediatamente)\n"
  );

  while (true) {
    // --- Leer config.txt ---
    try {
      const configRaw = fs.readFileSync("config.txt", "utf8");
      const match = configRaw.match(/waitForBalance\s*=\s*(true|false)/i);

      if (match) {
        const flag = match[1].toLowerCase() === "true";
        if (!flag) {
          console.log(
            "\n⏭️ waitForBalance=false → Saliendo del loop y continuando...\n"
          );
          return;
        }
      }
    } catch (err) {
      console.log("⚠ No se pudo leer config.txt:", err.message);
    }

    // --- Lógica original de chequeo de balance ---
    const res = await axios.get(
      `${BASE_URL}/user-balances/${USER_ID}`,
      { headers: { "md-api-key": API_KEY } }
    );

    const balance = parseFloat(res.data.balance?.USDC ?? "0");
    console.log(`🔎 USDC actual: ${balance} (necesita ≥ ${requiredUSDC})`);

    if (balance >= requiredUSDC) {
      console.log("\n✅ Fondos detectados. Continuando...\n");
      return;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }
}

// ============================
//   4) Confirmar el pago
// ============================

async function confirmPayment(qrCode) {
  console.log("\n👉 4) Confirmando pago del QR...\n");

  const body = {
    externalId: "example-external-id-5", // opcional
    sessionId: "example-session-id-1",   // opcional
    userAnyId: USER_ID,
    qrCode,                              // 👈 acá va el code devuelto por /payment-locks
    disallowDebt: true                   // para que no opere contra deuda
  };

  const res = await axios.post(
    `${BASE_URL}/synthetics/qr-payment`,
    body,
    { headers: { "md-api-key": API_KEY } }
  );

  console.log("=== PAGO INICIADO ===");
  console.log(res.data);

  return res.data.id; // syntheticId
}

// ============================
//   5) Monitorear synthetic
// ============================

async function monitorSynthetic(syntheticId) {
  console.log("\n👉 5) Monitoreando estado del pago...\n");

  while (true) {
    const res = await axios.get(
      `${BASE_URL}/synthetics/${syntheticId}`,
      { headers: { "md-api-key": API_KEY } }
    );

    const status = res.data.status;
    console.log(`🔄 Estado actual: ${status}`);

    if (status === "COMPLETED") {
      console.log("\n🎉 PAGO COMPLETADO\n");
      return;
    }

    if (status === "CANCELLED") {
      console.log("\n❌ PAGO CANCELADO\n");
      return;
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ============================
//       EJECUCIÓN PRINCIPAL
// ============================

(async () => {
  try {
    const wallet = await getDepositAddresses();
    const { qrCode, requiredUSDC } = await lockPayment();
    await waitForDeposit(requiredUSDC);
    const syntheticId = await confirmPayment(qrCode);
    await monitorSynthetic(syntheticId);
  } catch (err) {
    console.error("\n💥 ERROR EN EL SCRIPT:");
    console.error(err.response?.data || err.message);
  }
})();
