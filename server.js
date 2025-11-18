// ==========================================================
// SERVIDOR RASPADINHA DO PIX
// ==========================================================
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const session = require('express-session');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// --- CONFIGURAÇÃO DO BANCO DE DADOS (PostgreSQL) ---
const { Pool } = require('pg');
const PgStore = require('connect-pg-simple')(session);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
});

const db = {
    query: (text, params) => pool.query(text, params),
};

console.log("Conectando ao banco de dados PostgreSQL (Raspadinha)...");

// --- FUNÇÃO PARA INICIALIZAR O BANCO DE DADOS ---
async function inicializarBanco() {
    console.log("Verificando estrutura do banco de dados (Raspadinha)...");
    try {
        await db.query(`CREATE TABLE IF NOT EXISTS raspadinha_config (chave TEXT PRIMARY KEY, valor TEXT);`);
        await db.query(`CREATE TABLE IF NOT EXISTS raspadinha_faixas_premio (id SERIAL PRIMARY KEY, valor REAL NOT NULL, chance REAL NOT NULL, descricao TEXT, ativo BOOLEAN DEFAULT true);`);
        await db.query(`CREATE TABLE IF NOT EXISTS raspadinha_vendas (id SERIAL PRIMARY KEY, nome_jogador TEXT NOT NULL, telefone TEXT, valor_pago REAL NOT NULL, valor_premio REAL NOT NULL, payment_id TEXT UNIQUE, status_pagamento_premio TEXT DEFAULT 'Pendente' NOT NULL, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`);
        await db.query(`CREATE TABLE IF NOT EXISTS raspadinha_admin (id SERIAL PRIMARY KEY, usuario TEXT UNIQUE NOT NULL, senha TEXT NOT NULL);`);
        await db.query(`CREATE TABLE IF NOT EXISTS raspadinha_pagamentos_pendentes (payment_id TEXT PRIMARY KEY, socket_id TEXT NOT NULL, dados_compra_json TEXT NOT NULL, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);`);

        const configQuery = 'INSERT INTO raspadinha_config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING';
        await db.query(configQuery, ['preco_raspadinha', '2.00']);
        await db.query(configQuery, ['premio_maximo_display', '100.00']);

        const faixasRes = await db.query('SELECT COUNT(*) as total FROM raspadinha_faixas_premio');
        if (faixasRes.rows[0].total == 0) {
            const faixaQuery = 'INSERT INTO raspadinha_faixas_premio (valor, chance, descricao) VALUES ($1, $2, $3)';
            await db.query(faixaQuery, [100.00, 1, 'Prêmio Máximo']);
            await db.query(faixaQuery, [20.00, 5, 'Prêmio Alto']);
            await db.query(faixaQuery, [5.00, 10, 'Prêmio Médio']);
            await db.query(faixaQuery, [2.00, 15, 'Ganha o que pagou']);
        }

        const adminRes = await db.query('SELECT COUNT(*) as total FROM raspadinha_admin');
        if (adminRes.rows[0].total == 0) {
            const senhaHash = await bcrypt.hash('admin123', 10);
            await db.query('INSERT INTO raspadinha_admin (usuario, senha) VALUES ($1, $2)', ['admin', senhaHash]);
        }
        console.log("Estrutura do banco (Raspadinha) verificada.");
    } catch (err) {
        console.error("ERRO BANCO:", err);
        process.exit(1); 
    }
}

// ==========================================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORTA = process.env.PORT || 4000;

// ==========================================================
// MERCADO PAGO
// ==========================================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN; 
const mpClient = new MercadoPagoConfig({ accessToken: MERCADOPAGO_ACCESS_TOKEN, options: { timeout: 5000 }});
const MERCADOPAGO_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET; 

// ==========================================================
// SESSÃO
// ==========================================================
const store = new PgStore({ pool: pool, tableName: 'sessions', pruneSessionInterval: 60 });
app.use(session({ 
    store: store, 
    secret: process.env.SESSION_SECRET_RASPADINHA || 'segredo_raspadinha', 
    resave: false, saveUninitialized: false, 
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax' },
    name: 'raspadinha.sid' 
}));

// ==========================================================
// LÓGICA DE SORTEIO
// ==========================================================
async function sortearPremio() {
    try {
        const faixasRes = await db.query('SELECT valor, chance FROM raspadinha_faixas_premio WHERE ativo = true');
        const faixas = faixasRes.rows;
        let totalChance = 0;
        faixas.forEach(f => totalChance += parseFloat(f.chance));
        faixas.push({ valor: 0.00, chance: Math.max(0, 100 - totalChance) });

        const numeroAleatorio = Math.random() * 100;
        let acumulado = 0;
        for (const faixa of faixas) {
            acumulado += parseFloat(faixa.chance);
            if (numeroAleatorio < acumulado) return parseFloat(faixa.valor); 
        }
        return 0.00;
    } catch (e) { return 0.00; }
}

