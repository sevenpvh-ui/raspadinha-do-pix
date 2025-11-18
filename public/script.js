document.addEventListener('DOMContentLoaded', () => {

    // ==================================================================
    // 1. IMAGEM DE RASPAGEM (PRATEADA SÓLIDA - BASE64)
    // ==================================================================
    // Esta é uma imagem real de textura prateada convertida em texto.
    // Ela é opaca e vai cobrir o prêmio completamente.
    const IMG_TINTA_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEISURBVHhe7dQxDQAwDMCwNhxj/5IGYi9HgZzA9t2Z/==";

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

    // --- CARREGAR CONFIG ---
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

    // --- MODAL E BOTÕES ---
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

    const btnCopiarPix = document.getElementById('btn-copiar-pix');
    if(btnCopiarPix) {
        btnCopiarPix.addEventListener('click', () => {
            const input = document.getElementById('pix-copia-cola');
            input.select();
            navigator.clipboard.writeText(input.value);
            btnCopiarPix.textContent = "Copiado!"; setTimeout(() => { btnCopiarPix.textContent = "Copiar Código"; }, 2000);
        });
    }

    // --- SOCKET (Ouvindo Aprovação) ---
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
        const minhas = document.getElementById('minhas-raspadinhas');
        if(minhas) minhas.style.display = 'none';
        
        const areaJogo = document.getElementById('card-area-jogo');
        areaJogo.style.display = 'block';
        
        iniciarRaspadinha(valor);
    }

    // ==========================================================
    // LÓGICA DA RASPADINHA BLINDADA
    // ==========================================================
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

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
                // Se a largura for 0, forçamos um valor mínimo para evitar erro
                const finalWidth = width > 0 ? width : 300; 

                const oldCanvas = raspadinhaContainer.querySelector('canvas');
                if(oldCanvas) oldCanvas.remove();

                const sc = new ScratchCard('#raspadinha-container', {
                    scratchType: 1, // 1 = SPRAY
                    containerWidth: finalWidth,
                    containerHeight: finalWidth * 0.5625, // 16:9
                    
                    // AQUI: Usamos a nova imagem base64 sólida
                    imageForwardSrc: IMG_TINTA_BASE64, 
                    
                    htmlBackground: '', // Fundo HTML transparente
                    clearZoneRadius: 25, // Tamanho do dedo
                    nPoints: 30, // Densidade
                    pointSize: 10, // Tamanho do ponto
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

                sc.init().then(() => {
                    console.log("Raspadinha Prateada Carregada!");
                    // Força o canvas a ser visível
                    const canvas = raspadinhaContainer.querySelector('canvas');
                    if(canvas) {
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';
                    }
                }).catch((err) => {
                    console.error("Erro crítico no init:", err);
                });

            } catch (e) {
                console.error("Erro fatal:", e);
            }
        });
    }

    // --- Recuperar Prêmios ---
    const formRecuperar = document.getElementById('form-recuperar-premios');
    const inputTelefoneRecuperar = document.getElementById('modal-telefone-recuperar');
    const btnChecarPremios = document.getElementById('btn-checar-premios');

    if (formRecuperar) {
        formRecuperar.addEventListener('submit', async (e) => {
            e.preventDefault();
            const telefone = inputTelefoneRecuperar.value.trim();
            btnChecarPremios.disabled = true; btnChecarPremios.textContent = 'Buscando...';
            try {
                const response = await fetch('/api/raspadinha/checar-premios', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefone: telefone }),
                });
                const data = await response.json();
                if (data.success) criarModalPremios(data.premios);
                else alert(data.message);
            } catch (err) { alert("Erro de conexão."); } 
            finally { btnChecarPremios.disabled = false; btnChecarPremios.textContent = 'Verificar Prêmios'; }
        });
    }

    function criarModalPremios(premios) {
        let modalPremios = document.createElement('div');
        modalPremios.classList.add('modal-overlay');
        modalPremios.style.display = 'flex';
        let html = `<div class="modal-content" style="max-width: 600px;">
                <span class="modal-close" id="modal-premios-fechar">&times;</span>
                <h2 class="title-gradient">Meus Prêmios</h2><div id="modal-meus-premios-lista">`;
        if (premios && premios.length > 0) {
            premios.forEach(p => {
                let cls = p.status_pagamento_premio === 'Pendente' ? 'status-pendente' : 'status-pago';
                html += `<div class="premio-encontrado-item">
                        <div class="premio-info-wrapper"><span class="premio-valor-consulta">${formatarBRL(p.valor_premio)}</span><span class="premio-data-consulta">${p.data_formatada}</span></div>
                        <span class="status-pagamento ${cls}">${p.status_pagamento_premio}</span></div>`;
            });
        } else { html += `<p>Nenhum prêmio encontrado.</p>`; }
        html += `</div></div>`;
        modalPremios.innerHTML = html;
        document.body.appendChild(modalPremios);
        modalPremios.addEventListener('click', (e) => { if (e.target.id === 'modal-premios-fechar' || e.target === modalPremios) modalPremios.remove(); });
    }
});
