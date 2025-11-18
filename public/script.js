document.addEventListener('DOMContentLoaded', () => {

    // --- IMAGEM PRATEADA (BASE64) ---
    const IMG_TINTA_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEISURBVHhe7dQxDQAwDMCwNhxj/5IGYi9HgZzA9t2Z/==";

    let socket;
    try {
        socket = io();
        console.log("Conectado ao servidor Socket.IO.");
    } catch (err) {
        console.error("Erro Socket:", err);
        // Não bloqueia o resto do script se o socket falhar
    }

    // --- VARIÁVEIS ---
    let PRECO_RASPADINHA_ATUAL = 1.00;
    let PREMIO_MAXIMO_ATUAL = 100.00;

    // --- SELETORES ---
    const modal = document.getElementById('modal-checkout');
    const btnCloseModal = document.querySelector('.modal-close');
    
    const btnComprar = document.getElementById('btn-comprar-raspadinha');
    const btnSimular = document.getElementById('btn-simular-teste');
    const btnGerarPix = document.getElementById('btn-gerar-pix');
    const btnCopiarPix = document.getElementById('btn-copiar-pix');
    
    const etapaDados = document.getElementById('etapa-dados');
    const etapaPix = document.getElementById('etapa-pix');
    
    const raspadinhaContainer = document.getElementById('raspadinha-container');
    const raspadinhaFundo = document.getElementById('raspadinha-fundo');
    const raspadinhaTexto = document.getElementById('raspadinha-texto-premio');
    const raspadinhaStatus = document.getElementById('raspadinha-status');
    const btnJogarNovamente = document.getElementById('btn-jogar-novamente');

    // --- CONFIG ---
    const formatarBRL = (v) => parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

    // --- MODAL ---
    if (btnComprar) {
        btnComprar.addEventListener('click', () => { modal.style.display = 'flex'; });
    }
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', fecharModal);
    }

    function fecharModal() {
        modal.style.display = 'none';
        etapaDados.style.display = 'block';
        etapaPix.style.display = 'none';
        if(btnGerarPix) {
            btnGerarPix.disabled = false; 
            btnGerarPix.textContent = "Gerar PIX";
        }
        sessionStorage.removeItem('raspadinha_payment_id');
    }

    // --- BOTÕES DE AÇÃO ---
    
    // 1. Simular (Teste)
    if (btnSimular) {
        btnSimular.addEventListener('click', async () => {
            if (!socket || !socket.id) return alert("Sem conexão com servidor.");
            
            const nome = document.getElementById('modal-nome').value || "Tester";
            const telefone = document.getElementById('modal-telefone').value || "999999999";
            const fakeId = "test_" + Date.now();
            
            sessionStorage.setItem('raspadinha_payment_id', fakeId);
            btnSimular.textContent = "Simulando..."; 
            btnSimular.disabled = true;

            try {
                await fetch('/api/debug/simular', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ socketId: socket.id, nome, telefone, paymentId: fakeId })
                });
            } catch (e) { 
                alert("Erro na simulação"); 
                btnSimular.disabled = false; 
            }
        });
    }

    // 2. Gerar Pix Real
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

    // 3. Copiar Pix
    if(btnCopiarPix) {
        btnCopiarPix.addEventListener('click', () => {
            const input = document.getElementById('pix-copia-cola');
            input.select();
            navigator.clipboard.writeText(input.value);
            btnCopiarPix.textContent = "Copiado!"; 
            setTimeout(() => { btnCopiarPix.textContent = "Copiar Código"; }, 2000);
        });
    }

    // --- SOCKET LISTENERS ---
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
    // LÓGICA DA RASPADINHA (Sem erro 404, Sem erro SPRAY)
    // ==========================================================
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

        requestAnimationFrame(() => {
            try {
                // 1. Define o Prêmio
                if (valorPremio > 0) {
                    raspadinhaFundo.classList.remove('nao-ganhou');
                    raspadinhaTexto.textContent = formatarBRL(valorPremio);
                } else {
                    raspadinhaFundo.classList.add('nao-ganhou');
                    raspadinhaTexto.textContent = "Não foi dessa vez!";
                }

                const width = raspadinhaContainer.clientWidth;
                const finalWidth = width > 0 ? width : 300; 

                // Limpa canvas antigo
                const oldCanvas = raspadinhaContainer.querySelector('canvas');
                if(oldCanvas) oldCanvas.remove();

                // 2. Cria Raspadinha
                const sc = new ScratchCard('#raspadinha-container', {
                    scratchType: 1, // 1 = SPRAY (Corrige erro undefined)
                    containerWidth: finalWidth,
                    containerHeight: finalWidth * 0.5625,
                    imageForwardSrc: IMG_TINTA_BASE64, // (Corrige erro 404)
                    htmlBackground: '', 
                    clearZoneRadius: 25,
                    nPoints: 30,
                    pointSize: 10,
                    callback: () => {
                        if (valorPremio > 0) {
                            raspadinhaStatus.textContent = `PARABÉNS! Ganhou ${formatarBRL(valorPremio)}!`;
                            raspadinhaStatus.style.color = "var(--color-raspadinha-gold)";
                        } else {
                            raspadinhaStatus.textContent = "Tente novamente!";
                            raspadinhaStatus.style.color = "#555";
                        }
                        btnJogarNovamente.style.display = 'block';
                    }
                });

                sc.init().then(() => {
                    console.log("Raspadinha Pronta!");
                    const canvas = raspadinhaContainer.querySelector('canvas');
                    if(canvas) {
                        canvas.style.width = '100%';
                        canvas.style.height = '100%';
                    }
                }).catch((err) => {
                    console.error("Erro init:", err);
                });

            } catch (e) { console.error("Erro fatal:", e); }
        });
    }

    // --- CONSULTAR PRÊMIOS ---
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
                <span class="modal-close" id="modal-premios-fechar" style="cursor:pointer;">&times;</span>
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
        
        // Evento para fechar
        modalPremios.addEventListener('click', (e) => { 
            if (e.target.id === 'modal-premios-fechar' || e.target === modalPremios) modalPremios.remove(); 
        });
    }
});
