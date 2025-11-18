document.addEventListener('DOMContentLoaded', () => {

    let socket;
    try {
        socket = io();
        console.log("Conectado ao servidor Socket.IO (Raspadinha).");
    } catch (err) {
        console.error("Erro ao conectar ao Socket.IO:", err);
        const btnComprar = document.getElementById('btn-comprar-raspadinha');
        if (btnComprar) { btnComprar.disabled = true; btnComprar.textContent = "Erro de Conexão"; }
    }

    let PRECO_RASPADINHA_ATUAL = 1.00;
    let PREMIO_MAXIMO_ATUAL = 100.00;

    const cardComprar = document.getElementById('card-comprar-raspadinha');
    const cardJogo = document.getElementById('card-area-jogo');
    const btnComprarRaspadinha = document.getElementById('btn-comprar-raspadinha');
    const raspadinhaPrecoEl = document.getElementById('raspadinha-preco');
    const raspadinhaPremioMaximoEl = document.getElementById('raspadinha-premio-maximo');
    
    const raspadinhaContainer = document.getElementById('raspadinha-container');
    const raspadinhaFundo = document.getElementById('raspadinha-fundo');
    const raspadinhaTextoPremio = document.getElementById('raspadinha-texto-premio');
    const raspadinhaStatus = document.getElementById('raspadinha-status');
    const btnJogarNovamente = document.getElementById('btn-jogar-novamente');

    const modal = document.getElementById('modal-checkout');
    const btnCloseModal = document.querySelector('.modal-close');
    const etapaDados = document.getElementById('etapa-dados');
    const etapaPix = document.getElementById('etapa-pix');
    const btnGerarPix = document.getElementById('btn-gerar-pix'); 
    const btnCopiarPix = document.getElementById('btn-copiar-pix'); 
    const pixQrCodeImg = document.getElementById('pix-qrcode-img');
    const pixCopiaColaInput = document.getElementById('pix-copia-cola');
    const aguardandoPagamentoEl = document.getElementById('aguardando-pagamento');
    const modalNome = document.getElementById('modal-nome');
    const modalTelefone = document.getElementById('modal-telefone');
    const modalPrecoEl = document.getElementById('modal-preco');

    const formRecuperar = document.getElementById('form-recuperar-premios');
    const inputTelefoneRecuperar = document.getElementById('modal-telefone-recuperar');
    const btnChecarPremios = document.getElementById('btn-checar-premios');

    function formatarBRL(valor) {
        const numero = parseFloat(valor);
        if (isNaN(numero)) return 'R$ --,--';
        return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    async function carregarConfig() {
        try {
            const response = await fetch('/api/raspadinha/config');
            if (!response.ok) throw new Error('Erro ao buscar config.');
            const data = await response.json();
            if (data.success) {
                PRECO_RASPADINHA_ATUAL = parseFloat(data.preco || '2.00');
                PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo || '100.00');
                if (raspadinhaPrecoEl) raspadinhaPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
                if (raspadinhaPremioMaximoEl) raspadinhaPremioMaximoEl.textContent = formatarBRL(PREMIO_MAXIMO_ATUAL);
                if (modalPrecoEl) modalPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL);
            }
        } catch (err) {
            console.error(err);
        }
    }
    carregarConfig();

    if (btnComprarRaspadinha) {
        btnComprarRaspadinha.addEventListener('click', () => {
            if (!socket || !socket.connected) { alert("Erro de conexão. Recarregue."); return; }
            modal.style.display = 'flex'; modalNome.focus();
        });
    }
    
    if (btnCloseModal) btnCloseModal.addEventListener('click', fecharModal);
    if (modal) modal.addEventListener('click', (event) => { if (event.target === modal) fecharModal(); });

    function fecharModal() { 
        if(modal) modal.style.display = 'none'; 
        if(etapaDados) etapaDados.style.display = 'block';
        if(etapaPix) etapaPix.style.display = 'none';
        if(btnGerarPix) { btnGerarPix.disabled = false; btnGerarPix.textContent = "Gerar PIX"; }
        sessionStorage.removeItem('raspadinha_payment_id');
    }

    if (btnGerarPix) {
        btnGerarPix.addEventListener('click', async () => {
            const nome = modalNome.value.trim();
            const telefone = modalTelefone.value.trim();
            if (!nome || !telefone) { alert("Preencha todos os campos."); return; }
            if (!/^\d{10,11}$/.test(telefone.replace(/\D/g,''))) { alert("Telefone inválido."); return; }
            if (!socket || !socket.id) { alert("Erro de conexão."); return; }

            btnGerarPix.textContent = "Gerando..."; btnGerarPix.disabled = true;

            try {
                const response = await fetch('/api/raspadinha/criar-pagamento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Socket-ID': socket.id },
                    body: JSON.stringify({ nome, telefone }),
                });
                const data = await response.json();
                if (data && data.success) {
                    pixQrCodeImg.src = `data:image/png;base64,${data.qrCodeBase64}`;
                    pixCopiaColaInput.value = data.qrCodeCopiaCola;
                    etapaDados.style.display = 'none'; etapaPix.style.display = 'block'; aguardandoPagamentoEl.style.display = 'block';
                    sessionStorage.setItem('raspadinha_usuario_nome', nome); 
                    sessionStorage.setItem('raspadinha_usuario_telefone', telefone);
                    sessionStorage.setItem('raspadinha_payment_id', data.paymentId);
                } else {
                    alert(`Erro: ${data.message}`); btnGerarPix.textContent = "Gerar PIX"; btnGerarPix.disabled = false;
                }
            } catch (err) {
                alert("Erro de conexão."); btnGerarPix.textContent = "Gerar PIX"; btnGerarPix.disabled = false;
            }
        });
    }

    if(btnCopiarPix) {
        btnCopiarPix.addEventListener('click', () => {
            pixCopiaColaInput.select();
            navigator.clipboard.writeText(pixCopiaColaInput.value);
            btnCopiarPix.textContent = "Copiado!"; setTimeout(() => { btnCopiarPix.textContent = "Copiar Código"; }, 2000);
        });
    }

    if (socket) {
        socket.on('connect', () => { checarPagamentoPendente(); });
        socket.on('configAtualizada', (data) => {
            if (data.preco) { PRECO_RASPADINHA_ATUAL = parseFloat(data.preco); if (raspadinhaPrecoEl) raspadinhaPrecoEl.textContent = formatarBRL(PRECO_RASPADINHA_ATUAL); }
            if (data.premioMaximo) { PREMIO_MAXIMO_ATUAL = parseFloat(data.premioMaximo); if (raspadinhaPremioMaximoEl) raspadinhaPremioMaximoEl.textContent = formatarBRL(PREMIO_MAXIMO_ATUAL); }
        });
        socket.on('pagamentoAprovado', (data) => {
            const paymentIdPendente = sessionStorage.getItem('raspadinha_payment_id');
            if (data.paymentId === paymentIdPendente) {
                sessionStorage.removeItem('raspadinha_payment_id');
                fecharModal();
                if (cardComprar) cardComprar.style.display = 'none';
                if (formRecuperar) formRecuperar.closest('.card').style.display = 'none';
                if (cardJogo) cardJogo.style.display = 'block';
                iniciarRaspadinha(data.valorPremio);
            }
        });
    }

    async function checarPagamentoPendente() {
        const paymentIdPendente = sessionStorage.getItem('raspadinha_payment_id');
        if (!paymentIdPendente) return;
        try {
            const response = await fetch('/api/raspadinha/checar-pagamento', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId: paymentIdPendente }),
            });
            const data = await response.json();
            if (data.success) {
                sessionStorage.removeItem('raspadinha_payment_id');
                fecharModal();
                if (cardComprar) cardComprar.style.display = 'none';
                if (formRecuperar) formRecuperar.closest('.card').style.display = 'none';
                if (cardJogo) cardJogo.style.display = 'block';
                iniciarRaspadinha(data.valorPremio);
            } else {
                mostrarModalAguardando();
            }
        } catch (err) { mostrarModalAguardando(); }
    }

    function mostrarModalAguardando() {
        if (modal && etapaDados && etapaPix && aguardandoPagamentoEl) {
            etapaDados.style.display = 'none'; etapaPix.style.display = 'block'; aguardandoPagamentoEl.style.display = 'block';
            document.getElementById('pix-qrcode-container').style.display = 'none';
            document.getElementById('pix-copia-cola').closest('.form-grupo').style.display = 'none';
            modal.style.display = 'flex';
        }
    }

    // --- FUNÇÃO DE INICIAR O JOGO ---
    function iniciarRaspadinha(valorPremio) {
        if (!raspadinhaContainer) return;

        // Usa requestAnimationFrame para garantir que o display:block já foi aplicado
        requestAnimationFrame(() => {
            try {
                // Define o texto do prêmio
                if (valorPremio > 0) {
                    raspadinhaFundo.classList.remove('nao-ganhou');
                    raspadinhaTextoPremio.textContent = formatarBRL(valorPremio);
                } else {
                    raspadinhaFundo.classList.add('nao-ganhou');
                    raspadinhaTextoPremio.textContent = "Não foi dessa vez!";
                }

                const containerWidth = raspadinhaContainer.clientWidth;
                if (containerWidth === 0) throw new Error("Container largura 0");

                const sc = new ScratchCard('#raspadinha-container', {
                    scratchType: 'line',
                    containerWidth: containerWidth,
                    containerHeight: containerWidth * 0.5625,
                    // CERTIFIQUE-SE QUE A IMAGEM EXISTE NA PASTA PUBLIC COM ESTE NOME:
                    imageForwardSrc: 'imagem-raspadinha.png', 
                    htmlBackground: '',
                    clearZoneRadius: 30,
                    percentToFinish: 70,
                    callback: () => {
                        if (valorPremio > 0) {
                            raspadinhaStatus.textContent = `PARABÉNS! Você ganhou ${formatarBRL(valorPremio)}!`;
                            raspadinhaStatus.style.color = "var(--color-raspadinha-gold)";
                        } else {
                            raspadinhaStatus.textContent = "Que pena! Tente novamente!";
                            raspadinhaStatus.style.color = "var(--color-text-body)";
                        }
                        btnJogarNovamente.style.display = 'block';
                    }
                });

                sc.init().then(() => {
                    console.log("Raspadinha iniciada com sucesso.");
                }).catch((err) => {
                    console.error("Erro init:", err);
                    raspadinhaStatus.textContent = "Erro ao carregar a imagem. Verifique o nome do arquivo no servidor.";
                    raspadinhaStatus.style.color = "red";
                });

            } catch (err) {
                console.error("Erro crítico:", err);
            }
        });
    }

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
