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
        // Tabela de Configurações (preço, prêmio máx, etc.)
        await db.query(`
            CREATE TABLE IF NOT EXISTS raspadinha_config (
                chave TEXT PRIMARY KEY, 
                valor TEXT
            );
        `);

        // Tabela das Faixas de Prêmio (ex: 5% de R$100)
        await db.query(`
            CREATE TABLE IF NOT EXISTS raspadinha_faixas_premio (
                id SERIAL PRIMARY KEY,
                valor REAL NOT NULL,
                chance REAL NOT NULL,
                descricao TEXT,
                ativo BOOLEAN DEFAULT true
            );
        `);

        // Tabela de Vendas/Prêmios (quem comprou, quem ganhou)
        await db.query(`
            CREATE TABLE IF NOT EXISTS raspadinha_vendas (
                id SERIAL PRIMARY KEY,
                nome_jogador TEXT NOT NULL, 
                telefone TEXT, 
                valor_pago REAL NOT NULL,
                valor_premio REAL NOT NULL,
                payment_id TEXT UNIQUE,
                status_pagamento_premio TEXT DEFAULT 'Pendente' NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Tabela de Admin
        await db.query(`
            CREATE TABLE IF NOT EXISTS raspadinha_admin (
                id SERIAL PRIMARY KEY, 
                usuario TEXT UNIQUE NOT NULL, 
                senha TEXT NOT NULL
            );
        `);
        
        // Tabela de Pagamentos Pendentes
        await db.query(`
            CREATE TABLE IF NOT EXISTS raspadinha_pagamentos_pendentes (
                payment_id TEXT PRIMARY KEY,
                socket_id TEXT NOT NULL,
                dados_compra_json TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // --- INSERIR CONFIGS PADRÃO ---
        const configs = [
            { chave: 'preco_raspadinha', valor: '2.00' },
            { chave: 'premio_maximo_display', valor: '100.00' } // Usado só para mostrar na index
        ];
        const configQuery = 'INSERT INTO raspadinha_config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING';
        for (const config of configs) {
            await db.query(configQuery, [config.chave, config.valor]);
        }

        // --- INSERIR FAIXAS DE PRÊMIO PADRÃO (SE VAZIO) ---
        const faixasRes = await db.query('SELECT COUNT(*) as total FROM raspadinha_faixas_premio');
        if (faixasRes.rows[0].total == 0) {
            console.log("Inserindo faixas de prêmio padrão...");
            const faixaQuery = 'INSERT INTO raspadinha_faixas_premio (valor, chance, descricao) VALUES ($1, $2, $3)';
            await db.query(faixaQuery, [100.00, 1, 'Prêmio Máximo']); // 1%
            await db.query(faixaQuery, [20.00, 5, 'Prêmio Alto']);    // 5%
            await db.query(faixaQuery, [5.00, 10, 'Prêmio Médio']);   // 10%
            await db.query(faixaQuery, [2.00, 15, 'Ganha o que pagou']); // 15%
            // Total de 31% de chance de ganhar algo. 69% de chance de R$0.
        }

        // --- INSERIR ADMIN PADRÃO (SE VAZIO) ---
        const adminRes = await db.query('SELECT COUNT(*) as total FROM raspadinha_admin');
        if (adminRes.rows[0].total == 0) {
            const saltRounds = 10;
            const senhaHash = await bcrypt.hash('admin123', saltRounds);
            await db.query('INSERT INTO raspadinha_admin (usuario, senha) VALUES ($1, $2)', ['admin', senhaHash]);
            console.log("Usuário 'admin' da raspadinha criado.");
        }
        
        console.log("Estrutura do banco (Raspadinha) verificada.");

    } catch (err) {
        console.error("ERRO CRÍTICO AO INICIALIZAR O BANCO DE DADOS (Raspadinha):", err);
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
// CONFIGURAÇÃO DO MERCADO PAGO
// ==========================================================
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN; 
const mpClient = new MercadoPagoConfig({ 
    accessToken: MERCADOPAGO_ACCESS_TOKEN,
    options: { timeout: 5000 }
});
const MERCADOPAGO_WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET; 

if (!MERCADOPAGO_ACCESS_TOKEN) console.warn("AVISO: MERCADOPAGO_ACCESS_TOKEN não configurado.");
if (!MERCADOPAGO_WEBHOOK_SECRET) console.warn("AVISO: MERCADOPAGO_WEBHOOK_SECRET não configurado.");

// ==========================================================
// CONFIGURAÇÃO DE SESSÃO (PG)
// ==========================================================
const store = new PgStore({
    pool: pool,
    tableName: 'sessions', // O nome da tabela DEVE ser "sessions"
    pruneSessionInterval: 60
});
const SESSION_SECRET = process.env.SESSION_SECRET_RASPADINHA || 'segredo_diferente_para_raspadinha!';
app.use(session({ 
    store: store, 
    secret: SESSION_SECRET, 
    resave: false, 
    saveUninitialized: false, 
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax' },
    name: 'raspadinha.sid' // Nome do cookie diferente do bingo
}));


// ==========================================================
// LÓGICA DE SORTEIO (O CORAÇÃO DO SISTEMA)
// ==========================================================
async function sortearPremio() {
    try {
        const faixasRes = await db.query('SELECT valor, chance FROM raspadinha_faixas_premio WHERE ativo = true');
        const faixas = faixasRes.rows;

        let totalChance = 0;
        faixas.forEach(f => {
            totalChance += parseFloat(f.chance);
        });

        const chanceZero = Math.max(0, 100 - totalChance); 
        faixas.push({ valor: 0.00, chance: chanceZero });

        const numeroAleatorio = Math.random() * 100;
        let acumulado = 0;

        for (const faixa of faixas) {
            acumulado += parseFloat(faixa.chance);
            if (numeroAleatorio < acumulado) {
                console.log(`Sorteio: ${faixa.valor.toFixed(2)} (Rand: ${numeroAleatorio.toFixed(2)} < Acum: ${acumulado.toFixed(2)})`);
                return parseFloat(faixa.valor); 
            }
        }
        
        return 0.00; // Segurança
    } catch (e) {
        console.error("Erro CRÍTICO ao sortear prêmio:", e);
        return 0.00; // Retorna 0 em caso de erro
    }
}


// ==========================================================
// WEBHOOK DO MERCADO PAGO (CORRIGIDO)
// ==========================================================
app.post('/webhook-mercadopago', express.raw({ type: 'application/json' }), async (req, res) => { // <-- TORNADO ASYNC
    console.log("Webhook (Raspadinha) recebido!");
    let reqBody;
    try {
        reqBody = JSON.parse(req.body.toString());
    } catch (e) {
        console.error("Webhook ERRO: Falha ao parsear JSON.");
        return res.sendStatus(400); // Responde e sai
    }

    // --- Validação de Assinatura ---
    const signature = req.headers['x-signature'];
    const requestId = req.headers['x-request-id'];
    if (!signature || !requestId) {
        console.warn("Webhook REJEITADO: Headers ausentes.");
        return res.sendStatus(400); // Responde e sai
    }
    if (MERCADOPAGO_WEBHOOK_SECRET) {
        try {
            if (!reqBody.data || !reqBody.data.id) {
                console.log("Webhook (Raspadinha) sem 'data.id'. Respondendo 200 OK.");
                return res.sendStatus(200); // Responde e sai
            }
            const dataId = String(reqBody.data.id);
            const parts = signature.split(',').reduce((acc, part) => {
                const [key, value] = part.split('='); acc[key.trim()] = value.trim(); return acc;
            }, {});
            const ts = parts.ts;
            const hash = parts.v1;
            if (!ts || !hash) return res.sendStatus(400);
            
            const template = `id:${dataId};request-id:${requestId};ts:${ts};`;
            const hmac = crypto.createHmac('sha256', MERCADOPAGO_WEBHOOK_SECRET);
            hmac.update(template);
            const calculatedHash = hmac.digest('hex');

            if (calculatedHash !== hash) {
                console.error("Webhook REJEITADO (Raspadinha): Assinatura inválida.");
                return res.sendStatus(403); // Responde e sai
            }
            console.log("Assinatura do Webhook (Raspadinha) validada.");
        } catch (err) {
            console.error("Webhook ERRO (Raspadinha): Falha ao validar assinatura:", err.message);
            return res.sendStatus(400); // Responde e sai
        }
    } else {
        console.warn("AVISO: Processando Webhook (Raspadinha) SEM VALIDAÇÃO");
    }
    // --- Fim da Validação ---

    if (reqBody.type === 'payment') {
        const paymentId = reqBody.data.id;
        console.log(`Webhook (Raspadinha): ID de Pagamento ${paymentId}`);

        try {
            const payment = new Payment(mpClient);
            const pagamento = await payment.get({ id: paymentId }); // ESPERA pelo pagamento
            const status = pagamento.status;
            console.log(`Webhook (Raspadinha): Status ${paymentId} é: ${status}`);

            if (status === 'approved') {
                const query = "SELECT * FROM raspadinha_pagamentos_pendentes WHERE payment_id = $1";
                const pendingPaymentResult = await db.query(query, [paymentId]);

                if (pendingPaymentResult.rows.length === 0) {
                    console.warn(`Webhook (Raspadinha): Pagamento ${paymentId} aprovado, mas não encontrado no DB pendente. (Race Condition)`);
                    return res.status(404).send('Pagamento pendente não encontrado, tente novamente.');
                }

                // Fluxo normal
                const pendingPayment = pendingPaymentResult.rows[0];
                const dadosCompra = JSON.parse(pendingPayment.dados_compra_json);
                const socketId = pendingPayment.socket_id;
                
                const valorPremio = await sortearPremio();
                
                const vendaQuery = `
                    INSERT INTO raspadinha_vendas 
                    (nome_jogador, telefone, valor_pago, valor_premio, payment_id, status_pagamento_premio)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `;
                const statusPremio = valorPremio > 0 ? 'Pendente' : 'Pago';
                
                await db.query(vendaQuery, [
                    dadosCompra.nome, dadosCompra.telefone, dadosCompra.valorTotal, 
                    valorPremio, paymentId, statusPremio
                ]);

                await db.query("DELETE FROM raspadinha_pagamentos_pendentes WHERE payment_id = $1", [paymentId]);
                console.log(`Pagamento ${paymentId} (Raspadinha) processado. Prêmio: R$${valorPremio}`);

                io.to(socketId).emit('pagamentoAprovado', {
                    paymentId: paymentId,
                    valorPremio: valorPremio
                });

                // Envia 200 OK SÓ DEPOIS de processar
                return res.status(200).send('Pagamento aprovado e processado.');

            } else if (status === 'cancelled' || status === 'rejected') {
                await db.query("DELETE FROM raspadinha_pagamentos_pendentes WHERE payment_id = $1", [paymentId]);
                console.log(`Pagamento ${paymentId} (Raspadinha) ${status} removido.`);
                // Envia 200 OK
                return res.status(200).send('Pagamento cancelado/rejeitado processado.');
            }

        } catch (error) {
            console.error("Webhook ERRO (Raspadinha): Falha ao buscar pagamento no MP:", error);
            // Avisa o MP que deu erro para ele tentar de novo
            return res.status(500).send('Erro interno ao processar pagamento.');
        }
    }

    // Responde 200 OK se não for do tipo 'payment'
    res.status(200).send('Webhook recebido, mas não é um pagamento.');
});

// ==========================================================
// MIDDLEWARES GERAIS
// ==========================================================
app.use(express.json()); // DEPOIS do webhook
app.use(express.static(path.join(__dirname, 'public')));


// ==========================================================
// VARIÁVEIS GLOBAIS DE CONFIGURAÇÃO (para cache)
// ==========================================================
let PRECO_RASPADINHA = 2.00;
let PREMIO_MAXIMO_DISPLAY = 100.00;

async function carregarConfiguracoes() {
    try {
        const res = await db.query("SELECT chave, valor FROM raspadinha_config");
        const configs = res.rows.reduce((acc, row) => {
            acc[row.chave] = row.valor;
            return acc;
        }, {});
        
        PRECO_RASPADINHA = parseFloat(configs.preco_raspadinha || '2.00');
        PREMIO_MAXIMO_DISPLAY = parseFloat(configs.premio_maximo_display || '100.00');

        console.log(`Configurações (Raspadinha) carregadas: Preço=R$${PRECO_RASPADINHA}, Prêmio Máx=R$${PREMIO_MAXIMO_DISPLAY}`);
    } catch (err) {
        console.error("Erro ao carregar configurações da Raspadinha:", err);
    }
}

// ==========================================================
// ROTAS PÚBLICAS (API DO CLIENTE)
// ==========================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API para o cliente saber o preço e o prêmio máximo
app.get('/api/raspadinha/config', (req, res) => {
    res.json({
        success: true,
        preco: PRECO_RASPADINHA,
        premioMaximo: PREMIO_MAXIMO_DISPLAY
    });
});

// API para o cliente criar o pagamento (PIX)
app.post('/api/raspadinha/criar-pagamento', async (req, res) => {
    const { nome, telefone } = req.body;
    const socketId = req.headers['x-socket-id']; // O cliente deve enviar o ID do socket

    if (!nome || !telefone || !socketId) {
        return res.status(400).json({ success: false, message: "Nome, telefone e ID do socket são obrigatórios." });
    }
    
    const valorTotal = PRECO_RASPADINHA;

    try {
        if (!process.env.BASE_URL) {
            console.error("ERRO GRAVE: BASE_URL não está configurada! O Webhook falhará.");
            return res.status(500).json({ success: false, message: 'Erro no servidor: URL de pagamento não configurada.' });
        }

        const payment = new Payment(mpClient);
        const body = {
            transaction_amount: valorTotal,
            description: `Compra de 1 Raspadinha do Pix - ${nome}`,
            payment_method_id: 'pix',
            notification_url: `${process.env.BASE_URL}/webhook-mercadopago`,
            payer: {
                email: `jogador_${telefone}@raspadinha.com`, 
                first_name: nome,
                last_name: "Jogador",
            },
            date_of_expiration: new Date(Date.now() + (10 * 60 * 1000)).toISOString().replace("Z", "-03:00")
        };

        const response = await payment.create({ body });
        const paymentId = response.id.toString();

        // Salva o pagamento pendente no DB
        const dadosCompra = { nome, telefone, valorTotal };
        const query = `
            INSERT INTO raspadinha_pagamentos_pendentes (payment_id, socket_id, dados_compra_json)
            VALUES ($1, $2, $3)
            ON CONFLICT (payment_id) DO UPDATE SET
                socket_id = EXCLUDED.socket_id,
                dados_compra_json = EXCLUDED.dados_compra_json,
                timestamp = CURRENT_TIMESTAMP
        `;
        await db.query(query, [paymentId, socketId, JSON.stringify(dadosCompra)]);
        console.log(`Pagamento PIX ${paymentId} (Raspadinha) salvo no DB para socket ${socketId}.`);

        res.json({
            success: true, 
            qrCodeBase64: response.point_of_interaction.transaction_data.qr_code_base64, 
            qrCodeCopiaCola: response.point_of_interaction.transaction_data.qr_code, 
            paymentId: paymentId
        });

    } catch(error) {
        console.error("Erro em /criar-pagamento (Raspadinha):", error.cause || error.message);
        res.status(500).json({ success: false, message: 'Erro ao gerar QR Code.' });
    }
});

// API para o cliente "revelar" o prêmio (depois que o socket 'pagamentoAprovado' foi recebido)
// Usamos o paymentId como chave de segurança
app.post('/api/raspadinha/meu-premio', async (req, res) => {
    const { paymentId } = req.body;
    if (!paymentId) {
        return res.status(400).json({ success: false, message: "ID de pagamento não fornecido." });
    }

    try {
        // Busca o prêmio na tabela de VENDAS (não na de pendentes)
        const query = "SELECT valor_premio FROM raspadinha_vendas WHERE payment_id = $1";
        const result = await db.query(query, [paymentId]);

        if (result.rows.length > 0) {
            const valorPremio = result.rows[0].valor_premio;
            res.json({ success: true, valorPremio: valorPremio });
        } else {
            // Isso pode acontecer se o cliente chamar antes do webhook processar
            res.status(404).json({ success: false, message: "Prêmio ainda não processado ou não encontrado." });
        }
    } catch (e) {
        console.error("Erro ao buscar /meu-premio:", e);
        res.status(500).json({ success: false, message: "Erro de servidor." });
    }
});

// ==================================================
// --- INÍCIO DA CORREÇÃO (NOVA ROTA) ---
// ==================================================
// API para o cliente checar um pagamento que ele acha que já fez (ao reconectar)
app.post('/api/raspadinha/checar-pagamento', async (req, res) => {
    const { paymentId } = req.body;
    if (!paymentId) {
        return res.status(400).json({ success: false, message: "ID de pagamento não fornecido." });
    }

    try {
        // Busca o prêmio na tabela de VENDAS (não na de pendentes)
        const query = "SELECT valor_premio FROM raspadinha_vendas WHERE payment_id = $1";
        const result = await db.query(query, [paymentId]);

        if (result.rows.length > 0) {
            // Pagamento ENCONTRADO! O webhook já rodou.
            const valorPremio = result.rows[0].valor_premio;
            console.log(`Checagem de pagamento (Raspadinha): ${paymentId} ENCONTRADO. Prêmio: R$${valorPremio}`);
            res.json({ success: true, valorPremio: valorPremio });
        } else {
            // Pagamento ainda não foi processado pelo webhook.
            console.log(`Checagem de pagamento (Raspadinha): ${paymentId} NÃO encontrado. (Ainda pendente)`);
            res.status(404).json({ success: false, message: "Pagamento ainda pendente." });
        }
    } catch (e) {
        console.error("Erro ao /checar-pagamento:", e);
        res.status(500).json({ success: false, message: "Erro de servidor." });
    }
});
// ==================================================
// --- FIM DA CORREÇÃO ---
// ==================================================

// API para o cliente checar prêmios antigos
app.post('/api/raspadinha/checar-premios', async (req, res) => {
    const { telefone } = req.body;
    if (!telefone) {
        return res.status(400).json({ success: false, message: "Telefone não fornecido." });
    }
    try {
        const query = `
            SELECT valor_premio, status_pagamento_premio, to_char(timestamp AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') as data_formatada
            FROM raspadinha_vendas
            WHERE telefone = $1 AND valor_premio > 0
            ORDER BY timestamp DESC
            LIMIT 20;
        `;
        const result = await db.query(query, [telefone]);
        res.json({ success: true, premios: result.rows });
    } catch (e) {
        console.error("Erro ao /checar-premios:", e);
        res.status(500).json({ success: false, message: "Erro de servidor." });
    }
});


// ==========================================================
// ROTAS DE ADMINISTRAÇÃO (PAINEL DA RASPADINHA)
// ==========================================================
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// --- Middlewares de Admin ---
function checkAdmin(req, res, next) {
    if (req.session && req.session.isAdminRaspadinha) {
        // Se está logado, continua
        return next();
    }
    
    // Se não está logado, checa se é um pedido de API (fetch)
    const isApiRequest = req.headers['accept'] && (req.headers['accept'].includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest');
    
    if (isApiRequest) {
        // Se foi uma API, retorna um erro JSON 403 (Proibido)
        console.warn(`Acesso negado à API admin (sessão expirada?) IP: ${req.ip}`);
        return res.status(403).json({ success: false, message: 'Acesso negado. Sua sessão expirou.' });
    } else {
        // Se foi uma navegação normal (ex: F5 na página), redireciona para o login HTML
        console.warn(`Acesso negado à página admin (sem sessão). IP: ${req.ip}`);
        return res.redirect('/admin/login.html');
    }
}


// --- Login Admin ---
app.get('/admin/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.post('/admin/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const resDB = await db.query('SELECT * FROM raspadinha_admin WHERE usuario = $1', [usuario]);
        const adminUser = resDB.rows[0];

        if (adminUser && (await bcrypt.compare(senha, adminUser.senha))) {
            req.session.isAdminRaspadinha = true;
            req.session.usuario = adminUser.usuario;
            req.session.save(err => {
                if (err) return res.status(500).json({ success: false, message: 'Erro ao salvar sessão.' });
                return res.json({ success: true });
            });
        } else {
            return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// --- Logout Admin ---
app.get('/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('raspadinha.sid');
        res.redirect('/admin/login.html');
    });
});

// --- Painel Admin (Página Principal) ---
app.get('/admin', checkAdmin, (req, res) => {
    res.redirect('/admin/index.html');
});
app.get('/admin/index.html', checkAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// --- API: Salvar Configurações (Preço) ---
app.post('/admin/api/config', checkAdmin, async (req, res) => {
    const { preco_raspadinha, premio_maximo_display } = req.body;
    const precoNum = parseFloat(preco_raspadinha);
    const premioMaxNum = parseFloat(premio_maximo_display);

    if (isNaN(precoNum) || precoNum <= 0 || isNaN(premioMaxNum) || premioMaxNum < 0) {
        return res.status(400).json({ success: false, message: "Valores inválidos." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const query = `
            INSERT INTO raspadinha_config (chave, valor) VALUES ($1, $2) 
            ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor;
        `;
        await client.query(query, ['preco_raspadinha', precoNum.toFixed(2)]);
        await client.query(query, ['premio_maximo_display', premioMaxNum.toFixed(2)]);
        await client.query('COMMIT');
        
        await carregarConfiguracoes(); // Recarrega o cache
        
        // Emite atualização para todos os clientes
        io.emit('configAtualizada', { 
            preco: PRECO_RASPADINHA, 
            premioMaximo: PREMIO_MAXIMO_DISPLAY 
        });
        
        res.json({ success: true, message: "Configurações salvas!" });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: "Erro ao salvar." });
    } finally {
        client.release();
    }
});

// --- API: Gerenciar Faixas de Prêmio ---
app.get('/admin/api/faixas', checkAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM raspadinha_faixas_premio ORDER BY valor DESC');
        res.json({ success: true, faixas: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erro ao buscar faixas." });
    }
});

app.post('/admin/api/faixas', checkAdmin, async (req, res) => {
    const { valor, chance, descricao } = req.body;
    const valorNum = parseFloat(valor);
    const chanceNum = parseFloat(chance);

    if (isNaN(valorNum) || valorNum <= 0 || isNaN(chanceNum) || chanceNum <= 0) {
        return res.status(400).json({ success: false, message: "Valores inválidos." });
    }
    
    try {
        const query = 'INSERT INTO raspadinha_faixas_premio (valor, chance, descricao, ativo) VALUES ($1, $2, $3, true) RETURNING *';
        const result = await db.query(query, [valorNum, chanceNum, descricao || null]);
        res.status(201).json({ success: true, faixa: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erro ao criar faixa." });
    }
});

app.delete('/admin/api/faixas/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM raspadinha_faixas_premio WHERE id = $1', [id]);
        res.json({ success: true, message: "Faixa excluída." });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erro ao excluir faixa." });
    }
});

// --- API: Gerenciar Vendas/Pagamentos de Prêmios ---
app.get('/admin/api/vendas', checkAdmin, async (req, res) => {
    try {
        const query = `
            SELECT id, nome_jogador, telefone, valor_pago, valor_premio, status_pagamento_premio,
                   to_char(timestamp AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') as data_formatada
            FROM raspadinha_vendas
            ORDER BY timestamp DESC
        `;
        const result = await db.query(query);
        
        const totaisRes = await db.query(`
            SELECT 
                SUM(valor_pago) as faturamento,
                SUM(valor_premio) as premios_pagos,
                (SELECT SUM(valor_premio) FROM raspadinha_vendas WHERE status_pagamento_premio = 'Pendente') as premios_pendentes
            FROM raspadinha_vendas
        `);
        
        res.json({ 
            success: true, 
            vendas: result.rows,
            totais: totaisRes.rows[0] || { faturamento: 0, premios_pagos: 0, premios_pendentes: 0 }
        });
    } catch (e) {
        console.error("Erro ao buscar vendas admin:", e);
        res.status(500).json({ success: false, message: "Erro ao buscar vendas." });
    }
});

app.post('/admin/api/premio/pagar', checkAdmin, async (req, res) => {
    const { id } = req.body;
    try {
        const result = await db.query(
            "UPDATE raspadinha_vendas SET status_pagamento_premio = 'Pago' WHERE id = $1 AND status_pagamento_premio = 'Pendente' RETURNING id",
            [id]
        );
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Prêmio marcado como pago!" });
        } else {
            res.status(404).json({ success: false, message: "Venda não encontrada ou já estava paga." });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Erro ao marcar como pago." });
    }
});


// ==========================================================
// SOCKET.IO (Mínimo, apenas para notificação)
// ==========================================================
io.on('connection', (socket) => {
    console.log(`Novo usuário conectado (Raspadinha): ${socket.id}`);
    
    // ==================================================
    // --- INÍCIO DA CORREÇÃO ---
    // REMOVIDA A LIMPEZA DE PAGAMENTOS PENDENTES NO 'disconnect'
    // ELES AGORA EXPIRAM NATURALMENTE (OU SÃO PAGOS)
    // ==================================================
    socket.on('disconnect', () => {
        console.log(`Usuário desconectado (Raspadinha): ${socket.id}`);
    });
    // ==================================================
    // --- FIM DA CORREÇÃO ---
    // ==================================================
});


// ==========================================================
// INICIAR O SERVIDOR
// ==========================================================
(async () => {
    // 1. Prepara o banco de dados
    await inicializarBanco();

    // 2. Carrega as configurações (preço, etc.)
    await carregarConfiguracoes();

    // 3. Inicia o servidor web
    server.listen(PORTA, () => {
        console.log(`Servidor "Raspadinha do Pix" rodando!`);
        console.log(`Acesse em http://localhost:${PORTA}`);
        console.log(`Admin em http://localhost:${PORTA}/admin`);
    });
})();

// --- FECHAR O BANCO AO SAIR ---
process.on('exit', () => pool.end());
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));