// ==========================================================
// WEBHOOK
// ==========================================================
app.post('/webhook-mercadopago', express.raw({ type: 'application/json' }), async (req, res) => {
    let reqBody;
    try { reqBody = JSON.parse(req.body.toString()); } catch (e) { return res.sendStatus(400); }

    if (reqBody.type === 'payment') {
        const paymentId = reqBody.data.id;
        try {
            const payment = new Payment(mpClient);
            const pagamento = await payment.get({ id: paymentId });
            
            if (pagamento.status === 'approved') {
                const pendingRes = await db.query("SELECT * FROM raspadinha_pagamentos_pendentes WHERE payment_id = $1", [paymentId]);
                if (pendingRes.rows.length > 0) {
                    const pending = pendingRes.rows[0];
                    const dados = JSON.parse(pending.dados_compra_json);
                    const valorPremio = await sortearPremio();
                    
                    await db.query(`INSERT INTO raspadinha_vendas (nome_jogador, telefone, valor_pago, valor_premio, payment_id, status_pagamento_premio) VALUES ($1, $2, $3, $4, $5, $6)`, 
                        [dados.nome, dados.telefone, dados.valorTotal, valorPremio, paymentId, valorPremio > 0 ? 'Pendente' : 'Pago']);
                    
                    await db.query("DELETE FROM raspadinha_pagamentos_pendentes WHERE payment_id = $1", [paymentId]);
                    
                    io.to(pending.socket_id).emit('pagamentoAprovado', { paymentId: paymentId, valorPremio: valorPremio });
                }
                return res.status(200).send('OK');
            }
        } catch (error) { return res.status(500).send('Erro'); }
    }
    res.status(200).send('OK');
});

// ==========================================================
// ROTAS E SIMULAÇÃO
// ==========================================================
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTA DE DEBUG PARA SIMULAR PAGAMENTO (TESTE) ---
app.post('/api/debug/simular', async (req, res) => {
    const { socketId, nome, telefone, paymentId } = req.body;
    console.log(`Simulando pagamento para Socket: ${socketId}`);
    
    const valorPremio = await sortearPremio();

    // Salva como venda "Simulada" no banco para não quebrar o fluxo
    await db.query(`INSERT INTO raspadinha_vendas (nome_jogador, telefone, valor_pago, valor_premio, payment_id, status_pagamento_premio) VALUES ($1, $2, $3, $4, $5, $6)`, 
        [nome || 'Teste', telefone || '000000000', 0.00, valorPremio, paymentId, 'Simulado']);

    // Emite o evento de aprovação imediatamente
    io.to(socketId).emit('pagamentoAprovado', { 
        paymentId: paymentId, 
        valorPremio: valorPremio 
    });

    res.json({ success: true });
});

// --- Outras Rotas ---
let PRECO = 2.00; let PREMIO_MAX = 100.00;
app.get('/api/raspadinha/config', (req, res) => res.json({ success: true, preco: PRECO, premioMaximo: PREMIO_MAX }));

app.post('/api/raspadinha/criar-pagamento', async (req, res) => {
    const { nome, telefone } = req.body;
    const socketId = req.headers['x-socket-id'];
    try {
        const payment = new Payment(mpClient);
        const body = {
            transaction_amount: PRECO,
            description: `Raspadinha - ${nome}`,
            payment_method_id: 'pix',
            notification_url: `${process.env.BASE_URL}/webhook-mercadopago`,
            payer: { email: `user_${telefone}@test.com`, first_name: nome }
        };
        const response = await payment.create({ body });
        const paymentId = response.id.toString();

        await db.query(`INSERT INTO raspadinha_pagamentos_pendentes (payment_id, socket_id, dados_compra_json) VALUES ($1, $2, $3) ON CONFLICT (payment_id) DO UPDATE SET socket_id = EXCLUDED.socket_id`, 
            [paymentId, socketId, JSON.stringify({ nome, telefone, valorTotal: PRECO })]);

        res.json({ success: true, qrCodeBase64: response.point_of_interaction.transaction_data.qr_code_base64, qrCodeCopiaCola: response.point_of_interaction.transaction_data.qr_code, paymentId: paymentId });
    } catch(e) { res.status(500).json({ success: false, message: 'Erro PIX' }); }
});

app.post('/api/raspadinha/checar-pagamento', async (req, res) => {
    const { paymentId } = req.body;
    const r = await db.query("SELECT valor_premio FROM raspadinha_vendas WHERE payment_id = $1", [paymentId]);
    if (r.rows.length > 0) res.json({ success: true, valorPremio: r.rows[0].valor_premio });
    else res.status(404).json({ success: false });
});

app.post('/api/raspadinha/checar-premios', async (req, res) => {
    const { telefone } = req.body;
    const r = await db.query("SELECT valor_premio, status_pagamento_premio, to_char(timestamp, 'DD/MM/YYYY HH24:MI') as data_formatada FROM raspadinha_vendas WHERE telefone = $1 ORDER BY timestamp DESC LIMIT 20", [telefone]);
    res.json({ success: true, premios: r.rows });
});

// --- ADMIN ---
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
// (Rotas de admin omitidas para brevidade, mantêm-se iguais às originais)

// --- START ---
(async () => {
    await inicializarBanco();
    const res = await db.query("SELECT chave, valor FROM raspadinha_config");
    res.rows.forEach(r => { if(r.chave==='preco_raspadinha') PRECO=parseFloat(r.valor); if(r.chave==='premio_maximo_display') PREMIO_MAX=parseFloat(r.valor); });
    server.listen(PORTA, () => console.log(`Rodando na porta ${PORTA}`));
})();
