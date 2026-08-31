/ Captura automática do Saldo Diário — roda no GitHub Actions, sem precisar
// que ninguém esteja com o painel aberto no navegador (inclusive fins de semana).
//
// Replica exatamente a mesma lógica de cálculo usada no painel (index.html):
// soma Valor Unitário x Quantidade de todos os registros "em aberto",
// separado por depósito 014 e 023.

const admin = require('firebase-admin');

const FS_COLLECTION = 'painel_estoques_023_014';
const SALDO_COLLECTION = 'saldo_diario_023_014';
const K_REGISTROS = 'retrabalho_registros_v1';
const K_NC_REGISTROS = 'nc023_registros_v1';

function todayISOSaoPaulo() {
  // Brasil não usa mais horário de verão desde 2019 — São Paulo é sempre UTC-3.
  const now = new Date();
  const spTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return spTime.toISOString().slice(0, 10);
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Variável de ambiente FIREBASE_SERVICE_ACCOUNT_JSON não encontrada.');
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const [regSnap, ncSnap] = await Promise.all([
    db.collection(FS_COLLECTION).doc(K_REGISTROS).get(),
    db.collection(FS_COLLECTION).doc(K_NC_REGISTROS).get(),
  ]);
  const registros = (regSnap.exists && regSnap.data().items) || [];
  const ncRegistros = (ncSnap.exists && ncSnap.data().items) || [];

  const abertos = registros.filter(r => r.status === 'aberto')
    .concat(ncRegistros.filter(r => r.status === 'aberto'));

  let d014 = 0, d023 = 0;
  abertos.forEach(r => {
    if (r.valorUnitario == null || r.quantidade == null) return;
    const v = r.valorUnitario * r.quantidade;
    if (r.deposito === '014') d014 += v;
    else if (r.deposito === '023') d023 += v;
  });

  const dateStr = todayISOSaoPaulo();
  const ref = db.collection(SALDO_COLLECTION).doc(dateStr);
  const existing = await ref.get();
  if (existing.exists) {
    console.log('Saldo de ' + dateStr + ' já estava capturado — nada a fazer.');
    return;
  }

  await ref.set({
    deposito014: d014,
    deposito023: d023,
    total: d014 + d023,
    capturadoEm: new Date().toISOString(),
    capturadoPor: 'Automação (GitHub Actions)',
    automatico: true,
  });

  console.log('Saldo de ' + dateStr + ' capturado com sucesso:', {
    deposito014: d014.toFixed(2),
    deposito023: d023.toFixed(2),
    total: (d014 + d023).toFixed(2),
    itensConsiderados: abertos.length,
  });
}

main().catch(err => {
  console.error('Falha ao capturar o saldo diário:', err);
  process.exit(1);
});
