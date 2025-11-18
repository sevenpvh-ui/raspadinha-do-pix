document.addEventListener('DOMContentLoaded', () => {

    // --- IMAGEM CINZA (TINTA) DIRETO NO CÓDIGO ---
    // Isso garante que a imagem SEMPRE carregue, sem erro 404
    const IMG_TINTA_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIklEQVQIW2NkQAKrVq36zwjjgzhhYWGMYAEYB8RmROaABADeOQ8CXl/xfgAAAABJRU5ErkJggg==";

    // --- CONFIGURAÇÃO SOCKET.IO ---
    let socket;
    try {
        socket = io();
        console.log("Conectado ao servidor Socket.IO.");
    } catch (err) {
        console.error("Erro Socket:", err);
        alert("Erro de conexão. Recarregue a página.");
    }

    // --- VARIÁVEIS GLOBAIS ---
    let PRECO_RASPADINHA_ATUAL = 1.00;
    let PREMIO_MAXIMO_ATUAL = 100.00;

    // --- ELEMENTOS ---
    const modal = document.getElementById('modal-checkout');
    const btnComprar = document.getElementById('btn-comprar-raspadinha');
    const btnSimular = document.getElementById('btn-simular-teste');
    const raspadinhaContainer = document.getElementById('raspadinha-container');
    const raspadinhaFundo = document.getElementById('raspadinha-fundo');
    const raspadinhaTexto = document.getElementById('raspadinha-texto-premio');
    const raspadinhaStatus = document.getElementById('raspadinha-status');
    const btnJogarNovamente = document.getElementById('btn-jogar-novamente');
    
    // --- MODAL ELEMENTOS ---
    const etapaDados = document.getElementById('etapa-dados');
    const etapaPix = document.getElementById('etapa-pix');
    const btnGerarPix = document.getElementById('btn-gerar-pix');
    const btnCopiarPix = document.getElementById('btn-copiar-pix');

    // --- FORMATADOR ---
    const formatarBRL = (v) => parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // --- 1. CARREGAR CONFIG ---
    async function carregarConfig() {
        try {
            const res = await fetch('/api/raspadinha/config');
            const data = await res.json();
            if (data.success) {
                PRECO_RASPADINHA_ATUAL = parseFloat(data.preco);
                PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo);
                if(document.getElementById('raspadinha-preco')) 
                    document.getElementById('raspadinha-preco').textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
                if(document.getElementById('raspadinha-premio-maximo'))
                    document.getElementById('raspadinha-premio-maximo').textContent = formatarBRL(PREMIO_MAXIMO_ATUAL);
                if(document.getElementById('modal-preco'))
                    document.getElementById('modal-preco').textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
            }
        } catch (e) { console.error(e); }
    }
    carregarConfig();

    // --- 2. MODAL E BOTÕES ---
    if (btnComprar) {
        btnComprar.addEventListener('click', () => {
            modal.style.display = 'flex';
        });
    }
    
    document.querySelector('.modal-close').addEventListener('click', fecharModal);
    
    function fecharModal() {
        modal.style.display = 'none';
        etapaDados.style.display = 'block';
        etapaPix.style.display = 'none';
        btnGerarPix.disabled = false; 
        btnGerarPix.textContent = "Gerar PIX";
        sessionStorage.removeItem('raspadinha_payment_id');
    }

    // --- BOTÃO DE SIMULAÇÃO (TESTE) ---
    if (btnSimular) {
        btnSimular.addEventListener('click', async () => {
            if (!socket || !socket.id) return alert("Sem conexão Socket.");
            
            const nome = document.getElementById('modal-nome').value || "Tester";
            const telefone = document.getElementById('modal-telefone').value || "999999999";
            const fakeId = "test_" + Date.now();
            
            sessionStorage.setItem('raspadinha_payment_id', fakeId);
            btnSimular.textContent = "Simulando..."; btnSimular.disabled = true;

            try {
                await fetch('/api/debug/simular', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ socketId: socket.id, nome, telefone, paymentId: fakeId })
                });
            } catch (e) { alert("Erro simulação"); btnSimular.disabled = false; }
        });
    }

    // --- BOTÃO GERAR PIX REAL ---
    if (btnGerarPix) {
        btnGerarPix.addEventListener('click', async () => {
            const nome = document.getElementById('modal-nome').value;
            const telefone = document.getElementById('modal-telefone').value;
            if(!nome || !telefone) return alert("Preencha os dados");

            btnGerarPix.disabled = true; btnGerarPix.textContent = "Aguarde...";

            try {
                const res = await fetch('/api/raspadinha/criar-pagamento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Socket-ID': socket.id },
                    body: JSON.stringify({ nome, telefone })
                });
                const data = await res.json();
                if (data.success) {
                    document.getElementById('pix-qrcode-img').src = `data:image/png;base64,${data.qrCodeBase64}`;
                    document.getElementById('pix-copia-cola').value = data.qrCodeCopiaCola;
                    etapaDados.style.display = 'none';
                    etapaPix.style.display = 'block';
                    document.getElementById('aguardando-pagamento').style.display = 'block';
                    sessionStorage.setItem('raspadinha_payment_id', data.paymentId);
                } else { alert(data.message); btnGerarPix.disabled = false; }
            } catch (e) { alert("Erro ao gerar PIX"); btnGerarPix.disabled = false; }
        });
    }

    // --- 3. SOCKET (Ouvindo Aprovação) ---
    if (socket) {
        socket.on('pagamentoAprovado', (data) => {
            if (data.paymentId === sessionStorage.getItem('raspadinha_payment_id')) {
                sessionStorage.removeItem('raspadinha_payment_id');
                fecharModal();
                prepararJogo(data.valorPremio);
            }
        });
    }

    function prepararJogo(valor) {
        document.getElementById('card-comprar-raspadinha').style.display = 'none';
        if(document.getElementById('minhas-raspadinhas')) 
            document.getElementById('minhas-raspadinhas').style.display = 'none';
        
        const areaJogo = document.getElementById('card-area-jogo');
        areaJogo.style.display = 'block';
        
        // Inicia o jogo
        iniciarRaspadinha(valor);
    }

    // ==========================================================
    // 4. LÓGICA DA RASPADINHA (CORRIGIDA E BLINDADA)
    // ==========================================================
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

        // Garante que o navegador renderizou o container antes de desenhar
        requestAnimationFrame(() => {
            try {
                // 1. Configura o Prêmio (Fundo)
                if (valorPremio > 0) {
                    raspadinhaFundo.classList.remove('nao-ganhou');
                    raspadinhaTexto.textContent = formatarBRL(valorPremio);
                } else {
                    raspadinhaFundo.classList.add('nao-ganhou');
                    raspadinhaTexto.textContent = "Não foi dessa vez!";
                }

                const width = raspadinhaContainer.clientWidth;
                if (width === 0) return console.error("Largura do container é 0");

                // Limpa canvas antigo
                const oldCanvas = raspadinhaContainer.querySelector('canvas');
                if(oldCanvas) oldCanvas.remove();

                // 2. Cria a Raspadinha
                // AQUI ESTAVA O ERRO DO CONSOLE: 'SCRATCH_TYPE' undefined.
                // SOLUÇÃO: Usamos o número 1 (que representa SPRAY) diretamente.
                const sc = new ScratchCard('#raspadinha-container', {
                    scratchType: 1, // <--- 1 = SPRAY (CORREÇÃO DO ERRO JS)
                    containerWidth: width,
                    containerHeight: width * 0.5625, // 16:9
                    imageForwardSrc: IMG_TINTA_BASE64, // <--- IMAGEM EMBUTIDA (CORREÇÃO DO ERRO 404)
                    htmlBackground: '', 
                    clearZoneRadius: 30,
                    nPoints: 80,
                    pointSize: 6,
                    callback: () => {
                        if (valorPremio > 0) {
                            raspadinhaStatus.textContent = `PARABÉNS! Ganhou ${formatarBRL(valorPremio)}!`;
                            raspadinhaStatus.style.color = "var(--color-raspadinha-gold)";
                        } else {
                            raspadinhaStatus.textContent = "Tente novamente!";
                        }
                        btnJogarNovamente.style.display = 'block';
                    }
                });

                sc.init()
                    .then(() => console.log("Raspadinha criada com sucesso!"))
                    .catch((err) => {
                        console.error("Erro crítico no init:", err);
                        raspadinhaStatus.textContent = "Erro ao criar raspadinha.";
                    });

            } catch (e) {
                console.error("Erro fatal:", e);
            }
        });
    }
});
